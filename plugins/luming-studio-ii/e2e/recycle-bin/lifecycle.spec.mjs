import { test, expect, observe, screenshot } from "../support/studio.mjs";

const bulkSize = 105;

const boardButton = (page, title) =>
  page.getByRole("button", { name: "打开白板：" + title, exact: true });
const manageButton = (page, title) =>
  page.getByRole("button", { name: "管理作品：" + title, exact: true });
const restoreButton = (page, title) =>
  page.getByRole("button", { name: "恢复作品：" + title, exact: true });
const selection = (page, title) =>
  page.getByRole("checkbox", { name: "选择作品：" + title, exact: true });

async function openTrash(page) {
  await page.getByRole("button", { name: "筛选作品", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "回收站", exact: true }).click();
  await expect(page.getByRole("heading", { name: "回收站", exact: true })).toBeVisible();
}

async function openBoardMenu(page, title) {
  await boardButton(page, title).hover();
  await manageButton(page, title).click();
}

async function moveToTrash(page, title) {
  await openBoardMenu(page, title);
  await page.getByRole("menuitem", { name: "移入回收站", exact: true }).click();
  await expect(boardButton(page, title)).toHaveCount(0);
}

async function expectBoardId(page, studio, boardId) {
  const key = studio.edition === "initial" ? "artifactId" : "board";
  await expect.poll(() => new URL(page.url()).searchParams.get(key)).toBe(boardId);
}

async function visitBoardUrl(page, board, inspect) {
  const other = await page.context().newPage();
  try {
    await other.goto(board.url);
    await inspect(other);
  } finally {
    await other.close();
  }
}

async function expectBoardUnavailable(page, studio, board) {
  const message = studio.edition === "initial" ? "作品暂时无法读取" : "无法打开白板";
  await visitBoardUrl(page, board, async (direct) => {
    await expect(direct.getByText(message, { exact: true })).toBeVisible();
  });
}

async function observeTrashedBoardLink(page, studio, board, testInfo) {
  await visitBoardUrl(page, board, async (direct) => {
    const content = direct.getByText(board.contentText, { exact: true });
    const unavailable = direct.getByText(/^(作品暂时无法读取|无法打开白板)$/u);
    await expect(content.or(unavailable)).toBeVisible();
    await observe(testInfo, "trashed-deep-link", { openable: await content.isVisible() });
    await expectSavedBoard(direct, studio, board);
    await screenshot(direct, testInfo, "trashed-board-direct-link");
  });
}

async function expectSavedBoard(page, studio, board) {
  await expectBoardId(page, studio, board.id);
  expect(board.contentText).toBeTruthy();
  await expect(page.getByText(board.contentText, { exact: true })).toBeVisible();
  expect(board.contentImage).toBeTruthy();
  const image = page.getByRole("img", { name: board.contentImage, exact: true });
  await expect(image).toBeVisible();
  await expect(image).toHaveJSProperty("complete", true);
  await expect(image).not.toHaveJSProperty("naturalWidth", 0);
}

async function currentHistoryRevision(page) {
  await page.getByRole("button", { name: "版本历史", exact: true }).click();
  const current = page
    .getByRole("button", { name: /^展开版本 \d+$/u })
    .filter({ hasText: "当前版本" });
  await expect(current).toBeVisible();

  return Number((await current.getAttribute("aria-label")).split(" ").at(-1));
}

