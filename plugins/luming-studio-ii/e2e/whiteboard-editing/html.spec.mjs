import {
  chooseHtmlFile,
  controlNextHtmlSave,
  countOverviewEmbeds,
  embedFrame,
  expect,
  inspectEmbedPaint,
  observe,
  observeEmbedPayloadReads,
  readCanvas,
  screenshot,
  test,
  workbenchLinkProbe,
} from "../support/studio.mjs";

test.use({ trace: "off", screenshot: "off", video: "off" });

const shapeToolbar = "形状";
const originalTitle = "离线互动样板";
const originalId = "offline-embed";
const importedTitle = "粘贴到白板的图解";
const revisionTitle = "修订的离线图解";
const originalHeading = "离线互动计数";
const revisionHeading = "已修订的互动计数";
const ordinarySource = "<main><h1>粘贴后的图解正文</h1><p>只使用本地合成内容。</p></main>";
const counterSource = `<!doctype html>
<meta charset="utf-8">
<style>
  body { margin: 16px; font-family: sans-serif; }
  #scroll { height: 100px; overflow: auto; border: 1px solid #999; }
  #pad { height: 350px; }
</style>
<h1>${originalHeading}</h1>
<button id="increment">增加次数</button>
<p id="count" aria-live="polite">次数：0</p>
<div id="scroll" role="region" aria-label="内部滚动内容" tabindex="0">
  <p>滚动起点</p><div id="pad"></div><p>滚动终点</p>
</div>
<p id="scroll-state">尚未滚动</p>
<p role="alert" id="save-error"></p>
<script>
  const count = document.getElementById('count');
  const subscription = (value) => { count.textContent = '次数：' + (value?.clicks ?? 0); };
  subscription(studioEmbed.load());
  studioEmbed.onLoad(subscription);
  document.getElementById('increment').addEventListener('click', () => {
    const next = { clicks: (studioEmbed.load()?.clicks ?? 0) + 1 };
    studioEmbed.save(next);
    subscription(studioEmbed.load());
  });
  document.getElementById('scroll').addEventListener('scroll', (event) => {
    document.getElementById('scroll-state').textContent = event.target.scrollTop > 0
      ? '已内部滚动'
      : '尚未滚动';
  });
  window.addEventListener('studio-embed-error', () => {
    document.getElementById('save-error').textContent = '样板保存失败';
  });
</script>`;
const revisedSource = counterSource.replace(originalHeading, revisionHeading);

function button(scope, name) {
  return scope.getByRole("button", { name, exact: true });
}

function dialog(page, mode) {
  return page.getByRole("dialog", {
    name: mode === "new" ? "导入 HTML 图解" : "编辑 HTML 源码",
    exact: true,
  });
}

function sourceField(scope) {
  return scope.getByRole("textbox", { name: "HTML 源码", exact: true });
}

function nameField(scope) {
  return scope.getByRole("textbox", { name: "HTML 区域名称", exact: true });
}

function boardTitle(page) {
  return page.getByRole("textbox", { name: "白板名称", exact: true });
}

function heading(frame, name) {
  return frame.getByRole("heading", { name, exact: true });
}

function headingInFrame(page, frameTitle, name) {
  return heading(embedFrame(page, frameTitle), name);
}

async function openNewHtml(page) {
  await button(page, shapeToolbar).click();
  await button(page, "HTML 图解").click();
  const opened = dialog(page, "new");
  await expect(opened).toBeVisible();

  return opened;
}

async function newEmptyBoard(page, studio, title) {
  const [board] = await studio.seedBoards([{ title }]);
  await page.goto(board.url);
  await expect(boardTitle(page)).toHaveValue(title);

  return board;
}

function embeddedObject({
  id = originalId,
  kind = "html",
  label = originalTitle,
  html = counterSource,
  x = 130,
} = {}) {
  return { id, kind, label, html, x, y: 110, width: 550, height: 390 };
}

async function openOriginal(page, studio, title = "HTML 旧样板", objects = [embeddedObject()]) {
  const board = await studio.seedBasicBoard({ title, objects });
  await page.goto(board.url);
  await expect(boardTitle(page)).toHaveValue(title);

  return board;
}

async function savedEmbed(studio, board, { id, label }) {
  const saved = await studio.readBoard(board);

  return saved.objects.find((object) => (id ? object.id === id : object.label === label));
}

