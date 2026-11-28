import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { initialRootVariable } from "../e2e/support/initial-baseline.mjs";
import { launchStudio } from "../e2e/support/runtime.mjs";
import { measureRound } from "./browser/driver.mjs";
import { makeBenchmarkFixture, seedBenchmarkBoard } from "./fixtures.mjs";
import { createRetainedTransport } from "./fixtures/retained-transport.mjs";
import { writeBenchmarkReport } from "./report.mjs";
import { comparisonRows, completeSamples, metrics } from "./results.mjs";
import { retainedMetrics, runRetainedCase } from "./retained.mjs";
import { fingerprintRuntime } from "./runtime.mjs";

const pluginRoot = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const profiles = ["small", "near"];
const browserViews = ["normal", "overview"];
const views = [...browserViews, "retained"];
const browserOptions = { channel: "chrome", headless: true };
const contextOptions = {
  viewport: { width: 1440, height: 960 },
  deviceScaleFactor: 1,
  colorScheme: "dark",
  locale: "zh-CN",
  timezoneId: "Asia/Shanghai",
  reducedMotion: "no-preference",
};
const timeout = 12_000;

function parseCount(text, minimum, name) {
  const count = Number(text);
  if (!Number.isSafeInteger(count) || count < minimum) {
    throw new Error(`${name} must be an integer of at least ${minimum}.`);
  }

  return count;
}

function parseChoices(values, supported, name) {
  if (values?.some((value) => !supported.includes(value))) {
    throw new Error(`${name} must use ${supported.join(" or ")}.`);
  }

  return values ? [...new Set(values)] : supported;
}

function options() {
  const { values } = parseArgs({
    options: {
      "initial-root": { type: "string" },
      rounds: { type: "string" },
      warmups: { type: "string" },
      smoke: { type: "boolean" },
      profile: { type: "string", multiple: true },
      view: { type: "string", multiple: true },
    },
  });
  const smoke = values.smoke ?? false;
  const initial = values["initial-root"];
  const selectedProfiles = parseChoices(values.profile, profiles, "profile");
  const defaultViews = smoke || !selectedProfiles.includes("small") ? browserViews : views;

  return {
    mode: smoke ? "smoke" : "baseline",
    rounds: parseCount(values.rounds ?? (smoke ? "1" : "30"), 1, "rounds"),
    warmups: parseCount(values.warmups ?? (smoke ? "0" : "2"), 0, "warmups"),
    profiles: selectedProfiles,
    views: values.view ? parseChoices(values.view, views, "view") : defaultViews,
    initialRoot: initial ? resolve(initial) : undefined,
  };
}

async function editionFingerprints(initialRoot) {
  const ii = await fingerprintRuntime("ii", pluginRoot);

  return initialRoot ? [await fingerprintRuntime("initial", initialRoot), ii] : [ii];
}

function environment(browser, settings) {
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();

  return {
    gitRevision: revision,
    os: `${platform()} ${release()} (${arch()})`,
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    ramGiB: Math.round((totalmem() / 2 ** 30) * 10) / 10,
    node: process.version,
    chromium: browser.version(),
    channel: browserOptions.channel,
    headless: browserOptions.headless,
    viewport: contextOptions.viewport,
    dpr: contextOptions.deviceScaleFactor,
    timeoutMs: timeout,
    workers: 1,
    roundsPerCase: settings.rounds,
    warmupsPerCase: settings.warmups,
  };
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function checkPosition(previous, next, expected) {
  const actual = { x: next.x - previous.x, y: next.y - previous.y };
  const distance = Math.hypot(actual.x, actual.y);
  const expectedDistance = Math.hypot(expected?.x ?? 0, expected?.y ?? 0);
  const discrepancy = Math.hypot(actual.x - (expected?.x ?? 0), actual.y - (expected?.y ?? 0));
  const tolerance = Math.max(3, expectedDistance * 0.04);
  const matches = expectedDistance > 0 && discrepancy <= tolerance;
  const advanced = next.revision > previous.revision;

  return { passed: advanced && distance > 0.25 && matches, previous, next, actual, expected };
}

async function verifyPosition(board, previous, observation) {
  try {
    return checkPosition(previous, await board.readTarget(), observation?.dragDelta);
  } catch (error) {
    return { passed: false, previous, error: errorText(error) };
  }
}

function verifySaveSamples(samples, check) {
  if (check.passed) {
    return;
  }

  for (const sample of samples) {
    if (sample.metric.startsWith("save-") && sample.status === "ok") {
      sample.status = "failure";
      sample.error =
        check.error ?? "The final object geometry or saved revision did not match the drag.";
    }
  }
}

async function resetPosition(transport, board, initial, last) {
  const dx = initial.x - last.x;
  const dy = initial.y - last.y;
  if (!dx && !dy) {
    return last;
  }

  const receipt = await transport.write({
    boardId: board.id,
    commandId: randomUUID(),
    revision: last.revision,
    work: { kind: "move", object: { ...last, id: board.targetId }, dx, dy },
  });
  const saved = await board.readTarget();
  const offset = Math.hypot(saved.x - initial.x, saved.y - initial.y);
  if (offset > 0.01 || saved.revision !== receipt.revision) {
    throw new Error("The next round's synthetic target did not return to the seed position.");
  }

  return saved;
}

async function capture(page, directory, label, group) {
  const file = `screenshots/${label}.png`;
  try {
    await page.screenshot({ path: join(directory, file), timeout: 8_000 });
    return { edition: group.edition, profile: group.profile, view: group.view, file };
  } catch (error) {
    group.evidenceError = errorText(error);
    return undefined;
  }
}

async function runAttempt({ browser, board, homeUrl, group, previous, index, directory }) {
  const context = await browser.newContext(contextOptions);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    page.setDefaultNavigationTimeout(timeout);
    const direction = index % 2 === 0 ? -1 : 1;
    let measurement;
    let measurementError;
    try {
      measurement = await measureRound({
        page,
        homeUrl,
        board,
        edition: group.edition,
        view: group.view,
        direction,
      });
    } catch (error) {
      measurementError = error;
    }

    const samples = completeSamples(measurement?.samples ?? [], measurementError);
    const verification = await verifyPosition(board, previous, measurement?.observation);
    verifySaveSamples(samples, verification);
    const label = [group.edition, group.profile, group.view].join("-");
    const screenshot = directory ? await capture(page, directory, label, group) : undefined;

    return {
      index,
      direction,
      samples,
      observation: measurement?.observation,
      verification,
      screenshot,
    };
  } finally {
    await context.close();
  }
}

