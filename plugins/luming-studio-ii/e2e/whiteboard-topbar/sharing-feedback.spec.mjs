import {
  expect,
  observe,
  readCanvas,
  screenshot,
  test,
  workbenchLinkProbe,
} from "../support/studio.mjs";

test.use({ trace: "off", screenshot: "off", video: "off" });

const object = {
  id: "topbar-shape",
  kind: "shape",
  label: "需要复核的发布范围",
  x: 240,
  y: 185,
  width: 250,
  height: 130,
};

const roles = {
  viewer: { label: "仅查看", verb: "查看", name: "现场查看者" },
  commenter: { label: "可评论", verb: "评论", name: "审阅同事" },
  editor: { label: "可编辑", verb: "编辑", name: "协作编辑者" },
};

function button(scope, name) {
  return scope.getByRole("button", { name, exact: true });
}

function menuItem(scope, name) {
  return scope.getByRole("menuitem", { name, exact: true });
}

function notePin(page, text) {
  return page.getByRole("button", { name: new RegExp("^备注 .*：" + text + "$", "u") });
}

async function noteColor(page, text) {
  const marker = notePin(page, text);
  await expect(marker).toHaveCount(1);
  const style = await marker.getAttribute("style");
  const color = style?.match(/(?:^|;\s*)background-color:\s*([^;]+)/u)?.[1];
  expect(color).toBeTruthy();
  return color;
}

function noteEditor(page) {
  return page.getByRole("textbox", { name: "批注内容", exact: true });
}

function noteList(page) {
  return page.getByRole("dialog", { name: "所有备注", exact: true });
}

function threadText(page, text) {
  return noteList(page).getByText(text, { exact: true });
}

async function openBoard(page, studio, title) {
  const board = await studio.seedBasicBoard({ title, objects: [object] });
  await page.goto(board.url);
  await expect(page.getByText(object.label, { exact: true })).toBeVisible();

  return board;
}

async function openShare(page) {
  await button(page, "分享").click();
  await expect(page.getByRole("heading", { name: "邀请链接", exact: true })).toBeVisible();
}

async function closeShare(page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "邀请链接", exact: true })).toBeHidden();
}

async function joinViaRole(page, probe, board, role) {
  const { label, verb, name } = roles[role];
  const before = probe.copyCount();
  await button(page, "复制" + label + "链接").click();
  await expect.poll(probe.copyCount).toBe(before + 1);
  expect(await probe.checkpoint(board, role)).toMatchObject({ role, scope: "local" });

  const guest = await probe.openGuest(board, {
    role,
    viewport: { width: 1366, height: 820 },
  });
  await expect(guest.getByRole("heading", { name: board.title, exact: true })).toBeVisible();
  await expect(guest.getByText("你被邀请" + verb + "这块白板。", { exact: true })).toBeVisible();
  await guest.getByRole("textbox", { name: /你的名字/u }).fill(name);
  await button(guest, "打开白板").click();
  await expect(guest.getByText(object.label, { exact: true })).toBeVisible();

  return guest;
}

async function pointAwayFromObjects(page, studio) {
  const { bounds } = await readCanvas(page, studio);

  return { x: bounds.x + 55, y: bounds.y + 145 };
}

async function postBoardNote(page, studio, text, objectTarget = false) {
  const toggle = button(page, "备注");
  if ((await toggle.getAttribute("aria-pressed")) !== "true") {
    await toggle.click();
  }

  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  if (objectTarget) {
    await page.getByText(object.label, { exact: true }).click();
  } else {
    const point = await pointAwayFromObjects(page, studio);
    await page.mouse.click(point.x, point.y);
  }

  await expect(noteEditor(page)).toBeFocused();
  await noteEditor(page).fill(text);
  await button(page, "保存备注").click();
  await expect(noteEditor(page)).toHaveCount(0);
  await expect(notePin(page, text)).toBeVisible();
}

async function openNoteList(page) {
  const toggle = button(page, "备注列表");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(noteList(page)).toBeVisible();
}

function memberAction(page, studio, name) {
  const label = studio.edition === "initial" ? "管理成员：" + name : name + "的访问权限";

  return button(page, label);
}

async function chooseMemberRole(page, studio, name, role) {
  const control = memberAction(page, studio, name);
  await control.click();
  const roleItem = studio.edition === "initial" ? "menuitemradio" : "menuitem";
  await page.getByRole(roleItem, { name: role, exact: true }).click();
  await expect(control).toContainText(role);
}

