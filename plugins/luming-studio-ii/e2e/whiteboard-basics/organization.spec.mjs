import {
  expect,
  observe,
  readCanvas,
  screenshot,
  test,
  workbenchLinkProbe,
} from "../support/studio.mjs";

test.use({ trace: "off", screenshot: "off", video: "off" });

function shape(id, x, y, width = 140, height = 90) {
  return { id, kind: "shape", label: id, x, y, width, height, fill: "#cbd5e1", stroke: "#334155" };
}

const looseShapes = [
  shape("shape-a", 125, 110),
  shape("shape-b", 360, 215, 170, 115),
  shape("shape-c", 610, 145, 150, 105),
];
const lockAction = /^(?:解锁|锁定)位置与尺寸(?:\s|$)/u;
const actions = (page) => page.getByRole("menu", { name: "白板操作", exact: true });
const button = (page, name) => page.getByRole("button", { name, exact: true });

function objectFor(board, id) {
  const object = board.objects.find((candidate) => candidate.id === id);
  if (!object) {
    throw new Error("The synthetic object is missing: " + id);
  }

  return object;
}

function geometry(object) {
  return { x: object.x, y: object.y, width: object.width, height: object.height };
}

function center(box, horizontal = 0.5, vertical = 0.5) {
  return { x: box.x + box.width * horizontal, y: box.y + box.height * vertical };
}

async function visibleBox(page, studio, id, area = "box") {
  let bounds;
  await expect
    .poll(async () => {
      bounds = (await readCanvas(page, studio)).objects.find((entry) => entry.id === id)?.[area];
      return Boolean(bounds);
    })
    .toBe(true);

  return bounds;
}

async function selectPoint(page, point, extend = false) {
  if (!extend) {
    await page.mouse.click(point.x, point.y);
    return;
  }

  await page.keyboard.down("Shift");
  try {
    await page.mouse.click(point.x, point.y);
  } finally {
    await page.keyboard.up("Shift");
  }
}

async function selectObjects(page, studio, ids) {
  for (const [index, id] of ids.entries()) {
    const point = center(await visibleBox(page, studio, id));
    await selectPoint(page, point, index > 0);
  }
}

async function contextAction(page, point, name) {
  await page.mouse.click(point.x, point.y, { button: "right" });
  const action = actions(page).getByRole("menuitem", { name, exact: true });
  await expect(action).toBeEnabled();
  await action.click();
}

async function drag(page, from, delta = { x: 47, y: 29 }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  try {
    await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps: 8 });
  } finally {
    await page.mouse.up();
  }
}

async function currentOrder(studio, board) {
  return (await studio.readBoard(board)).objects.map(({ id }) => id);
}

async function expectRenderedLayerOrder(page, studio, order) {
  const overlapIds = new Set(["a", "b", "c"]);
  await expect
    .poll(async () =>
      (await readCanvas(page, studio)).objects
        .map(({ id }) => id)
        .filter((id) => overlapIds.has(id)),
    )
    .toEqual(order.filter((id) => overlapIds.has(id)));
}

async function sectionTitlePoint(page, studio, id) {
  const bounds = await visibleBox(page, studio, id, "titleBox");

  return center(bounds, 0.2);
}

async function expectTopHit(page, studio, point, id) {
  await selectPoint(page, point);
  await expect
    .poll(async () => {
      const scene = await readCanvas(page, studio);
      const expected = center(objectFor(scene, id).box);
      const selected = scene.selection && center(scene.selection);
      return selected ? Math.hypot(expected.x - selected.x, expected.y - selected.y) : Infinity;
    })
    .toBeLessThan(4);
}

