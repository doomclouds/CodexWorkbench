import {
  chooseArchive,
  expect,
  failNextArchiveImport,
  holdNextArchiveImport,
  imageLoaded,
  observe,
  screenshot,
  test,
} from "../support/studio.mjs";

const backupTitle = "产品发布工作台";
const archiveBoardId = "7f1a680f-c09d-47c6-a76e-a5e7a803018f";
const originalTitle = "工作台已有发布白板";

function openBoard(page, title) {
  return page.getByRole("button", { name: "打开白板：" + title, exact: true });
}

function openedBoardId(page, studio) {
  const key = studio.edition === "initial" ? "artifactId" : "board";
  return new URL(page.url()).searchParams.get(key);
}

function newWork(page) {
  return page.getByRole("button", { name: "新建作品", exact: true });
}

async function selectFromNewWork(page, fixture) {
  await newWork(page).click();
  await chooseArchive(
    page,
    () => page.getByRole("menuitem", { name: "导入作品", exact: true }).click(),
    fixture,
  );
}

async function expectArchiveContent(page, board) {
  await expect(page.getByText(board.contentText, { exact: true })).toBeVisible();
  const image = page.getByRole("img", { name: board.contentImage, exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => imageLoaded(image)).toBe(true);
}

async function returnToWorkbench(page, studio) {
  await page.getByRole("button", { name: studio.workbenchBackLabel, exact: true }).click();
}

test("[WB-IMPORT-01] 从工作台文件选择导入 V4，保留正文和素材并打开独立白板", async ({
  page,
  studio,
}, testInfo) => {
  const [original] = await studio.seedBoards([{ title: originalTitle, withContent: true }]);
  await page.goto(studio.url);
  await expect(openBoard(page, original.title)).toBeVisible();

  await selectFromNewWork(page, "v4");
  await expectArchiveContent(page, original);
  const importedId = openedBoardId(page, studio);
  expect(importedId).toBeTruthy();
  expect(importedId).not.toBe(archiveBoardId);
  expect(importedId).not.toBe(original.id);
  await screenshot(page, testInfo, "v4-import-opened");
  await observe(testInfo, "v4-import-opened", {
    title: backupTitle,
    text: original.contentText,
    image: original.contentImage,
    independentBoard: true,
  });

  await returnToWorkbench(page, studio);
  await expect(openBoard(page, original.title)).toBeVisible();
  await expect(openBoard(page, backupTitle)).toBeVisible();
  await openBoard(page, backupTitle).click();
  await expect.poll(() => openedBoardId(page, studio)).toBe(importedId);
  await expectArchiveContent(page, original);
});

test("[WB-IMPORT-02] 取消选择和无效 ZIP 均保留工作台，换文件后能导入", async ({
  page,
  studio,
}, testInfo) => {
  const [original] = await studio.seedBoards([{ title: originalTitle, withContent: true }]);
  await page.goto(studio.url);
  await expect(openBoard(page, original.title)).toBeVisible();

  await selectFromNewWork(page, "cancel");
  await expect(newWork(page)).toBeEnabled();
  await expect(newWork(page)).toBeFocused();
  await expect(openBoard(page, backupTitle)).toHaveCount(0);
  expect(openedBoardId(page, studio)).toBeNull();

  await selectFromNewWork(page, "invalid");
  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(openBoard(page, original.title)).toBeVisible();
  await expect(openBoard(page, backupTitle)).toHaveCount(0);
  expect(openedBoardId(page, studio)).toBeNull();
  await screenshot(page, testInfo, "archive-invalid");
  await observe(testInfo, "archive-invalid", {
    error: await alert.innerText(),
    workbenchStayedOpen: true,
  });

  await selectFromNewWork(page, "v4");
  await expectArchiveContent(page, original);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await screenshot(page, testInfo, "archive-reselected");
  await observe(testInfo, "archive-reselected", {
    cancelled: "保持工作台",
    invalid: "明确提示失败",
    recovered: "更换正确 V4 文件",
  });
});

test("[WB-IMPORT-03] 请求失败后显式重试同一文件并只生成一块白板", async ({
  page,
  studio,
}, testInfo) => {
  const [original] = await studio.seedBoards([{ title: originalTitle, withContent: true }]);
  await page.goto(studio.url);
  await expect(openBoard(page, original.title)).toBeVisible();

  await failNextArchiveImport(page, studio, "before");
  await selectFromNewWork(page, "v4");
  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  if (studio.edition === "ii") {
    await expect(alert).toHaveText("暂未确认导入结果，请先检查工作台。");
  }
  await expect(openBoard(page, backupTitle)).toHaveCount(0);
  expect(openedBoardId(page, studio)).toBeNull();
  await screenshot(page, testInfo, "archive-request-failed");
  await observe(testInfo, "archive-request-failed", {
    error: await alert.innerText(),
    importedBeforeRetry: 0,
  });

  await selectFromNewWork(page, "v4");
  await expectArchiveContent(page, original);
  await returnToWorkbench(page, studio);
  await expect(openBoard(page, backupTitle)).toHaveCount(1);
  await screenshot(page, testInfo, "archive-retry-saved");
  await observe(testInfo, "archive-retry-saved", {
    recovery: "用户重新选择同一 V4 文件",
    imports: 1,
  });
});

test("[WB-IMPORT-04] 导入回执迟到时保留用户后来打开的白板", async ({ page, studio }, testInfo) => {
  const [original] = await studio.seedBoards([{ title: originalTitle }]);
  await page.goto(studio.url);
  await expect(openBoard(page, original.title)).toBeVisible();

  const upload = await holdNextArchiveImport(page, studio);
  try {
    await selectFromNewWork(page, "v4");
    await upload.started;
    await expect(newWork(page)).toBeDisabled();
    await openBoard(page, original.title).click();
    await expect.poll(() => openedBoardId(page, studio)).toBe(original.id);
  } finally {
    upload.release();
  }

  await expect(
    page.getByText(`作品已导入，可从 ${studio.workbenchTitle} 打开。`, { exact: true }),
  ).toBeVisible();
  expect(openedBoardId(page, studio)).toBe(original.id);
  await screenshot(page, testInfo, "archive-completed-in-background");
  await returnToWorkbench(page, studio);
  await expect(openBoard(page, backupTitle)).toBeVisible();
  await screenshot(page, testInfo, "archive-late-result-in-list");
  await observe(testInfo, "archive-late-result-in-list", {
    userBoardStayedOpen: true,
    importedBoardAvailable: true,
  });
});

test("[WB-IMPORT-05] 上传已完成时丢失回执，检查已保存的唯一作品", async ({
  page,
  studio,
}, testInfo) => {
  const [original] = await studio.seedBoards([{ title: originalTitle, withContent: true }]);
  await page.goto(studio.url);
  await expect(openBoard(page, original.title)).toBeVisible();

  await failNextArchiveImport(page, studio, "after");
  await selectFromNewWork(page, "v4");
  if (studio.edition === "initial") {
    await expect(page.getByRole("alert")).toBeVisible();
    expect(openedBoardId(page, studio)).toBeNull();
    await screenshot(page, testInfo, "archive-receipt-lost");
    await page.reload();
  } else {
    await expectArchiveContent(page, original);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await screenshot(page, testInfo, "archive-receipt-lost");
    await returnToWorkbench(page, studio);
  }

  await expect(openBoard(page, backupTitle)).toHaveCount(1);
  await screenshot(page, testInfo, "archive-receipt-saved-once");
  await observe(testInfo, "archive-receipt-saved-once", {
    uploadsPersisted: 1,
    recovery: studio.edition === "initial" ? "刷新工作台看到已导入作品" : "自动核对回执并打开作品",
  });
});
