import {
  downloadBoardExport,
  expect,
  inspectBoardExport,
  observe,
  readCanvas,
  screenshot,
  test,
} from "../support/studio.mjs";

const colors = {
  html: [209, 44, 100],
  diagram: [181, 68, 151],
  chart: [30, 114, 226],
  image: [33, 122, 119],
  video: [0, 0, 253],
};
const embed = (label, fill) =>
  `<main style="margin:0;width:100vw;height:100vh;background:${fill}">${label}</main>`;

const samples = [
  { kind: "shape", label: "流程节点", outline: "rounded", fill: "#e6eeff" },
  { kind: "text", label: "说明文字" },
  { kind: "note", label: "计划便签", fill: "#f9e56f" },
  { kind: "section", label: "透明分区", transparent: true },
  { kind: "connector", label: "进度连线", start: { x: 70, y: 240 }, end: { x: 210, y: 285 } },
  {
    kind: "ink",
    label: "画笔轨迹",
    points: [2, 2, 68, 18, 118, 65],
    stroke: "#2e638f",
    strokeWidth: 3,
  },
  { kind: "sticker", label: "爱心贴纸", stickerIconId: "heart" },
  { kind: "link", label: "查看计划", href: "https://example.test/plan" },
  {
    kind: "image",
    label: "配图素材",
    mediaFixture: "board-svg",
    naturalSize: { width: 120, height: 90 },
  },
  { kind: "video", label: "无海报视频", mediaFixture: "blue-frame" },
  { kind: "html", label: "网页图解", html: embed("可读的 HTML 布局", "#d12c64") },
  { kind: "diagram", label: "原生图解", html: embed("可读的图解布局", "#b54497") },
  { kind: "chart", label: "数据图表", html: embed("可读的图表布局", "#1e72e2") },
  {
    kind: "table",
    label: "交付表格",
    head: true,
    rows: [
      ["节点", "状态"],
      ["首个表格数据", "完成"],
    ],
    rowIds: ["r1", "r2"],
    columnIds: ["c1", "c2"],
  },
  {
    kind: "todo",
    label: "核对清单",
    items: [{ id: "to-check", text: "实际待办内容", checked: true }],
  },
  {
    kind: "document",
    label: "原生方案",
    document: {
      blocks: [
        { id: "doc-h", type: "heading", props: { level: 2 }, content: "实际文档标题" },
        { id: "doc-p", type: "paragraph", content: "实际文档正文" },
      ],
    },
  },
];
const objects = samples.map((object, index) => ({
  id: "fidelity-" + object.kind,
  x: 38 + (index % 4) * 224,
  y: 40 + Math.floor(index / 4) * 172,
  width: 188,
  height: 138,
  ...object,
}));
const legacyRasterKinds = new Set(["html", "diagram", "chart", "image", "video"]);
const legacyVectorObjects = objects.filter(({ kind }) => !legacyRasterKinds.has(kind));

async function openMixedBoard(page, studio, sample = objects) {
  const board = await studio.seedBasicBoard({ title: "混合对象导出复验", objects: sample });
  await page.goto(board.url);
  await expect(page.getByRole("textbox", { name: "白板名称", exact: true })).toHaveValue(
    board.title,
  );

  return board;
}

async function openPanel(page) {
  await page.getByRole("button", { name: "分享", exact: true }).click();
  await page.getByRole("tab", { name: "导出", exact: true }).click();
  const panel = page.getByRole("tabpanel", { name: "导出", exact: true });
  await expect(panel).toBeVisible();

  return panel;
}

async function exported(page, studio, panel, label, format) {
  const trigger = panel.getByRole("button", { name: label });
  await expect(trigger).toBeEnabled();
  const download = await downloadBoardExport(page, studio, trigger);

  return inspectBoardExport(page, download, format, colors);
}

function expectRealImages(result) {
  expect(result.width).toBeGreaterThan(450);
  expect(result.height).toBeGreaterThan(400);
  for (const [object, pixels] of Object.entries(result.counts)) {
    expect(
      pixels,
      "The downloaded image must paint the real " + object + " content",
    ).toBeGreaterThan(100);
  }
}

function paintedKinds(result) {
  return Object.keys(result.counts)
    .filter((kind) => result.counts[kind] > 100)
    .sort();
}

test("[TOPBAR-FID-01] 混合白板导出 PNG 和 SVG，解码核对媒体及图解像素", async ({
  page,
  studio,
}, testInfo) => {
  const sample = studio.edition === "initial" ? legacyVectorObjects : objects;
  const board = await openMixedBoard(page, studio, sample);
  const panel = await openPanel(page);
  const png = await exported(page, studio, panel, /^PNG 图片/u, "png");
  const svg = await exported(page, studio, panel, /^SVG 图片/u, "svg");
  expect(png.width).toBeGreaterThan(450);
  expect(svg.width).toBeGreaterThan(450);
  if (studio.edition === "ii") {
    expectRealImages(png);
    expectRealImages(svg);
    for (const content of ["首个表格数据", "实际待办内容", "实际文档标题", "example.test/plan"]) {
      expect(svg.markup).toContain(content);
    }
  }

  const json = await exported(page, studio, panel, /^白板文件/u, "json");
  expect(JSON.stringify(json)).toContain(board.title);
  expect(JSON.stringify(json)).toContain("首个表格数据");
  await observe(testInfo, "painted-shape-assets", {
    objects: sample.length,
    png: paintedKinds(png),
    svg: paintedKinds(svg),
  });
  await screenshot(page, testInfo, "full-board-formats");
});

test("[TOPBAR-FID-02] 打开实际导出的整板网页，并核对普通 HTML 选区范围", async ({
  page,
  studio,
}, testInfo) => {
  await openMixedBoard(page, studio);
  const panel = await openPanel(page);
  const html = await exported(page, studio, panel, /^整板网页/u, "html");
  expect(html.text).toContain("实际文档正文");
  expect(html.text).toContain("实际待办内容");
  expect(html.pictures).toBeGreaterThan(0);
  expect(html.videos).toBe(1);
  if (studio.edition === "ii") {
    expect(html.rows).toBe(2);
    expect(html.rendered).toEqual(
      expect.arrayContaining(["可读的 HTML 布局", "可读的图解布局", "可读的图表布局"]),
    );
  }

  await screenshot(page, testInfo, "html-export-finished");
  if (studio.edition === "ii") {
    await page.keyboard.press("Escape");
    const canvas = await readCanvas(page, studio);
    const table = canvas.objects.find(({ id }) => id === "fidelity-table")?.box;
    expect(table).toBeDefined();
    await page.mouse.click(table.x + table.width / 2, table.y + table.height / 2);
    const selectionPanel = await openPanel(page);
    await selectionPanel.getByRole("combobox", { name: "导出范围" }).selectOption("selection");
    const selection = await exported(page, studio, selectionPanel, /^选区网页/u, "html");
    expect(selection.rows).toBe(2);
    expect(selection.text).toContain("首个表格数据");
    expect(selection.text).not.toContain("实际文档正文");
    expect(selection.embedded).toBe(0);
  }

  await observe(testInfo, "offline-rendered-shapes", {
    tableRows: html.rows,
    videoPlayers: html.videos,
    imageNodes: html.pictures,
    embeddedRegions: html.embedded,
  });
});