async function clickObject(page, studio, id) {
  await expect
    .poll(async () => (await readCanvas(page, studio)).objects.some(({ id: key }) => key === id))
    .toBe(true);
  const { objects } = await readCanvas(page, studio);
  const object = objects.find((entry) => entry.id === id);
  const title = object.titleBox;
  const position = title || object.box;
  await page.mouse.click(
    position.x + Math.min(position.width / 2, 24),
    position.y + Math.min(position.height / 2, 9),
  );
}

async function selectOriginal(page, studio, id = originalId) {
  await clickObject(page, studio, id);
  await expect(page.getByRole("toolbar", { name: "选区格式", exact: true })).toBeVisible();
}

async function editSource(page, studio, id) {
  await selectOriginal(page, studio, id);
  await button(page, "编辑 HTML 源码").click();
  const opened = dialog(page, "edit");
  await expect(opened).toBeVisible();

  return opened;
}

test("[EDIT-HTML-01] 菜单新建、输入源码与取消空草稿", async ({ page, studio }, testInfo) => {
  const board = await newEmptyBoard(page, studio, "工具新建 HTML");
  const opened = await openNewHtml(page);
  await expect(button(opened, "添加到白板")).toBeDisabled();
  await button(opened, "取消").click();
  await expect(opened).toBeHidden();
  expect((await studio.readBoard(board)).objects).toHaveLength(0);

  await openNewHtml(page);
  await nameField(opened).fill(importedTitle);
  await sourceField(opened).fill(ordinarySource);
  await screenshot(page, testInfo, "source-before-create");
  await button(opened, "添加到白板").click();
  await expect(opened).toBeHidden();
  await expect(headingInFrame(page, importedTitle, "粘贴后的图解正文")).toBeVisible();
  await expect
    .poll(() => savedEmbed(studio, board, { label: importedTitle }))
    .toMatchObject({
      kind: "html",
      html: ordinarySource,
    });
  await page.reload();
  await expect(headingInFrame(page, importedTitle, "粘贴后的图解正文")).toBeVisible();
  await screenshot(page, testInfo, "pasted-html-reopened");
  await observe(testInfo, "html-create", {
    emptyBeforeSave: true,
    sourceSaved: true,
    renderedAfterReload: true,
  });
});

test("[EDIT-HTML-02] 选择离线 HTML 文件后以文件名预填标题并渲染", async ({
  page,
  studio,
}, testInfo) => {
  const board = await newEmptyBoard(page, studio, "从文件添加 HTML");
  const opened = await openNewHtml(page);
  const file = await chooseHtmlFile(
    page,
    () => button(opened, "选择 HTML 文件").click(),
    "ordinary",
  );
  await expect(nameField(opened)).toHaveValue(file.title);
  await expect(sourceField(opened)).toHaveValue(file.html);
  await screenshot(page, testInfo, "file-prefilled-source");
  await button(opened, "添加到白板").click();
  await expect(opened).toBeHidden();
  await expect(headingInFrame(page, file.title, file.heading)).toBeVisible();
  await expect
    .poll(() => savedEmbed(studio, board, { label: file.title }))
    .toMatchObject({ html: file.html });
  await observe(testInfo, "html-file", {
    fileTitlePrefilled: true,
    exactSourceSaved: true,
    frameVisible: true,
  });
});

