import { expect, focused, observe, readCanvas, screenshot, test } from "../support/studio.mjs";

const a = "shape-a";
const b = "shape-b";
const c = "shape-c";
const section = "section-transparent";
const boxTolerance = 4;

function titleField(page) {
  return page.getByRole("textbox", { name: "白板名称", exact: true });
}

function selectionToolbar(page) {
  return page.getByRole("toolbar", { name: "选区格式", exact: true });
}

function boardMenu(page) {
  return page.getByRole("menu", { name: "白板操作", exact: true });
}

async function bootstrap(page, studio) {
  const board = await studio.seedBasicBoard();
  await page.goto(board.url);
  await expect(titleField(page)).toHaveValue(board.title);
  await expect
    .poll(async () => (await readCanvas(page, studio)).objects.length)
    .toBeGreaterThanOrEqual(4);

  return board;
}

function objectBox(scene, id) {
  const shape = scene.objects.find((object) => object.id === id);
  if (!shape?.box) {
    throw new Error("Expected a painted whiteboard object: " + id);
  }

  return shape.box;
}

function position(box, horizontal = 0.5, vertical = 0.5) {
  return { x: box.x + box.width * horizontal, y: box.y + box.height * vertical };
}

function corner(box, offset, far) {
  const edge = far ? position(box, 1, 1) : position(box, 0, 0);
  const delta = far ? offset : -offset;

  return { x: edge.x + delta, y: edge.y + delta };
}

function merge(boxes) {
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));

  return { x, y, width: right - x, height: bottom - y };
}

function largestBoxError(actual, expected) {
  if (!actual) {
    return Infinity;
  }

  return Math.max(...Object.keys(expected).map((key) => Math.abs(actual[key] - expected[key])));
}

async function expectSelection(page, studio, ids) {
  await expect
    .poll(async () => {
      const scene = await readCanvas(page, studio);
      if (ids.length === 0) {
        return scene.selection ? Infinity : 0;
      }

      return largestBoxError(scene.selection, merge(ids.map((id) => objectBox(scene, id))));
    })
    .toBeLessThanOrEqual(boxTolerance);
}

function clickPoint(page, point, button = "left") {
  return page.mouse.click(point.x, point.y, { button });
}

async function drag(page, from, to, button = "left") {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up({ button });
}

function aOnly(scene) {
  return position(objectBox(scene, a), 0.22, 0.6);
}

function bOnly(scene) {
  return position(objectBox(scene, b), 0.78, 0.7);
}

function blank(scene) {
  return position(scene.bounds, 0.86, 0.72);
}

function overlap(scene) {
  const first = objectBox(scene, a);
  const next = objectBox(scene, b);
  const x = Math.max(first.x, next.x);
  const y = Math.max(first.y, next.y);
  const right = Math.min(first.x + first.width, next.x + next.width);
  const bottom = Math.min(first.y + first.height, next.y + next.height);
  expect(right).toBeGreaterThan(x);
  expect(bottom).toBeGreaterThan(y);

  return position({ x, y, width: right - x, height: bottom - y }, 0.25, 0.2);
}

async function withShift(page, action) {
  await page.keyboard.down("Shift");
  try {
    await action();
  } finally {
    await page.keyboard.up("Shift");
  }
}

test("[WB-SELECT-01] 点选、Shift 增减、全选以及 Esc 和空白清除", async ({
  page,
  studio,
}, testInfo) => {
  await bootstrap(page, studio);
  const scene = await readCanvas(page, studio);
  await clickPoint(page, aOnly(scene));
  await expectSelection(page, studio, [a]);
  await withShift(page, () => clickPoint(page, bOnly(scene)));
  await expectSelection(page, studio, [a, b]);
  await screenshot(page, testInfo, "shift-added-selection");
  await withShift(page, () => clickPoint(page, aOnly(scene)));
  await expectSelection(page, studio, [b]);

  await page.keyboard.press("Control+a");
  await expectSelection(page, studio, [a, b, c, section]);
  await page.keyboard.press("Escape");
  await expectSelection(page, studio, []);
  await clickPoint(page, aOnly(scene));
  await clickPoint(page, blank(scene));
  await expectSelection(page, studio, []);
  await observe(testInfo, "selection-gestures", {
    shiftAddsAndRemoves: true,
    selectAll: true,
    clears: true,
  });
});

test("[WB-SELECT-02] 正反框选等价，透明分区内部可精确框选", async ({ page, studio }, testInfo) => {
  await bootstrap(page, studio);
  const scene = await readCanvas(page, studio);
  const pair = merge([objectBox(scene, a), objectBox(scene, b)]);
  const from = corner(pair, 14, false);
  const to = corner(pair, 14, true);
  await drag(page, from, to);
  await expectSelection(page, studio, [a, b]);
  await drag(page, to, from);
  await expectSelection(page, studio, [a, b]);

  const inner = objectBox(scene, c);
  await drag(page, corner(inner, 14, false), corner(inner, 14, true));
  const precise = studio.edition === "ii";
  await expectSelection(page, studio, precise ? [c] : [c, section]);
  await screenshot(page, testInfo, "inside-transparent-section-marquee");
  await clickPoint(page, blank(scene));
  await clickPoint(page, position(inner));
  await expectSelection(page, studio, [c]);
  await observe(testInfo, "transparent-marquee", {
    forwardAndReverse: true,
    includesUncrossedSection: !precise,
  });
});

