import { expect, observe, readCanvas, screenshot, test } from "../support/studio.mjs";

const outlines = [
  ["rounded", "圆角矩形"],
  ["rect", "矩形"],
  ["ellipse", "椭圆"],
  ["diamond", "菱形"],
  ["pill", "胶囊"],
  ["hexagon", "六边形"],
  ["parallelogram", "平行四边形"],
  ["database", "数据库"],
  ["queue", "队列"],
  ["document", "文档"],
  ["cloud", "云"],
  ["person", "人物"],
];

const controls = (page) => page.getByRole("toolbar", { name: "白板工具", exact: true });
const tool = (page, name) => controls(page).getByRole("button", { name, exact: true });
const selection = (page) => page.getByRole("toolbar", { name: "选区格式", exact: true });
const inlineText = (page) => page.getByRole("textbox", { name: "编辑文字", exact: true });

async function openBoard(page, studio, title) {
  const [board] = await studio.seedBoards([{ title }]);
  await page.goto(board.url);
  await expect(page.getByRole("textbox", { name: "白板名称", exact: true })).toHaveValue(title);
  const canvas = page
    .getByLabel("白板画布", { exact: true })
    .or(page.getByRole("region", { name: title, exact: true }));
  await expect(canvas).toBeVisible();
  await expect(tool(page, "选择")).toHaveAttribute("aria-pressed", "true");
  const camera = await readCanvas(page, studio);
  const box = camera.bounds;
  if (!box) {
    throw new Error("The open board has no visible canvas.");
  }

  return { board, canvas, box };
}

function onCanvas(box, x, y) {
  return { x: box.x + x, y: box.y + y };
}

async function clickAt(page, point) {
  await page.mouse.click(point.x, point.y);
}

async function startDrag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
}

async function drag(page, from, to) {
  await startDrag(page, from, to);
  await page.mouse.up();
}

async function expectSavedObjects(studio, board, count) {
  await expect.poll(async () => (await studio.readBoard(board)).objects.length).toBe(count);

  return (await studio.readBoard(board)).objects;
}

async function expectSelected(page) {
  await expect(tool(page, "选择")).toHaveAttribute("aria-pressed", "true");
  await expect(selection(page)).toBeVisible();
}

function expectDraggedShape(object, camera, x, y, width, height) {
  expect(object.x * camera.zoom + camera.pan.x).toBeCloseTo(x, 0);
  expect(object.y * camera.zoom + camera.pan.y).toBeCloseTo(y, 0);
  expect(object.width * camera.zoom).toBeCloseTo(width, 0);
  expect(object.height * camera.zoom).toBeCloseTo(height, 0);
}

test("[WB-PLACE-01] 逐个放置十二种形状轮廓并只保存一次", async ({ page, studio }, testInfo) => {
  test.setTimeout(90_000);
  const { board, box } = await openBoard(page, studio, "轮廓放置验收");
  for (const [index, [, label]] of outlines.entries()) {
    await tool(page, "形状").click();
    const option = page.getByRole("button", { name: "形状 " + label, exact: true });
    await expect(option).toBeVisible();
    if (index === 0) {
      await screenshot(page, testInfo, "twelve-outline-tools");
    }
    await option.click();
    await expect(tool(page, "形状")).toHaveAttribute("aria-pressed", "true");

    const x = 210 + (index % 4) * 288;
    const y = 130 + Math.floor(index / 4) * 180;
    const near = onCanvas(box, x, y);
    const far = onCanvas(box, x + 96, y + 56);
    const camera = await readCanvas(page, studio);
    if (index === 0) {
      await clickAt(page, near);
    } else if (index % 2) {
      await drag(page, near, far);
    } else {
      await drag(page, far, near);
    }
    await expectSelected(page);
    const saved = await expectSavedObjects(studio, board, index + 1);
    const current = saved.find(
      ({ kind, outline }) => kind === "shape" && outline === outlines[index][0],
    );
    expect(current).toBeDefined();
    if (index === 0) {
      await clickAt(page, onCanvas(box, 100, 250));
      await expect(selection(page)).toBeHidden();
      await expectSavedObjects(studio, board, 1);
    } else {
      expectDraggedShape(current, camera, x, y, 96, 56);
    }
  }

  const saved = await expectSavedObjects(studio, board, outlines.length);
  expect(saved.map(({ outline }) => outline).sort()).toEqual(
    outlines.map(([shape]) => shape).sort(),
  );
  expect(new Set(saved.map(({ id }) => id)).size).toBe(outlines.length);
  await screenshot(page, testInfo, "twelve-outlines-placed");
  await observe(testInfo, "outline-placement", {
    shapes: outlines.map(([shape]) => shape),
    distinctObjects: saved.length,
    selectedAfterPlacement: true,
  });
});

