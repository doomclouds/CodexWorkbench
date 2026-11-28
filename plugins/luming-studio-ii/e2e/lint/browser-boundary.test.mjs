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

const workbenchFixtures = [
  ["browse", ["failNextWorkbenchRead"]],
  ["create", ["interceptNextBoardCreation"]],
  ["display", ["controlNextThumbnail", "readCardCover", "readControlPresentation"]],
  ["import", ["chooseArchive", "failNextArchiveImport", "holdNextArchiveImport", "imageLoaded"]],
  ["link", ["workbenchLinkProbe"]],
  ["live", ["observeWorkbenchCatalog", "trackWorkbenchCard"]],
];

function importFixture(names, source = "../support/studio.mjs") {
  return "import { " + names.join(", ") + " } from '" + source + "';";
}

for (const [name, helpers] of workbenchFixtures) {
  const file = "workbench/" + name + ".spec.mjs";
  test("allows the dedicated workbench fixture helpers in " + file, async () => {
    assert.deepEqual(await messages(importFixture(helpers), file), []);
  });

  for (const helper of helpers) {
    test("keeps " + helper + " inside its own scenario and fixture entry", async () => {
      const impostor = importFixture([helper], "../support/runtime.mjs");
      const results = await Promise.all([
        messages(importFixture([helper]), spec),
        messages(importFixture([helper]), "workbench/other.spec.mjs"),
        messages(impostor, file),
      ]);

      for (const reports of results) {
        assert.ok(
          reports.some(({ ruleId, messageId }) => ruleId === boundary && messageId === "fixture"),
          JSON.stringify(reports),
        );
      }
    });
  }
}

test("allows semantic controls on the isolated guest page", async () => {
  const text =
    importFixture(["expect", "test", "workbenchLinkProbe"]) +
    "\n\n" +
    "test('uses the guest page', async ({ page, browser, studio }) => {\n" +
    "  const probe = await workbenchLinkProbe({ page, browser, studio });\n" +
    "  const guest = await probe.openGuest();\n" +
    "  await expect(guest.getByRole('heading', { name: 'Whiteboard' })).toBeVisible();\n" +
    "});\n";
  assert.deepEqual(await messages(text, "workbench/link.spec.mjs"), []);
});

test("applies the ordinary browser boundary to a guest page", async () => {
  const text =
    importFixture(["test", "workbenchLinkProbe"]) +
    "\n\n" +
    "test('uses the guest page', async ({ page, browser, studio }) => {\n" +
    "  const probe = await workbenchLinkProbe({ page, browser, studio });\n" +
    "  const guest = await probe.openGuest();\n" +
    "  await guest.click('.board');\n" +
    "  await guest.goto('https://example.com/');\n" +
    "});\n";
  assert.deepEqual(
    (await messages(text, "workbench/link.spec.mjs")).map(({ messageId }) => messageId),
    ["selector", "navigation"],
  );
});

test("archive scenarios still reject direct use of the native file chooser", async () => {
  const text = scenario(
    "  const chooser = await page.waitForEvent('filechooser');\n" +
      "  await chooser.setFiles('/outside/test.zip');\n" +
      "  await page.getByLabel('Import').setInputFiles('/outside/test.zip');\n" +
      "  const waitFor = page.waitForEvent.bind(page);\n" +
      "  await waitFor('filechooser');",
  );
  assert.deepEqual(
    (await messages(text, "workbench/import.spec.mjs")).map(({ messageId }) => messageId),
    ["browserInternal", "browserInternal", "browserInternal", "browserInternal"],
  );
});

const canvasSpec = "whiteboard-basics/objects.spec.mjs";

