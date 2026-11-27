import { expect, screenshot, test } from "../support/studio.mjs";

const archiveParagraph = "把发布范围、设计说明和验收任务放在同一张白板上。";

function button(scope, name) {
  return scope.getByRole("button", { name, exact: true });
}

function openButton(page, title) {
  return button(page, "打开白板：" + title);
}

function action(page, name) {
  return page.getByRole("menuitem", { name, exact: true });
}

async function openBoardMenu(page, title) {
  await openButton(page, title).hover();
  const trigger = button(page, "管理作品：" + title);
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
}

async function runBoardAction(page, title, operation) {
  await openBoardMenu(page, title);
  await action(page, operation).click();
}

async function chooseDirectory(page, option) {
  await button(page, "筛选作品").click();
  await page.getByRole("menuitemradio", { name: option, exact: true }).click();
}

async function openRename(page, title) {
  await runBoardAction(page, title, "重命名");
  const dialog = page.getByRole("dialog", { name: "重命名作品", exact: true });
  const input = dialog.getByRole("textbox", { name: "作品名称", exact: true });
  await expect(input).toHaveValue(title);

  return { dialog, input };
}

function boardIdAt(page, studio) {
  const key = studio.edition === "initial" ? "artifactId" : "board";

  return new URL(page.url()).searchParams.get(key);
}

async function expectSavedContents(page, board, contentText = board.contentText) {
  await expect(page.getByText(contentText, { exact: true })).toBeVisible();
  await expect(page.getByText(archiveParagraph, { exact: true })).toBeVisible();
  const image = page.getByRole("img", { name: board.contentImage, exact: true });
  await expect(image).toBeVisible();
  await expect(image).toHaveJSProperty("complete", true);
  await expect(image).not.toHaveJSProperty("naturalWidth", 0);
}

async function expectLocalAccess(page) {
  await button(page, "分享").click();
  const permissions = button(page, "一般访问权限");
  await expect(permissions).toHaveText("仅这台电脑");
  await expect(permissions).toBeEnabled();

  return permissions;
}

async function editCopiedText(page, sourceText, newText) {
  await page.getByText(sourceText, { exact: true }).dblclick();
  const editor = page.getByRole("textbox", { name: "编辑文字", exact: true });
  await expect(editor).toBeEditable();
  await editor.fill(newText);
  await editor.press("Escape");
  await expect(editor).toBeHidden();
  await expect(page.getByText(newText, { exact: true })).toBeVisible();

  await button(page, "版本历史").click();
  const saved = page.getByRole("button", { name: "展开版本 1", exact: true });
  await expect(saved).toContainText("当前版本");
}

test("[WB-MANAGE-01] 三点菜单固定和取消固定，固定范围与刷新一致", async ({
  page,
  studio,
}, testInfo) => {
  const [selected, control] = await studio.seedBoards([
    { title: "工作台固定样板" },
    { title: "工作台普通样板" },
  ]);
  await page.goto(studio.url);
  await runBoardAction(page, selected.title, "固定");
  await chooseDirectory(page, "已固定");
  await expect(openButton(page, selected.title)).toBeVisible();
  await expect(openButton(page, control.title)).toHaveCount(0);
  await screenshot(page, testInfo, "pinned-workbench-board");

  await page.reload();
  await chooseDirectory(page, "已固定");
  await expect(openButton(page, selected.title)).toBeVisible();
  await runBoardAction(page, selected.title, "取消固定");
  await expect(openButton(page, selected.title)).toHaveCount(0);

  await chooseDirectory(page, "最近作品");
  await expect(openButton(page, selected.title)).toBeVisible();
  await expect(openButton(page, control.title)).toBeVisible();
  await openBoardMenu(page, selected.title);
  await expect(action(page, "固定")).toBeEnabled();
  await screenshot(page, testInfo, "unpinned-workbench-board");
});