test("[TOPBAR-SHARE-01] 顶部分享生成三种本机邀请，来宾各自执行权限内操作", async ({
  page,
  browser,
  studio,
}, testInfo) => {
  const probe = await workbenchLinkProbe({ page, browser, studio });
  try {
    const board = await openBoard(page, studio, "三种权限现场验证");
    expect(await probe.sharingState(board)).toEqual({ enabled: false, scope: "local" });
    await openShare(page);
    await screenshot(page, testInfo, "topbar-three-local-invitations");

    for (const role of ["viewer", "commenter", "editor"]) {
      const guest = await joinViaRole(page, probe, board, role);
      const annotate = button(guest, "备注");
      const sidebar = button(guest, "备注列表");
      await expect(sidebar).toBeEnabled();
      if (role === "viewer") {
        await expect(annotate).toBeDisabled();
      } else {
        await expect(annotate).toBeEnabled();
      }

      await guest.getByText(object.label, { exact: true }).dblclick();
      const editor = guest.getByRole("textbox", { name: "编辑文字", exact: true });
      if (role === "editor") {
        const edited = "编辑者写回发布范围";
        await expect(editor).toBeVisible();
        await editor.fill(edited);
        const point = await pointAwayFromObjects(guest, studio);
        await guest.mouse.click(point.x, point.y);
        await expect.poll(async () => (await studio.readBoard(board)).objects[0].text).toBe(edited);
      } else {
        await expect(guest.getByText("只读", { exact: true })).toBeVisible();
        await expect(editor).toHaveCount(0);
      }

      if (role === "commenter") {
        await postBoardNote(guest, studio, "评论者提交复核意见");
      }

      await screenshot(guest, testInfo, "topbar-guest-" + role);
    }

    await expect(notePin(page, "评论者提交复核意见")).toBeVisible();
    await observe(testInfo, "topbar-invitation-role-access", {
      scope: "local",
      viewerCanReadOnly: true,
      commenterCanPostNote: true,
      editorCanWriteBoard: true,
    });
  } finally {
    await probe.close();
  }
});

test("[TOPBAR-SHARE-02] 所有者更改成员角色、移除访问并恢复同一浏览器", async ({
  page,
  browser,
  studio,
}, testInfo) => {
  const probe = await workbenchLinkProbe({ page, browser, studio });
  const name = roles.editor.name;
  try {
    const board = await openBoard(page, studio, "成员角色与撤销恢复");
    await openShare(page);
    const guest = await joinViaRole(page, probe, board, "editor");
    await closeShare(page);
    await openShare(page);

    await chooseMemberRole(page, studio, name, "仅查看");
    await guest.reload();
    await expect(guest.getByText(object.label, { exact: true })).toBeVisible();
    await expect(button(guest, "备注")).toBeDisabled();
    await screenshot(page, testInfo, "topbar-member-downgraded");

    await memberAction(page, studio, name).click();
    await menuItem(page, "移除访问权限").click();
    await button(page, "确认移除").click();
    const restore = button(page, "恢复访问：" + name);
    await expect(restore).toBeVisible();
    await guest.reload();
    await expect(guest.getByText(object.label, { exact: true })).toHaveCount(0);
    await expect(guest.getByText(/移除|无法访问此白板|没有分享给你/u).first()).toBeVisible();

    await restore.click();
    await menuItem(page, "恢复为可评论").click();
    await expect(memberAction(page, studio, name)).toContainText("可评论");
    await guest.reload();
    await expect(guest.getByText(object.label, { exact: true })).toBeVisible();
    await expect(button(guest, "备注")).toBeEnabled();
    await expect(guest.getByText("只读", { exact: true })).toBeVisible();
    await screenshot(guest, testInfo, "topbar-restored-commenter");
    await observe(testInfo, "topbar-member-restoration", {
      downgraded: true,
      removed: true,
      restoredAsCommenter: true,
    });
  } finally {
    await probe.close();
  }
});

test("[TOPBAR-NOTE-01] 切换备注模式，从对象创建讨论并用顶部列表定位", async ({
  page,
  studio,
}, testInfo) => {
  await openBoard(page, studio, "白板顶部备注与定位");
  const toggle = button(page, "备注");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  const text = "这段发布范围还需复核";
  await postBoardNote(page, studio, text, true);

  await openNoteList(page);
  await threadText(page, text).click();
  await expect(page.getByRole("textbox", { name: "回复批注：" + text, exact: true })).toBeVisible();
  await screenshot(page, testInfo, "topbar-note-list-open");
  if (studio.edition === "ii") {
    await button(page, "备注操作").click();
    await menuItem(page, "定位备注").click();
  }

  await expect(notePin(page, text)).toBeInViewport();
  await page.reload();
  await expect(notePin(page, text)).toBeVisible();
  await notePin(page, text).click();
  await expect(page.getByText(text, { exact: true })).toBeVisible();
  await observe(testInfo, "topbar-note-location", { pickedObject: true, persisted: true });
});

