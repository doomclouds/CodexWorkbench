import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  escapeHtml,
  readBenchmarkScreenshot,
  reportNumber,
  writeBenchmarkPage,
} from "./report.mjs";
import { metrics } from "./results.mjs";

const rounds = 30;
const objectCount = 2_000;
const targetRatio = 0.7;
const frameBudgetMs = 50;
const profile = "near";
const view = "overview";
const editionIds = ["initial", "ii"];
const transportFields = ["node", "chromium", "channel", "headless", "timeoutMs", "workers"];
const machineFields = ["os", "cpu", "logicalCpus", "ramGiB", "dpr"];
const measurementNotes = [
  /浏览器使用/u,
  /交互前通过缩放菜单/u,
  /帧间隔是 requestAnimationFrame/u,
  /种板、持久位置回读/u,
];
const primaryMetrics = new Set([
  "drag-latency",
  "drag-frames",
  "pan-latency",
  "pan-frames",
  "zoom-latency",
  "zoom-frames",
  "save-ui",
]);
const labels = {
  "cold-paint": "冷开首绘",
  "cold-ready": "冷开可操作",
  "warm-paint": "重开首绘",
  "warm-ready": "重开可操作",
  "drag-latency": "拖动首次可见位移",
  "drag-frames": "拖动帧间隔",
  "pan-latency": "平移首次可见位移",
  "pan-frames": "平移帧间隔",
  "zoom-latency": "缩放首次可见变化",
  "zoom-frames": "缩放帧间隔",
  "save-ui": "松手到界面显示「已保存」",
  "save-http": "松手到 HTTP 响应结束",
};
const columns = ["V1 重测", "V2 优化前", "V2 优化后"];
const sources = [
  { filename: "before-results.json", label: "首轮原始 JSON" },
  { filename: "after-results.json", label: "同机复测原始 JSON" },
];
const dateFormat = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  dateStyle: "medium",
  timeStyle: "medium",
});

function scope(record) {
  return record.profile === profile && record.view === view;
}

function edition(run, id) {
  return run.editions.find((item) => item.id === id);
}

function workCases(run) {
  const scenarios = run.cases.filter(scope);

  return editionIds.map((id) => scenarios.find((item) => item.edition === id));
}

function fixture(run) {
  return run.fixtures.find((item) => item.profile === profile);
}

function knownDigest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/iu.test(value);
}

function sameDigest(first, second) {
  return knownDigest(first) && first === second;
}

function matchesSeed(input, scenario) {
  const seed = scenario?.seed;
  const matchesGeometry = sameDigest(input.geometrySha256, seed?.geometrySha256);
  const matchesImage = sameDigest(input.imageSha256, seed?.image?.sha256);

  return seed?.objects === objectCount && matchesGeometry && matchesImage;
}

function hasMatchingSeeds(run) {
  const input = fixture(run);
  if (input?.objects !== objectCount || !knownDigest(input.archiveSha256)) {
    return false;
  }

  return workCases(run).every((scenario) => matchesSeed(input, scenario));
}

function hasPlannedRounds(run) {
  const { roundsPerCase, warmupsPerCase } = run.environment;
  const matchingMode = run.schema === 1 && run.mode === "baseline";
  if (!matchingMode || roundsPerCase !== rounds || !Number.isInteger(warmupsPerCase)) {
    return false;
  }

  return workCases(run).every((scenario) => {
    const expectedRounds = scenario?.expectedRounds === rounds;
    const actualRounds = scenario?.rounds?.length === rounds;
    const warmups = scenario?.warmups?.length === warmupsPerCase;

    return expectedRounds && actualRounds && warmups;
  });
}

function hasVerifiedPackages(run) {
  return (
    run.runtimeVerified === true &&
    editionIds.every((id) => knownDigest(edition(run, id)?.packageSha256))
  );
}

function hasComparableEnvironment(run) {
  const { headless, workers, viewport } = run.environment;
  const knownViewport = Number.isFinite(viewport?.width) && Number.isFinite(viewport?.height);

  return headless === true && workers === 1 && knownViewport;
}

function sameFields(first, second, fields) {
  return fields.every((key) => first[key] !== undefined && first[key] === second[key]);
}

function sameMethods(before, after) {
  return measurementNotes.every((pattern) => {
    const current = after.notes.find((note) => pattern.test(note));
    const prior = before.notes.find((note) => pattern.test(note));

    return typeof current === "string" && current === prior;
  });
}

