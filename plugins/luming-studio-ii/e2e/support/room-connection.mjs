import assert from "node:assert/strict";

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
