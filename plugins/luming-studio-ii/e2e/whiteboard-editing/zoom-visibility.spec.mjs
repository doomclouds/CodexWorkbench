import {
  holdNextCanvasMove,
  expect,
  observe,
  readCanvas,
  readZoomDetails,
  screenshot,
  test,
} from "../support/studio.mjs";

const shape = {
  id: "zoom-shape",
  kind: "shape",
  label: "缩放卡片",
  x: 135,
  y: 164,
  width: 152,
  height: 80,
};
const peer = { ...shape, id: "zoom-peer", label: "连接目标", x: 446, fontSize: 36 };
const section = {
  id: "zoom-section",
  kind: "section",
  label: "发布准备分区",
  x: 84,
  y: 108,
  width: 560,
  height: 258,
  transparent: true,
};
const connection = {
  id: "zoom-line",
  kind: "connector",
  label: "",
  x: 287,
  y: 204,
  width: 159,
  height: 1,
  start: { objectId: shape.id, port: "right" },
  end: { objectId: peer.id, port: "left" },
};
const document = {
  id: "zoom-document",
  kind: "document",
  label: "发布方案",
  x: 74,
  y: 430,
  width: 270,
  height: 180,
  document: {
    schemaVersion: 1,
    blocks: [{ id: "zoom-p1", type: "paragraph", content: "发布文档正文" }],
  },
};
const todo = {
  id: "zoom-todo",
  kind: "todo",
  label: "验收待办",
  x: 407,
  y: 430,
  width: 235,
  height: 180,
  items: [{ id: "zoom-todo-1", text: "核对缩放", checked: true }],
};
const embed = {
  id: "zoom-html",
  kind: "html",
  label: "发布进展图解",
  x: 708,
  y: 430,
  width: 242,
  height: 180,
  html: '<main style="background:#23304d;color:white;padding:16px"><h2>发布进展</h2><button type="button">里程碑</button></main>',
};
const image = {
  id: "zoom-image",
  kind: "image",
  label: "历史图像",
  x: 721,
  y: 136,
  width: 208,
  height: 146,
  mediaFixture: "pixel-image",
  naturalSize: { width: 2, height: 3 },
};
const video = {
  ...image,
  id: "zoom-video",
  kind: "video",
  label: "发布视频",
  y: 290,
  height: 110,
  mediaFixture: "blue-frame",
};
const mixed = [section, shape, peer, connection, document, todo, embed, image, video];
const profiles = [
  { name: "desktop-dark", viewport: { width: 1366, height: 820 }, colorScheme: "dark" },
  { name: "narrow-light", viewport: { width: 390, height: 620 }, colorScheme: "light" },
];

function button(page, name) {
  return page.getByRole("button", { name, exact: true });
}

