import {
  embedFrame,
  expect,
  observe,
  readCanvas,
  screenshot,
  test,
  workbenchLinkProbe,
} from "../support/studio.mjs";

const html = {
  id: "edge-embed",
  kind: "html",
  label: "贴边交互图解",
  x: 80,
  y: 100,
  width: 360,
  height: 280,
  html: '<style>html,body{margin:0;padding:0} main{height:1200px} input{margin:0;width:24px;height:24px;display:block} footer{margin-top:950px}</style><main><input type="checkbox" aria-label="贴边开关"><p>框内滚动测试</p><footer>图解滚动尾部</footer></main>',
};
const nativeFrames = [
  { id: "mixed-document", label: "移动文档", content: "文档段落 1" },
  { id: "mixed-todo", label: "移动任务清单", content: "待办任务 1" },
];

function button(page, label) {
  return page.getByRole("button", { name: label, exact: true });
}

function center(box) {
  if (!box) {
    throw new Error("Expected a visible object control.");
  }

  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function objectView(page, studio, id) {
  const { objects } = await readCanvas(page, studio);
  const object = objects.find((entry) => entry.id === id);
  if (!object?.box) {
    throw new Error("Expected a visible rich object: " + id);
  }

  return object;
}

async function openBoard(page, studio, fixture) {
  const board = await studio.seedBasicBoard(fixture);
  await page.goto(board.url);
  await expect(button(page, "缩放菜单")).toBeVisible();
  return board;
}

async function openHtml(page, studio, options = {}) {
  return openBoard(page, studio, {
    title: "富对象手势验收",
    objects: [{ ...html, ...options }],
  });
}

async function select(page, studio, id) {
  const point = center((await objectView(page, studio, id)).box);
  await page.mouse.click(point.x, point.y);
}

async function drag(page, point, offset, buttonName = "left") {
  await page.mouse.move(point.x, point.y);
  await page.mouse.down({ button: buttonName });
  try {
    await page.mouse.move(point.x + offset.x, point.y + offset.y, { steps: 5 });
  } finally {
    await page.mouse.up({ button: buttonName });
  }
}

async function geometry(studio, board, id) {
  const { objects } = await studio.readBoard(board);
  const object = objects.find((entry) => entry.id === id);
  if (!object) {
    throw new Error("Expected a persisted rich object: " + id);
  }

  const { x, y, width, height } = object;

  return { x, y, width, height };
}

async function expectMoved(page, studio, board, id, expected) {
  await expect.poll(async () => (await geometry(studio, board, id)).x).toBeCloseTo(expected.x, 0);
  await expect.poll(async () => (await geometry(studio, board, id)).y).toBeCloseTo(expected.y, 0);
  await expect(page.getByText("已保存", { exact: true }).first()).toBeVisible();
}

async function wheelZoom(page, point, delta) {
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down("Control");
  try {
    await page.mouse.wheel(0, delta);
  } finally {
    await page.keyboard.up("Control");
  }
}

async function useZoom(page, studio, target) {
  let { zoom } = await readCanvas(page, studio);
  while (Math.abs(zoom - target) > 0.002) {
    const { bounds } = await readCanvas(page, studio);
    const point = { x: bounds.x + 58, y: bounds.y + bounds.height / 2 };
    const wheelDelta = Math.log(zoom / target) / 0.0015;
    const step = Math.sign(wheelDelta) * Math.min(Math.abs(wheelDelta), 120);
    await wheelZoom(page, point, step);
    const expected = Math.max(0.05, zoom * Math.exp(-step * 0.0015));
    await expect.poll(async () => (await readCanvas(page, studio)).zoom).toBeCloseTo(expected, 3);
    ({ zoom } = await readCanvas(page, studio));
  }

  return zoom;
}

function legacyGrip(view) {
  return view.titleBox ? center(view.titleBox) : { x: center(view.box).x, y: view.box.y + 1 };
}

async function visibleGrip(page) {
  const handle = button(page, "移动 HTML 图解");
  await expect(handle).toBeVisible();
  return handle.boundingBox();
}

function inside(view, x = 0.4, y = 0.5) {
  return { x: view.box.x + x * view.box.width, y: view.box.y + y * view.box.height };
}

function compareCamera(canvas) {
  return { pan: canvas.pan, zoom: canvas.zoom };
}

async function expectPan(page, studio, prior, delta) {
  await expect
    .poll(async () => (await readCanvas(page, studio)).pan.x)
    .toBeCloseTo(prior.pan.x + delta.x, 0);
  await expect
    .poll(async () => (await readCanvas(page, studio)).pan.y)
    .toBeCloseTo(prior.pan.y + delta.y, 0);
}

test("[EDIT-MOVE-01] HTML 可见手柄跨四档缩放且按画布坐标移动", async ({
  page,
  studio,
}, testInfo) => {
  const board = await openHtml(page, studio);
  await select(page, studio, html.id);
  const observed = [];

  for (const [index, percent] of [5, 25, 60, 100].entries()) {
    const zoom = await useZoom(page, studio, percent / 100);
    const initial = await geometry(studio, board, html.id);
    const displayed = await objectView(page, studio, html.id);
    const handle = studio.edition === "ii" ? await visibleGrip(page) : null;
    const grab = handle ? center(handle) : legacyGrip(displayed);
    if (handle) {
      expect(handle.width).toBeCloseTo(24, 0);
      expect(handle.height).toBeCloseTo(24, 0);
      expect(handle.y + handle.height).toBeLessThanOrEqual(displayed.box.y);
    }
    const direction = index % 2 === 0 ? 1 : -1;
    const move = { x: direction * 200, y: direction * 100 };
    await screenshot(page, testInfo, "html-drag-at-" + percent);
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    try {
      expect((await objectView(page, studio, html.id)).box).toEqual(displayed.box);
      await page.mouse.move(grab.x + move.x * zoom, grab.y + move.y * zoom, { steps: 5 });
    } finally {
      await page.mouse.up();
    }
    await expectMoved(page, studio, board, html.id, {
      x: initial.x + move.x,
      y: initial.y + move.y,
    });
    observed.push({
      percent,
      visibleGrip: Boolean(handle),
      gripCssWidth: handle ? Math.round(handle.width) : null,
      objectCssWidth: Math.round(displayed.box.width),
      moved: move,
    });
  }

  await observe(testInfo, "html-grip-at-four-zoom-levels", observed);
});

test("[EDIT-MOVE-02] HTML 首行可点击，普通滚动留在正文，缩放和平移归画布", async ({
  page,
  studio,
}, testInfo) => {
  const board = await openHtml(page, studio);
  await select(page, studio, html.id);
  const frame = embedFrame(page, html.label);
  const checkbox = frame.getByRole("checkbox", { name: "贴边开关" });
  await expect(checkbox).toBeVisible();
  const edge = await checkbox.boundingBox();
  const initial = await geometry(studio, board, html.id);
  await page.mouse.click(center(edge).x, edge.y + 2);
  const topChecked = await checkbox.isChecked();
  if (studio.edition === "initial") {
    expect(topChecked).toBe(false);
    await page.mouse.click(center(edge).x, edge.y + 14);
  } else {
    expect(topChecked).toBe(true);
  }
  await expect(checkbox).toBeChecked();
  await screenshot(page, testInfo, "html-first-edge-control");

  const tail = frame.getByText("图解滚动尾部", { exact: true });
  const tailY = (await tail.boundingBox()).y;
  const camera = compareCamera(await readCanvas(page, studio));
  const body = inside(await objectView(page, studio, html.id));
  await page.mouse.move(body.x, body.y);
  await page.mouse.wheel(0, 330);
  await expect.poll(async () => (await tail.boundingBox()).y).toBeLessThan(tailY - 100);
  expect(compareCamera(await readCanvas(page, studio))).toEqual(camera);
  await wheelZoom(page, body, -60);
  await expect.poll(async () => (await readCanvas(page, studio)).zoom).toBeGreaterThan(camera.zoom);
  await exerciseHtmlPan(page, studio);
  expect(await geometry(studio, board, html.id)).toEqual(initial);
  await observe(testInfo, "html-body-input-ownership", {
    topChecked,
    wheelStayedInFrame: true,
    gesturePan: true,
  });
  await screenshot(page, testInfo, "html-content-after-canvas-gestures");
});

async function exerciseHtmlPan(page, studio) {
  const body = inside(await objectView(page, studio, html.id));
  const before = compareCamera(await readCanvas(page, studio));
  const middle = { x: 35, y: 18 };
  await drag(page, body, middle, "middle");
  await expectPan(page, studio, before, middle);
  const fresh = inside(await objectView(page, studio, html.id));
  await page.mouse.click(fresh.x, fresh.y);
  const afterMiddle = compareCamera(await readCanvas(page, studio));
  const space = { x: -24, y: 13 };
  await page.keyboard.down("Space");
  try {
    await drag(page, fresh, space);
  } finally {
    await page.keyboard.up("Space");
  }
  await expectPan(page, studio, afterMiddle, space);
}

test("[EDIT-MOVE-03] 文档和待办通过标题把手移动且不改变正文", async ({
  page,
  studio,
}, testInfo) => {
  const board = await openBoard(page, studio, "mixed");
  const before = await studio.readBoard(board);
  const results = [];
  for (const { id, label } of nativeFrames) {
    const handle = button(page, label);
    await expect(handle).toBeEnabled();
    const point = center(await handle.boundingBox());
    const current = await geometry(studio, board, id);
    const { zoom } = await readCanvas(page, studio);
    const shift = { x: 26, y: 32 };
    await drag(page, point, { x: shift.x * zoom, y: shift.y * zoom });
    await expectMoved(page, studio, board, id, { x: current.x + shift.x, y: current.y + shift.y });
    const updated = (await studio.readBoard(board)).objects.find((object) => object.id === id);
    const previous = before.objects.find((object) => object.id === id);
    expect(updated.document).toEqual(previous.document);
    expect(updated.items).toEqual(previous.items);
    expect(updated.label).toBe(previous.label);
    expect(updated).toMatchObject({ width: previous.width, height: previous.height });
    results.push({ id, shift });
  }

  await confirmLockedTodo(page, studio, board);
  await observe(testInfo, "native-title-gesture", {
    movement: results,
    lockedTodoContentEditable: true,
  });
  await screenshot(page, testInfo, "native-title-gestures");
});

async function confirmLockedTodo(page, studio, board) {
  const id = "mixed-todo";
  const position = await geometry(studio, board, id);
  await button(page, "锁定元素").click();
  const savedTodo = async () =>
    (await studio.readBoard(board)).objects.find((object) => object.id === id);
  await expect.poll(async () => (await savedTodo()).locked).toBe(true);
  await expect(button(page, "移动任务清单")).toBeDisabled();
  const task = page.getByRole("checkbox", { name: "完成任务：待办任务 1", exact: true });
  await expect(task).toBeEnabled();
  const checked = await task.isChecked();
  await task.click();
  await expect
    .poll(async () => (await savedTodo()).items.find(({ id }) => id === "mixed-item-1").checked)
    .toBe(!checked);
  expect(await geometry(studio, board, id)).toEqual(position);
}

test("[EDIT-MOVE-04] 聚焦文档或待办正文时平移和缩放不会写入对象位置", async ({
  page,
  studio,
}, testInfo) => {
  const board = await openBoard(page, studio, "mixed");
  const before = await studio.readBoard(board);
  const focusedSpace = [];
  for (const { id, content } of nativeFrames) {
    await select(page, studio, id);
    const body = inside(await objectView(page, studio, id), 0.7, 0.65);
    const first = page.getByText(content, { exact: true }).first();
    await expect(first).toBeVisible();
    if (id === "mixed-document") {
      await first.click();
    }
    const camera = compareCamera(await readCanvas(page, studio));
    const firstY = (await first.boundingBox()).y;
    await page.mouse.move(body.x, body.y);
    await page.mouse.wheel(0, 180);
    await expect.poll(async () => (await first.boundingBox()).y).toBeLessThan(firstY - 20);
    expect(compareCamera(await readCanvas(page, studio))).toEqual(camera);
    const origin = id === "mixed-document" ? await documentPadding(page, studio, body.y) : body;
    const space = { x: 22, y: 15 };
    await page.keyboard.down("Space");
    try {
      await drag(page, origin, space);
    } finally {
      await page.keyboard.up("Space");
    }
    const supportsFocusedSpace = studio.edition === "ii" || id !== "mixed-document";
    if (supportsFocusedSpace) {
      await expectPan(page, studio, camera, space);
    } else {
      expect(compareCamera(await readCanvas(page, studio))).toEqual(camera);
      const object = before.objects.find((item) => item.id === id);
      await expectMoved(page, studio, board, id, {
        x: object.x + space.x / camera.zoom,
        y: object.y + space.y / camera.zoom,
      });
    }
    focusedSpace.push({ id, panned: supportsFocusedSpace });
    const afterSpace = compareCamera(await readCanvas(page, studio));
    const middle = { x: -22, y: -15 };
    const nextBody = inside(await objectView(page, studio, id), 0.7, 0.65);
    await drag(page, nextBody, middle, "middle");
    await expectPan(page, studio, afterSpace, middle);
    const unzoomed = compareCamera(await readCanvas(page, studio));
    await wheelZoom(page, nextBody, -36);
    await expect
      .poll(async () => (await readCanvas(page, studio)).zoom)
      .toBeGreaterThan(unzoomed.zoom);
  }
  const after = await studio.readBoard(board);
  const written = after.revision - before.revision;
  if (studio.edition === "ii") {
    expect(after).toEqual(before);
  } else {
    expect(written).toBe(1);
  }
  await observe(testInfo, "native-canvas-navigation", { geometryRevisions: written, focusedSpace });
  await screenshot(page, testInfo, "native-viewport-gestures");
});

async function documentPadding(page, studio, y) {
  const legacy = studio.edition === "initial";
  const label = legacy ? "文档正文：原生文档" : "文档正文";
  const reader = page.getByLabel(label, { exact: true });
  await expect(reader).toBeFocused();
  if (legacy) {
    await expect(page.getByRole("status", { name: "已保存", exact: true })).toBeVisible();
  }

  const box = await reader.boundingBox();
  expect(box).not.toBeNull();
  return { x: box.x + 8, y };
}

test("[EDIT-MOVE-05] 位置锁定及只读访客仍能操作 HTML 正文", async ({
  page,
  browser,
  studio,
}, testInfo) => {
  const guide = await workbenchLinkProbe({ page, browser, studio });
  try {
    const board = await openHtml(page, studio, { locked: true });
    await select(page, studio, html.id);
    const initial = await geometry(studio, board, html.id);
    await assertLockedInput(page, studio);
    await page.goto(studio.url);
    await button(page, "打开白板：" + board.title).hover();
    await button(page, "管理作品：" + board.title).click();
    await page.getByRole("menuitem", { name: "复制链接", exact: true }).click();
    await expect(page.getByText("链接已复制。", { exact: true })).toBeVisible();
    const guest = await guide.openGuest(board);
    await guest.getByRole("textbox", { name: /你的名字/u }).fill("只读来宾");
    await button(guest, "打开白板").click();
    await expect(button(guest, "缩放菜单")).toBeVisible();
    await expect(guest.getByText("只读", { exact: true })).toBeVisible();
    await select(guest, studio, html.id);
    await assertLockedInput(guest, studio);
    expect(await geometry(studio, board, html.id)).toEqual(initial);
    await observe(testInfo, "locked-embed-content", {
      geometryStayed: true,
      visitorOperatedContent: true,
    });
    await screenshot(guest, testInfo, "read-only-embed-content");
  } finally {
    await guide.close();
  }
});

async function assertLockedInput(page, studio) {
  if (studio.edition === "ii") {
    const grip = button(page, "移动 HTML 图解");
    await expect(grip).toBeDisabled();
    await drag(page, center(await grip.boundingBox()), { x: 40, y: 20 });
  }

  const toggle = embedFrame(page, html.label).getByRole("checkbox", { name: "贴边开关" });
  await toggle.click();
  await expect(toggle).toBeChecked();
}