test("[WB-ORG-01] 在重叠画布上逐层和置顶置底，命中结果与保存顺序一致", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({
    title: "层序与命中",
    objects: [
      {
        id: "frame",
        kind: "section",
        label: "透明分区",
        x: 62,
        y: 60,
        width: 620,
        height: 375,
        transparent: true,
      },
      shape("a", 100, 100, 230, 160),
      shape("b", 150, 130, 230, 160),
      shape("c", 220, 166, 230, 160),
      {
        id: "wire",
        kind: "connector",
        label: "",
        x: 120,
        y: 400,
        width: 435,
        height: 10,
        start: { x: 120, y: 405 },
        end: { x: 555, y: 405 },
      },
      { ...shape("wireframe", 550, 300, 105, 95), fill: "transparent" },
    ],
  });
  await page.goto(board.url);
  const rect = await visibleBox(page, studio, "a");
  const own = center(rect, 0.12, 0.68);
  const overlap = center(rect, 0.72, 0.72);

  await expectTopHit(page, studio, overlap, "c");
  for (const [command, order, top] of [
    ["上移一层", ["frame", "b", "a", "c", "wire", "wireframe"], "c"],
    ["置于顶层", ["frame", "b", "c", "wire", "wireframe", "a"], "a"],
    ["下移一层", ["frame", "b", "c", "wire", "a", "wireframe"], "a"],
    ["置于底层", ["a", "frame", "b", "c", "wire", "wireframe"], "c"],
  ]) {
    await page.keyboard.press("Escape");
    await contextAction(page, own, command);
    await expect.poll(() => currentOrder(studio, board)).toEqual(order);
    await expectRenderedLayerOrder(page, studio, order);
    await expectTopHit(page, studio, overlap, top);
  }

  await page.keyboard.press("Escape");
  await contextAction(page, center(await visibleBox(page, studio, "wire")), "下移一层");
  await expect
    .poll(() => currentOrder(studio, board))
    .toEqual(["a", "frame", "b", "wire", "c", "wireframe"]);
  await page.keyboard.press("Escape");
  const wireframe = await visibleBox(page, studio, "wireframe");
  await contextAction(page, center(wireframe, 0.5, 0.02), "下移一层");
  await expect
    .poll(() => currentOrder(studio, board))
    .toEqual(["a", "frame", "b", "wire", "wireframe", "c"]);
  await page.keyboard.press("Escape");
  await contextAction(page, await sectionTitlePoint(page, studio, "frame"), "置于顶层");
  await expect
    .poll(() => currentOrder(studio, board))
    .toEqual(["a", "b", "wire", "wireframe", "c", "frame"]);
  await page.reload();
  const reopened = await visibleBox(page, studio, "a");
  await expectTopHit(page, studio, center(reopened, 0.72, 0.72), "c");
  await observe(testInfo, "saved-order", {
    layerOrder: await currentOrder(studio, board),
    overlapTop: "c",
  });
  await screenshot(page, testInfo, "layers-reopened");
});

function positionDelta(before, after, id) {
  const left = objectFor(before, id);
  const right = objectFor(after, id);

  return { x: right.x - left.x, y: right.y - left.y };
}

function expectSameDelta(one, two) {
  expect(one.x).toBeCloseTo(two.x, 4);
  expect(one.y).toBeCloseTo(two.y, 4);
}

async function settledMove(studio, board, before, id) {
  await expect
    .poll(async () => Math.abs(positionDelta(before, await studio.readBoard(board), id).x))
    .toBeGreaterThan(10);

  return studio.readBoard(board);
}

test("[WB-ORG-02] 组合后拖动整组，取消组合后只移动被拖动对象", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({ title: "组合与拆分", objects: looseShapes });
  await page.goto(board.url);
  await selectObjects(page, studio, ["shape-a", "shape-b"]);
  const pointOfA = async () => center(await visibleBox(page, studio, "shape-a"));
  await contextAction(page, await pointOfA(), "组合");
  await expect
    .poll(async () => Boolean(objectFor(await studio.readBoard(board), "shape-a").groupId))
    .toBe(true);
  const grouped = await studio.readBoard(board);
  expect(objectFor(grouped, "shape-b").groupId).toBe(objectFor(grouped, "shape-a").groupId);
  expect(objectFor(grouped, "shape-c").groupId).toBeUndefined();
  await page.reload();
  await drag(page, await pointOfA());
  const moved = await settledMove(studio, board, grouped, "shape-a");
  expectSameDelta(
    positionDelta(grouped, moved, "shape-a"),
    positionDelta(grouped, moved, "shape-b"),
  );

  await contextAction(page, await pointOfA(), "取消组合");
  await expect
    .poll(async () =>
      (await studio.readBoard(board)).objects.some(({ groupId }) => Boolean(groupId)),
    )
    .toBe(false);
  const ungrouped = await studio.readBoard(board);
  await page.reload();
  await drag(page, await pointOfA());
  const later = await settledMove(studio, board, ungrouped, "shape-a");
  expectSameDelta(positionDelta(ungrouped, later, "shape-b"), { x: 0, y: 0 });
  await observe(testInfo, "grouped-and-ungrouped", { groupedMove: true, independentMove: true });
  await screenshot(page, testInfo, "group-movement");
});

function sectionOf(board) {
  return board.objects.find(({ kind }) => kind === "section");
}

