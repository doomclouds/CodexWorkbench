import {
  embedFrame,
  expect,
  holdNextInlineTextWrite,
  mediaDisplaySize,
  mediaPlaying,
  observe,
  readCanvas,
  screenshot,
  test,
  workbenchLinkProbe,
} from "../support/studio.mjs";

test.use({ trace: "off", screenshot: "off", video: "off" });

const editorName = "受邀协作者";
const imageName = "协作图片";
const videoName = "协作视频";
const linkName = "协作网页";
const originalText = "共同起稿";

function button(scope, name) {
  return scope.getByRole("button", { name, exact: true });
}

function textbox(scope, name) {
  return scope.getByRole("textbox", { name, exact: true });
}

function visibleText(scope, text) {
  return scope.getByText(text, { exact: true });
}

function viewport(page, studio, board) {
  return page.getByLabel(studio.edition === "initial" ? "白板画布" : board.title, { exact: true });
}

function object(kind, id, label, x, y, width = 205, height = 130) {
  return { kind, id, label, x, y, width, height };
}

async function withEditor({ page, browser, studio }, seed, run) {
  const board = await studio.seedBasicBoard(seed);
  const probe = await workbenchLinkProbe({ page, browser, studio });
  try {
    await page.goto(board.url);
    await expect(viewport(page, studio, board)).toBeVisible();
    await button(page, "分享").click();
    await button(page, "复制可编辑链接").click();
    await expect.poll(probe.copyCount).toBe(1);
    expect(await probe.checkpoint(board, "editor")).toMatchObject({
      role: "editor",
      scope: "local",
    });
    await page.keyboard.press("Escape");
    const guest = await probe.openGuest(board, { role: "editor" });
    await guest.getByRole("textbox", { name: /你的名字/u }).fill(editorName);
    await button(guest, "打开白板").click();
    await expect(viewport(guest, studio, board)).toBeVisible();
    await run({ page, guest, studio, board });
  } finally {
    await probe.close();
  }
}

async function persisted(studio, board, wanted) {
  await expect
    .poll(async () => (await studio.readBoard(board)).objects)
    .toEqual(expect.arrayContaining([expect.objectContaining(wanted)]));
}

async function replaceLabel(view, from, to, mode = "double-click") {
  if (mode === "section") {
    await visibleText(view, from).click();
    await button(view, "更多操作").click();
    await view.getByRole("menuitem", { name: /重命名分区/u }).click();
  } else {
    await visibleText(view, from).dblclick();
  }
  const input = textbox(view, "编辑文字");
  await expect(input).toBeFocused();
  await input.fill(to);
  if (mode === "section") {
    await input.press("Enter");
  } else {
    await view
      .getByRole("toolbar", { name: "白板工具" })
      .getByRole("button", { name: "选择", exact: true })
      .click();
  }
  await expect(input).toBeHidden();
}

const inlineObjects = [
  object("text", "team-text", originalText, 115, 125),
  object("shape", "team-shape", "会签节点", 405, 125),
  object("note", "team-note", "会签便签", 695, 125),
  object("section", "team-section", "会签分区", 115, 359, 480, 221),
  object("sticker", "team-sticker", "旧字符贴纸", 695, 359),
];

