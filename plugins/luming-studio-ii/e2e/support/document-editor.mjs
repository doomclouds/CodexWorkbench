export async function holdDocumentEditorChunk(page, studio) {
  const origin = new URL(studio.url).origin;
  let requested;
  let release;
  const started = new Promise((resolve) => {
    requested = resolve;
  });
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) => url.origin === origin && /^\/assets\/DocumentEditor-[\w-]+\.js$/u.test(url.pathname),
    async (route) => {
      requested();
      if (await hold) {
        await route.abort("failed");
      } else {
        await route.continue();
      }
    },
    { times: 1 },
  );

  return { started, release };
}

export function readDocumentPaper(page, studio, title) {
  const name = studio.edition === "initial" ? "文档正文：" + title : "文档正文";
  return page.getByLabel(name, { exact: true }).evaluate((body) => {
    const paper = body.firstElementChild;
    const surface = body.closest(".studio-document-surface");
    const { x, y, width, height } = body.getBoundingClientRect();
    const marker = "[data-document-read-block], [data-id]";
    const blockId = (block) => block?.dataset.documentReadBlock ?? block?.dataset.id;
    const first = Array.from(body.querySelectorAll(marker)).find((block) => {
      const bounds = block.getBoundingClientRect();

      return bounds.bottom > y && bounds.top < y + height;
    });
    const owner = body.ownerDocument;
    const caret = owner.activeElement?.matches("[contenteditable=true]")
      ? owner.getSelection()?.anchorNode
      : undefined;
    const caretElement = caret instanceof Element ? caret : caret?.parentElement;

    return {
      x,
      y,
      width,
      height,
      scrollTop: body.scrollTop,
      distanceFromEnd: body.scrollHeight - body.clientHeight - body.scrollTop,
      horizontalOverflow: surface ? surface.scrollWidth - surface.clientWidth : 0,
      background: paper && getComputedStyle(paper).backgroundColor,
      visibleBlock: blockId(first),
      caretBlock: blockId(caretElement?.closest(marker)),
    };
  });
}
