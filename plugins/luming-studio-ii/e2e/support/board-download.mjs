import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireInitial = createRequire(
  new URL("../../../luming-studio/package.json", import.meta.url),
);
const { unzipSync } = requireInitial("fflate");
const maximumBytes = 8 * 1024 * 1024;
const extensions = new Map([
  ["json", ".json"],
  ["png", ".png"],
  ["svg", ".svg"],
  ["zip", ".studio.zip"],
]);
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function readMimeType(page, download) {
  const url = URL.parse(download.url());
  const samePage = url?.origin === new URL(page.url()).origin;
  assert.ok(url?.protocol === "blob:" && samePage, "Expected this page to own the download.");
  return page.evaluate(async (source) => {
    const response = await fetch(source);
    const mediaType = response.headers.get("content-type");
    await response.body?.cancel();
    return mediaType?.split(";", 1)[0]?.trim();
  }, url.href);
}

async function readBytes(download) {
  const chunks = [];
  let size = 0;
  for await (const chunk of await download.createReadStream()) {
    size += chunk.byteLength;
    assert.ok(size <= maximumBytes, "The synthetic board download is too large.");
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

function readArchive(bytes) {
  const manifestName = "manifest.json";
  const stateName = "artifact-deltas.ndjson";
  const archive = unzipSync(bytes, {
    filter({ name, originalSize }) {
      return originalSize <= maximumBytes && (name === manifestName || name === stateName);
    },
  });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  assert.ok(archive[manifestName] && archive[stateName], "Expected a complete board archive.");

  return {
    manifest: JSON.parse(decoder.decode(archive[manifestName])),
    state: decoder.decode(archive[stateName]),
  };
}

function readContents(bytes, format) {
  if (format === "zip") {
    return readArchive(bytes);
  }

  if (format === "png") {
    assert.ok(bytes.subarray(0, 8).equals(pngSignature), "Expected PNG file bytes.");
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }

  return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
}

export async function readBoardDownload(page, download, format) {
  const suffix = extensions.get(format);
  const filename = download.suggestedFilename();
  assert.ok(suffix && filename.endsWith(suffix), "Expected the chosen board export format.");
  const mimeType = await readMimeType(page, download);
  const bytes = await readBytes(download);

  return { filename, mimeType, ...readContents(bytes, format) };
}

export async function downloadBoardExport(page, studio, formatButton) {
  const dialog =
    studio.edition === "ii"
      ? page.getByRole("dialog", { name: "下载导出文件", exact: true })
      : undefined;

  if (dialog && formatButton) {
    await formatButton.click();
  }

  const trigger = dialog?.getByRole("button", { name: "下载", exact: true }) ?? formatButton;
  assert.ok(trigger, "Expected the board export download control.");
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15_000 }),
    trigger.click(),
  ]);
  await dialog?.waitFor({ state: "hidden" });

  return download;
}

export async function failNextBoardExport(page, studio) {
  const path =
    studio.edition === "initial"
      ? "/api/tools/artifact_export"
      : "/luming.studio.v1.WhiteboardService/ExportBoard";
  await page.route(new URL(path, studio.url).href, (route) => route.abort(), { times: 1 });
}
