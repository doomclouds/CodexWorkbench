import {
  enableCanvasClipboard,
  expect,
  observe,
  readCanvas,
  screenshot,
  test,
} from "../support/studio.mjs";

const rightMenu = /白板操作/u;
const unlock = /^解锁位置与尺寸/u;
const layerObjects = [shape("a", 120, 135), shape("b", 365, 190), shape("c", 620, 145)];

function shape(id, x, y, flags = {}) {
  return { id, kind: "shape", label: id, x, y, width: 150, height: 100, ...flags };
}

function section(id, locked = false) {
  return {
    id,
    kind: "section",
    label: "检验分区",
    x: 80,
    y: 90,
    width: 485,
    height: 330,
    locked,
    transparent: true,
  };
}

async function open(page, board) {
  await page.goto(board.url);
  await expect(page.getByRole("textbox", { name: "白板名称", exact: true })).toHaveValue(
    board.title,
  );
}

function find(scene, id) {
  const object = scene.objects.find((item) => item.id === id);
  if (!object) {
    throw new Error("Missing organization fixture object: " + id);
  }

  return object;
}

function at(box, x = 0.5, y = 0.5) {
  return { x: box.x + box.width * x, y: box.y + box.height * y };
}

async function point(page, studio, id, title = false) {
  let bounds;
  await expect
    .poll(async () => {
      const object = (await readCanvas(page, studio)).objects.find((item) => item.id === id);
      bounds = title ? object?.titleBox : object?.box;

      return Boolean(bounds);
    })
    .toBe(true);

  return title ? at(bounds, 0.2) : at(bounds);
}

function menuAction(page, name) {
  return page.getByRole("menu", { name: rightMenu }).getByRole("menuitem", { name, exact: true });
}

async function contextual(page, position, name) {
  await page.mouse.click(position.x, position.y, { button: "right" });
  const item = menuAction(page, name);
  await expect(item).toBeEnabled();
  await item.click();
}

async function history(page, action) {
  const menu = page.getByRole("menu", { name: "缩放与视图", exact: true });
  if (!(await menu.isVisible())) {
    await page.getByRole("button", { name: "缩放菜单", exact: true }).click();
  }
  await menu.getByRole("menuitem", { name: action, exact: true }).click();
  await page.keyboard.press("Escape");
}

async function drag(page, start) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  try {
    await page.mouse.move(start.x + 54, start.y + 30, { steps: 8 });
  } finally {
    await page.mouse.up();
  }
}

function positions(scene) {
  return scene.objects.map(({ id, x, y, width, height }) => ({ id, x, y, width, height }));
}

async function locks(studio, board) {
  return (await studio.readBoard(board)).objects.map(({ locked }) => locked);
}

test("[EDIT-ORG-01] 继承锁可从上级解除，选中父子后能一次解除显式双锁", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({
    title: "父子双锁",
    objects: [
      section("frame", true),
      shape("child", 210, 207, { parentId: "frame", locked: true }),
    ],
  });
  await open(page, board);
  const child = await point(page, studio, "child");
  await page.mouse.click(child.x, child.y, { button: "right" });
  const initial = studio.edition === "initial";
  if (initial) {
    await menuAction(page, unlock).click();
    await expect.poll(() => locks(studio, board)).toEqual([true, false]);
    await history(page, "撤销");
    await expect.poll(() => locks(studio, board)).toEqual([true, true]);
  } else {
    await expect(menuAction(page, /由分区锁定/u)).toBeDisabled();
    await expect(menuAction(page, "置于顶层")).toBeDisabled();
    await screenshot(page, testInfo, "inherited-lock-menu");
    await page.keyboard.press("Escape");
  }

  await contextual(page, child, "全选");
  await contextual(page, child, unlock);
  await expect.poll(() => locks(studio, board)).toEqual([false, false]);
  await history(page, "撤销");
  await expect.poll(() => locks(studio, board)).toEqual([true, true]);
  await history(page, "重做");
  await expect.poll(() => locks(studio, board)).toEqual([false, false]);
  await page.reload();
  await point(page, studio, "child");
  expect(await locks(studio, board)).toEqual([false, false]);
  await observe(testInfo, "nested-locks", {
    individualUnlock: initial,
    jointUnlock: true,
    unlockedAfterReload: true,
  });
  await screenshot(page, testInfo, "jointly-unlocked-objects");
});

async function expectSelected(page, studio, id) {
  await expect
    .poll(async () => {
      const scene = await readCanvas(page, studio);
      const target = at(find(scene, id).box);
      const selection = scene.selection && at(scene.selection);

      return selection ? Math.hypot(target.x - selection.x, target.y - selection.y) : Infinity;
    })
    .toBeLessThan(4);
}

