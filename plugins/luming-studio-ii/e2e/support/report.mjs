import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { isDeepStrictEqual, parseArgs, stripVTControlCharacters } from "node:util";

const usage = `Usage: node report.mjs [--strict] <manifest.json> <report.json>
Manifest: { project, version?, title, date?, scope, delivery?, targets, caseFile?, cases?, casePrefix? }
Each target is { project, label, result } and names a Playwright project and JSON report.
Each case is { id, title?, expected?, steps?, notes?, observations?, versionExpectations? }.
Test titles start with [id]. Map parity-* attachment names to labels in observations.
Case files contain { cases, casePrefix? }. Their paths and results are relative to the manifest.`;

const labels = {
  passed: "通过",
  failed: "失败",
  flaky: "重试中有失败",
  skipped: "跳过",
  missing: "未执行",
};

const attemptLabels = {
  passed: "通过",
  failed: "失败",
  timedOut: "超时",
  interrupted: "中断",
  skipped: "跳过",
};

const formats = {
  "image/png": {
    extension: ".png",
    valid: (bytes) => bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  },
  "image/jpeg": {
    extension: ".jpg",
    valid: (bytes) => bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
  },
  "image/webp": {
    extension: ".webp",
    valid: (bytes) =>
      bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP",
  },
};

function publicText(value, limit = 460) {
  if (typeof value !== "string") {
    return "";
  }

  return stripVTControlCharacters(value)
    .replace(/https?:\/\/[^\s<>"']+/giu, "［地址已省略］")
    .replace(/\b(authorization|cookie|password|secret|token)\s*[:=]\s*[^\n,;]+/giu, "$1=［已省略］")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, limit);
}

function errorText(error) {
  return publicText(error?.message ?? error?.value ?? error);
}

function* testsIn(suites, project) {
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) {
      yield* (spec.tests ?? [])
        .filter((test) => (test.projectName || test.projectId) === project)
        .map((test) => ({ spec, test }));
    }
    yield* testsIn(suite.suites ?? [], project);
  }
}

function caseIdentity(spec) {
  const [match, id, title] = /^\[([^\]\r\n]+)\]\s*(.+)$/u.exec(spec.title) ?? [];

  return match ? { id, title } : { id: spec.title, title: spec.title };
}

function testOutcome(test) {
  if (test.status === "flaky") {
    return "flaky";
  }

  const attempts = test.results ?? [];
  const failed = attempts.some(({ status }) =>
    ["failed", "timedOut", "interrupted"].includes(status),
  );

  if (failed) {
    return attempts.at(-1)?.status === "passed" ? "flaky" : "failed";
  }
  if (test.status === "unexpected") {
    return "failed";
  }
  if (test.status === "skipped" || attempts.length === 0) {
    return "skipped";
  }
  if (test.expectedStatus === "passed" && attempts.every(({ status }) => status === "passed")) {
    return "passed";
  }

  return "skipped";
}

function targetOutcome(entries) {
  if (entries.length === 0) {
    return "missing";
  }

  const outcomes = entries.map(({ test }) => testOutcome(test));
  for (const outcome of ["failed", "flaky", "skipped"]) {
    if (outcomes.includes(outcome)) {
      return outcome;
    }
  }

  return "passed";
}

function testRecord(target, { spec, test }) {
  const resultStatuses = (test.results ?? []).map(
    ({ status }) => attemptLabels[status] ?? "无回执",
  );
  const status = resultStatuses.length ? resultStatuses.join(" → ") : "无执行记录";
  const location =
    spec.file && !/^([a-z]:|\/)/iu.test(spec.file) ? spec.file + ":" + spec.line : "";
  const failures = (test.results ?? [])
    .flatMap((result) => (result.errors?.length ? result.errors : [result.error]))
    .map(errorText)
    .filter(Boolean);
  const annotations = (test.annotations ?? [])
    .filter(({ type }) => ["skip", "fixme", "fail"].includes(type))
    .map(({ description }) => publicText(description))
    .filter(Boolean);
  const remarks = [...new Set([...failures, ...annotations])];

  return [
    [target.label, "执行 " + status, location].filter(Boolean).join(" · ") + "。",
    ...remarks.map((remark) => target.label + " · " + remark),
  ];
}

async function attachmentBytes(attachment, resultPath) {
  if (typeof attachment.body === "string") {
    return Buffer.from(attachment.body, "base64");
  }

  if (typeof attachment.path === "string") {
    try {
      return await readFile(resolve(dirname(resultPath), attachment.path));
    } catch (error) {
      if (!["ENOENT", "EACCES", "EPERM", "EISDIR"].includes(error.code)) {
        throw error;
      }
    }
  }
}

