import {
  controlNextCanvasSave,
  expect,
  observe,
  readCanvas,
  screenshot,
  test,
} from "../support/studio.mjs";

const shapes = [
  "圆角矩形",
  "矩形",
  "椭圆",
  "菱形",
  "胶囊",
  "六边形",
  "平行四边形",
  "数据库",
  "队列",
  "文档",
  "云",
  "人物",
];

function button(page, name) {
  return page.getByRole("button", { name, exact: true });
}

function tool(page, name) {
  return page.getByRole("toolbar", { name: "白板工具" }).getByRole("button", { name, exact: true });
}

function canvas(page, studio, board) {
  return page.getByLabel(studio.edition === "initial" ? "白板画布" : board.title, { exact: true });
}

function label(page, name) {
  return page.getByText(name, { exact: true });
}

function editor(page, name = "编辑文字") {
  return page.getByRole("textbox", { name, exact: true });
}

function select(page, name) {
  return page.getByRole("combobox", { name, exact: true });
}

function formObject(kind, id, name, x, y) {
  return { kind, id, label: name, x, y, width: 205, height: 130 };
}

async function open(page, studio, board) {
  await page.goto(board.url);
  const viewport = canvas(page, studio, board);
  await expect(viewport).toBeVisible();

  return viewport;
}

async function blank(page, studio, title) {
  const [board] = await studio.seedBoards([{ title }]);
  await open(page, studio, board);

  return board;
}

async function savedObject(studio, board, wanted) {
  await expect
    .poll(async () => (await studio.readBoard(board)).objects)
    .toEqual(expect.arrayContaining([expect.objectContaining(wanted)]));
}

async function changeFill(page, color) {
  await button(page, "填充颜色").click();
  const palette = page.getByRole("dialog", { name: "填充颜色" });
  await palette.getByRole("button", { name: "填充 " + color, exact: true }).click();
  if (await palette.isVisible()) {
    await page.keyboard.press("Escape");
  }
}

async function lineWidth(page, width, key = "Tab") {
  const input = page.getByRole("spinbutton", { name: "线条宽度" });
  await expect(input).toBeVisible();
  await input.fill(String(width));
  await input.press(key);

  return input;
}

async function selectCanvasObject(page, studio, kind) {
  const surface = await readCanvas(page, studio);
  const candidate = surface.objects.find((object) => object.kind === kind);
  expect(candidate?.box).toBeTruthy();
  const { x, y, width, height } = candidate.box;
  await page.mouse.click(x + width / 2, y + height / 2);
}

async function clickBoardPoint(page, studio, x, y) {
  const { bounds, zoom, pan } = await readCanvas(page, studio);
  await page.mouse.click(bounds.x + pan.x + x * zoom, bounds.y + pan.y + y * zoom);
}