function center(box) {
  expect(box).toBeTruthy();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function item(objects, id) {
  return objects.find((object) => object.id === id);
}

function viewportContains(outer, inner) {
  return (
    inner.x >= outer.x - 1 &&
    inner.y >= outer.y - 1 &&
    inner.x + inner.width <= outer.x + outer.width + 1 &&
    inner.y + inner.height <= outer.y + outer.height + 1
  );
}

function zoomButton(page) {
  return button(page, "缩放菜单");
}

function zoomMenu(page) {
  return page.getByRole("menu", { name: "缩放与视图", exact: true });
}

async function zoomAction(page, name) {
  await zoomButton(page).click();
  const menu = zoomMenu(page);
  await menu.getByRole("menuitem", { name, exact: true }).click();
  await expect(menu).toHaveCount(0);
}

async function zoomByWheel(page, studio, delta, count = 1) {
  const before = await readCanvas(page, studio);
  const anchor = center(before.bounds);
  await page.mouse.move(anchor.x, anchor.y);
  await page.keyboard.down("Control");
  try {
    for (let index = 0; index < count; index++) {
      await page.mouse.wheel(0, delta);
    }
  } finally {
    await page.keyboard.up("Control");
  }

  return { before, anchor };
}

async function setPercent(page, studio, percent) {
  const preset =
    new Map([
      [5, 25],
      [10, 25],
      [18, 25],
      [60, 50],
    ]).get(percent) ?? percent;
  await zoomAction(page, `${preset}%`);
  await expect(zoomButton(page)).toHaveText(`${preset}%`);
  let wheel;
  if (percent === 5) {
    wheel = await zoomByWheel(page, studio, 120, 13);
  }
  if (percent === 10) {
    wheel = await zoomByWheel(page, studio, 120, 5);
  }
  if (percent === 18) {
    wheel = await zoomByWheel(page, studio, 110, 2);
  }
  if (percent === 60) {
    wheel = await zoomByWheel(page, studio, -120);
  }
  await expect(zoomButton(page)).toHaveText(`${percent}%`);
  const actual = await readCanvas(page, studio);
  expect(Math.abs(actual.zoom - percent / 100)).toBeLessThan(0.002);
  if (wheel) {
    for (const axis of ["x", "y"]) {
      const { anchor, before } = wheel;
      const boardCoordinate = (anchor[axis] - before.bounds[axis] - before.pan[axis]) / before.zoom;
      const screenCoordinate =
        actual.bounds[axis] + actual.pan[axis] + boardCoordinate * actual.zoom;
      expect(screenCoordinate).toBeCloseTo(anchor[axis], 0);
    }
  }
}

async function openBoard(page, board) {
  await page.goto(board.url);
  await expect(page.getByRole("textbox", { name: "白板名称" })).toHaveValue(board.title);
  await expect(zoomButton(page)).toBeVisible();
  await zoomAction(page, "适应白板");
}

async function objectBox(page, studio, id) {
  await expect
    .poll(async () => Boolean(item((await readCanvas(page, studio)).objects, id)))
    .toBe(true);

  return item((await readCanvas(page, studio)).objects, id).box;
}

function checkProjectedSize(details, frame, saved) {
  for (const recorded of saved.objects) {
    const rendered = item(details, recorded.id);
    if (!rendered || recorded.kind === "connector") {
      continue;
    }

    expect(rendered.object.width).toBeCloseTo(recorded.width * frame.zoom, 0);
    expect(rendered.object.height).toBeCloseTo(recorded.height * frame.zoom, 0);
  }
}

function visibleCenter(frame, box) {
  const { x, y } = center(box);

  return viewportContains(frame.bounds, { x, y, width: 0, height: 0 });
}

function displaysCaption(details, frame, id, expected) {
  const rendered = item(details, id);

  return (
    !rendered ||
    !visibleCenter(frame, rendered.object) ||
    (rendered.label?.text ?? null) === expected
  );
}

function settledDetails(details, frame, percent, sectionFont) {
  const sectionDetails = item(details, section.id);
  const videoDetails = item(details, video.id)?.video;
  const expectedShape = percent <= 25 ? null : shape.label;
  const expectedPeer = percent === 5 ? null : peer.label;
  const sectionCaption = sectionDetails?.section;
  const sectionFits = sectionCaption && sectionCaption.box.width <= sectionDetails.object.width + 1;
  const measuredSection = Math.round(sectionCaption?.screenFont ?? 0);
  const overview = [25, 60].includes(percent);

  return {
    shapeCaption: displaysCaption(details, frame, shape.id, expectedShape),
    largeShapeCaption: displaysCaption(details, frame, peer.id, expectedPeer),
    sectionCaption: !overview || (sectionFits === true && measuredSection === sectionFont),
    smallestSectionHidden: percent !== 5 || !sectionCaption,
    videoControls:
      !videoDetails ||
      ![25, 60, 100].includes(percent) ||
      videoDetails.controls === (percent === 100),
    videoReady: percent !== 100 || videoDetails?.loaded === true,
  };
}

test("[EDIT-ZOOM-01] 5% 到 200% 的标签可读性和富内容呈现随视口变化但不写入白板", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({ title: "混合内容缩放样板", objects: mixed });
  const saved = await studio.readBoard(board);
  const measurements = [];
  const sectionFont = studio.edition === "initial" ? 12 : 14;
  for (const { name, viewport, colorScheme } of profiles) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme });
    await openBoard(page, board);
    for (const percent of [5, 25, 60, 100, 200]) {
      await setPercent(page, studio, percent);
      const frame = await readCanvas(page, studio);
      await expect(zoomButton(page)).toBeVisible();
      await expect(page.getByRole("toolbar", { name: "白板工具", exact: true })).toBeVisible();
      if (percent === 25) {
        await expect
          .poll(async () => {
            const details = await readZoomDetails(page, studio);
            return {
              document: item(details, document.id)?.document?.width > 0,
              todo: item(details, todo.id)?.todo?.width > 0,
              html: item(details, embed.id)?.html?.width > 0,
              image: item(details, image.id)?.renderedImage?.width > 0,
              video: item(details, video.id)?.video?.bounds.width > 0,
            };
          })
          .toEqual({ document: true, todo: true, html: true, image: true, video: true });
      }
      const checks = expect.configure({ soft: true });
      const expected = {
        shapeCaption: true,
        largeShapeCaption: true,
        sectionCaption: true,
        smallestSectionHidden: true,
        videoControls: true,
        videoReady: true,
      };
      await checks
        .poll(
          async () =>
            settledDetails(await readZoomDetails(page, studio), frame, percent, sectionFont),
          {
            timeout: 1600,
          },
        )
        .toEqual(expected);
      const details = await readZoomDetails(page, studio);
      measurements.push({
        profile: name,
        percent,
        zoom: Math.round(frame.zoom * 100),
        ...settledDetails(details, frame, percent, sectionFont),
      });
      await screenshot(page, testInfo, `${name}-${percent}`);
      checkProjectedSize(details, frame, saved);
      if (percent <= 60) {
        const arrow = item(frame.objects, connection.id);
        expect(arrow?.pathPoints).toHaveLength(5);
        expect(arrow.pathPaint.width).toBeGreaterThan(0);
      }
    }
  }
  await observe(testInfo, "zoom-visibility-matrix", measurements);
  expect(await studio.readBoard(board)).toEqual(saved);
});