function attachmentWriter(outputPath) {
  const folder = basename(outputPath, extname(outputPath)) + "-evidence";
  const root = resolve(dirname(outputPath), folder);
  let index = 0;

  return async (attachment, resultPath) => {
    const format = formats[attachment.contentType];
    if (!format) {
      return;
    }

    const bytes = await attachmentBytes(attachment, resultPath);
    if (!bytes || !format.valid(bytes)) {
      return;
    }

    await mkdir(root, { recursive: true });
    const filename = String(++index).padStart(3, "0") + format.extension;
    await writeFile(resolve(root, filename), bytes);

    return folder + "/" + filename;
  };
}

async function addObservation(target, attachment, observations, unavailable) {
  const values = observations.get(attachment.name) ?? [];
  observations.set(attachment.name, values);
  const bytes = await attachmentBytes(attachment, target.result);
  try {
    const value = JSON.parse(bytes?.toString("utf8").replace(/^\uFEFF/u, "") ?? "");
    if (!values.some((stored) => isDeepStrictEqual(stored, value))) {
      values.push(value);
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }

    values.push(undefined);
    unavailable.push(target.label + " · " + publicText(attachment.name) + "的 JSON 观测无法读取。");
  }
}

async function caseEvidence(target, entries, save) {
  const images = [];
  const unavailable = [];
  const observations = new Map();
  const attempts = entries.flatMap(({ test }) => test.results ?? []);
  for (const result of attempts) {
    for (const attachment of result.attachments ?? []) {
      if (attachment.contentType === "application/json" && attachment.name?.startsWith("parity-")) {
        await addObservation(target, attachment, observations, unavailable);
        continue;
      }
      if (!Object.hasOwn(formats, attachment.contentType)) {
        continue;
      }

      const name = publicText(attachment.name, 140) || "截图";
      const label = target.label + " · " + name;
      const path = await save(attachment, target.result);
      if (path) {
        const attempt = result.retry ? "第 " + (result.retry + 1) + " 次执行" : "首次执行";
        const status = attemptLabels[result.status] ?? "无回执";
        images.push({ name, shot: { path, label, caption: attempt + " · " + status } });
      } else {
        unavailable.push(label + "的附件无法读取或格式无效。");
      }
    }
  }

  return { images, unavailable, observations };
}

function observedText(value) {
  const safeJson = JSON.stringify(value, (key, item) => {
    if (typeof item === "string") {
      const privateField =
        /token|secret|authorization|cookie|password|credential|invite(?:url|link)/iu.test(key);

      return privateField ? "［已省略］" : publicText(item, 240);
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((name) => [name, item[name]]),
      );
    }

    return item;
  });

  return safeJson.length > 960 ? safeJson.slice(0, 960) + "…" : safeJson;
}

function observationState(values, targets, expectedByProject) {
  if (!values.every((variant) => variant.length === 1 && variant[0] !== undefined)) {
    return "incomplete";
  }

  if (expectedByProject !== undefined) {
    const expected = expectedByProject ?? {};
    const matched = targets.every(
      ({ project }, index) =>
        Object.hasOwn(expected, project) && isDeepStrictEqual(values[index][0], expected[project]),
    );

    return matched ? "expected" : "different";
  }

  return values.every(([value]) => isDeepStrictEqual(value, values[0][0]))
    ? "matching"
    : "different";
}

function compareObservations(item, evidence, targets) {
  const labels = item.observations ?? {};
  const expectations = item.versionExpectations ?? {};
  const allKeys = evidence.flatMap(({ observations }) => [...observations.keys()]);
  const names = [...new Set([...Object.keys(labels), ...Object.keys(expectations), ...allKeys])];
  return names.map((name) => {
    const values = evidence.map(({ observations }) => observations.get(name) ?? []);
    const state = observationState(values, targets, expectations[name]);
    const label = labels[name] ?? publicText(name);
    const status = {
      matching: "一致",
      different: "已证实差异",
      incomplete: "待验或有冲突",
      expected: "各版结果符合已声明的预期",
    }[state];
    const paragraphs = [
      label + " · " + status,
      ...targets.map((target, index) => {
        const actual = values[index];
        const display = actual.length
          ? actual
              .map((value) => (value === undefined ? "无效 JSON" : observedText(value)))
              .join(" / ")
          : "待验";

        return target.label + " · " + display;
      }),
    ];

    return { state, paragraphs };
  });
}