function compareSetup(before, after) {
  const oldEnv = before.environment;
  const newEnv = after.environment;
  const oldDigest = fixture(before)?.archiveSha256;
  const newDigest = fixture(after)?.archiveSha256;

  return [
    { label: "两版复测导入同一 2,000 对象白板", passed: hasMatchingSeeds(after), current: true },
    { label: "两版复测计时轮次与预热", passed: hasPlannedRounds(after), current: true },
    { label: "复测 Chrome 视口和串行配置", passed: hasComparableEnvironment(after), current: true },
    { label: "复测运行前后包指纹一致", passed: hasVerifiedPackages(after), current: true },
    {
      label: "首轮原白板归档与复测 SHA-256 一致",
      passed: sameDigest(oldDigest, newDigest),
    },
    {
      label: "首轮种板、轮次和指纹验证通过",
      passed: hasMatchingSeeds(before) && hasPlannedRounds(before) && hasVerifiedPackages(before),
    },
    {
      label: "首轮与复测的浏览器、Node.js 和串行配置一致",
      passed: sameFields(oldEnv, newEnv, transportFields),
    },
    {
      label: "首轮与复测的主机、设备像素比和视口一致",
      passed:
        sameFields(oldEnv, newEnv, machineFields) &&
        sameFields(oldEnv.viewport ?? {}, newEnv.viewport ?? {}, ["width", "height"]),
    },
    {
      label: "首轮与复测预热次数一致",
      passed: sameFields(oldEnv, newEnv, ["warmupsPerCase"]),
    },
    { label: "首轮与复测的观测和计时口径一致", passed: sameMethods(before, after) },
    {
      label: "首轮与复测使用同一 V1 发布包",
      passed: sameDigest(
        edition(before, "initial")?.packageSha256,
        edition(after, "initial")?.packageSha256,
      ),
    },
  ];
}

function complete(summary) {
  const hasRounds = summary?.attempts === rounds && summary.validAttempts === rounds;
  if (!hasRounds) {
    return false;
  }

  return summary.failures === 0 && summary.timeouts === 0 && Number.isFinite(summary.p95);
}

function difference(before, after, comparable) {
  if (comparable && complete(before) && complete(after)) {
    return after.p95 - before.p95;
  }

  return null;
}

function target(currentV1, primary, comparable) {
  if (primary && comparable && complete(currentV1)) {
    return currentV1.p95 * targetRatio;
  }

  return null;
}

function metricRow(metric, before, after, currentComparable, priorComparable) {
  const v1 = after?.initial ?? null;
  const prior = before?.ii ?? null;
  const v2 = after?.ii ?? null;
  const primary = primaryMetrics.has(metric);
  const frame = metric.endsWith("-frames");
  const validV2 = currentComparable && complete(v2);
  const targetMs = target(v1, primary, currentComparable);

  return {
    metric,
    v1,
    prior,
    v2,
    primary,
    frame,
    targetMs,
    pass30: targetMs !== null && validV2 ? v2.p95 <= targetMs : null,
    pass50: frame && validV2 ? v2.p95 <= frameBudgetMs : null,
    deltaInitialMs: difference(v1, v2, currentComparable),
    deltaPriorMs: difference(prior, v2, priorComparable),
  };
}

export function buildBenchmarkComparison(before, after) {
  const checks = compareSetup(before, after);
  const currentComparable = checks.filter(({ current }) => current).every(({ passed }) => passed);
  const priorComparable = checks.every(({ passed }) => passed);
  const oldRows = new Map(before.rows.filter(scope).map((row) => [row.metric, row]));
  const newRows = new Map(after.rows.filter(scope).map((row) => [row.metric, row]));
  const rows = metrics.map((metric) =>
    metricRow(metric, oldRows.get(metric), newRows.get(metric), currentComparable, priorComparable),
  );

  return { rows, checks, currentComparable, priorComparable };
}

function stats(summary, label, frame) {
  const title = `<td class="percentiles" data-edition="${label}">`;
  if (!summary) {
    return `${title}—</td>`;
  }

  const { p50, p95, p99, attempts, validAttempts, failures, timeouts, samples, over50 } = summary;
  const slowRate = samples > 0 ? (over50 / samples) * 100 : 0;
  const counts = frame
    ? `${reportNumber(over50)}/${reportNumber(samples)} 慢帧（${reportNumber(slowRate)}%）`
    : `${reportNumber(samples)} 个有效样本`;

  return `${title}${reportNumber(p50)} / <strong>${reportNumber(p95)}</strong> / ${reportNumber(p99)}
    <small>${reportNumber(validAttempts)}/${reportNumber(attempts)} 轮 · ${reportNumber(failures)} 失败 · ${reportNumber(timeouts)} 超时</small>
    <small>${counts}</small></td>`;
}

