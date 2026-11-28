import { Buffer } from 'node:buffer';
import type { ObjectPayload } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/payload';
import type { ExportBoardFile } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { readModelBytes, type ModelToolOptions } from './model-tool.js';

const maximumImageBytes = 640 * 1024;
const maxPreviewPixels = 16_000_000;
const assetPath = /^\/studio-archive-assets\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})$/u;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function png(data: Buffer) {
  if (data.byteLength < 24 || !data.subarray(0, 8).equals(pngSignature)) {
    return false;
  }

  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  return width > 0 && height > 0 && width * height <= maxPreviewPixels;
}

function imageType(content: Buffer): string | undefined {
  if (png(content)) {
    return 'image/png';
  }
  if (content[0] === 255 && content[1] === 216 && content[2] === 255) {
    return 'image/jpeg';
  }

  const prefix = content.subarray(0, 12).toString('ascii');
  if (prefix.startsWith('RIFF') && prefix.endsWith('WEBP')) {
    return 'image/webp';
  }
  if (prefix.startsWith('GIF87a') || prefix.startsWith('GIF89a')) {
    return 'image/gif';
  }
}

function imageBlock(content: Buffer, mimeType: string) {
  return { type: 'image' as const, mimeType, data: content.toString('base64') };
}

export function savedPreview(file: ExportBoardFile, revision: bigint) {
  if (file.revision !== revision || file.mimeType !== 'image/png') {
    return;
  }
  if (file.content.byteLength > maximumImageBytes) {
    return;
  }

  const content = Buffer.from(file.content);
  if (png(content)) {
    return imageBlock(content, file.mimeType);
  }
}

function storedImage(payload: ObjectPayload) {
  if (payload.body.case === 'image') {
    return { source: payload.body.value.src, origin: 'originalImage' as const };
  }
  if (payload.body.case === 'video') {
    return { source: payload.body.value.poster, origin: 'savedVideoPoster' as const };
  }
}

export async function readContextImage(
  options: ModelToolOptions,
  boardId: string,
  payload: ObjectPayload,
  signal: AbortSignal,
) {
  const stored = storedImage(payload);
  const match = stored?.source && assetPath.exec(stored.source);
  if (!stored || !match || match[1] !== boardId) {
    return { kind: 'unavailable' as const, reason: 'noLocalImage' };
  }

  const route = '/studio-archive-assets/' + boardId + '/' + match[2];
  const response = await options.dispatch({ route, method: 'GET' }, signal);
  if (!response.ok) {
    await response.body?.cancel();
    return { kind: 'unavailable' as const, reason: 'assetUnavailable' };
  }

  const content = Buffer.from(await readModelBytes(response, maximumImageBytes));
  signal.throwIfAborted();
  const mimeType = imageType(content);
  const declared = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
  if (!mimeType || mimeType !== declared) {
    return { kind: 'unavailable' as const, reason: 'unsupportedImage' };
  }

  return { kind: 'image' as const, origin: stored.origin, block: imageBlock(content, mimeType) };
}