async function runCase({ browser, fixture, edition, view, settings, directory, stopping }) {
  const group = {
    edition,
    profile: fixture.profile,
    view,
    expectedRounds: settings.rounds,
    warmups: [],
    rounds: [],
  };

  if (view === "retained") {
    group.metrics = retainedMetrics;
  }

  const label = `${edition} / ${fixture.profile} / ${view}`;
  let runtime;
  try {
    runtime = await launchStudio(edition);
    if (view === "retained") {
      const { rounds, warmups } = settings;
      const outcome = await runRetainedCase({
        edition,
        runtime,
        fixture,
        rounds,
        warmups,
        stopping,
      });
      process.stdout.write(`${label} ${outcome.rounds.length}/${rounds}\n`);

      return { ...group, ...outcome };
    }

    const board = await seedBenchmarkBoard(edition, runtime, fixture);
    group.seed = board.verification;
    const initial = await board.readTarget();
    const transport = createRetainedTransport(edition, runtime, stopping);
    let previous = initial;
    for (let index = 1 - settings.warmups; index <= settings.rounds; index++) {
      stopping.throwIfAborted();
      const evidence = index === settings.rounds ? directory : undefined;
      const attempt = await runAttempt({
        browser,
        board,
        homeUrl: runtime.url,
        group,
        previous,
        index,
        directory: evidence,
      });
      previous = attempt.verification.next ?? previous;
      const phase = index < 1 ? group.warmups : group.rounds;
      phase.push(attempt);
      if (index < settings.rounds) {
        previous = await resetPosition(transport, board, initial, previous);
        attempt.nextRoundPosition = previous;
      }

      const errors = attempt.samples.filter(({ status }) => status !== "ok");
      if (errors.length) {
        process.stderr.write(
          `${label} #${index}: ${JSON.stringify(errors.map(({ metric, error }) => ({ metric, error })))}\n`,
        );
      } else if (index === 1 || index % 5 === 0 || evidence) {
        process.stdout.write(`${label} ${index}/${settings.rounds}\n`);
      }
    }
  } catch (error) {
    group.error = errorText(error);
    process.stderr.write(`${label}: ${group.error}\n`);
  } finally {
    await runtime?.close();
  }

  return group;
}

function fixtureSummary(fixture) {
  return {
    profile: fixture.profile,
    title: fixture.title,
    objects: fixture.objects,
    archiveSha256: fixture.archiveSha256,
    archiveBytes: fixture.archive.byteLength,
    geometrySha256: fixture.geometrySha256,
    objectKinds: fixture.objectKinds,
    historyVersions: fixture.historyVersions,
    worldBounds: fixture.worldBounds,
    imageBytes: fixture.imageBytes,
    imageSha256: fixture.imageSha256,
  };
}

function hasFailures(results, expected) {
  if (results.error || !results.runtimeVerified) {
    return true;
  }

  return results.cases.some(({ error, rounds, metrics: caseMetrics }) => {
    if (error || rounds.length !== expected) {
      return true;
    }

    return rounds.some(({ samples }) => {
      const complete = samples.length === (caseMetrics ?? metrics).length;

      return !complete || samples.some(({ status }) => status !== "ok");
    });
  });
}

