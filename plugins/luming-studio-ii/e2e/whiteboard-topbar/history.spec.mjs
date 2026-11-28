import {
  expect,
  failNextOlderVersions,
  observe,
  readBoardDownload,
  screenshot,
  test,
} from "../support/studio.mjs";

const objects = [
  { id: "plan", kind: "shape", label: "发布方案", x: 160, y: 160, width: 220, height: 100 },
  { id: "other", kind: "shape", label: "检查项", x: 610, y: 320, width: 160, height: 80 },
];

function button(root, name) {
  return root.getByRole("button", { name, exact: true });
}

function record(page, revision) {
  return button(page, "展开版本 " + revision);
}

async function openHistory(page, studio, count) {
  const board = await studio.seedBasicBoard({ title: "版本历史验收", objects });
  const before = await studio.readBoard(board);
  const versions = await studio.seedVersionMoves(board, count);
  await page.goto(board.url);
  await button(page, "版本历史").click();
  const latest = versions.at(-1);
  await expect(record(page, latest.revision)).toBeVisible();

  const baseline = { revision: before.revision, x: before.objects[0].x };
  const first = studio.edition === "initial" ? baseline : versions[0];

  return { board, first, latest };
}

async function previewVersion(page, revision) {
  await record(page, revision).click();
  await button(page, "预览版本").click();
  await expect(page.getByText(new RegExp("正在预览版本 " + revision + "，", "u"))).toBeVisible();
}

test("[TOPBAR-HIST-01] 版本改动、预览和恢复确认", async ({ page, studio }, testInfo) => {
  const { board, first, latest } = await openHistory(page, studio, 3);
  await record(page, latest.revision).click();
  await button(page, "看改动").click();
  await expect(button(page, "返回版本历史")).toBeVisible();
  await screenshot(page, testInfo, "version-difference");
  await button(page, "返回版本历史").click();
  await previewVersion(page, first.revision);
  await expect(button(page, "退出预览")).toBeVisible();
  expect((await studio.readBoard(board)).revision).toBe(latest.revision);
  await screenshot(page, testInfo, "version-preview");

  await button(page, "恢复此版本").click();
  const confirmation = page.getByRole("dialog", { name: "恢复此版本？", exact: true });
  await expect(confirmation).toBeVisible();
  expect((await studio.readBoard(board)).revision).toBe(latest.revision);
  await screenshot(page, testInfo, "version-restore-confirm");
  await button(confirmation, "确认恢复").click();
  await expect(button(page, "退出预览")).toHaveCount(0);
  await expect
    .poll(async () => (await studio.readBoard(board)).objects.find(({ id }) => id === "plan")?.x)
    .toBe(first.x);
  expect((await studio.readBoard(board)).revision).toBeGreaterThan(latest.revision);
  await observe(testInfo, "version-restore", {
    differenceOpened: true,
    previewReadOnly: true,
    savedAsNewVersion: true,
  });
});

test("[TOPBAR-HIST-02] 浏览更早历史并在分页失败后重试", async ({ page, studio }, testInfo) => {
  const { board, first, latest } = await openHistory(page, studio, 32);
  if (studio.edition === "ii") {
    const older = button(page, "加载更早版本");
    await expect(record(page, first.revision)).toHaveCount(0);
    await expect(older).toBeVisible();
    await failNextOlderVersions(page, studio, board);
    await older.click();
    const retry = button(page, "重试加载更早版本");
    await expect(retry).toBeVisible();
    await expect(record(page, latest.revision)).toHaveCount(1);
    await screenshot(page, testInfo, "older-versions-retry");
    await retry.click();
    await expect(older).toHaveCount(0);
  }

  await expect(record(page, first.revision)).toBeVisible();
  await expect(record(page, latest.revision)).toHaveCount(1);
  expect((await studio.readBoard(board)).revision).toBe(latest.revision);
  await screenshot(page, testInfo, "older-versions-loaded");
  await observe(testInfo, "older-versions", {
    initialRecordsRetained: true,
    oldestRecordAvailable: true,
    paged: studio.edition === "ii",
  });
});

test("[TOPBAR-HIST-03] 预览顶栏和历史快照导出", async ({ page, studio }, testInfo) => {
  const { board, first, latest } = await openHistory(page, studio, 3);
  await previewVersion(page, first.revision);
  await screenshot(page, testInfo, "version-preview-toolbar");
  if (studio.edition === "ii") {
    const preview = page.getByLabel("历史版本预览", { exact: true });
    await preview.getByText("发布方案", { exact: true }).click();
    const exportTrigger = button(preview, "导出历史版本");
    await expect(button(preview, "导出 JSON")).toHaveCount(0);
    await exportTrigger.click();
    const menu = page.getByRole("dialog", { name: "导出历史版本", exact: true });
    const scope = menu.getByRole("combobox", { name: "导出范围", exact: true });
    await expect(scope).toBeFocused();
    await scope.selectOption("selection");
    await screenshot(page, testInfo, "version-export-formats");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      button(menu, "导出 JSON").click(),
    ]);
    const exported = await readBoardDownload(page, download, "json");
    const data = JSON.parse(exported.text);
    expect(data.board.revision).toBe(String(first.revision));
    expect(data.objects).toHaveLength(1);
    expect(data.objects[0]).toMatchObject({
      objectId: "plan",
      geometry: { x: first.x },
    });
    await expect(menu).toHaveCount(0);
    await expect(exportTrigger).toBeFocused();
  } else {
    await expect(button(page, "导出历史版本")).toHaveCount(0);
  }

  await button(page, "退出预览").click();
  await expect(button(page, "退出预览")).toHaveCount(0);
  expect((await studio.readBoard(board)).revision).toBe(latest.revision);
  await observe(testInfo, "version-export", {
    initialPreviewAvailable: true,
    historyExportAvailable: studio.edition === "ii",
    liveVersionPreserved: true,
  });
});
