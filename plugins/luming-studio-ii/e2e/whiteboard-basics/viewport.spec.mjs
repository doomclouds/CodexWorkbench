import { expect, focused, observe, readCanvas, screenshot, test } from "../support/studio.mjs";

const emptyTitle = "白板入口样板";
const renamedTitle = "已改名的白板";
const populatedTitle = "视口几何样板";
const narrow = { width: 390, height: 620 };
const firstShape = "shape-a";

function button(scope, name) {
  return scope.getByRole("button", { name, exact: true });
}

function canvas(page, studio) {
  return studio.edition === "initial"
    ? page.getByLabel("白板画布", { exact: true })
    : page.getByRole("region", { name: emptyTitle, exact: true });
}

function boardTitle(page) {
  return page.getByRole("textbox", { name: "白板名称", exact: true });
}

function zoomButton(page) {
  return button(page, "缩放菜单");
}

function zoomMenu(page) {
  return page.getByRole("menu", { name: "缩放与视图", exact: true });
}

async function openViewMenu(page) {
  await zoomButton(page).click();
  await expect(zoomMenu(page)).toBeVisible();
  return zoomMenu(page);
}

async function preset(page, percent) {
  const menu = await openViewMenu(page);
  await menu.getByRole("menuitem", { name: `${percent}%`, exact: true }).click();
  await expect(zoomButton(page)).toHaveText(`${percent}%`);
  await expect(menu).toHaveCount(0);
}

async function openFromWorkbench(page, studio, title) {
  await page.goto(studio.url);
  await expect(
    page.getByRole("heading", { name: studio.workbenchTitle, exact: true }),
  ).toBeVisible();
  await button(page, "打开白板：" + title).click();
  await expect(boardTitle(page)).toHaveValue(title);
  await expect(canvas(page, studio)).toBeVisible();
}

async function openSample(page, studio) {
  const seed = await studio.seedBasicBoard({
    title: populatedTitle,
    objects: [
      {
        id: firstShape,
        kind: "shape",
        label: "视口对象 A",
        x: 120,
        y: 120,
        width: 160,
        height: 100,
      },
      {
        id: "shape-b",
        kind: "shape",
        label: "视口对象 B",
        x: 1560,
        y: 820,
        width: 160,
        height: 100,
      },
    ],
  });
  await page.goto(seed.url);
  await expect(boardTitle(page)).toHaveValue(populatedTitle);
  await expect(page.getByText("视口对象 A", { exact: true })).toBeVisible();
  return seed;
}

function sampleBox(frame, id = firstShape) {
  const sampled = frame.objects.find((object) => object.id === id)?.box;
  if (!sampled) {
    throw new Error("The sample object must be rendered before measuring the viewport.");
  }

  return sampled;
}

async function drag(page, start, delta, pressButton) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button: pressButton });
  await page.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 6 });
  await page.mouse.up({ button: pressButton });
}

async function expectPan(page, studio, before, delta) {
  await expect
    .poll(async () => {
      const after = await readCanvas(page, studio);
      return {
        x: Math.round(after.pan.x - before.pan.x),
        y: Math.round(after.pan.y - before.pan.y),
      };
    })
    .toEqual(delta);
  await expect.poll(async () => (await readCanvas(page, studio)).zoom).toBeCloseTo(before.zoom, 3);
}

async function fitMenu(page, label) {
  const menu = await openViewMenu(page);
  await menu.getByRole("menuitem", { name: label, exact: true }).click();
  await expect(menu).toHaveCount(0);
}