test("[COLLAB-CONTENT-01] 编辑访客和房主实时交换文字、形状、便签、分区和旧字符贴纸", async ({
  page: owner,
  browser,
  studio: edition,
}, testInfo) => {
  await withEditor(
    { page: owner, browser, studio: edition },
    { title: "行内协作验收", objects: inlineObjects },
    async ({ page, guest, studio, board }) => {
      const updates = [
        {
          kind: "text",
          id: "team-text",
          from: originalText,
          to: "访客已写入正文",
          actor: guest,
          peer: page,
        },
        {
          kind: "shape",
          id: "team-shape",
          from: "会签节点",
          to: "房主已更新节点",
          actor: page,
          peer: guest,
        },
        {
          kind: "note",
          id: "team-note",
          from: "会签便签",
          to: "访客已更新便签",
          actor: guest,
          peer: page,
        },
        {
          kind: "section",
          id: "team-section",
          from: "会签分区",
          to: "房主已更新分区",
          actor: page,
          peer: guest,
        },
        {
          kind: "sticker",
          id: "team-sticker",
          from: "旧字符贴纸",
          to: "访客已更新贴纸",
          actor: guest,
          peer: page,
        },
      ];

      for (const { kind, id, from, to, actor, peer } of updates) {
        await replaceLabel(actor, from, to, kind === "section" ? "section" : undefined);
        await expect(visibleText(peer, to)).toBeVisible();
        await persisted(studio, board, { id, text: to });
      }
      await screenshot(page, testInfo, "owner-inline-updates");
      await guest.reload();
      for (const { to } of updates) {
        await expect(visibleText(guest, to)).toBeVisible();
      }
      await screenshot(guest, testInfo, "guest-inline-updates-reopened");
      await observe(testInfo, "inline-content", {
        kinds: updates.map(({ kind }) => kind),
        reopened: true,
      });
    },
  );
});

const documentTitle = "协作纪要";

function reader(page, studio) {
  return page.getByLabel(studio.edition === "initial" ? "文档正文：" + documentTitle : "文档正文", {
    exact: true,
  });
}

async function appendDocument(page, value) {
  await button(page, "编辑文档").click();
  const composer = textbox(page, "");
  await expect(composer).toBeVisible();
  await composer.press("Control+End");
  await composer.press("Enter");
  await page.keyboard.insertText(value);
  await expect(composer).toContainText(value);
  await button(page, "阅读文档").click();
  await expect(composer).toHaveCount(0);
}

test("[COLLAB-CONTENT-02] 两端交替编辑文档，阅读中的另一端实时看到正文", async ({
  page: owner,
  browser,
  studio: edition,
}, testInfo) => {
  const seed = {
    title: "文档协作验收",
    objects: [
      {
        ...object("document", "team-document", documentTitle, 100, 85, 870, 560),
        document: {
          schemaVersion: 1,
          blocks: [{ id: "opening", type: "paragraph", content: "讨论纪要起稿" }],
        },
      },
    ],
  };
  await withEditor(
    { page: owner, browser, studio: edition },
    seed,
    async ({ page, guest, studio }) => {
      await button(page, "展开文档").click();
      await expect(reader(page, studio)).toContainText("讨论纪要起稿");
      await appendDocument(guest, "访客补充跨端同步证据");
      await expect(reader(page, studio)).toContainText("访客补充跨端同步证据");
      await button(page, "返回画板").click();
      await appendDocument(page, "房主追加已复核结论");
      await expect(reader(guest, studio)).toContainText("房主追加已复核结论");
      await screenshot(guest, testInfo, "guest-document-live");
      await page.reload();
      await expect(reader(page, studio)).toContainText("访客补充跨端同步证据");
      await expect(reader(page, studio)).toContainText("房主追加已复核结论");
      await observe(testInfo, "document-content", {
        guestAppended: true,
        ownerAppended: true,
        reopened: true,
      });
    },
  );
});

const todoTitle = "协作任务";

async function expandTodo(page) {
  const card = page.getByRole("region", { name: todoTitle, exact: true });
  await button(card, "展开任务清单").click();
  const list = page.getByRole("list", { name: "任务", exact: true });
  await expect(list).toBeVisible();
  return list;
}

