import {
  chooseDocumentImage,
  expect,
  failNextDocumentSave,
  holdDocumentEditorChunk,
  observe,
  readDocumentDownload,
  readDocumentPaper,
  screenshot,
  test,
  workbenchLinkProbe,
} from "../support/studio.mjs";

test.use({ trace: "off", screenshot: "off", video: "off" });

function button(page, name) {
  return page.getByRole("button", { name, exact: true });
}

function composer(page) {
  return page.getByRole("textbox", { name: "", exact: true });
}

function documentTitle(page) {
  return page.getByLabel("文档标题", { exact: true });
}

function reader(page, studio, title) {
  return page.getByLabel(studio.edition === "initial" ? "文档正文：" + title : "文档正文", {
    exact: true,
  });
}

function viewport(page, studio, board) {
  return page.getByLabel(studio.edition === "initial" ? "白板画布" : board.title, { exact: true });
}

function paragraph(id, content) {
  return { id, type: "paragraph", props: {}, content };
}

function titleBlock(id, content, level = 1) {
  return { id, type: "heading", props: { level }, content };
}

async function loadDocument(page, studio, title, blocks) {
  const board = await studio.seedBasicBoard({
    title: title + "测试板",
    objects: [
      {
        id: "editing-document",
        kind: "document",
        label: title,
        x: 70,
        y: 70,
        width: 980,
        height: 580,
        document: { schemaVersion: 1, blocks },
      },
    ],
  });
  await page.goto(board.url);
  await expect(reader(page, studio, title)).toBeVisible();
  await documentTitle(page).click();

  return board;
}

async function beginEditing(page) {
  await button(page, "编辑文档").click();
  await expect(composer(page)).toBeVisible();
  await expect(documentTitle(page)).toBeEditable();
}

async function enterReading(page) {
  await button(page, "阅读文档").click();
  await expect(composer(page)).toHaveCount(0);
}

async function waitForVersion(studio, board, previous) {
  await expect.poll(async () => (await studio.readBoard(board)).revision).toBeGreaterThan(previous);
}

const coldEditorTitle = "冷加载文档";
const coldEditorParagraphs = Array.from({ length: 34 }, (_, index) =>
  paragraph("cold-" + index, "编辑状态验收段落 " + String(index + 1).padStart(2, "0")),
);

async function openColdEditorReader(page, studio) {
  const board = await loadDocument(page, studio, coldEditorTitle, coldEditorParagraphs);
  await button(page, "展开文档").click({ timeout: 7000 });
  await expect(button(page, "返回画板")).toBeVisible();
  const content = reader(page, studio, coldEditorTitle);
  await content.press("End");
  await expect
    .poll(async () => (await readDocumentPaper(page, studio, coldEditorTitle)).distanceFromEnd)
    .toBeLessThanOrEqual(1);

  return { board, content };
}

test("[EDIT-DOC-11] 冷加载保留阅读位置，取消后重新编辑聚焦正文", async ({
  page,
  studio,
}, testInfo) => {
  const hold = studio.edition === "ii" ? await holdDocumentEditorChunk(page, studio) : undefined;
  try {
    const { content } = await openColdEditorReader(page, studio);
    const before = await readDocumentPaper(page, studio, coldEditorTitle);
    await screenshot(page, testInfo, "reader-before-editor");
    await button(page, "编辑文档").click();

    if (hold) {
      await hold.started;
      await expect(page.getByText("正在打开文档编辑器", { exact: true })).toBeVisible();
      await expect(content).toContainText("编辑状态验收段落");
      await expect(composer(page)).toHaveCount(0);
      expect(await readDocumentPaper(page, studio, coldEditorTitle)).toEqual(before);
      await screenshot(page, testInfo, "editor-module-pending");

      await button(page, "取消打开文档编辑器").click();
      await expect(page.getByText("正在打开文档编辑器", { exact: true })).toBeHidden();
      expect(await readDocumentPaper(page, studio, coldEditorTitle)).toEqual(before);
      hold.release();
      await expect(composer(page)).toHaveCount(0);
      await button(page, "编辑文档").click();
    }

    await expect(composer(page)).toBeFocused();
    await expect(composer(page)).toContainText("编辑状态验收段落");
    const after = await readDocumentPaper(page, studio, coldEditorTitle);
    expect(after).toMatchObject({ width: before.width, height: before.height });
    if (studio.edition === "ii") {
      expect(before.visibleBlock).toBeTruthy();
      expect(after.caretBlock).toBe(before.visibleBlock);
      expect(after.scrollTop).toBeGreaterThan(0);
    }
    await screenshot(page, testInfo, "editor-module-ready");
    await observe(testInfo, "cold-editor-paper", { before, after });
    await enterReading(page);
    await button(page, "返回画板").click();
    await expect(content).toContainText("编辑状态验收段落");
  } finally {
    hold?.release();
  }
});

