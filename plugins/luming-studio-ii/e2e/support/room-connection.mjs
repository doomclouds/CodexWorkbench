import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

function loopback(url) {
  const address = URL.parse(url);
  return (
    address?.protocol === "http:" &&
    address.hostname === "127.0.0.1" &&
    Boolean(address.port) &&
    !address.username &&
    !address.password
  );
}

export async function setRoomConnectionOffline(page, studio, offline) {
  assert.ok(loopback(studio.url), "A local Studio test fixture is required");
  assert.ok(loopback(page.url()), "The browser page must be an isolated local Studio view");
  const context = page.context();
  assert.deepEqual(context.pages(), [page], "The Studio room page needs a private browser context");
  await context.setOffline(offline);
}

export function observeGuestAccessReads(page, studio) {
  assert.equal(studio.edition, "ii");
  assert.ok(loopback(page.url()), "The browser page must be an isolated local Studio view");
  let sharing = 0;
  let scene = 0;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/luming.studio.v1.BoardSharingService/GetBoardSharing") {
      sharing += 1;
    } else if (path === "/luming.studio.v1.WhiteboardService/GetBoardScene") {
      scene += 1;
    }
  });

  return {
    snapshot: () => ({ sharing, scene }),
    async idle() {
      const before = { sharing, scene };
      await delay(6_200);
      return { sharing: sharing - before.sharing, scene: scene - before.scene };
    },
  };
}