test("[COLLAB-CONTENT-03] 两端实时看到待办新增、改名和完成状态", async ({
  page: owner,
  browser,
  studio: edition,
}, testInfo) => {
  const seed = {
    title: "待办协作验收",
    objects: [
      {
        ...object("todo", "team-todo", todoTitle, 140, 115, 435, 420),
        items: [{ id: "review", text: "待会签记录", checked: false }],
      },
    ],
  };
  await withEditor(
    { page: owner, browser, studio: edition },
    seed,
    async ({ page, guest, studio, board }) => {
      const ownerList = await expandTodo(page);
      const guestList = await expandTodo(guest);
      await guestList.getByRole("checkbox", { name: "完成任务：待会签记录" }).check();
      await expect(ownerList.getByRole("checkbox", { name: "完成任务：待会签记录" })).toBeChecked();
      await button(ownerList, "编辑任务：待会签记录").click();
      const edit = textbox(ownerList, "任务文字");
      await edit.fill("已会签记录");
      await edit.press("Enter");
      await expect(guestList.getByRole("checkbox", { name: "完成任务：已会签记录" })).toBeChecked();
      const add = button(guest, "添加任务");
      if (await add.isVisible()) {
        await add.click();
      }
      const create = textbox(guest, "新增任务");
      await create.fill("新增待核验条目");
      await create.press("Enter");
      await expect(
        ownerList.getByRole("checkbox", { name: "完成任务：新增待核验条目" }),
      ).not.toBeChecked();
      await persisted(studio, board, {
        id: "team-todo",
        items: expect.arrayContaining([
          expect.objectContaining({ id: "review", text: "已会签记录", checked: true }),
          expect.objectContaining({ text: "新增待核验条目", checked: false }),
        ]),
      });
      await screenshot(page, testInfo, "owner-todo-live");
      await guest.reload();
      const reopened = await expandTodo(guest);
      await expect(reopened.getByRole("checkbox", { name: "完成任务：已会签记录" })).toBeChecked();
      await expect(
        reopened.getByRole("checkbox", { name: "完成任务：新增待核验条目" }),
      ).not.toBeChecked();
      await observe(testInfo, "todo-content", {
        added: true,
        renamed: true,
        checked: true,
        reopened: true,
      });
    },
  );
});

function grid(page) {
  return page.getByRole("table");
}

async function changeCell(page, row, column, from, to) {
  await visibleText(grid(page), from).dblclick();
  const input = textbox(page, "表格第" + row + "行第" + column + "列");
  await expect(input).toBeFocused();
  await input.fill(to);
  await input.press("Enter");
}

test("[COLLAB-CONTENT-04] 表格单元格和新增行实时同步并在重新打开后保留", async ({
  page: owner,
  browser,
  studio: edition,
}, testInfo) => {
  const seed = {
    title: "表格协作验收",
    objects: [
      {
        ...object("table", "team-table", "会签表", 125, 125, 700, 295),
        rows: [
          ["记录", "状态"],
          ["预算待核对", "初步"],
        ],
        columnWidths: [320, 380],
        head: true,
      },
    ],
  };
  await withEditor({ page: owner, browser, studio: edition }, seed, async ({ page, guest }) => {
    await expect(grid(page)).toBeVisible();
    await changeCell(guest, 2, 1, "预算待核对", "访客复核预算");
    await expect(visibleText(grid(page), "访客复核预算")).toBeVisible();
    await changeCell(page, 2, 2, "初步", "房主会签完成");
    await expect(visibleText(grid(guest), "房主会签完成")).toBeVisible();
    await visibleText(grid(page), "访客复核预算").click();
    await button(page, "添加表格行").click();
    await expect(grid(guest).getByRole("row")).toHaveCount(3);
    await screenshot(guest, testInfo, "guest-table-live");
    await guest.reload();
    await expect(grid(guest).getByRole("row")).toHaveCount(3);
    await expect(visibleText(grid(guest), "访客复核预算")).toBeVisible();
    await expect(visibleText(grid(guest), "房主会签完成")).toBeVisible();
    await observe(testInfo, "table-content", { crossCellEdits: 2, rows: 3, reopened: true });
  });
});

