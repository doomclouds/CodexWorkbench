import { expect, observe, readCanvas, screenshot, test } from "../support/studio.mjs";

const source = {
  id: "edge-source",
  kind: "shape",
  label: "来源",
  x: 120,
  y: 120,
  width: 160,
  height: 100,
};
const target = {
  id: "edge-target",
  kind: "shape",
  label: "目标",
  x: 480,
  y: 120,
  width: 160,
  height: 100,
};
const alternate = {
  id: "edge-alternate",
  kind: "shape",
  label: "替代目标",
  x: 420,
  y: 420,
  width: 160,
  height: 100,
};
const seedConnection = {
  id: "edge-link",
  kind: "connector",
  label: "",
  x: 280,
  y: 170,
  width: 200,
  height: 1,
  start: { objectId: source.id, port: "right" },
  end: { objectId: target.id, port: "left" },
};
const mixedConnection = {
  ...seedConnection,
  label: "混选连线",
  width: 330,
  height: 115,
  end: { x: 610, y: 285 },
  bends: [365, 170, 365, 285],
};
const names = {
  initial: {
    port: "连接点 right",
    end: "连接线终点位置",
    bend: "连接线折点 1",
    rotate: /^旋转所选元素/u,
  },
  ii: {
    port: "从右端口连线",
    end: "连线终点",
    bend: "连线折点 1",
    rotate: /^旋转所选对象/u,
  },
};

function button(page, name) {
  return page.getByRole("button", { name, exact: typeof name === "string" });
}

function center(box) {
  expect(box).not.toBeNull();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function pointDelta(first, last) {
  return Math.hypot(last.x - first.x, last.y - first.y);
}

async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await page.mouse.up();
}

async function rendered(page, studio, id) {
  const canvas = await readCanvas(page, studio);
  const object = canvas.objects.find((candidate) => candidate.id === id);
  expect(object?.box).toBeTruthy();

  return object;
}

async function savedConnection(studio, board, id) {
  const { objects } = await studio.readBoard(board);
  return objects.find((object) => object.kind === "connector" && (!id || object.id === id));
}

async function openBoard(page, studio, board, id) {
  await page.goto(board.url);
  await expect(button(page, "选择")).toBeEnabled();
  if (id) {
    await expect
      .poll(async () => (await readCanvas(page, studio)).objects.some((object) => object.id === id))
      .toBe(true);
  }
}

async function useHistory(page, name) {
  const action = page.getByRole("menuitem", { name, exact: true });
  if (!(await action.isVisible())) {
    await button(page, "缩放菜单").click();
  }
  await expect(action).toBeEnabled();
  await action.click();
}