test("[EDIT-ORG-02] 重叠中的锁定对象仍能选中和解锁，文字编辑无需解锁几何", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({
    title: "锁定位置仍能编辑",
    objects: [
      shape("below", 135, 120, { width: 300, height: 200 }),
      shape("above", 240, 190, { kind: "text", label: "原文字", width: 230, locked: true }),
    ],
  });
  await open(page, board);
  const target = await point(page, studio, "above");
  const before = positions(await studio.readBoard(board));
  for (let click = 0; click < 2; click++) {
    await page.mouse.click(target.x, target.y);
    await expectSelected(page, studio, "above");
  }
  await drag(page, target);
  expect(positions(await studio.readBoard(board))).toEqual(before);
  await page.mouse.dblclick(target.x, target.y);
  const editor = page.getByRole("textbox", { name: "编辑文字", exact: true });
  await expect(editor).toBeFocused();
  await editor.fill("带几何锁的新文字");
  await editor.press("Escape");
  await expect
    .poll(async () => find(await studio.readBoard(board), "above").text)
    .toBe("带几何锁的新文字");
  expect(await locks(studio, board)).toEqual([false, true]);
  expect(positions(await studio.readBoard(board))).toEqual(before);
  await screenshot(page, testInfo, "edited-text-on-locked-shape");

  await contextual(page, target, unlock);
  await expect.poll(() => locks(studio, board)).toEqual([false, false]);
  await observe(testInfo, "geometry-lock-content", {
    repeatedClickKeepsSelection: true,
    geometryHeld: true,
    textSavedWhileLocked: true,
    directUnlock: true,
  });
});

test("[EDIT-ORG-03] 普通点击选整组，独立右键可管理单个成员，并可在解锁后解组", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({
    title: "组合内外选择",
    objects: [
      shape("a", 120, 135, { groupId: "seed-group" }),
      shape("b", 400, 190, { groupId: "seed-group", locked: true }),
    ],
  });
  await open(page, board);
  const first = await point(page, studio, "a");
  await page.mouse.click(first.x, first.y);
  await expect
    .poll(async () => (await readCanvas(page, studio)).selection?.width ?? 0)
    .toBeGreaterThan(260);
  await drag(page, first);
  await expect.poll(async () => find(await studio.readBoard(board), "a").x).toBeGreaterThan(140);
  expect(find(await studio.readBoard(board), "b")).toMatchObject({ x: 400, y: 190, locked: true });
  await page.keyboard.press("Escape");

  const second = await point(page, studio, "b");
  await page.mouse.click(second.x, second.y, { button: "right" });
  await expectSelected(page, studio, "b");
  await menuAction(page, unlock).click();
  await expect.poll(() => locks(studio, board)).toEqual([false, false]);
  await page.keyboard.press("Escape");
  const moved = await point(page, studio, "a");
  await page.mouse.click(moved.x, moved.y);
  await contextual(page, moved, "取消组合");
  await expect
    .poll(async () =>
      (await studio.readBoard(board)).objects.some(({ groupId }) => Boolean(groupId)),
    )
    .toBe(false);
  await page.reload();
  await point(page, studio, "b");
  expect((await studio.readBoard(board)).objects.every(({ groupId }) => !groupId)).toBe(true);
  await observe(testInfo, "whole-group-member", {
    groupSelection: true,
    lockedMemberHeld: true,
    standaloneUnlock: true,
    ungroupedAfterReload: true,
  });
  await screenshot(page, testInfo, "ungrouped-objects");
});

test("[EDIT-ORG-04] 拆除分区保留子对象的位置，撤销恢复分区和关联", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({
    title: "可撤销分区拆解",
    objects: [
      section("frame"),
      shape("member", 215, 174, { parentId: "frame" }),
      shape("outside", 650, 140),
    ],
  });
  await open(page, board);
  const original = await studio.readBoard(board);
  const unchanged = positions(original).filter(({ id }) => id !== "frame");
  await contextual(page, await point(page, studio, "frame", true), /^删除(?:\s|$)/u);
  await expect.poll(async () => positions(await studio.readBoard(board))).toEqual(unchanged);
  const detached = find(await studio.readBoard(board), "member").parentId;
  if (studio.edition === "ii") {
    expect(detached).toBeUndefined();
  }
  await history(page, "撤销");
  await expect
    .poll(async () => positions(await studio.readBoard(board)))
    .toEqual(positions(original));
  expect(find(await studio.readBoard(board), "member").parentId).toBe("frame");
  await observe(testInfo, "section-dissolve", {
    childPositionHeld: true,
    parentLinkCleared: detached === undefined,
    undoRestoresParent: true,
  });
  await screenshot(page, testInfo, "section-restored");
});

const layerActions = [
  ["上移一层", "b", ["a", "c", "b"]],
  ["下移一层", "b", ["b", "a", "c"]],
  ["置于顶层", "a", ["b", "c", "a"]],
  ["置于底层", "c", ["c", "a", "b"]],
];

async function expectLayerOrder(page, peer, studio, board, order) {
  await expect
    .poll(async () => (await studio.readBoard(board)).objects.map(({ id }) => id))
    .toEqual(order);

  for (const tab of [page, peer]) {
    await expect
      .poll(async () => (await readCanvas(tab, studio)).objects.map(({ id }) => id))
      .toEqual(order);
  }
}

