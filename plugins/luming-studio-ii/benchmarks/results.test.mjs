import assert from "node:assert/strict";
import { test } from "node:test";
import { completeSamples, summarize } from "./results.mjs";

test("includes failed and timed-out user actions in nearest-rank latency", () => {
  const summary = summarize("save-ui", [
    { status: "ok", ms: 10 },
    { status: "ok", ms: 30 },
    { status: "failure" },
    { status: "timeout" },
  ]);
  assert.equal(summary.p50, 30);
  assert.equal(summary.p95, "Infinity");
  assert.equal(summary.p99, "Infinity");
  assert.equal(summary.validAttempts, 2);
  assert.equal(summary.failures, 1);
  assert.equal(summary.timeouts, 1);
});

test("keeps frame gaps and reports failed gestures separately from observed intervals", () => {
  const summary = summarize("zoom-frames", [
    { status: "ok", frames: [8, 50, 51, 73] },
    { status: "failure" },
  ]);
  assert.equal(summary.p50, 50);
  assert.equal(summary.p95, 73);
  assert.equal(summary.samples, 4);
  assert.equal(summary.over50, 2);
  assert.equal(summary.failures, 1);
});

test("counts missing, duplicated and invalid measurements as incomplete attempts", () => {
  const results = completeSamples(
    [
      { metric: "drag-latency", status: "ok", ms: 10 },
      { metric: "drag-latency", status: "ok", ms: 20 },
      { metric: "pan-frames", status: "ok", frames: [] },
      { metric: "warm-paint", status: "ok", ms: -1 },
      { metric: "cold-paint", status: "ok", ms: 0 },
    ],
    undefined,
    ["drag-latency", "pan-frames", "warm-paint", "cold-paint", "warm-ready"],
  );
  assert.deepEqual(
    results.map(({ status }) => status),
    ["failure", "failure", "failure", "ok", "failure"],
  );
  assert.equal(results[3].ms, 0);
});