const embedTitle = "协作互动图解";
const embedSource = `<!doctype html><meta charset="utf-8">
<h1>协作投票</h1><button type="button" id="vote">投一票</button><p id="count"></p>
<script>
const show = (value) => { document.getElementById('count').textContent = '票数：' + (value?.votes ?? 0); };
show(studioEmbed.load()); studioEmbed.onLoad(show);
document.getElementById('vote').addEventListener('click', () => {
  const next = { votes: (studioEmbed.load()?.votes ?? 0) + 1 };
  studioEmbed.save(next); show(next);
});
</script>`;

async function selectObject(page, studio, id) {
  await expect
    .poll(async () =>
      (await readCanvas(page, studio)).objects.some((candidate) => candidate.id === id),
    )
    .toBe(true);
  const { objects } = await readCanvas(page, studio);
  const target = objects.find((candidate) => candidate.id === id);
  const bounds = target.titleBox ?? target.box;
  await page.mouse.click(
    bounds.x + Math.min(24, bounds.width / 2),
    bounds.y + Math.min(9, bounds.height / 2),
  );
}

test("[COLLAB-CONTENT-05] HTML 交互状态和源码在不同会话实时同步", async ({
  page: owner,
  browser,
  studio: edition,
}, testInfo) => {
  const seed = {
    title: "图解协作验收",
    objects: [
      { ...object("html", "team-html", embedTitle, 180, 135, 620, 365), html: embedSource },
    ],
  };
  await withEditor(
    { page: owner, browser, studio: edition },
    seed,
    async ({ page, guest, studio, board }) => {
      const owner = embedFrame(page, embedTitle);
      const peer = embedFrame(guest, embedTitle);
      await selectObject(guest, studio, "team-html");
      await button(peer, "投一票").click();
      await expect(visibleText(owner, "票数：1")).toBeVisible();
      await selectObject(page, studio, "team-html");
      await button(owner, "投一票").click();
      await expect(visibleText(peer, "票数：2")).toBeVisible();
      await persisted(studio, board, { id: "team-html", state: { votes: 2 } });
      await selectObject(guest, studio, "team-html");
      await button(guest, "编辑 HTML 源码").click();
      const edit = guest.getByRole("dialog", { name: "编辑 HTML 源码", exact: true });
      const updated = embedSource.replace("协作投票", "实时变更的投票图解");
      await textbox(edit, "HTML 源码").fill(updated);
      await button(edit, "保存源码").click();
      await expect(owner.getByRole("heading", { name: "实时变更的投票图解" })).toBeVisible();
      await persisted(studio, board, { id: "team-html", html: updated });
      await screenshot(page, testInfo, "owner-embed-live");
      await guest.reload();
      await expect(peer.getByRole("heading", { name: "实时变更的投票图解" })).toBeVisible();
      await observe(testInfo, "embed-content", {
        stateUpdates: 2,
        sourceUpdated: true,
        reopened: true,
      });
    },
  );
});