test("[WB-ORG-03] 从选区建立分区，改名并拖动标题保留内部对象相对位置", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({ title: "分区与成员", objects: looseShapes });
  await page.goto(board.url);
  await selectObjects(page, studio, ["shape-a", "shape-b"]);
  await contextAction(page, center(await visibleBox(page, studio, "shape-a")), "从选区创建分区");
  await expect.poll(async () => Boolean(sectionOf(await studio.readBoard(board)))).toBe(true);
  const created = await studio.readBoard(board);
  const section = sectionOf(created);
  expect(section.transparent).toBe(true);
  expect(created.objects.findIndex(({ id }) => id === section.id)).toBeLessThan(
    created.objects.findIndex(({ id }) => id === "shape-a"),
  );
  const titlePoint = () => sectionTitlePoint(page, studio, section.id);
  await page.keyboard.press("Escape");
  await contextAction(page, await titlePoint(), /^重命名分区(?:\s|$)/u);
  const titleEntry = page.getByRole("textbox", { name: "编辑文字", exact: true });
  await titleEntry.fill("已经确认的分区");
  await titleEntry.press("Enter");
  await expect
    .poll(async () => sectionOf(await studio.readBoard(board)).label)
    .toBe("已经确认的分区");
  const renamed = await studio.readBoard(board);
  await page.keyboard.press("Escape");
  await drag(page, await titlePoint(), { x: 62, y: 42 });
  const moved = await settledMove(studio, board, renamed, section.id);
  const delta = positionDelta(renamed, moved, section.id);
  for (const id of ["shape-a", "shape-b"]) {
    expectSameDelta(positionDelta(renamed, moved, id), delta);
  }
  expectSameDelta(positionDelta(renamed, moved, "shape-c"), { x: 0, y: 0 });
  await page.reload();
  await expect(page.getByText("已经确认的分区", { exact: true }).first()).toBeVisible();
  expect((await studio.readBoard(board)).objects).toEqual(moved.objects);
  await observe(testInfo, "section-ownership", {
    followsSection: true,
    persistedParentLinks: moved.objects
      .filter(({ parentId }) => parentId === section.id)
      .map(({ id }) => id),
  });
  await screenshot(page, testInfo, "section-reopened");
});

function lockState(board) {
  return board.objects.map(({ locked }) => locked);
}

test("[WB-ORG-04] 混合锁定统一为锁定，解锁后仍可拖动对象", async ({ page, studio }, testInfo) => {
  const [first, second] = looseShapes;
  const board = await studio.seedBasicBoard({
    title: "混合锁定",
    objects: [{ ...first, locked: true }, second],
  });
  await page.goto(board.url);
  await selectObjects(page, studio, ["shape-a", "shape-b"]);
  const pointOfB = async () => center(await visibleBox(page, studio, "shape-b"));
  await contextAction(page, await pointOfB(), lockAction);
  await expect.poll(async () => lockState(await studio.readBoard(board))).toEqual([true, true]);
  const locked = await studio.readBoard(board);
  await page.reload();
  await drag(page, await pointOfB());
  expect((await studio.readBoard(board)).objects).toEqual(locked.objects);

  await selectObjects(page, studio, ["shape-a", "shape-b"]);
  await contextAction(page, await pointOfB(), lockAction);
  await expect.poll(async () => lockState(await studio.readBoard(board))).toEqual([false, false]);
  const unlocked = await studio.readBoard(board);
  await page.reload();
  await drag(page, await pointOfB());
  await settledMove(studio, board, unlocked, "shape-b");
  await observe(testInfo, "position-lock", {
    mixedLocksAll: true,
    dragRespectsLock: true,
    unlockRestoresMovement: true,
  });
  await screenshot(page, testInfo, "objects-unlocked");
});

test("[WB-ORG-05] 锁定分区后单独拖动内部对象并核对保存位置", async ({ page, studio }, testInfo) => {
  const board = await studio.seedBasicBoard({
    title: "分区锁定继承",
    objects: [
      {
        id: "locked-section",
        kind: "section",
        label: "锁定的分区",
        x: 100,
        y: 100,
        width: 540,
        height: 350,
        locked: true,
        transparent: true,
      },
      { ...shape("child", 180, 215), parentId: "locked-section" },
    ],
  });
  await page.goto(board.url);
  const before = await studio.readBoard(board);
  const from = center(await visibleBox(page, studio, "child"));
  await drag(page, from);
  const after =
    studio.edition === "initial"
      ? await settledMove(studio, board, before, "child")
      : await studio.readBoard(board);
  const member = positionDelta(before, after, "child");
  expectSameDelta(positionDelta(before, after, "locked-section"), { x: 0, y: 0 });
  if (studio.edition === "ii") {
    expectSameDelta(member, { x: 0, y: 0 });
  }
  await page.reload();
  await visibleBox(page, studio, "child");
  expect((await studio.readBoard(board)).objects).toEqual(after.objects);
  await observe(testInfo, "locked-parent", {
    parentHeld: true,
    childHeld: member.x === 0 && member.y === 0,
  });
  await screenshot(page, testInfo, "locked-section");
});