test("[WB-MANAGE-02] 重命名支持取消、Esc 和保存后刷新", async ({ page, studio }, testInfo) => {
  const [board] = await studio.seedBoards([{ title: "待重命名白板" }]);
  const renamed = "已保存的新名称";
  await page.goto(studio.url);
  const cancelled = await openRename(page, board.title);
  await cancelled.input.fill("仅用于取消的草稿");
  await button(cancelled.dialog, "取消").click();
  await expect(cancelled.dialog).toBeHidden();
  await expect(openButton(page, board.title)).toBeVisible();
  await expect(openButton(page, "仅用于取消的草稿")).toHaveCount(0);

  const escaped = await openRename(page, board.title);
  await escaped.input.fill("仅用于退出的草稿");
  await escaped.input.press("Escape");
  await expect(escaped.dialog).toBeHidden();
  await expect(openButton(page, board.title)).toBeVisible();
  await expect(openButton(page, "仅用于退出的草稿")).toHaveCount(0);

  const pending = await openRename(page, board.title);
  const save = button(pending.dialog, "保存");
  await pending.input.fill("   ");
  await expect(save).toBeDisabled();
  await pending.input.fill(renamed);
  await screenshot(page, testInfo, "rename-valid-title");
  await save.click();
  await expect(pending.dialog).toBeHidden();
  await expect(openButton(page, renamed)).toBeVisible();
  await page.reload();
  await expect(openButton(page, renamed)).toBeVisible();
  await expect(openButton(page, board.title)).toHaveCount(0);
  await screenshot(page, testInfo, "renamed-title-after-refresh");
  await openButton(page, renamed).click();
  await expect.poll(() => boardIdAt(page, studio)).toBe(board.id);
});

test("[WB-MANAGE-03] 复制已保存正文和图片到可编辑的本机独立副本", async ({
  page,
  studio,
}, testInfo) => {
  const [source] = await studio.seedBoards([{ title: "发布资料原件", withContent: true }]);
  const copyTitle = source.title + " 副本";
  const editedText = "只写入副本的发布准备";
  await page.goto(studio.url);
  await runBoardAction(page, source.title, "复制作品");
  await expectSavedContents(page, source);
  const copyId = boardIdAt(page, studio);
  expect(copyId).toBeTruthy();
  expect(copyId).not.toBe(source.id);
  await screenshot(page, testInfo, "copied-saved-contents");

  const permissions = await expectLocalAccess(page);
  await screenshot(page, testInfo, "copied-local-permission");
  await permissions.press("Escape");
  await expect(permissions).toBeHidden();
  await editCopiedText(page, source.contentText, editedText);
  await page.reload();
  await expectSavedContents(page, source, editedText);
  await expect.poll(() => boardIdAt(page, studio)).toBe(copyId);

  await page.goto(source.url);
  await expectSavedContents(page, source);
  await expect(page.getByText(editedText, { exact: true })).toHaveCount(0);
  await expect.poll(() => boardIdAt(page, studio)).toBe(source.id);
  await screenshot(page, testInfo, "source-content-unchanged");

  await page.goto(studio.url);
  await expect(openButton(page, source.title)).toBeVisible();
  await expect(openButton(page, copyTitle)).toBeVisible();
  await expect(button(page, "管理作品：" + copyTitle)).toBeEnabled();
});

test("[WB-MANAGE-04] 从工作台移入回收站并保留原作品记录", async ({ page, studio }, testInfo) => {
  const [removed, control] = await studio.seedBoards([
    { title: "从工作台移入的白板", withContent: true },
    { title: "留在工作台的白板" },
  ]);
  await page.goto(studio.url);
  await openBoardMenu(page, removed.title);
  await screenshot(page, testInfo, "workbench-move-to-trash-menu");
  await action(page, "移入回收站").click();
  await expect(openButton(page, removed.title)).toHaveCount(0);
  await expect(openButton(page, control.title)).toBeVisible();
  await chooseDirectory(page, "回收站");
  await expect(page.getByRole("heading", { name: "回收站", exact: true })).toBeVisible();
  await expect(openButton(page, removed.title)).toBeDisabled();
  await expect(button(page, "恢复作品：" + removed.title)).toBeEnabled();
  await expect(openButton(page, control.title)).toHaveCount(0);
  await screenshot(page, testInfo, "original-workbench-trash-record");

  const originalLink = await page.context().newPage();
  try {
    await originalLink.goto(removed.url);
    await expectSavedContents(originalLink, removed);
    await expect.poll(() => boardIdAt(originalLink, studio)).toBe(removed.id);
  } finally {
    await originalLink.close();
  }
});