test("[EDIT-ORG-05] 四种层序命令均可撤销重做，并同步到另一窗口和重开的白板", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({ title: "层序撤销与同步", objects: layerObjects });
  await open(page, board);
  const peer = await page.context().newPage();
  try {
    await open(peer, board);
    const original = ["a", "b", "c"];
    await expectLayerOrder(page, peer, studio, board, original);
    for (const [name, id, order] of layerActions) {
      await page.keyboard.press("Escape");
      await contextual(page, await point(page, studio, id), name);
      await expectLayerOrder(page, peer, studio, board, order);
      await history(page, "撤销");
      await expectLayerOrder(page, peer, studio, board, original);
      await history(page, "重做");
      await expectLayerOrder(page, peer, studio, board, order);
      await history(page, "撤销");
      await expectLayerOrder(page, peer, studio, board, original);
    }

    const revision = (await studio.readBoard(board)).revision;
    await contextual(page, await point(page, studio, "c"), "置于顶层");
    const delta = studio.edition === "initial" ? 1 : 0;
    await expect.poll(async () => (await studio.readBoard(board)).revision).toBe(revision + delta);
    await expect(page.getByRole("alert").filter({ hasText: "编辑未保存" })).toHaveCount(0);
    const persisted = ["a", "c", "b"];
    await contextual(page, await point(page, studio, "b"), "置于顶层");
    await expectLayerOrder(page, peer, studio, board, persisted);

    await page.reload();
    await expectLayerOrder(page, peer, studio, board, persisted);
    await observe(testInfo, "undo-layer-order", {
      directions: layerActions.map(([name]) => name),
      acrossWindows: true,
      reopenedOrder: persisted,
      boundaryRevisionDelta: delta,
    });
    await screenshot(page, testInfo, "layer-order-reopened");
  } finally {
    await peer.close();
  }
});

async function copyLockedSelection(page, selected, testInfo, checkpoint) {
  await page.mouse.click(selected.x, selected.y, { button: "right" });
  await expect(menuAction(page, /^剪切(?:\s|$)/u)).toBeDisabled();
  await expect(menuAction(page, /^删除(?:\s|$)/u)).toBeDisabled();
  const copy = menuAction(page, /^复制(?:\s|$)/u);
  await expect(copy).toBeEnabled();
  await screenshot(page, testInfo, checkpoint);
  await copy.click();
}

async function pasteAtBlankCanvas(page, studio) {
  const { bounds } = await readCanvas(page, studio);
  await contextual(page, at(bounds, 0.78, 0.34), /^粘贴(?:\s|$)/u);
}

test("[EDIT-ORG-06] 锁定对象和半锁组合可跨板复制粘贴，原板剪切和删除保持禁用", async ({
  page,
  studio,
}, testInfo) => {
  const groupId = "copy-original-group";
  const source = await studio.seedBasicBoard({
    title: "锁定对象复制来源",
    objects: [
      shape("locked-alone", 120, 170, { locked: true }),
      shape("group-open", 390, 130, { groupId }),
      shape("group-locked", 630, 230, { groupId, locked: true }),
    ],
  });
  const [destination] = await studio.seedBoards([{ title: "锁定对象复制目标" }]);
  const clipboard = await enableCanvasClipboard(page, studio);

  await open(page, source);
  const original = await studio.readBoard(source);
  const standalone = await point(page, studio, "locked-alone");
  await copyLockedSelection(page, standalone, testInfo, "locked-copy-cut-menu");
  await open(page, destination);
  await pasteAtBlankCanvas(page, studio);
  await expect.poll(async () => (await studio.readBoard(destination)).objects.length).toBe(1);
  const [firstCopy] = (await studio.readBoard(destination)).objects;
  expect(firstCopy).toMatchObject({ label: "locked-alone", locked: true });
  expect(firstCopy.id).not.toBe("locked-alone");
  expect(await studio.readBoard(source)).toEqual(original);

  await open(page, source);
  const member = await point(page, studio, "group-open");
  await page.mouse.click(member.x, member.y);
  await copyLockedSelection(page, member, testInfo, "locked-group-copy-cut-menu");
  await open(page, destination);
  await pasteAtBlankCanvas(page, studio);
  await expect.poll(async () => (await studio.readBoard(destination)).objects.length).toBe(3);
  const pasted = await studio.readBoard(destination);
  const openMember = pasted.objects.find(({ label }) => label === "group-open");
  const lockedMember = pasted.objects.find(({ label }) => label === "group-locked");
  expect(openMember).toMatchObject({ locked: false, groupId: expect.any(String) });
  expect(lockedMember).toMatchObject({ locked: true, groupId: openMember.groupId });
  expect(openMember.groupId).not.toBe(groupId);
  expect(await studio.readBoard(source)).toEqual(original);
  await expect.poll(clipboard.reads).toBe(2);

  await page.reload();
  await point(page, studio, lockedMember.id);
  expect(await studio.readBoard(destination)).toEqual(pasted);
  await observe(testInfo, "locked-copy-paste", {
    standalone: true,
    mixedGroup: true,
    keepsLockFlags: true,
    cutAndDeleteDisabled: true,
    sourceHeld: true,
    reopened: true,
  });
  await screenshot(page, testInfo, "locked-copies-reopened");
});
