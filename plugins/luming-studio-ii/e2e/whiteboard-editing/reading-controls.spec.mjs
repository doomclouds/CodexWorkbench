import {
  expect,
  observe,
  readCanvas,
  readViewingInk,
  screenshot,
  test,
  workbenchLinkProbe,
} from "../support/studio.mjs";

test.use({ trace: "off", screenshot: "off", video: "off" });

const left = {
  id: "reading-shape",
  label: "聚焦形状",
  kind: "shape",
  x: 120,
  y: 120,
  width: 180,
  height: 96,
};
const right = {
  id: "reading-note",
  label: "观看便签",
  kind: "note",
  x: 440,
  y: 290,
  width: 192,
  height: 144,
};
const excluded = {
  id: "reading-away",
  label: "选区之外",
  kind: "shape",
  x: 790,
  y: 120,
  width: 165,
  height: 100,
};
const viewingBoard = { title: "观看与临时标记验收", objects: [left, right, excluded] };
const button = (host, name) => host.getByRole("button", { name, exact: true });
const toolbar = (page, name) => page.getByRole("toolbar", { name, exact: true });
const viewing = (page) => toolbar(page, "全屏观看工具");
const zoomInput = (page) =>
  viewing(page).getByRole("textbox", { name: "全屏缩放比例", exact: true });
const viewingTrigger = (page) => button(page, "全屏观看选区");
const timerTrigger = (page) => button(page, "共享计时器");
const timer = (page) => page.getByRole("dialog", { name: "共享计时器", exact: true });
const minute = (page) => timer(page).getByRole("spinbutton", { name: "计时分钟", exact: true });
const timerSeconds = (page) =>
  timer(page).getByRole("spinbutton", { name: "计时秒数", exact: true });
const marker = (page) => button(viewing(page), "临时荧光笔");

async function openBoard(page, board) {
  await page.goto(board.url);
  await expect(page.getByRole("textbox", { name: "白板名称", exact: true })).toHaveValue(
    board.title,
  );
}

async function selectObject(page, studio, id) {
  const state = await readCanvas(page, studio);
  const box = state.objects.find((object) => object.id === id)?.box;
  if (!box?.width || !box.height) {
    throw new Error("The viewing target does not have measurable geometry: " + id);
  }

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function openViewing(page, studio, id = left.id) {
  await selectObject(page, studio, id);
  await viewingTrigger(page).click();
  await expect(viewing(page)).toBeVisible();
}

async function plotMarker(page, { x, y }, finished = true) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y + 12, { steps: 5 });
  await page.mouse.move(x + 116, y + 47, { steps: 4 });
  if (finished) {
    await page.mouse.up();
  }
}

async function expectCamera(page, studio, previous) {
  await expect
    .poll(async () => (await readCanvas(page, studio)).zoom)
    .toBeCloseTo(previous.zoom, 3);
  await expect
    .poll(async () => (await readCanvas(page, studio)).pan.x)
    .toBeCloseTo(previous.pan.x, 1);
  await expect
    .poll(async () => (await readCanvas(page, studio)).pan.y)
    .toBeCloseTo(previous.pan.y, 1);
}

async function expectWithinViewport(locator, viewport) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

test("[EDIT-VIEW-01] 共享计时器加减、暂停与恢复跨两个页面同步", async ({
  page,
  studio,
}, testInfo) => {
  const [board] = await studio.seedBoards([{ title: "角落共享计时验收" }]);
  await openBoard(page, board);
  await timerTrigger(page).click();
  await expect(minute(page)).toHaveValue("05");
  await button(timer(page), "增加一分钟").click();
  await expect(minute(page)).toHaveValue("06");
  await button(timer(page), "减少一分钟").click();
  await expect(minute(page)).toHaveValue("05");
  await expect(timerSeconds(page)).toHaveValue("00");
  await screenshot(page, testInfo, "shared-timer-adjusted");

  await button(timer(page), "开始").click();
  await expect(button(timer(page), "暂停")).toBeEnabled();
  const second = await page.context().newPage();
  try {
    await openBoard(second, board);
    await expect(button(timer(second), "暂停")).toBeEnabled();
    await button(timer(second), "暂停").click();
    await expect(button(timer(page), "继续")).toBeEnabled();
    await expect(button(timer(second), "继续")).toBeEnabled();
    const remaining = [await minute(page).inputValue(), await timerSeconds(page).inputValue()];
    await expect(minute(second)).toHaveValue(remaining[0]);
    await expect(timerSeconds(second)).toHaveValue(remaining[1]);
    await screenshot(second, testInfo, "shared-timer-paused-second-page");

    await timerTrigger(page).click();
    await expect(timer(page)).toBeHidden();
    await second.reload();
    await expect(button(timer(second), "继续")).toBeEnabled();
    await expect(minute(second)).toHaveValue(remaining[0]);
    await expect(timerSeconds(second)).toHaveValue(remaining[1]);
    await button(timer(second), "继续").click();
    await expect(button(timer(page), "暂停")).toBeEnabled();
    await button(timer(page), "暂停").click();
    await expect(button(timer(second), "重置")).toBeEnabled();
    await button(timer(second), "重置").click();
    await expect(button(timer(page), "开始")).toBeEnabled();
    await expect(minute(page)).toHaveValue("05");
    await expect(timerSeconds(page)).toHaveValue("00");
    await observe(testInfo, "shared-timer-room-sync", {
      nudgedMinutes: [5, 6, 5],
      pauseMatchesAcrossPages: true,
      pausedStateSurvivesRefresh: true,
      resumedAndReset: true,
    });
  } finally {
    await second.close();
  }
});

