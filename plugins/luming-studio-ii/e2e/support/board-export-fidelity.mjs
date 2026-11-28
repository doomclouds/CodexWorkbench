import assert from "node:assert/strict";

const maxBytes = 16 * 1024 * 1024;
const imageTypes = new Map([
  ["png", "image/png"],
  ["svg", "image/svg+xml"],
]);

async function downloadBytes(download, format) {
  const filename = download.suggestedFilename();
  assert.ok(
    filename.endsWith("." + format),
    "Expected a real browser download in the chosen format.",
  );
  const chunks = [];
  let size = 0;
  for await (const chunk of await download.createReadStream()) {
    size += chunk.byteLength;
    assert.ok(size <= maxBytes, "Synthetic export exceeded the fixture budget.");
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

export async function inspectImage(page, bytes, mimeType, colors) {
  return page.evaluate(
    async ({ data, mimeType, colors }) => {
      const image = new Image();
      image.src = `data:${mimeType};base64,${data}`;
      await image.decode();
      const { naturalWidth: width, naturalHeight: height } = image;
      if (width * height > 4_000_000 || width < 1 || height < 1) {
        throw new Error("The synthetic image is outside the expected decoding budget.");
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, width, height).data;
      const palette = Object.entries(colors);
      const counts = Object.fromEntries(palette.map(([key]) => [key, 0]));
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (pixels[offset + 3] < 220) {
          continue;
        }

        for (const [key, rgb] of palette) {
          if (rgb.every((channel, index) => Math.abs(pixels[offset + index] - channel) <= 8)) {
            counts[key]++;
          }
        }
      }

      return { width, height, counts };
    },
    { data: bytes.toString("base64"), mimeType, colors },
  );
}

async function inspectHtml(page, bytes) {
  const url = new URL("/__studio_e2e_export_preview", page.url());
  assert.equal(url.hostname, "127.0.0.1");
  const preview = await page.context().newPage();
  try {
    await preview.route("**/*", (route) =>
      route.request().url() === url.href
        ? route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: bytes })
        : route.abort(),
    );
    await preview.goto(url.href);
    const surface = await preview.evaluate(() => ({
      text: document.body.innerText,
      rows: document.querySelectorAll("table tr").length,
      pictures: document.querySelectorAll("img, svg image").length,
      videos: document.querySelectorAll("video").length,
      embedded: document.querySelectorAll("iframe").length,
    }));
    const frames = preview.frames().filter((frame) => frame !== preview.mainFrame());
    const rendered = await Promise.all(frames.map((frame) => frame.locator("body").innerText()));

    return { ...surface, rendered };
  } finally {
    await preview.close();
  }
}

export async function inspectBoardExport(page, download, format, colors = {}) {
  const bytes = await downloadBytes(download, format);
  if (format === "html") {
    return inspectHtml(page, bytes);
  }
  if (format === "json") {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }

  const mimeType = imageTypes.get(format);
  assert.ok(mimeType, "Expected an exported SVG or PNG image.");
  const painted = await inspectImage(page, bytes, mimeType, colors);

  return {
    ...painted,
    markup: format === "svg" ? new TextDecoder("utf-8", { fatal: true }).decode(bytes) : undefined,
  };
}