function arrangeEvidence(evidence) {
  const [left, right] = evidence.map(({ images }) => images);
  const comparisons = [];
  const paired = new Set();
  if (left && right) {
    for (const first of left) {
      if (!first.name.startsWith("scene-")) {
        continue;
      }

      const sameOnLeft = left.filter(({ name }) => name === first.name);
      const sameOnRight = right.filter(({ name }) => name === first.name);
      if (sameOnLeft.length === 1 && sameOnRight.length === 1) {
        const second = sameOnRight[0];
        paired.add(first);
        paired.add(second);
        comparisons.push({ before: first.shot, after: second.shot });
      }
    }
  }

  const images = evidence
    .flatMap(({ images }) => images.filter((image) => !paired.has(image)))
    .map(({ shot }) => shot);

  return { comparisons, images };
}

function statusFor(outcomes, observations) {
  const differs = observations.some(({ state }) => state === "different");
  if (outcomes.includes("failed")) {
    return { status: "partial", statusText: differs ? "失败并发现差异" : "存在失败" };
  }
  if (outcomes.includes("flaky")) {
    return { status: "partial", statusText: "重试中有失败" };
  }
  if (differs) {
    return { status: "partial", statusText: "差异待修" };
  }
  if (observations.some(({ state }) => state === "incomplete")) {
    return { status: "pending", statusText: "观测待验" };
  }

  if (outcomes.every((outcome) => outcome === "passed")) {
    const versionBehavior = observations.some(({ state }) => state === "expected");

    return { status: "done", statusText: versionBehavior ? "版本预期通过" : "对照通过" };
  }

  return { status: "pending", statusText: "尚未覆盖全部版本" };
}

async function reportSection(item, targets, save) {
  const outcomes = targets.map((target) => targetOutcome(item.runs.get(target.project) ?? []));
  const evidence = await Promise.all(
    targets.map((target) => caseEvidence(target, item.runs.get(target.project) ?? [], save)),
  );
  const { comparisons, images } = arrangeEvidence(evidence);
  const observations = compareObservations(item, evidence, targets);
  const result = targets.map((target, index) => target.label + " " + labels[outcomes[index]]);
  const execution = targets.flatMap((target) =>
    (item.runs.get(target.project) ?? []).flatMap((entry) => testRecord(target, entry)),
  );

  const section = {
    title: item.id === item.title ? item.title : item.id + " · " + item.title,
    navTitle: item.id,
    ...statusFor(outcomes, observations),
    summary: ["用例执行情况 " + result.join("，") + "。", item.expected].filter(Boolean),
    comparisons,
    details: {
      summary: "复现路径、执行记录和补充截图",
      paragraphs: [
        ...(item.steps?.length ? ["操作路径 " + item.steps.join(" → ") + "。"] : []),
        ...(item.notes ?? []),
        ...observations.flatMap(({ paragraphs }) => paragraphs),
        ...execution,
        ...evidence.flatMap(({ unavailable }) => unavailable),
      ],
      images,
    },
  };

  return { section, observations };
}

function countOutcomes(cases, target) {
  const counts = { passed: 0, failed: 0, flaky: 0, skipped: 0, missing: 0 };
  for (const item of cases) {
    counts[targetOutcome(item.runs.get(target.project) ?? [])]++;
  }

  return Object.entries(counts)
    .map(([outcome, count]) => labels[outcome] + " " + count)
    .join("，");
}

async function readJson(path) {
  return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/u, ""));
}

async function readCoverage(input, manifestPath) {
  if (input.caseFile !== undefined && input.cases !== undefined) {
    throw new Error("Declare required cases inline or in caseFile.");
  }

  const source = input.caseFile
    ? await readJson(resolve(dirname(manifestPath), input.caseFile))
    : input;

  if (input.caseFile && (!Array.isArray(source.cases) || source.cases.length === 0)) {
    throw new Error("The cases file must declare the expected cases.");
  }

  const cases = new Map();
  const prefix = input.casePrefix ?? source.casePrefix;
  for (const item of source.cases ?? []) {
    if (typeof item.id !== "string" || !item.id || cases.has(item.id)) {
      throw new Error("Declare every required case with a distinct nonempty ID.");
    }
    if (prefix && !item.id.startsWith(prefix)) {
      throw new Error("Required case ID does not match casePrefix: " + item.id);
    }

    cases.set(item.id, { ...item, runs: new Map() });
  }

  return { cases, prefix };
}

