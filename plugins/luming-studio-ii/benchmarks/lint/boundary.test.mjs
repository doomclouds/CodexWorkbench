import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const cwd = fileURLToPath(new URL("../../", import.meta.url));
const overrideConfigFile = fileURLToPath(new URL("../eslint.config.mjs", import.meta.url));
const eslint = new ESLint({ cwd, overrideConfigFile });
const driver = "benchmarks/browser/driver.mjs";
const observer = "benchmarks/browser/observe.mjs";

async function rules(text, filePath) {
  const [result] = await eslint.lintText(text, { filePath });

  return result.messages.map(({ ruleId }) => ruleId);
}

test("permits real input, page observation and isolated fixture setup in their respective modules", async () => {
  assert.deepEqual(await rules("await page.mouse.move(100, 200);", driver), []);
  assert.deepEqual(
    await rules(
      'await page.evaluate(() => document.querySelector("main")?.getBoundingClientRect());',
      observer,
    ),
    [],
  );
  assert.deepEqual(
    await rules('import { launchStudio } from "../e2e/support/runtime.mjs";', "benchmarks/run.mjs"),
    [],
  );
});

test("rejects production internals and a source dependency on the archived edition", async () => {
  for (const source of ["../apps/server/src/index.ts", "../../luming-studio/benchmarks/seed.mjs"]) {
    assert.deepEqual(await rules(`import ${JSON.stringify(source)};`, "benchmarks/run.mjs"), [
      "no-restricted-imports",
    ]);
  }
});

test("rejects fixture imports, direct requests, mocked routes, fixed waits and synthetic input in measured flows", async () => {
  assert.deepEqual(await rules('import "../fixtures.mjs";', driver), ["no-restricted-imports"]);
  for (const snippet of [
    'await fetch("http://localhost");',
    'await page.request.post("/api/save");',
    'await page.route("**/*", handler);',
    "await page.waitForTimeout(500);",
    'await target.dispatchEvent("pointerdown");',
    "await page.evaluate(callback);",
  ]) {
    assert.deepEqual(await rules(snippet, driver), ["no-restricted-syntax"]);
  }
});

test("rejects DOM mutation and direct requests inside browser observers", async () => {
  for (const snippet of [
    'await page.evaluate(() => { document.body.innerHTML = ""; });',
    'await page.evaluate(() => document.body.setAttribute("a", "b"));',
    'await page.evaluate(() => fetch("/api"));',
  ]) {
    assert.deepEqual(await rules(snippet, observer), ["no-restricted-syntax"]);
  }
});
