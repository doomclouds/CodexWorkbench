import {
  expect,
  observe,
  readCanvas,
  readPeerCursors,
  screenshot,
  setRoomConnectionOffline,
  test,
  workbenchLinkProbe,
} from "../support/studio.mjs";

const sample = {
  id: "presence-shape",
  kind: "shape",
  label: "协作定位样板",
  x: 410,
  y: 290,
  width: 210,
  height: 110,
};
const editorName = "协作编辑甲";
const secondEditorName = "协作编辑乙";
const smallerViewport = { width: 1000, height: 650 };
const roomExpiryTimeout = 23_000;

function button(scope, name) {
  return scope.getByRole("button", { name, exact: true });
}

function participantMenu(page) {
  return page.getByRole("dialog", { name: "此刻在这里", exact: true });
}

async function openPresenceBoard(
  { page, browser, studio },
  title,
  { leaveSharingOpen = false } = {},
) {
  const board = await studio.seedBasicBoard({ title, objects: [sample] });
  const probe = await workbenchLinkProbe({ page, browser, studio });
  try {
    await page.goto(board.url);
    await expect(page.getByText(sample.label, { exact: true })).toBeVisible();
    await button(page, "分享").click();
    await button(page, "复制可编辑链接").click();
    await expect.poll(probe.copyCount).toBe(1);
    await probe.checkpoint(board, "editor");
    if (!leaveSharingOpen) {
      await button(page, studio.edition === "ii" ? "关闭分享" : "关闭" + board.title).click();
    }
  } catch (error) {
    await probe.close();
    throw error;
  }

  async function addEditor(name, viewport) {
    const guest = await probe.openGuest(board, { role: "editor", viewport });
    await guest.getByRole("textbox", { name: /你的名字/u }).fill(name);
    await button(guest, "打开白板").click();
    await expect(guest.getByText(sample.label, { exact: true })).toBeVisible();
    await expect(guest.getByRole("toolbar", { name: "白板工具", exact: true })).toBeVisible();
    return guest;
  }

  return { board, addEditor, close: () => probe.close() };
}

function projectPoint(view, point) {
  return {
    x: view.bounds.x + view.pan.x + view.zoom * point.x,
    y: view.bounds.y + view.pan.y + view.zoom * point.y,
  };
}

function centerOfView(view) {
  return {
    x: (view.bounds.width / 2 - view.pan.x) / view.zoom,
    y: (view.bounds.height / 2 - view.pan.y) / view.zoom,
  };
}

function sampleBox(view) {
  const item = view.objects.find(({ id }) => id === sample.id);
  if (!item?.box) {
    throw new Error("The observation object has no visible geometry.");
  }

  return item.box;
}

async function moveCursor(page, studio, point) {
  const projection = projectPoint(await readCanvas(page, studio), point);
  await page.mouse.move(projection.x, projection.y);
}

async function expectCursor(page, studio, name, point) {
  await expect
    .poll(async () => {
      const [view, cursors] = await Promise.all([
        readCanvas(page, studio),
        readPeerCursors(page, studio),
      ]);
      const cursor = cursors.find((candidate) => candidate.name === name);
      const expected = projectPoint(view, point);
      return cursor ? Math.hypot(cursor.x - expected.x, cursor.y - expected.y) : Infinity;
    })
    .toBeLessThan(4);
}

async function checkGuests(page, names) {
  await button(page, "此刻在这里").click();
  const menu = participantMenu(page);
  for (const name of names) {
    await expect(menu.getByText(name, { exact: true })).toBeVisible();
  }
  await expect(menu.getByText(/可编辑/u)).toHaveCount(names.length);
  await button(menu, "关闭此刻在这里").click();
}

async function startFollowing(page, studio, name) {
  await button(page, "此刻在这里").click();
  const menu = participantMenu(page);
  const follow = button(menu, studio.edition === "ii" ? "跟随 " + name : "跟随");
  await expect(follow).toBeEnabled();
  await follow.click();
  await expect(page.getByText(new RegExp("正在跟随 " + name, "u"))).toBeVisible();
}

