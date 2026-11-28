const viewportFor = {
  initial: ".studio-canvas-viewport[aria-label='白板画布']",
  ii: "[data-canvas-root]:not([data-canvas-presentation])",
};

export async function readCanvas(page, studio) {
  const edition = studio.edition;
  const selector = viewportFor[edition];
  if (!selector) {
    throw new Error("Unknown Studio edition for canvas measurement.");
  }

  return page.locator(selector).evaluate((root, legacy) => {
    function box(element) {
      if (!element) {
        return null;
      }

      const { x, y, width, height } = element.getBoundingClientRect();

      return { x, y, width, height };
    }

    function renderedKind(element) {
      if (element.matches("svg.studio-canvas-arrow")) {
        return "connector";
      }

      const prefix = legacy ? "studio-element-" : "studio-ui-canvas-object--";
      const kind = [...element.classList]
        .find((entry) => entry.startsWith(prefix))
        ?.slice(prefix.length);
      const aliases = { container: "section", stroke: "ink", path: "ink", draw: "ink" };

      return aliases[kind] ?? kind ?? "";
    }

    function screenRoute(path) {
      const matrix = path?.getScreenCTM();
      if (!matrix) {
        return [];
      }

      const length = path.getTotalLength();

      return [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
        const location = path.getPointAtLength(fraction * length).matrixTransform(matrix);

        return { x: location.x, y: location.y };
      });
    }

    function difference(from, to) {
      return { x: to.x - from.x, y: to.y - from.y };
    }

    function arrowVector(path, goal, matrix) {
      for (const arrow of path.parentElement.querySelectorAll("polyline")) {
        if (arrow.points.numberOfItems !== 3) {
          continue;
        }

        const tip = arrow.points.getItem(1).matrixTransform(matrix);
        if (Math.hypot(tip.x - goal.x, tip.y - goal.y) > 0.1) {
          continue;
        }

        const first = arrow.points.getItem(0).matrixTransform(matrix);
        const last = arrow.points.getItem(2).matrixTransform(matrix);
        return difference({ x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 }, tip);
      }
    }

    function pathTangents(path) {
      const matrix = path?.getScreenCTM();
      if (!matrix) {
        return;
      }

      const length = path.getTotalLength();
      const probe = Math.min(length / 4, 2 / Math.hypot(matrix.a, matrix.b));
      const point = (at) => path.getPointAtLength(at).matrixTransform(matrix);
      const goal = point(length);

      return {
        start: difference(point(0), point(probe)),
        end: difference(point(length - probe), goal),
        arrow: arrowVector(path, goal, matrix),
      };
    }

    function connectorPaint(element) {
      const path = element.querySelector(
        legacy
          ? ":scope > path[pointer-events='none']:not([data-annotation-hover])"
          : ".studio-ui-canvas-connector > path:last-of-type",
      );

      if (path) {
        const { stroke, strokeWidth } = getComputedStyle(path);

        return { stroke, width: Number.parseFloat(strokeWidth) };
      }
    }

    function renderedObject(element) {
      const title = element.querySelector(
        "[data-canvas-external-title],[data-canvas-section-title]",
      );
      const kind = renderedKind(element);
      const path = element.querySelector(
        "path[data-canvas-geometry-hit],path[pointer-events='stroke']",
      );
      const displayed = kind === "connector" && path ? path : element;
      const label = title?.textContent || element.textContent || element.getAttribute("aria-label");

      return {
        id: element.getAttribute(legacy ? "data-element-id" : "data-canvas-object"),
        kind,
        label: label?.trim() ?? "",
        box: box(displayed),
        titleBox: box(title),
        pathPoints: kind === "connector" || kind === "ink" ? screenRoute(path) : undefined,
        pathTangents: kind === "connector" ? pathTangents(path) : undefined,
        pathPaint: kind === "connector" ? connectorPaint(element) : undefined,
        selected: legacy ? element.classList.contains("is-selected") : undefined,
      };
    }

    const scene = root.querySelector(legacy ? ".studio-canvas-world" : ".studio-canvas__world");
    const cameraStyle = scene && getComputedStyle(scene).transform;
    const transform = new DOMMatrixReadOnly(
      !cameraStyle || cameraStyle === "none" ? undefined : cameraStyle,
    );
    const frames = root.querySelectorAll(legacy ? "[data-element-id]" : "[data-canvas-object]");
    const marker = root.querySelector(
      ".studio-selection-frame,.studio-ui-canvas-selection-outline",
    );
    const handleSelector = [
      ".studio-selection-edge",
      ".studio-selection-corner",
      ".studio-rotate-hit",
      ".studio-connection-port",
      ".studio-arrow-handle",
      "[data-canvas-handle]",
      "[data-canvas-port]",
      "[data-canvas-connector-handle]",
    ].join(",");
    const toolbar = root.parentElement?.querySelector("[role='toolbar'][aria-label='选区格式']");
    const background = legacy ? root : root.querySelector(".studio-canvas__background");

    return {
      bounds: box(root),
      zoom: transform.a,
      pan: { x: transform.e, y: transform.f },
      grid: Boolean(background && getComputedStyle(background).backgroundImage !== "none"),
      focused: root.ownerDocument.activeElement === root,
      objects: [...frames].map(renderedObject),
      selection: box(marker),
      toolbar: box(toolbar),
      guides: root.querySelectorAll(".studio-snap-guide,[data-canvas-guide]").length,
      handles: [...root.querySelectorAll(handleSelector)]
        .filter((element) => element.hasAttribute("aria-label"))
        .map((element) => ({ label: element.getAttribute("aria-label"), box: box(element) })),
    };
  }, edition === "initial");
}