test("[WB-EDGE-01] 自由拉线后编辑折点、两端符号与标签并持久保存", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({ title: "自由连线白板", objects: [] });
  await openBoard(page, studio, board);
  const { bounds } = await readCanvas(page, studio);
  await button(page, "画笔").click();
  await button(page, "箭头模式").click();
  await drag(
    page,
    { x: bounds.x + bounds.width * 0.31, y: bounds.y + bounds.height * 0.33 },
    { x: bounds.x + bounds.width * 0.58, y: bounds.y + bounds.height * 0.56 },
  );

  await expect
    .poll(() => savedConnection(studio, board))
    .toMatchObject({
      start: { x: expect.any(Number), y: expect.any(Number) },
      end: { x: expect.any(Number), y: expect.any(Number) },
      heads: { start: "none", end: "arrow" },
    });
  const original = await savedConnection(studio, board);
  expect(original.start.objectId).toBeUndefined();
  expect(original.end.objectId).toBeUndefined();
  const bend = button(page, names[studio.edition].bend);
  await expect(bend).toBeVisible();
  await screenshot(page, testInfo, "free-line-handles");

  const from = center(await bend.boundingBox());
  await drag(page, from, { x: from.x - 44, y: from.y + 47 });
  await expect
    .poll(async () => (await savedConnection(studio, board, original.id)).bends)
    .not.toEqual(original.bends);
  const bent = await savedConnection(studio, board, original.id);
  expect(bent.bends.length).toBeGreaterThan(0);
  expect(bent.start).toEqual(original.start);
  expect(bent.end).toEqual(original.end);
  await screenshot(page, testInfo, "line-bend");

  const startHead = page.getByRole("combobox", { name: "连接线起点", exact: true });
  const endHead = page.getByRole("combobox", { name: "连接线终点", exact: true });
  await startHead.selectOption({ label: "圆点" });
  await expect
    .poll(async () => (await savedConnection(studio, board, original.id)).heads.start)
    .toBe("circle");
  await endHead.selectOption({ label: "无" });
  await expect
    .poll(async () => (await savedConnection(studio, board, original.id)).heads.end)
    .toBe("none");
  await screenshot(page, testInfo, "line-end-symbols");

  const { pathPoints } = await rendered(page, studio, original.id);
  const { x, y } = pathPoints[2];
  await page.mouse.dblclick(x, y);
  const label = page.getByRole("textbox", { name: "连接线文字" });
  await expect(label).toBeFocused();
  await page.keyboard.insertText("已核对的连线");
  await button(page, "选择").click();
  await expect
    .poll(() => savedConnection(studio, board, original.id))
    .toMatchObject({
      text: "已核对的连线",
      heads: { start: "circle", end: "none" },
      bends: bent.bends,
    });
  await page.reload();
  await expect(page.getByText("已核对的连线", { exact: true })).toBeVisible();
  await screenshot(page, testInfo, "line-label-reloaded");
  await observe(testInfo, "free-line", {
    freeEndpointsRetained: true,
    bendsEdited: true,
    start: "circle",
    end: "none",
    labelReloaded: true,
  });
});

test("[WB-EDGE-02] 端口拉线连接目标，重新绑定后可解除绑定", async ({ page, studio }, testInfo) => {
  const board = await studio.seedBasicBoard({
    title: "端口重连白板",
    objects: [source, target, alternate],
  });
  await openBoard(page, studio, board, source.id);
  const origin = center((await rendered(page, studio, source.id)).box);
  await page.mouse.click(origin.x, origin.y);
  const port = button(page, names[studio.edition].port);
  await expect(port).toBeVisible();
  const to = (await rendered(page, studio, target.id)).box;
  await drag(page, center(await port.boundingBox()), { x: to.x - 5, y: to.y + to.height / 2 });
  await expect
    .poll(() => savedConnection(studio, board))
    .toMatchObject({
      start: { objectId: source.id, port: "right" },
      end: { objectId: target.id, port: "left" },
    });
  const connection = await savedConnection(studio, board);
  await screenshot(page, testInfo, "bound-right-to-left");

  const end = button(page, names[studio.edition].end);
  await expect(end).toBeVisible();
  const next = (await rendered(page, studio, alternate.id)).box;
  const reboundX = next.x + next.width / 2;
  await drag(page, center(await end.boundingBox()), { x: reboundX, y: next.y + 4 });
  const reboundPort = studio.edition === "initial" ? "left" : undefined;
  await expect
    .poll(() => savedConnection(studio, board, connection.id))
    .toMatchObject({
      start: connection.start,
      end: { objectId: alternate.id, port: reboundPort },
    });
  await screenshot(page, testInfo, "endpoint-rebound");

  await drag(page, center(await end.boundingBox()), { x: reboundX, y: next.y - 12 });
  const explicitTop = studio.edition === "ii";
  await expect
    .poll(async () => (await savedConnection(studio, board, connection.id)).end)
    .toMatchObject(
      explicitTop
        ? { objectId: alternate.id, port: "top" }
        : { x: expect.any(Number), y: expect.any(Number) },
    );
  await screenshot(page, testInfo, "endpoint-top-port-released");

  const { bounds } = await readCanvas(page, studio);
  await drag(page, center(await end.boundingBox()), {
    x: bounds.x + bounds.width * 0.77,
    y: bounds.y + bounds.height * 0.8,
  });
  await expect
    .poll(() => savedConnection(studio, board, connection.id))
    .toMatchObject({
      start: connection.start,
      end: { x: expect.any(Number), y: expect.any(Number) },
    });
  await page.reload();
  expect((await savedConnection(studio, board, connection.id)).end.objectId).toBeUndefined();
  await expect
    .poll(async () =>
      (await readCanvas(page, studio)).objects.some(({ id }) => id === connection.id),
    )
    .toBe(true);
  await screenshot(page, testInfo, "endpoint-detached-reloaded");
  await observe(testInfo, "endpoint-bindings", {
    originalTargetPort: "left",
    reboundPort: reboundPort ?? "automatic",
    explicitTopPortAtSameOutsidePoint: explicitTop,
    releasedEndpointIsFree: true,
    preservedSourceBinding: true,
  });
});