test("[EDIT-HTML-03] 旧样板标题及源码可打开、取消和应用，对象菜单保留选区", async ({
  page,
  studio,
}, testInfo) => {
  const board = await openOriginal(page, studio);
  await expect(headingInFrame(page, originalTitle, originalHeading)).toBeVisible();
  const opened = await editSource(page, studio);
  await expect(nameField(opened)).toHaveValue(originalTitle);
  await expect(sourceField(opened)).toHaveValue(counterSource);
  const file = await chooseHtmlFile(
    page,
    () => button(opened, "选择 HTML 文件").click(),
    "ordinary",
  );
  await expect(nameField(opened)).toHaveValue(originalTitle);
  await expect(sourceField(opened)).toHaveValue(file.html);
  await nameField(opened).fill("不保存的名称");
  await sourceField(opened).fill("<h1>不保存的内容</h1>");
  await button(opened, "取消").click();
  await expect(opened).toBeHidden();
  expect(await savedEmbed(studio, board, { id: originalId })).toMatchObject({
    label: originalTitle,
    html: counterSource,
  });

  await button(page, "更多操作").click();
  const menu = page.getByRole("menu", { name: "白板操作", exact: true });
  await expect(menu.getByRole("menuitem", { name: /^重复/u })).toBeEnabled();
  await screenshot(page, testInfo, "embedded-object-menu");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  await editSource(page, studio);
  await nameField(opened).fill(revisionTitle);
  await sourceField(opened).fill(revisedSource);
  await button(opened, "保存源码").click();
  await expect(opened).toBeHidden();
  await expect(headingInFrame(page, revisionTitle, revisionHeading)).toBeVisible();
  await page.reload();
  const reloaded = await editSource(page, studio);
  await expect(nameField(reloaded)).toHaveValue(revisionTitle);
  await expect(sourceField(reloaded)).toHaveValue(revisedSource);
  await screenshot(page, testInfo, "edited-embed-source-reopened");
  await observe(testInfo, "html-edit-source", {
    openedLegacySource: true,
    cancelledUnchanged: true,
    savedTitleAndSource: true,
  });
});

test("[EDIT-HTML-04] 沙箱内按钮与独立滚动工作，互动状态保存后可重开", async ({
  page,
  studio,
}, testInfo) => {
  const board = await openOriginal(page, studio, "HTML 交互状态");
  await selectOriginal(page, studio);
  const frame = embedFrame(page, originalTitle);
  await expect(heading(frame, originalHeading)).toBeVisible();
  await button(frame, "增加次数").click();
  await expect(frame.getByText("次数：1", { exact: true })).toBeVisible();
  const scroller = frame.getByRole("region", { name: "内部滚动内容", exact: true });
  const camera = await readCanvas(page, studio);
  await scroller.hover();
  await page.mouse.wheel(0, 800);
  await expect(frame.getByText("已内部滚动", { exact: true })).toBeVisible();
  expect(await readCanvas(page, studio)).toMatchObject({ pan: camera.pan, zoom: camera.zoom });
  await screenshot(page, testInfo, "html-native-scroll-and-state");
  await expect
    .poll(() => savedEmbed(studio, board, { id: originalId }))
    .toMatchObject({
      state: { clicks: 1 },
    });
  await studio.restart();
  await page.reload();
  await expect(frame.getByText("次数：1", { exact: true })).toBeVisible();
  await screenshot(page, testInfo, "embedded-state-after-refresh");
  await observe(testInfo, "html-frame", {
    buttonRan: true,
    independentScroll: true,
    statePersisted: true,
  });
});

test("[EDIT-HTML-05] 源码保存回复不明时保留草稿并避免误写", async ({ page, studio }, testInfo) => {
  const board = await openOriginal(page, studio, "HTML 保存失败恢复");
  const opened = await editSource(page, studio);
  await nameField(opened).fill(revisionTitle);
  await sourceField(opened).fill(revisedSource);
  const fault = await controlNextHtmlSave(page, studio, {
    boardId: board.id,
    action: "source",
    mode: "before",
  });
  await button(opened, "保存源码").click();
  await fault.observed;
  const visibleError =
    studio.edition === "initial"
      ? opened.getByRole("alert")
      : opened.getByText(/正文保存结果未知/u);
  await expect(visibleError.first()).toBeVisible();
  await expect(sourceField(opened)).toHaveValue(revisedSource);
  expect(await savedEmbed(studio, board, { id: originalId })).toMatchObject({
    html: counterSource,
  });
  await screenshot(page, testInfo, "html-source-retained-after-error");
  await expect(opened.getByRole("alert").first()).toBeVisible();
  await button(opened, "保存源码").click();
  if (studio.edition === "initial") {
    await expect(
      opened.getByText("无法确认上次保存结果，请保留草稿并比较当前内容。"),
    ).toBeVisible();
    expect(await savedEmbed(studio, board, { id: originalId })).toMatchObject({
      html: counterSource,
    });
  } else {
    await expect(opened).toBeHidden();
    const requests = fault.requests();
    expect(requests.length).toBeGreaterThanOrEqual(2);
    expect(new Set(requests).size).toBe(1);
    await page.reload();
    await expect(headingInFrame(page, revisionTitle, revisionHeading)).toBeVisible();
  }
  await observe(testInfo, "html-source-retry", {
    noWriteAfterFailure: true,
    draftRetained: true,
    retryPersisted: studio.edition === "ii",
  });
});

