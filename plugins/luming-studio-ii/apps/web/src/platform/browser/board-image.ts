const maximumFileBytes = 8 * 1024 * 1024;
const maximumSvgBytes = 1024 * 1024;
const maximumEdge = 16_384;
const maximumPixels = 32 * 1024 * 1024;
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

interface ImageHeader extends ImageDimensions {
  readonly mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
}

export interface PreparedBoardImage extends ImageDimensions {
  readonly displayName: string;
  readonly content: Uint8Array;
  readonly previewUrl?: string;
  readonly dispose: () => void;
}

function pngDimensions(view: DataView): ImageDimensions | undefined {
  if (
    view.byteLength < 33 ||
    !pngSignature.every((value, index) => view.getUint8(index) === value)
  ) {
    return undefined;
  }
  if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) {
    return undefined;
  }

  let offset = 33;
  while (offset + 12 <= view.byteLength) {
    const size = view.getUint32(offset);
    const type = view.getUint32(offset + 4);
    if (size > view.byteLength - offset - 12 || type === 0x6163544c) {
      return undefined;
    }
    if (type === 0x49444154) {
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }

    offset += size + 12;
  }
}

function jpegMarker(view: DataView, start: number): number | undefined {
  if (view.getUint8(start) !== 0xff) {
    return undefined;
  }

  let offset = start + 1;
  while (offset < view.byteLength && view.getUint8(offset) === 0xff) {
    offset++;
  }

  return offset + 2 < view.byteLength ? offset : undefined;
}

function jpegDimensions(view: DataView): ImageDimensions | undefined {
  if (view.byteLength < 10 || view.getUint16(0) !== 0xffd8) {
    return undefined;
  }

  let offset = 2;
  while (offset < view.byteLength) {
    const markerOffset = jpegMarker(view, offset);
    if (markerOffset === undefined) {
      return undefined;
    }

    const marker = view.getUint8(markerOffset);
    if (marker === 0xda || marker === 0xd9 || marker === 0) {
      return undefined;
    }

    const size = view.getUint16(markerOffset + 1);
    if (size < 2 || size > view.byteLength - markerOffset - 1) {
      return undefined;
    }
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return size >= 8 && view.getUint8(markerOffset + 3) === 8
        ? { width: view.getUint16(markerOffset + 6), height: view.getUint16(markerOffset + 4) }
        : undefined;
    }

    offset = markerOffset + 1 + size;
  }
}

function webpExtendedDimensions(view: DataView, size: number): ImageDimensions | undefined {
  if (size !== 10 || (view.getUint8(20) & 2) !== 0) {
    return undefined;
  }

  return {
    width: (view.getUint32(23, true) & 0xffffff) + 1,
    height: view.getUint16(26, true) + 65_536 * view.getUint8(28) + 1,
  };
}

function webpLossyDimensions(view: DataView, size: number): ImageDimensions | undefined {
  if (size < 10 || (view.getUint8(20) & 1) !== 0) {
    return undefined;
  }
  if (view.getUint16(23) !== 0x9d01 || view.getUint8(25) !== 0x2a) {
    return undefined;
  }

  return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
}