test("[WB-EDGE-03] 点击端口快建，单次撤销和重做一起移除或还原形状与连线", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({ title: "端口快建白板", objects: [source] });
  const readCreated = async () =>
    (await studio.readBoard(board)).objects.filter(({ id }) => id !== source.id);
  await openBoard(page, studio, board, source.id);
  const origin = center((await rendered(page, studio, source.id)).box);
  await page.mouse.click(origin.x, origin.y);
  await button(page, names[studio.edition].port).click();
  await expect.poll(async () => (await studio.readBoard(board)).objects.length).toBe(3);
  const created = await readCreated();
  const addedShape = created.find(({ kind }) => kind === "shape");
  const addedConnection = created.find(({ kind }) => kind === "connector");
  expect(addedConnection).toMatchObject({
    start: { objectId: source.id, port: "right" },
    end: { objectId: addedShape.id, port: "left" },
  });
  const defaultPaint = { stroke: "rgb(239, 239, 239)", width: 3 };
  await expect
    .poll(
      async () =>
        (await readCanvas(page, studio)).objects.find(({ id }) => id === addedConnection.id)
          ?.pathPaint,
    )
    .toEqual(defaultPaint);
  await screenshot(page, testInfo, "adjacent-shape-created");

  await useHistory(page, "撤销");
  await expect
    .poll(async () => (await studio.readBoard(board)).objects.map(({ id }) => id))
    .toEqual([source.id]);
  await screenshot(page, testInfo, "adjacent-shape-undone");
  await useHistory(page, "重做");
  const savedState = ({ geometryVersion, payloadVersion, version, ...content }) => ({
    content,
    geometryVersion,
    payloadVersion,
    version,
  });
  const createdState = created.map(savedState);
  await expect
    .poll(async () => (await readCreated()).map((object) => savedState(object).content))
    .toEqual(createdState.map(({ content }) => content));
  const redone = (await readCreated()).map(savedState);
  for (const [index, restored] of redone.entries()) {
    const original = createdState[index];
    expect(restored.geometryVersion).toBeGreaterThan(original.geometryVersion);
    expect(restored.payloadVersion).toBeGreaterThan(original.payloadVersion);
    expect(restored.version).toBeGreaterThan(original.version);
  }
  await page.reload();
  await expect
    .poll(async () => (await readCanvas(page, studio)).objects.map(({ id }) => id).sort())
    .toEqual([source.id, ...created.map(({ id }) => id)].sort());
  expect((await rendered(page, studio, addedConnection.id)).pathPaint).toEqual(defaultPaint);
  await screenshot(page, testInfo, "adjacent-shape-redone-reloaded");

  await button(page, "画笔").click();
  await button(page, "墨色 蓝色").click();
  await button(page, "选择").click();
  const reopenedOrigin = center((await rendered(page, studio, source.id)).box);
  await page.mouse.click(reopenedOrigin.x, reopenedOrigin.y);
  await button(page, names[studio.edition].port).click();
  await expect.poll(async () => (await studio.readBoard(board)).objects.length).toBe(5);
  const colored = (await studio.readBoard(board)).objects.find(
    ({ kind, id }) => kind === "connector" && id !== addedConnection.id,
  );
  expect(colored.stroke.toLowerCase()).toBe("#2f7cc4");
  const bluePaint = { stroke: "rgb(156, 205, 232)", width: 3 };
  await page.reload();
  await expect
    .poll(
      async () =>
        (await readCanvas(page, studio)).objects.find(({ id }) => id === colored.id)?.pathPaint,
    )
    .toEqual(bluePaint);
  await screenshot(page, testInfo, "adjacent-shape-blue-reloaded");
  await observe(testInfo, "adjacent-shape-undo-redo", {
    singleUndoRemoved: 2,
    singleRedoRestored: 2,
    identicalIdsAndBindings: true,
    defaultPaint,
    bluePaint,
    reloaded: true,
  });
});