test("[WB-PLACE-02] 工具按钮与数字键放置文字、便签和反向分区", async ({
  page,
  studio,
}, testInfo) => {
  const { board, canvas, box } = await openBoard(page, studio, "文字便签分区验收");
  const text = "放置文字验收";
  const note = "放置便签验收";
  await canvas.press("3");
  await expect(tool(page, "文字")).toHaveAttribute("aria-pressed", "true");
  await clickAt(page, onCanvas(box, 240, 175));
  await expect(inlineText(page)).toBeFocused();
  await inlineText(page).fill(text);
  await clickAt(page, onCanvas(box, 520, 210));
  await expect(page.getByText(text, { exact: true })).toBeVisible();

  await tool(page, "便签").click();
  await expect(tool(page, "便签")).toHaveAttribute("aria-pressed", "true");
  await drag(page, onCanvas(box, 683, 200), onCanvas(box, 898, 358));
  await expect(inlineText(page)).toBeFocused();
  await inlineText(page).fill(note);
  await clickAt(page, onCanvas(box, 1070, 190));
  await expect(page.getByText(note, { exact: true })).toBeVisible();

  await canvas.press("4");
  await expect(tool(page, "分区")).toHaveAttribute("aria-pressed", "true");
  await drag(page, onCanvas(box, 584, 522), onCanvas(box, 282, 359));
  await expectSelected(page);
  const saved = await expectSavedObjects(studio, board, 3);
  expect(saved.map(({ kind }) => kind).sort()).toEqual(["note", "section", "text"]);
  await screenshot(page, testInfo, "text-note-section-placement");
  await page.reload();
  await expect(page.getByText(text, { exact: true })).toBeVisible();
  await expect(page.getByText(note, { exact: true })).toBeVisible();
  await observe(testInfo, "text-note-section", {
    objects: ["note", "section", "text"],
    textAfterReload: [text, note],
  });
});

test("[WB-PLACE-03] 数字键选择蓝色画笔和爱心贴纸，重载仍可见", async ({
  page,
  studio,
}, testInfo) => {
  const { board, canvas, box } = await openBoard(page, studio, "笔迹贴纸验收");
  await canvas.press("6");
  await expect(tool(page, "画笔")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "画笔模式", exact: true })).toBeVisible();
  const blue = page.getByRole("button", { name: "墨色 蓝色", exact: true });
  await blue.click();
  await expect(blue).toHaveAttribute("aria-pressed", "true");
  await screenshot(page, testInfo, "ink-tools-and-blue-preset");
  await startDrag(page, onCanvas(box, 240, 245), onCanvas(box, 382, 282));
  const middle = onCanvas(box, 432, 224);
  await page.mouse.move(middle.x, middle.y, { steps: 5 });
  await page.mouse.up();
  await expectSavedObjects(studio, board, 1);

  await canvas.press("8");
  const heart = page.getByRole("button", { name: "贴纸 爱心", exact: true });
  await expect(tool(page, "贴纸")).toHaveAttribute("aria-pressed", "true");
  await expect(heart).toBeHidden();
  await tool(page, "贴纸").click();
  await expect(heart).toBeVisible();
  await screenshot(page, testInfo, "sticker-palette");
  await heart.click();
  await clickAt(page, onCanvas(box, 750, 255));
  await expectSelected(page);
  const sticker = page.getByRole("img", { name: "爱心", exact: true });
  await expect(sticker).toBeVisible();
  const saved = await expectSavedObjects(studio, board, 2);
  expect(saved.map(({ kind }) => kind).sort()).toEqual(["ink", "sticker"]);
  const stroke = saved.find(({ kind }) => kind === "ink")?.stroke?.toLowerCase();
  expect(stroke).toBe("#2f7cc4");
  await screenshot(page, testInfo, "ink-and-sticker-placed");
  await page.reload();
  await expect(sticker).toBeVisible();
  await observe(testInfo, "ink-and-sticker", {
    objects: ["ink", "sticker"],
    stroke,
    sticker: "爱心",
  });
});

