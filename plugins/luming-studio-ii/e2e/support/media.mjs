import { readFile } from "node:fs/promises";

const clip = new URL("../../apps/server/tests/fixtures/blue-frame.webm", import.meta.url);
const art =
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">' +
  '<rect width="320" height="180" fill="#217a77"/><rect width="96" height="180" fill="#f7ab48"/>' +
  '<circle cx="214" cy="86" r="44" fill="#fdf0d5"/></svg>';

async function mediaFile(fixture) {
  switch (fixture) {
    case "image":
      return { name: "裁剪样图.svg", mimeType: "image/svg+xml", buffer: Buffer.from(art) };
    case "invalid-image":
      return {
        name: "无法读取.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Synthetic unsupported media"),
      };
    case "video":
      return { name: "真实播放.webm", mimeType: "video/webm", buffer: await readFile(clip) };
    default:
      throw new Error("Select a registered board media fixture.");
  }
}

export async function chooseBoardMedia(page, action, fixture) {
  const file = await mediaFile(fixture);
  const [picker] = await Promise.all([page.waitForEvent("filechooser"), action()]);
  await picker.setFiles(file);
}

export function mediaDisplaySize(locator) {
  return locator.evaluate((element) => {
    const media = element instanceof HTMLImageElement ? element : element.querySelector("video");
    if (!media) {
      return undefined;
    }

    const parent = element.getBoundingClientRect();
    const bounds = media.getBoundingClientRect();
    return {
      x: Math.round(bounds.x - parent.x),
      y: Math.round(bounds.y - parent.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
      naturalWidth: media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth,
      naturalHeight: media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight,
      controls: media instanceof HTMLVideoElement ? media.controls : undefined,
    };
  });
}

export function mediaPlaying(canvas) {
  return canvas.evaluate((element) => {
    const video = element.querySelector("video[controls]");

    return Boolean(video?.played.length && video.currentTime > 0);
  });
}