test("[EDIT-HTML-06] 兼容带源码的 diagram 与 chart 历史对象", async ({
  page,
  studio,
}, testInfo) => {
  const diagrams = [
    embeddedObject({
      id: "old-diagram",
      kind: "diagram",
      label: "旧版图解",
      html: "<h1>旧图解源码</h1>",
    }),
    embeddedObject({
      id: "old-chart",
      kind: "chart",
      label: "旧版图表",
      html: "<h1>旧图表源码</h1>",
      x: 740,
    }),
  ];
  await openOriginal(page, studio, "兼容旧嵌入类型", diagrams);
  await expect(headingInFrame(page, "旧版图解", "旧图解源码")).toBeVisible();
  await selectOriginal(page, studio, "old-diagram");
  await button(page, "编辑 HTML 源码").click();
  const modern = studio.edition === "ii";
  const source = dialog(page, modern ? "edit" : "new");
  await expect(source).toBeVisible();
  await expect(nameField(source)).toHaveValue(modern ? "旧版图解" : "HTML 图解");
  await expect(sourceField(source)).toHaveValue(modern ? "<h1>旧图解源码</h1>" : "");
  await screenshot(page, testInfo, "diagram-source-entry");
  await button(source, "取消").click();
  await selectOriginal(page, studio, "old-chart");
  if (modern) {
    await expect(headingInFrame(page, "旧版图表", "旧图表源码")).toBeVisible();
  } else {
    await expect(page.getByText("旧版图表", { exact: true })).toBeVisible();
  }
  await expect(button(page, "编辑 HTML 源码")).toHaveCount(0);
  await screenshot(page, testInfo, "legacy-diagram-and-chart");
  await observe(testInfo, "html-compatible-kinds", {
    diagramSourceEditable: modern,
    chartRenderedAsHtml: modern,
  });
});

async function openReadOnlyGuest(page, probe, board) {
  const card = button(page, "打开白板：" + board.title);
  await card.hover();
  await button(page, "管理作品：" + board.title).click();
  await page.getByRole("menuitem", { name: "复制链接", exact: true }).click();
  await expect(page.getByText("链接已复制。", { exact: true })).toBeVisible();
  await probe.checkpoint(board);
  const guest = await probe.openGuest(board);
  await guest.getByRole("textbox", { name: /你的名字/u }).fill("图解只读查看者");
  await button(guest, "打开白板").click();
  await expect(guest.getByText("只读", { exact: true })).toBeVisible();

  return guest;
}

test("[EDIT-HTML-07] 只读访客能看图解及操作控件，不能保存互动状态或源码", async ({
  page,
  browser,
  studio,
}, testInfo) => {
  const probe = await workbenchLinkProbe({ page, browser, studio });
  try {
    const board = await openOriginal(page, studio, "只读 HTML 图解");
    const before = await savedEmbed(studio, board, { id: originalId });
    await page.goto(studio.url);
    const guest = await openReadOnlyGuest(page, probe, board);
    const frame = embedFrame(guest, originalTitle);
    await expect(heading(frame, originalHeading)).toBeVisible();
    await clickObject(guest, studio, originalId);
    await expect(button(guest, "编辑 HTML 源码")).toHaveCount(0);
    await button(frame, "增加次数").click();
    await expect(frame.getByText("样板保存失败", { exact: true })).toBeVisible();
    await expect(frame.getByText("次数：0", { exact: true })).toBeVisible();
    expect(await savedEmbed(studio, board, { id: originalId })).toEqual(before);
    await screenshot(guest, testInfo, "readonly-html-guest");
    await observe(testInfo, "html-viewer", {
      separateViewer: true,
      frameInteractive: true,
      sourceAndStateReadOnly: true,
    });
  } finally {
    await probe.close();
  }
});

