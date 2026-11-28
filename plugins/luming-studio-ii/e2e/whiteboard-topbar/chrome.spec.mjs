import { controlNextCanvasSave, expect, observe, screenshot, test } from "../support/studio.mjs";

const shape = {
  id: "topbar-save-shape",
  kind: "shape",
  label: "顶栏保存形状",
  x: 100,
  y: 140,
  width: 168,
  height: 96,
};

function button(page, name) {
  return page.getByRole("button", { name, exact: true });
}

function boardName(page) {
  return page.getByRole("textbox", { name: /^(?:白板|作品)名称$/u });
}

function saved(page) {
  return page.getByRole("status", { name: "已保存", exact: true });
}

function statusLayout(page, title, status) {
  const canvas = page.getByRole("region", { name: title, exact: true });
  return Promise.all(
    [boardName(page), status, button(page, "版本历史"), canvas].map((target) =>
      target.boundingBox(),
    ),
  );
}

async function openWorkbench(page, studio) {
  await button(page, studio.workbenchBackLabel).click();
  await expect(
    page.getByRole("heading", { name: studio.workbenchTitle, exact: true }),
  ).toBeVisible();
}

test("[TOPBAR-CHROME-01] 白板标题支持确认、失焦与撤销，返回工作台后能重开", async ({
  page,
  studio,
}, testInfo) => {
  const original = "顶栏标题验收";
  const confirmed = "确认后的白板标题";
  const final = "失焦保存的白板标题";
  const board = await studio.seedBasicBoard({ title: original, objects: [] });
  await page.goto(board.url);
  const name = boardName(page);
  await expect(name).toHaveValue(original);
  await expect(saved(page)).toBeVisible();

  await name.fill("放弃这次修改");
  await name.press("Escape");
  await expect(name).toHaveValue(original);
  await name.fill("   ");
  await name.press("Enter");
  await expect(name).toHaveValue(original);
  expect((await studio.readBoard(board)).title).toBe(original);

  await name.fill("  " + confirmed + "  ");
  await name.press("Enter");
  await expect.poll(async () => (await studio.readBoard(board)).title).toBe(confirmed);
  await expect(name).toHaveValue(confirmed);
  await name.fill(final);
  await name.press("Tab");
  await expect.poll(async () => (await studio.readBoard(board)).title).toBe(final);
  await expect(name).toHaveValue(final);
  await expect(saved(page)).toBeVisible();
  await screenshot(page, testInfo, "chrome-renamed-board");

  await openWorkbench(page, studio);
  await button(page, "打开白板：" + final).click();
  await expect(name).toHaveValue(final);
  await expect(saved(page)).toBeVisible();
  await observe(testInfo, "title-after-reopen", { title: final, status: "已保存" });
});

test("[TOPBAR-CHROME-02] 主题切换改变画布颜色并沿用工作台偏好", async ({
  page,
  studio,
}, testInfo) => {
  const title = "顶栏主题验收";
  const board = await studio.seedBasicBoard({ title, objects: [] });
  const initial = studio.edition === "initial";
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(board.url);
  await expect(boardName(page)).toHaveValue(title);
  const canvas = page.getByLabel(initial ? "白板画布" : title, { exact: true }).last();
  const share = button(page, "分享");
  const toDark = button(page, "切换为暗色主题");
  const toLight = button(page, "切换为明亮主题");

  if (initial) {
    await expect(toDark).toHaveCount(0);
    await share.click();
  }

  await expect(toDark).toBeVisible();
  await expect(canvas).toHaveCSS("background-color", "rgb(245, 245, 245)");
  await screenshot(page, testInfo, "chrome-light-theme-entry");
  await toDark.click();
  await expect(toLight).toBeVisible();
  await expect(canvas).toHaveCSS("background-color", "rgb(45, 49, 66)");
  await screenshot(page, testInfo, "chrome-dark-theme-entry");

  if (!initial) {
    await share.click();
    const panel = page.getByRole("dialog", { name: "分享", exact: true });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("button", { name: /^切换为.*主题$/u })).toHaveCount(0);
    await screenshot(page, testInfo, "chrome-share-without-theme");
  }

  await page.reload();
  await expect(canvas).toHaveCSS("background-color", "rgb(45, 49, 66)");
  if (initial) {
    await share.click();
  }
  await expect(toLight).toBeVisible();
  await openWorkbench(page, studio);
  await expect(toLight).toBeVisible();
  await toLight.click();
  await button(page, "打开白板：" + title).click();
  await expect(canvas).toHaveCSS("background-color", "rgb(245, 245, 245)");
  await observe(testInfo, "theme-shared-preference", { persisted: true, canvasTheme: "light" });
});

test("[TOPBAR-CHROME-03] 真实移动回执到达前后，顶栏状态和画布布局稳定", async ({
  page,
  studio,
}, testInfo) => {
  const title = "顶栏保存状态验收";
  const ii = studio.edition === "ii";
  const board = await studio.seedBasicBoard({ title, objects: [shape] });
  if (ii) {
    await page.setViewportSize({ width: 360, height: 640 });
  }
  await page.goto(board.url);
  await expect(saved(page)).toBeVisible();
  await page.getByText(shape.label, { exact: true }).click();
  const hold = await controlNextCanvasSave(page, studio, {
    boardId: board.id,
    action: "move",
    mode: "hold",
  });
  const before = ii && (await statusLayout(page, title, saved(page)));

  try {
    await page.keyboard.press("ArrowRight");
    await hold.observed;
    const saving = page.getByRole("status", { name: /^保存中…?$/u });
    await expect(saving).toBeVisible();
    if (ii) {
      expect(await statusLayout(page, title, saving)).toEqual(before);
    }
    await screenshot(page, testInfo, "chrome-saving");
  } finally {
    hold.release();
  }

  await expect(saved(page)).toBeVisible();
  await expect
    .poll(async () => (await studio.readBoard(board)).objects.find(({ id }) => id === shape.id)?.x)
    .toBe(shape.x + 1);

  if (ii) {
    expect(await statusLayout(page, title, saved(page))).toEqual(before);
  }

  await screenshot(page, testInfo, "chrome-saved");
  await observe(testInfo, "save-status-after-receipt", { status: "已保存", x: shape.x + 1 });
});
