import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireServer = createRequire(new URL("../../apps/server/package.json", import.meta.url));
const { fromBinary, toBinary } = requireServer("@bufbuild/protobuf");
const { GetBoardThumbnailResponseSchema } = requireServer(
  "@codexworkbench/luming-studio-ii-contracts/catalog/service",
);

async function serveCorruptPreview(route, initial) {
  const response = await route.fetch({ maxRedirects: 0 });
  assert.ok(response.ok(), "The real authorized thumbnail request must succeed");
  const broken = Buffer.from("This fixture is not an SVG image.");
  if (initial) {
    await route.fulfill({ response, body: broken, contentType: "image/svg+xml" });
    return;
  }

  const preview = fromBinary(GetBoardThumbnailResponseSchema, await response.body());
  assert.ok(preview.thumbnail, "The fixture must have a saved cover");
  preview.thumbnail.content = broken;
  await route.fulfill({
    response,
    body: Buffer.from(toBinary(GetBoardThumbnailResponseSchema, preview)),
  });
}

export async function controlNextThumbnail(page, studio, mode) {
  assert.ok(mode === "hold" || mode === "corrupt");
  const origin = new URL(studio.url).origin;
  const initial = studio.edition === "initial";
  const path = initial
    ? "/api/thumbnails/"
    : "/luming.studio.v1.BoardCatalogService/GetBoardThumbnail";
  const { promise, resolve: release } = Promise.withResolvers();
  let requested = false;

  await page.route(
    (url) =>
      url.origin === origin && (initial ? url.pathname.startsWith(path) : url.pathname === path),
    async (route) => {
      requested = true;
      if (mode === "hold") {
        await promise;
        await route.continue();
      } else {
        await serveCorruptPreview(route, initial);
      }
    },
    { times: 1 },
  );

  return { started: () => requested, release };
}
