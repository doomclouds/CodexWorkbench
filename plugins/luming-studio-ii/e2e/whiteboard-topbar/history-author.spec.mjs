import {
  expect,
  readCanvas,
  readHistoryAuthorPresentation,
  screenshot,
  test,
  workbenchLinkProbe,
} from "../support/studio.mjs";

test.use({ trace: "off", screenshot: "off", video: "off" });

const object = {
  id: "plan",
  kind: "shape",
  label: "发布方案",
  x: 160,
  y: 160,
  width: 220,
  height: 100,
};

function button(root, name) {
  return root.getByRole("button", { name, exact: true });
}

test("[TOPBAR-HIST-05] 访客编辑记录显示用户名和协作头像颜色", async ({
  page,
  browser,
  studio,
}, testInfo) => {
  const initial = studio.edition === "initial";
  const name = initial
    ? "现场编辑访客"
    : "参与白板发布和协作编辑验收的现场访客并核对窄屏版本历史的姓名显示";
  const edited = "访客核对发布方案";
  const probe = await workbenchLinkProbe({ page, browser, studio });
  try {
    const board = await studio.seedBasicBoard({ title: "版本作者验收", objects: [object] });
    await page.goto(board.url);
    await button(page, "分享").click();
    await button(page, "复制可编辑链接").click();
    await expect.poll(probe.copyCount).toBe(1);
    const guest = await probe.openGuest(board, { role: "editor" });
    await guest.getByRole("textbox", { name: /你的名字/u }).fill(name);
    await button(guest, "打开白板").click();
    await guest.getByText(object.label, { exact: true }).dblclick();
    await guest.getByRole("textbox", { name: "编辑文字", exact: true }).fill(edited);
    const { bounds } = await readCanvas(guest, studio);
    await guest.mouse.click(bounds.x + 55, bounds.y + 145);
    await expect.poll(async () => (await studio.readBoard(board)).objects[0].text).toBe(edited);
    const { revision } = await studio.readBoard(board);

    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 650, height: 820 });
    await button(page, "版本历史").click();
    const version = button(page, "展开版本 " + revision);
    await expect(version).toBeVisible();
    await screenshot(page, testInfo, "named-guest-version");
    await expect(version.getByText(name, { exact: true })).toBeVisible();
    const participant = initial ? undefined : button(page, "此刻在这里");
    const expectedAppearance = initial
      ? { avatarSize: [36, 36] }
      : { avatarSize: [28, 28], sameColor: true, shortened: true, timeReadable: true };
    await expect
      .poll(() => readHistoryAuthorPresentation(version, participant))
      .toMatchObject(expectedAppearance);

    if (!initial) {
      await version.click();
      await button(page, "看改动").click();
      const history = page.getByRole("dialog", { name: "版本历史面板", exact: true });
      await expect(history.getByText(name, { exact: true })).toBeVisible();
      await screenshot(page, testInfo, "named-guest-difference");
    }
  } finally {
    await probe.close();
  }
});