test("[WB-PLACE-04] Escape 与切换工具中止放置，空白双击可恢复新建文字", async ({
  page,
  studio,
}, testInfo) => {
  const { board, canvas, box } = await openBoard(page, studio, "放置中止与双击验收");
  await canvas.press("7");
  const diamond = page.getByRole("button", { name: "形状 菱形", exact: true });
  await expect(tool(page, "形状")).toHaveAttribute("aria-pressed", "true");
  await expect(diamond).toBeHidden();
  await tool(page, "形状").click();
  await expect(diamond).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(diamond).toBeHidden();
  await expect(tool(page, "形状")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(tool(page, "选择")).toHaveAttribute("aria-pressed", "true");
  await clickAt(page, onCanvas(box, 250, 210));

  await canvas.press("4");
  await startDrag(page, onCanvas(box, 264, 300), onCanvas(box, 500, 460));
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(tool(page, "分区")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(tool(page, "选择")).toHaveAttribute("aria-pressed", "true");

  await canvas.press("5");
  await startDrag(page, onCanvas(box, 748, 300), onCanvas(box, 990, 456));
  await page.keyboard.press("1");
  await page.mouse.up();
  await expect(tool(page, "选择")).toHaveAttribute("aria-pressed", "true");
  await expect(selection(page)).toBeHidden();
  await expectSavedObjects(studio, board, 0);
  await screenshot(page, testInfo, "aborted-placement-empty-board");

  const point = onCanvas(box, 370, 250);
  await page.mouse.dblclick(point.x, point.y);
  await expect(inlineText(page)).toBeFocused();
  const content = "双击后放置的文字";
  await inlineText(page).fill(content);
  await clickAt(page, onCanvas(box, 720, 225));
  await expect(page.getByText(content, { exact: true })).toBeVisible();
  const saved = await expectSavedObjects(studio, board, 1);
  expect(saved[0].kind).toBe("text");
  await screenshot(page, testInfo, "blank-double-click-text");
  await observe(testInfo, "aborted-placement", { cancelledObjects: 0, afterDoubleClick: "text" });
});

test("[WB-PLACE-05] 画笔只提供预设墨色，重开后已保存笔迹仍保留选色", async ({
  page,
  studio,
}, testInfo) => {
  const { board, canvas, box } = await openBoard(page, studio, "画笔预设与重开验收");
  const palette = page
    .getByRole("toolbar", { name: "绘图选项", exact: true })
    .getByRole("group", { name: "墨色色板", exact: true });
  const presets = ["墨色", "陶土色", "蓝色", "绿色", "紫色"];
  const color = (label) => palette.getByRole("button", { name: "墨色 " + label, exact: true });
  const custom = palette.getByRole("button", { name: "添加自定义颜色", exact: true });

  await canvas.press("6");
  await expect(palette).toBeVisible();
  await expect(palette.getByRole("button")).toHaveCount(presets.length);
  for (const name of presets) {
    await expect(color(name)).toBeEnabled();
  }
  await expect(custom).toHaveCount(0);
  await expect(color("墨色")).toHaveAttribute("aria-pressed", "true");
  await screenshot(page, testInfo, "brush-preset-only");

  await drag(page, onCanvas(box, 230, 220), onCanvas(box, 502, 278));
  const [defaultStroke] = await expectSavedObjects(studio, board, 1);
  expect(defaultStroke.kind).toBe("ink");
  expect(defaultStroke.stroke.toUpperCase()).toBe("#0B0B0B");
  await screenshot(page, testInfo, "brush-default-stroke");
  await canvas.press("6");
  const terracotta = color("陶土色");
  await terracotta.click();
  await expect(terracotta).toHaveAttribute("aria-pressed", "true");
  await drag(page, onCanvas(box, 730, 270), onCanvas(box, 1002, 328));
  const saved = await expectSavedObjects(studio, board, 2);
  const savedTerracotta = saved.find(({ stroke }) => stroke.toUpperCase() === "#D97757");
  expect(savedTerracotta?.kind).toBe("ink");

  await canvas.press("1");
  await expect(palette).toBeHidden();
  await canvas.press("6");
  await expect(terracotta).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(canvas).toBeVisible();
  await canvas.press("6");
  await expect(terracotta).toHaveAttribute("aria-pressed", "false");
  await expect(custom).toHaveCount(0);
  await expect(color("墨色")).toHaveAttribute("aria-pressed", "true");
  const reopened = await expectSavedObjects(studio, board, 2);
  expect(reopened.find(({ id }) => id === savedTerracotta.id)?.stroke.toUpperCase()).toBe(
    "#D97757",
  );
  await screenshot(page, testInfo, "brush-preset-after-reopen");
  await observe(testInfo, "brush-preset-scope", {
    presets,
    customColorEntry: false,
    defaultInkSelected: true,
    reopenedDefaultInkSelected: true,
    defaultStroke: "#0B0B0B",
    savedStroke: "#D97757",
  });
});