function webpDimensions(view: DataView): ImageDimensions | undefined {
  if (view.byteLength < 25 || view.getUint32(4, true) + 8 !== view.byteLength) {
    return undefined;
  }
  if (view.getUint32(0) !== 0x52494646 || view.getUint32(8) !== 0x57454250) {
    return undefined;
  }

  const size = view.getUint32(16, true);
  if (size > view.byteLength - 20) {
    return undefined;
  }

  switch (view.getUint32(12)) {
    case 0x56503858:
      return webpExtendedDimensions(view, size);
    case 0x56503820:
      return webpLossyDimensions(view, size);
    case 0x5650384c: {
      if (size < 5 || view.getUint8(20) !== 0x2f) {
        return undefined;
      }

      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
  }
}

function gifDimensions(view: DataView): ImageDimensions | undefined {
  if (view.byteLength < 14 || view.getUint32(0) !== 0x47494638) {
    return undefined;
  }

  const version = view.getUint16(4);
  if (version !== 0x3761 && version !== 0x3961) {
    return undefined;
  }

  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

function svgDimensions(buffer: ArrayBuffer): ImageDimensions | undefined {
  const header = new TextDecoder()
    .decode(buffer.slice(0, 4096))
    .replace(/^\s*<\?xml\b[^?]*\?>/u, '')
    .replace(/<!--[\s\S]*?-->/gu, '');
  const attributes = /^\s*<svg\b([^>]*)>/u.exec(header)?.[1];
  if (attributes === undefined) {
    return undefined;
  }

  const viewBox = /\sviewBox\s*=\s*(["'])(.*?)\1/u.exec(attributes)?.[2];
  const bounds = viewBox
    ?.trim()
    .split(/[\s,]+/u)
    .map(Number);
  const width = /\swidth\s*=\s*(["'])(\d+(?:\.\d+)?|\.\d+)(?:px)?\1/u.exec(attributes)?.[2];
  const height = /\sheight\s*=\s*(["'])(\d+(?:\.\d+)?|\.\d+)(?:px)?\1/u.exec(attributes)?.[2];

  return {
    width: Math.ceil(Number(width ?? bounds?.[2] ?? 300)),
    height: Math.ceil(Number(height ?? bounds?.[3] ?? 150)),
  };
}

const imageFormats = [
  ['image/png', pngDimensions],
  ['image/jpeg', jpegDimensions],
  ['image/webp', webpDimensions],
  ['image/gif', gifDimensions],
] as const;

function inspectImage(buffer: ArrayBuffer): ImageHeader {
  const view = new DataView(buffer);
  for (const [mime, inspect] of imageFormats) {
    const dimensions = inspect(view);
    if (dimensions) {
      return { ...dimensions, mime };
    }
  }

  throw new Error('请选择有效的 PNG、JPEG、WebP、GIF 或 SVG 图片。');
}

function verifyDimensions({ width, height }: ImageDimensions): void {
  if (!(width > 0 && height > 0)) {
    throw new Error('无法取得图片尺寸。');
  }
  if (width > maximumEdge || height > maximumEdge || width * height > maximumPixels) {
    throw new Error('图片尺寸过大。每边最多 16,384 像素，总像素最多 33,554,432。');
  }
}

function loadImageDimensions(url: string, signal?: AbortSignal): Promise<ImageDimensions> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    function detach() {
      signal?.removeEventListener('abort', cancel);
      image.onload = null;
      image.onerror = null;
      image.removeAttribute('src');
    }

    function cancel() {
      detach();
      reject(new DOMException('图片读取已取消。', 'AbortError'));
    }

    image.onload = () => {
      const { naturalWidth: width, naturalHeight: height } = image;
      detach();
      resolve({ width, height });
    };
    image.onerror = () => {
      detach();
      reject(new Error('无法打开这张图片。'));
    };

    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) {
      cancel();
      return;
    }

    image.src = url;
  });
}

export async function prepareBoardImage(
  file: File,
  signal?: AbortSignal,
): Promise<PreparedBoardImage> {
  if (file.size > maximumFileBytes) {
    throw new Error('图片大小不能超过 8 MiB。');
  }

  signal?.throwIfAborted();
  const buffer = await file.arrayBuffer();
  signal?.throwIfAborted();

  const svg = svgDimensions(buffer);
  if (svg) {
    if (buffer.byteLength > maximumSvgBytes) {
      throw new Error('SVG 图片大小不能超过 1 MiB。');
    }

    verifyDimensions(svg);

    return {
      ...svg,
      displayName: file.name,
      content: new Uint8Array(buffer),
      dispose: () => undefined,
    };
  }

  const header = inspectImage(buffer);
  verifyDimensions(header);

  const previewUrl = URL.createObjectURL(new Blob([buffer], { type: header.mime }));
  function dispose() {
    URL.revokeObjectURL(previewUrl);
  }

  try {
    const dimensions = await loadImageDimensions(previewUrl, signal);
    verifyDimensions(dimensions);
    signal?.throwIfAborted();

    return {
      ...dimensions,
      displayName: file.name,
      content: new Uint8Array(buffer),
      previewUrl,
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
