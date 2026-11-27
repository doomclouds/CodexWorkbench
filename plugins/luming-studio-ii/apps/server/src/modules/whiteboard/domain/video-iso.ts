interface Box {
  readonly name: string;
  readonly data: number;
  readonly end: number;
}

const basicHeaderSize = 8;
const extendedHeaderSize = 16;
const maximumBoxes = 65_536;
const compatibleBrands = new Set([
  'isom',
  'iso2',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'avc1',
  'M4V ',
  'dash',
]);

function tag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function readBox(view: DataView, offset: number, bound: number): Box | undefined {
  if (bound - offset < basicHeaderSize) {
    return undefined;
  }

  const declared = view.getUint32(offset);
  const header = declared === 1 ? extendedHeaderSize : basicHeaderSize;
  if (bound - offset < header) {
    return undefined;
  }

  const size = declared === 1 ? Number(view.getBigUint64(offset + basicHeaderSize)) : declared;
  const end = size === 0 ? bound : offset + size;
  if (end < offset + header || end > bound) {
    return undefined;
  }

  return { name: tag(view, offset + 4), data: offset + header, end };
}

function* boxes(view: DataView, start: number, end: number) {
  let offset = start;
  for (let count = 0; count < maximumBoxes && offset < end; count += 1) {
    const box = readBox(view, offset, end);
    if (!box) {
      return;
    }

    yield box;
    offset = box.end;
  }
}

function child(view: DataView, parent: Box, name: string): Box | undefined {
  for (const box of boxes(view, parent.data, parent.end)) {
    if (box.name === name) {
      return box;
    }
  }
}

function videoTrack(view: DataView, track: Box): boolean {
  const media = child(view, track, 'mdia');
  const handler = media && child(view, media, 'hdlr');
  const handlerOffset = 8;

  return Boolean(
    handler &&
    handler.end - handler.data >= handlerOffset + 4 &&
    tag(view, handler.data + handlerOffset) === 'vide',
  );
}

function hasVideoTrack(view: DataView, metadata: Box): boolean {
  for (const box of boxes(view, metadata.data, metadata.end)) {
    if (box.name === 'trak' && videoTrack(view, box)) {
      return true;
    }
  }

  return false;
}

function classifyBrand(view: DataView, box: Box): 'video/mp4' | 'video/quicktime' | undefined {
  if (box.end - box.data < 8) {
    return undefined;
  }

  const major = tag(view, box.data);
  if (major === 'qt  ') {
    return 'video/quicktime';
  }
  if (compatibleBrands.has(major)) {
    return 'video/mp4';
  }

  for (let offset = box.data + 8; offset + 4 <= box.end; offset += 4) {
    if (compatibleBrands.has(tag(view, offset))) {
      return 'video/mp4';
    }
  }
}

export function inspectIsoVideo(view: DataView) {
  let brand: Box | undefined;
  let video = false;
  let samples = false;
  let consumed = 0;
  for (const box of boxes(view, 0, view.byteLength)) {
    consumed = box.end;
    if (box.name === 'ftyp') {
      brand = box;
    } else if (box.name === 'moov') {
      video = hasVideoTrack(view, box);
    } else if (box.name === 'mdat') {
      samples ||= box.data < box.end;
    }
  }
  if (!video || !samples || consumed !== view.byteLength) {
    return undefined;
  }

  return brand ? classifyBrand(view, brand) : 'video/quicktime';
}