test("[EDIT-VIEW-02] 单选与混选全屏观看支持缩放、适配、返回相机和焦点", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard(viewingBoard);
  await openBoard(page, board);
  await selectObject(page, studio, left.id);
  const before = await readCanvas(page, studio);
  await viewingTrigger(page).click();
  await expect(viewing(page)).toBeVisible();
  await expect(button(viewing(page), "浏览内容")).toHaveAttribute("aria-pressed", "true");
  await expect(toolbar(page, "白板工具")).toBeHidden();
  await expect(timerTrigger(page)).toBeHidden();
  await expect(page.getByText(right.label, { exact: true })).toBeHidden();
  await expect(page.getByText(left.label, { exact: true })).toBeVisible();
  await screenshot(page, testInfo, "viewing-single-selection");

  await zoomInput(page).fill("801");
  await zoomInput(page).press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "请输入 5%–800% 的比例" })).toBeVisible();
  await zoomInput(page).press("Escape");
  await expect(viewing(page)).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "请输入 5%–800% 的比例" })).toBeHidden();
  await button(viewing(page), "常用全屏比例").click();
  await page.getByRole("menuitemradio", { name: "75%", exact: true }).click();
  await expect(zoomInput(page)).toHaveValue("75");
  await button(viewing(page), "全屏放大").click();
  await expect(zoomInput(page)).toHaveValue("90");
  await button(viewing(page), "全屏缩小").click();
  await expect(zoomInput(page)).toHaveValue("75");
  await button(viewing(page), "适应全屏内容").click();
  await expect(zoomInput(page)).not.toHaveValue("75");
  await page.keyboard.press("Escape");
  await expect(viewing(page)).toBeHidden();
  await expectCamera(page, studio, before);
  await expect(viewingTrigger(page)).toBeFocused();

  await page.keyboard.down("Shift");
  try {
    await selectObject(page, studio, right.id);
  } finally {
    await page.keyboard.up("Shift");
  }
  await viewingTrigger(page).click();
  await expect(viewing(page)).toBeVisible();
  await expect(page.getByText(left.label, { exact: true })).toBeVisible();
  await expect(page.getByText(right.label, { exact: true })).toBeVisible();
  await expect(page.getByText(excluded.label, { exact: true })).toBeHidden();
  await screenshot(page, testInfo, "viewing-mixed-selection");
  await button(page, "退出全屏观看").click();
  await expect(viewing(page)).toBeHidden();
  await expectCamera(page, studio, before);
  await expect(viewingTrigger(page)).toBeFocused();
  await screenshot(page, testInfo, "viewing-focus-restored");
  await observe(testInfo, "viewing-selection-camera", {
    single: [left.id],
    mixed: [left.id, right.id],
    invalidZoomRejected: true,
    cameraRestored: true,
    triggerFocusRestored: true,
  });
});

test("[EDIT-VIEW-03] 临时荧光笔可取消、淡出、清除，白板零持久", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard(viewingBoard);
  await openBoard(page, board);
  const saved = await studio.readBoard(board);
  await openViewing(page, studio);
  await marker(page).click();
  await expect(marker(page)).toHaveAttribute("aria-pressed", "true");
  const start = { x: 370, y: 260 };

  await plotMarker(page, start, false);
  await expect.poll(async () => (await readViewingInk(page, studio)).drawing).toBe(1);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(viewing(page)).toBeVisible();
  await expect.poll(async () => (await readViewingInk(page, studio)).count).toBe(0);

  await plotMarker(page, start);
  await expect.poll(async () => (await readViewingInk(page, studio)).count).toBe(1);
  await screenshot(page, testInfo, "viewing-temporary-marker");
  await expect
    .poll(async () => (await readViewingInk(page, studio)).fading, {
      timeout: 4_500,
      intervals: [60],
    })
    .toBe(1);
  await expect.poll(async () => (await readViewingInk(page, studio)).count).toBe(0);

  await plotMarker(page, { x: 500, y: 380 });
  await expect.poll(async () => (await readViewingInk(page, studio)).count).toBe(1);
  await button(viewing(page), "清除临时笔迹").click();
  await expect.poll(async () => (await readViewingInk(page, studio)).count).toBe(0);
  await button(viewing(page), "常用全屏比例").click();
  await page.getByRole("menuitemradio", { name: "75%", exact: true }).click();
  await expect(zoomInput(page)).toHaveValue("75");
  await expect.poll(async () => (await readViewingInk(page, studio)).count).toBe(0);
  await plotMarker(page, { x: 450, y: 300 });
  await expect.poll(async () => (await readViewingInk(page, studio)).count).toBe(1);
  await button(page, "退出全屏观看").click();
  await expect(viewing(page)).toBeHidden();
  await expect.poll(async () => (await readViewingInk(page, studio)).count).toBe(0);
  expect(await studio.readBoard(board)).toEqual(saved);

  await page.reload();
  await openViewing(page, studio);
  await expect(button(viewing(page), "浏览内容")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await readViewingInk(page, studio)).count).toBe(0);
  expect(await studio.readBoard(board)).toEqual(saved);
  await screenshot(page, testInfo, "viewing-without-saved-ink");
  await observe(testInfo, "temporary-marker-lifetime", {
    draftEscape: true,
    fadedAndRemoved: true,
    explicitClear: true,
    zoomControlsDoNotDraw: true,
    removedOnExitAndReload: true,
    persistedObjects: 0,
    persistedRevisions: 0,
  });
});