async function checkSelectionToolbar(page, studio) {
  const items = page.getByRole("toolbar", { name: "选区格式", exact: true });
  await expect(items).toBeVisible();
  const horizontalOverflow = (await readCanvas(page, studio)).toolbarHorizontalOverflow;
  expect(horizontalOverflow).not.toBeNull();
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
  for (const action of await items.getByRole("button").all()) {
    await expect(action).toBeInViewport({ ratio: 1 });
    if (await action.isEnabled()) {
      await action.click({ trial: true });
    }
  }
  return { items, horizontalOverflow };
}

test("[EDIT-ZOOM-02] 60% 窄短窗口选中 HTML 时菜单界限与入口可用，低倍率手柄保持可操作大小", async ({
  page,
  studio,
}, testInfo) => {
  const longTitle = "发布进展图解、里程碑与交付风险的长期架构验收记录";
  const objects = [
    { ...embed, label: longTitle, x: 399, y: 146 },
    { ...shape, x: 90, y: 360 },
    { ...peer, x: 730, y: 360 },
    { ...connection, x: 242, y: 400, width: 488 },
  ];
  const board = await studio.seedBasicBoard({ title: "短窗口缩放与选择", objects });
  await page.setViewportSize({ width: 1366, height: 820 });
  await page.emulateMedia({ colorScheme: "light" });
  await openBoard(page, board);
  await setPercent(page, studio, 60);
  await page.getByText(longTitle, { exact: true }).click();
  const desktop = await checkSelectionToolbar(page, studio);
  await expect(desktop.items.getByText(longTitle, { exact: true })).toHaveAttribute(
    "title",
    longTitle,
  );
  await screenshot(page, testInfo, "html-selection-actions-desktop-60");
  await page.reload();
  const viewport = { width: 420, height: 345 };
  await page.setViewportSize(viewport);
  await openBoard(page, board);
  await setPercent(page, studio, 60);
  await page.getByText(longTitle, { exact: true }).click();
  await expect.poll(async () => Boolean((await readCanvas(page, studio)).selection)).toBe(true);
  const beforeFit = await readCanvas(page, studio);
  expect(Math.abs(beforeFit.selection.width - embed.width * beforeFit.zoom)).toBeLessThan(4);
  const { items, horizontalOverflow } = await checkSelectionToolbar(page, studio);
  const more = button(items, "更多操作");
  await expect(more).toBeVisible();
  await expect(more).toBeInViewport({ ratio: 1 });
  expect(viewportContains(await items.boundingBox(), await more.boundingBox())).toBe(true);
  await more.click();
  const fitItem = page.getByRole("menuitem", { name: /^适应选区/u });
  const menu = page.getByRole("menu").filter({ has: fitItem });
  await expect(menu).toBeVisible();
  const toolbarBox = await items.boundingBox();
  const menuBox = await menu.boundingBox();
  const screen = { x: 0, y: 0, ...viewport };
  const toolbarFits = viewportContains(screen, toolbarBox);
  const menuFits = viewportContains(screen, menuBox);
  await observe(testInfo, "short-window-zoom-actions", {
    toolbarFits,
    menuFits,
    desktopHorizontalOverflow: desktop.horizontalOverflow,
    narrowHorizontalOverflow: horizontalOverflow,
    viewport,
  });
  await screenshot(page, testInfo, "html-selection-actions-60");
  expect.soft(toolbarFits).toBe(true);
  expect.soft(menuFits).toBe(true);
  await fitItem.scrollIntoViewIfNeeded();
  await expect(fitItem).toBeInViewport({ ratio: 1 });
  await screenshot(page, testInfo, "html-selection-actions-60-scrolled");
  await fitItem.click();
  await expect(menu).toBeHidden();
  const focus = center(await objectBox(page, studio, embed.id));
  const centerOfCanvas = center(beforeFit.bounds);
  expect(focus.x).toBeCloseTo(centerOfCanvas.x, 0);
  expect(focus.y).toBeCloseTo(centerOfCanvas.y, 0);
  await zoomAction(page, "适应白板");
  const fittedBoard = await readCanvas(page, studio);
  for (const id of [embed.id, shape.id, peer.id]) {
    expect(viewportContains(fittedBoard.bounds, item(fittedBoard.objects, id).box)).toBe(true);
  }
  await setPercent(page, studio, 25);
  const { bounds } = await readCanvas(page, studio);
  await page.mouse.click(bounds.x + 16, bounds.y + 75);
  await expect.poll(async () => (await readCanvas(page, studio)).selection).toBeNull();
  const frame = await readCanvas(page, studio);
  const path = item(frame.objects, connection.id).pathPoints;
  const midpoint = path[2];
  await page.mouse.click(midpoint.x, midpoint.y);
  const handleName = studio.edition === "initial" ? "连接线终点位置" : "连线终点";
  const handle = button(page, handleName);
  await expect(handle).toBeVisible();
  const handleBox = await handle.boundingBox();
  expect(handleBox.width).toBeGreaterThanOrEqual(6);
  expect(handleBox.height).toBeGreaterThanOrEqual(6);
  await observe(testInfo, "connector-handle-size", {
    handlePointerTarget: handleBox.width >= 6 && handleBox.height >= 6,
  });
  await screenshot(page, testInfo, "connector-handles-25");
});

