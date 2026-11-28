import { embedFrame } from "./embed.mjs";

export async function observeViewingFrames(page, studio, ids) {
  const legacy = studio.edition === "initial";
  const root = legacy ? ".studio-canvas-viewport[aria-label='白板画布']" : "[data-canvas-root]";
  const probe = await page.locator(root).evaluateHandle(
    (canvas, { legacy, ids }) => {
      const host = legacy ? canvas.closest(".studio-whiteboard") : canvas;
      const objectId = legacy ? "data-element-id" : "data-canvas-object";
      const frameFor = (id) => canvas.querySelector(`[${objectId}="${id}"] iframe`);
      const frames = ids.map((id) => {
        const node = frameFor(id);
        if (!node) {
          throw new Error("Expected both HTML regions to finish initial loading.");
        }

        const frame = { id, node, loads: 0, detached: false };
        node.addEventListener("load", () => {
          frame.loads += 1;
        });

        return frame;
      });
      const visible = () =>
        ids.flatMap((id) => {
          const frame = frameFor(id);
          const bounds = frame?.getBoundingClientRect();
          return bounds?.width && getComputedStyle(frame).visibility === "visible"
            ? [{ id, width: bounds.width }]
            : [];
        });
      const opens = [];
      let watching = false;
      const observer = new MutationObserver((changes) => {
        for (const frame of frames) {
          frame.detached ||= changes.some((change) =>
            [...change.removedNodes].some((node) => node.contains(frame.node)),
          );
        }
        const active = legacy
          ? host.classList.contains("is-reading")
          : canvas.hasAttribute("data-canvas-presentation");

        if (active && !watching) {
          const entry = { opened: visible(), firstFrame: null };
          opens.push(entry);
          requestAnimationFrame(() => {
            entry.firstFrame = visible();
          });
        }
        watching = active;
      });
      observer.observe(host, { subtree: true, attributes: true, childList: true });

      return () => ({
        opens,
        frames: frames.map(({ id, node, loads, detached }) => ({
          id,
          sameNode: node === frameFor(id) && node.isConnected,
          loads,
          detached,
        })),
      });
    },
    { legacy, ids },
  );

  return () => probe.evaluate((read) => read());
}

export async function observeViewingLayers(page, ids) {
  const probe = await page.locator("[data-canvas-root]").evaluateHandle((canvas, ids) => {
    const world = canvas.querySelector(".studio-canvas__world");
    const box = (node) => {
      const { x, y, width, height } = node.getBoundingClientRect();

      return { x, y, width, height };
    };
    const sample = () => ({
      canvas: box(canvas),
      camera: getComputedStyle(world).transform,
      mounted: canvas.isConnected,
      visible: ids.flatMap((id) => {
        const layer = canvas.querySelector(
          `[data-canvas-object="${id}"] :is(.studio-ui-embed__preview, iframe)`,
        );

        if (!layer?.checkVisibility()) {
          return [];
        }

        return [{ id, kind: layer.localName, zoom: getComputedStyle(layer).zoom, ...box(layer) }];
      }),
    });
    const opens = [];
    let watching = false;
    const observer = new MutationObserver(() => {
      const active = canvas.hasAttribute("data-canvas-presentation");
      if (active && !watching) {
        const frames = [sample()];
        opens.push(frames);
        const next = () => {
          frames.push(sample());
          if (frames.length < 5) {
            requestAnimationFrame(next);
          }
        };
        requestAnimationFrame(next);
      }
      watching = active;
    });
    observer.observe(canvas, { attributes: true, attributeFilter: ["data-canvas-presentation"] });

    return () => ({ opens, current: sample() });
  }, ids);

  return () => probe.evaluate((read) => read());
}

export async function observeEmbedViewport(page, title) {
  const probe = await embedFrame(page, title)
    .locator("body")
    .evaluateHandle((body) => {
      const view = body.ownerDocument.defaultView;
      const sizes = new Map();
      function capture() {
        const width = view.innerWidth;
        const height = view.innerHeight;
        sizes.set(width + "x" + height, { width, height });
      }
      capture();
      new ResizeObserver(capture).observe(body);
      view.addEventListener("resize", capture);

      return () => [...sizes.values()];
    });

  return () => probe.evaluate((read) => read());
}