const whiteboardScopedFixtures = [
  ["whiteboard-basics/organization", ["workbenchLinkProbe"]],
  ["whiteboard-basics/objects", ["controlNextCanvasSave"]],
  [
    "whiteboard-basics/objects-media",
    ["chooseBoardMedia", "imageLoaded", "mediaDisplaySize", "mediaPlaying"],
  ],
  ["whiteboard-basics/persistence", ["controlNextCanvasSave", "enableCanvasClipboard"]],
  [
    "whiteboard-editing/html",
    [
      "embedFrame",
      "chooseHtmlFile",
      "controlNextHtmlSave",
      "countOverviewEmbeds",
      "inspectEmbedPaint",
      "observeEmbedPayloadReads",
      "workbenchLinkProbe",
    ],
  ],
  [
    "whiteboard-editing/document",
    ["chooseDocumentImage", "readDocumentDownload", "failNextDocumentSave", "workbenchLinkProbe"],
  ],
  ["whiteboard-editing/todo", ["controlNextTodoSave", "workbenchLinkProbe"]],
  ["whiteboard-editing/rich-gestures", ["embedFrame", "workbenchLinkProbe"]],
  ["whiteboard-editing/organization", ["enableCanvasClipboard"]],
  ["whiteboard-editing/inline-editing", ["holdNextInlineTextRefresh", "holdNextInlineTextWrite"]],
  [
    "whiteboard-editing/reading-controls",
    [
      "countOverviewEmbeds",
      "embedFrame",
      "observeEmbedPayloadReads",
      "observeEmbedViewport",
      "observeViewingFrames",
      "observeViewingLayers",
      "readViewingInk",
      "workbenchLinkProbe",
    ],
  ],
  ["whiteboard-editing/zoom-visibility", ["readZoomDetails", "holdNextCanvasMove"]],
  [
    "whiteboard-editing/canvas-extras",
    ["workbenchLinkProbe", "readPeerCursors", "readPlacementPreview", "controlNextTextSave"],
  ],
  ["whiteboard-topbar/chrome", ["controlNextCanvasSave"]],
  ["whiteboard-topbar/history", ["failNextOlderVersions", "readBoardDownload"]],
  ["whiteboard-topbar/export", ["downloadBoardExport", "readBoardDownload", "failNextBoardExport"]],
  [
    "whiteboard-topbar/sharing-feedback",
    ["workbenchLinkProbe", "mediaDisplaySize", "mediaPlaying", "observeGuestAccessReads"],
  ],
  ["whiteboard-topbar/overlays", ["seedTopbarSuggestion", "seedTopbarAgentWorkspace"]],
  ["whiteboard-topbar/export-fidelity", ["downloadBoardExport", "inspectBoardExport"]],
  ["whiteboard-topbar/scripted-export", ["downloadBoardExport", "inspectBoardExport"]],
  [
    "whiteboard-collaboration/presence",
    ["workbenchLinkProbe", "readPeerCursors", "readPlacementPreview", "setRoomConnectionOffline"],
  ],
  ["whiteboard-collaboration/geometry", ["workbenchLinkProbe"]],
  [
    "whiteboard-collaboration/content",
    [
      "workbenchLinkProbe",
      "embedFrame",
      "chooseHtmlFile",
      "chooseBoardMedia",
      "mediaDisplaySize",
      "mediaPlaying",
      "holdNextInlineTextWrite",
    ],
  ],
];

for (const [name, helpers] of whiteboardScopedFixtures) {
  const file = name + ".spec.mjs";
  test("limits the whiteboard scenario helpers to " + file, async () => {
    const content = importFixture(helpers);
    assert.deepEqual(await messages(content, file), []);
  });

  for (const helper of helpers) {
    test("keeps the whiteboard helper " + helper + " in its declared fixture path", async () => {
      const probes = await Promise.all([
        messages(importFixture([helper]), "whiteboard-basics/viewport.spec.mjs"),
        messages(importFixture([helper]), "workbench/manage.spec.mjs"),
        messages(importFixture([helper]), "whiteboard-editing/connector-directions.spec.mjs"),
        messages(importFixture([helper], "../support/runtime.mjs"), file),
      ]);

      assert.deepEqual(
        probes.map((reports) => reports.map(({ messageId }) => messageId)),
        [["fixture"], ["fixture"], ["fixture"], ["fixture"]],
      );
    });
  }
}