function architectureCaptionFonts({ section, object, following, document, todo }, percent) {
  return {
    percent,
    section: section?.section?.screenFont,
    html: object?.htmlCaption?.screenFont ?? null,
    nextHtml: following?.htmlCaption?.screenFont ?? null,
    document: document?.documentTitle?.screenFont ?? null,
    todo: todo?.todoTitle?.screenFont ?? null,
  };
}

function checkArchitectureCaptions(
  { object, following, document, todo },
  expected,
  percent,
  initial,
) {
  if (initial && percent < 50) {
    expect(object.htmlCaption).toBeNull();
    expect(object.hoverTitle).toContain(expected.diagram.label);
  } else {
    expect(object.htmlCaption?.text).toBe(expected.diagram.label);
  }
  if (initial) {
    return;
  }

  expect(object.htmlCaption.screenFont).toBeGreaterThanOrEqual(11.75);
  expect(following?.htmlCaption?.text).toBe(expected.nextDiagram.label);
  expect(following.htmlCaption.box.y).toBeGreaterThanOrEqual(
    object.object.y + object.object.height - 1,
  );

  if (percent >= 18) {
    expect(document?.documentTitle?.screenFont).toBeGreaterThanOrEqual(11.75);
    expect(todo?.todoTitle?.screenFont).toBeGreaterThanOrEqual(11.75);
  } else {
    expect(document?.hoverTitle).toBe(expected.designDoc.label);
    expect(todo?.hoverTitle).toBe(expected.releaseTodo.label);
  }
}

