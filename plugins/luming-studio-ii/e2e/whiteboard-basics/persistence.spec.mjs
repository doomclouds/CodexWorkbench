import {
  controlNextCanvasSave,
  enableCanvasClipboard,
  expect,
  observe,
  readCanvas,
  screenshot,
  test,
} from "../support/studio.mjs";

const shapeA = {
  id: "persist-a",
  kind: "shape",
  label: "保存样板 A",
  x: 100,
  y: 160,
  width: 152,
  height: 96,
};
const shapeB = { ...shapeA, id: "persist-b", label: "保存样板 B", x: 400 };
const relation = {
  id: "persist-line",
  kind: "connector",
  label: "",
  x: 252,
  y: 208,
  width: 148,
  height: 0,
  start: { objectId: shapeA.id, port: "right" },
  end: { objectId: shapeB.id, port: "left" },
};

function button(page, name) {
  return page.getByRole("button", { name, exact: true });
}

function hasObject(snapshot, id) {
  return snapshot.objects.some((object) => object.id === id);
}

function savedObject(snapshot, id) {
  const object = snapshot.objects.find((entry) => entry.id === id);
  if (!object) {
    throw new Error("The saved synthetic board does not contain " + id + ".");
  }

  return object;
}

async function openBoard(page, board) {
  await page.goto(board.url);
  await expect(page.getByRole("button", { name: "缩放菜单", exact: true })).toBeVisible();
}

async function objectPoint(page, studio, id) {
  const { objects } = await readCanvas(page, studio);
  const box = objects.find((object) => object.id === id)?.box;
  if (!box) {
    throw new Error("The synthetic object has no visible geometry.");
  }

  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function selectObject(page, studio, id, extend = false) {
  const point = await objectPoint(page, studio, id);
  if (extend) {
    await page.keyboard.down("Shift");
  }

  try {
    await page.mouse.click(point.x, point.y);
  } finally {
    if (extend) {
      await page.keyboard.up("Shift");
    }
  }
}

async function pasteObject(page, studio) {
  const { bounds } = await readCanvas(page, studio);
  await page.mouse.click(bounds.x + bounds.width * 0.55, bounds.y + bounds.height * 0.35, {
    button: "right",
  });
  await page.getByRole("menuitem", { name: /^粘贴(?:\s|$)/u }).click();
}

async function copyOrCutObject(page, studio, id, name) {
  await selectObject(page, studio, id);
  await button(page, "更多操作").click();
  await page.getByRole("menuitem", { name }).click();
}

async function dragObject(page, studio, id) {
  const point = await objectPoint(page, studio, id);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 52, point.y + 70, { steps: 8 });
  await page.mouse.up();
}

async function expectVisibleObject(page, studio, id) {
  await expect.poll(async () => hasObject(await readCanvas(page, studio), id)).toBe(true);
}

async function expectSavedObjects(studio, board, ids) {
  await expect
    .poll(async () => (await studio.readBoard(board)).objects.map((object) => object.id))
    .toEqual(ids);
}

async function expectMoved(studio, board, before) {
  await expect
    .poll(async () => savedObject(await studio.readBoard(board), before.id).x)
    .not.toBe(before.x);

  return studio.readBoard(board);
}

async function reopenAndConfirm(page, studio, board, saved) {
  await page.reload();
  await expect(button(page, "缩放菜单")).toBeVisible();
  expect(await studio.readBoard(board)).toEqual(saved);
  await studio.restart();
  await openBoard(page, board);
  expect(await studio.readBoard(board)).toEqual(saved);
  for (const { id } of saved.objects) {
    await expectVisibleObject(page, studio, id);
  }
}

function savedNotice(page) {
  return page.getByText("已保存", { exact: true }).first();
}

function retryMove(page) {
  return page.getByRole("button", { name: /^(重试原(操作|移动)|核对上次保存)$/u });
}

