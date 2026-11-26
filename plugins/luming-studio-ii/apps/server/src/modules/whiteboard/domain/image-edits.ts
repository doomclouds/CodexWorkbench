import type { BoardChanges, BoardEditAsset, BoardEditRejected } from './board-edits.js';
import { geometryInWorld } from './geometry-edits.js';
import type { Geometry } from './model.js';

export interface ImageOperation {
  readonly objectId: string;
  readonly displayName: string;
  readonly geometry: Geometry;
  readonly content: Uint8Array;
}

interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

interface ImageChanges extends BoardChanges {
  readonly assets: readonly [BoardEditAsset];
}

const assetIdPrefix = 'image-';
const archiveAssetPath = '/studio-archive-assets/';
const pathSegment = /^[A-Za-z0-9_-]{1,128}$/u;
const unsafeName = /[/\\]|\p{Cc}|^[A-Za-z]:/u;
const maximumDisplayName = 160;
const maximumImageBytes = 8 * 1024 * 1024;
const maximumDimension = 16_384;
const maximumPixels = 32 * 1024 * 1024;

const pngSignatureStart = 0x8950_4e47;
const pngSignatureEnd = 0x0d0a_1a0a;
const pngHeaderSize = 13;
const pngHeaderOffset = 8;
const pngFirstDataOffset = 33;
const pngChunkOverhead = 12;
const pngBitDepths = new Map([
  [0, [1, 2, 4, 8, 16]],
  [2, [8, 16]],
  [3, [1, 2, 4, 8]],
  [4, [8, 16]],
  [6, [8, 16]],
]);

const jpegStart = 0xffd8;
const jpegMarkerPrefix = 0xff;
const jpegEnd = 0xd9;
const jpegScan = 0xda;
const jpegFrameMarkers = new Set([0xc0, 0xc1, 0xc2]);

const riffHeaderSize = 12;
const riffChunkHeaderSize = 8;
const vp8DimensionMask = 0x3fff;
const vp8StartCode = 0x9d01_2a;
const vp8HeaderSize = 10;