function followZoom(local, remote, edition) {
  const ratio = Math.min(
    local.bounds.width / remote.bounds.width,
    local.bounds.height / remote.bounds.height,
  );
  const zoom = remote.zoom * ratio;
  return edition === "ii" ? Math.max(0.05, Math.min(8, zoom)) : Math.max(0.1, Math.min(4, zoom));
}

async function expectFollowView(page, studio, leader) {
  const expectedCenter = centerOfView(leader);
  await expect
    .poll(async () => {
      const current = await readCanvas(page, studio);
      const center = centerOfView(current);
      const shift = Math.hypot(center.x - expectedCenter.x, center.y - expectedCenter.y);
      const scale = Math.abs(current.zoom - followZoom(current, leader, studio.edition));
      return shift < 4 && scale < 0.025;
    })
    .toBe(true);
}

async function zoomTo(page, value) {
  const zoom = button(page, "缩放菜单");
  await zoom.click();
  await page.getByRole("menuitem", { name: value, exact: true }).click();
  await expect(zoom).toHaveText(value);
}

async function pan(page, studio, dx, dy) {
  const view = await readCanvas(page, studio);
  const point = {
    x: view.bounds.x + view.bounds.width * 0.35,
    y: view.bounds.y + view.bounds.height * 0.35,
  };
  await button(page, "平移").click();
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + dx, point.y + dy, { steps: 5 });
  await page.mouse.up();
}