async function historyAction(page, name) {
  const menu = page.getByRole("menu", { name: "缩放与视图", exact: true });
  if (!(await menu.isVisible())) {
    await button(page, "缩放菜单").click();
  }
  await menu.getByRole("menuitem", { name, exact: true }).click();
}

test("[WB-SAVE-01] 经剪贴板菜单跨白板复制和剪切对象", async ({ page, studio }, testInfo) => {
  const source = await studio.seedBasicBoard({ title: "剪贴板来源", objects: [shapeA, shapeB] });
  const [destination] = await studio.seedBoards([{ title: "剪贴板目标" }]);
  const clipboard = await enableCanvasClipboard(page, studio);
  await openBoard(page, destination);
  const emptyBoard = await studio.readBoard(destination);
  await pasteObject(page, studio);
  await expect.poll(clipboard.reads).toBe(1);
  expect(await studio.readBoard(destination)).toEqual(emptyBoard);
  await screenshot(page, testInfo, "empty-clipboard-no-write");

  await openBoard(page, source);
  await expectVisibleObject(page, studio, shapeA.id);
  const original = await studio.readBoard(source);
  await copyOrCutObject(page, studio, shapeA.id, /^复制(?:\s|$)/u);
  await openBoard(page, destination);
  await pasteObject(page, studio);
  await expect
    .poll(async () => (await studio.readBoard(destination)).objects)
    .toMatchObject([{ kind: "shape", label: shapeA.label }]);
  const firstPaste = await studio.readBoard(destination);
  const copied = firstPaste.objects[0];
  expect(firstPaste.revision).toBe(emptyBoard.revision + 1);
  expect(copied.id).not.toBe(shapeA.id);
  expect(await studio.readBoard(source)).toEqual(original);
  await expectVisibleObject(page, studio, copied.id);
  await screenshot(page, testInfo, "copied-across-boards");

  await openBoard(page, source);
  await expectVisibleObject(page, studio, shapeB.id);
  await copyOrCutObject(page, studio, shapeB.id, /^剪切(?:\s|$)/u);
  await expectSavedObjects(studio, source, [shapeA.id]);

  await openBoard(page, destination);
  await pasteObject(page, studio);
  await expect
    .poll(async () => (await studio.readBoard(destination)).objects)
    .toMatchObject([
      { id: copied.id, label: shapeA.label },
      { kind: "shape", label: shapeB.label },
    ]);
  const pasted = await studio.readBoard(destination);
  expect(pasted.objects[1].id).not.toBe(shapeB.id);
  await reopenAndConfirm(page, studio, destination, pasted);
  await expectSavedObjects(studio, source, [shapeA.id]);
  await screenshot(page, testInfo, "pasted-cut-after-restart");
});

test("[WB-SAVE-02] 重复对象和连线后仅重绑副本一端，拖动后重启仍然保留", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({
    title: "重复关系",
    objects: [shapeA, shapeB, relation],
  });
  await openBoard(page, board);
  await expectVisibleObject(page, studio, relation.id);
  const initial = await studio.readBoard(board);
  await selectObject(page, studio, shapeA.id);
  await selectObject(page, studio, relation.id, true);
  await page.keyboard.press("Control+d");
  await expect.poll(async () => (await studio.readBoard(board)).objects.length).toBe(5);

  const duplicated = await studio.readBoard(board);
  const created = duplicated.objects.filter(({ id }) => !hasObject(initial, id));
  const copy = created.find(({ kind }) => kind === "shape");
  const connector = created.find(({ kind }) => kind === "connector");
  expect(copy).toMatchObject({ label: shapeA.label });
  expect(connector).toMatchObject({
    start: { objectId: copy.id, port: "right" },
    end: { objectId: shapeB.id, port: "left" },
  });
  await expectVisibleObject(page, studio, copy.id);
  await screenshot(page, testInfo, "duplicate-attached-objects");

  await dragObject(page, studio, copy.id);
  const shifted = await expectMoved(studio, board, copy);
  expect(savedObject(shifted, connector.id)).toMatchObject({
    start: connector.start,
    end: connector.end,
  });
  expect(savedObject(shifted, shapeA.id)).toEqual(savedObject(initial, shapeA.id));
  expect(savedObject(shifted, shapeB.id)).toEqual(savedObject(initial, shapeB.id));
  expect(savedObject(shifted, relation.id)).toEqual(savedObject(initial, relation.id));
  await reopenAndConfirm(page, studio, board, shifted);
  await screenshot(page, testInfo, "duplicate-relation-after-restart");
});