const whiteboardActions = [
  "  const board = await studio.seedBasicBoard('basic');",
  "  await page.goto(board.url);",
  "  const canvas = page.getByRole('application', { name: board.title });",
  "  const bounds = await canvas.boundingBox();",
  "  await page.keyboard.down('Shift');",
  "  await page.mouse.move(bounds.x, bounds.y);",
  "  await page.mouse.down();",
  "  await page.mouse.move(bounds.x + 40, bounds.y + 45, { steps: 6 });",
  "  await page.mouse.up();",
  "  await page.keyboard.up('Shift');",
  "  const visible = await readCanvas(page, studio);",
  "  const saved = await studio.readBoard(board);",
  "  expect(visible).toBeDefined();",
  "  expect(saved).toBeDefined();",
];

const whiteboardFiles = [
  "whiteboard-basics/viewport",
  "whiteboard-basics/placement",
  "whiteboard-basics/selection",
  "whiteboard-basics/geometry",
  "whiteboard-basics/organization",
  "whiteboard-basics/connectors",
  "whiteboard-basics/objects",
  "whiteboard-basics/objects-media",
  "whiteboard-basics/persistence",
  "whiteboard-editing/html",
  "whiteboard-editing/document",
  "whiteboard-editing/todo",
  "whiteboard-editing/rich-gestures",
  "whiteboard-editing/organization",
  "whiteboard-editing/connector-directions",
  "whiteboard-editing/object-menus",
  "whiteboard-editing/reading-controls",
  "whiteboard-editing/zoom-visibility",
  "whiteboard-editing/canvas-extras",
  "whiteboard-editing/inline-editing",
  "whiteboard-topbar/chrome",
  "whiteboard-topbar/history",
  "whiteboard-topbar/export",
  "whiteboard-topbar/sharing-feedback",
  "whiteboard-topbar/overlays",
  "whiteboard-topbar/export-fidelity",
  "whiteboard-topbar/scripted-export",
  "whiteboard-collaboration/presence",
  "whiteboard-collaboration/geometry",
  "whiteboard-collaboration/content",
];

for (const name of whiteboardFiles) {
  test(
    "allows semantic canvas and persisted-state assertions in the " + name + " scenario",
    async () => {
      const text = importFixture(["readCanvas"]) + "\n" + scenario(whiteboardActions.join("\n"));
      assert.deepEqual(await messages(text, name + ".spec.mjs"), []);
    },
  );
}

test("rejects the whiteboard capabilities in an unrelated feature", async () => {
  const text =
    importFixture(["readCanvas"]) +
    "\n" +
    scenario(
      "  const board = await studio.seedBasicBoard();\n" +
        "  await studio.readBoard(board);\n" +
        "  await studio['read' + 'Board'](board);",
    );

  for (const file of ["workbench/browse.spec.mjs", "whiteboard-basics/other.spec.mjs"]) {
    assert.deepEqual(
      (await messages(text, file)).map(({ messageId }) => messageId),
      ["fixture", "fixtureMethod", "fixtureMethod", "computed"],
    );
  }
});

test("limits a versioned fixture to direct calls from the history scenario", async () => {
  const text = scenario("  await studio.seedVersionMoves(board, 21);");
  assert.deepEqual(await messages(text, "whiteboard-topbar/history.spec.mjs"), []);
  assert.deepEqual(
    (await messages(text, "whiteboard-topbar/chrome.spec.mjs")).map(({ messageId }) => messageId),
    ["fixtureMethod"],
  );
  const aliased = scenario("  const seed = studio.seedVersionMoves; await seed(board, 21);");
  assert.deepEqual(
    (await messages(aliased, "whiteboard-topbar/history.spec.mjs")).map(
      ({ messageId }) => messageId,
    ),
    ["fixtureMethod"],
  );
});

