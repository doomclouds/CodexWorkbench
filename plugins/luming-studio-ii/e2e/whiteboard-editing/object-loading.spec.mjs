import {
  expect,
  holdObjectPayloads,
  observe,
  readCanvas,
  readObjectLoading,
  screenshot,
  test,
} from "../support/studio.mjs";

const html = "<main><h1>已保存的图解</h1></main>";
const darkPaper = "#162534";
const samples = [
  { kind: "document", label: "空白文档", document: { schemaVersion: 1, blocks: [] } },
  { kind: "todo", label: "空白任务清单", items: [] },
  {
    id: "document-colored",
    kind: "document",
    label: "自定义纸色文档",
    fill: darkPaper,
    document: {
      schemaVersion: 1,
      blocks: [{ id: "body", type: "paragraph", content: "已保存正文" }],
    },
  },
  {
    id: "todo-colored",
    kind: "todo",
    label: "自定义纸色清单",
    fill: darkPaper,
    items: [{ id: "task", text: "已保存任务", checked: false }],
  },
  {
    kind: "table",
    label: "任务表",
    head: true,
    rows: [
      ["名称", "状态"],
      ["任务", "未完成"],
    ],
  },
  { kind: "html", label: "网页图解", html },
  { kind: "diagram", label: "内联图解", html },
  { kind: "chart", label: "数据图表", html },
  { kind: "image", label: "配图", mediaFixture: "board-svg" },
  { kind: "video", label: "无海报视频", mediaFixture: "blue-frame" },
  { kind: "link", label: "参考链接", href: "https://example.test/reference" },
  { kind: "text", label: "说明文字" },
  { kind: "shape", label: "流程节点", outline: "rounded", fill: "#e6eeff" },
  { kind: "note", label: "计划便签", fill: "#f9e56f" },
  { kind: "section", label: "透明分区", transparent: true },
  { kind: "connector", label: "流程连线" },
  { kind: "ink", label: "画笔轨迹", stroke: "#2e638f", strokeWidth: 3 },
  { kind: "sticker", label: "爱心贴纸", stickerIconId: "heart" },
];
const bodyKinds = new Set([
  "document",
  "todo",
  "table",
  "html",
  "diagram",
  "chart",
  "image",
  "video",
  "link",
]);
const bodyIds = samples.filter(({ kind }) => bodyKinds.has(kind)).map(({ id, kind }) => id ?? kind);

function buildObjects(scale) {
  return samples.map((object, index) => {
    const x = (30 + (index % 5) * 228) * scale;
    const y = (40 + Math.floor(index / 5) * 155) * scale;
    return {
      ...object,
      id: object.id ?? object.kind,
      x,
      y,
      width: 192 * scale,
      height: 128 * scale,
      ...(object.kind === "connector"
        ? {
            start: { x: x + 5 * scale, y: y + 16 * scale },
            end: { x: x + 136 * scale, y: y + 64 * scale },
          }
        : {}),
      ...(object.kind === "ink"
        ? { points: [3, 14, 56, 53, 121, 28].map((point) => point * scale) }
        : {}),
    };
  });
}

function waitingLook(dark) {
  const result = Object.fromEntries(
    bodyIds.map((id) => [id, { ownsFrame: true, genericTitle: false }]),
  );

  for (const id of ["document", "document-colored", "todo", "todo-colored"]) {
    result[id].waitingPaint = id.endsWith("colored") ? "rgb(22, 37, 52)" : "rgb(239, 239, 239)";
  }
  for (const id of ["html", "diagram", "chart"]) {
    result[id].waitingPaint = "rgb(245, 245, 245)";
  }
  for (const id of ["image", "video"]) {
    result[id].waitingPaint = dark ? "rgb(57, 62, 83)" : "rgb(236, 236, 236)";
    result[id].waitingMessage = expect.stringContaining("正在加载媒体");
  }
  result.table.waitingPaint = dark ? "rgb(45, 49, 66)" : "rgb(245, 245, 245)";
  return result;
}

function loadedLook() {
  const result = Object.fromEntries(
    bodyIds.map((id) => [id, { ownsFrame: true, genericTitle: false, waiting: false }]),
  );

  for (const id of ["html", "diagram", "chart"]) {
    result[id].embedded = true;
  }
  result.image.imageReady = true;
  result.video.videoReady = true;
  return result;
}

function cardBoxes(canvas) {
  return Object.fromEntries(
    canvas.objects.filter(({ id }) => bodyIds.includes(id)).map(({ id, box }) => [id, box]),
  );
}

for (const profile of [
  { id: "01", name: "暗色整板", theme: "dark", scale: 23, zoomAction: "适应白板" },
  { id: "02", name: "亮色加载失败与重试", theme: "light", scale: 1, zoomAction: "100%" },
]) {
  test(
    "[EDIT-LOAD-" + profile.id + "] " + profile.name + "保留各类对象外框",
    async ({ page, studio }, testInfo) => {
      await page.emulateMedia({ colorScheme: profile.theme });
      const board = await studio.seedBasicBoard({
        title: "白板对象加载检查",
        objects: buildObjects(profile.scale),
      });

      if (studio.edition === "initial") {
        await page.goto(board.url);
        await expect
          .poll(async () => (await readCanvas(page, studio)).objects.map(({ kind }) => kind))
          .toEqual(expect.arrayContaining(["document", "todo", "table"]));
        await screenshot(page, testInfo, "initial-ready-" + profile.theme);
        return;
      }
      const payloads = await holdObjectPayloads(page, studio);
      await page.goto(board.url);
      try {
        await payloads.requested;
        await page.getByRole("button", { name: "缩放菜单", exact: true }).click();
        await page.getByRole("menuitem", { name: profile.zoomAction, exact: true }).click();
        await expect(page.getByRole("menu", { name: "缩放与视图", exact: true })).toBeHidden();
        await screenshot(page, testInfo, "waiting-" + profile.theme);
        await expect
          .poll(() => readObjectLoading(page))
          .toMatchObject(waitingLook(profile.theme === "dark"));
        const before = await readCanvas(page, studio);
        expect(before.objects.map(({ kind }) => kind)).toEqual(
          expect.arrayContaining([...new Set(samples.map(({ kind }) => kind))]),
        );

        const fail = profile.theme === "light";
        payloads.release(fail);
        if (fail) {
          const retry = page.getByRole("button", { name: "重试正文", exact: true });
          await expect(retry).toBeVisible();
          await expect.poll(() => readObjectLoading(page)).toMatchObject(waitingLook(false));
          await screenshot(page, testInfo, "payload-failure-light");
          await retry.click();
        }
        await expect.poll(() => readObjectLoading(page)).toMatchObject(loadedLook());
        const after = await readCanvas(page, studio);
        expect(cardBoxes(after)).toEqual(cardBoxes(before));
        expect(after.zoom).toBeCloseTo(profile.theme === "dark" ? 0.05 : 1, 2);
        await screenshot(page, testInfo, "loaded-" + profile.theme);
        await observe(testInfo, "object-loading", {
          kinds: after.objects.map(({ kind }) => kind),
          zoom: after.zoom,
        });
      } finally {
        payloads.release();
      }
    },
  );
}