async function readRuns(targets, { cases, prefix }) {
  const errors = new Set();
  const results = new Map();
  for (const target of targets) {
    if (!results.has(target.result)) {
      const result = await readJson(target.result);
      if (!Array.isArray(result.suites)) {
        throw new Error("Expected a Playwright JSON report at " + target.result);
      }

      results.set(target.result, result);
    }

    const report = results.get(target.result);
    for (const error of report.errors ?? []) {
      errors.add(errorText(error) || "Playwright 记录了运行错误。");
    }
    for (const entry of testsIn(report.suites, target.project)) {
      const { id, title } = caseIdentity(entry.spec);
      if (prefix && !id.startsWith(prefix)) {
        continue;
      }

      const item = cases.get(id) ?? { id, title, runs: new Map() };
      item.title ??= title;
      const matching = item.runs.get(target.project) ?? [];
      matching.push(entry);
      item.runs.set(target.project, matching);
      cases.set(id, item);
    }
  }

  return errors;
}

async function writeReport(manifestPath, outputPath) {
  const input = await readJson(manifestPath);
  const targets = input.targets.map((target) => ({
    ...target,
    result: resolve(dirname(manifestPath), target.result),
  }));

  if (
    targets.length === 0 ||
    new Set(targets.map(({ project }) => project)).size !== targets.length
  ) {
    throw new Error("Report targets must name distinct Playwright projects.");
  }
  if (targets.some(({ result }) => result === outputPath)) {
    throw new Error("The output report must differ from the Playwright results.");
  }

  const coverage = await readCoverage(input, manifestPath);
  const errors = await readRuns(targets, coverage);
  const items = [...coverage.cases.values()];
  const save = attachmentWriter(outputPath);
  const sections = [];
  const compared = [];
  for (const item of items) {
    item.title ??= item.id;
    const { section, observations } = await reportSection(item, targets, save);
    sections.push(section);
    compared.push(...observations);
  }

  if (errors.size || sections.length === 0) {
    sections.push({
      title: "测试运行状态",
      status: "pending",
      statusText: "需核对",
      summary: errors.size ? [...errors] : "结果中没有匹配到所选项目的测试。",
    });
  }

  const statistics = targets.map((target) => ({
    label: target.label,
    value: countOutcomes(items, target),
  }));
  const summary = statistics.map(({ label, value }) => label + " " + value + "。").join("");
  const different = compared.filter(({ state }) => state === "different").length;
  const incomplete = compared.filter(({ state }) => state === "incomplete").length;
  const expected = compared.filter(({ state }) => state === "expected").length;
  const comparisonSummary = compared.length
    ? "跨版观测 " +
      compared.length +
      " 项，发现差异 " +
      different +
      " 项，待验或有冲突 " +
      incomplete +
      " 项。"
    : "";
  const accepted = sections.every(({ status }) => status === "done");
  let verdict = accepted ? "一致性验收通过。" : "一致性验收未通过。";
  if (accepted && expected > 0) {
    verdict = "共同流程与版本预期验收通过。已验证 " + expected + " 项版本预期差异。";
  }
  const report = {
    project: input.project,
    version: input.version,
    title: input.title,
    date: input.date,
    delivery: input.delivery,
    summary: verdict + summary + comparisonSummary + (errors.size ? "另有测试运行错误。" : ""),
    sections,
    verification: {
      summary: input.scope,
      rows: [
        ...statistics,
        {
          label: "统计口径",
          value: "按场景和版本计数。保留预期失败、重试中的失败、跳过和缺失记录。",
        },
        ...(comparisonSummary ? [{ label: "跨版观测", value: comparisonSummary }] : []),
        ...(input.verification ?? []),
      ],
    },
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n");

  return accepted;
}

async function main() {
  const { positionals, values } = parseArgs({
    options: { strict: { type: "boolean", default: false }, help: { type: "boolean" } },
    allowPositionals: true,
  });

  if (values.help) {
    process.stdout.write(usage + "\n");
    return;
  }

  const [manifestPath, outputPath] = positionals;
  if (positionals.length !== 2) {
    throw new Error(usage);
  }
  if (resolve(manifestPath) === resolve(outputPath)) {
    throw new Error("The output report must differ from its source manifest.");
  }

  const reportIsComplete = await writeReport(resolve(manifestPath), resolve(outputPath));
  if (values.strict && !reportIsComplete) {
    process.exitCode = 1;
  }
}

await main();
