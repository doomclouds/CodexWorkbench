import {
  controlNextThumbnail,
  expect,
  observe,
  readCardCover,
  readControlPresentation,
  screenshot,
  test,
} from "../support/studio.mjs";

const firstTitle = "Alpha 展示白板";
const secondTitle = "Beta 展示白板";
const desktop = { width: 1366, height: 820 };
const narrow = { width: 390, height: 760 };

function button(scope, name) {
  return scope.getByRole("button", { name, exact: true });
}

function board(page, title = firstTitle) {
  return button(page, "打开白板：" + title);
}

function titleBar(page, studio) {
  return page.getByRole("heading", { level: 1, name: studio.workbenchTitle, exact: true });
}

async function openWorkbench(page, studio, descriptors) {
  await studio.seedBoards(descriptors);
  await page.goto(studio.url);
  await expect(titleBar(page, studio)).toBeVisible();
  return board(page, descriptors[0].title);
}

async function box(locator) {
  const measured = await locator.boundingBox();
  if (!measured) {
    throw new Error("Expected a visible workbench control");
  }

  return measured;
}

function dimensions({ width, height }) {
  return { width: Math.round(width), height: Math.round(height) };
}

async function arrangement(page) {
  const first = await box(board(page));
  const second = await box(board(page, secondTitle));
  const horizontal = Math.abs(first.y - second.y) < 2;
  const distance = horizontal ? first.x - second.x : first.y - second.y;

  return { horizontal, distance: Math.round(Math.abs(distance)), card: dimensions(first) };
}

test("[WB-DISPLAY-01] 卡片和列表布局切换后跨刷新保留", async ({ page, studio }, testInfo) => {
  await page.setViewportSize(desktop);
  await openWorkbench(page, studio, [{ title: firstTitle }, { title: secondTitle }]);
  await expect(board(page)).toBeVisible();
  await expect(board(page, secondTitle)).toBeVisible();
  const grid = await arrangement(page);
  expect(grid.horizontal).toBe(true);
  expect(grid.distance).toBeGreaterThan(200);
  await screenshot(page, testInfo, "workbench-grid");

  await button(page, "切换为列表视图").click();
  await expect(button(page, "切换为卡片视图")).toBeVisible();
  const list = await arrangement(page);
  expect(list.horizontal).toBe(false);
  expect(list.card.width).toBeGreaterThan(grid.card.width);

  await page.reload();
  await expect(button(page, "切换为卡片视图")).toBeVisible();
  await expect(board(page)).toBeVisible();
  expect(await arrangement(page)).toEqual(list);
  await screenshot(page, testInfo, "workbench-list-after-reload");
  await observe(testInfo, "display-layout", { grid, list });
});

