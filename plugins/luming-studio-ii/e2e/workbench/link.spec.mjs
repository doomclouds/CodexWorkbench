import { expect, observe, screenshot, test, workbenchLinkProbe } from "../support/studio.mjs";

test.use({ trace: "off", screenshot: "off", video: "off" });

async function copyBoardLink(page, board) {
  await page.getByRole("button", { name: "打开白板：" + board.title, exact: true }).hover();
  await page.getByRole("button", { name: "管理作品：" + board.title, exact: true }).click();
  await page.getByRole("menuitem", { name: "复制链接", exact: true }).click();
  await expect(page.getByText("链接已复制。", { exact: true })).toBeVisible();
}

async function openViewingGuest(probe, board, nickname) {
  const guest = await probe.openGuest(board);
  await expect(guest.getByRole("heading", { name: board.title, exact: true })).toBeVisible();
  await expect(guest.getByText("你被邀请查看这块白板。", { exact: true })).toBeVisible();
  await guest.getByRole("textbox", { name: /你的名字/u }).fill(nickname);
  await guest.getByRole("button", { name: "打开白板", exact: true }).click();
  await expect(guest.getByRole("button", { name: "分享", exact: true })).toBeVisible();
  await expect(guest.getByText("只读", { exact: true })).toBeVisible();

  return guest;
}

test("[WB-LINK-01] 从卡片复制默认本机查看链接并在独立会话打开白板", async ({
  page,
  browser,
  studio,
}, testInfo) => {
  const [board] = await studio.seedBoards([{ title: "发布审批白板", withContent: true }]);
  const probe = await workbenchLinkProbe({ page, browser, studio });
  try {
    expect(await probe.sharingState(board)).toEqual({ enabled: false, scope: "local" });
    await page.goto(studio.url);
    await copyBoardLink(page, board);
    const state = await probe.checkpoint(board);
    expect(state).toMatchObject({ scope: "local", role: "viewer" });
    await screenshot(page, testInfo, "workspace-link-copied");

    const guest = await openViewingGuest(probe, board, "审批查看者");
    await expect(guest.getByText(board.contentText, { exact: true })).toBeVisible();
    await observe(testInfo, "default-viewer-link", {
      scope: state.scope,
      role: state.role,
      guestReadOnly: true,
      copiedBoardOpened: true,
    });
  } finally {
    await probe.close();
  }
});

test("[WB-LINK-02] 重开工作台后保留已保存的本机查看邀请", async ({
  page,
  browser,
  studio,
}, testInfo) => {
  const [board] = await studio.seedBoards([{ title: "保留邀请白板" }]);
  const probe = await workbenchLinkProbe({ page, browser, studio });
  try {
    await page.goto(studio.url);
    await copyBoardLink(page, board);
    await expect.poll(probe.copyCount).toBe(1);
    expect(await probe.sharingState(board)).toEqual({ enabled: true, scope: "local" });

    await page.reload();
    for (const count of [2, 3]) {
      await copyBoardLink(page, board);
      await expect.poll(probe.copyCount).toBe(count);
      expect(await probe.checkpoint(board)).toEqual({
        scope: "local",
        role: "viewer",
        sameAsFirst: true,
      });
    }

    await openViewingGuest(probe, board, "返回查看者");
    await observe(testInfo, "existing-viewer-link", {
      savedLinkReused: true,
      copies: probe.copyCount(),
      scope: "local",
      lanEnabled: false,
    });
  } finally {
    await probe.close();
  }
});

test("[WB-LINK-03] 两张白板的邀请链接和访客会话各自独立", async ({
  page,
  browser,
  studio,
}, testInfo) => {
  const [firstBoard, secondBoard] = await studio.seedBoards([
    { title: "第一组邀请白板" },
    { title: "第二组邀请白板" },
  ]);
  const probe = await workbenchLinkProbe({ page, browser, studio });
  try {
    await page.goto(studio.url);
    await copyBoardLink(page, firstBoard);
    await expect.poll(probe.copyCount).toBe(1);
    expect(await probe.sharingState(secondBoard)).toEqual({ enabled: false, scope: "local" });
    await openViewingGuest(probe, firstBoard, "独立查看者");

    await copyBoardLink(page, secondBoard);
    await expect.poll(probe.copyCount).toBe(2);
    expect(await probe.checkpoint(secondBoard)).toEqual({
      scope: "local",
      role: "viewer",
      sameAsFirst: false,
    });
    await openViewingGuest(probe, secondBoard, "独立查看者");
    await observe(testInfo, "independent-viewer-links", {
      distinctInvitations: true,
      anotherBoardNotSharedByFirstCopy: true,
      separateGuestsOpenedMatchingBoards: true,
    });
  } finally {
    await probe.close();
  }
});
