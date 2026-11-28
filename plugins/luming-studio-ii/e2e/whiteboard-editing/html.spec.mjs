import {
  chooseHtmlFile,
  controlNextHtmlSave,
  embedFrame,
  expect,
  observe,
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