test("[COLLAB-CONTENT-06] 远程会话看到链接、图片裁剪与可播放视频", async ({
  page: owner,
  browser,
  studio: edition,
}, testInfo) => {
  const seed = {
    title: "媒体协作验收",
    objects: [
      {
        ...object("image", "team-image", imageName, 115, 150, 240, 210),
        mediaFixture: "board-svg",
      },
      {
        ...object("video", "team-video", videoName, 420, 150, 270, 210),
        mediaFixture: "blue-frame",
      },
    ],
  };
  await withEditor(
    { page: owner, browser, studio: edition },
    seed,
    async ({ page, guest, studio, board }) => {
      await expect
        .poll(() => mediaDisplaySize(viewport(guest, studio, board)))
        .toMatchObject({
          naturalWidth: 16,
          naturalHeight: 16,
        });
      const canvas = viewport(guest, studio, board);
      const video = await mediaDisplaySize(canvas);
      await canvas.click({
        position: { x: video.x + video.width / 2, y: video.y + video.height / 2 },
      });
      await expect.poll(() => mediaPlaying(canvas)).toBe(true);

      const image = guest.getByRole("img", { name: imageName, exact: true });
      await expect(image).toBeVisible();
      const originalWidth = (await mediaDisplaySize(image)).width;
      await selectObject(page, studio, "team-image");
      await button(page, "裁剪图片").click();
      const crop = page.getByRole("dialog", { name: "裁剪图片", exact: true });
      await crop.getByRole("slider", { name: "裁剪缩放" }).press("ArrowRight");
      await button(crop, "保存裁剪").click();
      await expect(crop).toBeHidden();
      await persisted(studio, board, { id: "team-image", crop: expect.any(Object) });
      await expect
        .poll(async () => (await mediaDisplaySize(image)).width)
        .toBeGreaterThan(originalWidth);

      await button(guest.getByRole("toolbar", { name: "白板工具" }), "形状").click();
      await button(guest, "链接").click();
      const link = guest.getByRole("dialog", {
        name: studio.edition === "initial" ? "添加链接" : "链接",
        exact: true,
      });
      await textbox(link, "名称").fill(linkName);
      await textbox(link, "网页地址").fill(studio.url);
      await button(link, "保存到白板").click();
      await expect(page.getByRole("link", { name: "打开链接", exact: true })).toHaveAttribute(
        "href",
        studio.url,
      );
      await visibleText(page, linkName).dblclick();
      const linkEditor = page.getByRole("dialog", {
        name: studio.edition === "initial" ? "添加链接" : "链接",
        exact: true,
      });
      const updatedName = "房主更新的协作网页";
      const updatedUrl = studio.url + "#collaboration";
      await textbox(linkEditor, "名称").fill(updatedName);
      await textbox(linkEditor, "网页地址").fill(updatedUrl);
      await button(linkEditor, "保存到白板").click();
      await expect(linkEditor).toBeHidden();
      await expect(visibleText(guest, updatedName)).toBeVisible();
      await expect(guest.getByRole("link", { name: "打开链接", exact: true })).toHaveAttribute(
        "href",
        updatedUrl,
      );
      await screenshot(page, testInfo, "owner-media-live");
      await page.reload();
      await expect(page.getByRole("link", { name: "打开链接", exact: true })).toHaveAttribute(
        "href",
        updatedUrl,
      );
      await expect
        .poll(() => mediaDisplaySize(viewport(page, studio, board)))
        .toMatchObject({ naturalWidth: 16 });
      await observe(testInfo, "media-content", {
        linkCreated: true,
        linkEdited: true,
        imageCropSeenByPeer: true,
        peerVideoPlayed: true,
        reopened: true,
      });
    },
  );
});

test("[COLLAB-CONTENT-08] 连接线标题和图形贴纸同步到另一端并可重新打开", async ({
  page: owner,
  browser,
  studio: edition,
}, testInfo) => {
  const seed = {
    title: "连接线和贴纸协作验收",
    objects: [
      {
        ...object("connector", "team-line", "讨论流程", 150, 235, 450, 1),
        start: { x: 150, y: 235 },
        end: { x: 600, y: 235 },
      },
    ],
  };
  await withEditor(
    { page: owner, browser, studio: edition },
    seed,
    async ({ page, guest, studio, board }) => {
      const name = "房主更新流程";
      const { objects } = await readCanvas(page, studio);
      const { pathPoints } = objects.find(({ id }) => id === "team-line");
      const { x, y } = pathPoints[1];
      if (studio.edition === "initial") {
        await page.mouse.dblclick(x, y);
      } else {
        await page.mouse.click(x, y);
        await page.keyboard.press("Enter");
      }

      const editor = textbox(page, "连接线文字");
      await expect(editor).toBeFocused();
      await editor.fill(name);
      await button(page.getByRole("toolbar", { name: "白板工具" }), "选择").click();
      await expect(visibleText(guest, name)).toBeVisible();
      await persisted(studio, board, { id: "team-line", text: name });

      await button(guest.getByRole("toolbar", { name: "白板工具" }), "贴纸").click();
      await guest.getByRole("searchbox", { name: "搜索贴纸" }).fill("爱心");
      await button(guest, "贴纸 爱心").click();
      await viewport(guest, studio, board).click({ position: { x: 580, y: 370 } });
      const sticker = viewport(page, studio, board).getByRole("img", { name: "爱心", exact: true });
      await expect(sticker).toBeVisible();
      await screenshot(page, testInfo, "owner-connector-and-sticker-live");
      await page.reload();
      await expect(sticker).toBeVisible();
      await expect(visibleText(page, name)).toBeVisible();
      await observe(testInfo, "line-and-graphic-content", {
        labelEdited: true,
        graphicInserted: true,
        reopened: true,
      });
    },
  );
});

