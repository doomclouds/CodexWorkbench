import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const converter = fileURLToPath(new URL("./report.mjs", import.meta.url));
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7loAAAAASUVORK5CYII=",
  "base64",
);

function attempt(status, attachments = [], error) {
  return { status, attachments, errors: error ? [{ message: error }] : [] };
}

function execution(projectName, results, status = "expected", expectedStatus = "passed") {
  return { projectName, results, status, expectedStatus };
}

async function reportDirectory(t) {
  const temp = resolve(tmpdir());
  const directory = await mkdtemp(join(temp, "studio-e2e-report-"));
  assert.equal(dirname(directory), temp);
  t.after(() => rm(directory, { recursive: true, force: true }));

  return directory;
}

test("keeps actual failures, retries and missing coverage visible in the offline report", async (t) => {
  const directory = await reportDirectory(t);
  const screenshot = { name: "scene-dialog", contentType: "image/png" };
  const pass = [
    execution("initial", [attempt("passed", [{ ...screenshot, body: png.toString("base64") }])]),
    execution("ii", [attempt("passed", [{ ...screenshot, path: "shot.png" }])]),
  ];
  const initialFails = execution(
    "initial",
    [attempt("failed", [], "Expected an element at https://private.invalid/guest?token=example")],
    "expected",
    "failed",
  );
  const retries = execution("initial", [attempt("timedOut"), attempt("passed")], "flaky");
  const results = {
    suites: [
      {
        suites: [
          {
            specs: [
              { title: "[A] 同一检查点", tests: pass },
              {
                title: "[B] 预期失败仍是失败",
                tests: [
                  initialFails,
                  execution("ii", [attempt("passed", [{ ...screenshot, path: "absent.png" }])]),
                ],
              },
              {
                title: "[C] 重试与跳过",
                tests: [retries, execution("ii", [attempt("skipped")], "skipped", "skipped")],
              },
            ],
          },
        ],
      },
    ],
    errors: [{ message: "Unexpected worker termination" }],
  };
  const manifest = {
    project: "Studio",
    title: "验收",
    scope: "测试样板",
    targets: [
      { project: "initial", label: "初代", result: "results.json" },
      { project: "ii", label: "Studio II", result: "results.json" },
    ],
    caseFile: "coverage.json",
  };
  await Promise.all([
    writeFile(join(directory, "shot.png"), png),
    writeFile(join(directory, "results.json"), JSON.stringify(results)),
    writeFile(join(directory, "manifest.json"), JSON.stringify(manifest)),
    writeFile(
      join(directory, "coverage.json"),
      JSON.stringify({
        cases: [{ id: "D", title: "未执行", steps: ["打开页面"] }],
      }),
    ),
  ]);

  const output = join(directory, "report.json");
  execFileSync(process.execPath, [converter, join(directory, "manifest.json"), output]);
  const converted = await readFile(output, "utf8");
  const report = JSON.parse(converted);
  const byId = new Map(report.sections.map((section) => [section.navTitle, section]));

  assert.equal(byId.get("A").status, "done");
  const [comparison] = byId.get("A").comparisons;
  assert.deepEqual(await readFile(resolve(directory, comparison.before.path)), png);
  assert.deepEqual(await readFile(resolve(directory, comparison.after.path)), png);
  assert.equal(byId.get("B").status, "partial");
  assert.match(byId.get("B").summary[0], /初代 失败.*Studio II 通过/u);
  assert.match(byId.get("B").details.paragraphs.join(" "), /附件无法读取/u);
  assert.equal(byId.get("C").status, "partial");
  assert.match(byId.get("C").details.paragraphs.join(" "), /超时 → 通过/u);
  assert.equal(byId.get("D").status, "pending");
  assert.match(byId.get("D").details.paragraphs[0], /打开页面/u);
  assert.equal(report.sections.at(-1).status, "pending");
  assert.match(report.summary, /初代 通过 1，失败 1，重试中有失败 1，跳过 0，未执行 1/u);
  assert.doesNotMatch(converted, /private\.invalid|token=example/u);
});

test("compares JSON values structurally and writes a report before returning strict failure", async (t) => {
  const directory = await reportDirectory(t);
  function observation(value) {
    return {
      name: "parity-page",
      contentType: "application/json",
      body: Buffer.from(JSON.stringify(value)).toString("base64"),
    };
  }
  function spec(id, initial, ii) {
    return {
      title: "[" + id + "] 比较",
      tests: [
        execution("initial", [attempt("passed", initial)]),
        execution("ii", [attempt("passed", ii)]),
      ],
    };
  }

  const results = {
    suites: [
      {
        specs: [
          spec(
            "A",
            [observation({ page: 30, selection: null })],
            [observation({ selection: null, page: 30 })],
          ),
          spec("B", [observation({ page: 60 })], [observation({ page: 30 })]),
          spec("C", [observation(null)], []),
          spec("D", [], []),
          spec("E", [{ ...observation(null), body: "this is not JSON" }], [observation(null)]),
        ],
      },
    ],
  };
  const manifest = {
    project: "Studio",
    title: "验收",
    scope: "测试样板",
    targets: [
      { project: "initial", label: "初代", result: "results.json" },
      { project: "ii", label: "Studio II", result: "results.json" },
    ],
    cases: [{ id: "D", observations: { "parity-other": "待补观测" } }],
  };
  await Promise.all([
    writeFile(join(directory, "results.json"), JSON.stringify(results)),
    writeFile(join(directory, "manifest.json"), JSON.stringify(manifest)),
  ]);

  const output = join(directory, "report.json");
  const result = spawnSync(process.execPath, [
    converter,
    "--strict",
    join(directory, "manifest.json"),
    output,
  ]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.toString(), "");
  const report = JSON.parse(await readFile(output, "utf8"));
  const byId = new Map(report.sections.map((section) => [section.navTitle, section]));
  assert.equal(byId.get("A").status, "done");
  assert.equal(byId.get("A").statusText, "对照通过");
  assert.equal(byId.get("B").statusText, "差异待修");
  assert.equal(byId.get("C").statusText, "观测待验");
  assert.equal(byId.get("D").statusText, "观测待验");
  assert.equal(byId.get("E").statusText, "观测待验");
  assert.match(
    byId.get("B").details.paragraphs.join(" "),
    /初代 · \{"page":60\} Studio II · \{"page":30\}/u,
  );
  assert.match(report.summary, /^一致性验收未通过。/u);
  assert.match(report.summary, /发现差异 1 项，待验或有冲突 3 项/u);
});
