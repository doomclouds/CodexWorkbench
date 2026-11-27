import {
  chooseBoardMedia,
  expect,
  imageLoaded,
  mediaDisplaySize,
  mediaPlaying,
  observe,
  screenshot,
  test,
} from "../support/studio.mjs";

async function openMediaPicker(page, fixture) {
  const tools = page.getByRole("toolbar", { name: "白板工具", exact: true });
  await tools.getByRole("button", { name: "贴纸", exact: true }).click();
  const upload = page.getByRole("button", { name: "上传图片或视频", exact: true });
  await chooseBoardMedia(page, () => upload.click(), fixture);
}

function cropDialog(page) {
  return page.getByRole("dialog", { name: "裁剪图片", exact: true });
}

async function openCrop(page, image) {
  await image.click();
  await page.getByRole("button", { name: "裁剪图片", exact: true }).click();
  await expect(cropDialog(page)).toBeVisible();
}

test("[WB-OBJECT-07] 上传矢量图片，裁剪后重开，并显示不支持的文件错误", async ({
  page,
  studio,
}, testInfo) => {
  const [board] = await studio.seedBoards([{ title: "图片裁剪白板" }]);
  await page.goto(board.url);
  await openMediaPicker(page, "image");

  const image = page.getByRole("img", { name: "裁剪样图.svg", exact: true });
  await expect.poll(() => imageLoaded(image)).toBe(true);
  const original = await mediaDisplaySize(image);
  expect(original).toMatchObject({ naturalWidth: 320, naturalHeight: 180 });
  await screenshot(page, testInfo, "picture-uploaded-dark");

  await openCrop(page, image);
  const crop = cropDialog(page);
  const zoom = crop.getByRole("slider", { name: "裁剪缩放", exact: true });
  const horizontal = crop.getByRole("slider", { name: "裁剪水平位置", exact: true });
  const beforeHorizontal = await horizontal.inputValue();
  await zoom.press("ArrowRight");
  await zoom.press("ArrowRight");
  await horizontal.press("ArrowRight");
  const zoomValue = await zoom.inputValue();
  const horizontalValue = await horizontal.inputValue();
  expect(Number(zoomValue)).toBeGreaterThan(1);
  expect(Number(horizontalValue)).toBeGreaterThan(Number(beforeHorizontal));
  await screenshot(page, testInfo, "picture-crop-dark");
  await crop.getByRole("button", { name: "保存裁剪", exact: true }).click();
  await expect(crop).toBeHidden();
  await expect
    .poll(async () => (await mediaDisplaySize(image)).width)
    .toBeGreaterThan(original.width);

  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 680, height: 560 });
  await studio.restart();
  await page.reload();
  await expect.poll(() => imageLoaded(image)).toBe(true);
  await openCrop(page, image);
  await expect(zoom).toHaveValue(zoomValue);
  await expect(horizontal).toHaveValue(horizontalValue);
  await screenshot(page, testInfo, "picture-crop-reopened-light");
  await expect(crop.getByRole("heading", { name: "裁剪图片", exact: true })).toBeInViewport({
    ratio: 1,
  });
  const close = crop.getByRole("button", { name: "关闭裁剪", exact: true });
  await expect(close).toBeInViewport({ ratio: 1 });
  if (studio.edition === "ii") {
    await expect(close).toBeFocused();
    await close.press("Tab");
    await expect(zoom).toBeFocused();
  }
  await zoom.press("Escape");
  await expect(crop).toBeHidden();
  if (studio.edition === "ii") {
    await expect(page.getByRole("button", { name: "裁剪图片", exact: true })).toBeFocused();
  }
  await openCrop(page, image);
  await crop.getByRole("button", { name: "保存裁剪", exact: true }).click();
  await expect(crop).toBeHidden();

  await openMediaPicker(page, "invalid-image");
  const error = page.getByText(/支持 PNG|请选择有效的 PNG/u).first();
  await expect(error).toBeVisible();
  await expect(image).toHaveCount(1);
  await expect(page.getByRole("img", { name: "无法读取.txt", exact: true })).toHaveCount(0);
  await screenshot(page, testInfo, "picture-upload-error-light");
  const dismiss = studio.edition === "initial" ? "移除上传草稿" : "关闭";
  await page.getByRole("button", { name: dismiss, exact: true }).click();
  await expect(error).toBeHidden();
  await page.reload();
  await expect.poll(() => imageLoaded(image)).toBe(true);
  await expect(page.getByText("无法读取.txt", { exact: true })).toHaveCount(0);
  await observe(testInfo, "picture-upload-crop", {
    intrinsicSize: [320, 180],
    cropChangedImageExtent: true,
    cropPersistedAfterRestart: true,
    cropHeaderVisibleAtShortViewport: true,
    rejectedInvalidFile: true,
    dismissedErrorAndReopenedOriginal: true,
  });
});

