interface Element {
  readonly id: number;
  readonly data: number;
  readonly end: number;
}

const ebmlHeader = 0x1a45dfa3;
const docType = 0x4282;
const segment = 0x18538067;
const tracks = 0x1654ae6b;
const trackEntry = 0xae;
const trackType = 0x83;
const cluster = 0x1f43b675;
const videoTrackType = 1;
const maximumElements = 65_536;
const decoder = new TextDecoder();

function vint(bytes: Uint8Array, offset: number, maximumWidth: number, isSize: boolean) {
  const first = bytes[offset];
  if (!first) {
    return undefined;
  }

  let mask = 0x80;
  let width = 1;
  while (!(first & mask)) {
    mask >>= 1;
    width += 1;
  }
  const end = offset + width;
  if (width > maximumWidth || end > bytes.length) {
    return undefined;
  }

  let value = isSize ? first & (mask - 1) : first;
  let allOnes = isSize && value === mask - 1;
  for (let index = offset + 1; index < end; index += 1) {
    const byte = bytes[index]!;
    value = value * 256 + byte;
    allOnes &&= byte === 255;
  }

  return { value, end, allOnes };
}

function readElement(bytes: Uint8Array, offset: number, bound: number): Element | undefined {
  const id = vint(bytes, offset, 4, false);
  const size = id && vint(bytes, id.end, 8, true);
  if (!id || !size || size.end > bound) {
    return undefined;
  }

  const end = size.allOnes ? bound : size.end + size.value;
  if (end > bound) {
    return undefined;
  }

  return { id: id.value, data: size.end, end };
}

function* elements(bytes: Uint8Array, start: number, end: number) {
  let offset = start;
  for (let count = 0; count < maximumElements && offset < end; count += 1) {
    const element = readElement(bytes, offset, end);
    if (!element) {
      return;
    }

    yield element;
    offset = element.end;
  }
}

function child(bytes: Uint8Array, parent: Element, id: number): Element | undefined {
  for (const element of elements(bytes, parent.data, parent.end)) {
    if (element.id === id) {
      return element;
    }
  }
}

function hasVideoTrack(bytes: Uint8Array, mediaTracks: Element): boolean {
  for (const entry of elements(bytes, mediaTracks.data, mediaTracks.end)) {
    const type = entry.id === trackEntry ? child(bytes, entry, trackType) : undefined;
    if (type && type.end === type.data + 1 && bytes[type.data] === videoTrackType) {
      return true;
    }
  }

  return false;
}

export function isWebmVideo(bytes: Uint8Array): boolean {
  const root = { id: 0, data: 0, end: bytes.length };
  const header = child(bytes, root, ebmlHeader);
  const type = header && child(bytes, header, docType);
  const webm = type && type.end === type.data + 4;
  if (!webm || decoder.decode(bytes.subarray(type.data, type.end)) !== 'webm') {
    return false;
  }

  const media = child(bytes, root, segment);
  const mediaTracks = media && child(bytes, media, tracks);
  const samples = media && child(bytes, media, cluster);
  const hasSamples = Boolean(samples && samples.end > samples.data);

  return Boolean(mediaTracks && hasSamples && hasVideoTrack(bytes, mediaTracks));
}