test("[EDIT-DOC-12] 编辑器加载失败后仍可阅读并返回画板", async ({ page, studio }, testInfo) => {
  await page.setViewportSize({ width: 400, height: 720 });
  const hold = studio.edition === "ii" ? await holdDocumentEditorChunk(page, studio) : undefined;
  try {
    const { board, content } = await openColdEditorReader(page, studio);
    const revision = (await studio.readBoard(board)).revision;
    const before = await readDocumentPaper(page, studio, coldEditorTitle);
    await button(page, "编辑文档").click();
    if (hold) {
      await hold.started;
      await expect(page.getByText("正在打开文档编辑器", { exact: true })).toBeVisible();
      await expect(content).toContainText("编辑状态验收段落 34");
      expect(before.horizontalOverflow).toBe(0);
      expect(await readDocumentPaper(page, studio, coldEditorTitle)).toEqual(before);
      await screenshot(page, testInfo, "editor-module-pending-narrow");
      hold.release(true);
      await expect(page.getByText("编辑器打开失败，可继续阅读", { exact: true })).toBeVisible();
      await expect(button(page, "编辑文档")).toBeDisabled();
      await expect(composer(page)).toHaveCount(0);
      await expect(content).toContainText("编辑状态验收段落");
      expect(await readDocumentPaper(page, studio, coldEditorTitle)).toEqual(before);
    } else {
      await expect(composer(page)).toBeFocused();
      await enterReading(page);
    }

    await screenshot(page, testInfo, "reader-after-editor-open");
    await button(page, "返回画板").click();
    await expect(content).toContainText("编辑状态验收段落");
    expect((await studio.readBoard(board)).revision).toBe(revision);
  } finally {
    hold?.release();
  }
});

test("[EDIT-DOC-01] 从欢迎区放置文档并写回标题和正文", async ({ page, studio }, testInfo) => {
  const [board] = await studio.seedBoards([{ title: "创建文档的测试板" }]);
  await page.goto(board.url);
  const beforePlacement = (await studio.readBoard(board)).revision;
  await button(page, "添加文档").click();
  await viewport(page, studio, board).click({ position: { x: 410, y: 175 } });
  await waitForVersion(studio, board, beforePlacement);
  await expect(button(page, "移动文档")).toBeVisible();
  await expect(reader(page, studio, "文档")).toBeVisible();
  await screenshot(page, testInfo, "document-card-created");

  const beforeLock = (await studio.readBoard(board)).revision;
  await button(page, "锁定元素").click();
  await waitForVersion(studio, board, beforeLock);
  await expect(button(page, "移动文档")).toBeDisabled();
  const beforeEdit = (await studio.readBoard(board)).revision;
  await beginEditing(page);
  await documentTitle(page).fill("发布文档");
  await composer(page).click();
  await page.keyboard.insertText("发布流程正文已写回。");
  await expect(composer(page)).toContainText("发布流程正文已写回。");
  await waitForVersion(studio, board, beforeEdit);

  await composer(page).press("End");
  await page.keyboard.insertText("临时输入");
  await expect(composer(page)).toContainText("临时输入");
  await composer(page).press("Control+z");
  await expect(composer(page)).not.toContainText("临时输入");
  await expect(composer(page)).toContainText("发布流程正文已写回。");
  await screenshot(page, testInfo, "document-writing-and-local-undo");

  await enterReading(page);
  await expect(reader(page, studio, "发布文档")).toContainText("发布流程正文已写回。");
  await button(page, "返回画板").click();
  await studio.restart();
  await page.goto(board.url);
  await expect(documentTitle(page)).toHaveText("发布文档");
  await expect(reader(page, studio, "发布文档")).toContainText("发布流程正文已写回。");
  await expect(reader(page, studio, "发布文档")).not.toContainText("临时输入");
  await observe(testInfo, "document-create-and-persist", {
    created: true,
    bodyUndo: true,
    lockedGeometryAllowedBody: true,
    reopened: true,
  });
  await screenshot(page, testInfo, "document-card-after-restart");
});

