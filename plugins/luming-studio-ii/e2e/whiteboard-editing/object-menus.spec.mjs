import { expect, observe, readCanvas, screenshot, test } from "../support/studio.mjs";

const fixtureId = "menu-shape";
const commonActions = [
  "剪切",
  "复制",
  "粘贴",
  "重复",
  "置于顶层",
  "置于底层",
  "上移一层",
  "下移一层",
  "组合",
  "取消组合",
  "整理",
  "锁定位置与尺寸",
  "删除",
  "全选",
  "适应白板",
  "适应选区",
];

function menu(page) {
  return page.getByRole("menu", { name: "白板操作", exact: true });
}

function action(popup, label) {
  return popup.getByRole("menuitem", { name: new RegExp("^" + label + "(?:\\s|$)", "u") });
}

function toolbar(page) {
  return page.getByRole("toolbar", { name: "选区格式", exact: true });
}

function findObject(scene, id) {
  const object = scene.objects.find((entry) => entry.id === id);
  if (!object) {
    throw new Error("Missing synthetic object " + id);
  }

  return object;
}

function point(box, horizontal = 0.5, vertical = 0.5) {
  return { x: box.x + box.width * horizontal, y: box.y + box.height * vertical };
}

async function painted(page, studio, id) {
  let scene;
  await expect
    .poll(async () => {
      scene = await readCanvas(page, studio);
      return scene.objects.some((object) => object.id === id);
    })
    .toBe(true);

  return { scene, object: findObject(scene, id) };
}

async function openBoard(page, studio, title, objects) {
  const board = await studio.seedBasicBoard({ title, objects });
  await page.goto(board.url);
  await expect(page.getByRole("textbox", { name: "白板名称", exact: true })).toHaveValue(title);

  return board;
}

function shape(id, x, y, label = id) {
  return { id, kind: "shape", x, y, width: 150, height: 92, label, fill: "#cbd5e1" };
}

async function mouseDrag(page, from, to, button = "left") {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  try {
    await page.mouse.move(to.x, to.y, { steps: 7 });
  } finally {
    await page.mouse.up({ button });
  }
}

function canvas(page, studio, board) {
  return studio.edition === "initial"
    ? page.getByLabel("白板画布", { exact: true })
    : page.getByRole("region", { name: board.title, exact: true });
}

async function rightClick(page, target) {
  await page.mouse.click(target.x, target.y, { button: "right" });
  await expect(menu(page)).toBeVisible();
}

async function openSelectionMenu(page) {
  await toolbar(page).getByRole("button", { name: "更多操作", exact: true }).click();
  await expect(menu(page)).toBeVisible();
}

async function closeMenu(page, popup) {
  await page.keyboard.press("Escape");
  await expect(popup).toBeHidden();
}

