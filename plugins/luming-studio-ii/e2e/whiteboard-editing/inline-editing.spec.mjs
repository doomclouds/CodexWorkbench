import {
  expect,
  holdNextInlineTextRefresh,
  holdNextInlineTextWrite,
  observe,
  screenshot,
  test,
} from "../support/studio.mjs";

const shape = {
  id: "inline-shape",
  kind: "shape",
  outline: "rounded",
  fill: "#EFEFEF",
  label: "交付与反馈",
  x: 200,
  y: 170,
  width: 210,
  height: 56,
};
const note = {
  id: "inline-note",
  kind: "note",
  fill: "#F9E56F",
  label: "便签正文",
  x: 480,
  y: 195,
  width: 208,
  height: 184,
};
const section = {
  id: "inline-section",
  kind: "section",
  label: "分区入口",
  x: 260,
  y: 200,
  width: 360,
  height: 230,
};

function editor(page) {
  return page.getByRole("textbox", { name: "编辑文字", exact: true });
}

function objectLabel(page, label) {
  return page.getByText(label, { exact: true });
}

async function beginEditing(page, label) {
  await objectLabel(page, label).dblclick();
  await expect(editor(page)).toBeFocused();
}

async function expectSavedText(studio, board, object, text) {
  await expect
    .poll(
      async () => (await studio.readBoard(board)).objects.find(({ id }) => id === object.id)?.text,
    )
    .toBe(text);
}

async function linkRoundTrip(page, studio, board, object, testInfo) {
  const popover = page.getByRole("dialog", { name: "文字链接", exact: true });
  const address = popover.getByRole("textbox", { name: "链接地址", exact: true });
  const link = editor(page).getByRole("link", { name: object.label, exact: true });
  const url = "https://example.com/plan";
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+k");
  await expect(address).toBeFocused();
  await address.fill(url);
  await page.keyboard.press("Enter");
  await expect(popover).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
  await expect(link).toHaveAttribute("href", url);
  await expect(link).toHaveCSS("text-decoration-line", "underline");
  if (object.kind === "note") {
    await expect(link).toHaveCSS("color", "rgb(20, 53, 110)");
  }

  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Control+k");
  await expect(address).toHaveValue(url);
  await screenshot(page, testInfo, "inline-" + object.kind + "-link-popover");
  await address.fill("https://example.com/unfinished");
  await popover.getByRole("button", { name: "取消链接编辑", exact: true }).click();
  await expect(link).toHaveAttribute("href", url);

  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Control+k");
  await popover.getByRole("button", { name: "移除链接", exact: true }).click();
  await expect(editor(page)).toBeFocused();
  await expect(link).toHaveCount(0);
  await page.keyboard.press("Escape");
  const saved = object.kind === "note" ? "**" + object.label + "**" : object.label;
  await expectSavedText(studio, board, object, saved);
  await page.reload();
  await expect(objectLabel(page, object.label)).toBeVisible();
  await expect(page.getByRole("link", { name: object.label, exact: true })).toHaveCount(0);
}