test("[EDIT-DOC-02] 展开阅读后目录与查找定位真实文档段落", async ({ page, studio }, testInfo) => {
  const title = "项目章节";
  await loadDocument(page, studio, title, [
    titleBlock("opening", "开篇章节"),
    paragraph("opening-match", "关键标记 出现在开篇。"),
    ...Array.from({ length: 17 }, (_, index) =>
      paragraph("detail-" + index, "供滚动验证的第 " + (index + 1) + " 段。"),
    ),
    titleBlock("ending", "尾章定位", 2),
    paragraph("ending-match", "关键标记 出现在尾章。"),
  ]);
  await button(page, "展开文档").click();
  await expect(button(page, "返回画板")).toBeVisible();
  const nav = page.getByRole("navigation", { name: "文档目录", exact: true });
  if (!(await nav.isVisible())) {
    await button(page, "切换文档目录").click();
  }
  await nav.getByRole("button", { name: "尾章定位", exact: true }).click();
  const ending = reader(page, studio, title).getByRole("heading", {
    name: "尾章定位",
    exact: true,
  });
  await expect(ending).toBeInViewport();

  const search = page.getByLabel("文档内查找", { exact: true });
  await search.fill("关键标记");
  await expect(page.getByText("1 / 2 处", { exact: true })).toBeVisible();
  await button(page, "下一个匹配").click();
  await expect(page.getByText("2 / 2 处", { exact: true })).toBeVisible();
  await expect(ending).toBeInViewport();
  await screenshot(page, testInfo, "document-outline-and-second-match");
  await button(page, "上一个匹配").click();
  await expect(page.getByText("1 / 2 处", { exact: true })).toBeVisible();
  await button(page, "清除文档查找").click();
  await expect(search).toHaveValue("");
  await button(page, "返回画板").click();
  await expect(button(page, "返回画板")).toHaveCount(0);
  await expect(reader(page, studio, title)).toBeVisible();
  await observe(testInfo, "document-readable-navigation", {
    matches: 2,
    outlineJump: true,
    returned: true,
  });
});

const bodyFormats = [
  ["标题占位", "一级标题", "架构标题"],
  ["数字占位", "有序列表", "数字条目"],
  ["项目占位", "无序列表", "项目条目"],
  ["检查占位", "检查清单", "要检查的条目"],
  ["引用占位", "引用", "引用说明"],
];

async function chooseBlockFormat(page, marker, format) {
  await composer(page).getByText(marker, { exact: true }).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await chooseSlashFormat(page, format);
}

async function chooseSlashFormat(page, format) {
  await page.keyboard.type("/");

  await pickBlockFormat(page, format);
}

async function pickBlockFormat(page, format) {
  const menu = page.getByRole("listbox");
  await expect(menu).toBeVisible();
  await menu.getByRole("option", { name: new RegExp("^" + format + " ", "u") }).click();
  await expect(menu).toHaveCount(0);
}

async function addBlockFromToolbar(page, format) {
  await composer(page).getByText("普通段落保留。", { exact: true }).hover();
  await button(page, "添加块").click();
  await pickBlockFormat(page, format);
}

async function appendBlock(page, format) {
  await composer(page).press("Control+End");
  await page.keyboard.press("Enter");
  await chooseSlashFormat(page, format);
}