test("[WB-SAVE-03] 删除后撤销重做使用真实历史，重启保持最后结果", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({ title: "删除撤销重做", objects: [shapeA, shapeB] });
  const original = await studio.readBoard(board);
  await openBoard(page, board);
  await expectVisibleObject(page, studio, shapeA.id);
  await selectObject(page, studio, shapeA.id);
  await page.keyboard.press("Delete");
  await expectSavedObjects(studio, board, [shapeB.id]);

  await historyAction(page, "撤销");
  await expectSavedObjects(studio, board, [shapeA.id, shapeB.id]);
  await expectVisibleObject(page, studio, shapeA.id);
  expect((await studio.readBoard(board)).objects).toEqual(original.objects);
  await screenshot(page, testInfo, "restored-by-undo");

  await historyAction(page, "重做");
  await expectSavedObjects(studio, board, [shapeB.id]);
  const redone = await studio.readBoard(board);
  await reopenAndConfirm(page, studio, board, redone);
  expect(hasObject(await readCanvas(page, studio), shapeA.id)).toBe(false);
  await screenshot(page, testInfo, "redone-deletion-after-restart");
});

test("[WB-SAVE-04] 移动请求未送达，提示失败并核对未提交结果", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({ title: "未提交的移动", objects: [shapeA, shapeB] });
  await openBoard(page, board);
  await expectVisibleObject(page, studio, shapeA.id);
  const initial = await studio.readBoard(board);
  const fault = await controlNextCanvasSave(page, studio, {
    boardId: board.id,
    action: "move",
    mode: "before",
  });
  await dragObject(page, studio, shapeA.id);
  await fault.observed;
  const retry = retryMove(page);
  await expect(retry).toBeEnabled();
  await expect(
    page.getByText(studio.edition === "initial" ? /^保存异常$/u : /^保存结果未知/u),
  ).toBeVisible();
  const recovery = await retry.innerText();
  expect(await studio.readBoard(board)).toEqual(initial);
  await screenshot(page, testInfo, "unsubmitted-move-retry");

  await retry.click();
  if (studio.edition === "initial") {
    await expect(retry).toBeEnabled();
    expect(fault.requests()).toHaveLength(1);
    expect(await studio.readBoard(board)).toEqual(initial);
    await observe(testInfo, "unsubmitted-move-recovery", {
      recovery,
      mutationRequests: fault.requests().length,
      extraRevisions: 0,
    });
    await screenshot(page, testInfo, "unsubmitted-move-result");
    return;
  }

  const saved = await expectMoved(studio, board, savedObject(initial, shapeA.id));
  await expect(savedNotice(page)).toBeVisible();
  expect(fault.requests()).toEqual([fault.requests()[0], fault.requests()[0]]);
  expect(saved.revision).toBe(initial.revision + 1);
  await observe(testInfo, "unsubmitted-move-recovery", {
    recovery,
    mutationRequests: fault.requests().length,
    extraRevisions: saved.revision - initial.revision,
  });
  await reopenAndConfirm(page, studio, board, saved);
  await screenshot(page, testInfo, "unsubmitted-move-result");
});