test("[WB-OBJECT-01] 形状轮廓和填充线宽随对象保存", async ({ page, studio }, testInfo) => {
  const board = await blank(page, studio, "带格式的形状");
  await tool(page, "形状").click();
  await expect(page.getByRole("button", { name: /^形状 /u })).toHaveCount(shapes.length);
  for (const name of shapes) {
    await expect(button(page, "形状 " + name)).toBeVisible();
  }
  await screenshot(page, testInfo, "shape-palette");
  await button(page, "形状 矩形").click();
  await canvas(page, studio, board).click({ position: { x: 400, y: 195 } });
  await savedObject(studio, board, { kind: "shape", outline: "rect" });
  await page.reload();
  await expect(canvas(page, studio, board)).toBeVisible();
  await selectCanvasObject(page, studio, "shape");
  await expect(select(page, "形状类型")).toHaveValue("rect");
  await select(page, "形状类型").selectOption("document");
  await savedObject(studio, board, { kind: "shape", outline: "document" });
  await changeFill(page, "绿色");
  await savedObject(studio, board, { kind: "shape", fill: "#AEE2AB" });
  await button(page, "边框与线条").click();
  if (studio.edition === "ii") {
    const input = await lineWidth(page, 6, "Enter");
    await savedObject(studio, board, { kind: "shape", strokeWidth: 6 });
    await expect(input).toBeEditable();
    await expect(input).toBeFocused();
    await input.fill("7");
    await input.press("Enter");
  } else {
    await lineWidth(page, 7);
  }
  await savedObject(studio, board, { kind: "shape", outline: "document", strokeWidth: 7 });
  if (studio.edition === "ii") {
    const input = page.getByRole("spinbutton", { name: "线条宽度" });
    await expect(input).toBeEditable();
    await expect(input).toBeFocused();
    await expect(button(page, "虚线")).toBeVisible();
  } else if (!(await button(page, "虚线").isVisible())) {
    await button(page, "边框与线条").click();
  }
  const beforeDash = (await studio.readBoard(board)).revision;
  await button(page, "虚线").click();
  await expect
    .poll(async () => (await studio.readBoard(board)).revision)
    .toBeGreaterThan(beforeDash);
  const selected = (await studio.readBoard(board)).objects.find(({ kind }) => kind === "shape");
  expect(selected?.fill?.toUpperCase()).toBe("#AEE2AB");
  await observe(testInfo, "shape-styles", {
    variants: shapes.length,
    outline: selected.outline,
    width: selected.strokeWidth,
  });
  await page.reload();
  await expect(canvas(page, studio, board)).toBeVisible();
  await selectCanvasObject(page, studio, "shape");
  await expect(select(page, "形状类型")).toHaveValue("document");
  await button(page, "边框与线条").click();
  await expect(button(page, "虚线")).toHaveAttribute("aria-pressed", "true");
  await screenshot(page, testInfo, "saved-document-outline");
});

async function formatLabel(page, before, after) {
  await label(page, before).dblclick();
  const input = editor(page);
  await expect(input).toBeFocused();
  await input.fill(after);
  await expect(input).toHaveText(after);
  await input.press("Home");
  await input.press("Shift+End");
  await input.press("Control+b");
  await expect(input.getByText(after, { exact: true })).toHaveCSS("font-weight", "700");
  await tool(page, "选择").click();
  await expect(input).toHaveCount(0);
  await expect(label(page, after)).toHaveCSS("font-weight", "700");
}

test("[WB-OBJECT-02] 文字便签形状格式和中文正文保存后仍可读", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({
    title: "原生文字样式",
    objects: [
      formObject("shape", "labeled-shape", "形状原文字", 180, 170),
      formObject("text", "labeled-text", "普通原文字", 450, 170),
      formObject("note", "labeled-note", "便签原文字", 720, 170),
    ],
  });
  await open(page, studio, board);
  await formatLabel(page, "形状原文字", "形状加粗文字");
  await formatLabel(page, "普通原文字", "普通加粗文字");
  await formatLabel(page, "便签原文字", "便签加粗文字");
  await savedObject(studio, board, { id: "labeled-note", text: "**便签加粗文字**" });
  await label(page, "便签加粗文字").click();
  await changeFill(page, "粉色");
  await savedObject(studio, board, {
    id: "labeled-note",
    text: "**便签加粗文字**",
    fill: "#F7ABC9",
  });
  await screenshot(page, testInfo, "inline-bold-writing");

  await studio.restart();
  await page.emulateMedia({ colorScheme: "light" });
  await open(page, studio, board);
  for (const name of ["形状加粗文字", "普通加粗文字", "便签加粗文字"]) {
    await expect(label(page, name)).toHaveCSS("font-weight", "700");
  }
  await observe(testInfo, "inline-bold", { saved: 3 });
  await screenshot(page, testInfo, "light-saved-inline-writing");
});

async function drawStroke(page, viewport, straight) {
  const bounds = await viewport.boundingBox();
  expect(bounds).toBeTruthy();
  const x = bounds.x + 325;
  const y = bounds.y + (straight ? 345 : 170);
  if (straight) {
    await page.keyboard.down("Shift");
  }
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 42, { steps: 8 });
  await page.mouse.move(x + 125, y + 8, { steps: 8 });
  await page.mouse.up();
  if (straight) {
    await page.keyboard.up("Shift");
  }
}