const axes = [
  { label: "左对齐", coordinate: "x", size: "width", fraction: 0 },
  { label: "水平居中", coordinate: "x", size: "width", fraction: 0.5 },
  { label: "右对齐", coordinate: "x", size: "width", fraction: 1 },
  { label: "顶部对齐", coordinate: "y", size: "height", fraction: 0 },
  { label: "垂直居中", coordinate: "y", size: "height", fraction: 0.5 },
  { label: "底部对齐", coordinate: "y", size: "height", fraction: 1 },
];

function alignmentTarget(objects, { coordinate, size, fraction }) {
  const start = Math.min(...objects.map((object) => object[coordinate]));
  const end = Math.max(...objects.map((object) => object[coordinate] + object[size]));

  return start + (end - start) * fraction;
}

function alignedGeometry(objects, option) {
  const { coordinate, size, fraction } = option;
  const target = alignmentTarget(objects, option);

  return objects.map((object) => ({
    ...geometry(object),
    [coordinate]: target - object[size] * fraction,
  }));
}

test("[WB-ORG-06] 对齐对象在六个方向保存准确的边与中心", async ({ page, studio }, testInfo) => {
  const aligned = [];
  for (const option of axes) {
    const board = await studio.seedBasicBoard({ title: option.label, objects: looseShapes });
    await page.goto(board.url);
    await selectObjects(
      page,
      studio,
      looseShapes.map(({ id }) => id),
    );
    const before = (await studio.readBoard(board)).objects;
    await button(page, "对齐对象").click();
    await button(page, option.label).click();
    const expected = alignedGeometry(before, option);
    await expect
      .poll(async () => (await studio.readBoard(board)).objects.map(geometry))
      .toEqual(expected);
    await page.reload();
    await visibleBox(page, studio, "shape-a");
    expect((await studio.readBoard(board)).objects.map(geometry)).toEqual(expected);
    aligned.push(option.label);
  }
  await observe(testInfo, "all-alignment-directions", { aligned });
  await screenshot(page, testInfo, "alignment-reopened");
});

test("[WB-ORG-07] 整理选区按网格排布，重开保留对象间距", async ({ page, studio }, testInfo) => {
  const board = await studio.seedBasicBoard({ title: "整理白板", objects: looseShapes });
  await page.goto(board.url);
  await selectObjects(
    page,
    studio,
    looseShapes.map(({ id }) => id),
  );
  await contextAction(page, center(await visibleBox(page, studio, "shape-a")), "整理");
  const positions = [
    [140, 110],
    [125, 249],
    [329, 110],
  ];
  await expect
    .poll(async () => (await studio.readBoard(board)).objects.map(({ x, y }) => [x, y]))
    .toEqual(positions);
  await page.reload();
  await visibleBox(page, studio, "shape-a");
  expect((await studio.readBoard(board)).objects.map(({ x, y }) => [x, y])).toEqual(positions);
  await observe(testInfo, "tidy-grid", { positions, gap: 24 });
  await screenshot(page, testInfo, "tidy-reopened");
});

test("[WB-ORG-08] 只读访客可选对象，但组合、层序和锁定不能更改白板", async ({
  page,
  browser,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({ title: "只读白板组织", objects: looseShapes });
  const probe = await workbenchLinkProbe({ page, browser, studio });
  try {
    await page.goto(studio.url);
    await button(page, "打开白板：" + board.title).hover();
    await button(page, "管理作品：" + board.title).click();
    await page.getByRole("menuitem", { name: "复制链接", exact: true }).click();
    await expect(page.getByText("链接已复制。", { exact: true })).toBeVisible();
    const guest = await probe.openGuest(board);
    await guest.getByRole("textbox", { name: /你的名字/u }).fill("只读检查者");
    await button(guest, "打开白板").click();
    await expect(guest.getByText("只读", { exact: true })).toBeVisible();
    const before = await studio.readBoard(board);
    await selectObjects(guest, studio, ["shape-a", "shape-b"]);
    const target = center(await visibleBox(guest, studio, "shape-a"));
    await guest.mouse.click(target.x, target.y, { button: "right" });
    for (const name of ["组合", "置于顶层", lockAction]) {
      await expect(actions(guest).getByRole("menuitem", { name, exact: true })).toBeDisabled();
    }
    await screenshot(guest, testInfo, "viewer-organization-menu");
    await guest.keyboard.press("Escape");
    await drag(guest, target);
    expect(await studio.readBoard(board)).toEqual(before);
    await observe(testInfo, "guest-organization-readonly", {
      cannotGroup: true,
      cannotReorder: true,
      cannotLock: true,
      boardPreserved: true,
    });
  } finally {
    await probe.close();
  }
});
