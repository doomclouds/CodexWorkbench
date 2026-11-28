export async function holdObjectPayloads(page, studio) {
  const url = new URL("/luming.studio.v1.WhiteboardService/GetObjectPayloads", studio.url).href;
  const requested = Promise.withResolvers();
  const response = Promise.withResolvers();
  let holding = true;
  await page.route(url, async (route) => {
    if (holding) {
      requested.resolve();
      if (await response.promise) {
        await route.fulfill({ status: 503 });
        return;
      }
    }
    await route.continue();
  });

  return {
    requested: requested.promise,
    release(fail = false) {
      holding = false;
      response.resolve(fail);
    },
  };
}

export function readObjectLoading(page) {
  return page.locator("[data-canvas-root]").evaluate((canvas) => {
    const waitingSelector = [
      ".studio-document-unavailable",
      "[data-todo-content-unavailable]",
      ".studio-ui-embed--placeholder",
      ".luming-media-placeholder",
      ".studio-object-table-placeholder",
    ].join(",");

    return Object.fromEntries(
      [...canvas.querySelectorAll("[data-canvas-object]")].map((object) => {
        const id = object.getAttribute("data-canvas-object");
        const waiting = object.querySelector(waitingSelector);
        return [
          id,
          {
            ownsFrame: Boolean(object.querySelector("[data-canvas-owned-frame]")),
            genericTitle: Boolean(object.querySelector(".studio-ui-canvas-native-title")),
            waiting: Boolean(waiting),
            waitingPaint: waiting && getComputedStyle(waiting).backgroundColor,
            waitingMessage: waiting?.textContent,
            embedded: Boolean(object.querySelector("iframe, .studio-ui-embed__preview")),
            imageReady: Boolean(
              object.querySelector(".luming-media-object:not([data-media-loading]) img"),
            ),
            videoReady: Boolean(object.querySelector("video")),
          },
        ];
      }),
    );
  });
}