async function playBoardVideo(canvas) {
  await expect
    .poll(() => mediaDisplaySize(canvas))
    .toMatchObject({
      naturalWidth: 16,
      naturalHeight: 16,
      width: 480,
      height: 270,
      controls: true,
    });
  const video = await mediaDisplaySize(canvas);
  await canvas.click({ position: { x: video.x + video.width / 2, y: video.y + video.height / 2 } });
  await expect.poll(() => mediaPlaying(canvas)).toBe(true);
}

async function setBoardZoom(page, value) {
  await page.getByRole("button", { name: "缩放菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: value, exact: true }).click();
}

test("[WB-OBJECT-08] 视频采用默认显示尺寸，且重开后仍能真实播放", async ({
  page,
  studio,
}, testInfo) => {
  const [board] = await studio.seedBoards([{ title: "视频播放白板" }]);
  await page.goto(board.url);
  await openMediaPicker(page, "video");
  const canvas =
    studio.edition === "initial"
      ? page.getByLabel("白板画布", { exact: true })
      : page.getByRole("region", { name: board.title, exact: true });
  await expect
    .poll(() => mediaDisplaySize(canvas))
    .toMatchObject({ naturalWidth: 16, naturalHeight: 16, controls: true });
  await setBoardZoom(page, "25%");
  await expect
    .poll(() => mediaDisplaySize(canvas))
    .toMatchObject({
      width: 120,
      height: 68,
      controls: false,
    });
  await screenshot(page, testInfo, "video-controls-hidden-dark");
  await setBoardZoom(page, "100%");
  await playBoardVideo(canvas);
  await screenshot(page, testInfo, "video-played-dark");

  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 850, height: 700 });
  await studio.restart();
  await page.reload();
  await playBoardVideo(canvas);
  await screenshot(page, testInfo, "video-reopened-light");
  await observe(testInfo, "video-size-and-playback", {
    displaySize: [480, 270],
    videoSize: [16, 16],
    controlsHiddenAt25Percent: true,
    controlsRestoredAt100Percent: true,
    playedAfterUpload: true,
    playedAfterRestart: true,
  });
});

async function openLinkDialog(page, studio) {
  const tools = page.getByRole("toolbar", { name: "白板工具", exact: true });
  await tools.getByRole("button", { name: "形状", exact: true }).click();
  await page.getByRole("button", { name: "链接", exact: true }).click();
  const name = studio.edition === "initial" ? "添加链接" : "链接";
  const dialog = page.getByRole("dialog", { name, exact: true });
  await expect(dialog).toBeVisible();

  return dialog;
}

test("[WB-OBJECT-09] 独立链接可校验、取消、保存并打开", async ({ page, studio }, testInfo) => {
  const [board] = await studio.seedBoards([{ title: "独立链接白板" }]);
  await page.goto(board.url);
  let dialog = await openLinkDialog(page, studio);
  const label = "本机工作台入口";
  const open = page.getByRole("link", { name: "打开链接", exact: true });
  const linkTitle = page.getByRole("strong").filter({ hasText: label });
  await expect(dialog.getByRole("textbox", { name: "网页地址", exact: true })).toBeFocused();
  await dialog.getByRole("textbox", { name: "名称", exact: true }).fill(label);
  await dialog.getByRole("textbox", { name: "网页地址", exact: true }).fill("无效地址");
  await expect(dialog.getByRole("button", { name: "保存到白板", exact: true })).toBeDisabled();
  await screenshot(page, testInfo, "link-validation-dark");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(linkTitle).toHaveCount(0);

  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 850, height: 700 });
  dialog = await openLinkDialog(page, studio);
  await dialog.getByRole("textbox", { name: "名称", exact: true }).fill(label);
  await dialog.getByRole("textbox", { name: "网页地址", exact: true }).fill(studio.url);
  await dialog.getByRole("button", { name: "保存到白板", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(linkTitle).toBeVisible();
  await studio.restart();
  await page.reload();
  await expect(linkTitle).toBeVisible();
  await expect(open).toHaveAttribute("href", studio.url);
  await screenshot(page, testInfo, "link-reopened-light");
  const [target] = await Promise.all([page.waitForEvent("popup"), open.click()]);
  await expect(target).toHaveURL(studio.url);
  await expect(target.getByRole("button", { name: "打开白板：" + board.title })).toBeVisible();
  await target.close();
  await observe(testInfo, "standalone-link", {
    invalidAddressDisabledSave: true,
    cancelledWithoutAddingObject: true,
    savedTitleAndAddressReadBack: true,
    destinationOpened: true,
  });
});