test("blocks canvas implementation and storage inspection inside a whiteboard scenario", async () => {
  const text =
    "import { DatabaseSync } from 'node:sqlite';\n" +
    "import { readCanvas } from '../support/canvas.mjs';\n" +
    scenario(
      "  await page.evaluate(inspectCanvas);\n" +
        "  await page.locator('[data-private-id]').click();\n" +
        "  await page.goto('https://example.com/');\n" +
        "  await page.route('/api/*', callback);\n" +
        "  await studio.request('/api/debug');\n" +
        "  const { readBoard } = studio;\n" +
        "  await readBoard(arbitraryBoard);",
    );
  assert.deepEqual(
    (await messages(text, canvasSpec)).map(({ messageId }) => messageId),
    [
      "fixture",
      "fixture",
      "browserInternal",
      "selector",
      "navigation",
      "browserInternal",
      "browserInternal",
      "fixtureMethod",
    ],
  );
});

test("keeps semantic selector rules on a native media link popup", async () => {
  const openPopup =
    "  const open = page.getByRole('link', { name: 'Open' });\n" +
    "  const [target] = await Promise.all([page.waitForEvent('popup'), open.click()]);\n";
  const allowed = scenario(
    openPopup + "  await expect(target.getByRole('heading')).toBeVisible();",
  );
  const rejected = scenario(openPopup + "  await target.click('.hidden-control');");
  const file = "whiteboard-basics/objects-media.spec.mjs";
  assert.deepEqual(await messages(allowed, file), []);
  assert.deepEqual(
    (await messages(rejected, file)).map(({ messageId }) => messageId),
    ["selector"],
  );
});

test("allows the HTML helper to expose the frame through semantic browser actions", async () => {
  const file = "whiteboard-editing/html.spec.mjs";
  const allowed =
    importFixture(["embedFrame", "chooseHtmlFile"]) +
    "\n" +
    scenario(
      "  const upload = page.getByRole('button', { name: 'Import HTML' });\n" +
        "  await chooseHtmlFile(page, () => upload.click(), 'ordinary');\n" +
        "  const frame = embedFrame(page, 'Sample');\n" +
        "  await frame.getByRole('button', { name: 'Next' }).click();",
    );
  const rejected = scenario(
    "  const frame = page.frameLocator('iframe');\n" +
      "  await frame.locator('#private').click();\n" +
      "  await page.route('**/addon', handler);",
  );
  assert.deepEqual(await messages(allowed, file), []);
  assert.deepEqual(
    (await messages(rejected, file)).map(({ messageId }) => messageId),
    ["selector", "selector", "browserInternal"],
  );
  const aliased =
    importFixture(["embedFrame", "test"]) +
    "\n\n" +
    "test('opens the fixture iframe', async ({ page }) => {\n" +
    "  const frame = embedFrame(page, 'Sample');\n" +
    "  await frame['lo' + 'cator']('#file');\n" +
    "});\n";
  assert.deepEqual(
    (await messages(aliased, file)).map(({ messageId }) => messageId),
    ["computed"],
  );
});

test("allows the document scenario to inspect an actual download only through its fixture", async () => {
  const file = "whiteboard-editing/document.spec.mjs";
  const save =
    "  const exportButton = page.getByRole('button', { name: 'Export' });\n" +
    "  const [exportedFile] = await Promise.all([page.waitForEvent('download'), exportButton.click()]);\n";
  const allowed =
    importFixture(["readDocumentDownload"]) +
    "\n" +
    scenario(save + "  const exported = await readDocumentDownload(exportedFile, 'html');");
  const rejected = scenario(
    save +
      "  await exportedFile.path();\n" +
      "  await exportedFile.saveAs('/outside/export.html');\n" +
      "  const data = await exportedFile.createReadStream();\n" +
      "  await exportedFile['pa' + 'th']();",
  );
  assert.deepEqual(await messages(allowed, file), []);
  assert.deepEqual(
    (await messages(rejected, file)).map(({ messageId }) => messageId),
    ["download", "download", "download", "computed"],
  );
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