test("[WB-DISPLAY-02] 初次跟随系统明暗，手动切换后跨刷新保留", async ({
  page,
  studio,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openWorkbench(page, studio, [{ title: firstTitle }]);
  const toDark = button(page, "切换为暗色主题");
  const toLight = button(page, "切换为明亮主题");
  await expect(toDark).toBeVisible();
  await screenshot(page, testInfo, "workbench-system-light");

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(toLight).toBeVisible();
  await screenshot(page, testInfo, "workbench-system-dark");

  await toLight.click();
  await expect(toDark).toBeVisible();
  await page.reload();
  await expect(toDark).toBeVisible();
  await expect(board(page)).toBeVisible();
  await screenshot(page, testInfo, "workbench-manual-light-after-reload");
});

test("[WB-DISPLAY-03] 窄窗口里的卡片、列表和管理入口不横向溢出", async ({
  page,
  studio,
}, testInfo) => {
  await page.setViewportSize(narrow);
  await openWorkbench(page, studio, [
    { title: firstTitle },
    { title: secondTitle + "和一段用于检验标题边界的文字" },
  ]);
  await expect(board(page)).toBeVisible();
  const grid = await box(board(page));
  expect(grid.x).toBeGreaterThanOrEqual(0);
  expect(grid.x + grid.width).toBeLessThanOrEqual(narrow.width);
  const view = await box(button(page, "切换为列表视图"));
  expect(view.x + view.width).toBeLessThanOrEqual(narrow.width);
  await screenshot(page, testInfo, "workbench-narrow-grid");

  await button(page, "切换为列表视图").click();
  const list = await box(board(page));
  const management = await box(button(page, "管理作品：" + firstTitle));
  expect(list.x).toBeGreaterThanOrEqual(0);
  expect(management.x).toBeGreaterThanOrEqual(list.x + list.width - 1);
  expect(management.x + management.width).toBeLessThanOrEqual(narrow.width);
  await screenshot(page, testInfo, "workbench-narrow-list");
  await observe(testInfo, "narrow-card-size", { grid: dimensions(grid), list: dimensions(list) });
});

test("[WB-DISPLAY-04] 有内容和空白的已保存白板都显示真实封面", async ({
  page,
  studio,
}, testInfo) => {
  const blank = await openWorkbench(page, studio, [
    { title: firstTitle },
    { title: secondTitle, withContent: true },
  ]);
  const populated = board(page, secondTitle);
  await expect.poll(() => readCardCover(populated)).toMatchObject({ state: "ready" });
  try {
    await expect
      .poll(() => readCardCover(blank))
      .toEqual({
        state: "ready",
        width: 960,
        height: 540,
        padding: "14px",
      });
  } finally {
    await screenshot(page, testInfo, "workbench-saved-covers");
    await observe(testInfo, "saved-cover", { blank: await readCardCover(blank) });
  }

  await button(page, "切换为列表视图").click();
  await expect.poll(() => readCardCover(populated)).toEqual({ state: "empty" });
});

test("[WB-DISPLAY-05] 封面加载完成后显示图片，损坏图片降级", async ({ page, studio }, testInfo) => {
  const gate = await controlNextThumbnail(page, studio, "hold");
  const cover = await openWorkbench(page, studio, [{ title: firstTitle, withContent: true }]);
  try {
    await expect.poll(gate.started).toBe(true);
    await expect.poll(() => readCardCover(cover)).toEqual({ state: "pending" });
    await screenshot(page, testInfo, "cover-waiting");
    await observe(testInfo, "cover-waiting", await readCardCover(cover));
  } finally {
    gate.release();
  }
  await expect.poll(() => readCardCover(cover)).toMatchObject({ state: "ready" });
  await screenshot(page, testInfo, "cover-completed");

  const corrupt = await controlNextThumbnail(page, studio, "corrupt");
  await page.reload();
  await expect.poll(corrupt.started).toBe(true);
  await expect.poll(() => readCardCover(cover)).toEqual({ state: "failed" });
  await expect(cover.getByText("暂无预览", { exact: true })).toBeHidden();
  await screenshot(page, testInfo, "cover-corrupt-fallback");
});

test("[WB-DISPLAY-06] 管理按钮随卡片悬浮或焦点显示，列表中持续可见", async ({
  page,
  studio,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const cover = await openWorkbench(page, studio, [{ title: firstTitle }]);
  const management = button(page, "管理作品：" + firstTitle);
  await expect(cover).toBeVisible();
  await expect.poll(() => readControlPresentation(management)).toMatchObject({ shown: false });

  await cover.hover();
  await expect.poll(() => readControlPresentation(management)).toMatchObject({ shown: true });
  const hover = await readControlPresentation(management);
  await screenshot(page, testInfo, "workbench-grid-manage-hover");

  await titleBar(page, studio).hover();
  await expect.poll(() => readControlPresentation(management)).toMatchObject({ shown: false });
  await cover.focus();
  await expect.poll(() => readControlPresentation(management)).toMatchObject({ shown: true });

  await button(page, "切换为列表视图").click();
  await titleBar(page, studio).hover();
  await expect.poll(() => readControlPresentation(management)).toMatchObject({ shown: true });
  await screenshot(page, testInfo, "workbench-list-manage-visible");
  await observe(testInfo, "manage-hover-colors", hover);
});