test("[COLLAB-PRESENCE-05] 复制链接保留分享面板位置", async ({
  page,
  browser,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({ title: "复制邀请链接", objects: [sample] });
  const probe = await workbenchLinkProbe({ page, browser, studio });
  try {
    await page.setViewportSize(smallerViewport);
    await page.goto(board.url);
    await button(page, "分享").click();
    const editor = button(page, "复制可编辑链接");
    const viewer = button(page, "复制仅查看链接");
    await editor.click();
    await expect.poll(probe.copyCount).toBe(1);
    await probe.checkpoint(board, "editor");
    await expect(viewer).toBeEnabled();
    await viewer.scrollIntoViewIfNeeded();

    const heading = page.getByRole("heading", { name: "有权访问的人", exact: true });
    const positions = () =>
      Promise.all([heading.boundingBox(), editor.boundingBox(), viewer.boundingBox()]);
    const before = await positions();
    expect(before).not.toContain(null);
    await viewer.click();
    await expect.poll(probe.copyCount).toBe(2);
    await probe.checkpoint(board, "viewer");

    if (studio.edition === "ii") {
      const copied = viewer.getByText("已复制", { exact: true });
      await expect(copied).toBeVisible();
      await expect(editor.getByText("已复制", { exact: true })).toBeHidden();
      expect(await positions()).toEqual(before);
      await screenshot(page, testInfo, "copy-feedback-on-button");
      await expect(copied).toBeHidden();
      expect(await positions()).toEqual(before);
    } else {
      await expect(viewer).toBeVisible();
      await screenshot(page, testInfo, "initial-copy-feedback");
    }
  } finally {
    await probe.close();
  }
});

test("[COLLAB-PRESENCE-01] 两位编辑者的独立光标按画板坐标显示并清除", async ({
  page,
  browser,
  studio,
}, testInfo) => {
  const room = await openPresenceBoard({ page, browser, studio }, "独立协作光标");
  try {
    const guestA = await room.addEditor(editorName, smallerViewport);
    const guestB = await room.addEditor(secondEditorName, { width: 1200, height: 740 });
    await checkGuests(page, [editorName, secondEditorName]);
    const first = { x: sample.x + 26, y: sample.y + 24 };
    const second = { x: sample.x + 150, y: sample.y + 71 };
    await moveCursor(guestA, studio, first);
    await moveCursor(guestB, studio, second);
    await expectCursor(page, studio, editorName, first);
    await expectCursor(page, studio, secondEditorName, second);
    await expectCursor(guestA, studio, secondEditorName, second);
    await screenshot(page, testInfo, "owner-sees-two-distinct-editors");
    await screenshot(guestA, testInfo, "editor-sees-peer-cursor");

    await guestA.mouse.move(40, 12);
    await expect
      .poll(async () => (await readPeerCursors(page, studio)).map(({ name }) => name))
      .toEqual([secondEditorName]);
    await guestB.close();
    await expect
      .poll(async () => (await readPeerCursors(page, studio)).length, {
        timeout: roomExpiryTimeout,
      })
      .toBe(0);
    await checkGuests(page, [editorName]);
    await observe(testInfo, "cursor-lifecycle", {
      namedEditors: 2,
      projectionsMatch: true,
      pointerExitClears: true,
      departureClears: true,
    });
  } finally {
    await room.close();
  }
});

test("[COLLAB-PRESENCE-02] 编辑者拖动预览实时到达，松手后才写入", async ({
  page,
  browser,
  studio,
}, testInfo) => {
  const room = await openPresenceBoard({ page, browser, studio }, "协作拖动回执");
  try {
    const guest = await room.addEditor(editorName, smallerViewport);
    await checkGuests(page, [editorName]);
    const persisted = () => studio.readBoard(room.board);
    const before = await persisted();
    const initial = sampleBox(await readCanvas(page, studio));
    const origin = projectPoint(await readCanvas(guest, studio), {
      x: sample.x + sample.width / 2,
      y: sample.y + sample.height / 2,
    });
    await guest.mouse.move(origin.x, origin.y);
    await guest.mouse.down();
    try {
      await guest.mouse.move(origin.x + 108, origin.y + 52, { steps: 8 });
      if (studio.edition === "initial") {
        await expect(page.getByLabel(/正在调整对象$/u)).toBeVisible();
      } else {
        await expect
          .poll(async () => sampleBox(await readCanvas(page, studio)).x)
          .toBeGreaterThan(initial.x + 50);
      }
      expect(await persisted()).toEqual(before);
      await screenshot(page, testInfo, "owner-sees-move-before-commit");
    } finally {
      await guest.mouse.up();
    }
    await expect
      .poll(async () => (await persisted()).objects.find(({ id }) => id === sample.id)?.x)
      .toBeGreaterThan(sample.x + 50);
    await expect
      .poll(async () => sampleBox(await readCanvas(page, studio)).x)
      .toBeGreaterThan(initial.x + 50);
    await expect(page.getByLabel(/正在调整对象$/u)).toBeHidden();
    await screenshot(page, testInfo, "owner-sees-saved-editor-move");
    await observe(testInfo, "editor-publishes-preview-and-save", {
      visibleBeforeCommit: true,
      boardUnchangedUntilRelease: true,
      editorCommitVisibleToOwner: true,
    });
  } finally {
    await room.close();
  }
});

test("[COLLAB-PRESENCE-03] 不同尺寸视口跟随平移缩放并可停止", async ({
  page,
  browser,
  studio,
}, testInfo) => {
  const room = await openPresenceBoard({ page, browser, studio }, "协作视口跟随");
  try {
    const guest = await room.addEditor(editorName, smallerViewport);
    await zoomTo(guest, "150%");
    await pan(guest, studio, 108, 62);
    await startFollowing(page, studio, editorName);
    await expectFollowView(page, studio, await readCanvas(guest, studio));
    await pan(guest, studio, -142, 90);
    await expectFollowView(page, studio, await readCanvas(guest, studio));
    await zoomTo(guest, "75%");
    await expectFollowView(page, studio, await readCanvas(guest, studio));
    await screenshot(page, testInfo, "owner-follows-resized-editor");

    await button(page, "停止跟随").click();
    await expect(button(page, "停止跟随")).toBeHidden();
    const stopped = await readCanvas(page, studio);
    await zoomTo(guest, "100%");
    const cursor = { x: sample.x + 60, y: sample.y + 50 };
    await moveCursor(guest, studio, cursor);
    await expectCursor(page, studio, editorName, cursor);
    const after = await readCanvas(page, studio);
    expect(after.pan).toEqual(stopped.pan);
    expect(after.zoom).toBe(stopped.zoom);

    await startFollowing(page, studio, editorName);
    await zoomTo(page, "50%");
    await expect(button(page, "停止跟随")).toBeHidden();
    await screenshot(page, testInfo, "owner-navigation-detaches-follow");
    await observe(testInfo, "follow-view-matches", {
      differentViewportSizes: true,
      pan: true,
      zoom: true,
      explicitStop: true,
      localNavigationDetaches: true,
    });
  } finally {
    await room.close();
  }
});

test("[COLLAB-PRESENCE-04] 暂离时清理临时画面，重连后恢复视角跟随", async ({
  page,
  browser,
  studio,
}, testInfo) => {
  const room = await openPresenceBoard({ page, browser, studio }, "协作断线恢复");
  try {
    const guest = await room.addEditor(editorName, smallerViewport);
    await startFollowing(page, studio, editorName);
    const cursor = { x: sample.x + 45, y: sample.y + 38 };
    await moveCursor(guest, studio, cursor);
    await expectCursor(page, studio, editorName, cursor);
    if (studio.edition === "ii") {
      await setRoomConnectionOffline(page, studio, true);
      try {
        await moveCursor(page, studio, { x: sample.x + 12, y: sample.y + 18 });
        await expect(page.getByText("正在重新连接白板 · 暂停跟随 " + editorName)).toBeVisible();
        await expect.poll(async () => (await readPeerCursors(page, studio)).length).toBe(0);
        await screenshot(page, testInfo, "owner-offline-follow-pauses");
        await pan(guest, studio, 110, 72);
      } finally {
        await setRoomConnectionOffline(page, studio, false);
      }
      await expect(page.getByText("正在跟随 " + editorName + " 的视角")).toBeVisible();
      await expectFollowView(page, studio, await readCanvas(guest, studio));
      await screenshot(page, testInfo, "owner-reconnect-restores-follow");
    }

    await guest.close();
    await expect(button(page, "停止跟随")).toBeHidden({ timeout: roomExpiryTimeout });
    await expect.poll(async () => (await readPeerCursors(page, studio)).length).toBe(0);
    await observe(testInfo, "removed-peer-does-not-leave-follow-or-cursor", {
      departureClearsFollow: true,
      departureClearsCursor: true,
    });
  } finally {
    await room.close();
  }
});

test("[COLLAB-PRESENCE-06] 分享面板保持打开时更新成员在线和最近访问状态", async ({
  page,
  browser,
  studio,
}, testInfo) => {
  const room = await openPresenceBoard({ page, browser, studio }, "分享成员在线更新", {
    leaveSharingOpen: true,
  });

  try {
    const sharing = page.getByRole("heading", { name: "加入的人", exact: true });
    await expect(sharing).toBeVisible();
    const guest = await room.addEditor(editorName, smallerViewport);
    const member = page.getByText(editorName, { exact: true });
    const online = page.getByText("在线", { exact: true });
    const offline = page.getByText(/^(?:离线|最近访问)/u);
    await expect(member).toBeVisible();
    await expect(online).toBeVisible();
    await screenshot(page, testInfo, "open-share-member-online");

    await setRoomConnectionOffline(guest, studio, true);
    try {
      await expect(online).toBeHidden({ timeout: roomExpiryTimeout + 5000 });
      await expect(offline).toBeVisible();
      await expect(member).toBeVisible();
      await screenshot(page, testInfo, "open-share-member-offline");
    } finally {
      await setRoomConnectionOffline(guest, studio, false);
    }
    await expect(online).toBeVisible({ timeout: roomExpiryTimeout });
    await screenshot(page, testInfo, "open-share-member-reconnects");

    await guest.close();
    await expect(online).toBeHidden({ timeout: roomExpiryTimeout + 5000 });
    await expect(offline).toBeVisible();
    await expect(member).toBeVisible();
    await expect(sharing).toBeVisible();
    await observe(testInfo, "open-share-members-follow-active-session", {
      joinAppears: true,
      networkLossShowsOffline: true,
      reconnectShowsOnline: true,
      closedTabRemainsInRoster: true,
    });
  } finally {
    await room.close();
  }
});

function activeEdit(scope) {
  return scope.getByRole("status", { name: /正在编辑(?:此对象)?$/u });
}

async function startSampleEdit(scope) {
  await scope.getByText(sample.label, { exact: true }).dblclick();
  const input = scope.getByRole("textbox", { name: "编辑文字", exact: true });
  await expect(input).toBeFocused();

  return input;
}

async function expectOutlineFollowsObject(page, studio, marker) {
  await expect
    .poll(async () => {
      const actual = await marker.boundingBox();
      const object = sampleBox(await readCanvas(page, studio));
      if (!actual) {
        return Infinity;
      }

      return Math.hypot(
        actual.x + actual.width / 2 - (object.x + object.width / 2),
        actual.y + actual.height / 2 - (object.y + object.height / 2),
      );
    })
    .toBeLessThan(3);
}

test("[COLLAB-PRESENCE-07] 实际编辑显示远端对象，结束与关闭视图后清除", async ({
  page,
  browser,
  studio,
}, testInfo) => {
  const room = await openPresenceBoard({ page, browser, studio }, "远端对象编辑提示");

  try {
    const guest = await room.addEditor(editorName, smallerViewport);
    const ownerMark = activeEdit(page);
    const guestMark = activeEdit(guest);
    await guest.getByText(sample.label, { exact: true }).click();
    await expect(guest.getByRole("toolbar", { name: "选区格式", exact: true })).toBeVisible();
    const pointer = { x: sample.x + 50, y: sample.y + 42 };
    await moveCursor(guest, studio, pointer);
    await expectCursor(page, studio, editorName, pointer);
    await expect(ownerMark).toHaveCount(0);

    const guestEditor = await startSampleEdit(guest);
    await expect(ownerMark).toHaveCount(1);
    await expect(ownerMark).toContainText(editorName + " · 正在编辑");
    await expect(guestMark).toHaveCount(0);
    await expectOutlineFollowsObject(page, studio, ownerMark);
    await zoomTo(page, "150%");
    await pan(page, studio, 46, 24);
    await expectOutlineFollowsObject(page, studio, ownerMark);
    await screenshot(page, testInfo, "guest-edit-outline-on-owner");
    await guestEditor.press("Escape");
    await expect(ownerMark).toHaveCount(0);

    await button(page, "选择").click();
    const ownerEditor = await startSampleEdit(page);
    await expect(guestMark).toHaveCount(1);
    await expect(ownerMark).toHaveCount(0);
    await expectOutlineFollowsObject(guest, studio, guestMark);
    await screenshot(guest, testInfo, "owner-edit-outline-on-guest");
    await ownerEditor.press("Escape");
    await expect(guestMark).toHaveCount(0);

    await startSampleEdit(guest);
    await expect(ownerMark).toHaveCount(1);
    await guest.close();
    await expect(ownerMark).toHaveCount(0, { timeout: roomExpiryTimeout });
    await observe(testInfo, "actual-peer-edit-outline", {
      selectedOnlyHidden: true,
      visibleInBothDirections: true,
      ownEditHidden: true,
      followsPanAndZoom: true,
      exitAndDepartureClear: true,
    });
  } finally {
    await room.close();
  }
});