async function setZoom(page, value) {
  await page.getByRole("button", { name: "缩放菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: value, exact: true }).click();
}

function fitsViewport(bounds, viewport) {
  return Boolean(
    bounds &&
    bounds.x >= -1 &&
    bounds.y >= -1 &&
    bounds.x + bounds.width <= viewport.width + 1 &&
    bounds.y + bounds.height <= viewport.height + 1,
  );
}

test("[EDIT-MENU-01] 短窗屏边菜单可滚到底部，键盘操作后归还焦点", async ({
  page,
  studio,
}, testInfo) => {
  await page.setViewportSize({ width: 420, height: 345 });
  await openBoard(page, studio, "短窗对象菜单", [shape(fixtureId, 90, 96)]);
  await setZoom(page, "50%");
  const { scene, object } = await painted(page, studio, fixtureId);
  const viewport = page.viewportSize();
  const from = { x: viewport.width * 0.16, y: scene.bounds.y + 70 };
  const target = { x: viewport.width * 0.9, y: viewport.height * 0.82 };
  const before = point(object.box);
  await mouseDrag(
    page,
    from,
    { x: from.x + target.x - before.x, y: from.y + target.y - before.y },
    "middle",
  );

  const anchored = await painted(page, studio, fixtureId);
  const triggerPoint = point(anchored.object.box);
  await page.mouse.click(triggerPoint.x, triggerPoint.y, { button: "right" });
  const popup = menu(page);
  await expect(popup).toBeVisible();
  await screenshot(page, testInfo, "short-context-menu-open");
  await expect
    .poll(async () => fitsViewport(await popup.boundingBox(), page.viewportSize()))
    .toBe(true);
  const cut = action(popup, "剪切");
  const fit = action(popup, "适应选区");
  await expect(fit).not.toBeInViewport();
  await cut.press("End");
  await expect(fit).toBeFocused();
  await expect(fit).toBeInViewport({ ratio: 1 });
  await expect(cut).not.toBeInViewport();
  await screenshot(page, testInfo, "short-context-menu-scrolled");
  await page.keyboard.press("Home");
  await expect(cut).toBeFocused();
  await expect(cut).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("ArrowDown");
  await expect(action(popup, "复制")).toBeFocused();
  await closeMenu(page, popup);
  const expectedFocus = studio.edition === "ii";
  await expect.poll(async () => (await readCanvas(page, studio)).focused).toBe(expectedFocus);

  await page.emulateMedia({ colorScheme: "light" });
  const more = toolbar(page).getByRole("button", { name: "更多操作", exact: true });
  await more.press("Enter");
  await expect(popup).toBeVisible();
  await expect
    .poll(async () => fitsViewport(await popup.boundingBox(), page.viewportSize()))
    .toBe(true);
  await cut.press("End");
  await expect(fit).toBeFocused();
  await screenshot(page, testInfo, "short-selection-menu-light");
  await page.keyboard.press("Tab");
  await expect(popup).toBeHidden();
  await observe(testInfo, "short-object-menu", {
    contextMenuFitsAtEdge: true,
    homeAndEndScrollItems: true,
    returnsFocusToCanvas: expectedFocus,
    opensSelectionMenuByKeyboard: true,
    tabClosesSelectionMenu: true,
  });
});

function menuRow(kind, label, fields = {}, controls = []) {
  return { kind, label, fields, controls, id: "menu-" + kind };
}

const geometricRows = [
  menuRow("shape", "矩形菜单样例", { outline: "rounded" }, [
    ["combobox", "形状类型"],
    ["button", "边框与线条"],
  ]),
  menuRow("text", "文字菜单样例", {}, [
    ["combobox", "形状类型"],
    ["button", "加粗"],
  ]),
  menuRow("note", "便签菜单样例", {}, [
    ["button", "填充颜色"],
    ["button", "加粗"],
  ]),
  menuRow("section", "分区菜单样例", { transparent: true }, [["button", "边框与线条"]]),
  menuRow(
    "ink",
    "墨迹菜单样例",
    { points: [0, 15, 85, 55, 170, 95], stroke: "#d57065", strokeWidth: 8 },
    [["button", "边框与线条"]],
  ),
  menuRow("connector", "连接线菜单样例", { stroke: "#416697", strokeWidth: 5 }, [
    ["combobox", "连接线起点"],
    ["combobox", "连接线终点"],
  ]),
  menuRow("sticker", "贴纸菜单样例", { stickerIconId: "smile" }),
];

const mediaRows = [
  menuRow(
    "image",
    "图片菜单样例",
    { mediaFixture: "pixel-image", naturalSize: { width: 2, height: 3 } },
    [["button", "裁剪图片"]],
  ),
  {
    ...menuRow(
      "image",
      "矢量图片菜单样例",
      { mediaFixture: "board-svg", naturalSize: { width: 120, height: 90 } },
      [["button", "裁剪图片"]],
    ),
    id: "menu-svg",
  },
  menuRow("video", "视频菜单样例", { mediaFixture: "blue-frame" }),
  menuRow("link", "链接菜单样例"),
];

const contentRows = [
  menuRow(
    "table",
    "表格菜单样例",
    {
      rows: [
        ["标题", "状态"],
        ["校验对象菜单", "待完成"],
      ],
    },
    [["button", "填充颜色"]],
  ),
  menuRow(
    "document",
    "文档菜单样例",
    {
      document: {
        schemaVersion: 1,
        blocks: [{ id: "p1", type: "paragraph", content: "文档内容" }],
      },
    },
    [["button", "填充颜色"]],
  ),
  menuRow("todo", "待办菜单样例", {
    items: [{ id: "item-one", text: "确认菜单", checked: false }],
  }),
  menuRow("html", "HTML 菜单样例", { html: "<main><h2>合成 HTML 图解</h2></main>" }, [
    ["button", "编辑 HTML 源码"],
  ]),
  menuRow("diagram", "图解菜单样例", { html: "<main><h2>合成流程图</h2></main>" }, [
    ["button", "编辑 HTML 源码"],
  ]),
  menuRow("chart", "图表菜单样例", {
    html: "<main><h2>合成图表</h2><meter value='0.5'></meter></main>",
  }),
];

function layoutRows(rows) {
  return rows.map(({ id, kind, label, fields }, index) => {
    const x = 70 + (index % 3) * 345;
    const y = 96 + Math.floor(index / 3) * 214;
    const anchors =
      kind === "connector" ? { start: { x, y: y + 20 }, end: { x: x + 194, y: y + 88 } } : {};

    return { ...shape(id, x, y, label), kind, width: 226, height: 142, ...fields, ...anchors };
  });
}

async function representativePoint(page, studio, row) {
  const { object } = await painted(page, studio, row.id);
  if (row.kind === "section") {
    const title = await page.getByText(row.label, { exact: true }).first().boundingBox();
    return point(title ?? object.box, 0.5, 0.5);
  }
  if (row.kind === "connector") {
    return object.pathPoints[2];
  }
  if (row.kind === "ink") {
    return { x: object.box.x + 85, y: object.box.y + 55 };
  }

  return point(object.box);
}

async function selectFrame(page, studio, row) {
  const { object } = await painted(page, studio, row.id);
  const box = object.box;
  await mouseDrag(
    page,
    { x: box.x - 12, y: box.y - 12 },
    { x: box.x + box.width + 12, y: box.y + box.height + 12 },
  );
  await expect(toolbar(page)).toBeVisible();
}

async function checkCommonActions(page) {
  const popup = menu(page);
  for (const label of commonActions) {
    await expect(action(popup, label)).toBeVisible();
  }
  for (const label of ["重复", "删除", "适应选区"]) {
    await expect(action(popup, label)).toBeEnabled();
  }
  for (const label of ["组合", "整理"]) {
    await expect(action(popup, label)).toBeDisabled();
  }
}

async function checkSpecificControls(page, row) {
  for (const [role, name] of row.controls) {
    await expect(toolbar(page).getByRole(role, { name, exact: true })).toBeVisible();
  }
  const labels = new Set(row.controls.map(([, name]) => name));
  for (const name of ["裁剪图片", "编辑 HTML 源码"]) {
    await expect(toolbar(page).getByRole("button", { name, exact: true })).toHaveCount(
      labels.has(name) ? 1 : 0,
    );
  }
}

async function nudgeRight(page, studio, board, row) {
  const before = findObject(await studio.readBoard(board), row.id);
  await canvas(page, studio, board).focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect
    .poll(async () => {
      const current = findObject(await studio.readBoard(board), row.id);
      return [current.x - before.x, current.y - before.y];
    })
    .toEqual([10, 0]);
}

function menuObservation(rows, entry) {
  return rows.map(({ id, kind, controls }) => ({
    object: kind,
    fixture: id,
    entry,
    singleGroupAndTidyDisabled: true,
    controls: controls.map(([, name]) => name),
    movesBy: [10, 0],
  }));
}

test("[EDIT-MENU-02] 几何、文字和贴纸的右键菜单及移动逐项核对", async ({
  page,
  studio,
}, testInfo) => {
  const board = await openBoard(page, studio, "基础对象菜单矩阵", layoutRows(geometricRows));
  for (const row of geometricRows) {
    await test.step(row.label, async () => {
      await rightClick(page, await representativePoint(page, studio, row));
      await checkCommonActions(page);
      if (row.kind === "section") {
        await expect(action(menu(page), "重命名分区")).toBeEnabled();
      }
      if (row.kind === "shape") {
        await screenshot(page, testInfo, "shape-context-actions");
      }
      await closeMenu(page, menu(page));
      await checkSpecificControls(page, row);
      await nudgeRight(page, studio, board, row);
    });
  }

  await observe(testInfo, "geometric-menu-matrix", menuObservation(geometricRows, "context"));
});

test("[EDIT-MENU-03] 菜单执行重复、适应选区和删除，拖动及结果可重开", async ({
  page,
  studio,
}, testInfo) => {
  const board = await openBoard(page, studio, "执行对象菜单", [
    shape(fixtureId, 130, 100, "原始形状"),
    shape("menu-spare", 435, 285, "保留形状"),
  ]);
  const { object } = await painted(page, studio, fixtureId);
  await rightClick(page, point(object.box));
  await action(menu(page), "重复").click();
  await expect.poll(async () => (await studio.readBoard(board)).objects.length).toBe(3);
  const duplicated = (await studio.readBoard(board)).objects.find(
    ({ id }) => ![fixtureId, "menu-spare"].includes(id),
  );
  expect(duplicated).toMatchObject({ kind: "shape", label: "原始形状" });
  const { object: copy } = await painted(page, studio, duplicated.id);
  const start = point(copy.box);
  await mouseDrag(page, start, { x: start.x + 86, y: start.y + 57 });
  await expect
    .poll(async () => findObject(await studio.readBoard(board), duplicated.id).x)
    .toBeGreaterThan(duplicated.x + 20);
  const { object: dragged } = await painted(page, studio, duplicated.id);
  await rightClick(page, point(dragged.box));
  await action(menu(page), "适应选区").click();
  await expect(menu(page)).toBeHidden();
  await expect.poll(async () => (await readCanvas(page, studio)).zoom).toBeGreaterThan(1);
  await screenshot(page, testInfo, "fit-duplicated-object");
  await openSelectionMenu(page);
  await action(menu(page), "删除").click();
  await expect
    .poll(async () => (await studio.readBoard(board)).objects.map(({ id }) => id))
    .toEqual([fixtureId, "menu-spare"]);
  await studio.restart();
  await page.reload();
  await expect
    .poll(async () => (await studio.readBoard(board)).objects.map(({ id }) => id))
    .toEqual([fixtureId, "menu-spare"]);
  await observe(testInfo, "applied-object-menu-actions", {
    duplicatedObject: true,
    manualDragSaved: true,
    fittedSelection: true,
    removedOnlyDuplicateAfterRestart: true,
  });
});

async function checkSelectedNative(page, studio, board, row) {
  await selectFrame(page, studio, row);
  await openSelectionMenu(page);
  await checkCommonActions(page);
  const popup = menu(page);
  await action(popup, "重复").press("Escape");
  await expect(popup).toBeHidden();
  await checkSpecificControls(page, row);
  await nudgeRight(page, studio, board, row);
}

test("[EDIT-MENU-04] 图片、矢量图片、视频和链接在选区菜单可操作并可移动", async ({
  page,
  studio,
}, testInfo) => {
  const rows = mediaRows.map((row) =>
    row.kind === "link" ? { ...row, fields: { href: studio.url } } : row,
  );
  const board = await openBoard(page, studio, "媒体对象菜单矩阵", layoutRows(rows));
  for (const row of rows) {
    await test.step(row.label, () => checkSelectedNative(page, studio, board, row));
  }

  const svg = rows.find(({ id }) => id === "menu-svg");
  await selectFrame(page, studio, svg);
  await toolbar(page).getByRole("button", { name: "裁剪图片", exact: true }).click();
  const crop = page.getByRole("dialog", { name: "裁剪图片", exact: true });
  await expect(crop.getByRole("slider", { name: "裁剪缩放", exact: true })).toBeVisible();
  await screenshot(page, testInfo, "svg-object-crop-action");
  await crop.getByRole("button", { name: "取消", exact: true }).click();
  await expect(crop).toBeHidden();
  await observe(testInfo, "media-menu-matrix", menuObservation(rows, "selection"));
  await observe(testInfo, "svg-crop-available", { opensFromSelection: true, cancelCloses: true });
});

test("[EDIT-MENU-05] 表格、文档、待办、HTML、图解及图表逐项核对菜单和移动", async ({
  page,
  studio,
}, testInfo) => {
  const board = await openBoard(page, studio, "内容对象菜单矩阵", layoutRows(contentRows));
  for (const row of contentRows) {
    await test.step(row.label, () => checkSelectedNative(page, studio, board, row));
  }

  const html = contentRows.find(({ kind }) => kind === "html");
  await selectFrame(page, studio, html);
  await toolbar(page).getByRole("button", { name: "编辑 HTML 源码", exact: true }).click();
  const source = page.getByRole("dialog", { name: "编辑 HTML 源码", exact: true });
  await expect(source).toBeVisible();
  await screenshot(page, testInfo, "open-object-source-editor");
  await source.getByRole("button", { name: "取消", exact: true }).click();
  await expect(source).toBeHidden();
  await observe(testInfo, "content-menu-matrix", menuObservation(contentRows, "selection"));
  await observe(testInfo, "html-source-action", { opensFromSelection: true, cancelCloses: true });
});
