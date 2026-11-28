import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { inspectImage } from "./board-export-fidelity.mjs";
import { controlNextCanvasSave } from "./canvas-persistence.mjs";
import { readCanvas } from "./canvas-presentation.mjs";

const ordinary = {
  title: "选择文件的离线图解",
  heading: "文件内的图解正文",
  html: "<main><h1>文件内的图解正文</h1><p>离线文件样例。</p></main>",
};
const inlineResource = {
  title: "含内联资源的图解",
  html: '<img src="data:image/png;base64,AA==" alt="待替换图片">',
};
const htmlFixtures = new Map([
  ["ordinary", ordinary],
  ["inline-resource", inlineResource],
]);

const requireServer = createRequire(new URL("../../apps/server/package.json", import.meta.url));

export function observeEmbedPayloadReads(page, studio) {
  const reads = [];
  if (studio.edition === "ii") {
    const { fromBinary } = requireServer("@bufbuild/protobuf");
    const { WhiteboardService } = requireServer(
      "@codexworkbench/luming-studio-ii-contracts/whiteboard/service",
    );
    const method = WhiteboardService.method.getObjectPayloads;
    const url = new URL(`/${method.parent.typeName}/${method.name}`, studio.url).href;
    page.on("request", (request) => {
      const body = request.url() === url && request.postDataBuffer();
      if (body) {
        reads.push(fromBinary(method.input, body).objectIds);
      }
    });
  }

  return () => reads;
}

export async function countOverviewEmbeds(page, studio) {
  if (studio.edition === "initial") {
    return page.locator(".studio-html-region iframe[srcdoc]").count();
  }

  return page
    .locator(".studio-ui-embed__preview")
    .evaluateAll(
      (images) => images.filter((image) => image.complete && image.naturalWidth > 0).length,
    );
}

export function embedFrame(page, title) {
  const frames = page.locator("[data-element-id] iframe, [data-canvas-object] iframe");

  return frames.and(page.getByTitle(title, { exact: true })).contentFrame();
}

export async function inspectEmbedPaint(page, studio, id, palette) {
  const { bounds, objects } = await readCanvas(page, studio);
  const box = objects.find((object) => object.id === id)?.box;
  assert.ok(box, "Expected a painted HTML object.");
  const x = Math.max(0, Math.ceil(box.x), Math.ceil(bounds.x));
  const y = Math.max(0, Math.ceil(box.y), Math.ceil(bounds.y));
  const width = Math.floor(Math.min(box.x + box.width, bounds.x + bounds.width)) - x;
  const height = Math.floor(Math.min(box.y + box.height, bounds.y + bounds.height)) - y;
  assert.ok(width > 0 && height > 0, "Expected HTML inside the visible canvas.");
  const pixels = await page.screenshot({ clip: { x, y, width, height }, scale: "css" });

  return inspectImage(page, pixels, "image/png", palette);
}

export async function chooseHtmlFile(page, action, fixture) {
  const source = htmlFixtures.get(fixture);
  if (!source) {
    throw new TypeError("Select a registered offline HTML fixture.");
  }

  const [picker] = await Promise.all([page.waitForEvent("filechooser"), action()]);
  await picker.setFiles({
    name: source.title + ".html",
    mimeType: "text/html",
    buffer: Buffer.from(source.html),
  });

  return source;
}

export function controlNextHtmlSave(page, studio, { boardId, action, mode }) {
  if (action !== "source") {
    throw new TypeError("Select the registered HTML source save action.");
  }

  return controlNextCanvasSave(page, studio, { boardId, action: "embedSource", mode });
}