function fourCc(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function validDimensions({ width, height }: ImageDimensions): boolean {
  const withinDimensions = [width, height].every(
    (dimension) => dimension > 0 && dimension <= maximumDimension,
  );

  return withinDimensions && width * height <= maximumPixels;
}

function hasPngSignature(view: DataView): boolean {
  return (
    view.byteLength >= pngFirstDataOffset &&
    view.getUint32(0) === pngSignatureStart &&
    view.getUint32(4) === pngSignatureEnd
  );
}

function hasValidPngHeader(view: DataView): boolean {
  if (view.getUint32(pngHeaderOffset) !== pngHeaderSize || fourCc(view, 12) !== 'IHDR') {
    return false;
  }

  const depths = pngBitDepths.get(view.getUint8(25));
  const validMethods = view.getUint8(26) === 0 && view.getUint8(27) === 0;

  return Boolean(depths?.includes(view.getUint8(24)) && validMethods && view.getUint8(28) <= 1);
}

function hasCompletePngData(view: DataView): boolean {
  let hasImageData = false;
  const needsPalette = view.getUint8(25) === 3;
  let hasPalette = false;
  let imageDataClosed = false;

  for (let offset = pngFirstDataOffset; offset + pngChunkOverhead <= view.byteLength;) {
    const length = view.getUint32(offset);
    const type = fourCc(view, offset + 4);
    const end = offset + pngChunkOverhead + length;
    if (end > view.byteLength || type === 'IHDR' || type === 'acTL') {
      return false;
    }
    if (type === 'IEND') {
      return hasImageData && length === 0 && end === view.byteLength;
    }

    if (type === 'PLTE') {
      if (hasPalette || hasImageData || length === 0) {
        return false;
      }

      hasPalette = length <= 768 && length % 3 === 0;
      if (!hasPalette) {
        return false;
      }
    }
    if (type === 'IDAT') {
      const paletteMissing = needsPalette && !hasPalette;
      if (imageDataClosed || paletteMissing) {
        return false;
      }

      hasImageData ||= length > 0;
    } else {
      imageDataClosed ||= hasImageData;
    }

    offset = end;
  }

  return false;
}

function readPngSize(view: DataView): ImageDimensions | undefined {
  if (!hasValidPngHeader(view)) {
    return undefined;
  }

  const size = { width: view.getUint32(16), height: view.getUint32(20) };

  return validDimensions(size) && hasCompletePngData(view) ? size : undefined;
}

function jpegMarkerOffset(bytes: Uint8Array, prefix: number): number {
  let offset = prefix + 1;
  while (bytes[offset] === jpegMarkerPrefix) {
    offset += 1;
  }

  return offset;
}

function isRestartMarker(marker: number): boolean {
  return marker >= 0xd0 && marker <= 0xd7;
}

function findJpegScanEnd(bytes: Uint8Array, start: number): number {
  let prefix = bytes.indexOf(jpegMarkerPrefix, start);
  while (prefix !== -1) {
    const offset = jpegMarkerOffset(bytes, prefix);
    const marker = bytes[offset];
    if (marker === undefined) {
      return -1;
    }
    if (marker !== 0 && !isRestartMarker(marker)) {
      return prefix;
    }

    prefix = bytes.indexOf(jpegMarkerPrefix, offset + 1);
  }

  return -1;
}

function readJpegFrame(
  view: DataView,
  segment: number,
  length: number,
): ImageDimensions | undefined {
  if (length < 8 || view.getUint8(segment + 2) !== 8) {
    return undefined;
  }

  const components = view.getUint8(segment + 7);
  if (![1, 3, 4].includes(components) || length !== 8 + 3 * components) {
    return undefined;
  }

  const size = { width: view.getUint16(segment + 5), height: view.getUint16(segment + 3) };

  return validDimensions(size) ? size : undefined;
}

function validJpegScanHeader(view: DataView, segment: number, length: number): boolean {
  if (length < 6) {
    return false;
  }

  const components = view.getUint8(segment + 2);

  return components > 0 && components <= 4 && length === 6 + 2 * components;
}

function readJpegSize(view: DataView, bytes: Uint8Array): ImageDimensions | undefined {
  let size: ImageDimensions | undefined;
  let hasScan = false;

  for (let offset = 2; bytes[offset] === jpegMarkerPrefix;) {
    const markerOffset = jpegMarkerOffset(bytes, offset);
    const marker = bytes[markerOffset];
    const segment = markerOffset + 1;
    if (marker === jpegEnd) {
      return hasScan && segment === view.byteLength ? size : undefined;
    }

    const markerOutOfRange = marker === undefined || marker < 0xc0 || marker === 0xd8;
    if (markerOutOfRange || isRestartMarker(marker) || segment + 2 > view.byteLength) {
      return undefined;
    }

    const length = view.getUint16(segment);
    const end = segment + length;
    if (length < 2 || end > view.byteLength) {
      return undefined;
    }

    if (jpegFrameMarkers.has(marker)) {
      if (size) {
        return undefined;
      }

      size = readJpegFrame(view, segment, length);
      if (!size) {
        return undefined;
      }
    }
    if (marker !== jpegScan) {
      offset = end;
      continue;
    }
    if (!size || !validJpegScanHeader(view, segment, length)) {
      return undefined;
    }

    offset = findJpegScanEnd(bytes, end);
    if (offset <= end) {
      return undefined;
    }

    hasScan = true;
  }

  return undefined;
}

function uint24le(view: DataView, offset: number): number {
  return view.getUint16(offset, true) + view.getUint8(offset + 2) * 65536;
}

function readWebpCanvas(
  view: DataView,
  offset: number,
  length: number,
): ImageDimensions | undefined {
  if (length !== 10 || (view.getUint32(offset, true) & 0xffff_ffc3) !== 0) {
    return undefined;
  }

  const width = uint24le(view, offset + 4) + 1;
  const height = uint24le(view, offset + 7) + 1;
  const size = { width, height };

  return validDimensions(size) ? size : undefined;
}

function readVp8Size(view: DataView, offset: number, length: number): ImageDimensions | undefined {
  if (length <= vp8HeaderSize) {
    return undefined;
  }

  const frameTag = uint24le(view, offset);
  const partitionSize = frameTag >>> 5;
  const startCode = view.getUint32(offset + 2) & 0x00ff_ffff;
  const invalidPartition = partitionSize === 0 || partitionSize > length - vp8HeaderSize;
  if ((frameTag & 1) !== 0 || invalidPartition || startCode !== vp8StartCode) {
    return undefined;
  }

  return {
    width: view.getUint16(offset + 6, true) & vp8DimensionMask,
    height: view.getUint16(offset + 8, true) & vp8DimensionMask,
  };
}

function readVp8LosslessSize(
  view: DataView,
  offset: number,
  length: number,
): ImageDimensions | undefined {
  if (length <= 5 || view.getUint8(offset) !== 0x2f) {
    return undefined;
  }

  const header = view.getUint32(offset + 1, true);
  if (header >>> 29 !== 0) {
    return undefined;
  }

  return {
    width: (header & vp8DimensionMask) + 1,
    height: ((header >>> 14) & vp8DimensionMask) + 1,
  };
}

function matchingSize(left: ImageDimensions, right: ImageDimensions): boolean {
  return left.width === right.width && left.height === right.height;
}

function hasWebpSignature(view: DataView): boolean {
  return (
    view.byteLength >= riffHeaderSize && fourCc(view, 0) === 'RIFF' && fourCc(view, 8) === 'WEBP'
  );
}

function readWebpChunk(view: DataView, offset: number) {
  const type = fourCc(view, offset);
  const length = view.getUint32(offset + 4, true);
  const start = offset + riffChunkHeaderSize;
  const end = start + length + (length % 2);
  const animation = type === 'ANIM' || type === 'ANMF';
  if (end > view.byteLength || animation) {
    return undefined;
  }
  if (length % 2 === 1 && view.getUint8(end - 1) !== 0) {
    return undefined;
  }

  return { type, length, start, end };
}

function readWebpSize(view: DataView): ImageDimensions | undefined {
  if (view.getUint32(4, true) !== view.byteLength - 8) {
    return undefined;
  }

  let canvas: ImageDimensions | undefined;
  let size: ImageDimensions | undefined;
  let offset = riffHeaderSize;

  while (offset + riffChunkHeaderSize <= view.byteLength) {
    const chunk = readWebpChunk(view, offset);
    if (!chunk) {
      return undefined;
    }

    const { type, length, start, end } = chunk;
    if (type === 'VP8X') {
      canvas = readWebpCanvas(view, start, length);
      if (offset !== riffHeaderSize || !canvas) {
        return undefined;
      }
    } else if (type === 'VP8 ' || type === 'VP8L') {
      if (size) {
        return undefined;
      }

      size =
        type === 'VP8 '
          ? readVp8Size(view, start, length)
          : readVp8LosslessSize(view, start, length);

      if (!size || !validDimensions(size)) {
        return undefined;
      }
    } else if (!canvas) {
      return undefined;
    }

    offset = end;
  }

  if (offset !== view.byteLength || !size) {
    return undefined;
  }

  return !canvas || matchingSize(canvas, size) ? size : undefined;
}

function inspectImage(content: Uint8Array) {
  const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
  if (hasPngSignature(view)) {
    return { mimeType: 'image/png', size: readPngSize(view) };
  }
  if (view.byteLength >= 2 && view.getUint16(0) === jpegStart) {
    return { mimeType: 'image/jpeg', size: readJpegSize(view, content) };
  }
  if (hasWebpSignature(view)) {
    return { mimeType: 'image/webp', size: readWebpSize(view) };
  }

  return undefined;
}

function validImagePlacement(boardId: string, assetId: string, operation: ImageOperation): boolean {
  const { objectId, displayName, geometry } = operation;
  const idsFitPath = [boardId, objectId, assetId].every((id) => pathSegment.test(id));
  const validName = displayName.length <= maximumDisplayName && !unsafeName.test(displayName);
  const positiveSize = geometry.width > 0 && geometry.height > 0;

  return idsFitPath && validName && positiveSize && geometryInWorld(geometry);
}

export function planImageChanges(
  boardId: string,
  operation: ImageOperation,
): ImageChanges | BoardEditRejected {
  const { objectId, displayName, geometry, content } = operation;
  const assetId = assetIdPrefix + objectId;
  if (content.byteLength > maximumImageBytes) {
    return { kind: 'rejected', reason: 'tooLarge' };
  }
  if (!validImagePlacement(boardId, assetId, operation)) {
    return { kind: 'rejected', reason: 'invalidEdit' };
  }

  const image = inspectImage(content);
  if (!image?.size) {
    return { kind: 'rejected', reason: 'invalidImage' };
  }

  return {
    kind: 'changes',
    objects: [
      {
        objectId,
        kind: 'image',
        label: displayName.trim() || '图片',
        geometry,
        geometryVersion: 0n,
        payloadVersion: 0n,
        locked: false,
      },
    ],
    payloads: [
      {
        objectId,
        bodyKind: 'image',
        payloadVersion: 0n,
        data: {
          src: archiveAssetPath + boardId + '/' + assetId,
          naturalSize: { ...image.size },
        },
      },
    ],
    assets: [{ assetId, mimeType: image.mimeType, bytes: content }],
  };
}