test("[COLLAB-CONTENT-09] 历史图解与图表按实际支持的方式在协作会话中显示", async ({
  page: owner,
  browser,
  studio: edition,
}, testInfo) => {
  const diagram = "会签历史图解";
  const chart = "会签历史图表";
  const seed = {
    title: "历史图解类型协作验收",
    objects: [
      {
        ...object("diagram", "team-diagram", diagram, 90, 125, 450, 330),
        html: "<h1>历史图解正文</h1>",
      },
      { ...object("chart", "team-chart", chart, 635, 125, 450, 330), html: embedSource },
    ],
  };
  await withEditor(
    { page: owner, browser, studio: edition },
    seed,
    async ({ page, guest, studio, board }) => {
      const modern = studio.edition === "ii";
      await expect(
        embedFrame(page, diagram).getByRole("heading", { name: "历史图解正文" }),
      ).toBeVisible();
      await expect(
        embedFrame(guest, diagram).getByRole("heading", { name: "历史图解正文" }),
      ).toBeVisible();

      if (modern) {
        await selectObject(guest, studio, "team-chart");
        await button(embedFrame(guest, chart), "投一票").click();
        await expect(visibleText(embedFrame(page, chart), "票数：1")).toBeVisible();
        await persisted(studio, board, { id: "team-chart", state: { votes: 1 } });
        await selectObject(guest, studio, "team-diagram");
        await button(guest, "编辑 HTML 源码").click();
        const dialog = guest.getByRole("dialog", { name: "编辑 HTML 源码", exact: true });
        await textbox(dialog, "HTML 源码").fill("<h1>协作者更新了历史图解</h1>");
        await button(dialog, "保存源码").click();
        await expect(
          embedFrame(page, diagram).getByRole("heading", { name: "协作者更新了历史图解" }),
        ).toBeVisible();
      } else {
        await expect(visibleText(guest, chart)).toBeVisible();
        await selectObject(guest, studio, "team-chart");
        await expect(button(guest, "编辑 HTML 源码")).toHaveCount(0);
      }
      await screenshot(page, testInfo, "owner-historical-embed-types");
      await page.reload();
      const expected = modern ? "协作者更新了历史图解" : "历史图解正文";
      await expect(
        embedFrame(page, diagram).getByRole("heading", { name: expected }),
      ).toBeVisible();
      await observe(testInfo, "historical-embed-content", {
        diagramSourceUpdated: modern,
        chartStateUpdated: modern,
        reopened: true,
      });
    },
  );
});