test.describe("白板入口与视口", () => {
  test("[WB-VIEW-01] 从工作台打开空白板、查看引导并返回", async ({ page, studio }, testInfo) => {
    await studio.seedBoards([{ title: emptyTitle }]);
    await page.emulateMedia({ colorScheme: "light" });
    await openFromWorkbench(page, studio, emptyTitle);
    await expect(page.getByText("从一个想法开始", { exact: true })).toBeVisible();
    await expect(button(page, "添加文档")).toBeEnabled();
    await expect(button(page, "添加 HTML 图解")).toBeEnabled();
    await expect(page.getByRole("toolbar", { name: "白板工具" })).toBeVisible();
    await screenshot(page, testInfo, "whiteboard-empty-light");

    await button(page, studio.workbenchBackLabel).click();
    await expect(button(page, "打开白板：" + emptyTitle)).toBeVisible();
    await expect(canvas(page, studio)).toHaveCount(0);
    await screenshot(page, testInfo, "whiteboard-return-to-workbench");
  });

  test("[WB-VIEW-02] Enter 保存白板标题，Escape 丢弃本次编辑", async ({
    page,
    studio,
  }, testInfo) => {
    const [seed] = await studio.seedBoards([{ title: emptyTitle }]);
    await page.goto(seed.url);
    const input = boardTitle(page);
    await expect(input).toHaveValue(emptyTitle);
    await input.fill(renamedTitle);
    await input.press("Enter");
    await expect(input).toHaveValue(renamedTitle);
    await expect.poll(async () => (await studio.readBoard(seed.id)).title).toBe(renamedTitle);
    await button(page, studio.workbenchBackLabel).click();
    const reopen = button(page, "打开白板：" + renamedTitle);
    await expect(reopen).toBeVisible();
    await reopen.click();
    await expect(input).toHaveValue(renamedTitle);

    await input.fill("取消的标题");
    await input.press("Escape");
    await expect(input).toHaveValue(renamedTitle);
    await page.reload();
    await expect(input).toHaveValue(renamedTitle);
    await screenshot(page, testInfo, "whiteboard-title-saved");
  });

  test("[WB-VIEW-03] 缩放预设、加减和 Shift+0 回 100%", async ({ page, studio }, testInfo) => {
    const [seed] = await studio.seedBoards([{ title: emptyTitle }]);
    await page.goto(seed.url);
    await expect(boardTitle(page)).toHaveValue(emptyTitle);
    const menu = await openViewMenu(page);
    await expect(menu.getByRole("menuitem", { name: "适应选区", exact: true })).toBeDisabled();
    await menu.getByRole("menuitem", { name: "75%", exact: true }).click();
    await expect(zoomButton(page)).toHaveText("75%");
    await expect(menu).toHaveCount(0);

    await openViewMenu(page);
    await button(menu, "放大").click();
    await expect(zoomButton(page)).toHaveText("90%");
    await button(menu, "缩小").click();
    await expect(zoomButton(page)).toHaveText("75%");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    await canvas(page, studio).click({ position: { x: 25, y: 70 } });
    await canvas(page, studio).press("Shift+0");
    await expect(zoomButton(page)).toHaveText("100%");
    await preset(page, 150);
    await preset(page, 100);
    await screenshot(page, testInfo, "whiteboard-zoom-reset");
  });

  test("[WB-VIEW-04] 窄窗口缩放菜单留在视口内，网格可切换且 Escape 回焦", async ({
    page,
    studio,
  }, testInfo) => {
    const [seed] = await studio.seedBoards([{ title: emptyTitle }]);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize(narrow);
    await page.goto(seed.url);
    await expect(boardTitle(page)).toHaveValue(emptyTitle);
    const menu = await openViewMenu(page);
    const bounds = await menu.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(narrow.width);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(narrow.height);
    await screenshot(page, testInfo, "whiteboard-zoom-menu-narrow-dark");
    await expect(zoomButton(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(zoomButton(page)).toBeFocused();

    await openViewMenu(page);
    await menu.getByText("视图设置", { exact: true }).click();
    const grid = menu.getByRole("checkbox", { name: "显示网格" });
    await expect(grid).toBeChecked();
    await grid.click();
    await expect(grid).not.toBeChecked();
    await expect.poll(async () => (await readCanvas(page, studio)).grid).toBe(false);
    await page.keyboard.press("Escape");
    const settingsStayedOpen = await menu.isVisible();
    const zoomAfterEscape = await focused(zoomButton(page));
    if (settingsStayedOpen) {
      await zoomButton(page).click();
    } else {
      await expect(zoomButton(page)).toBeFocused();
    }
    await expect(menu).toHaveCount(0);
    await observe(testInfo, "viewport-settings-focus", { settingsStayedOpen, zoomAfterEscape });
    await screenshot(page, testInfo, "whiteboard-grid-disabled-dark");

    await openViewMenu(page);
    const settings = menu.getByText("视图设置", { exact: true });
    if (!(await grid.isVisible())) {
      await settings.click();
    }
    await expect(grid).not.toBeChecked();
    await grid.click();
    await expect(grid).toBeChecked();
    await expect.poll(async () => (await readCanvas(page, studio)).grid).toBe(true);
    await zoomButton(page).click();
    await expect(menu).toHaveCount(0);
  });

  test("[WB-VIEW-05] 平移工具、空格加左键与鼠标中键移动相机而非对象", async ({
    page,
    studio,
  }, testInfo) => {
    const seed = await openSample(page, studio);
    await fitMenu(page, "适应白板");
    const initial = await readCanvas(page, studio);
    const originals = (await studio.readBoard(seed.id)).objects;
    const point = { x: initial.bounds.x + 44, y: initial.bounds.y + 96 };
    const tools = page.getByRole("toolbar", { name: "白板工具" });

    await button(tools, "平移").click();
    const direct = { x: 98, y: 60 };
    await drag(page, point, direct, "left");
    await expectPan(page, studio, initial, direct);

    await button(tools, "选择").click();
    await page.mouse.click(point.x, point.y);
    const beforeSpace = await readCanvas(page, studio);
    const temporary = { x: -42, y: 37 };
    await page.keyboard.down("Space");
    try {
      await drag(page, point, temporary, "left");
    } finally {
      await page.keyboard.up("Space");
    }
    await expectPan(page, studio, beforeSpace, temporary);

    const beforeMiddle = await readCanvas(page, studio);
    const middle = { x: 54, y: -62 };
    await drag(page, point, middle, "middle");
    await expectPan(page, studio, beforeMiddle, middle);
    expect((await studio.readBoard(seed.id)).objects).toEqual(originals);
    await screenshot(page, testInfo, "whiteboard-pan-tools");
  });

  test("[WB-VIEW-06] Ctrl 加滚轮缩放保持光标锚定的画布位置", async ({ page, studio }, testInfo) => {
    await openSample(page, studio);
    await fitMenu(page, "适应白板");
    const before = await readCanvas(page, studio);
    const box = sampleBox(before);
    const pointer = { x: Math.round(box.x + box.width / 3), y: Math.round(box.y + box.height / 3) };
    const u = (pointer.x - box.x) / box.width;
    const v = (pointer.y - box.y) / box.height;
    await page.mouse.move(pointer.x, pointer.y);
    await page.keyboard.down("Control");
    try {
      await page.mouse.wheel(0, -80);
    } finally {
      await page.keyboard.up("Control");
    }

    await expect
      .poll(async () => (await readCanvas(page, studio)).zoom)
      .toBeGreaterThan(before.zoom);
    const after = await readCanvas(page, studio);
    const resized = sampleBox(after);
    expect(resized.x + u * resized.width).toBeCloseTo(pointer.x, 0);
    expect(resized.y + v * resized.height).toBeCloseTo(pointer.y, 0);
    await screenshot(page, testInfo, "whiteboard-wheel-anchor");
  });

  test("[WB-VIEW-07] 适应白板包含远隔对象，适应选区聚焦单个对象", async ({
    page,
    studio,
  }, testInfo) => {
    await openSample(page, studio);
    await preset(page, 150);
    await fitMenu(page, "适应白板");
    const fitted = await readCanvas(page, studio);
    expect(fitted.zoom).toBeLessThan(1);
    for (const id of [firstShape, "shape-b"]) {
      const box = sampleBox(fitted, id);
      expect(box.x).toBeGreaterThanOrEqual(fitted.bounds.x);
      expect(box.y).toBeGreaterThanOrEqual(fitted.bounds.y);
      expect(box.x + box.width).toBeLessThanOrEqual(fitted.bounds.x + fitted.bounds.width);
      expect(box.y + box.height).toBeLessThanOrEqual(fitted.bounds.y + fitted.bounds.height);
    }
    await screenshot(page, testInfo, "whiteboard-fit-board");

    const box = sampleBox(fitted);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const menu = await openViewMenu(page);
    const selectFit = menu.getByRole("menuitem", { name: "适应选区", exact: true });
    await expect(selectFit).toBeEnabled();
    await selectFit.click();
    await expect(menu).toHaveCount(0);
    await expect
      .poll(async () => (await readCanvas(page, studio)).zoom)
      .toBeGreaterThan(fitted.zoom);
    const selected = await readCanvas(page, studio);
    const center = sampleBox(selected);
    expect(center.x + center.width / 2).toBeCloseTo(
      selected.bounds.x + selected.bounds.width / 2,
      0,
    );
    expect(center.y + center.height / 2).toBeCloseTo(
      selected.bounds.y + selected.bounds.height / 2,
      0,
    );
    await screenshot(page, testInfo, "whiteboard-fit-selection");
  });

  test("[WB-VIEW-08] 平移空白板后放置第一个对象不会重新居中", async ({
    page,
    studio,
  }, testInfo) => {
    const [seed] = await studio.seedBoards([{ title: emptyTitle }]);
    await page.goto(seed.url);
    await expect(page.getByText("从一个想法开始", { exact: true })).toBeVisible();
    const tools = page.getByRole("toolbar", { name: "白板工具" });
    const initial = await readCanvas(page, studio);
    const panStart = { x: initial.bounds.x + 44, y: initial.bounds.y + 96 };
    const delta = { x: 85, y: -42 };
    await button(tools, "平移").click();
    await drag(page, panStart, delta, "left");
    await expectPan(page, studio, initial, delta);
    const before = await readCanvas(page, studio);
    await screenshot(page, testInfo, "whiteboard-empty-panned");

    await button(tools, "形状").click();
    await button(page, "形状 矩形").click();
    await page.mouse.click(before.bounds.x + 250, before.bounds.y + 210);
    await expect.poll(async () => (await studio.readBoard(seed.id)).objects.length).toBe(1);
    await expect.poll(async () => (await readCanvas(page, studio)).objects.length).toBe(1);
    await screenshot(page, testInfo, "whiteboard-first-object-view");

    const after = await readCanvas(page, studio);
    const cameraUnchanged =
      after.pan.x === before.pan.x && after.pan.y === before.pan.y && after.zoom === before.zoom;
    await observe(testInfo, "first-object-camera", { cameraUnchanged });
    expect(after.pan).toEqual(before.pan);
    expect(after.zoom).toBeCloseTo(before.zoom, 3);
  });

  test("[WB-VIEW-09] 数字工具快捷开关生效，标题中的数字与方向键照常编辑", async ({
    page,
    studio,
  }, testInfo) => {
    const [seed] = await studio.seedBoards([{ title: emptyTitle }]);
    await page.goto(seed.url);
    await expect(boardTitle(page)).toHaveValue(emptyTitle);
    const field = canvas(page, studio);
    const tools = page.getByRole("toolbar", { name: "白板工具" });
    const pan = button(tools, "平移");
    const select = button(tools, "选择");

    await field.click({ position: { x: 25, y: 70 } });
    await page.keyboard.press("2");
    await expect(pan).toHaveAttribute("aria-pressed", "true");

    const view = await openViewMenu(page);
    const settings = view.getByText("视图设置", { exact: true });
    await settings.click();
    const shortcuts = view.getByRole("checkbox", { name: "数字工具快捷键" });
    await expect(shortcuts).toBeChecked();
    await shortcuts.click();
    await expect(shortcuts).not.toBeChecked();
    await screenshot(page, testInfo, "whiteboard-single-keys-off");
    await zoomButton(page).click();
    await field.click({ position: { x: 25, y: 70 } });
    await page.keyboard.press("1");
    await expect(pan).toHaveAttribute("aria-pressed", "true");

    await openViewMenu(page);
    if (!(await shortcuts.isVisible())) {
      await settings.click();
    }
    await expect(shortcuts).not.toBeChecked();
    await shortcuts.click();
    await zoomButton(page).click();
    await field.click({ position: { x: 25, y: 70 } });
    await page.keyboard.press("1");
    await expect(select).toHaveAttribute("aria-pressed", "true");

    const camera = await readCanvas(page, studio);
    const input = boardTitle(page);
    await input.fill("ABCD");
    await input.press("Home");
    await input.press("ArrowRight");
    await input.press("2");
    await input.press("ArrowRight");
    await input.press("Backspace");
    await expect(input).toHaveValue("A2CD");
    await expect(select).toHaveAttribute("aria-pressed", "true");
    await expectPan(page, studio, camera, { x: 0, y: 0 });
    await screenshot(page, testInfo, "whiteboard-title-keyboard");
    await input.press("Escape");
    await expect(input).toHaveValue(emptyTitle);
  });

  test("[WB-VIEW-10] 无选区方向键平移，Ctrl+0 与 Shift+1/2 适应视口", async ({
    page,
    studio,
  }, testInfo) => {
    const seed = await openSample(page, studio);
    const originals = (await studio.readBoard(seed.id)).objects;
    await fitMenu(page, "适应白板");
    const fitted = await readCanvas(page, studio);
    await page.mouse.click(fitted.bounds.x + 28, fitted.bounds.y + 100);
    expect((await readCanvas(page, studio)).selection).toBeNull();

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowDown");
    await expectPan(page, studio, fitted, { x: -24, y: -240 });
    await screenshot(page, testInfo, "whiteboard-arrow-pan");
    await page.keyboard.press("Control+0");
    await expectPan(page, studio, fitted, { x: 0, y: 0 });

    await page.keyboard.press("ArrowLeft");
    await expectPan(page, studio, fitted, { x: 24, y: 0 });
    await page.keyboard.press("Shift+1");
    await expectPan(page, studio, fitted, { x: 0, y: 0 });

    const box = sampleBox(fitted);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(async () => (await readCanvas(page, studio)).selection).not.toBeNull();
    await page.keyboard.press("Shift+2");
    await expect
      .poll(async () => (await readCanvas(page, studio)).zoom)
      .toBeGreaterThan(fitted.zoom);
    expect((await studio.readBoard(seed.id)).objects).toEqual(originals);
    await screenshot(page, testInfo, "whiteboard-keyboard-fit-selection");
  });
});