test("[EDIT-VIEW-04] 窄窗口亮暗色的共享计时器与沉浸控件完整可操作", async ({
  page,
  studio,
}, testInfo) => {
  const viewport = { width: 390, height: 760 };
  await page.setViewportSize(viewport);
  const board = await studio.seedBasicBoard(viewingBoard);
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    await openBoard(page, board);
    await timerTrigger(page).click();
    await expectWithinViewport(timer(page), viewport);
    await expect(button(timer(page), "增加一分钟")).toBeEnabled();
    await screenshot(page, testInfo, "viewing-narrow-timer-" + scheme);
    await timerTrigger(page).click();
    await openViewing(page, studio);
    await expectWithinViewport(viewing(page), viewport);
    await button(viewing(page), "常用全屏比例").click();
    const presets = page.getByRole("menu", { name: "全屏缩放比例预设", exact: true });
    await expectWithinViewport(presets, viewport);
    await screenshot(page, testInfo, "viewing-narrow-presets-" + scheme);
    await presets.getByRole("menuitemradio", { name: "75%", exact: true }).click();
    await expect(zoomInput(page)).toHaveValue("75");
    await screenshot(page, testInfo, "viewing-narrow-controls-" + scheme);
    await button(page, "退出全屏观看").click();
  }

  await observe(testInfo, "viewing-narrow-bounds", {
    viewport,
    schemes: ["light", "dark"],
    timerAndToolbarInsideViewport: true,
  });
});

test("[EDIT-VIEW-05] 只读访客可观看和圈画，不能改白板或共享计时", async ({
  page,
  browser,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard(viewingBoard);
  const probe = await workbenchLinkProbe({ page, browser, studio });
  try {
    await page.goto(studio.url);
    await button(page, "打开白板：" + board.title).hover();
    await button(page, "管理作品：" + board.title).click();
    await page.getByRole("menuitem", { name: "复制链接", exact: true }).click();
    await expect(page.getByText("链接已复制。", { exact: true })).toBeVisible();
    expect(await probe.checkpoint(board)).toMatchObject({ scope: "local", role: "viewer" });

    await openBoard(page, board);
    await timerTrigger(page).click();
    await button(timer(page), "开始").click();
    await expect(button(timer(page), "暂停")).toBeEnabled();
    const guest = await probe.openGuest(board);
    await expect(guest.getByRole("heading", { name: board.title, exact: true })).toBeVisible();
    await guest.getByRole("textbox", { name: /你的名字/u }).fill("观看验收访客");
    await button(guest, "打开白板").click();
    await expect(guest.getByText("只读", { exact: true })).toBeVisible();
    await expect(timer(guest)).toBeVisible();
    await expect(timer(guest).getByLabel("剩余时间", { exact: true })).toBeVisible();
    for (const name of ["暂停", "开始", "重置", "增加一分钟", "减少一分钟"]) {
      await expect(button(timer(guest), name)).toHaveCount(0);
    }
    await screenshot(guest, testInfo, "guest-read-only-shared-timer");
    await timerTrigger(guest).click();
    await expect(timer(guest)).toBeHidden();

    const saved = await studio.readBoard(board);
    await selectObject(guest, studio, left.id);
    await guest.keyboard.press("5");
    await guest.mouse.click(900, 270);
    expect(await studio.readBoard(board)).toEqual(saved);

    await openViewing(guest, studio);
    await marker(guest).click();
    await plotMarker(guest, { x: 350, y: 250 });
    await expect.poll(async () => (await readViewingInk(guest, studio)).count).toBe(1);
    expect(await readViewingInk(page, studio)).toEqual({ count: 0, drawing: 0, fading: 0 });
    await screenshot(guest, testInfo, "guest-local-temporary-marker");
    await button(viewing(guest), "清除临时笔迹").click();
    await expect.poll(async () => (await readViewingInk(guest, studio)).count).toBe(0);
    expect(await studio.readBoard(board)).toEqual(saved);
    await observe(testInfo, "viewer-permissions", {
      sharedTimerReadable: true,
      timerMutationControls: 0,
      boardUnchanged: true,
      temporaryMarkerLocalOnly: true,
    });
  } finally {
    await probe.close();
  }
});