const annotationCursor = /url\("data:image\/svg\+xml,/u;
const shadowCounter =
  counterSource +
  `
<div id="widget" data-studio-id="custom-widget"></div>
<script>
  const shadow = document.getElementById('widget').attachShadow({ mode: 'open' });
  shadow.innerHTML = '<style>button { cursor: crosshair !important; }</style><button type="button">嵌入按钮</button>';
  shadow.querySelector('button').addEventListener('click', () => document.getElementById('increment').click());
</script>`;

test("[EDIT-HTML-08] 备注光标穿过嵌入内容，退出后恢复内部互动", async ({
  page,
  studio,
}, testInfo) => {
  const html = {
    id: "cursor-html",
    kind: "html",
    label: "备注 HTML",
    x: 80,
    y: 100,
    width: 365,
    height: 340,
    html: shadowCounter,
  };
  const diagram = { ...html, id: "cursor-diagram", kind: "diagram", label: "备注图解", x: 485 };
  const chart = { ...html, id: "cursor-chart", kind: "chart", label: "备注图表", x: 890 };
  const board = await openOriginal(page, studio, "备注光标定位", [
    html,
    diagram,
    chart,
    {
      id: "cursor-shape",
      kind: "shape",
      label: "标注形状",
      x: 90,
      y: 490,
      width: 160,
      height: 100,
    },
    {
      id: "cursor-document",
      kind: "document",
      label: "标注文档",
      x: 315,
      y: 490,
      width: 410,
      height: 230,
      document: {
        schemaVersion: 1,
        blocks: [
          {
            id: "cursor-block",
            type: "paragraph",
            content: [{ type: "text", text: "标注正文", styles: {} }],
            children: [],
          },
        ],
      },
    },
    {
      id: "cursor-todo",
      kind: "todo",
      label: "标注待办",
      x: 795,
      y: 490,
      width: 385,
      height: 230,
      items: [{ id: "cursor-task", text: "标注任务", checked: false }],
    },
  ]);
  await selectOriginal(page, studio, html.id);
  const frame = embedFrame(page, html.label);
  const target = button(frame, "嵌入按钮");
  await expect(target).toHaveCSS("cursor", "crosshair");
  await target.click();
  await expect(frame.getByText("次数：1", { exact: true })).toBeVisible();
  await expect.poll(() => savedEmbed(studio, board, html)).toMatchObject({ state: { clicks: 1 } });

  const notes = button(page, "备注");
  await notes.click();
  await expect(notes).toHaveAttribute("aria-pressed", "true");
  const isCurrent = studio.edition === "ii";
  const frames = isCurrent ? [html, diagram, chart] : [html, diagram];
  for (const object of frames) {
    const field = embedFrame(page, object.label);
    const embedded = button(field, "嵌入按钮");
    await embedded.hover();
    await expect(button(field, "增加次数")).toHaveCSS("cursor", annotationCursor);
    await expect(embedded).toHaveCSS("cursor", isCurrent ? annotationCursor : "crosshair");
  }
  const shape = page.getByText("标注形状", { exact: true });
  await shape.hover();
  await expect(shape).toHaveCSS("cursor", annotationCursor);
  await expect(button(page, "展开文档")).toHaveCSS("cursor", annotationCursor);
  await expect(button(page, "备注任务：标注任务")).toHaveCSS("cursor", annotationCursor);
  if (isCurrent) {
    const canvas = page.getByRole("region", { name: board.title, exact: true });
    await canvas.hover({ position: { x: 45, y: 45 } });
    await expect(canvas).toHaveCSS("cursor", annotationCursor);
    await expect(button(page, "展开任务清单")).toHaveCSS("cursor", annotationCursor);
  }
  await target.hover();
  await screenshot(page, testInfo, "embed-annotation-hover");
  await target.click();
  const draft = page.getByRole("textbox", { name: "批注内容", exact: true });
  await expect(draft).toBeVisible();
  await expect(frame.getByText("次数：1", { exact: true })).toBeVisible();
  await draft.press("Escape");
  await expect(draft).toHaveCount(0);
  await notes.click();
  await expect(notes).toHaveAttribute("aria-pressed", "false");

  await selectOriginal(page, studio, html.id);
  await expect(target).toHaveCSS("cursor", "crosshair");
  await target.click();
  await expect(frame.getByText("次数：2", { exact: true })).toBeVisible();
  const scroller = frame.getByRole("region", { name: "内部滚动内容", exact: true });
  const camera = await readCanvas(page, studio);
  await scroller.hover();
  await page.mouse.wheel(0, 700);
  await expect(frame.getByText("已内部滚动", { exact: true })).toBeVisible();
  expect(await readCanvas(page, studio)).toMatchObject({ pan: camera.pan, zoom: camera.zoom });
  await observe(testInfo, "annotation-embed-cursor", {
    ordinaryCursor: true,
    shadowCursor: isCurrent,
    openedDraft: true,
    frameInteractionRestored: true,
  });
});

const overviewTitle = "跨视口渲染与交互";
const previewTitle = "可缩放的双色图解";
const previewId = "colored-overview-embed";
const colors = {
  first: [229, 28, 132],
  second: [3, 171, 208],
  revised: [40, 170, 73],
};
const coloredOverview = `<!doctype html>
<meta charset="utf-8">
<style>
  body { margin: 0; font: 16px sans-serif; }
  .segment { display: inline-block; width: 213px; height: 113px; }
  .first { background: #e51c84; }
  .second { background: #03abd0; }
</style>
<main style="padding:20px">
  <h1>发行阶段</h1>
  <div class="segment first"></div>
  <div class="segment second"></div>
</main>`;
const recoloredOverview = coloredOverview.replace("#03abd0", "#28aa49");

function overviewObjects(objects) {
  const markers = [-4100, 4000].map((x) => ({
    id: `overview-edge-${x}`,
    kind: "shape",
    x,
    y: 90,
    width: 100,
    height: 110,
  }));

  return [...markers, ...objects];
}

async function setOverviewZoom(page, label) {
  const zoom = button(page, "缩放菜单");
  await zoom.click();
  const menu = page.getByRole("menu", { name: "缩放与视图", exact: true });
  await menu.getByRole("menuitem", { name: label, exact: true }).click();
}

async function openOverview(page, studio) {
  await page.keyboard.press("Escape");
  await setOverviewZoom(page, "适应白板");
  await expect.poll(async () => (await readCanvas(page, studio)).zoom).toBeLessThan(0.2);
}

async function panAndZoomOverview(page, studio, duringPan) {
  const before = await readCanvas(page, studio);
  const x = before.bounds.x + before.bounds.width / 2;
  const y = before.bounds.y + before.bounds.height * 0.72;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: "middle" });
  try {
    await page.mouse.move(x + 108, y - 27, { steps: 8 });
    await expect
      .poll(async () => (await readCanvas(page, studio)).pan.x)
      .toBeGreaterThan(before.pan.x + 80);
    await duringPan?.();
  } finally {
    await page.mouse.up({ button: "middle" });
  }

  await page.keyboard.down("Control");
  try {
    for (const delta of [-100, -40]) {
      await page.mouse.wheel(0, delta);
    }
  } finally {
    await page.keyboard.up("Control");
  }

  await expect.poll(async () => (await readCanvas(page, studio)).zoom).toBeGreaterThan(before.zoom);
  expect((await readCanvas(page, studio)).zoom).toBeLessThan(0.25);
}