function renderDelta(delta, summary, label) {
  const title = `<td class="delta" data-detail="${label}">`;
  if (delta === null) {
    return `${title}—</td>`;
  }

  const sign = delta > 0 ? "+" : "";
  const color = { "-1": "comparison-lower", 1: "comparison-higher" }[Math.sign(delta)] ?? "";
  const percent = summary.p95 > 0 ? `${sign}${reportNumber((delta / summary.p95) * 100)}%` : "—";

  return `${title}<span class="${color}">${sign}${reportNumber(delta)} ms<small>${percent}</small></span></td>`;
}

function targetStatus(pass, label) {
  const messages = { true: "达标", false: "未达标", null: "待验证" };
  const className = { true: "pass", false: "miss", null: "pending" };

  return `<span class="target-status ${className[pass]}">${label} · ${messages[pass]}</span>`;
}

function tableRow(record) {
  const { metric, v1, prior, v2, frame, primary, targetMs, pass30, pass50 } = record;
  const targetLabel = targetMs === null ? "30%" : `30%（≤ ${reportNumber(targetMs)} ms）`;
  const goal = primary ? targetStatus(pass30, targetLabel) : "";
  const frames = frame ? targetStatus(pass50, "20 Hz（≤ 50 ms）") : "";

  return `<tr><th scope="row">${labels[metric]}</th>
    ${stats(v1, columns[0], frame)}${stats(prior, columns[1], frame)}${stats(v2, columns[2], frame)}
    ${renderDelta(record.deltaInitialMs, v1, "较 V1 重测")}${renderDelta(record.deltaPriorMs, prior, "较 V2 优化前")}
    ${primary ? `<td class="targets">${goal}${frames}</td>` : ""}</tr>`;
}

function table(rows, primary) {
  const headings = columns.map(
    (label) => `<th scope="col">${label}<small>p50 / p95 / p99</small></th>`,
  );

  return `<table class="measurement comparison-metrics"><thead><tr><th scope="col">观测项</th>
    ${headings.join("")}<th scope="col">较 V1</th><th scope="col">较优化前</th>
    ${primary ? '<th scope="col">p95 目标</th>' : ""}</tr></thead>
    <tbody>${rows.map(tableRow).join("\n")}</tbody></table>`;
}

function achieved(rows, field) {
  return rows.filter((record) => record[field] === true).length;
}

function summaryText(comparison) {
  const primary = comparison.rows.filter(({ primary }) => primary);
  const frames = primary.filter(({ frame }) => frame);
  const gains = achieved(primary, "pass30");
  const frameGoals = achieved(frames, "pass50");
  if (!comparison.currentComparable) {
    return "2,000 对象整板视角。复测的可比条件有待确认，详见下方核对记录。";
  }

  const skipped = primary.filter(({ pass30 }) => pass30 === null).length;
  const pending = skipped > 0 ? `计时样本需要复核的主要指标有 ${skipped} 项。` : "";

  return `2,000 对象整板视角。V2 优化后，${gains}/${primary.length} 项主要指标达到 V1 重测 p95 的 70% 以内，${frameGoals}/${frames.length} 项帧间隔 p95 达到 50 ms 预算。${pending}`;
}

function section(title, explanation, rows, primary) {
  const observationsComplete = rows.every((row) => [row.v1, row.prior, row.v2].every(complete));
  const primaryGoalsMet = rows.every(({ pass30, frame, pass50 }) => pass30 && (!frame || pass50));
  const passed = primary ? primaryGoalsMet && observationsComplete : observationsComplete;
  const index = primary ? 0 : 1;

  return {
    title,
    summary: [explanation, `BENCHMARK_MEASUREMENTS_${index}`],
    status: passed ? "done" : "partial",
    statusText: passed ? "已验证" : "见逐项状态",
    data: table(rows, primary),
  };
}

function runLine(run, editionId, label) {
  const build = edition(run, editionId);
  const { viewport, dpr, node, chromium } = run.environment;
  const when = dateFormat.format(new Date(run.finishedAt));
  const info = `${viewport?.width} × ${viewport?.height} · DPR ${dpr} · Chrome ${chromium} · Node.js ${node}`;

  return {
    label,
    value: `${when} · ${build?.version} · ${info} · 运行包 SHA-256 ${build?.packageSha256}`,
  };
}

function archiveLine(run, label) {
  const input = fixture(run);

  return {
    label,
    value: `${reportNumber(input?.archiveBytes)} 字节 · SHA-256 ${input?.archiveSha256}`,
  };
}