test("[WB-SAVE-05] 已提交后丢回执，恢复确认并持久化一次移动", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({ title: "移动回执丢失", objects: [shapeA, shapeB] });
  await openBoard(page, board);
  await expectVisibleObject(page, studio, shapeA.id);
  const initial = await studio.readBoard(board);
  const fault = await controlNextCanvasSave(page, studio, {
    boardId: board.id,
    action: "move",
    mode: "after",
  });
  await dragObject(page, studio, shapeA.id);
  await fault.finished;
  await fault.observed;
  const committed = await expectMoved(studio, board, savedObject(initial, shapeA.id));
  const retry = retryMove(page);
  await expect(savedNotice(page).or(retry)).toBeVisible();
  let recovery = "自动核对回执";
  if (await retry.isVisible()) {
    recovery = await retry.innerText();
    await retry.click();
  }

  await expect(savedNotice(page)).toBeVisible();
  expect(committed.revision).toBe(initial.revision + 1);
  expect([...new Set(fault.requests())]).toHaveLength(1);
  await observe(testInfo, "lost-move-receipt-recovery", {
    recovery,
    mutationRequests: fault.requests().length,
    extraRevisions: committed.revision - initial.revision,
  });
  await reopenAndConfirm(page, studio, board, committed);
  await screenshot(page, testInfo, "lost-receipt-once-after-restart");
});

test("[WB-SAVE-06] 保存中切换选区与菜单，迟到成功回执保留新选区", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({ title: "迟到回执与选区", objects: [shapeA, shapeB] });
  await openBoard(page, board);
  await expectVisibleObject(page, studio, shapeA.id);
  const fault = await controlNextCanvasSave(page, studio, {
    boardId: board.id,
    action: "duplicate",
    mode: "hold",
  });

  try {
    await selectObject(page, studio, shapeA.id);
    await page.keyboard.press("Control+d");
    await fault.observed;
    await expect(page.getByText(/^保存中…?$/u).first()).toBeVisible();

    await selectObject(page, studio, shapeB.id);
    await button(page, "更多操作").click();
    const menu = page.getByRole("menu").filter({
      has: page.getByRole("menuitem", { name: /^删除/u }),
    });
    await expect(menu).toBeVisible();
    const selected = (await readCanvas(page, studio)).selection;
    expect(selected).toBeTruthy();
    await screenshot(page, testInfo, "newer-selection-during-save");

    fault.release();
    await fault.finished;
    await expect(savedNotice(page)).toBeVisible();
    const saved = await studio.readBoard(board);
    expect(saved.objects).toHaveLength(3);
    const copy = saved.objects.find(({ id }) => id !== shapeA.id && id !== shapeB.id);
    await expectVisibleObject(page, studio, copy.id);
    const confirmedSelection = (await readCanvas(page, studio)).selection;
    const selectionRetained = JSON.stringify(confirmedSelection) === JSON.stringify(selected);
    const menuRetained = await menu.isVisible();
    const shouldRetain = studio.edition === "ii";
    expect(selectionRetained).toBe(shouldRetain);
    expect(menuRetained).toBe(shouldRetain);
    await observe(testInfo, "late-duplicate-selection", { selectionRetained, menuRetained });
    await screenshot(page, testInfo, "newer-selection-after-save");

    if (!shouldRetain) {
      await selectObject(page, studio, shapeB.id);
      await button(page, "更多操作").click();
    }

    await menu.getByRole("menuitem", { name: /^删除/u }).click();
    await expectSavedObjects(studio, board, [shapeA.id, copy.id]);
  } finally {
    fault.release();
  }
});