test("[TOPBAR-NOTE-02] 列表筛选作者和我发起，回复、解决及删除可持久化", async ({
  page,
  browser,
  studio,
}, testInfo) => {
  const own = "我创建的白板复核";
  const peer = "同事提出的复核";
  const reply = "核对已完成";
  const probe = await workbenchLinkProbe({ page, browser, studio });
  try {
    const board = await openBoard(page, studio, "多作者备注筛选");
    await openShare(page);
    const guest = await joinViaRole(page, probe, board, "commenter");
    await closeShare(page);
    await postBoardNote(page, studio, own);
    await postBoardNote(guest, studio, peer);
    if (studio.edition === "ii") {
      expect(await noteColor(page, own)).toBe(await noteColor(guest, own));
      expect(await noteColor(page, peer)).toBe(await noteColor(guest, peer));
    }
    await openNoteList(page);
    await expect(threadText(page, own)).toBeVisible();
    await expect(threadText(page, peer)).toBeVisible();
    await screenshot(page, testInfo, "topbar-note-author-colors");

    await button(noteList(page), "我发起").click();
    await expect(threadText(page, own)).toBeVisible();
    await expect(threadText(page, peer)).toHaveCount(0);
    await button(noteList(page), "全部").click();
    const authors = noteList(page).getByRole("combobox", { name: "作者", exact: true });
    await authors.selectOption({ label: roles.commenter.name });
    await expect(threadText(page, own)).toHaveCount(0);
    await threadText(page, peer).click();
    await noteList(page)
      .getByRole("textbox", { name: "回复批注：" + peer, exact: true })
      .fill(reply);
    await button(noteList(page), "发送回复").click();
    await expect(threadText(page, reply)).toBeVisible();
    await button(noteList(page), "解决").click();
    await expect(threadText(page, peer)).toHaveCount(0);

    await noteList(page).getByRole("checkbox", { name: "显示已解决", exact: true }).check();
    await threadText(page, peer).click();
    await expect(threadText(page, reply)).toBeVisible();
    await expect(threadText(page, "已解决")).toBeVisible();
    await screenshot(page, testInfo, "topbar-note-resolved-filter");
    await button(noteList(page), "备注操作").click();
    await menuItem(page, "删除备注线程").click();
    const deletion = noteList(page).getByRole("group", { name: "删除备注确认" });
    await button(deletion, studio.edition === "initial" ? "删除" : "确认删除").click();
    await expect(threadText(page, peer)).toHaveCount(0);

    await page.reload();
    await openNoteList(page);
    await noteList(page).getByRole("checkbox", { name: "显示已解决", exact: true }).check();
    await expect(threadText(page, own)).toBeVisible();
    await expect(threadText(page, peer)).toHaveCount(0);
    await expect(threadText(page, reply)).toHaveCount(0);
    await observe(testInfo, "topbar-note-list-lifecycle", {
      ownAndAuthorFilters: true,
      replied: true,
      resolved: true,
      deletedAcrossReload: true,
    });
  } finally {
    await probe.close();
  }
});

test("[TOPBAR-NOTE-03] 备注移出画布顶边时顶栏仍可操作", async ({ page, studio }, testInfo) => {
  await openBoard(page, studio, "备注画布边界");
  const text = "移动画布检查顶边备注";
  await postBoardNote(page, studio, text);
  const pin = notePin(page, text);
  await expect(pin).toBeInViewport();
  const pinBounds = await pin.boundingBox();
  if (!pinBounds) {
    throw new Error("The saved note has no visible marker.");
  }

  const { bounds } = await readCanvas(page, studio);
  const distance = pinBounds.y + pinBounds.height - bounds.y + 4;
  const x = bounds.x + bounds.width * 0.8;
  const lower = bounds.y + bounds.height * 0.8;
  const upper = lower - distance;
  expect(upper).toBeGreaterThan(bounds.y);
  await button(page, "平移").click();

  async function drag(start, end) {
    await page.mouse.move(x, start);
    await page.mouse.down();
    await page.mouse.move(x, end, { steps: 8 });
    await page.mouse.up();
  }

  await drag(lower, upper);
  if (studio.edition === "ii") {
    await expect(pin).toHaveCount(0);
  }
  await screenshot(page, testInfo, "note-with-anchor-above-canvas");
  await openNoteList(page);
  await expect(threadText(page, text)).toBeVisible();
  await button(page, "备注列表").click();
  await expect(noteList(page)).toBeHidden();
  await drag(upper, lower);
  await expect(pin).toBeInViewport();
  await screenshot(page, testInfo, "note-back-inside-canvas");
  await observe(testInfo, "note-viewport-edges", { listReachable: true, markerReappeared: true });
});