test("[WB-EDGE-04] 已绑定线端跟随目标移动和旋转，端点离屏时仍可选中可见线段", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({
    title: "绑定跟随白板",
    objects: [source, target, seedConnection],
  });
  await openBoard(page, studio, board, seedConnection.id);
  const first = (await rendered(page, studio, seedConnection.id)).pathPoints.at(-1);
  const origin = center((await rendered(page, studio, target.id)).box);
  await drag(page, origin, { x: origin.x + 115, y: origin.y + 78 });
  await expect
    .poll(async () => (await studio.readBoard(board)).objects.find(({ id }) => id === target.id).x)
    .toBeGreaterThan(target.x + 50);
  await expect
    .poll(async () =>
      pointDelta(first, (await rendered(page, studio, seedConnection.id)).pathPoints.at(-1)),
    )
    .toBeGreaterThan(65);
  const moved = (await rendered(page, studio, seedConnection.id)).pathPoints.at(-1);
  await screenshot(page, testInfo, "line-follows-moved-target");

  const pivot = center((await rendered(page, studio, target.id)).box);
  await page.mouse.click(pivot.x, pivot.y);
  const rotate = button(page, names[studio.edition].rotate).first();
  await expect(rotate).toBeVisible();
  const handle = center(await rotate.boundingBox());
  await drag(page, handle, {
    x: pivot.x - (handle.y - pivot.y),
    y: pivot.y + (handle.x - pivot.x),
  });
  await expect
    .poll(async () =>
      Math.abs((await studio.readBoard(board)).objects.find(({ id }) => id === target.id).rotation),
    )
    .toBeGreaterThan(45);
  await expect
    .poll(async () =>
      pointDelta(moved, (await rendered(page, studio, seedConnection.id)).pathPoints.at(-1)),
    )
    .toBeGreaterThan(35);
  expect(await savedConnection(studio, board, seedConnection.id)).toMatchObject({
    start: seedConnection.start,
    end: seedConnection.end,
  });
  await screenshot(page, testInfo, "line-follows-rotated-target");

  const canvas = await readCanvas(page, studio);
  const line = canvas.objects.find(({ id }) => id === seedConnection.id);
  const pan = {
    x: canvas.bounds.x + canvas.bounds.width * 0.81,
    y: canvas.bounds.y + canvas.bounds.height * 0.76,
  };
  await button(page, "平移").click();
  await drag(page, pan, { x: pan.x - (line.pathPoints[0].x - canvas.bounds.x + 25), y: pan.y });
  await button(page, "选择").click();
  const clipped = await rendered(page, studio, seedConnection.id);
  expect(clipped.pathPoints[0].x).toBeLessThan(canvas.bounds.x);
  const hit = clipped.pathPoints
    .slice(1, -1)
    .find(({ x }) => x > canvas.bounds.x + 70 && x < canvas.bounds.x + canvas.bounds.width - 50);
  expect(hit).toBeDefined();
  await page.mouse.click(hit.x, hit.y);
  await expect(button(page, names[studio.edition].end)).toBeVisible();
  await screenshot(page, testInfo, "visible-line-hit-with-offscreen-end");
  await observe(testInfo, "bound-line-follows-target", {
    movedTargetChangedPath: true,
    rotatedTargetChangedPath: true,
    attachmentsPreserved: true,
    selectedWithEndpointClipped: true,
  });
});

