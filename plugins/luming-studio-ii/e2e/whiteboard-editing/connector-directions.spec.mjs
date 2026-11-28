import { expect, observe, readCanvas, screenshot, test } from "../support/studio.mjs";

const normals = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};

function shape(id, label, x, y) {
  return { id, kind: "shape", label, x, y, width: 140, height: 86 };
}

function connector(id, label, startId, startPort, endId, endPort, bends) {
  return {
    id,
    kind: "connector",
    label,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    start: { objectId: startId, port: startPort },
    end: { objectId: endId, port: endPort },
    heads: { start: "none", end: "arrow" },
    bends,
  };
}

function find(canvas, id) {
  const object = canvas.objects.find((candidate) => candidate.id === id);
  expect(object).toBeDefined();
  return object;
}

function alignment(vector, normal) {
  return (
    (vector.x * normal.x + vector.y * normal.y) /
    (Math.hypot(vector.x, vector.y) * Math.hypot(normal.x, normal.y))
  );
}

function turn(point, rotation) {
  const radians = (rotation * Math.PI) / 180;
  return {
    x: point.x * Math.cos(radians) - point.y * Math.sin(radians),
    y: point.x * Math.sin(radians) + point.y * Math.cos(radians),
  };
}

function tangentState(canvas, connection, startRotation = 0, endRotation = 0) {
  const { start, end, arrow } = find(canvas, connection.id).pathTangents;
  const from = turn(normals[connection.start.port], startRotation);
  const to = turn(normals[connection.end.port], endRotation);
  return {
    start: alignment(start, from),
    end: -alignment(end, to),
    arrow: arrow && alignment(arrow, end),
  };
}

function expectDirection(result) {
  expect(result.start).toBeGreaterThan(0.98);
  expect(result.end).toBeGreaterThan(0.98);
  if (result.arrow !== undefined) {
    expect(result.arrow).toBeGreaterThan(0.98);
  }
}

function direction(value) {
  if (value >= 0.98) {
    return "对齐";
  }
  if (value <= -0.98) {
    return "反向";
  }

  return Math.abs(value) <= 0.02 ? "垂直" : "斜向";
}

function observedDirections({ start, end, arrow }) {
  return {
    start: direction(start),
    end: direction(end),
    arrow: arrow === undefined ? null : direction(arrow),
  };
}

function button(page, name) {
  return page.getByRole("button", { name, exact: typeof name === "string" });
}

function center(box) {
  expect(box).toBeTruthy();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await page.mouse.up();
}

async function open(page, studio, board, id) {
  await page.goto(board.url);
  await expect(button(page, "选择")).toBeEnabled();
  await expect
    .poll(async () => (await readCanvas(page, studio)).objects.some((object) => object.id === id))
    .toBe(true);

  return readCanvas(page, studio);
}

test("[EDIT-LINE-01] 自动连线按四边端口出入，反向对象也能获得正确箭头切线", async ({
  page,
  studio,
}, testInfo) => {
  const reverse = connector("reverse", "右侧端口", "left-a", "right", "right-a", "right");
  const perpendicular = connector("perpendicular", "右 → 上", "left-b", "right", "right-b", "top");
  const backwards = connector("backwards", "反向右 → 左", "right-c", "right", "left-c", "left");
  const upward = connector("upward", "底 → 顶", "top-b", "bottom", "bottom-b", "top");
  const board = await studio.seedBasicBoard({
    title: "四边连线方向",
    objects: [
      shape("left-a", "来源 A", 70, 75),
      shape("right-a", "右侧目标 A", 400, 75),
      shape("left-b", "来源 B", 70, 280),
      shape("right-b", "上侧目标 B", 430, 325),
      shape("left-c", "左侧目标 C", 70, 520),
      shape("right-c", "来源 C", 400, 520),
      shape("top-b", "上端对象", 700, 100),
      shape("bottom-b", "下端对象", 700, 310),
      reverse,
      perpendicular,
      backwards,
      upward,
    ],
  });
  const view = await open(page, studio, board, reverse.id);
  const rays = {
    reverse: tangentState(view, reverse),
    perpendicular: tangentState(view, perpendicular),
    backwards: tangentState(view, backwards),
    upward: tangentState(view, upward),
  };
  expectDirection(rays.upward);
  if (studio.edition === "initial") {
    expect(rays.reverse.end).toBeLessThan(-0.98);
    expect(Math.abs(rays.perpendicular.end)).toBeLessThan(0.02);
    expect(rays.backwards.start).toBeLessThan(-0.98);
    expect(rays.backwards.end).toBeLessThan(-0.98);
  } else {
    expect(rays.reverse.arrow).toBeDefined();
    expect(rays.perpendicular.arrow).toBeDefined();
    expect(rays.backwards.arrow).toBeDefined();
    expectDirection(rays.reverse);
    expectDirection(rays.perpendicular);
    expectDirection(rays.backwards);
  }

  await screenshot(page, testInfo, "four-side-automatic-routes");
  await observe(
    testInfo,
    "automatic-port-tangents",
    Object.fromEntries(
      Object.entries(rays).map(([id, result]) => [id, observedDirections(result)]),
    ),
  );
});

