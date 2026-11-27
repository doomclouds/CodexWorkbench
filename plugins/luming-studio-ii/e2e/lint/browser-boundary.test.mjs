import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const root = fileURLToPath(new URL("../", import.meta.url));
const configuration = fileURLToPath(new URL("../eslint.config.mjs", import.meta.url));
const eslint = new ESLint({ cwd: root, overrideConfigFile: configuration });
const spec = "recycle-bin/rule-example.spec.mjs";
const boundary = "browser/user-flow-boundary";
const fixture = "import { test, expect, screenshot } from '../support/studio.mjs';\n";

function scenario(actions) {
  return (
    fixture +
    "\n" +
    "test('recycle bin', async ({ page, studio }, testInfo) => {\n" +
    actions +
    "\n});\n"
  );
}

async function messages(text, filePath = spec) {
  const [result] = await eslint.lintText(text, { filePath });
  return result.messages;
}

test("allows semantic browser actions, fixture startup and attached screenshot evidence", async () => {
  const actions = [
    "  const [board] = await studio.seedBoards([{ title: 'Archive' }]);",
    "  await page.goto(studio.url);",
    "  const row = page.getByRole('article').filter({ has: page.getByText(board.title) });",
    "  await row.getByLabel('Select').check();",
    "  const bounds = await page.getByTestId('canvas').boundingBox();",
    "  await page.mouse.click(bounds.x, bounds.y);",
    "  await page.keyboard.press('Escape');",
    "  await page.setViewportSize({ width: 390, height: 760 });",
    "  await expect(row.getByRole('checkbox')).toHaveJSProperty('indeterminate', true);",
    "  await page.goBack();",
    "  await page.goForward();",
    "  await page.reload();",
    "  const secondTab = await page.context().newPage();",
    "  await secondTab.goto(board.url);",
    "  await secondTab.close();",
    "  await studio.restart();",
    "  const { url: home } = studio;",
    "  await page.goto(home);",
    "  await screenshot(page, testInfo, 'recycle-' + testInfo.project.name);",
  ].join("\n");
  assert.deepEqual(await messages(scenario(actions)), []);
});

test("allows a helper to open a fixture board by its assigned URL", async () => {
  const text =
    fixture +
    "\n" +
    "async function openBoard(page, board) {\n" +
    "  await page.goto(board.url);\n" +
    "}\n\n" +
    "test('opens a saved board', async ({ page, studio }) => {\n" +
    "  const [entry] = await studio.seedBoards([{ title: 'Saved' }]);\n" +
    "  await openBoard(page, entry);\n" +
    "});\n";
  assert.deepEqual(await messages(text), []);
});

test("allows the same fixture entry from another feature directory", async () => {
  assert.deepEqual(await messages(fixture, "whiteboard/title.spec.mjs"), []);
});

test("allows semantic focus and observed values from the Studio fixture", async () => {
  const text =
    "import { test, focused, observe } from '../support/studio.mjs';\n\n" +
    "test('records focus', async ({ page }, testInfo) => {\n" +
    "  const button = page.getByRole('button', { name: 'Restore' });\n" +
    "  await observe(testInfo, 'focus', { focused: await focused(button) });\n" +
    "});\n";
  assert.deepEqual(await messages(text), []);
});

test("allows the one-shot read interruption in the dedicated Recycle Bin case", async () => {
  const text =
    "import { test, failNextRecycleBinRead } from '../support/studio.mjs';\n\n" +
    "test('retries the read', async ({ page, studio }) => {\n" +
    "  await failNextRecycleBinRead(page, studio);\n" +
    "});\n";
  assert.deepEqual(await messages(text, "recycle-bin/retry.spec.mjs"), []);
});

const disallowedImports = [
  "import { test } from '@playwright/test';",
  "import fs from 'node:fs';",
  "import { DatabaseSync } from 'node:sqlite';",
  "import { StudioApp } from '../../apps/web/src/app/StudioApp.tsx';",
  "import { restart } from '../support/runtime.mjs';",
  "import { bootstrap } from '../support/studio.mjs';",
  "import { focused, observe } from '../support/runtime.mjs';",
  "import { failNextRecycleBinRead } from '../support/studio.mjs';",
  "import '../support/studio.mjs';",
  "const codec = await import('../../apps/server/src/index.ts');",
  "export { test } from '../support/studio.mjs';",
];

