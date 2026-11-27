import { expect, observe, readCanvas, screenshot, test } from "../support/studio.mjs";

const primary = {
  id: "primary",
  kind: "shape",
  label: "主体图形",
  x: 100,
  y: 100,
  width: 160,
  height: 100,
};
const secondary = {
  id: "secondary",
  kind: "shape",
  label: "参考图形",
  x: 500,
  y: 310,
  width: 110,
  height: 70,
};
const handleLabels = {
  nw: "缩放左上角",
  n: "缩放上边",
  ne: "缩放右上角",
  e: "缩放右边",
  se: "缩放右下角",
  s: "缩放下边",
  sw: "缩放左下角",
  w: "缩放左边",
};
const directions = {
  nw: [-1, -1],
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
};

async function openGeometryBoard(page, studio, objects = [primary]) {
  const title = "画布几何验收";
  const board = await studio.seedBasicBoard({ title, objects });
  await page.goto(board.url);
  await expect(page.getByRole("textbox", { name: "白板名称", exact: true })).toHaveValue(title);
  await expect(page.getByRole("button", { name: "缩放菜单", exact: true })).toBeVisible();

  return board;
}

function resizeHandle(page, studio, name) {
  const label = studio.edition === "initial" ? "调整元素大小 " + name : handleLabels[name];
  return page.getByRole("button", { name: label, exact: true });
}

function rotateHandle(page, studio, name) {
  const label = studio.edition === "initial" ? "旋转所选元素 " : "旋转所选对象 ";
  return page.getByRole("button", { name: label + name, exact: true });
}

function geometry({ x, y, width, height, rotation = 0 }) {
  return { x, y, width, height, rotation };
}

function center({ x, y, width, height }) {
  return { x: x + width / 2, y: y + height / 2 };
}

async function screenPoint(page, studio, { x, y }) {
  const { bounds, pan, zoom } = await readCanvas(page, studio);

  return { x: bounds.x + pan.x + x * zoom, y: bounds.y + pan.y + y * zoom };
}

async function selectShape(page, studio, object) {
  const point = await screenPoint(page, studio, center(object));
  await page.mouse.click(point.x, point.y);
  await expect(resizeHandle(page, studio, "se")).toBeVisible();
}

async function setZoom(page, value) {
  const menu = page.getByRole("button", { name: "缩放菜单", exact: true });
  await menu.click();
  await page.getByRole("menuitem", { name: value + "%", exact: true }).click();
  await expect(menu).toHaveText(value + "%");
}

async function readShape(studio, board, id) {
  const data = await studio.readBoard(board);
  const object = data.objects.find((candidate) => candidate.id === id);
  if (!object) {
    throw new Error("Expected a persisted shape named " + id);
  }

  return geometry(object);
}

async function renderedShape(page, studio, id) {
  const canvas = await readCanvas(page, studio);
  const object = canvas.objects.find((candidate) => candidate.id === id);
  if (!object?.box) {
    throw new Error("Expected a visible shape named " + id);
  }

  return object.box;
}

async function expectSaved(page, studio, board, id, expected, tolerance = 0.2) {
  await expect
    .poll(async () => {
      const current = await readShape(studio, board, id);
      const deltas = Object.keys(expected).map((key) => Math.abs(current[key] - expected[key]));
      return Math.max(...deltas);
    })
    .toBeLessThanOrEqual(tolerance);
  await expect(page.getByText("已保存", { exact: true }).first()).toBeVisible();
}

async function handleCenter(handle) {
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();

  return center(box);
}

async function startDrag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
}

async function drag(page, from, to) {
  await startDrag(page, from, to);
  await page.mouse.up();
}

async function resizeBy(page, studio, handle, dx, dy) {
  const start = await handleCenter(resizeHandle(page, studio, handle));
  await drag(page, start, { x: start.x + dx, y: start.y + dy });
}

