import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBenchmarkComparison } from "./comparison-report.mjs";
import { metrics } from "./results.mjs";

const fixture = {
  profile: "near",
  objects: 2_000,
  archiveSha256: "a".repeat(64),
  geometrySha256: "b".repeat(64),
  imageSha256: "c".repeat(64),
};
const environment = {
  os: "win32 x64",
  cpu: "test CPU",
  logicalCpus: 16,
  ramGiB: 32,
  node: "v24.14.1",
  chromium: "158.0.8127.37",
  channel: "chrome",
  headless: true,
  viewport: { width: 1440, height: 960 },
  dpr: 1,
  timeoutMs: 12_000,
  workers: 1,
  roundsPerCase: 30,
  warmupsPerCase: 2,
};
const scopes = { profile: "near", view: "overview" };
const notes = [
  "浏览器使用同一无头 Chrome 与本机回环服务。冷开和热开分别计时。",
  "交互前通过缩放菜单切到适应白板。",
  "帧间隔是 requestAnimationFrame 回调的采样，慢帧定义为超过 50 ms。",
  "种板、持久位置回读和截图在计时窗之外。",
];

function summary(p95, frames) {
  return {
    attempts: 30,
    validAttempts: 30,
    failures: 0,
    timeouts: 0,
    samples: frames ? 600 : 30,
    p50: p95 * 0.9,
    p95,
    p99: p95 * 1.1,
    worst: p95 * 1.2,
    over50: frames ? 7 : null,
  };
}

function run({ initialValues = {}, iiValues = {} } = {}) {
  const editions = [
    { id: "initial", version: "0.3.2", packageSha256: "d".repeat(64) },
    { id: "ii", version: "1.0.0", packageSha256: "e".repeat(64) },
  ];

  return {
    schema: 1,
    mode: "baseline",
    startedAt: "2026-11-28T04:00:00.000Z",
    finishedAt: "2026-11-28T05:00:00.000Z",
    runtimeVerified: true,
    environment: structuredClone(environment),
    editions,
    fixtures: [{ ...fixture }],
    notes: [...notes],
    cases: editions.map(({ id }) => ({
      ...scopes,
      edition: id,
      expectedRounds: 30,
      warmups: Array.from({ length: 2 }, () => ({})),
      rounds: Array.from({ length: 30 }, () => ({})),
      seed: {
        objects: fixture.objects,
        geometrySha256: fixture.geometrySha256,
        image: { sha256: fixture.imageSha256 },
      },
    })),
    rows: metrics.map((metric) => ({
      ...scopes,
      metric,
      initial: summary(initialValues[metric] ?? 100, metric.endsWith("-frames")),
      ii: summary(iiValues[metric] ?? 100, metric.endsWith("-frames")),
    })),
    screenshots: [],
  };
}

test("uses the freshly measured V1 p95 for the 30 percent target and keeps frame targets separate", () => {
  const before = run({ initialValues: { "drag-latency": 90 }, iiValues: { "drag-latency": 200 } });
  const after = run({
    initialValues: { "pan-frames": 30 },
    iiValues: { "drag-latency": 70, "pan-frames": 50, "zoom-frames": 51 },
  });
  const report = buildBenchmarkComparison(before, after);
  const row = (metric) => report.rows.find((item) => item.metric === metric);

  assert.equal(report.currentComparable, true);
  assert.equal(report.priorComparable, true);
  assert.equal(report.rows.length, 12);
  assert.equal(row("drag-latency").targetMs, 70);
  assert.equal(row("drag-latency").pass30, true);
  assert.equal(row("drag-latency").pass50, null);
  assert.equal(row("drag-latency").deltaInitialMs, -30);
  assert.equal(row("drag-latency").deltaPriorMs, -130);
  assert.equal(row("pan-frames").pass30, false);
  assert.equal(row("pan-frames").pass50, true);
  assert.equal(row("zoom-frames").pass30, true);
  assert.equal(row("zoom-frames").pass50, false);
  assert.equal(row("cold-ready").pass30, null);
});

test("holds historical deltas when archive, environment, or measurement method differ", () => {
  const before = run();
  before.fixtures[0].archiveSha256 = "f".repeat(64);
  before.environment.dpr = 2;
  before.notes[2] = "其他画面探针";
  const report = buildBenchmarkComparison(before, run({ iiValues: { "save-ui": 20 } }));
  const save = report.rows.find(({ metric }) => metric === "save-ui");

  assert.equal(report.currentComparable, true);
  assert.equal(report.priorComparable, false);
  assert.equal(save.pass30, true);
  assert.equal(save.deltaInitialMs, -80);
  assert.equal(save.deltaPriorMs, null);
  assert.ok(report.checks.filter(({ passed }) => passed === false).length >= 3);
});

test("keeps failed metrics and blocks percentage claims when a current sample or fixture is invalid", () => {
  const before = run();
  const after = run();
  const drag = after.rows.find(({ metric }) => metric === "drag-latency");
  Object.assign(drag.ii, { validAttempts: 29, timeouts: 1, samples: 29, p99: "Infinity" });
  const failure = buildBenchmarkComparison(before, after).rows.find(
    ({ metric }) => metric === "drag-latency",
  );

  assert.equal(failure.v2.p99, "Infinity");
  assert.equal(failure.v2.timeouts, 1);
  assert.equal(failure.pass30, null);
  assert.equal(failure.deltaInitialMs, null);
  assert.equal(failure.deltaPriorMs, null);

  after.cases[0].seed.geometrySha256 = "f".repeat(64);
  after.cases[1].rounds.pop();
  const report = buildBenchmarkComparison(before, after);

  assert.equal(report.currentComparable, false);
  assert.equal(report.priorComparable, false);
  assert.equal(report.rows.find(({ metric }) => metric === "pan-latency").pass30, null);
});