async function editTextDuringColorChange(page, studio, board, current) {
  await beginEditing(page, current);
  const text = "正文和颜色都保留";
  const revision = (await studio.readBoard(board)).revision;
  const pending = await holdNextInlineTextWrite(page, studio, {
    boardId: board.id,
    objectId: shape.id,
  });

  try {
    await editor(page).fill(text);
    await pending.received;
    await page.getByRole("button", { name: "文字颜色", exact: true }).click();
    await page.getByRole("button", { name: "墨色 绿色", exact: true }).click();
    await expect.poll(async () => (await studio.readBoard(board)).revision).not.toBe(revision);
  } finally {
    pending.release();
  }

  await expectSavedText(studio, board, shape, text);
  await expect(page.getByText("正文已被其他操作修改。", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "本机草稿", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(objectLabel(page, text)).toHaveCSS("color", "rgb(46, 139, 87)");
  await objectLabel(page, text).click();
  await page.getByRole("button", { name: "文字颜色", exact: true }).click();
  const white = page.getByRole("button", { name: "墨色 白色", exact: true });
  await expect(white).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await white.click();
  await expect(objectLabel(page, text)).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.reload();
  await expect(objectLabel(page, text)).toHaveCSS("color", "rgb(255, 255, 255)");
}

test("[EDIT-TEXT-01] 放大编辑形状和便签时保留选区格式入口，内容内只显示文字编辑", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({ title: "行内格式验收", objects: [shape, note] });
  await page.goto(board.url);
  await page.getByRole("button", { name: "缩放菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "150%", exact: true }).click();

  for (const object of [shape, note]) {
    await beginEditing(page, object.label);
    await expect(page.getByRole("toolbar", { name: "文字格式", exact: true })).toHaveCount(0);
    await expect(page.getByRole("toolbar", { name: "选区格式", exact: true })).toBeVisible();
    await screenshot(page, testInfo, "inline-" + object.kind + "-edit");
    await editor(page).fill(object.label);
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+b");
    await page.keyboard.press("Escape");
    await expectSavedText(studio, board, object, "**" + object.label + "**");
    await expect(objectLabel(page, object.label)).toHaveCSS("font-weight", "700");
  }

  if (studio.edition === "ii") {
    await expect(objectLabel(page, shape.label)).toHaveCSS("color", "rgb(17, 24, 39)");
    await expect(objectLabel(page, note.label)).toHaveCSS("color", "rgb(17, 24, 39)");
    await beginEditing(page, note.label);
    await linkRoundTrip(page, studio, board, note, testInfo);
    const sectionBoard = await studio.seedBasicBoard({ title: "分区链接验收", objects: [section] });
    await page.goto(sectionBoard.url);
    await objectLabel(page, section.label).click();
    await page.getByRole("button", { name: "更多操作", exact: true }).click();
    await page.getByRole("menuitem", { name: /^重命名分区/u }).click();
    await expect(editor(page)).toBeFocused();
    await linkRoundTrip(page, studio, sectionBoard, section, testInfo);
  }

  await observe(testInfo, "inline-format-entry", { embeddedToolbar: false, boldSaved: 2 });
});

test("[EDIT-TEXT-02] 暂停输入与确认正文刷新期间可以直接续写", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({ title: "连续输入验收", objects: [shape, note] });
  await page.goto(board.url);
  await beginEditing(page, shape.label);
  const gate =
    studio.edition === "ii"
      ? await holdNextInlineTextRefresh(page, studio, { boardId: board.id, objectId: shape.id })
      : undefined;
  const draft = "abc";
  const continuation = "，不用再点一次";
  try {
    await page.keyboard.press("Control+a");
    await page.keyboard.type(draft);
    await expect(editor(page)).toHaveText(draft);
    if (gate) {
      await gate.saved;
      await gate.refreshing;
      await expectSavedText(studio, board, shape, draft);
    }

    await expect(editor(page)).toBeFocused();
    await expect(page.getByText("正在保存文字", { exact: true })).toHaveCount(0);
    await screenshot(page, testInfo, "inline-save-pending");
    gate?.release();
    await gate?.waitForReply();
    await expect(editor(page)).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.insertText(continuation);
    await expect(editor(page)).toHaveText(draft + continuation);
    await page.keyboard.press("Escape");
    await expectSavedText(studio, board, shape, draft + continuation);
    await expectSavedText(studio, board, note, note.label);
    expect((await studio.readBoard(board)).objects).toHaveLength(2);
    await page.reload();
    await expect(objectLabel(page, draft + continuation)).toBeVisible();
    await screenshot(page, testInfo, "inline-continuation-reopened");
    if (studio.edition === "ii") {
      await editTextDuringColorChange(page, studio, board, draft + continuation);
    }
    await observe(testInfo, "inline-resumes-after-pause", {
      refocus: false,
      continuationSaved: true,
    });
  } finally {
    gate?.release();
  }
});