async function rotateBy(page, studio, object, degrees) {
  const start = await handleCenter(rotateHandle(page, studio, "ne"));
  const pivot = await screenPoint(page, studio, center(object));
  const radians = (degrees * Math.PI) / 180;
  const x = start.x - pivot.x;
  const y = start.y - pivot.y;
  await drag(page, start, {
    x: pivot.x + Math.cos(radians) * x - Math.sin(radians) * y,
    y: pivot.y + Math.sin(radians) * x + Math.cos(radians) * y,
  });
}

test("[WB-GEO-01] 微小指针移动只选中，用方向键微调单选与多选", async ({
  page,
  studio,
}, testInfo) => {
  const board = await openGeometryBoard(page, studio, [primary, secondary]);
  const start = await screenPoint(page, studio, center(primary));
  await drag(page, start, { ...start, x: start.x + 4 });
  await expect(resizeHandle(page, studio, "se")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expectSaved(page, studio, board, primary.id, { x: primary.x + 1, y: primary.y });
  await page.keyboard.press("Shift+ArrowDown");
  await expectSaved(page, studio, board, primary.id, { x: primary.x + 1, y: primary.y + 10 });

  const other = await screenPoint(page, studio, center(secondary));
  await page.keyboard.down("Shift");
  await page.mouse.click(other.x, other.y);
  await page.keyboard.up("Shift");
  await page.keyboard.press("Shift+ArrowLeft");
  await expectSaved(page, studio, board, primary.id, { x: primary.x - 9, y: primary.y + 10 });
  await expectSaved(page, studio, board, secondary.id, { x: secondary.x - 10, y: secondary.y });
  await page.keyboard.press("ArrowUp");
  await expectSaved(page, studio, board, primary.id, { x: primary.x - 9, y: primary.y + 9 });
  await expectSaved(page, studio, board, secondary.id, { x: secondary.x - 10, y: secondary.y - 1 });

  const groupStart = await screenPoint(page, studio, {
    x: center(primary).x - 9,
    y: center(primary).y + 9,
  });
  await drag(page, groupStart, { x: groupStart.x + 32, y: groupStart.y - 16 });
  await expectSaved(page, studio, board, primary.id, { x: primary.x + 23, y: primary.y - 7 });
  await expectSaved(page, studio, board, secondary.id, {
    x: secondary.x + 22,
    y: secondary.y - 17,
  });

  const threshold = { x: groupStart.x + 32, y: groupStart.y - 16 };
  await drag(page, threshold, { ...threshold, x: threshold.x + 5 });
  await expectSaved(page, studio, board, primary.id, { x: primary.x + 28, y: primary.y - 7 });
  await expectSaved(page, studio, board, secondary.id, {
    x: secondary.x + 27,
    y: secondary.y - 17,
  });

  await observe(testInfo, "keyboard-and-group-world-delta", {
    keyboard: [
      { x: -9, y: 9 },
      { x: -10, y: -1 },
    ],
    groupDrag: { x: 32, y: -16 },
    minimumDrag: 5,
  });
  await screenshot(page, testInfo, "keyboard-multiselection");
});

test("[WB-GEO-02] 同样画布距离在三档缩放下都按世界坐标保存", async ({ page, studio }, testInfo) => {
  const board = await openGeometryBoard(page, studio);
  let object = geometry(primary);
  const measured = [];
  for (const percent of [50, 100, 200]) {
    await setZoom(page, percent);
    const start = await screenPoint(page, studio, center(object));
    const zoom = percent / 100;
    await drag(page, start, { x: start.x + 24 * zoom, y: start.y + 18 * zoom });
    object = { ...object, x: object.x + 24, y: object.y + 18 };
    await expectSaved(page, studio, board, primary.id, object);
    const { x, y } = await readShape(studio, board, primary.id);
    measured.push({ percent, x: Math.round(x), y: Math.round(y) });
  }

  await page.reload();
  await selectShape(page, studio, object);
  await expectSaved(page, studio, board, primary.id, object);
  await observe(testInfo, "drag-world-delta", measured);
  await screenshot(page, testInfo, "drag-persisted-after-refresh");
});

test("[WB-GEO-03] 四角四边可拖放且保持相对边固定", async ({ page, studio }, testInfo) => {
  const board = await openGeometryBoard(page, studio);
  await selectShape(page, studio, primary);
  let object = geometry(primary);
  const amount = 14;
  for (const [handle, [dx, dy]] of Object.entries(directions)) {
    await resizeBy(page, studio, handle, dx * amount, dy * amount);
    object = {
      ...object,
      x: object.x + Math.min(0, dx) * amount,
      y: object.y + Math.min(0, dy) * amount,
      width: object.width + Math.abs(dx) * amount,
      height: object.height + Math.abs(dy) * amount,
    };
    await expectSaved(page, studio, board, primary.id, object);
  }

  await observe(testInfo, "resize-eight-handles", Object.keys(directions));
  await screenshot(page, testInfo, "resized-from-eight-handles");
});

test("[WB-GEO-04] Shift 缩放保持比例，Alt 缩放保持中心", async ({ page, studio }, testInfo) => {
  const board = await openGeometryBoard(page, studio);
  await selectShape(page, studio, primary);
  const pivot = center(primary);
  await page.keyboard.down("Alt");
  await resizeBy(page, studio, "e", 20, 0);
  await page.keyboard.up("Alt");
  const centered = { ...geometry(primary), x: primary.x - 20, width: primary.width + 40 };
  await expectSaved(page, studio, board, primary.id, centered);

  await page.keyboard.down("Shift");
  await resizeBy(page, studio, "se", 40, 20);
  await page.keyboard.up("Shift");
  const proportional = { ...centered, width: 240, height: 120 };
  await expectSaved(page, studio, board, primary.id, proportional);
  await observe(testInfo, "resize-modifier-invariants", { pivot, aspect: 2 });
  await screenshot(page, testInfo, "modifier-resize-result");
});

test("[WB-GEO-05] 外角旋转与 Shift 十五度步进", async ({ page, studio }, testInfo) => {
  const board = await openGeometryBoard(page, studio);
  await selectShape(page, studio, primary);
  await rotateBy(page, studio, primary, 27);
  await expectSaved(page, studio, board, primary.id, { ...geometry(primary), rotation: 27 }, 1);
  const turned = await readShape(studio, board, primary.id);
  await page.keyboard.down("Shift");
  await rotateBy(page, studio, turned, 24);
  await page.keyboard.up("Shift");
  await expectSaved(
    page,
    studio,
    board,
    primary.id,
    { ...turned, rotation: turned.rotation + 30 },
    0.5,
  );
  await page.reload();
  await selectShape(page, studio, turned);
  await expectSaved(
    page,
    studio,
    board,
    primary.id,
    { ...turned, rotation: turned.rotation + 30 },
    0.5,
  );
  await observe(testInfo, "rotation-pivot-and-steps", {
    regular: 27,
    shiftDelta: 30,
    center: center(primary),
  });
  await screenshot(page, testInfo, "rotated-shape-after-refresh");
});

test("[WB-GEO-06] 贴近边时吸附并显示引导线，超过阈值能重叠", async ({ page, studio }, testInfo) => {
  const guide = { ...secondary, x: 380, y: 175 };
  const board = await openGeometryBoard(page, studio, [primary, guide]);
  const from = await screenPoint(page, studio, center(primary));
  const snapped = { ...geometry(primary), x: guide.x - primary.width };
  const end = await screenPoint(page, studio, { ...center(snapped), x: center(snapped).x - 4 });
  await startDrag(page, from, end);
  await expect.poll(async () => (await readCanvas(page, studio)).guides).toBe(1);
  const reference = await renderedShape(page, studio, guide.id);
  const preview = await renderedShape(page, studio, primary.id);
  expect(preview.x + preview.width).toBeCloseTo(reference.x, 1);
  expect(await readShape(studio, board, primary.id)).toEqual(geometry(primary));
  await screenshot(page, testInfo, "edge-snap-preview");
  await page.mouse.up();
  await expectSaved(page, studio, board, primary.id, snapped);

  const aligned = { ...snapped, x: center(guide).x - primary.width / 2, y: 270 };
  const alignedEnd = await screenPoint(page, studio, {
    ...center(aligned),
    x: center(aligned).x + 4,
  });
  await startDrag(page, await screenPoint(page, studio, center(snapped)), alignedEnd);
  await expect.poll(async () => (await readCanvas(page, studio)).guides).toBe(1);
  const alignedPreview = await renderedShape(page, studio, primary.id);
  expect(center(alignedPreview).x).toBeCloseTo(center(reference).x, 1);
  await page.mouse.up();
  await expectSaved(page, studio, board, primary.id, aligned);
  await expect.poll(async () => (await readCanvas(page, studio)).guides).toBe(0);

  const overlapping = { ...snapped, x: guide.x - 62, y: guide.y + 49 };
  await drag(
    page,
    await screenPoint(page, studio, center(aligned)),
    await screenPoint(page, studio, center(overlapping)),
  );
  await expectSaved(page, studio, board, primary.id, overlapping);
  await expectSaved(page, studio, board, guide.id, geometry(guide));
  await observe(testInfo, "snap-and-overlap", {
    snappedRight: guide.x,
    snappedCenter: center(guide).x,
    overlapWidth: 98,
    guideStayed: true,
  });
  await screenshot(page, testInfo, "overlapping-move-result");
});

test("[WB-GEO-07] 取消进行中的拖动和缩放，不写入也不吞掉后续移动", async ({
  page,
  studio,
}, testInfo) => {
  const board = await openGeometryBoard(page, studio);
  await selectShape(page, studio, primary);
  const from = await screenPoint(page, studio, center(primary));
  const before = await renderedShape(page, studio, primary.id);
  await startDrag(page, from, { x: from.x + 67, y: from.y + 39 });
  await expect
    .poll(async () => (await renderedShape(page, studio, primary.id)).x - before.x)
    .toBeCloseTo(67, 1);
  await screenshot(page, testInfo, "move-before-cancel");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expectSaved(page, studio, board, primary.id, geometry(primary));

  await selectShape(page, studio, primary);
  const handle = await handleCenter(resizeHandle(page, studio, "se"));
  await startDrag(page, handle, { x: handle.x + 45, y: handle.y + 37 });
  await page.reload();
  await page.mouse.up();
  await expectSaved(page, studio, board, primary.id, geometry(primary));

  await selectShape(page, studio, primary);
  await page.keyboard.press("ArrowDown");
  await expectSaved(page, studio, board, primary.id, { ...geometry(primary), y: primary.y + 1 });
  await observe(testInfo, "cancelled-transform", {
    moveStayed: true,
    resizeStayed: true,
    nextMove: 1,
  });
});

test("[WB-GEO-08] 越过对边仍有最小正尺寸，越出画布松开保留世界坐标", async ({
  page,
  studio,
}, testInfo) => {
  const board = await openGeometryBoard(page, studio, [primary, secondary]);
  await selectShape(page, studio, primary);
  await resizeBy(page, studio, "e", -primary.width - 30, 0);
  const small = { ...geometry(primary), width: 24 };
  await expectSaved(page, studio, board, primary.id, small);
  await screenshot(page, testInfo, "resize-past-opposite-edge");

  const from = await screenPoint(page, studio, center(secondary));
  const { bounds, zoom } = await readCanvas(page, studio);
  const to = { x: from.x + 15, y: bounds.y - 5 };
  await drag(page, from, to);
  const moved = {
    ...geometry(secondary),
    x: secondary.x + (to.x - from.x) / zoom,
    y: secondary.y + (to.y - from.y) / zoom,
  };
  await expectSaved(page, studio, board, secondary.id, moved, 0.75);
  await page.getByRole("button", { name: "缩放菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "适应白板", exact: true }).click();
  await selectShape(page, studio, moved);
  await screenshot(page, testInfo, "overflow-move-after-fit");
  await observe(testInfo, "minimum-size-and-outside-drop", { minimumWidth: 24, outsideDrop: true });
});
