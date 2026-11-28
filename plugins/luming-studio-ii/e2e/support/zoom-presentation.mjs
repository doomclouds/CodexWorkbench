const viewport = {
  initial: ".studio-canvas-viewport[aria-label='白板画布']",
  ii: "[data-canvas-root]:not([data-canvas-presentation])",
};

export function readZoomDetails(page, studio) {
  return page.locator(viewport[studio.edition]).evaluate((root, legacy) => {
    const selector = legacy ? "[data-element-id]" : "[data-canvas-object]";
    const idAttribute = legacy ? "data-element-id" : "data-canvas-object";
    const world = root.querySelector(legacy ? ".studio-canvas-world" : ".studio-canvas__world");
    const zoom = new DOMMatrixReadOnly(getComputedStyle(world).transform).a;

    function bounds(element) {
      if (!element) {
        return null;
      }

      const { x, y, width, height } = element.getBoundingClientRect();

      return { x, y, width, height };
    }

    function caption(element, selector, nested = ".studio-ui-text-object") {
      const node = element.querySelector(selector);
      const label = node?.querySelector(nested) ?? node;
      const box = bounds(node);
      const painted = box?.width && box.height;
      if (
        !label?.textContent.trim() ||
        !painted ||
        getComputedStyle(label).visibility !== "visible"
      ) {
        return null;
      }

      const transform = getComputedStyle(node).transform;
      const scale = transform === "none" ? 1 : new DOMMatrixReadOnly(transform).a;
      return {
        text: label.textContent.trim(),
        screenFont: Number.parseFloat(getComputedStyle(label).fontSize) * zoom * scale,
        box,
      };
    }

    function sectionEditor(element) {
      const title = element.querySelector(".studio-section-title,[data-canvas-section-title]");
      const field = title?.querySelector("[contenteditable='true']");
      const box = bounds(field);
      if (!box?.width || !box.height) {
        return null;
      }

      const styles = getComputedStyle(field);
      const point = root.ownerDocument.elementFromPoint(
        box.x + box.width / 2,
        box.y + box.height / 2,
      );

      return {
        box,
        screenFont: Number.parseFloat(styles.fontSize) * zoom,
        foreground: styles.color,
        background: styles.backgroundColor,
        hit: point != null && field.contains(point),
      };
    }

    return [...root.querySelectorAll(selector)].map((element) => {
      const image = element.querySelector("img");
      const html = element.querySelector("iframe");
      const video = element.querySelector("video");

      return {
        id: element.getAttribute(idAttribute),
        object: bounds(element),
        label: caption(element, ".studio-element-text,.studio-ui-canvas-object-label"),
        section: caption(element, ".studio-section-title,[data-canvas-section-title]"),
        sectionEditor: sectionEditor(element),
        htmlCaption: caption(
          element,
          legacy
            ? ".studio-html-caption"
            : "[data-canvas-embed-caption],.studio-ui-canvas-embedded-title:has(strong)",
          "strong",
        ),
        hoverTitle: element.getAttribute("title"),
        documentTitle: caption(element, ".studio-document-title"),
        todoTitle: caption(
          element,
          legacy ? ".studio-todo-title" : ".studio-object-todo__title > :is(h3, button)",
        ),
        document: bounds(element.querySelector("[aria-label^='文档正文']")),
        todo: bounds(element.querySelector("progress,[role='progressbar']")),
        html: bounds(html),
        renderedImage: image?.complete && image.naturalWidth > 0 ? bounds(image) : null,
        video: video && {
          bounds: bounds(video),
          controls: video.controls,
          loaded: video.readyState > 0,
        },
      };
    });
  }, studio.edition === "initial");
}