test("[EDIT-DOC-03] 从斜杠菜单写入常见 BlockNote 块并重新打开", async ({
  page,
  studio,
}, testInfo) => {
  const title = "文档块格式";
  const board = await loadDocument(page, studio, title, [
    paragraph("ordinary", "普通段落保留。"),
    ...bodyFormats.map(([marker], index) => paragraph("format-" + index, marker)),
  ]);
  let before = (await studio.readBoard(board)).revision;
  await beginEditing(page);
  for (const [marker, format, content] of bodyFormats) {
    await chooseBlockFormat(page, marker, format);
    await page.keyboard.insertText(content);
    await expect(composer(page)).toContainText(content);
    await waitForVersion(studio, board, before);
    before = (await studio.readBoard(board)).revision;
  }
  await addBlockFromToolbar(page, "表格");
  const cell = composer(page).getByRole("cell").first();
  await cell.click();
  await page.keyboard.insertText("表格写入");
  await expect(cell).toContainText("表格写入");
  await waitForVersion(studio, board, before);
  before = (await studio.readBoard(board)).revision;
  await addBlockFromToolbar(page, "分隔线");
  await waitForVersion(studio, board, before);
  before = (await studio.readBoard(board)).revision;
  await addBlockFromToolbar(page, "代码块");
  await page.keyboard.insertText("const value = 42;");
  await expect(composer(page)).toContainText("const value = 42;");
  await waitForVersion(studio, board, before);
  await screenshot(page, testInfo, "blocknote-typed-blocks");
  await enterReading(page);
  await studio.restart();
  await page.reload();
  const doc = reader(page, studio, title);
  await expect(doc.getByRole("heading", { name: "架构标题", exact: true })).toBeVisible();
  await expect(doc).toContainText("普通段落保留。");
  await expect(doc).toContainText("数字条目");
  await expect(doc).toContainText("项目条目");
  await expect(doc).toContainText("要检查的条目");
  await expect(doc).toContainText("引用说明");
  await expect(doc).toContainText("const value = 42;");
  await expect(doc.getByRole("cell", { name: "表格写入", exact: true })).toBeVisible();
  const saved = (await studio.readBoard(board)).objects.find(({ kind }) => kind === "document");
  expect(saved?.document?.blocks.map(({ type }) => type)).toEqual(
    expect.arrayContaining([
      "paragraph",
      "heading",
      "numberedListItem",
      "bulletListItem",
      "checkListItem",
      "quote",
      "table",
      "divider",
      "codeBlock",
    ]),
  );
  await observe(testInfo, "document-native-blocks", {
    composed: bodyFormats.length + 3,
    tableCell: true,
    reopened: true,
  });
  await screenshot(page, testInfo, "native-blocks-after-restart");
});

async function activateLinkEditor(page, text, checkLayout = false) {
  await composer(page).getByText(text, { exact: true }).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  const link = button(page, "添加链接");
  if (checkLayout) {
    const toolbar = page.getByRole("toolbar").filter({ has: link });
    await expect(toolbar).toHaveCSS("overflow-x", "visible");
    await expect(toolbar).toHaveCSS("overflow-y", "visible");
    await expect(toolbar).toHaveCSS("flex-wrap", "wrap");
    await expect(toolbar).toBeInViewport({ ratio: 0.99 });
    for (const action of await toolbar.getByRole("button").all()) {
      await expect(action).toBeInViewport({ ratio: 0.99 });
    }
  }

  await link.click();
  const address = page.getByRole("textbox", { name: "编辑链接地址", exact: true });
  await expect(address).toBeVisible();

  return address;
}

async function verifyNarrowFormattingToolbar(page, text) {
  const originalSize = page.viewportSize();
  await page.setViewportSize({ width: 420, height: 720 });
  try {
    const address = await activateLinkEditor(page, text, true);
    await address.press("Escape");
    await expect(address).toHaveCount(0);
  } finally {
    await page.setViewportSize(originalSize);
  }
}

test("[EDIT-DOC-04] 文档内取消链接弹窗、保存链接并上传图片", async ({ page, studio }, testInfo) => {
  const title = "链接和图片文档";
  const linkText = "链接正文说明";
  const board = await loadDocument(page, studio, title, [paragraph("link-content", linkText)]);
  const before = (await studio.readBoard(board)).revision;
  await beginEditing(page);

  let address = await activateLinkEditor(page, linkText, studio.edition === "ii");
  await address.press("Escape");
  await expect(address).toHaveCount(0);
  await expect(composer(page)).toBeVisible();
  await expect(composer(page).getByRole("link", { name: linkText, exact: true })).toHaveCount(0);
  await screenshot(page, testInfo, "link-cancel-retains-document-editor");
  if (studio.edition === "ii") {
    await verifyNarrowFormattingToolbar(page, linkText);
  }

  address = await activateLinkEditor(page, linkText);
  await address.fill(board.url);
  await address.press("Enter");
  await expect(composer(page).getByRole("link", { name: linkText, exact: true })).toHaveAttribute(
    "href",
    board.url,
  );
  await waitForVersion(studio, board, before);

  await appendBlock(page, "图片");
  const upload = page.getByRole("tabpanel", { name: "上传", exact: true });
  await chooseDocumentImage(page, () =>
    upload.getByRole("button", { name: /^(Choose File|选择文件)$/u }).click(),
  );
  await expect
    .poll(async () => {
      const saved = (await studio.readBoard(board)).objects.find(({ kind }) => kind === "document");

      return saved?.document?.blocks.some(
        ({ type, props }) => type === "image" && Boolean(props?.url),
      );
    })
    .toBe(true);
  await studio.restart();
  await page.reload();
  const doc = reader(page, studio, title);
  const image = doc.getByRole("img");
  await expect(image).toHaveCount(1);
  await expect(image).toBeVisible();
  await expect(image).toHaveJSProperty("complete", true);
  await expect(image).toHaveJSProperty("naturalWidth", 2);
  await expect(image).toHaveJSProperty("naturalHeight", 3);
  await expect(doc.getByRole("link", { name: linkText, exact: true })).toHaveAttribute(
    "href",
    board.url,
  );
  await observe(testInfo, "document-links-and-images", {
    linkCancelKeptEditing: true,
    linked: true,
    image: [2, 3],
  });
  await screenshot(page, testInfo, "document-link-and-image-after-restart");
});