async function expectPaintedSegments(page, studio, revised = false) {
  const desired = revised ? "revised" : "second";
  const undesired = revised ? "second" : "revised";
  await expect
    .poll(async () => {
      const { counts } = await inspectEmbedPaint(page, studio, previewId, colors);

      return counts.first > 30 && counts[desired] > 30 && counts[undesired] < 10;
    })
    .toBe(true);
}

async function annotateOverview(page, studio) {
  const notes = button(page, "备注");
  await notes.click();
  await expect(notes).toHaveAttribute("aria-pressed", "true");
  const { objects } = await readCanvas(page, studio);
  const { box } = objects.find(({ id }) => id === previewId);
  await page.mouse.click(box.x + box.width * 0.54, box.y + box.height * 0.49);
  const draft = page.getByRole("textbox", { name: "批注内容", exact: true });
  await expect(draft).toBeVisible();
  if (studio.edition === "ii") {
    await expect(page.getByRole("dialog", { name: "新建备注", exact: true })).toContainText(
      previewTitle,
    );
  }

  return { draft, notes };
}

test("[EDIT-HTML-09] 概览平移与缩放保留 HTML 彩块、备注及修订后的预览", async ({
  page,
  studio,
}, testInfo) => {
  const colored = embeddedObject({
    id: previewId,
    label: previewTitle,
    html: coloredOverview,
    x: -270,
  });
  const board = await openOriginal(page, studio, overviewTitle, overviewObjects([colored]));
  await openOverview(page, studio);
  await expectPaintedSegments(page, studio);
  await screenshot(page, testInfo, "html-color-overview");
  await panAndZoomOverview(page, studio, async () => {
    const { counts } = await inspectEmbedPaint(page, studio, previewId, colors);
    expect(counts.first).toBeGreaterThan(30);
    expect(counts.second).toBeGreaterThan(30);
    await screenshot(page, testInfo, "html-color-during-pan");
  });
  await expectPaintedSegments(page, studio);
  await screenshot(page, testInfo, "html-color-after-pan-and-zoom");

  const { draft, notes } = await annotateOverview(page, studio);
  await screenshot(page, testInfo, "html-overview-note-target");
  await draft.press("Escape");
  await expect(draft).toHaveCount(0);
  await notes.click();
  await expect(notes).toHaveAttribute("aria-pressed", "false");

  await openOverview(page, studio);
  await setOverviewZoom(page, "100%");
  const source = await editSource(page, studio, previewId);
  await expect(sourceField(source)).toHaveValue(coloredOverview);
  await sourceField(source).fill(recoloredOverview);
  await button(source, "保存源码").click();
  await expect(source).toBeHidden();
  await expect
    .poll(() => savedEmbed(studio, board, { id: previewId }))
    .toMatchObject({
      html: recoloredOverview,
    });
  await page.reload();
  await openOverview(page, studio);
  await expectPaintedSegments(page, studio, true);
  await screenshot(page, testInfo, "html-revised-overview-after-reload");
  await observe(testInfo, "html-overview-paint", {
    overviewPainted: true,
    cameraMotionPainted: true,
    noteDraftOpened: true,
    revisedPaintedAfterReload: true,
  });
});

