import {
  expect,
  mediaDisplaySize,
  mediaPlaying,
  observe,
  observeGuestAccessReads,
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

async function joinViaRole(page, probe, board, role, onGuest) {
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
  onGuest?.(guest);
  await guest.getByRole("textbox", { name: /你的名字/u }).fill(name);
  await button(guest, "打开白板").click();
  await expect(guest.getByText(object.label, { exact: true })).toBeVisible();

  return guest;
}

async function pointAwayFromObjects(page, studio) {
  const { bounds } = await readCanvas(page, studio);

  return { x: bounds.x + 55, y: bounds.y + 145 };
}

async function openNoteMode(page) {
  const toggle = button(page, "备注");
  if ((await toggle.getAttribute("aria-pressed")) !== "true") {
    await toggle.click();
  }

  await expect(toggle).toHaveAttribute("aria-pressed", "true");
}

async function saveBoardNote(page, text) {
  await expect(noteEditor(page)).toBeFocused();
  await noteEditor(page).fill(text);
  await button(page, "保存备注").click();
  await expect(noteEditor(page)).toHaveCount(0);
}

async function postBoardNote(page, studio, text, objectTarget = false) {
  await openNoteMode(page);
  if (objectTarget) {
    await page.getByText(object.label, { exact: true }).click();
  } else {
    const point = await pointAwayFromObjects(page, studio);
    await page.mouse.click(point.x, point.y);
  }

  await saveBoardNote(page, text);
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
    let guestReads;
    const guest = await joinViaRole(page, probe, board, "editor", (view) => {
      if (studio.edition === "ii") {
        guestReads = observeGuestAccessReads(view, studio);
      }
    });
    await closeShare(page);
    await openShare(page);

    if (guestReads) {
      await expect.poll(guestReads.snapshot).toEqual({ sharing: 2, scene: 1 });
    }
    const initialReads = guestReads?.snapshot();
    const onlineIdle = await guestReads?.idle();
    if (onlineIdle) {
      expect(onlineIdle).toEqual({ sharing: 0, scene: 0 });
    }

    await chooseMemberRole(page, studio, name, "仅查看");
    if (!guestReads) {
      await guest.reload();
    }
    await expect(guest.getByText(object.label, { exact: true })).toBeVisible();
    await expect(button(guest, "备注")).toBeDisabled();
    const downgradedReads = guestReads?.snapshot();
    if (downgradedReads) {
      expect(downgradedReads).toEqual({ sharing: 3, scene: 1 });
    }
    await screenshot(page, testInfo, "topbar-member-downgraded");

    if (guestReads) {
      await chooseMemberRole(page, studio, name, "可编辑");
      await expect(button(guest, "备注")).toBeEnabled();
      await expect(guest.getByText("只读", { exact: true })).toBeHidden();
      expect(guestReads.snapshot()).toEqual({ sharing: 4, scene: 1 });
    }

    await memberAction(page, studio, name).click();
    await menuItem(page, "移除访问权限").click();
    await button(page, "确认移除").click();
    const restore = button(page, "恢复访问：" + name);
    await expect(restore).toBeVisible();
    if (!guestReads) {
      await guest.reload();
    }
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
      initialReads,
      onlineIdle,
      downgradedReads,
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
    await postBoardNote(guest, studio, peer, true);
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

async function selectNoteZoom(page, percentage) {
  const zoom = button(page, "缩放菜单");
  await zoom.click();
  await menuItem(page.getByRole("menu", { name: "缩放与视图", exact: true }), percentage).click();
  await expect(zoom).toHaveText(percentage);
}

async function postNoteNearEdge(page, studio, shape, fromLeft, down, text) {
  await openNoteMode(page);
  const { objects } = await readCanvas(page, studio);
  const { box } = objects.find(({ id }) => id === shape.id);
  await page.mouse.click(box.x + fromLeft, box.y + down);
  await saveBoardNote(page, text);
}

test("[TOPBAR-NOTE-08] 重叠的同对象与邻近对象备注聚合，选中后只回复对应讨论", async ({
  page,
  browser,
  studio,
}, testInfo) => {
  const first = "负责人核对发布范围";
  const second = "来宾核对同一对象";
  const nearby = "邻近对象的独立备注";
  const reply = "只回复来宾的讨论";
  const neighbor = {
    ...object,
    id: "nearby-shape",
    x: object.x + object.width + 1,
    label: "邻近对象",
  };
  const probe = await workbenchLinkProbe({ page, browser, studio });
  try {
    const board = await studio.seedBasicBoard({
      title: "白板备注聚合",
      objects: [object, neighbor],
    });
    await page.goto(board.url);
    await expect(page.getByText(object.label, { exact: true })).toBeVisible();
    await selectNoteZoom(page, "100%");
    await openShare(page);
    const guest = await joinViaRole(page, probe, board, "commenter");
    await closeShare(page);
    await selectNoteZoom(guest, "100%");

    await postNoteNearEdge(page, studio, object, object.width - 32, 50, first);
    await page.keyboard.press("Escape");
    await postNoteNearEdge(guest, studio, object, object.width - 11, 53, second);
    await guest.keyboard.press("Escape");
    await expect(button(page, "2 条备注")).toBeVisible();
    await postNoteNearEdge(page, studio, neighbor, 10, 56, nearby);
    await page.keyboard.press("Escape");

    const cluster = button(page, "3 条备注");
    await expect(cluster).toBeVisible();
    await expect(notePin(page, first)).toHaveCount(0);
    await screenshot(page, testInfo, "note-cluster-collapsed");
    await cluster.click();
    const chooser = page.getByRole("dialog", { name: "3 条备注", exact: true });
    await expect(chooser.getByText(first, { exact: true })).toBeVisible();
    await expect(chooser.getByText(roles.commenter.name, { exact: true })).toBeVisible();
    await expect(chooser.getByText(nearby, { exact: true })).toBeVisible();
    await screenshot(page, testInfo, "note-cluster-authors-and-summaries");
    await chooser.getByText(second, { exact: true }).click();
    const composer = page.getByRole("textbox", { name: "回复批注：" + second, exact: true });
    await expect(composer).toBeVisible();
    await expect(cluster).toBeHidden();
    await expect(notePin(page, second)).toBeVisible();
    await composer.fill(reply);
    await button(page, "发送回复").click();
    await expect(page.getByText(reply, { exact: true })).toBeVisible();
    await screenshot(page, testInfo, "note-cluster-selected-thread");
    await button(page, "关闭备注").click();
    await expect(cluster).toBeVisible();

    await selectNoteZoom(page, "200%");
    await expect(cluster).toHaveCount(0);
    await expect(notePin(page, first)).toBeVisible();
    await expect(notePin(page, second)).toBeVisible();
    await expect(notePin(page, nearby)).toBeVisible();
    await screenshot(page, testInfo, "note-cluster-separated-by-zoom");

    await openNoteList(page);
    await threadText(page, first).click();
    await expect(threadText(page, reply)).toHaveCount(0);
    await threadText(page, second).click();
    await expect(threadText(page, reply)).toBeVisible();
    await observe(testInfo, "note-cluster-separate-discussions", {
      groupedCount: 3,
      separatedByZoom: true,
      selectedOnly: true,
      replyOwnedByTargetThread: true,
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

const noteDocumentTitle = "发布纪要卡片";
const noteDocumentHeading = "发布步骤标题";
const noteParagraph = "核对提交状态再通知同事。";
const tableHeading = "排期";
const tableCell = "回归上线";
const noteTodoTitle = "待办复核";
const noteTodoItem = "检查发布状态";
const nativeTargets = [
  {
    id: "note-doc",
    kind: "document",
    label: noteDocumentTitle,
    x: 90,
    y: 85,
    width: 415,
    height: 260,
    document: {
      schemaVersion: 1,
      blocks: [
        { id: "heading", type: "heading", props: { level: 2 }, content: noteDocumentHeading },
        { id: "paragraph", type: "paragraph", content: noteParagraph },
      ],
    },
  },
  {
    id: "note-table",
    kind: "table",
    label: "排期表格",
    x: 575,
    y: 85,
    width: 385,
    height: 260,
    rows: [
      [tableHeading, "状态"],
      [tableCell, "待验收"],
    ],
    rowIds: ["heading", "row"],
    columnIds: ["schedule", "status"],
    columnWidths: [192, 193],
    head: true,
  },
  {
    id: "note-todo",
    kind: "todo",
    label: noteTodoTitle,
    x: 90,
    y: 415,
    width: 280,
    height: 160,
    items: [{ id: "release-check", text: noteTodoItem }],
  },
  {
    id: "note-html",
    kind: "html",
    label: "说明嵌入卡片",
    x: 420,
    y: 420,
    width: 265,
    height: 155,
    html:
      '<p data-studio-id="delivery" style="margin:0;height:64px">交付说明</p>' +
      '<p style="margin:0;height:78px">补充说明</p>',
  },
  {
    ...object,
    id: "note-shape",
    label: "发布节点",
    x: 750,
    y: 430,
    width: 210,
    height: 110,
  },
];

async function openNativeNotes(page, studio) {
  const board = await studio.seedBasicBoard({
    title: "原生对象备注命中",
    objects: nativeTargets,
  });
  await page.goto(board.url);
  await expect(page.getByText(noteParagraph, { exact: true })).toBeVisible();
  await expect(page.getByText(tableCell, { exact: true })).toBeVisible();

  return board;
}

async function ensurePointNotes(page) {
  const active = page.getByRole("button", { name: "备注", exact: true, pressed: true });
  if (!(await active.count())) {
    await page.getByRole("button", { name: "备注", exact: true, pressed: false }).click();
  }

  await expect(active).toBeVisible();
}

async function clickNativeNotePoint(page, studio, id, u, v) {
  const { objects } = await readCanvas(page, studio);
  const bounds = objects.find((element) => element.id === id)?.box;
  if (!bounds) {
    throw new Error("Expected a visible native object: " + id);
  }

  await page.mouse.click(bounds.x + bounds.width * u, bounds.y + bounds.height * v);
}

function noteDraft(page) {
  return page.getByRole("dialog", { name: "新建备注", exact: true });
}

async function checkNoteDraft(page, target) {
  const draft = noteDraft(page);
  await expect(noteEditor(page)).toBeFocused();
  await expect(draft).toContainText(target);
}

async function closeNoteDraft(page) {
  await noteEditor(page).press("Escape");
  await expect(noteEditor(page)).toHaveCount(0);
}

test("[TOPBAR-NOTE-04] 文档优先精确引用，标题和留白可回退到对象备注", async ({
  page,
  studio,
}, testInfo) => {
  const board = await openNativeNotes(page, studio);
  const before = await studio.readBoard(board);
  const documentTitle = page.getByLabel("文档标题", { exact: true });
  await documentTitle.click();
  await button(page, "编辑文档").click();
  const writer = page.getByRole("textbox", { name: "", exact: true });
  await expect(writer).toBeVisible();
  await button(page, "阅读文档").click();
  await expect(writer).toHaveCount(0);

  for (const excerpt of [noteDocumentHeading, noteParagraph]) {
    await ensurePointNotes(page);
    await page.getByText(excerpt, { exact: true }).click();
    await checkNoteDraft(page, excerpt);
    if (studio.edition === "ii") {
      await expect(noteDraft(page)).toContainText("文档段落 · " + noteDocumentTitle);
    }
    await screenshot(
      page,
      testInfo,
      excerpt === noteParagraph ? "note-document-paragraph" : "note-document-heading",
    );
    await closeNoteDraft(page);
  }

  if (studio.edition === "ii") {
    const active = page.getByRole("button", { name: "备注", exact: true, pressed: true });
    if (await active.count()) {
      await active.click();
    }
    await button(page, "返回画板").click();
    await expect(page.getByText(tableCell, { exact: true })).toBeVisible();
    await ensurePointNotes(page);
    const header = page.getByText(noteDocumentTitle, { exact: true });
    await expect(header).toBeVisible();
    await header.click();
    await checkNoteDraft(page, "文档 · " + noteDocumentTitle);
    await expect(noteDraft(page)).not.toContainText(noteParagraph);
    await closeNoteDraft(page);

    await ensurePointNotes(page);
    await clickNativeNotePoint(page, studio, "note-doc", 0.56, 0.84);
    await checkNoteDraft(page, "文档 · " + noteDocumentTitle);
    await expect(noteDraft(page)).not.toContainText(noteParagraph);
    await screenshot(page, testInfo, "note-document-whitespace");
    await closeNoteDraft(page);
  }

  expect((await studio.readBoard(board)).objects).toEqual(before.objects);
  await observe(testInfo, "note-document-targets", {
    editingExited: true,
    headingAndParagraph: true,
    objectFallback: studio.edition === "ii",
  });
});

test("[TOPBAR-NOTE-05] 表头、单元格和边缘在选中前后都能添加表格备注", async ({
  page,
  studio,
}, testInfo) => {
  const board = await openNativeNotes(page, studio);
  const before = await studio.readBoard(board);
  const tableLabel = studio.edition === "ii" ? "表格 · 排期表格" : "表格";

  await ensurePointNotes(page);
  await page.getByText(tableHeading, { exact: true }).click();
  await checkNoteDraft(page, tableLabel);
  await closeNoteDraft(page);

  const active = page.getByRole("button", { name: "备注", exact: true, pressed: true });
  if (await active.count()) {
    await active.click();
  }
  await page.getByText(tableCell, { exact: true }).click();
  await expect.poll(async () => (await readCanvas(page, studio)).selection).not.toBeNull();
  await ensurePointNotes(page);
  await page.getByText(tableCell, { exact: true }).click();
  await checkNoteDraft(page, tableLabel);
  await screenshot(page, testInfo, "note-table-selected-cell");
  await closeNoteDraft(page);

  await ensurePointNotes(page);
  await clickNativeNotePoint(page, studio, "note-table", 0.985, 0.52);
  await checkNoteDraft(page, tableLabel);
  await screenshot(page, testInfo, "note-table-edge");
  if (studio.edition === "ii") {
    const message = "待发送的表格备注";
    await noteEditor(page).fill(message);
    await clickNativeNotePoint(page, studio, "note-doc", 0.56, 0.84);
    await expect(noteEditor(page)).toHaveValue(message);
    await expect(noteDraft(page)).toContainText(tableLabel);
    await expect(noteDraft(page)).toContainText("已有未发送的备注草稿");
    await button(noteDraft(page), "取消").click();
    await expect(noteEditor(page)).toHaveCount(0);
  } else {
    await closeNoteDraft(page);
  }
  expect((await studio.readBoard(board)).objects).toEqual(before.objects);
  await observe(testInfo, "note-table-targets", {
    headerUnselected: true,
    cellSelected: true,
    edge: true,
    retainedDraft: studio.edition === "ii",
    objectsUnchanged: true,
  });
});

test("[TOPBAR-NOTE-06] 待办正文仍精确，待办标题和其他白板对象仍可添加备注", async ({
  page,
  studio,
}, testInfo) => {
  await openNativeNotes(page, studio);
  const todoLabel = studio.edition === "ii" ? "任务清单 · " + noteTodoTitle : noteTodoTitle;
  await ensurePointNotes(page);
  await page.getByText(noteTodoItem, { exact: true }).click();
  await checkNoteDraft(page, noteTodoItem);
  if (studio.edition === "ii") {
    await expect(noteDraft(page)).toContainText("待办事项 · " + noteTodoTitle);
  }
  await closeNoteDraft(page);

  for (const [label, target] of [
    [noteTodoTitle, todoLabel],
    ["发布节点", "发布节点"],
  ]) {
    await ensurePointNotes(page);
    await page.getByText(label, { exact: true }).click();
    await checkNoteDraft(page, target);
    await closeNoteDraft(page);
  }

  await ensurePointNotes(page);
  await clickNativeNotePoint(page, studio, "note-todo", 0.65, 0.83);
  await checkNoteDraft(page, todoLabel);
  await closeNoteDraft(page);

  await ensurePointNotes(page);
  await clickNativeNotePoint(page, studio, "note-html", 0.31, 0.19);
  await checkNoteDraft(page, "交付说明");
  if (studio.edition === "ii") {
    await expect(noteDraft(page)).toContainText("HTML 内部选区 · 说明嵌入卡片");
  }
  await screenshot(page, testInfo, "note-embedded-content");
  await closeNoteDraft(page);

  await page.reload();
  await expect(page.getByText("发布节点", { exact: true })).toBeVisible();
  await ensurePointNotes(page);
  await clickNativeNotePoint(page, studio, "note-html", 0.52, 0.75);
  await checkNoteDraft(page, studio.edition === "ii" ? "网页嵌入 · 说明嵌入卡片" : "补充说明");
  await closeNoteDraft(page);
  await observe(testInfo, "note-native-targets", { todo: true, embed: true, shape: true });
});

test("[TOPBAR-NOTE-07] 图片与链接正文可备注，视频退出备注后恢复原生播放", async ({
  page,
  studio,
}, testInfo) => {
  const initial = studio.edition === "initial";
  const board = await studio.seedBasicBoard({
    title: "媒体对象备注命中",
    objects: [
      {
        ...object,
        id: "note-image",
        kind: "image",
        label: "评审样图",
        x: 110,
        mediaFixture: "board-svg",
      },
      {
        ...object,
        id: "note-video",
        kind: "video",
        label: "播放样例",
        x: 435,
        width: 290,
        height: 190,
        mediaFixture: "blue-frame",
      },
      {
        ...object,
        id: "note-link",
        kind: "link",
        label: "参考说明",
        x: 815,
        href: "https://example.test/board-reference",
      },
    ],
  });
  await page.goto(board.url);
  const canvas = page.getByLabel(initial ? "白板画布" : board.title, { exact: true });
  const nativeVideo = { naturalWidth: 16, naturalHeight: 16, controls: true };
  await expect.poll(() => mediaDisplaySize(canvas)).toMatchObject(nativeVideo);

  await ensurePointNotes(page);
  await clickNativeNotePoint(page, studio, "note-image", 0.5, 0.44);
  await checkNoteDraft(page, initial ? "图片" : "图片 · 评审样图");
  await closeNoteDraft(page);

  await ensurePointNotes(page);
  await page.getByText("参考说明", { exact: true }).click();
  await checkNoteDraft(page, initial ? "参考说明" : "链接 · 参考说明");
  await closeNoteDraft(page);

  await ensurePointNotes(page);
  if (initial) {
    await clickNativeNotePoint(page, studio, "note-video", 0.055, 0.92);
    await expect(noteEditor(page)).toHaveCount(0);
    await page.reload();
  } else {
    await expect
      .poll(() => mediaDisplaySize(canvas))
      .toMatchObject({
        ...nativeVideo,
        controls: false,
      });
    await clickNativeNotePoint(page, studio, "note-video", 0.5, 0.44);
    await checkNoteDraft(page, "视频 · 播放样例");
    await screenshot(page, testInfo, "note-video-surface");
    await closeNoteDraft(page);

    await ensurePointNotes(page);
    await clickNativeNotePoint(page, studio, "note-video", 0.055, 0.92);
    await checkNoteDraft(page, "视频 · 播放样例");
    await closeNoteDraft(page);
    await page.getByRole("button", { name: "备注", exact: true, pressed: true }).click();
  }

  await expect.poll(() => mediaDisplaySize(canvas)).toMatchObject(nativeVideo);
  await clickNativeNotePoint(page, studio, "note-video", 0.5, 0.5);
  await expect.poll(() => mediaPlaying(canvas)).toBe(true);
  await expect(noteEditor(page)).toHaveCount(0);
  await observe(testInfo, "media-note-targets", {
    image: true,
    link: true,
    videoControlsAreaPoint: !initial,
    nativePlayback: true,
  });
});
