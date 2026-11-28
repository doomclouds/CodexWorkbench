const markerFor = {
  initial: ".studio-remote-cursor",
  ii: ".room-presence-cursor",
};

export function readPeerCursors(page, studio) {
  const selector = markerFor[studio.edition];
  if (!selector) {
    throw new Error("Unknown Studio edition for peer cursor measurement.");
  }

  return page.locator(selector).evaluateAll((nodes) =>
    nodes.map((marker) => {
      const { x, y } = marker.getBoundingClientRect();
      return { x, y };
    }),
  );
}

const placementPreviewFor = {
  initial: '.studio-placement-ghost [data-element-id="placement-ghost"]',
  ii: "[data-canvas-draft]",
};
const previewKinds = new Set(["shape", "sticker", "table", "document", "text", "todo"]);

export function readPlacementPreview(page, studio, kind = "shape") {
  const selector = placementPreviewFor[studio.edition];
  if (!selector || !previewKinds.has(kind)) {
    throw new Error("Unknown Studio edition or placement preview kind.");
  }

  const initial = studio.edition === "initial";
  const prefix = initial ? ".studio-element-" : ".studio-ui-canvas-object--";
  const preview =
    initial && kind === "document" ? ".studio-document-placement" : selector + prefix + kind;

  return page.locator(preview).evaluateAll((nodes) => {
    const preview = nodes[0];
    if (!preview) {
      return null;
    }

    const { x, y, width, height } = preview.getBoundingClientRect();
    const icon = preview.querySelector("svg");
    const table = preview.querySelector("table");
    const iconWidth = icon?.getBoundingClientRect().width ?? 0;
    const rows = table ? Array.from(table.rows, (row) => row.cells.length) : [];
    const cell = table?.rows[0]?.cells[0];
    const cellStyle = cell && getComputedStyle(cell);
    const document =
      preview.querySelector(".studio-document-placement-preview") ??
      preview.closest(".studio-document-placement");
    const textLine = preview.querySelector(
      ".studio-text-preview, .studio-ui-canvas-text-placement",
    );
    const progress = preview.querySelector(
      ".studio-todo-count, .studio-object-todo__placement-count",
    );

    return {
      x,
      y,
      width,
      height,
      sticker: icon?.getAttribute("data-sticker-icon-id"),
      iconWidth,
      rows,
      gridLines: cellStyle && [cellStyle.borderInlineEndStyle, cellStyle.borderBlockEndStyle],
      documentBorder: document && getComputedStyle(document).borderBlockStartStyle,
      textLineWidth: textLine?.getBoundingClientRect().width ?? 0,
      progress: progress?.textContent.trim(),
      progressWidth: progress?.getBoundingClientRect().width ?? 0,
      text: preview.textContent.trim(),
    };
  });
}