test("[WB-SAVE-08] 首笔微调回执未到时连续按键，确认后按顺序逐笔保存", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({ title: "连续方向键微调", objects: [shapeA, shapeB] });
  await openBoard(page, board);
  await expectVisibleObject(page, studio, shapeA.id);
  await selectObject(page, studio, shapeA.id);
  const before = await studio.readBoard(board);
  const fault = await controlNextCanvasSave(page, studio, {
    boardId: board.id,
    action: "move",
    mode: "hold",
  });

  try {
    await page.keyboard.press("ArrowRight");
    await fault.observed;
    await expect(page.getByText(/^保存中…?$/u).first()).toBeVisible();
    await page.keyboard.press("Shift+ArrowDown");
    expect(savedObject(await studio.readBoard(board), shapeA.id)).toMatchObject({
      x: shapeA.x + 1,
      y: shapeA.y,
    });
    expect(fault.requests()).toHaveLength(1);
    await screenshot(page, testInfo, "rapid-nudges-awaiting-first-receipt");
  } finally {
    fault.release();
  }

  await fault.finished;
  await expect.poll(() => fault.requests().length).toBe(2);
  await expect
    .poll(async () => savedObject(await studio.readBoard(board), shapeA.id))
    .toMatchObject({ x: shapeA.x + 1, y: shapeA.y + 10 });
  await expect(savedNotice(page)).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => fault.requests().length).toBe(3);
  await expect
    .poll(async () => savedObject(await studio.readBoard(board), shapeA.id))
    .toMatchObject({ x: shapeA.x, y: shapeA.y + 10 });
  await expect(savedNotice(page)).toBeVisible();
  const saved = await studio.readBoard(board);
  expect(saved.revision).toBe(before.revision + 3);
  expect(savedObject(saved, shapeB.id)).toEqual(savedObject(before, shapeB.id));
  await historyAction(page, "撤销");
  await expect
    .poll(async () => savedObject(await studio.readBoard(board), shapeA.id))
    .toMatchObject({ x: shapeA.x + 1, y: shapeA.y + 10 });
  await expect(savedNotice(page)).toBeVisible();
  await historyAction(page, "重做");
  await expect
    .poll(async () => savedObject(await studio.readBoard(board), shapeA.id))
    .toMatchObject({ x: shapeA.x, y: shapeA.y + 10 });
  await expect(savedNotice(page)).toBeVisible();
  await reopenAndConfirm(page, studio, board, await studio.readBoard(board));
  await screenshot(page, testInfo, "rapid-nudges-saved-after-restart");
  await observe(testInfo, "rapid-nudge-receipts", {
    moves: fault.requests().length,
    position: { x: shapeA.x, y: shapeA.y + 10 },
  });
});

test("[WB-SAVE-07] 首次放置期间改选，迟到回执保留当前对象与画布焦点", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({ title: "首次放置与改选", objects: [shapeA, shapeB] });
  await openBoard(page, board);
  await expectVisibleObject(page, studio, shapeB.id);
  const fault = await controlNextCanvasSave(page, studio, {
    boardId: board.id,
    action: "create",
    mode: "hold",
  });

  try {
    await button(page, "便签").click();
    const { bounds } = await readCanvas(page, studio);
    await page.mouse.click(bounds.x + bounds.width * 0.68, bounds.y + bounds.height * 0.52);
    await fault.observed;
    await expect(page.getByText(/^保存中…?$/u).first()).toBeVisible();

    await selectObject(page, studio, shapeB.id);
    const { selection, focused } = await readCanvas(page, studio);
    expect(selection).toBeTruthy();
    expect(focused).toBe(true);
    await screenshot(page, testInfo, "selection-during-first-placement");

    fault.release();
    await fault.finished;
    await expect(savedNotice(page)).toBeVisible();
    const confirmed = (await studio.readBoard(board)).objects.find(({ kind }) => kind === "note");
    expect(confirmed).toBeDefined();
    await expectVisibleObject(page, studio, confirmed.id);
    expect(await readCanvas(page, studio)).toMatchObject({ selection, focused });
    await screenshot(page, testInfo, "selection-after-first-placement");

    await page.keyboard.press("Delete");
    await expectSavedObjects(studio, board, [shapeA.id, confirmed.id]);
  } finally {
    fault.release();
  }
});