test("[EDIT-ZOOM-04] 架构白板中图解、文档、待办和分区标题在低倍率下可辨认", async ({
  page,
  studio,
}, testInfo) => {
  const enclosing = {
    ...section,
    id: "architecture-frame",
    label: "架构设计全景",
    x: -80,
    y: -600,
    width: 2580,
    height: 2300,
  };
  const nested = {
    ...section,
    id: "architecture-section",
    parentId: enclosing.id,
    label: "业务架构设计、应用服务和模块依赖关系概览",
    x: 0,
    y: 500,
    width: 2480,
    height: 950,
  };
  const diagram = {
    ...embed,
    id: "architecture-diagram",
    label: "系统边界和部署层级",
    parentId: enclosing.id,
    x: 1020,
    y: -300,
    width: 1440,
    height: 760,
    locked: true,
  };
  const nextDiagram = {
    ...diagram,
    id: "architecture-diagram-next",
    parentId: nested.id,
    label: "部署检查和上线顺序",
    y: 520,
  };
  const designDoc = { ...document, x: 0, y: -500, width: 980, height: 505 };
  const releaseTodo = { ...todo, x: 0, y: 550, width: 940, height: 700 };
  const board = await studio.seedBasicBoard({
    title: "架构白板概览标题",
    objects: [enclosing, nested, diagram, nextDiagram, designDoc, releaseTodo],
  });
  const saved = await studio.readBoard(board);
  const initial = studio.edition === "initial";
  const titles = [];
  await openBoard(page, board);

  for (const percent of [5, 18, 25, 50]) {
    await setPercent(page, studio, percent);
    await expect
      .poll(async () => {
        const details = await readZoomDetails(page, studio);
        const title = item(details, nested.id)?.section;
        const neighbor = item(details, diagram.id)?.object;
        return (
          title &&
          neighbor &&
          Math.round(title.screenFont) === (initial ? 12 : 14) &&
          title.box.x + title.box.width <= neighbor.x
        );
      })
      .toBe(true);
    const view = await readZoomDetails(page, studio);
    const object = item(view, diagram.id);
    const rendered = {
      section: item(view, nested.id),
      object,
      following: item(view, nextDiagram.id),
      document: item(view, designDoc.id),
      todo: item(view, releaseTodo.id),
    };
    titles.push(architectureCaptionFonts(rendered, percent));
    await screenshot(page, testInfo, `architecture-overview-${percent}`);
    checkArchitectureCaptions(
      rendered,
      { diagram, nextDiagram, designDoc, releaseTodo },
      percent,
      initial,
    );
    const pick = center(object.object);
    await page.mouse.move(pick.x, pick.y);
    await page.mouse.click(pick.x, pick.y);
    await expect.poll(async () => Boolean((await readCanvas(page, studio)).selection)).toBe(true);
    const toolbar = page.getByRole("toolbar", { name: "选区格式", exact: true });
    const selectedTitle = toolbar.getByText(diagram.label, { exact: true });
    await expect(selectedTitle).toBeInViewport({ ratio: 1 });
    await expect(selectedTitle).toHaveCSS("font-size", initial ? "12px" : "13px");
    await screenshot(page, testInfo, `architecture-caption-${percent}`);
    const { bounds } = await readCanvas(page, studio);
    await page.mouse.click(bounds.x + 16, bounds.y + bounds.height - 50);
    await expect.poll(async () => (await readCanvas(page, studio)).selection).toBeNull();
  }

  await observe(testInfo, "architecture-caption-fonts", titles);
  expect(await studio.readBoard(board)).toEqual(saved);
});

async function moveObject(page, point, delta) {
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + delta.x, point.y + delta.y, { steps: 8 });
  await page.mouse.up();
}

test("[EDIT-ZOOM-03] 待确认保存时缩放不使对象跳动，确认后刷新保留世界坐标", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({
    title: "缩放中的保存回执",
    objects: [shape, peer, connection],
  });
  await openBoard(page, board);
  await setPercent(page, studio, 60);
  const initial = await readCanvas(page, studio);
  const before = await studio.readBoard(board);
  const save = await holdNextCanvasMove(page, studio, board.id);
  try {
    await moveObject(page, center(await objectBox(page, studio, shape.id)), { x: 30, y: 36 });
    await save.observed;
    const persisted = await studio.readBoard(board);
    const oldShape = item(before.objects, shape.id);
    const newShape = item(persisted.objects, shape.id);
    expect((newShape.x - oldShape.x) * initial.zoom).toBeCloseTo(30, 0);
    expect((newShape.y - oldShape.y) * initial.zoom).toBeCloseTo(36, 0);
    await setPercent(page, studio, 25);
    const waiting = await readCanvas(page, studio);
    const waitingBox = await objectBox(page, studio, shape.id);
    expect(waitingBox.x).toBeCloseTo(
      waiting.bounds.x + waiting.pan.x + newShape.x * waiting.zoom,
      0,
    );
    expect(waitingBox.y).toBeCloseTo(
      waiting.bounds.y + waiting.pan.y + newShape.y * waiting.zoom,
      0,
    );
    await screenshot(page, testInfo, "move-pending-at-25");
    save.release();
    await save.finished;
    const savedNotice = page.getByText("已保存", { exact: true }).first();
    await expect(savedNotice).toBeVisible();
    const settled = await readCanvas(page, studio);
    const settledBox = await objectBox(page, studio, shape.id);
    expect(await studio.readBoard(board)).toEqual(persisted);
    expect(settled.zoom).toBeCloseTo(waiting.zoom, 4);
    expect(settled.pan).toEqual(waiting.pan);
    expect(settledBox).toEqual(waitingBox);
    await screenshot(page, testInfo, "move-saved-at-25");
    await page.reload();
    await expect(zoomButton(page)).toBeVisible();
    expect(await studio.readBoard(board)).toEqual(persisted);
    await observe(testInfo, "zoom-save-stability", {
      stable: true,
      zoom: Math.round(settled.zoom * 100),
    });
  } finally {
    save.release();
  }
});
