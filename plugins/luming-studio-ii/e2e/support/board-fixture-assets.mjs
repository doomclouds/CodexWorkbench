import { readFile } from "node:fs/promises";

const clip = new URL("../../apps/server/tests/fixtures/blue-frame.webm", import.meta.url);
const pixel =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0aDjAwMDAxAAGUAoAHFQBhrzYfPQAAAAASUVORK5CYII=";

export function fixturePng() {
  return Buffer.from(pixel, "base64");
}

async function asset(name) {
  switch (name) {
    case "blue-frame":
      return { filename: "blue-frame.webm", mimeType: "video/webm", bytes: await readFile(clip) };
    case "pixel-image":
      return { filename: "sample.png", mimeType: "image/png", bytes: fixturePng() };
    case "board-svg":
      return {
        filename: "sample.svg",
        mimeType: "image/svg+xml",
        bytes: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90">' +
            '<rect width="120" height="90" rx="8" fill="#217a77"/>' +
            '<circle cx="57" cy="44" r="28" fill="#f7ab48"/></svg>',
        ),
      };
    default:
      throw new Error("Select a registered board archive asset.");
  }
}

export async function materializeBoardAssets(objects, boardId) {
  const files = new Map();
  const materialized = [];
  for (const object of objects) {
    const id = object.mediaFixture;
    if (!id) {
      materialized.push(object);
      continue;
    }

    if (!files.has(id)) {
      const { bytes, mimeType, filename } = await asset(id);
      const info = { id, filename, mimeType, size: bytes.byteLength };
      files.set(id, { info, bytes });
    }

    materialized.push({ ...object, src: "/assets/" + boardId + "/" + id });
  }

  const entries = [...files];
  return {
    objects: materialized,
    entries: Object.fromEntries(entries.map(([id, { bytes }]) => ["assets/" + id, bytes])),
    index: Object.fromEntries(entries.map(([id, { info }]) => [id, info])),
  };
}