async function saveResults(directory, results) {
  await writeFile(join(directory, "results.json"), JSON.stringify(results, null, 2) + "\n");
}

function createWorkloads(settings) {
  const visibleViews = settings.views.filter((view) => view !== "retained");
  const retained = settings.views.includes("retained");
  const visibleProfiles = visibleViews.length ? settings.profiles : [];
  const sourceProfiles = new Set(retained ? [...visibleProfiles, "small"] : visibleProfiles);
  const fixtures = Array.from(sourceProfiles, (profile) => makeBenchmarkFixture(profile));
  const cases = fixtures
    .filter(({ profile }) => visibleProfiles.includes(profile))
    .flatMap((fixture) => visibleViews.map((view) => ({ fixture, view })));

  if (retained) {
    const fixture = fixtures.find(({ profile }) => profile === "small");
    cases.push({ fixture, view: "retained" });
  }

  return { fixtures, cases };
}

async function run() {
  const settings = options();
  if (settings.initialRoot) {
    process.env[initialRootVariable] = settings.initialRoot;
  }

  const editions = await editionFingerprints(settings.initialRoot);
  const version = editions.at(-1).version;
  const root = join(repositoryRoot, "artifacts", "luming-studio-ii", `v${version}`, "benchmarks");
  const startedAt = new Date().toISOString();
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(
    join(root, `${settings.mode}-${startedAt.replace(/[^\dT]/gu, "")}-`),
  );
  await mkdir(join(directory, "screenshots"));
  process.stdout.write(`Benchmark output: ${directory}\n`);
  const { fixtures, cases: workloads } = createWorkloads(settings);
  const browser = await chromium.launch(browserOptions);
  const results = {
    schema: 1,
    startedAt,
    mode: settings.mode,
    environment: environment(browser, settings),
    editions,
    fixtures: fixtures.map(fixtureSummary),
    cases: [],
    rows: [],
    screenshots: [],
    notes: [
      "两个版本串行运行，按视口交替执行顺序。每个版本、数据档和视口使用独立临时数据目录。",
      "浏览器使用同一无头 Chrome 与本机回环服务，通过现有 E2E 本地代理访问发布包。冷开重建浏览器上下文，服务保持运行。热开在同一上下文返回工作台后重开。",
      "两组开板都从真实工作台按应用默认相机进入。交互前通过缩放菜单切到 100% 或适应白板。原始数据记录了两代实际相机和持久化位移。",
      "历史档从同一 100 对象合成板通过公开写入填到 200 版。移动、改字和新增分别从发出 HTTP 请求计时到完整解码回执。填窗、历史及结果回读都在计时外。",
      "帧间隔是 requestAnimationFrame 回调的采样，慢帧定义为超过 50 ms。失败与超时保留在原始结果中，时延分位按无穷值占位，帧分位使用观察到的有效间隔。",
      "种板、持久位置回读、下一轮坐标复位和截图都在计时窗之外。报表的限制包括无头运行、单机和本机网络。",
      "这是基线采集，记录可观察差异与波动。正式性能门槛将在重复同机运行后设定。",
    ],
  };
  const controller = new AbortController();
  const stop = () => controller.abort(new Error("Benchmark interrupted."));
  process.once("SIGINT", stop);
  try {
    for (const [position, { fixture, view }] of workloads.entries()) {
      const sequence = position % 2 === 0 ? editions : editions.toReversed();
      for (const { id: edition } of sequence) {
        controller.signal.throwIfAborted();
        const group = await runCase({
          browser,
          fixture,
          edition,
          view,
          settings,
          directory,
          stopping: controller.signal,
        });
        results.cases.push(group);
        results.rows = comparisonRows(results.cases);
        results.screenshots.push(
          ...group.rounds.flatMap(({ screenshot }) => (screenshot ? [screenshot] : [])),
        );
        await saveResults(directory, results);
      }
    }
  } catch (error) {
    results.error = errorText(error);
    process.stderr.write(`${results.error}\n`);
  } finally {
    process.off("SIGINT", stop);
    await browser.close();
  }

  const fingerprints = await editionFingerprints(settings.initialRoot);
  results.runtimeVerified = fingerprints.every(
    ({ packageSha256 }, index) => packageSha256 === editions[index].packageSha256,
  );
  results.finishedAt = new Date().toISOString();
  await saveResults(directory, results);
  await writeBenchmarkReport(results, directory);
  process.stdout.write(`Benchmark report: ${join(directory, "report.html")}\n`);
  process.exitCode = hasFailures(results, settings.rounds) ? 1 : 0;
}

await run();