test("[EDIT-HTML-10] 从整板概览返回后嵌入仍可点击和内部滚动，重开保留状态", async ({
  page,
  studio,
}, testInfo) => {
  const board = await openOriginal(
    page,
    studio,
    "概览返回后的嵌入状态",
    overviewObjects([embeddedObject({ x: -275 })]),
  );
  await setOverviewZoom(page, "100%");
  await selectOriginal(page, studio);
  const frame = embedFrame(page, originalTitle);
  await button(frame, "增加次数").click();
  await expect
    .poll(() => savedEmbed(studio, board, { id: originalId }))
    .toMatchObject({
      state: { clicks: 1 },
    });

  await openOverview(page, studio);
  await panAndZoomOverview(page, studio);
  await openOverview(page, studio);
  await setOverviewZoom(page, "100%");
  await selectOriginal(page, studio);
  await expect(frame.getByText("次数：1", { exact: true })).toBeVisible();
  await button(frame, "增加次数").click();
  const beforeScroll = await readCanvas(page, studio);
  await frame.getByRole("region", { name: "内部滚动内容", exact: true }).hover();
  await page.mouse.wheel(0, 700);
  await expect(frame.getByText("已内部滚动", { exact: true })).toBeVisible();
  expect(await readCanvas(page, studio)).toMatchObject({
    pan: beforeScroll.pan,
    zoom: beforeScroll.zoom,
  });
  await expect
    .poll(() => savedEmbed(studio, board, { id: originalId }))
    .toMatchObject({
      state: { clicks: 2 },
    });
  await screenshot(page, testInfo, "html-interactive-after-camera-return");
  await page.reload();
  await openOverview(page, studio);
  await setOverviewZoom(page, "100%");
  await selectOriginal(page, studio);
  await expect(frame.getByText("次数：2", { exact: true })).toBeVisible();
  await observe(testInfo, "html-overview-interaction", {
    interactiveAfterNavigation: true,
    independentScroll: true,
    savedStateAfterReload: true,
  });
});

const diagramFixturePadding = "architecture-preview ".repeat(500);