for (const text of disallowedImports) {
  test("limits imports to the declared fixture names for " + text, async () => {
    const reports = await messages(text);
    assert.ok(
      reports.some(({ ruleId, messageId }) => ruleId === boundary && messageId === "fixture"),
      JSON.stringify(reports),
    );
  });
}

const disallowedActions = [
  ["selector", "  await page.locator('.card').click();"],
  ["selector", "  await page.getByRole('article').locator('div').click();"],
  ["selector", "  await page.getByRole('article').getByTitle('inner').click();"],
  ["selector", "  await page.click('.card');"],
  ["selector", "  await page['$']('input');"],
  ["selector", "  const view = page;\n  await view.click('#hidden');"],
  ["selector", "  const tab = await page.context().newPage();\n  await tab.fill('input', 'x');"],
  ["selector", '  const { click: rawClick } = page;\n  await rawClick("input");'],
  ["browserInternal", "  await page.route('**/api/*', handler);"],
  ["browserInternal", '  await page["evaluate"](() => null);'],
  ["browserInternal", "  const { evaluate: code } = page;\n  await code(handler);"],
  ["browserInternal", "  await page.getByText('Archive').evaluate(handler);"],
  ["browserInternal", "  await page.request.get('/api/state');"],
  ["browserInternal", "  await page.context().request.post('/api/state');"],
  ["browserInternal", "  page.on('request', handler);"],
  ["browserInternal", "  await page.waitForEvent('response');"],
  ["browserInternal", "  await page.context().addInitScript(handler);"],
  ["browserInternal", "  await browser.newPage();"],
  ["computed", "  await page['ev' + 'aluate'](handler);"],
  ["computed", "  await page.getByText('Target')['ev' + 'aluate'](handler);"],
  ["computed", "  test.describe['sk' + 'ip']('hidden', handler);"],
  ["browserInternal", "  page.on('res' + 'ponse', handler);"],
  ["navigation", "  await page.goto('http://127.0.0.1:8080/');"],
  ["navigation", "  await page.goto('/api/state');"],
  ["navigation", "  await page.goto(studio.url + '?board=hardcoded');"],
  ["navigation", "  const board = { url: '/unsafe' };\n  await page.goto(board.url);"],
  ["navigation", "  const travel = page.goto;\n  await travel(studio.url);"],
  ["testMode", "  test.only('filtered', () => undefined);"],
  ["testMode", "  test.describe['skip']('disabled', () => undefined);"],
  ["testMode", "  test.fixme();"],
  ["testMode", "  const { fail: expectedFailure } = test;\n  expectedFailure();"],
  ["wait", "  await page.waitForTimeout(500);"],
  ["screenshot", "  await page.screenshot({ path: 'outside-report.png' });"],
  ["screenshot", "  await page.getByRole('main').screenshot();"],
  ["screenshot", "  await expect(page).toHaveScreenshot();"],
  ["screenshot", "  await testInfo.attach('manual', { body: bytes });"],
];

for (const [id, actions] of disallowedActions) {
  test("reports " + id + " for " + actions.trim(), async () => {
    const reports = await messages(scenario(actions));
    assert.ok(
      reports.some(({ ruleId, messageId }) => ruleId === boundary && messageId === id),
      JSON.stringify(reports),
    );
  });
}

const disallowedGlobals = [
  "  await fetch('/api/state');",
  "  await globalThis.fetch(target);",
  "  const data = process.env.HOME;",
  '  const fs = require("node:fs");',
  "  await new Promise((resolve) => { setTimeout(resolve, 500); });",
];

for (const actions of disallowedGlobals) {
  test("rejects a host global for " + actions.trim(), async () => {
    const reports = await messages(scenario(actions));
    assert.ok(
      reports.some(({ ruleId }) => ruleId === "no-restricted-globals"),
      JSON.stringify(reports),
    );
  });
}

test("rejects disabling the E2E boundary inline", async () => {
  const reports = await messages(
    "/* eslint-disable browser/user-flow-boundary */\n" +
      scenario("  await page.locator('.card').click();"),
  );
  assert.ok(reports.some(({ ruleId }) => ruleId === "studio/no-source-comments"));
  assert.ok(reports.some(({ ruleId }) => ruleId === boundary));
});