test("[WB-OBJECT-03] 笔迹自由曲线与直线保存墨色和宽度", async ({ page, studio }, testInfo) => {
  const board = await blank(page, studio, "笔迹样式");
  const viewport = canvas(page, studio, board);
  await tool(page, "画笔").click();
  await button(page, "墨色 蓝色").click();
  const save =
    studio.edition === "ii"
      ? await controlNextCanvasSave(page, studio, {
          boardId: board.id,
          action: "create",
          mode: "hold",
        })
      : undefined;

  try {
    await drawStroke(page, viewport, false);
    if (save) {
      await save.observed;
      await expect(tool(page, "画笔")).toHaveAttribute("aria-pressed", "true");
    } else {
      await expect.poll(async () => (await studio.readBoard(board)).objects.length).toBe(1);
      await tool(page, "画笔").click();
      await button(page, "墨色 蓝色").click();
    }
    await drawStroke(page, viewport, true);
    if (save) {
      await expect(tool(page, "画笔")).toHaveAttribute("aria-pressed", "true");
      expect((await studio.readBoard(board)).objects).toHaveLength(1);
      await page.keyboard.press("Escape");
      await expect(tool(page, "选择")).toHaveAttribute("aria-pressed", "true");
    }
  } finally {
    save?.release();
  }
  await expect.poll(async () => (await studio.readBoard(board)).objects.length).toBe(2);
  if (save) {
    const { objects } = await studio.readBoard(board);
    const id = objects[1].id;
    const strokeMidpoint = async () =>
      (await readCanvas(page, studio)).objects.find((object) => object.id === id)?.pathPoints[2];
    await expect.poll(strokeMidpoint).toBeDefined();
    const point = await strokeMidpoint();
    await page.mouse.click(point.x, point.y);
  }
  await expect(button(page, "边框与线条")).toBeVisible();
  await button(page, "边框与线条").click();
  await lineWidth(page, 6);
  await savedObject(studio, board, { kind: "ink", strokeWidth: 6 });
  const saved = await studio.readBoard(board);
  expect(saved.objects.map(({ kind }) => kind)).toEqual(["ink", "ink"]);
  expect(saved.objects[0].stroke?.toUpperCase()).toBe("#2F7CC4");
  expect(saved.objects[1].stroke).toBe(saved.objects[0].stroke);
  await observe(testInfo, "saved-ink", {
    strokes: saved.objects.length,
    sameInk: true,
    width: 6,
  });
  await page.reload();
  await expect(viewport).toBeVisible();
  await expect
    .poll(
      async () =>
        (await readCanvas(page, studio)).objects.filter(({ kind }) => kind === "ink").length,
    )
    .toBe(2);
  await screenshot(page, testInfo, "reopened-ink-strokes");
});

test("[WB-OBJECT-04] 连线端点样式和分区标题从菜单真实写回", async ({ page, studio }, testInfo) => {
  const section = formObject("section", "section-under-test", "验收分区", 540, 115);
  const connector = {
    ...formObject("connector", "styled-connector", "验收连线", 130, 200),
    start: { x: 170, y: 270 },
    end: { x: 435, y: 270 },
  };
  const board = await studio.seedBasicBoard({ title: "连线和分区", objects: [section, connector] });
  await open(page, studio, board);
  await clickBoardPoint(page, studio, 220, 270);
  await select(page, "连接线起点").selectOption("circle");
  await select(page, "连接线终点").selectOption("none");
  await expect(select(page, "连接线终点")).toHaveValue("none");
  await label(page, "验收分区").click();
  await button(page, "更多操作").click();
  await page.getByRole("menuitem", { name: "重命名分区" }).click();
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("QA", { delay: 40 });
  if (studio.edition === "ii") {
    await savedObject(studio, board, { id: section.id, text: "QA" });
  }
  await expect(editor(page)).toBeFocused();
  await page.keyboard.insertText(" 验收分区");
  await page.keyboard.press("Enter");
  const renamed = "QA 验收分区";
  await savedObject(studio, board, { id: section.id, text: renamed });
  await page.reload();
  await expect(label(page, renamed)).toBeVisible();
  await clickBoardPoint(page, studio, 220, 270);
  await expect(select(page, "连接线起点")).toHaveValue("circle");
  await expect(select(page, "连接线终点")).toHaveValue("none");
  await observe(testInfo, "saved-connector-and-section", {
    start: "circle",
    end: "none",
    renamed: true,
  });
  await screenshot(page, testInfo, "connector-and-renamed-section");
});