function architectureEmbed(index, x, y) {
  const label = `架构图 ${index}`;
  return {
    id: `architecture-embed-${index}`,
    kind: "html",
    label,
    x,
    y,
    width: 1440,
    height: 1120,
    html: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${label}</title>
<style>:root { --paper: #f5f5f5; } body { background: var(--paper); }
svg { display: block; width: 100%; }</style></head><body>
<svg viewBox="0 0 1440 1100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}">
<defs><marker id="arrow" refX="7" refY="3" markerWidth="8" markerHeight="6" orient="auto">
<polygon points="0 0,8 3,0 6" fill="#2d3142" /></marker></defs>
<rect x="80" y="260" width="490" height="450" rx="24" fill="#e51c84" />
<rect x="870" y="260" width="490" height="450" rx="24" fill="#03abd0" />
<path d="M580 480H835" fill="none" stroke="#2d3142" stroke-width="14" marker-end="url(#arrow)" />
<text x="100" y="180" fill="#2d3142" font-size="84">${label}</text>
</svg><!-- ${diagramFixturePadding} --></body></html>`,
  };
}

test("[EDIT-HTML-11] 5% 概览读齐 98 份架构图并保留图解像素", async ({ page, studio }, testInfo) => {
  const diagrams = Array.from({ length: 98 }, (_, index) =>
    architectureEmbed(index, (index % 14) * 1850, Math.floor(index / 14) * 1200),
  );
  const offscreen = [architectureEmbed(98, -6800, 0), architectureEmbed(99, 30850, 0)];
  const reads = observeEmbedPayloadReads(page, studio);
  await openOriginal(page, studio, "架构大板静态预览", [...diagrams, ...offscreen]);
  await openOverview(page, studio);
  await expect.poll(async () => (await readCanvas(page, studio)).zoom).toBeCloseTo(0.05, 4);
  await expect
    .poll(() => countOverviewEmbeds(page, studio), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(diagrams.length);

  for (const item of [diagrams[0], diagrams[49], diagrams[97]]) {
    await expect
      .poll(async () => {
        const { counts } = await inspectEmbedPaint(page, studio, item.id, colors);
        return counts.first > 200 && counts.second > 200;
      })
      .toBe(true);
  }

  if (studio.edition === "ii") {
    const requested = new Set(reads().flat());
    expect(reads().length).toBeGreaterThan(1);
    expect(diagrams.every(({ id }) => requested.has(id))).toBe(true);
    expect(offscreen.some(({ id }) => requested.has(id))).toBe(false);
  }

  await screenshot(page, testInfo, "architecture-html-overview");
});

test("[EDIT-HTML-12] 拦截新导入的内联资源并继续渲染已保存的旧图解", async ({
  page,
  studio,
}, testInfo) => {
  const asset = encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#114488"/></svg>',
  );
  const legacySource = '<h1>旧图解</h1><img alt="旧图" src="data:image/svg+xml,' + asset + '">';
  const board = await openOriginal(page, studio, "内联资源兼容", [
    embeddedObject({ html: legacySource }),
  ]);
  const editing = await editSource(page, studio);
  const revised = legacySource.replace("旧图解", "新文字");
  await expect(nameField(editing)).toHaveValue(originalTitle);
  await sourceField(editing).fill(revised);
  await button(editing, "保存源码").click();
  await expect(editing).toBeHidden();
  await expect
    .poll(() => savedEmbed(studio, board, { id: originalId }))
    .toMatchObject({ html: revised });
  await page.reload();
  await expect(headingInFrame(page, originalTitle, "新文字")).toBeVisible();
  await expect
    .poll(async () => {
      const { counts } = await inspectEmbedPaint(page, studio, originalId, {
        legacyImage: [17, 68, 136],
      });

      return counts.legacyImage;
    })
    .toBeGreaterThan(100);
  await screenshot(page, testInfo, "legacy-inline-resource-after-edit");

  const opened = await openNewHtml(page);
  const imported = await chooseHtmlFile(
    page,
    () => button(opened, "选择 HTML 文件").click(),
    "inline-resource",
  );
  await expect(sourceField(opened)).toHaveValue(imported.html);
  await button(opened, "添加到白板").click();
  if (studio.edition === "ii") {
    await expect(opened.getByText("HTML 含有新增的 data: 资源。", { exact: false })).toBeVisible();
    await expect(sourceField(opened)).toHaveValue(imported.html);
    expect((await studio.readBoard(board)).objects).toHaveLength(1);
    await screenshot(page, testInfo, "inline-resource-import-rejected");
    await button(opened, "取消").click();
  } else {
    await expect(opened).toBeHidden();
    await expect
      .poll(() => savedEmbed(studio, board, { label: imported.title }))
      .toMatchObject({
        html: imported.html,
      });
    await screenshot(page, testInfo, "inline-resource-import-accepted");
  }
});
