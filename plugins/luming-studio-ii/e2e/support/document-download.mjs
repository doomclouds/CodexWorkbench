import assert from "node:assert/strict";
import { fixturePng } from "./board-fixture-assets.mjs";

const maximumDownloadSize = 8 * 1024 * 1024;

export async function chooseDocumentImage(page, action) {
  const [picker] = await Promise.all([page.waitForEvent("filechooser"), action()]);
  await picker.setFiles({ name: "文档图片.png", mimeType: "image/png", buffer: fixturePng() });
}

export async function readDocumentDownload(download, format) {
  assert.ok(
    format === "html" || format === "json" || format === "md",
    "Select the document download format.",
  );
  const filename = download.suggestedFilename();
  assert.ok(
    !/[/\\]/u.test(filename) && filename.endsWith("." + format),
    "The browser must suggest a filename in the expected format.",
  );

  const stream = await download.createReadStream();
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.byteLength;
    assert.ok(size <= maximumDownloadSize, "The synthetic document download is too large.");
    chunks.push(chunk);
  }

  return {
    filename,
    text: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
  };
}