test("[WB-EDGE-05] 混选旋转保留线端绑定并转动自由端和手动折点", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({
    title: "连线混合旋转白板",
    objects: [source, mixedConnection],
  });
  await openBoard(page, studio, board, mixedConnection.id);
  const before = await savedConnection(studio, board, mixedConnection.id);
  const pathBefore = (await rendered(page, studio, mixedConnection.id)).pathPoints;
  const middle = pathBefore[2];
  await page.mouse.click(middle.x, middle.y);
  const rotate = button(page, names[studio.edition].rotate).first();
  await expect(button(page, names[studio.edition].end)).toBeVisible();
  await expect(rotate).toHaveCount(0);

  const origin = center((await rendered(page, studio, source.id)).box);
  await page.keyboard.down("Shift");
  await page.mouse.click(origin.x, origin.y);
  await page.keyboard.up("Shift");
  await expect
    .poll(async () => (await readCanvas(page, studio)).selection?.width ?? 0)
    .toBeGreaterThan(230);
  await expect(rotate).toBeVisible();
  await expect(button(page, names[studio.edition].end)).toHaveCount(0);
  await screenshot(page, testInfo, "mixed-selection-rotation-before");

  const view = await readCanvas(page, studio);
  const pivot = center(view.selection);
  const handle = center(await rotate.boundingBox());
  await drag(page, handle, {
    x: pivot.x - (handle.y - pivot.y),
    y: pivot.y + (handle.x - pivot.x),
  });
  await expect
    .poll(
      async () =>
        (await studio.readBoard(board)).objects.find(({ id }) => id === source.id).rotation,
    )
    .toBeGreaterThan(70);

  const rotated = await savedConnection(studio, board, mixedConnection.id);
  const worldPivot = {
    x: (pivot.x - view.bounds.x - view.pan.x) / view.zoom,
    y: (pivot.y - view.bounds.y - view.pan.y) / view.zoom,
  };
  const turned = (point) => ({
    x: worldPivot.x - (point.y - worldPivot.y),
    y: worldPivot.y + (point.x - worldPivot.x),
  });
  expect(rotated.start).toEqual(before.start);
  expect(rotated.heads).toEqual(before.heads);
  expect(rotated.rotation).toBe(before.rotation);
  expect(rotated.text).toBe(before.text);
  expect(pointDelta(rotated.end, turned(before.end))).toBeLessThan(3);
  expect(rotated.bends).toHaveLength(4);
  for (const index of [0, 2]) {
    expect(
      pointDelta(
        { x: rotated.bends[index], y: rotated.bends[index + 1] },
        turned({ x: before.bends[index], y: before.bends[index + 1] }),
      ),
    ).toBeLessThan(3);
  }

  const pathAfter = (await rendered(page, studio, mixedConnection.id)).pathPoints;
  expect(pointDelta(pathBefore[0], pathAfter[0])).toBeGreaterThan(75);
  await page.reload();
  await expect.poll(() => savedConnection(studio, board, mixedConnection.id)).toEqual(rotated);
  await expect
    .poll(async () =>
      (await readCanvas(page, studio)).objects.some(({ id }) => id === mixedConnection.id),
    )
    .toBe(true);
  await screenshot(page, testInfo, "mixed-selection-rotation-reloaded");
  await observe(testInfo, "connector-rotation-capability", {
    isolatedConnectorRotation: false,
    mixedSelectionRotation: true,
    attachmentAndSymbolsPreserved: true,
    freeEndpointAndBendsRotated: true,
  });
});