async function placeSticker(page, studio, board, { name, iconId, position }) {
  const search = page.getByRole("searchbox", { name: "搜索贴纸" });
  await search.fill(name);
  await button(page, "贴纸 " + name).click();
  await canvas(page, studio, board).click({ position });
  await savedObject(studio, board, { kind: "sticker", stickerIconId: iconId });
  await expect(canvas(page, studio, board).getByRole("img", { name, exact: true })).toBeVisible();
}

test("[WB-OBJECT-05] 贴纸搜索换图并保留旧字符编辑入口", async ({ page, studio }, testInfo) => {
  const legacy = formObject("sticker", "legacy-sticker", "旧版字符", 175, 130);
  const board = await studio.seedBasicBoard({ title: "图形和旧版贴纸", objects: [legacy] });
  await open(page, studio, board);
  await tool(page, "贴纸").click();
  await expect(page.getByRole("group", { name: "彩色图形贴纸" }).getByRole("button")).toHaveCount(
    42,
  );
  await placeSticker(page, studio, board, {
    name: "爱心",
    iconId: "heart",
    position: { x: 630, y: 210 },
  });
  await tool(page, "贴纸").click();
  await placeSticker(page, studio, board, {
    name: "火箭",
    iconId: "rocket",
    position: { x: 850, y: 210 },
  });
  const graphic = canvas(page, studio, board).getByRole("img", { name: "火箭", exact: true });
  const bounds = await graphic.boundingBox();
  expect(bounds).toBeTruthy();
  await page.mouse.dblclick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(editor(page)).toHaveCount(0);
  await label(page, "旧版字符").dblclick();
  await expect(editor(page)).toBeFocused();
  await editor(page).fill("旧贴纸已编辑");
  await tool(page, "选择").click();
  await savedObject(studio, board, { id: legacy.id, text: "旧贴纸已编辑" });
  await page.reload();
  await expect(label(page, "旧贴纸已编辑")).toBeVisible();
  await expect(canvas(page, studio, board).getByRole("img", { name: "爱心" })).toBeVisible();
  await expect(canvas(page, studio, board).getByRole("img", { name: "火箭" })).toBeVisible();
  await observe(testInfo, "sticker-catalog-and-legacy", {
    presets: 42,
    graphicPicks: 2,
    legacyEdited: true,
  });
  await screenshot(page, testInfo, "saved-graphic-and-legacy-stickers");
});

function cellEditor(page, row, column) {
  return editor(page, "表格第" + row + "行第" + column + "列");
}

async function resizeColumn(page, delta) {
  const handle = page.getByRole("separator", { name: "调整第1列宽度" });
  const { x, y, width, height } = await handle.boundingBox();
  await page.mouse.move(x + width / 2, y + height / 2);
  await page.mouse.down();
  await page.mouse.move(x + width / 2 + delta, y + height / 2, { steps: 8 });
  await page.mouse.up();
}

async function removeFromGrid(page, cell, action) {
  await cell.click({ button: "right" });
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}

async function waitForTableSave(page, studio, board, previousRevision) {
  await expect
    .poll(async () => (await studio.readBoard(board)).revision)
    .toBeGreaterThan(previousRevision);
  const saved = page.getByRole("status", { name: "已保存", exact: true });
  const savedText = page.getByRole("status").filter({ hasText: /^已保存$/u });
  await expect(saved.or(savedText)).toBeVisible();

  return (await studio.readBoard(board)).revision;
}