test("[WB-SELECT-03] 重叠命中最上层，核对透明分区内部、边和标题", async ({
  page,
  studio,
}, testInfo) => {
  await bootstrap(page, studio);
  const scene = await readCanvas(page, studio);
  await clickPoint(page, overlap(scene));
  await expectSelection(page, studio, [b]);
  const frame = objectBox(scene, section);
  await clickPoint(page, position(frame, 0.92, 0.85));
  const passesThrough = studio.edition === "ii";
  await expectSelection(page, studio, passesThrough ? [] : [section]);
  await screenshot(page, testInfo, "transparent-section-empty-interior");
  await clickPoint(page, blank(scene));
  await expectSelection(page, studio, []);
  await clickPoint(page, { x: frame.x + 2, y: frame.y + frame.height * 0.8 });
  await expectSelection(page, studio, [section]);
  await clickPoint(page, blank(scene));
  await page.getByText("透明分区", { exact: true }).click();
  await expectSelection(page, studio, [section]);
  await screenshot(page, testInfo, "transparent-section-title-selected");
  await observe(testInfo, "hit-targets", {
    topmost: b,
    sectionInteriorTarget: passesThrough ? null : section,
    edgeAndTitle: section,
  });
});

test("[WB-SELECT-04] 右键保留多选、换到其他目标，Esc 关闭并归还焦点", async ({
  page,
  studio,
}, testInfo) => {
  await bootstrap(page, studio);
  const scene = await readCanvas(page, studio);
  await clickPoint(page, aOnly(scene));
  await withShift(page, () => clickPoint(page, bOnly(scene)));
  await clickPoint(page, bOnly(scene), "right");
  const menu = boardMenu(page);
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /从选区创建分区/u })).toBeEnabled();
  await expectSelection(page, studio, [a, b]);
  await screenshot(page, testInfo, "multi-selection-context-menu");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expectSelection(page, studio, [a, b]);
  await expect.poll(async () => (await readCanvas(page, studio)).focused).toBe(true);

  await clickPoint(page, position(objectBox(scene, c)), "right");
  await expect(menu).toBeVisible();
  await expectSelection(page, studio, [c]);
  await expect(menu.getByRole("menuitem", { name: /从选区创建分区/u })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect.poll(async () => (await readCanvas(page, studio)).focused).toBe(true);
  await page.keyboard.press("Escape");
  await expectSelection(page, studio, []);
  await observe(testInfo, "right-click-selection-and-focus", {
    retainedSelectedPair: true,
    replacedSelectionWithTarget: true,
    escapeReturnedCanvasFocus: true,
  });
});

function inViewport(box, viewport) {
  return Boolean(
    box &&
    box.x >= -1 &&
    box.y >= -1 &&
    box.x + box.width <= viewport.width + 1 &&
    box.y + box.height <= viewport.height + 1,
  );
}

async function expectFits(locator, page) {
  await expect
    .poll(async () => inViewport(await locator.boundingBox(), page.viewportSize()))
    .toBe(true);
}

test("[WB-SELECT-05] 屏边和窄窗的选区工具栏与菜单完整可操作", async ({
  page,
  studio,
}, testInfo) => {
  await bootstrap(page, studio);
  const scene = await readCanvas(page, studio);
  const from = blank(scene);
  const target = position(scene.bounds, 0.965, 0.8);
  const shape = bOnly(scene);
  await drag(
    page,
    from,
    { x: from.x + target.x - shape.x, y: from.y + target.y - shape.y },
    "middle",
  );
  await clickPoint(page, target);
  await expectSelection(page, studio, [b]);
  const toolbar = selectionToolbar(page);
  await expectFits(toolbar, page);
  await clickPoint(page, target, "right");
  const menu = boardMenu(page);
  await expect(menu).toBeVisible();
  await expectFits(menu, page);
  await screenshot(page, testInfo, "edge-selection-menu");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  await page.setViewportSize({ width: 390, height: 728 });
  await page.reload();
  await expect(titleField(page)).toBeVisible();
  await expect
    .poll(async () => (await readCanvas(page, studio)).objects.length)
    .toBeGreaterThanOrEqual(4);
  await clickPoint(page, bOnly(await readCanvas(page, studio)));
  await expectSelection(page, studio, [b]);
  await expectFits(toolbar, page);
  const more = toolbar.getByRole("button", { name: "更多操作", exact: true });
  await more.click();
  await expect(menu).toBeVisible();
  await expectFits(menu, page);
  await menu.getByRole("menuitem", { name: /^重复/u }).press("End");
  await expect(menu.getByRole("menuitem", { name: /^适应选区/u })).toBeFocused();
  await screenshot(page, testInfo, "narrow-selection-menu");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expectSelection(page, studio, [b]);
  await observe(testInfo, "selection-menu-layout", {
    edgeWithinViewport: true,
    narrowWithinViewport: true,
    keyboardReachesLastItem: true,
  });
});

test("[WB-SELECT-06] 文字输入的全选、删除和方向键留在输入框", async ({
  page,
  studio,
}, testInfo) => {
  const board = await bootstrap(page, studio);
  const scene = await readCanvas(page, studio);
  await clickPoint(page, aOnly(scene));
  await expectSelection(page, studio, [a]);
  const title = titleField(page);
  await title.fill("浏览器选择文字");
  await expect.poll(() => focused(title)).toBe(true);
  await title.press("Control+a");
  await title.press("Backspace");
  await expect(title).toHaveValue("");
  await title.press("ArrowRight");
  const current = await readCanvas(page, studio);
  expect(current.objects.map((object) => object.id).sort()).toEqual(
    scene.objects.map((object) => object.id).sort(),
  );
  expect(objectBox(current, a)).toEqual(objectBox(scene, a));
  await title.fill(board.title);
  await title.press("Escape");
  await expect(title).toHaveValue(board.title);
  await observe(testInfo, "editable-keyboard-ownership", {
    canvasObjectsPreserved: true,
    geometryUnchanged: true,
  });
});