async function downloadDocument(page, name, format) {
  await button(page, "导出文档").click();
  const option = page.getByRole("menuitem", { name, exact: true });
  const [download] = await Promise.all([page.waitForEvent("download"), option.click()]);

  return readDocumentDownload(download, format);
}

test("[EDIT-DOC-05] 对象内下载全文 HTML 与块 JSON", async ({ page, studio }, testInfo) => {
  const title = "当前文档下载";
  await loadDocument(page, studio, title, [
    titleBlock("export-title", "发布目标"),
    paragraph("export-body", "正文含 <普通> & 签名。"),
  ]);
  await button(page, "导出文档").click();
  const menu = page.getByRole("menu", { name: "文档导出格式", exact: true });
  await expect(menu).toBeVisible();
  await screenshot(page, testInfo, "document-export-menu");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(reader(page, studio, title)).toBeVisible();

  const html = await downloadDocument(page, "全文 HTML", "html");
  expect(html.filename).toBe(title + ".html");
  expect(html.text).toContain("发布目标");
  expect(html.text).toContain("&lt;普通&gt; &amp; 签名");
  const json = await downloadDocument(page, "块 JSON", "json");
  expect(json.filename).toBe(title + ".json");
  expect(JSON.parse(json.text)).toMatchObject({
    title,
    document: {
      schemaVersion: 1,
      blocks: [
        { id: "export-title", type: "heading", content: "发布目标" },
        { id: "export-body", type: "paragraph", content: "正文含 <普通> & 签名。" },
      ],
    },
  });

  if (studio.edition === "ii") {
    const markdown = await downloadDocument(page, "全文 Markdown", "md");
    expect(markdown.filename).toBe(title + ".md");
    expect(markdown.text).toContain("# " + title + "\n\n# 发布目标");
    expect(markdown.text).toContain("正文含 \\<普通\\> &amp; 签名。");
  }

  await observe(testInfo, "document-file-downloads", {
    html: true,
    json: true,
    originalText: true,
  });
});