async function expectTableBounds(page, studio, grid) {
  if (studio.edition === "initial") {
    return;
  }

  const controls = page.getByRole("toolbar", { name: "表格操作", exact: true });
  await expect
    .poll(async () => {
      const { selection } = await readCanvas(page, studio);
      const body = await grid.boundingBox();
      const toolbar = await controls.boundingBox();
      if (!selection || !body || !toolbar) {
        return false;
      }

      const heightMatches = Math.abs(body.height - selection.height) < 1;
      const widthMatches = Math.abs(body.width - selection.width) < 1;
      const leftEdgesMatch = Math.abs(body.x - selection.x) < 1 && Math.abs(toolbar.x - body.x) < 1;
      const topEdgesMatch = Math.abs(body.y - selection.y) < 1;

      return (
        heightMatches &&
        widthMatches &&
        leftEdgesMatch &&
        topEdgesMatch &&
        toolbar.y >= body.y + body.height
      );
    })
    .toBe(true);
}

test("[WB-OBJECT-06] 表格行列单元格焦点和列宽重开后保留", async ({ page, studio }, testInfo) => {
  const board = await blank(page, studio, "原生表格");
  let revision = (await studio.readBoard(board)).revision;
  await tool(page, "形状").click();
  await button(page, "表格").click();
  await canvas(page, studio, board).click({ position: { x: 480, y: 250 } });
  const table = page.getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(3);
  revision = await waitForTableSave(page, studio, board, revision);
  await button(page, "添加表格行").click();
  await expect(table.getByRole("row")).toHaveCount(4);
  revision = await waitForTableSave(page, studio, board, revision);
  await expectTableBounds(page, studio, table);
  await button(page, "添加表格列").click();
  await expect(table.getByRole("columnheader")).toHaveCount(4);
  revision = await waitForTableSave(page, studio, board, revision);
  await expectTableBounds(page, studio, table);
  await expect(button(page, "添加表格列")).toBeEnabled();
  await table.getByText("项目 A", { exact: true }).dblclick();
  await expect(cellEditor(page, 2, 1)).toBeFocused();
  await screenshot(page, testInfo, "table-target-cell-focus");
  await cellEditor(page, 2, 1).fill("首个单元格已改");
  await cellEditor(page, 2, 1).press("Tab");
  revision = await waitForTableSave(page, studio, board, revision);
  await expect(cellEditor(page, 2, 2)).toBeFocused();
  await cellEditor(page, 2, 2).fill("第二个单元格已改");
  await cellEditor(page, 2, 2).press("Enter");
  revision = await waitForTableSave(page, studio, board, revision);
  await expect(label(page, "首个单元格已改")).toBeVisible();
  await expect(label(page, "第二个单元格已改")).toBeVisible();
  const before = (await studio.readBoard(board)).objects.find(({ kind }) => kind === "table");
  await resizeColumn(page, 42);
  await expect
    .poll(
      async () =>
        (await studio.readBoard(board)).objects.find(({ kind }) => kind === "table")?.width,
    )
    .toBeGreaterThan(before.width + 20);
  revision = await waitForTableSave(page, studio, board, revision);
  await removeFromGrid(page, table.getByRole("row").last().getByRole("cell").last(), "删除行");
  await expect(table.getByRole("row")).toHaveCount(3);
  revision = await waitForTableSave(page, studio, board, revision);
  await removeFromGrid(page, table.getByRole("columnheader").last(), "删除列");
  await expect(table.getByRole("columnheader")).toHaveCount(3);
  await waitForTableSave(page, studio, board, revision);
  await expectTableBounds(page, studio, table);
  if (studio.edition === "ii") {
    await button(page, "缩放菜单").click();
    await page.getByRole("menuitem", { name: "75%", exact: true }).click();
    await expectTableBounds(page, studio, table);
  }

  await page.reload();
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(table.getByRole("columnheader")).toHaveCount(3);
  await expect(label(page, "首个单元格已改")).toBeVisible();
  await expect(label(page, "第二个单元格已改")).toBeVisible();
  await observe(testInfo, "saved-table", {
    rows: 3,
    columns: 3,
    insertedAndDeleted: true,
    wider: true,
    updatedCells: 2,
  });
  await screenshot(page, testInfo, "saved-table-columns");
});

const customInk = "#3864A2";

async function applyCustomInk(page) {
  await button(page, "添加自定义颜色").click();
  await editor(page, "颜色值").fill(customInk);
  await button(page, "应用颜色").click();
}

