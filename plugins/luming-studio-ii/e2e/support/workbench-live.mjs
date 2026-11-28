import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

const methods = new Map([
  ["/luming.studio.v1.BoardCatalogService/ListBoards", "list"],
  ["/luming.studio.v1.BoardCatalogService/WaitForBoardCatalogChange", "wait"],
  ["/luming.studio.v1.BoardCatalogService/GetBoardThumbnail", "thumbnails"],
  ["/luming.studio.v1.WhiteboardService/GetBoardScene", "scene"],
]);

export function observeWorkbenchCatalog(page, studio) {
  const address = new URL(studio.url);
  assert.equal(studio.edition, "ii");
  assert.equal(address.protocol, "http:");
  assert.equal(address.hostname, "127.0.0.1");
  const counts = { list: 0, wait: 0, thumbnails: 0, scene: 0, pageLoads: 0 };
  page.on("request", (request) => {
    const target = new URL(request.url());
    if (target.origin === address.origin) {
      const key = methods.get(target.pathname);
      if (key) {
        counts[key] += 1;
      }
      if (request.resourceType() === "document") {
        counts.pageLoads += 1;
      }
    }
  });

  const read = () => ({ ...counts });
  return {
    read,
    async idle() {
      await delay(3_200);
      return read();
    },
  };
}

export async function trackWorkbenchCard(card) {
  const original = await card.elementHandle();
  return {
    read() {
      return card.evaluate((element, previous) => {
        const image = element.querySelector("img");
        return {
          sameElement: element === previous,
          preview: image?.complete && image.naturalWidth ? image.getAttribute("src") : null,
        };
      }, original);
    },
  };
}
