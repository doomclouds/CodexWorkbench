import { controlNextCanvasSave } from "./canvas-persistence.mjs";

const ordinary = {
  title: "选择文件的离线图解",
  heading: "文件内的图解正文",
  html: "<main><h1>文件内的图解正文</h1><p>离线文件样例。</p></main>",
};

export function embedFrame(page, title) {
  const frames = page.locator("[data-element-id] iframe, [data-canvas-object] iframe");

  return frames.and(page.getByTitle(title, { exact: true })).contentFrame();
}

export async function chooseHtmlFile(page, action, fixture) {
  if (fixture !== "ordinary") {
    throw new TypeError("Select a registered offline HTML fixture.");
  }

  const [picker] = await Promise.all([page.waitForEvent("filechooser"), action()]);
  await picker.setFiles({
    name: ordinary.title + ".html",
    mimeType: "text/html",
    buffer: Buffer.from(ordinary.html),
  });

  return ordinary;
}

export function controlNextHtmlSave(page, studio, { boardId, action, mode }) {
  if (action !== "source") {
    throw new TypeError("Select the registered HTML source save action.");
  }

  return controlNextCanvasSave(page, studio, { boardId, action: "embedSource", mode });
}
