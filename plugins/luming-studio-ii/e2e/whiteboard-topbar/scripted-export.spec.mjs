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
  savedCanvas: [10, 238, 32],
  scriptVector: [189, 72, 151],
  background: [18, 52, 86],
  neighbor: [237, 82, 39],
};

const title = "脚本图解导出";
const scripted = {
  id: "drawn-embed",
  kind: "html",
  label: "离线绘制结果",
  x: 80,
  y: 120,
  width: 250,
  height: 180,
  state: { ink: "#0aee20" },
  html: `<!doctype html>
<style>body{margin:0;background:#123456}canvas,svg{display:block}</style>
<canvas width="96" height="54"></canvas><svg width="96" height="54"></svg>
<script>
  const state = window.studioEmbed?.load() || {};
  const paint = document.querySelector('canvas').getContext('2d');
  paint.fillStyle = state.ink || '#111111';
  paint.fillRect(0, 0, 96, 54);
  const graphic = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  graphic.setAttribute('width', '96');
  graphic.setAttribute('height', '54');
  graphic.setAttribute('fill', '#bd4897');
  document.querySelector('svg').append(graphic);
</script>`,
};
const ordinary = {
  id: "outside-selection",
  kind: "shape",
  outline: "rounded",
  label: "整板范围标记",
  x: 390,
  y: 140,
  width: 185,
  height: 100,
  fill: "#ed5227",
};

async function panelFor(page) {
  await page.getByRole("button", { name: "分享", exact: true }).click();
  await page.getByRole("tab", { name: "导出", exact: true }).click();
  const panel = page.getByRole("tabpanel", { name: "导出", exact: true });
  await expect(panel).toBeVisible();

  return panel;
}

async function imageFor(page, studio, panel, format) {
  const label = format === "png" ? /^PNG 图片/u : /^SVG 图片/u;
  const trigger = panel.getByRole("button", { name: label });
  await expect(trigger).toBeEnabled();
  const download = await downloadBoardExport(page, studio, trigger);

  return inspectBoardExport(page, download, format, colors);
}

function assertScriptPaint(result) {
  expect(result.counts.savedCanvas).toBeGreaterThan(1_000);
  expect(result.counts.scriptVector).toBeGreaterThan(1_000);
  expect(result.counts.background).toBeGreaterThan(1_000);
}

async function selectScripted(page, studio) {
  const scene = await readCanvas(page, studio);
  const embed = scene.objects.find(({ id }) => id === scripted.id);
  expect(embed).toBeDefined();
  const hit = embed.titleBox || embed.box;
  await page.mouse.click(hit.x + Math.min(hit.width / 2, 24), hit.y + Math.min(hit.height / 2, 9));
  await expect(page.getByRole("toolbar", { name: "选区格式", exact: true })).toBeVisible();
}

function paintedContents(result) {
  return {
    canvas: result.counts.savedCanvas > 1_000,
    vector: result.counts.scriptVector > 1_000,
  };
}

test("[TOPBAR-FID-SCRIPT-01] 图解实际绘制的 Canvas 与 SVG 像素随整板和选区导出", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({ title, objects: [scripted, ordinary] });
  await page.goto(board.url);
  await expect(page.getByRole("textbox", { name: "白板名称", exact: true })).toHaveValue(title);
  const panel = await panelFor(page);
  const png = await imageFor(page, studio, panel, "png");
  const svg = await imageFor(page, studio, panel, "svg");
  expect(png.width).toBeGreaterThan(scripted.width);
  expect(svg.width).toBeGreaterThan(scripted.width);
  if (studio.edition === "ii") {
    assertScriptPaint(png);
    assertScriptPaint(svg);
    expect(png.counts.neighbor).toBeGreaterThan(1_000);
    expect(svg.markup).toContain("data:image/png;base64,");
    expect(svg.markup).not.toContain("<script");
    expect(svg.markup).not.toContain("data-studio-png-region");
  }

  await screenshot(page, testInfo, "scripted-whole-board-export");
  let selectionExcludesNeighbor = false;
  if (studio.edition === "ii") {
    await page.keyboard.press("Escape");
    await selectScripted(page, studio);
    const selectedPanel = await panelFor(page);
    await selectedPanel.getByRole("combobox", { name: "导出范围" }).selectOption("selection");
    const selection = await imageFor(page, studio, selectedPanel, "png");
    assertScriptPaint(selection);
    expect(selection.counts.neighbor).toBe(0);
    expect(selection.width).toBeLessThan(png.width);
    selectionExcludesNeighbor = true;
    await screenshot(page, testInfo, "scripted-selection-export");
  }
  await observe(testInfo, "scripted-actual-download", {
    png: paintedContents(png),
    svg: paintedContents(svg),
    scope: selectionExcludesNeighbor ? "整板与所选图解" : "整板基准",
  });
});
