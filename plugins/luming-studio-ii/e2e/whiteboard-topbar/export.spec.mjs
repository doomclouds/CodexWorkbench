import {
  downloadBoardExport,
  expect,
  failNextBoardExport,
  observe,
  readBoardDownload,
  screenshot,
  test,
} from "../support/studio.mjs";

const title = "导出交付白板";
const label = "需要保存的发布内容";
const note = "备份验收现场备注";
const object = {
  id: "export-card",
  kind: "shape",
  label,
  x: 215,
  y: 185,
  width: 260,
  height: 135,
};

const formats = {
  json: /^白板文件 \(\.json\)(?: JSON)?$/u,
  png: /^PNG 图片(?: PNG)?$/u,
  zip: /^完整作品备份(?:\s|$)/u,
};

function button(scope, name) {
  return scope.getByRole("button", { name, exact: true });
}

async function openBoard(page, studio) {
  const board = await studio.seedBasicBoard({ title, objects: [object] });
  await page.goto(board.url);
  await expect(page.getByText(label, { exact: true })).toBeVisible();
}

async function openExport(page) {
  await button(page, "分享").click();
  const tab = page.getByRole("tab", { name: "导出", exact: true });
  await tab.click();

  const panel = page.getByRole("tabpanel", { name: "导出", exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

async function exportedFile(page, studio, trigger, format) {
  const download = await downloadBoardExport(page, studio, trigger);
  return readBoardDownload(page, download, format);
}

function downloadDialog(page) {
  return page.getByRole("dialog", { name: "下载导出文件", exact: true });
}

async function expectDelivered(page, studio, trigger) {
  if (studio.edition === "initial") {
    await expect(page.getByText("导出已生成。", { exact: true })).toBeVisible();
  } else {
    await expect(downloadDialog(page)).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.getByText(/已发起下载/u)).toHaveCount(0);
  }
}

async function addNote(page) {
  const toggle = button(page, "备注");
  await toggle.click();
  await page.getByText(label, { exact: true }).click();
  const composer = page.getByRole("textbox", { name: "批注内容", exact: true });
  await composer.fill(note);
  await button(page, "保存备注").click();
  await expect(composer).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: new RegExp("^备注 .*：" + note + "$", "u") }),
  ).toBeVisible();
}

test("[TOPBAR-EXPORT-01] 从分享导出真实 JSON 与 PNG，并能按文件名查找下载结果", async ({
  page,
  studio,
}, testInfo) => {
  await openBoard(page, studio);
  const panel = await openExport(page);
  const jsonFormat = button(panel, formats.json);
  if (studio.edition === "ii") {
    const downloads = [];
    page.on("download", (download) => downloads.push(download.suggestedFilename()));
    await jsonFormat.click();
    const dialog = downloadDialog(page);
    await expect(dialog.getByText(title + ".json", { exact: true })).toBeVisible();
    await expect(button(dialog, "下载")).toBeEnabled();
    expect(downloads).toEqual([]);
    await screenshot(page, testInfo, "json-download-dialog");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(jsonFormat).toBeFocused();
    expect(downloads).toEqual([]);
  }
  const json = await exportedFile(page, studio, jsonFormat, "json");
  expect(json.filename).toBe(title + ".json");
  expect(json.mimeType).toBe("application/json");
  expect(JSON.stringify(JSON.parse(json.text))).toContain(label);
  await expectDelivered(page, studio, jsonFormat);
  await screenshot(page, testInfo, "json-download-location");

  const pngFormat = button(panel, formats.png);
  const png = await exportedFile(page, studio, pngFormat, "png");
  expect(png.filename).toBe(title + ".png");
  expect(png.mimeType).toBe("image/png");
  expect(png.width).toBeGreaterThan(0);
  expect(png.height).toBeGreaterThan(0);
  await expectDelivered(page, studio, pngFormat);
  await observe(testInfo, "export-browser-delivery", {
    json: { filename: json.filename, mimeType: json.mimeType, containsSavedContent: true },
    png: { filename: png.filename, mimeType: png.mimeType, validImage: true },
  });
});

test("[TOPBAR-EXPORT-02] 完整作品备份确实包含刚保存的白板备注", async ({
  page,
  studio,
}, testInfo) => {
  await openBoard(page, studio);
  await addNote(page);
  const panel = await openExport(page);
  const format = button(panel, formats.zip);
  const archive = await exportedFile(page, studio, format, "zip");
  expect(archive.filename).toBe(title + ".studio.zip");
  expect(archive.mimeType).toBe("application/zip");
  expect(archive.manifest).toMatchObject({ format: "luming-studio-archive", version: 4 });
  expect(archive.state).toContain(note);
  await expectDelivered(page, studio, format);
  await observe(testInfo, "export-backup-content", { archivedVisibleNote: true });
  await screenshot(page, testInfo, "backup-download-location");
});

test("[TOPBAR-EXPORT-03] 导出失败可见，重试后只收到一份真实文件", async ({
  page,
  studio,
}, testInfo) => {
  await openBoard(page, studio);
  const panel = await openExport(page);
  const downloads = [];
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  await failNextBoardExport(page, studio);
  const format = button(panel, formats.json);
  await format.click();
  await expect(page.getByText(/无法连接作品服务|Failed to fetch/u)).toBeVisible();
  expect(downloads).toEqual([]);
  await screenshot(page, testInfo, "export-failed");

  if (studio.edition === "ii") {
    const dialog = downloadDialog(page);
    await button(dialog, "重试导出").click();
    await expect(dialog.getByText(title + ".json", { exact: true })).toBeVisible();
    expect(downloads).toEqual([]);
  }
  const retry = studio.edition === "initial" ? format : undefined;
  const json = await exportedFile(page, studio, retry, "json");
  expect(json.filename).toBe(title + ".json");
  expect(downloads).toEqual([json.filename]);
  expect(JSON.stringify(JSON.parse(json.text))).toContain(label);
  await expectDelivered(page, studio, format);
  await observe(testInfo, "export-retry", { failureWasVisible: true, downloads: 1 });
});
