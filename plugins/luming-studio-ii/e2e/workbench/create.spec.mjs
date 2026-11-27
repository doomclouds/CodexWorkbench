import {
  expect,
  interceptNextBoardCreation,
  observe,
  screenshot,
  test,
} from "../support/studio.mjs";

const newTitle = "未命名白板";

const card = (page) =>
  page
    .getByRole("region", { name: "新建作品", exact: true })
    .getByRole("button", { name: "新建白板", exact: true });
const createMenu = (page) => page.getByRole("button", { name: "新建作品", exact: true });
const openBoard = (page, title) =>
  page.getByRole("button", { name: "打开白板：" + title, exact: true });
const back = (page, studio) =>
  page.getByRole("button", { name: studio.workbenchBackLabel, exact: true });
const titleField = (page) => page.getByRole("textbox", { name: "白板名称", exact: true });

function boardId(page, studio) {
  const parameter = studio.edition === "initial" ? "artifactId" : "board";

  return new URL(page.url()).searchParams.get(parameter);
}

async function expectEmptyBoard(page, studio) {
  await expect(titleField(page)).toHaveValue(newTitle);
  await expect(page.getByText("从一个想法开始", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "添加文档", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "添加 HTML 图解", exact: true })).toBeEnabled();
  await expect.poll(() => boardId(page, studio)).toBeTruthy();

  return boardId(page, studio);
}

async function expectSameBoardAfterRefresh(page, studio, id, testInfo) {
  await back(page, studio).click();
  const result = openBoard(page, newTitle);
  await expect(result).toHaveCount(1);
  await page.reload();
  await expect(result).toHaveCount(1);
  await screenshot(page, testInfo, "created-workbench-card-after-refresh");
  await result.click();
  expect(await expectEmptyBoard(page, studio)).toBe(id);
  await observe(testInfo, "created-board-persisted", {
    empty: true,
    boardCount: 1,
    sameBoard: true,
  });
}

test("[WB-CREATE-01] 工作台大卡创建空白板并从刷新列表重新打开", async ({
  page,
  studio,
}, testInfo) => {
  await page.goto(studio.url);
  await expect(card(page)).toBeVisible();
  await screenshot(page, testInfo, "new-board-card");
  await card(page).click();
  const id = await expectEmptyBoard(page, studio);
  await screenshot(page, testInfo, "created-empty-board");
  await expectSameBoardAfterRefresh(page, studio, id, testInfo);
});

test("[WB-CREATE-02] 从加号菜单选择白板并确认只创建一个作品", async ({
  page,
  studio,
}, testInfo) => {
  await page.goto(studio.url);
  const trigger = createMenu(page);
  await trigger.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "新建作品", exact: true });
  await expect(menu.getByRole("menuitem", { name: "白板", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "导入作品", exact: true })).toBeVisible();
  await screenshot(page, testInfo, "new-board-menu");
  await menu.getByRole("menuitem", { name: "白板", exact: true }).press("Enter");
  const id = await expectEmptyBoard(page, studio);
  await screenshot(page, testInfo, "created-empty-board");
  await expectSameBoardAfterRefresh(page, studio, id, testInfo);
});

test("[WB-CREATE-03] 等待真实创建回包时停留工作台并拦住重复点击", async ({
  page,
  studio,
}, testInfo) => {
  await page.goto(studio.url);
  const gate = await interceptNextBoardCreation(page, studio, "hold-reply");
  try {
    await card(page).click();
    await gate.received;
    await expect(card(page)).toBeDisabled();
    await expect(createMenu(page)).toBeDisabled();
    await card(page).click({ force: true });
    await createMenu(page).click({ force: true });
    await expect(titleField(page)).toHaveCount(0);
    expect(boardId(page, studio)).toBeNull();
    await screenshot(page, testInfo, "creation-awaiting-receipt");
  } finally {
    gate.release();
  }

  await gate.finished;
  const id = await expectEmptyBoard(page, studio);
  await observe(testInfo, "creation-receipt-gate", { waited: true, bothEntriesBlocked: true });
  await expectSameBoardAfterRefresh(page, studio, id, testInfo);
});

test("[WB-CREATE-04] 请求写入前中断后可以重试且只保留一次创建", async ({
  page,
  studio,
}, testInfo) => {
  await page.goto(studio.url);
  const fault = await interceptNextBoardCreation(page, studio, "reject");
  await card(page).click();
  await fault.received;
  const retryLabel = studio.edition === "initial" ? "重试" : "重试原创建";
  const retry = page.getByRole("button", { name: retryLabel, exact: true });
  await expect(retry).toBeVisible();
  await expect(openBoard(page, newTitle)).toHaveCount(0);
  expect(boardId(page, studio)).toBeNull();
  await screenshot(page, testInfo, "creation-failed-before-write");
  await retry.click();
  const id = await expectEmptyBoard(page, studio);
  await observe(testInfo, "creation-retry", { stayedOnWorkbench: true, retried: true });
  await expectSameBoardAfterRefresh(page, studio, id, testInfo);
});

test("[WB-CREATE-05] 切到其他白板后迟到回包不重新跳转，返回可看到新白板", async ({
  page,
  studio,
}, testInfo) => {
  const existing = "继续查看当前白板";
  const [board] = await studio.seedBoards([{ title: existing }]);
  await page.goto(studio.url);
  await expect(openBoard(page, existing)).toBeVisible();
  const gate = await interceptNextBoardCreation(page, studio, "hold-reply");
  try {
    await card(page).click();
    await gate.received;
    await openBoard(page, existing).click();
    await expect(titleField(page)).toHaveValue(existing);
  } finally {
    gate.release();
  }

  await gate.finished;
  const notice = page.getByText(`作品已创建，可从 ${studio.workbenchTitle} 打开。`, {
    exact: true,
  });
  await expect(notice).toBeVisible();
  await expect.poll(() => boardId(page, studio)).toBe(board.id);
  await expect(titleField(page)).toHaveValue(existing);
  await screenshot(page, testInfo, "creation-late-receipt-current-board");
  await back(page, studio).click();
  await expect(openBoard(page, newTitle)).toHaveCount(1);
  await observe(testInfo, "creation-late-receipt", {
    keptViewing: true,
    createdCount: 1,
    confirmedWhileViewing: true,
  });
  await screenshot(page, testInfo, "creation-late-receipt-workbench");
  await openBoard(page, newTitle).click();
  expect(await expectEmptyBoard(page, studio)).not.toBe(board.id);
});