test("[EDIT-LINE-02] 移动、旋转或重连对象后按当前端口方向重算路径", async ({
  page,
  studio,
}, testInfo) => {
  const first = shape("move-a", "来源", 380, 190);
  const second = shape("move-b", "可移动目标", 640, 190);
  const third = shape("move-c", "重连目标", 950, 340);
  const edge = connector("move-edge", "", first.id, "right", second.id, "left");
  const board = await studio.seedBasicBoard({
    title: "移动旋转和重连",
    objects: [first, second, third, edge],
  });
  const before = await open(page, studio, board, edge.id);
  expectDirection(tangentState(before, edge));
  await screenshot(page, testInfo, "line-facing-before-move");

  const at = center(find(before, second.id).box);
  await drag(page, at, { x: at.x - 400, y: at.y + 135 });
  await expect
    .poll(async () => (await studio.readBoard(board)).objects.find(({ id }) => id === second.id).x)
    .toBeLessThan(first.x);
  const moved = await readCanvas(page, studio);
  const movedRays = tangentState(moved, edge);
  if (studio.edition === "ii") {
    expectDirection(movedRays);
  }
  await screenshot(page, testInfo, "line-follows-moved-opposite-side");

  const pivot = center(find(moved, second.id).box);
  await page.mouse.click(pivot.x, pivot.y - 24);
  const rotate = button(page, /^旋转所选(?:元素|对象)/u).first();
  await expect(rotate).toBeVisible();
  const handle = center(await rotate.boundingBox());
  const angle = turn({ x: handle.x - pivot.x, y: handle.y - pivot.y }, 42);
  await drag(page, handle, { x: pivot.x + angle.x, y: pivot.y + angle.y });
  const read = async (id) =>
    (await studio.readBoard(board)).objects.find((object) => object.id === id);
  await expect.poll(async () => (await read(second.id)).rotation).toBeGreaterThan(32);
  const rotated = await readCanvas(page, studio);
  const rotation = (await read(second.id)).rotation;
  const rotatedRays = tangentState(rotated, edge, 0, rotation);
  expect(await read(edge.id)).toMatchObject({ start: edge.start, end: edge.end });
  if (studio.edition === "ii") {
    expectDirection(rotatedRays);
  }
  await screenshot(page, testInfo, "line-follows-rotated-port");

  const pick = find(rotated, edge.id).pathPoints[2];
  await page.mouse.click(pick.x, pick.y);
  const endpoint = button(page, studio.edition === "initial" ? "连接线终点位置" : "连线终点");
  await expect(endpoint).toBeVisible();
  const destination = find(rotated, third.id).box;
  const inside = studio.edition === "initial";
  const top = { x: destination.x + destination.width / 2, y: destination.y + (inside ? 4 : -12) };
  await drag(page, center(await endpoint.boundingBox()), top);
  const rebound = { ...edge, end: { objectId: third.id, port: inside ? "left" : "top" } };
  await expect.poll(() => read(edge.id)).toMatchObject({ start: edge.start, end: rebound.end });
  const reboundRays = tangentState(await readCanvas(page, studio), rebound);
  if (studio.edition === "ii") {
    expectDirection(reboundRays);
  }
  await screenshot(page, testInfo, "line-after-reconnecting");
  await observe(testInfo, "move-rotate-reconnect-tangents", {
    movedRays: observedDirections(movedRays),
    rotatedRays: observedDirections(rotatedRays),
    reboundRays: observedDirections(reboundRays),
    reboundPort: rebound.end.port,
    rotation: Math.round(rotation),
  });
});

test("[EDIT-LINE-03] 重叠邻接和显式折点保留真实箭头方向及原始数据", async ({
  page,
  studio,
}, testInfo) => {
  const tightA = shape("tight-a", "邻接来源", 80, 90);
  const tightB = shape("tight-b", "重叠目标", 205, 135);
  const fixedA = shape("fixed-a", "手调来源", 80, 400);
  const fixedB = shape("fixed-b", "手调目标", 500, 460);
  const adjacent = connector("tight-edge", "", tightA.id, "right", tightB.id, "top");
  const manual = connector(
    "fixed-edge",
    "手调折线",
    fixedA.id,
    "right",
    fixedB.id,
    "top",
    [300, 443, 300, 340, 570, 340],
  );
  const board = await studio.seedBasicBoard({
    title: "重叠端口与手动折线",
    objects: [tightA, tightB, fixedA, fixedB, adjacent, manual],
  });
  const view = await open(page, studio, board, manual.id);
  const tight = tangentState(view, adjacent);
  const fixed = tangentState(view, manual);
  expectDirection(fixed);
  if (studio.edition === "ii") {
    expectDirection(tight);
  }
  const before = find(view, manual.id).pathPoints;
  await screenshot(page, testInfo, "nearby-ports-and-manual-bends");
  await page.reload();
  await expect
    .poll(async () => (await studio.readBoard(board)).objects.find(({ id }) => id === manual.id))
    .toMatchObject({
      start: manual.start,
      end: manual.end,
      bends: manual.bends,
      heads: manual.heads,
    });
  await expect
    .poll(
      async () =>
        (await readCanvas(page, studio)).objects.find(({ id }) => id === manual.id)?.pathPoints,
    )
    .toEqual(before);
  await screenshot(page, testInfo, "reloaded-manual-bends");
  await observe(testInfo, "overlap-and-manual-tangents", {
    tight: observedDirections(tight),
    fixed: observedDirections(fixed),
    retainedExplicitBends: true,
  });
});