async function openInkPalette(page, objectLabel) {
  await label(page, objectLabel).click();
  await button(page, "边框与线条").click();
  await expect(page.getByRole("group", { name: "墨色色板" })).toBeVisible();
}

async function changePaletteHistory(page, studio, board, shortcut) {
  await expect(button(page, "边框与线条")).toBeEnabled();
  const panel = page.getByRole("dialog", { name: "边框与线条" });
  if (await panel.isVisible()) {
    await page.keyboard.press("Escape");
  }
  const before = (await studio.readBoard(board)).revision;
  await canvas(page, studio, board).focus();
  await page.keyboard.press(shortcut);
  await expect.poll(async () => (await studio.readBoard(board)).revision).toBeGreaterThan(before);
}

test("[WB-OBJECT-10] 自定义墨色跨对象复用并可移除和撤销重做", async ({
  page,
  studio,
}, testInfo) => {
  const first = formObject("shape", "palette-first", "先应用颜色", 130, 180);
  const second = formObject("shape", "palette-second", "重开复用颜色", 430, 180);
  const board = await studio.seedBasicBoard({ title: "对象自定义墨色", objects: [first, second] });
  await open(page, studio, board);
  await openInkPalette(page, first.label);
  const beforeInvalid = (await studio.readBoard(board)).revision;
  await button(page, "添加自定义颜色").click();
  await editor(page, "颜色值").fill("#18");
  await expect(button(page, "应用颜色")).toBeDisabled();
  await button(page, "取消").click();
  expect((await studio.readBoard(board)).revision).toBe(beforeInvalid);
  await applyCustomInk(page);
  await savedObject(studio, board, { id: first.id, stroke: customInk });
  await screenshot(page, testInfo, "custom-ink-applied-to-first");

  await page.reload();
  const swatch = button(page, "自定义颜色 " + customInk);
  await label(page, second.label).click();
  await button(page, "文字颜色").click();
  await expect(swatch).toBeVisible();
  await page.keyboard.press("Escape");
  await openInkPalette(page, second.label);
  await expect(swatch).toBeVisible();
  await screenshot(page, testInfo, "second-object-ink-palette-after-reload");
  await studio.restart();
  await open(page, studio, board);
  await openInkPalette(page, second.label);
  await expect(swatch).toBeVisible();

  await swatch.click();
  await savedObject(studio, board, { id: second.id, stroke: customInk });
  if (!(await swatch.isVisible())) {
    await openInkPalette(page, second.label);
  }
  const beforeRemove = (await studio.readBoard(board)).revision;
  await swatch.click({ button: "right" });
  await expect
    .poll(async () => (await studio.readBoard(board)).revision)
    .toBeGreaterThan(beforeRemove);
  await expect(swatch).toHaveCount(0);
  await savedObject(studio, board, { id: second.id, stroke: customInk });

  await changePaletteHistory(page, studio, board, "Control+z");
  await openInkPalette(page, second.label);
  await expect(swatch).toBeVisible();
  await savedObject(studio, board, { id: second.id, stroke: customInk });
  await changePaletteHistory(page, studio, board, "Control+Shift+z");
  if (studio.edition === "ii") {
    await changePaletteHistory(page, studio, board, "Control+z");
    await openInkPalette(page, second.label);
    const beforeKeyboardRemove = (await studio.readBoard(board)).revision;
    await swatch.press("Delete");
    await expect
      .poll(async () => (await studio.readBoard(board)).revision)
      .toBeGreaterThan(beforeKeyboardRemove);
  }
  await studio.restart();
  await open(page, studio, board);
  await openInkPalette(page, second.label);
  await expect(swatch).toHaveCount(0);
  await savedObject(studio, board, { id: first.id, stroke: customInk });
  await savedObject(studio, board, { id: second.id, stroke: customInk });
  await observe(testInfo, "shared-custom-ink", {
    objectInk: customInk,
    reusedAfterReload: true,
    removablePaletteEntry: true,
    removalUndoRedo: true,
    sharedWithText: true,
  });
  await screenshot(page, testInfo, "custom-ink-second-persisted");
});