function verification(comparison, before, after, qa) {
  const config = comparison.checks.map(({ label, passed }) => ({
    label,
    value: passed ? "已核对" : "需复核",
  }));
  const runEnv = after.environment;
  const rounds = `每版 ${runEnv.roundsPerCase} 轮，预热 ${runEnv.warmupsPerCase} 轮`;

  return {
    summary: [
      "主要指标的 30% 目标按 V2 优化后 p95 ≤ 0.70 × 同时重测的 V1 p95 判断。20 Hz 的 50 ms 帧间隔预算独立判断。p95 降幅用各自的原始 p95 计算。",
      "开板沿用各版本的默认相机。拖动、平移和缩放从适应整板开始。帧间隔采样采用 requestAnimationFrame，慢帧为超过 50 ms 的有效间隔。",
      "HTTP 项为松手到网络响应结束，V1 观测 artifact_apply，V2 观测 MoveObjects。界面保存、网络回执和持久位置回读是三个不同检查点。",
      "同机浏览器在无头模式下访问本机回环服务。实际显示器刷新、Codex 宿主和跨设备网络的性能需要另外采集。",
      ...(qa.notes ?? []),
    ],
    rows: [
      {
        label: "本轮机器",
        value: `${runEnv.os} · ${runEnv.cpu} · ${runEnv.ramGiB} GiB · ${rounds}`,
      },
      runLine(after, "initial", columns[0]),
      runLine(before, "ii", columns[1]),
      runLine(after, "ii", columns[2]),
      archiveLine(before, "首轮白板归档"),
      archiveLine(after, "复测白板归档"),
      ...config,
      ...(qa.checks ?? []),
    ],
  };
}

function shotFor(run, directory, id, label) {
  const shot = run.screenshots.filter(scope).find(({ edition }) => edition === id);
  if (!shot) {
    return undefined;
  }

  return readBenchmarkScreenshot(directory, shot, run.fixtures, label);
}

async function inputs(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function copySource(source, destination) {
  if (resolve(source) !== resolve(destination)) {
    await copyFile(source, destination);
  }
}

export async function writeBenchmarkComparisonReport(previous, current, directory, qa = {}) {
  const [before, after] = await Promise.all([inputs(previous), inputs(current)]);
  const comparison = buildBenchmarkComparison(before, after);
  const pictures = await Promise.all([
    shotFor(after, dirname(current), "initial", columns[0]),
    shotFor(before, dirname(previous), "ii", columns[1]),
    shotFor(after, dirname(current), "ii", columns[2]),
  ]);
  const actualPictures = pictures.filter(Boolean);
  const mainRows = comparison.rows.filter(({ primary }) => primary);
  const supporting = comparison.rows.filter(({ primary }) => !primary);
  const sections = [
    section(
      "主要指标",
      "单位为毫秒，负差值代表耗时下降。失败和超时会保留在计数，缺少完整样本的比较以短横线表示。",
      mainRows,
      true,
    ),
    section(
      "开板与网络回执",
      "辅助观测用于理解开板、保存网络和界面确认的变化。",
      supporting,
      false,
    ),
  ];
  const allPictures = actualPictures.length === columns.length;
  sections.push({
    title: "同场景实测截图",
    summary: "使用各次运行计时结束后采集的整板截图。",
    status: allPictures ? "done" : "partial",
    statusText: `${actualPictures.length}/${columns.length} 张`,
    images: actualPictures,
  });
  const report = {
    project: "Luming Studio II",
    title: "整板交互性能三版对照",
    summary: summaryText(comparison),
    delivery: comparison.priorComparable
      ? "V1 重测与 V2 优化后来自同一次运行，V2 优化前沿用首轮的整板数据。"
      : "V1 重测与 V2 优化后来自同一次运行。首轮条件差异已标注，历史数值供参考。",
    sections,
    verification: verification(comparison, before, after, qa),
    date: dateFormat.format(new Date(after.finishedAt)),
  };
  await mkdir(directory, { recursive: true });
  await Promise.all([
    copySource(previous, join(directory, sources[0].filename)),
    copySource(current, join(directory, sources[1].filename)),
  ]);
  const css = await readFile(new URL("./comparison-report.css", import.meta.url), "utf8");

  return writeBenchmarkPage(report, directory, sources, css);
}

async function main(args) {
  const [before, after, directory, qaFile] = args;
  if (args.length < 3 || args.length > 4) {
    throw new Error(
      "Usage: node benchmarks/comparison-report.mjs <before-results.json> <after-results.json> <report-directory> [qa.json]",
    );
  }

  const qa = qaFile ? await inputs(qaFile) : {};
  const output = await writeBenchmarkComparisonReport(before, after, directory, qa);
  process.stdout.write(`${output}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main(process.argv.slice(2));
}