test("[TRASH-FLOW-01] 重启后恢复同一白板、固定状态和保存内容", async ({
  page,
  studio,
}, testInfo) => {
  const [board] = await studio.seedBoards([
    { title: "需要恢复的发布白板", pinned: true, withContent: true },
  ]);

  await page.goto(studio.url);
  await boardButton(page, board.title).click();
  await expectSavedBoard(page, studio, board);
  const revisionBeforeTrash = await currentHistoryRevision(page);
  await page.goto(studio.url);
  await moveToTrash(page, board.title);
  await openTrash(page);
  await expect(boardButton(page, board.title)).toBeDisabled();

  await studio.restart();
  await page.reload();
  await expect(restoreButton(page, board.title)).toBeEnabled();
  await screenshot(page, testInfo, "trash-after-restart");
  await observeTrashedBoardLink(page, studio, board, testInfo);

  await restoreButton(page, board.title).click();
  await expect(page.getByRole("heading", { name: "回收站为空", exact: true })).toBeVisible();
  await page.getByRole("button", { name: studio.workbenchBackLabel, exact: true }).click();
  await openBoardMenu(page, board.title);
  await expect(page.getByRole("menuitem", { name: "取消固定", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await boardButton(page, board.title).click();
  await expectSavedBoard(page, studio, board);

  await studio.restart();
  await page.goto(board.url);
  await expectSavedBoard(page, studio, board);
  await screenshot(page, testInfo, "restored-original-board");
  const revisionAfterRestore = await currentHistoryRevision(page);
  const extraRevisions = revisionAfterRestore - revisionBeforeTrash;
  await observe(testInfo, "trash-restore-history", { extraRevisions });
  expect(extraRevisions).toBe(2);
});

test("[TRASH-FLOW-02] 永久删除所选作品并保留未选与工作台作品", async ({
  page,
  studio,
}, testInfo) => {
  const [left, right, retained, active] = await studio.seedBoards([
    { title: "删除所选甲", trashed: true },
    { title: "删除所选乙", trashed: true },
    { title: "保留未选作品", trashed: true },
    { title: "保留工作台作品" },
  ]);

  await page.goto(studio.url);
  await openTrash(page);
  await selection(page, left.title).check();
  await selection(page, right.title).check();
  await expect(selection(page, retained.title)).not.toBeChecked();
  await expect(page.getByText("2 项已选", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "永久删除所选作品", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "永久删除作品", exact: true });
  await expect(dialog.getByText(/永久删除 2 项作品/)).toBeVisible();
  await screenshot(page, testInfo, "delete-selected-confirmation");
  await dialog.getByRole("button", { name: "永久删除", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("已永久删除 2 项作品。", { exact: true })).toBeVisible();

  await studio.restart();
  await page.reload();
  await expect(restoreButton(page, retained.title)).toBeVisible();
  await expect(restoreButton(page, left.title)).toHaveCount(0);
  await expect(restoreButton(page, right.title)).toHaveCount(0);
  await expectBoardUnavailable(page, studio, left);
  await screenshot(page, testInfo, "selected-deletion-after-restart");
  await page.getByRole("button", { name: studio.workbenchBackLabel, exact: true }).click();
  await expect(boardButton(page, active.title)).toBeVisible();
});

test("[TRASH-FLOW-03] 清空跨页与搜索的确认范围并保留确认后移入作品", async ({
  page,
  studio,
}, testInfo) => {
  test.setTimeout(90_000);
  const matchingTitle = "清空范围中的唯一匹配";
  const [newArrival, ...oldEntries] = await studio.seedBoards([
    { title: "确认后才移入的白板" },
    ...Array.from({ length: bulkSize }, (_, index) => ({
      title: index === 0 ? matchingTitle : "批量清理样本 " + index,
      trashed: true,
    })),
  ]);

  await page.goto(studio.url);
  await openTrash(page);
  const restoreActions = page.getByRole("button", { name: /^恢复作品：/ });
  const loadMore = page.getByRole("button", { name: "加载更多", exact: true });
  await expect(loadMore).toBeVisible();
  const firstPageCount = await restoreActions.count();
  expect(firstPageCount).toBeGreaterThan(0);
  expect(firstPageCount).toBeLessThan(bulkSize);
  await loadMore.click();
  await expect.poll(() => restoreActions.count()).toBeGreaterThan(firstPageCount);

  await page.getByRole("button", { name: "搜索回收站", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索回收站名称", exact: true }).fill(matchingTitle);
  await expect(restoreButton(page, matchingTitle)).toBeVisible();
  await expect(restoreActions).toHaveCount(1);
  await page.getByRole("button", { name: "清空回收站", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "清空回收站", exact: true });
  await expect(dialog.getByText(/永久删除 105 项作品/)).toBeVisible();
  await screenshot(page, testInfo, "clear-all-unfiltered-confirmation");

  const secondTab = await page.context().newPage();
  try {
    await secondTab.goto(studio.url);
    await moveToTrash(secondTab, newArrival.title);
  } finally {
    await secondTab.close();
  }

  await dialog.getByRole("button", { name: "清空回收站", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("已永久删除 105 项作品。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "清除搜索", exact: true }).click();
  await expect(restoreButton(page, newArrival.title)).toBeVisible();

  await studio.restart();
  await page.reload();
  await expect(restoreButton(page, newArrival.title)).toBeVisible();
  await expect(restoreActions).toHaveCount(1);
  await expectBoardUnavailable(page, studio, oldEntries.at(-1));
  await screenshot(page, testInfo, "clear-all-retains-later-arrival");
});

test("[TRASH-FLOW-04] 从单项入口永久删除且保留另一回收项", async ({ page, studio }, testInfo) => {
  const [removed, retained] = await studio.seedBoards([
    { title: "从单项入口删除的作品", trashed: true },
    { title: "单项删除后保留的作品", trashed: true },
  ]);

  await page.goto(studio.url);
  await openTrash(page);
  await page.getByRole("button", { name: "永久删除作品：" + removed.title, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "永久删除作品", exact: true });
  await expect(dialog.getByText(/永久删除 1 项作品/u)).toBeVisible();
  await expect(dialog.getByText(removed.title, { exact: true })).toBeVisible();
  await screenshot(page, testInfo, "delete-single-confirmation");
  await dialog.getByRole("button", { name: "永久删除", exact: true }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText("已永久删除 1 项作品。", { exact: true })).toBeVisible();
  await expect(restoreButton(page, removed.title)).toHaveCount(0);
  await expect(restoreButton(page, retained.title)).toBeVisible();
  await expectBoardUnavailable(page, studio, removed);
  await screenshot(page, testInfo, "single-deletion-retains-other");
});