test("[COLLAB-CONTENT-07] 同一对象旧正文提交被拒，保留访客草稿和新版本", async ({
  page: owner,
  browser,
  studio: edition,
}, testInfo) => {
  const seed = {
    title: "正文并发协作验收",
    objects: [object("text", "shared-text", originalText, 140, 130, 400)],
  };
  await withEditor(
    { page: owner, browser, studio: edition },
    seed,
    async ({ page, guest, studio, board }) => {
      const fault = await holdNextInlineTextWrite(guest, studio, {
        boardId: board.id,
        objectId: "shared-text",
      });
      const winningText = "房主先确认的正文";
      const staleText = "访客稍晚提交的稿件";
      try {
        await visibleText(guest, originalText).dblclick();
        const draft = textbox(guest, "编辑文字");
        await draft.fill(staleText);
        await fault.received;
        await replaceLabel(page, originalText, winningText);
        await persisted(studio, board, { id: "shared-text", text: winningText });
        fault.release();
        await expect(
          guest
            .getByRole("alert")
            .filter({ hasText: /修改|版本|已被/u })
            .first(),
        ).toBeVisible();
        await expect(draft).toHaveText(staleText);
        await expect(visibleText(page, winningText)).toBeVisible();
        const notices = guest.getByRole("region", { name: "操作通知", exact: true });
        const conflict = "正文已被其他操作修改。";
        if (studio.edition === "ii") {
          await expect(notices.getByRole("alert").filter({ hasText: conflict })).toHaveCount(1);
          await expect(visibleText(viewport(guest, studio, board), conflict)).toHaveCount(0);
          await expect(button(notices, "重试保存文字")).toHaveCount(0);
        }
        await screenshot(guest, testInfo, "guest-stale-draft-retained");
        if (studio.edition === "ii") {
          await button(notices, "放弃文字修改").click();
          await expect(draft).toBeHidden();
          await expect(visibleText(notices, conflict)).toHaveCount(0);
          await expect(visibleText(guest, winningText)).toBeVisible();
        }
      } finally {
        fault.release();
      }
      await page.reload();
      await expect(visibleText(page, winningText)).toBeVisible();
      await observe(testInfo, "content-conflict", {
        remoteVersionRetained: true,
        localDraftRetained: true,
      });
    },
  );
});

async function drawInk(view, studio, board, index) {
  await button(view.getByRole("toolbar", { name: "白板工具" }), "画笔").click();
  await button(view, "墨色 蓝色").click();
  const bounds = await viewport(view, studio, board).boundingBox();
  const x = bounds.x + 290;
  const y = bounds.y + 170 + 95 * index;
  await view.mouse.move(x, y);
  await view.mouse.down();
  await view.mouse.move(x + 53, y + 58, { steps: 5 });
  await view.mouse.move(x + 128, y + 21, { steps: 5 });
  await view.mouse.up();
}

async function visibleInk(view, studio) {
  const { objects } = await readCanvas(view, studio);
  return objects.filter(({ kind, box }) => kind === "ink" && box?.width > 0 && box.height > 0);
}

async function savedInk(studio, board) {
  const { objects } = await studio.readBoard(board);
  return objects.filter(({ kind }) => kind === "ink");
}

test("[COLLAB-CONTENT-10] 两端手绘笔迹传到对方并在刷新后保持完整", async ({
  page: owner,
  browser,
  studio: edition,
}, testInfo) => {
  const seed = {
    title: "手绘协作验收",
    objects: [object("text", "team-ink-target", "手绘交流", 675, 105)],
  };
  await withEditor(
    { page: owner, browser, studio: edition },
    seed,
    async ({ page, guest, studio, board }) => {
      await drawInk(guest, studio, board, 0);
      await expect.poll(() => visibleInk(page, studio)).toHaveLength(1);
      await drawInk(page, studio, board, 1);
      await expect.poll(() => visibleInk(guest, studio)).toHaveLength(2);
      await expect.poll(() => savedInk(studio, board)).toHaveLength(2);
      await screenshot(guest, testInfo, "guest-two-ink-strokes");
      await guest.reload();
      await expect.poll(() => visibleInk(guest, studio)).toHaveLength(2);
      await observe(testInfo, "ink-content", { ownerStrokes: 1, guestStrokes: 1, reopened: true });
    },
  );
});
