const imageBlock = 0x2c;
const extensionBlock = 0x21;
const trailer = 0x3b;
const screenDescriptorSize = 13;
const frameDescriptorSize = 10;
const maximumFrames = 1000;
const maximumFramePixels = 256 * 1024 * 1024;

interface GifSize {
  readonly width: number;
  readonly height: number;
}

function colorTableBytes(flags: number): number {
  return flags & 0x80 ? 3 * (2 << (flags & 7)) : 0;
}

function hasSignature(view: DataView): boolean {
  if (view.byteLength < screenDescriptorSize || view.getUint32(0) !== 0x47494638) {
    return false;
  }

  const version = view.getUint16(4);

  return version === 0x3761 || version === 0x3961;
}

function skipSubBlocks(bytes: Uint8Array, start: number): number | undefined {
  for (let offset = start; offset < bytes.byteLength;) {
    const count = bytes[offset];
    if (count === 0) {
      return offset + 1;
    }
    if (count === undefined) {
      return undefined;
    }

    offset += count + 1;
  }
}

function readFrame(view: DataView, offset: number, screen: GifSize) {
  if (offset + frameDescriptorSize >= view.byteLength) {
    return undefined;
  }

  const left = view.getUint16(offset + 1, true);
  const top = view.getUint16(offset + 3, true);
  const width = view.getUint16(offset + 5, true);
  const height = view.getUint16(offset + 7, true);
  const emptyFrame = width === 0 || height === 0;
  const outsideScreen = left + width > screen.width || top + height > screen.height;
  if (emptyFrame || outsideScreen) {
    return undefined;
  }

  const flags = view.getUint8(offset + 9);
  const data = offset + frameDescriptorSize + colorTableBytes(flags);
  if (data + 1 >= view.byteLength) {
    return undefined;
  }

  const codeSize = view.getUint8(data);
  if (codeSize < 2 || codeSize > 8 || view.getUint8(data + 1) === 0) {
    return undefined;
  }

  return data + 1;
}

export function readGifSize(bytes: Uint8Array): GifSize | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!hasSignature(view)) {
    return undefined;
  }

  const screen = { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  let offset = screenDescriptorSize + colorTableBytes(view.getUint8(10));
  let frames = 0;

  while (offset < bytes.byteLength) {
    const tag = bytes[offset];
    if (tag === trailer) {
      return frames > 0 && offset + 1 === bytes.byteLength ? screen : undefined;
    }

    let data = offset + 2;
    if (tag === imageBlock) {
      const frame = readFrame(view, offset, screen);
      if (frame === undefined) {
        return undefined;
      }

      data = frame;
      frames += 1;
    } else if (tag !== extensionBlock) {
      return undefined;
    }

    const next = skipSubBlocks(bytes, data);
    const pixels = frames * screen.width * screen.height;
    if (next === undefined || frames > maximumFrames || pixels > maximumFramePixels) {
      return undefined;
    }

    offset = next;
  }
}
