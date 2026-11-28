import {
  controlNextTextSave,
  expect,
  observe,
  readCanvas,
  readPeerCursors,
  readPlacementPreview,
  screenshot,
  test,
  workbenchLinkProbe,
} from "../support/studio.mjs";

const title = "画布附加操作样板";
const object = {
  id: "shape-a",
  kind: "shape",
  label: "备注目标对象",
  x: 180,
  y: 140,
  width: 190,
  height: 110,
};

function button(scope, name) {
  return scope.getByRole("button", { name, exact: true });
}

function notePin(page, text) {
  return page.getByRole("button", { name: new RegExp("^备注 .*：" + text + "$") });
}

async function openSample(page, studio) {
  const board = await studio.seedBasicBoard({ title, objects: [object] });
  await page.goto(board.url);
  await expect(page.getByRole("textbox", { name: "白板名称", exact: true })).toHaveValue(title);
  await expect(page.getByText(object.label, { exact: true })).toBeVisible();
  return board;
}

function center(box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function objectBox(frame) {
  const box = frame.objects.find((item) => item.id === object.id)?.box;
  if (!box) {
    throw new Error("The seeded whiteboard object is not visible in this viewport.");
  }

  return box;
}

function awayFromObjects(frame) {
  return { x: frame.bounds.x + 48, y: frame.bounds.y + 150 };
}

async function saveFloatingNote(page, text) {
  const input = page.getByRole("textbox", { name: "批注内容", exact: true });
  await expect(input).toBeVisible();
  await input.fill(text);
  await button(page, "保存备注").click();
  await expect(input).toHaveCount(0);
  await expect(notePin(page, text)).toBeVisible();
}

async function preset(page, percent) {
  const zoom = button(page, "缩放菜单");
  await zoom.click();
  const menu = page.getByRole("menu", { name: "缩放与视图", exact: true });
  await menu.getByRole("menuitem", { name: `${percent}%`, exact: true }).click();
  await expect(zoom).toHaveText(`${percent}%`);
}

function viewpointMatches(left, right) {
  return (
    Math.abs(left.zoom - right.zoom) < 0.001 &&
    Math.abs(left.pan.x - right.pan.x) < 0.5 &&
    Math.abs(left.pan.y - right.pan.y) < 0.5
  );
}

test("[EDIT-EXTRA-01] 数字 9 建立画布空位备注，点针回复并刷新回读", async ({
  page,
  studio,
}, testInfo) => {
  await openSample(page, studio);
  const before = await readCanvas(page, studio);
  const point = awayFromObjects(before);
  const note = "核对发布边界";
  const reply = "本轮只复查画布范围";

  await page.mouse.click(point.x, point.y);
  await page.keyboard.press("9");
  await page.mouse.click(point.x + 32, point.y + 38);
  await expect(page.getByRole("textbox", { name: "批注内容", exact: true })).toBeVisible();
  await screenshot(page, testInfo, "board-point-note-draft");
  await saveFloatingNote(page, note);

  await notePin(page, note).click();
  const composer = page.getByRole("textbox", { name: "回复批注：" + note, exact: true });
  await composer.fill(reply);
  await button(page, "发送回复").click();
  await expect(page.getByText(reply, { exact: true })).toBeVisible();
  await page.reload();
  await expect(notePin(page, note)).toBeVisible();
  await notePin(page, note).click();
  await expect(page.getByText(note, { exact: true })).toBeVisible();
  await expect(page.getByText(reply, { exact: true })).toBeVisible();
  await screenshot(page, testInfo, "board-point-note-reopened");
});

test("[EDIT-EXTRA-02] 选区浮动备注可保存并从画布针点打开", async ({ page, studio }, testInfo) => {
  await openSample(page, studio);
  const frame = await readCanvas(page, studio);
  const target = center(objectBox(frame));
  await page.mouse.click(target.x, target.y);
  await button(page, "备注所选元素").click();
  const composer = page.getByRole("textbox", { name: "批注内容", exact: true });
  await expect(composer).toBeVisible();
  await screenshot(page, testInfo, "selected-object-note-draft");

  const note = "对象位置已核对";
  await saveFloatingNote(page, note);
  await notePin(page, note).click();
  await expect(page.getByText(note, { exact: true })).toBeVisible();
  await button(page, "解决").click();
  await expect(notePin(page, note)).toHaveCount(0);

  await button(page, "备注列表").click();
  const showResolved = page.getByRole("checkbox", { name: "显示已解决", exact: true });
  await showResolved.click();
  const resolved = page.getByRole("button", {
    name: new RegExp("^备注 .*（已解决）：" + note + "$"),
  });
  await expect(resolved).toBeVisible();
  await screenshot(page, testInfo, "selected-object-note-resolved");

  await resolved.click();
  const reply = "重新打开以核对位置变化";
  await page.getByRole("textbox", { name: "回复批注：" + note, exact: true }).fill(reply);
  await button(page, "发送回复").click();
  await expect(page.getByText(reply, { exact: true })).toBeVisible();
  await expect(resolved).toHaveCount(0);
  await expect(notePin(page, note)).toBeVisible();
  await screenshot(page, testInfo, "selected-object-note-reopened");
});

test("[EDIT-EXTRA-03] 记录 Web 白板重载及从工作台重开的视口状态", async ({
  page,
  studio,
}, testInfo) => {
  const board = await openSample(page, studio);
  const opening = await readCanvas(page, studio);
  await preset(page, 150);
  const zoomed = await readCanvas(page, studio);
  expect(zoomed.zoom).toBeCloseTo(1.5, 2);
  expect(viewpointMatches(opening, zoomed)).toBe(false);
  await screenshot(page, testInfo, "web-viewport-before-return");

  await button(page, studio.workbenchBackLabel).click();
  await button(page, "打开白板：" + board.title).click();
  await expect(page.getByText(object.label, { exact: true })).toBeVisible();
  const returned = await readCanvas(page, studio);
  await screenshot(page, testInfo, "web-viewport-after-return");

  await preset(page, 150);
  const beforeReload = await readCanvas(page, studio);
  await page.reload();
  await expect(page.getByText(object.label, { exact: true })).toBeVisible();
  const reloaded = await readCanvas(page, studio);
  await screenshot(page, testInfo, "web-viewport-after-reload");
  await observe(testInfo, "web-viewport-reopen-state", {
    retainedFromWorkbench: viewpointMatches(zoomed, returned),
    retainedAfterReload: viewpointMatches(beforeReload, reloaded),
  });
});

test("[EDIT-EXTRA-04] 第二窗口看见房主光标和拖动预览，松手后才保存", async ({
  page,
  browser,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({ title, objects: [object] });
  const probe = await workbenchLinkProbe({ page, browser, studio });
  try {
    await page.goto(studio.url);
    const card = button(page, "打开白板：" + board.title);
    await card.hover();
    await button(page, "管理作品：" + board.title).click();
    await page.getByRole("menuitem", { name: "复制链接", exact: true }).click();
    await expect(page.getByText("链接已复制。", { exact: true })).toBeVisible();
    const guest = await probe.openGuest(board);
    await guest.getByRole("textbox", { name: /你的名字/u }).fill("协作观察员");
    await button(guest, "打开白板").click();
    await expect(guest.getByText(object.label, { exact: true })).toBeVisible();

    await card.click();
    await expect(page.getByText(object.label, { exact: true })).toBeVisible();
    const before = await studio.readBoard(board);
    const ownerView = await readCanvas(page, studio);
    const priorGuestBox = objectBox(await readCanvas(guest, studio));
    const pointer = awayFromObjects(ownerView);
    await page.mouse.move(pointer.x, pointer.y);
    await expect.poll(async () => (await readPeerCursors(guest, studio)).length).toBeGreaterThan(0);
    await screenshot(guest, testInfo, "observer-canvas-cursor");

    const source = center(objectBox(ownerView));
    const ghost = guest.getByLabel(/正在调整对象$/u);
    await page.mouse.move(source.x, source.y);
    await page.mouse.down();
    try {
      await page.mouse.move(source.x + 92, source.y + 44, { steps: 6 });
      if (studio.edition === "initial") {
        await expect(ghost).toBeVisible();
      } else {
        await expect
          .poll(async () => objectBox(await readCanvas(guest, studio)).x)
          .toBeGreaterThan(priorGuestBox.x + 25);
      }

      expect(await studio.readBoard(board)).toEqual(before);
      await screenshot(guest, testInfo, "observer-live-drag-preview");
    } finally {
      await page.mouse.up();
    }

    await expect
      .poll(async () => (await studio.readBoard(board)).revision)
      .toBeGreaterThan(before.revision);
    await expect
      .poll(async () => objectBox(await readCanvas(guest, studio)).x)
      .toBeGreaterThan(priorGuestBox.x + 25);
    await expect(ghost).toHaveCount(0);
    await screenshot(guest, testInfo, "observer-after-drag-commit");
  } finally {
    await probe.close();
  }
});

test("[EDIT-EXTRA-05] 一次文字保存未送达后重载，从本机草稿恢复正文", async ({
  page,
  studio,
}, testInfo) => {
  const original = "上次已保存文字";
  const draft = "本机恢复的正文";
  const textId = "staged-text";
  const board = await studio.seedBasicBoard({
    title,
    objects: [{ ...object, id: textId, kind: "text", label: original }],
  });
  await page.goto(board.url);
  const initialText = page.getByText(original, { exact: true });
  await expect(initialText).toBeVisible();
  const failure = await controlNextTextSave(page, studio, { boardId: board.id, objectId: textId });

  await initialText.dblclick();
  const editor = page.getByRole("textbox", { name: "编辑文字", exact: true });
  await editor.fill(draft);
  await button(page.getByRole("toolbar", { name: "白板工具" }), "选择").click();
  await failure.observed;
  const retry = studio.edition === "initial" ? "核对上次保存" : "重试原保存";
  await expect(button(page, retry).first()).toBeVisible();
  expect((await studio.readBoard(board)).objects.find((item) => item.id === textId)?.text).toBe(
    original,
  );
  await page.reload();
  await expect(initialText).toBeVisible();

  const apply = button(page, "应用已比较的草稿");
  if (studio.edition === "ii") {
    await button(page, "本机草稿").click();
    await button(page, "文字草稿 · " + textId).click();
  } else {
    await button(page, "比较本机草稿").click();
    const comparison = page.getByRole("dialog", { name: "比较本机草稿", exact: true });
    await expect(comparison.getByRole("textbox", { name: "当前已保存内容" })).toHaveValue(
      new RegExp(original),
    );
    await expect(comparison.getByRole("textbox", { name: "本机草稿" })).toHaveValue(
      new RegExp(draft),
    );
    await button(comparison, "恢复为本视图草稿").click();
  }

  await expect(apply).toBeEnabled();
  await screenshot(page, testInfo, "text-draft-recovery-entry");
  await apply.click();
  if (studio.edition === "initial") {
    await expect(editor).toHaveText(draft);
  } else {
    await expect
      .poll(
        async () =>
          (await studio.readBoard(board)).objects.find((item) => item.id === textId)?.text,
      )
      .toBe(draft);
    await page.reload();
    await expect(page.getByText(draft, { exact: true })).toBeVisible();
  }

  await screenshot(page, testInfo, "text-draft-recovered");
});

test("[EDIT-EXTRA-07] 从画布针点编辑备注与回复，取消删除后可确认移除", async ({
  page,
  studio,
}, testInfo) => {
  await openSample(page, studio);
  const target = center(objectBox(await readCanvas(page, studio)));
  await page.mouse.click(target.x, target.y);
  await button(page, "备注所选元素").click();
  const original = "位置待确认";
  const updated = "新位置已确认";
  await saveFloatingNote(page, original);
  await notePin(page, original).click();
  const editor = page.getByRole("textbox", { name: "编辑备注内容", exact: true });
  await button(page, "备注操作").click();
  await page.getByRole("menuitem", { name: "编辑", exact: true }).click();
  await expect(editor).toHaveValue(original);
  await editor.fill(updated);
  await button(page, "保存").click();
  await expect(notePin(page, updated)).toBeVisible();

  const originalReply = "核对备注";
  const updatedReply = "核对完成";
  await page
    .getByRole("textbox", { name: "回复批注：" + updated, exact: true })
    .fill(originalReply);
  await button(page, "发送回复").click();
  await expect(page.getByText(originalReply, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^回复操作：/u }).click();
  await page.getByRole("menuitem", { name: "编辑回复", exact: true }).click();
  await expect(editor).toHaveValue(originalReply);
  await editor.fill(updatedReply);
  await button(page, "保存").click();
  await expect(page.getByText(updatedReply, { exact: true })).toBeVisible();
  await expect(page.getByText(originalReply, { exact: true })).toHaveCount(0);
  await screenshot(page, testInfo, "canvas-note-edited");

  const confirmation = page.getByRole("group", { name: "删除备注确认", exact: true });
  const deleteAction = () => page.getByRole("menuitem", { name: "删除备注线程", exact: true });
  await button(page, "备注操作").click();
  await deleteAction().click();
  await expect(confirmation).toBeVisible();
  await screenshot(page, testInfo, "canvas-note-delete-confirmation");
  await button(confirmation, "取消").click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByText(updatedReply, { exact: true })).toBeVisible();

  await button(page, "备注操作").click();
  await deleteAction().click();
  await confirmation.getByRole("button", { name: /^(确认)?删除$/u }).click();
  await expect(notePin(page, updated)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(object.label, { exact: true })).toBeVisible();
  await expect(notePin(page, updated)).toHaveCount(0);
  await screenshot(page, testInfo, "canvas-note-removed");
});

test("[EDIT-EXTRA-06] 放置形状时显示随缩放变化的预览，只有点击后才创建作品", async ({
  page,
  studio,
}, testInfo) => {
  const [board] = await studio.seedBoards([{ title }]);
  await page.goto(board.url);
  await expect(page.getByText("从一个想法开始", { exact: true })).toBeVisible();
  const tool = button(page.getByRole("toolbar", { name: "白板工具" }), "形状");
  await tool.click();
  await button(page, "形状 矩形").click();
  const before = await readCanvas(page, studio);
  const pointer = { x: before.bounds.x + 240, y: before.bounds.y + 210 };
  await page.mouse.move(pointer.x, pointer.y);
  await expect
    .poll(async () => (await readPlacementPreview(page, studio))?.width ?? 0)
    .toBeGreaterThan(0);
  const preview = await readPlacementPreview(page, studio);
  expect(preview.x).toBeCloseTo(pointer.x, 0);
  expect(preview.y).toBeCloseTo(pointer.y, 0);
  const unplaced = await studio.readBoard(board);
  expect(unplaced.objects).toHaveLength(0);
  await screenshot(page, testInfo, "placement-before-click");

  await page.keyboard.down("Control");
  try {
    await page.mouse.wheel(0, -80);
  } finally {
    await page.keyboard.up("Control");
  }

  await expect.poll(async () => (await readCanvas(page, studio)).zoom).toBeGreaterThan(before.zoom);
  await expect
    .poll(async () => (await readPlacementPreview(page, studio))?.width ?? 0)
    .toBeGreaterThan(preview.width);
  await expect(tool).toHaveAttribute("aria-pressed", "true");
  expect(await studio.readBoard(board)).toEqual(unplaced);
  await page.mouse.click(pointer.x, pointer.y);
  await expect
    .poll(async () => (await studio.readBoard(board)).objects.map(({ kind }) => kind))
    .toEqual(["shape"]);
  await expect.poll(() => readPlacementPreview(page, studio)).toBeNull();
  await screenshot(page, testInfo, "placement-after-click");
});

test("[EDIT-EXTRA-08] 36% 下文字、贴纸、表格、待办和文档保留真实放置预览", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({
    title,
    objects: [
      object,
      {
        id: "preview-html",
        kind: "html",
        label: "已有 HTML",
        html: "<main><button>HTML 卡片</button></main>",
        x: 820,
        y: 185,
        width: 440,
        height: 240,
      },
    ],
  });
  await page.goto(board.url);
  await expect(page.getByText(object.label, { exact: true })).toBeVisible();
  await preset(page, 25);
  const frame = await readCanvas(page, studio);
  const anchor = center(frame.bounds);
  await page.mouse.move(anchor.x, anchor.y);
  await page.keyboard.down("Control");
  try {
    await page.mouse.wheel(0, -120);
    await page.mouse.wheel(0, -120);
  } finally {
    await page.keyboard.up("Control");
  }

  await expect(button(page, "缩放菜单")).toHaveText("36%");
  const view = await readCanvas(page, studio);
  const html = view.objects.find(({ id }) => id === "preview-html");
  const htmlPoint = center(html.box);
  const original = await studio.readBoard(board);
  const blank = { x: view.bounds.x + 355, y: view.bounds.y + 194 };
  const tools = page.getByRole("toolbar", { name: "白板工具" });
  await button(tools, "文字").click();
  await page.mouse.move(blank.x, blank.y);
  await expect
    .poll(async () => (await readPlacementPreview(page, studio, "text"))?.textLineWidth)
    .toBeGreaterThan(55);
  const text = await readPlacementPreview(page, studio, "text");
  expect(text.x).toBeCloseTo(blank.x, 0);
  expect(text.y).toBeCloseTo(blank.y, 0);
  await screenshot(page, testInfo, "placement-text-at-36");

  await button(tools, "贴纸").click();
  await button(page, "贴纸 爱心").click();
  await page.mouse.move(blank.x, blank.y);
  await expect
    .poll(async () => (await readPlacementPreview(page, studio, "sticker"))?.sticker)
    .toBe("heart");
  const heart = await readPlacementPreview(page, studio, "sticker");
  expect(heart.iconWidth).toBeGreaterThan(15);
  expect(heart.x).toBeCloseTo(blank.x, 0);
  expect(heart.y).toBeCloseTo(blank.y, 0);
  await screenshot(page, testInfo, "placement-heart-at-36");

  await button(tools, "形状").click();
  await button(page, "表格").click();
  await page.mouse.move(htmlPoint.x, htmlPoint.y);
  await expect
    .poll(async () => (await readPlacementPreview(page, studio, "table"))?.rows)
    .toEqual([3, 3, 3]);
  const grid = await readPlacementPreview(page, studio, "table");
  expect(grid.x).toBeCloseTo(htmlPoint.x, 0);
  expect(grid.y).toBeCloseTo(htmlPoint.y, 0);
  expect(grid.width).toBeGreaterThan(160);
  expect(grid.gridLines).toEqual(["solid", "solid"]);
  await screenshot(page, testInfo, "placement-table-over-html-at-36");

  await button(tools, "形状").click();
  await button(page, "添加任务清单").click();
  await page.mouse.move(htmlPoint.x, htmlPoint.y);
  await expect
    .poll(async () => (await readPlacementPreview(page, studio, "todo"))?.progress)
    .toBe("0/0 完成");
  const todo = await readPlacementPreview(page, studio, "todo");
  expect(todo.x).toBeCloseTo(htmlPoint.x, 0);
  expect(todo.y).toBeCloseTo(htmlPoint.y, 0);
  expect(todo.width).toBeGreaterThan(185);
  expect(todo.height).toBeGreaterThan(145);
  expect(todo.progressWidth).toBeGreaterThan(15);
  expect(todo.text).toMatch(/任务清单/u);
  await screenshot(page, testInfo, "placement-todo-over-html-at-36");

  await page.emulateMedia({ colorScheme: "light" });
  await button(tools, "选择").click();
  await button(tools, "形状").click();
  await button(page, "添加文档区域").click();
  await page.mouse.move(htmlPoint.x, htmlPoint.y);
  await expect
    .poll(async () => (await readPlacementPreview(page, studio, "document"))?.documentBorder)
    .toBe("dashed");
  const document = await readPlacementPreview(page, studio, "document");
  expect(document.x).toBeCloseTo(htmlPoint.x, 0);
  expect(document.y).toBeCloseTo(htmlPoint.y, 0);
  expect(document.width).toBeGreaterThan(235);
  expect(document.height).toBeGreaterThan(195);
  expect(document.iconWidth).toBeGreaterThan(4);
  expect(document.text).toMatch(/文档/u);
  expect(document.text).not.toMatch(/暂未取得文档正文/u);
  await screenshot(page, testInfo, "placement-document-over-html-at-36-light");

  expect(await studio.readBoard(board)).toEqual(original);
});