test("[EDIT-DOC-06] 保存失败保留本地正文，拒绝丢失编辑并可重试", async ({
  page,
  studio,
}, testInfo) => {
  const title = "文档失败重试";
  const original = "原来已保存的段落";
  const board = await loadDocument(page, studio, title, [paragraph("paragraph", original)]);
  const before = (await studio.readBoard(board)).revision;
  await beginEditing(page);
  const firstFailure = await failNextDocumentSave(page, studio, board);
  await composer(page).getByText(original, { exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.insertText("，重试保留的正文。");
  const retry = button(page, "重试保存");
  await expect(retry).toBeVisible();
  expect(firstFailure.intercepted()).toBe(true);
  expect((await studio.readBoard(board)).revision).toBe(before);
  await expect(composer(page)).toContainText("重试保留的正文");

  const secondFailure = await failNextDocumentSave(page, studio, board);
  await button(page, "返回画板").click();
  await expect.poll(() => secondFailure.intercepted()).toBe(true);
  await expect(retry).toBeVisible();
  await expect(composer(page)).toBeVisible();
  await expect(composer(page)).toContainText("重试保留的正文");
  await screenshot(page, testInfo, "document-save-rejected-draft-kept");

  await retry.click();
  await waitForVersion(studio, board, before);
  await enterReading(page);
  await studio.restart();
  await page.reload();
  await expect(reader(page, studio, title)).toContainText("重试保留的正文");
  await observe(testInfo, "document-save-retry", {
    firstRejected: true,
    blockedExit: true,
    retryPersisted: true,
  });
  await screenshot(page, testInfo, "document-save-recovered-after-restart");
});

test("[EDIT-DOC-07] 只读访客可以阅读、展开和查找文档", async ({
  page,
  browser,
  studio,
}, testInfo) => {
  const title = "文档只读材料";
  const board = await studio.seedBasicBoard({
    title: "待只读浏览的白板",
    objects: [
      {
        id: "read-only-document",
        kind: "document",
        label: title,
        x: 70,
        y: 70,
        width: 980,
        height: 530,
        document: {
          schemaVersion: 1,
          blocks: [paragraph("preserved", "只读外链仍可阅读的正文。")],
        },
      },
    ],
  });
  const probe = await workbenchLinkProbe({ page, browser, studio });
  try {
    await page.goto(studio.url);
    await button(page, "打开白板：" + board.title).hover();
    await button(page, "管理作品：" + board.title).click();
    await page.getByRole("menuitem", { name: "复制链接", exact: true }).click();
    await expect(page.getByText("链接已复制。", { exact: true })).toBeVisible();
    await probe.checkpoint(board);
    const guest = await probe.openGuest(board);
    await guest.getByRole("textbox", { name: /你的名字/u }).fill("文档只读查看者");
    await button(guest, "打开白板").click();
    await expect(guest.getByText("只读", { exact: true })).toBeVisible();

    const doc = reader(guest, studio, title);
    await expect(doc).toContainText("只读外链仍可阅读的正文。");
    await documentTitle(guest).click();
    await expect(button(guest, "编辑文档")).toHaveCount(0);
    await button(guest, "展开文档").click();
    await guest.setViewportSize({ width: 720, height: 620 });
    await guest.emulateMedia({ colorScheme: "light" });
    await guest.getByLabel("文档内查找", { exact: true }).fill("只读外链");
    await expect(guest.getByText("1 / 1 处", { exact: true })).toBeVisible();
    const titleField = guest.getByRole("textbox", { name: "文档标题", exact: true });
    if (await titleField.count()) {
      await expect(titleField).not.toBeEditable();
    } else {
      await expect(documentTitle(guest)).toHaveText(title);
    }
    await expect(button(guest, "编辑文档")).toHaveCount(0);
    await expect(composer(guest)).toHaveCount(0);
    await screenshot(guest, testInfo, "document-read-only-expanded");
    await button(guest, "返回画板").click();
    await expect(doc).toBeVisible();
    await observe(testInfo, "document-read-only", {
      read: true,
      expanded: true,
      searchable: true,
      editable: false,
    });
  } finally {
    await probe.close();
  }
});

async function recoverDocumentDraft(page, studio, title, testInfo) {
  if (studio.edition === "initial") {
    await documentTitle(page).click();
    await beginEditing(page);
    await page
      .getByRole("region", { name: "文档：" + title, exact: true })
      .getByRole("button", { name: /^比较.*草稿$/u })
      .click();
    const comparison = page.getByRole("dialog", { name: "比较本机草稿", exact: true });
    await expect(comparison).toContainText("重开的本机草稿");
    await screenshot(page, testInfo, "document-local-draft-comparison");
    await button(page, "恢复为本视图草稿").click();
    await button(page, "保存已比较的草稿").click();

    return;
  }

  await button(page, "本机草稿").click();
  const list = page.getByRole("list", { name: "上次未确认的草稿", exact: true });
  await list.getByRole("button").click();
  const comparison = page.getByRole("dialog", { name: "本机草稿", exact: true });
  await expect(comparison).toContainText("重开的本机草稿");
  await screenshot(page, testInfo, "document-local-draft-comparison");
  await button(page, "应用已比较的草稿").click();
}

test("[EDIT-DOC-08] 页面重开可比较并主动恢复文档本机草稿", async ({ page, studio }, testInfo) => {
  const title = "文档本机草稿恢复";
  const original = "已经确认的正文";
  const board = await loadDocument(page, studio, title, [paragraph("paragraph", original)]);
  const before = (await studio.readBoard(board)).revision;
  await beginEditing(page);
  const failure = await failNextDocumentSave(page, studio, board);
  await composer(page).getByText(original, { exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.insertText("，重开的本机草稿。");
  await expect(button(page, "重试保存")).toBeVisible();
  expect(failure.intercepted()).toBe(true);
  expect((await studio.readBoard(board)).revision).toBe(before);

  await page.reload();
  const doc = reader(page, studio, title);
  await expect(doc).toContainText(original);
  await expect(doc).not.toContainText("重开的本机草稿");
  await recoverDocumentDraft(page, studio, title, testInfo);
  await waitForVersion(studio, board, before);
  await page.reload();
  await expect(doc).toContainText("重开的本机草稿");
  await observe(testInfo, "document-draft-reopen", {
    compared: true,
    explicitRecovery: true,
    persisted: true,
  });
  await screenshot(page, testInfo, "document-local-draft-applied");
});

const noteDocumentTitle = "需要核对的文档";
const noteTodoTitle = "需要核对的清单";
const noteParagraph = "待复核的正文段落";
const noteTask = "验证第一项待办";

async function openNoteSample(page, studio) {
  const board = await studio.seedBasicBoard({
    title: "文档与待办备注模式测试板",
    objects: [
      {
        id: "note-document",
        kind: "document",
        label: noteDocumentTitle,
        x: 85,
        y: 125,
        width: 540,
        height: 410,
        document: {
          schemaVersion: 1,
          blocks: [
            paragraph("note-original", noteParagraph),
            ...Array.from({ length: 12 }, (_, index) =>
              paragraph("note-paragraph-" + index, "供备注模式滚动查看的段落。" + (index + 1)),
            ),
          ],
        },
      },
      {
        id: "note-todo",
        kind: "todo",
        label: noteTodoTitle,
        x: 675,
        y: 125,
        width: 420,
        height: 400,
        items: [
          { id: "first-task", text: noteTask, checked: false },
          { id: "second-task", text: "检查发布记录", checked: true },
        ],
      },
    ],
  });
  await page.goto(board.url);
  await expect(reader(page, studio, noteDocumentTitle)).toContainText(noteParagraph);

  return board;
}

async function useNoteZoom(page, percent, preset, steps) {
  const zoom = button(page, "缩放菜单");
  const menu = page.getByRole("menu", { name: "缩放与视图", exact: true });
  await zoom.click();
  await menu.getByRole("menuitem", { name: preset + "%", exact: true }).click();
  if (steps > 0) {
    await zoom.click();
    for (let step = 0; step < steps; step++) {
      await button(menu, "放大").click();
    }
    await page.keyboard.press("Escape");
  }
  await expect(zoom).toHaveText(percent + "%");
}

async function cancelTargetNote(page) {
  const input = page.getByRole("textbox", { name: "批注内容", exact: true });
  await expect(input).toBeFocused();
  await input.press("Escape");
  await expect(input).toHaveCount(0);
}

test("[EDIT-DOC-09] 备注模式保留文档与待办布局，并禁用写入", async ({ page, studio }, testInfo) => {
  const board = await openNoteSample(page, studio);
  const revision = (await studio.readBoard(board)).revision;
  const notes = button(page, "备注");
  const documentBody = reader(page, studio, noteDocumentTitle);
  const todo = page.getByRole("region", { name: noteTodoTitle, exact: true });
  const moveTaskList = button(todo, "移动任务清单");
  const expandTaskList = button(todo, "展开任务清单");
  for (const [zoom, preset, steps] of [
    [36, 25, 2],
    [60, 50, 1],
    [100, 100, 0],
  ]) {
    await useNoteZoom(page, zoom, preset, steps);
    const bodyBefore = await documentBody.boundingBox();
    const todoBefore = await todo.boundingBox();
    await expect(expandTaskList).toBeEnabled();
    const expansionBefore = await expandTaskList.boundingBox();
    await notes.click();
    await expect(notes).toHaveAttribute("aria-pressed", "true");
    expect(await documentBody.boundingBox()).toEqual(bodyBefore);
    expect(await todo.boundingBox()).toEqual(todoBefore);
    if (studio.edition === "ii") {
      await expect(moveTaskList).toBeDisabled();
      await expect(expandTaskList).toBeDisabled();
      expect(await expandTaskList.boundingBox()).toEqual(expansionBefore);
    } else {
      await expect(expandTaskList).toHaveCount(0);
    }
    if (zoom === 36 || zoom === 60) {
      await screenshot(page, testInfo, "note-mode-cards-" + zoom);
    }
    await notes.click();
    await expect(notes).toHaveAttribute("aria-pressed", "false");
    await expect(expandTaskList).toBeEnabled();
  }

  await todo.getByText(noteTodoTitle, { exact: true }).click();
  const complete = todo.getByRole("checkbox", { name: "完成任务：" + noteTask, exact: true });
  const editTask = button(todo, "编辑任务：" + noteTask);
  await expect(complete).not.toBeChecked();
  await expect(editTask).toBeEnabled();
  const before = await editTask.boundingBox();
  await screenshot(page, testInfo, "note-mode-todo-before");
  await viewport(page, studio, board).press("9");
  await expect(notes).toHaveAttribute("aria-pressed", "true");
  const annotateTask = button(todo, "备注任务：" + noteTask);
  await expect(annotateTask).toBeEnabled();
  if (studio.edition === "ii") {
    await expect(complete).toBeDisabled();
    expect(await annotateTask.boundingBox()).toEqual(before);
    await expect(button(page, "编辑文档")).toBeDisabled();
  } else {
    await expect(complete).toHaveCount(0);
  }
  await screenshot(page, testInfo, "note-mode-todo-during");
  await annotateTask.press("Enter");
  await cancelTargetNote(page);

  if ((await notes.getAttribute("aria-pressed")) === "false") {
    await notes.click();
  }
  await documentBody.getByText(noteParagraph, { exact: true }).click();
  await cancelTargetNote(page);
  if ((await notes.getAttribute("aria-pressed")) === "true") {
    await notes.click();
  }
  await todo.getByText(noteTodoTitle, { exact: true }).click();
  await expect(complete).toBeEnabled();
  await expect(complete).not.toBeChecked();
  expect((await studio.readBoard(board)).revision).toBe(revision);
  await observe(testInfo, "native-annotation-layout", {
    zoom: [36, 60, 100],
    stableCardFrames: true,
    stableTodoControls: studio.edition === "ii",
    taskAndParagraphTargets: true,
    persistedRevisionUnchanged: true,
  });
});

test("[EDIT-DOC-10] 展开文档在备注模式保留未提交的正文", async ({ page, studio }, testInfo) => {
  const board = await openNoteSample(page, studio);
  const current = (await studio.readBoard(board)).revision;
  const notes = button(page, "备注");
  await documentTitle(page).click();
  await beginEditing(page);
  const failure = await failNextDocumentSave(page, studio, board);
  const source = "未提交草稿：";
  await composer(page).getByText(noteParagraph, { exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(source);
  await page.keyboard.press("9");
  await expect(notes).toHaveAttribute("aria-pressed", "false");
  await expect(composer(page)).toContainText(source + "9");
  const retry = button(page, "重试保存");
  await expect(retry).toBeVisible();
  expect(failure.intercepted()).toBe(true);

  await notes.click();
  await expect(notes).toHaveAttribute("aria-pressed", "true");
  await expect(button(page, "返回画板")).toBeVisible();
  await expect(documentTitle(page)).not.toBeEditable();
  await expect(reader(page, studio, noteDocumentTitle)).toContainText(source + "9");
  if (studio.edition === "ii") {
    await expect(composer(page)).toBeVisible();
    await expect(composer(page)).toHaveAttribute("contenteditable", "false");
    await expect(retry).toBeDisabled();
  } else {
    await expect(composer(page)).toHaveCount(0);
  }
  expect((await studio.readBoard(board)).revision).toBe(current);
  await screenshot(page, testInfo, "note-mode-keeps-document-draft");

  if (studio.edition === "ii") {
    await composer(page).press("Escape");
  } else {
    await notes.click();
  }
  await expect(notes).toHaveAttribute("aria-pressed", "false");
  if (studio.edition === "initial") {
    await beginEditing(page);
  }
  await expect(composer(page)).toBeEditable();
  await expect(composer(page)).toContainText(source + "9");
  await expect(retry).toBeEnabled();
  await retry.click();
  await waitForVersion(studio, board, current);
  await page.reload();
  await expect(reader(page, studio, noteDocumentTitle)).toContainText(source + "9");
  await observe(testInfo, "native-annotation-document-draft", {
    editorKeptMounted: studio.edition === "ii",
    shortcutStayedInEditor: true,
    titleWritePaused: true,
    draftPreservedAndSaved: true,
  });
});
