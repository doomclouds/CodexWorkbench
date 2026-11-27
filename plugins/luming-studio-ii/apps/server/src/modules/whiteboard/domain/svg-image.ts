const maximumElements = 4096;
const maximumAttributes = 256;
const maximumDepth = 128;
const maximumSide = 16_384;
const maximumPixels = 32_000_000;
const namespace = 'http://www.w3.org/2000/svg';
const xlinkNamespace = 'http://www.w3.org/1999/xlink';
const xmlDeclaration =
  /^\s*<\?xml\s+version\s*=\s*(['"])1\.0\1(?:\s+encoding\s*=\s*(['"])UTF-8\2)?(?:\s+standalone\s*=\s*(['"])(?:yes|no)\3)?\s*\?>/iu;
const localReference = /^#[A-Za-z_][\w.:-]*$/u;
const localPaint =
  /url\(\s*(?:"#[A-Za-z_][\w.:-]*"|'#[A-Za-z_][\w.:-]*'|#[A-Za-z_][\w.:-]*)\s*\)/giu;
const unsafeReference = /[\\@&]|\b(?:https?|file|data|javascript|blob|ftp):|\/\/|\burl\s*\(/iu;
const textEntity = /&(?:amp|lt|gt|quot|apos|#(\d{1,7})|#x([\da-fA-F]{1,6}));/gu;
const invalidXmlCharacters = /(?:(?![\t\n\r])\p{Cc}|[\ufffe\uffff])/u;
const xmlWhitespace = /[\t\n\r ]*/uy;
const absoluteDimension = /^(\d+(?:\.\d+)?|\.\d+)(?:px)?$/u;
const svgElements = new Set([
  'svg',
  'g',
  'defs',
  'path',
  'rect',
  'line',
  'polyline',
  'polygon',
  'circle',
  'ellipse',
  'text',
  'tspan',
  'textPath',
  'title',
  'desc',
  'style',
  'symbol',
  'use',
  'marker',
  'mask',
  'clipPath',
  'pattern',
  'linearGradient',
  'radialGradient',
  'stop',
  'filter',
  'feGaussianBlur',
  'feColorMatrix',
  'feOffset',
  'feMerge',
  'feMergeNode',
  'feBlend',
  'feComposite',
  'feFlood',
  'feDropShadow',
]);

interface SvgRoot {
  readonly attributes: ReadonlyMap<string, string>;
  readonly end: number;
  readonly empty: boolean;
}

export interface SafeSvgImage {
  readonly markup: string;
  readonly size: { readonly width: number; readonly height: number };
  readonly originalDimensionsMarkup?: string;
}

function safeReferences(value: string): boolean {
  return !unsafeReference.test(value.replace(localPaint, ''));
}

function safeAttribute(name: string, value: string): boolean {
  if (name === 'xmlns') {
    return value === namespace;
  }
  if (name === 'xmlns:xlink') {
    return value === xlinkNamespace;
  }
  if (name === 'xml:space') {
    return value === 'default' || value === 'preserve';
  }
  if (name === 'href' || name === 'xlink:href') {
    return localReference.test(value);
  }

  const asksForResource = /^(?:on|src|background|xmlns|xml)/iu.test(name) || name.includes(':');

  return !asksForResource && safeReferences(value);
}

function readAttributes(tail: string): ReadonlyMap<string, string> | undefined {
  const attributes = new Map<string, string>();
  const assignment = /[\t\n\r ]+([A-Za-z_][\w:-]*)[\t\n\r ]*=[\t\n\r ]*(?:"([^"]*)"|'([^']*)')/uy;
  let offset = 0;
  while (offset < tail.length) {
    assignment.lastIndex = offset;
    const match = assignment.exec(tail);
    if (!match) {
      xmlWhitespace.lastIndex = offset;

      return xmlWhitespace.test(tail) && xmlWhitespace.lastIndex === tail.length
        ? attributes
        : undefined;
    }

    const name = match[1];
    const value = match[2] ?? match[3];
    if (name === undefined || value === undefined) {
      return undefined;
    }
    if (attributes.has(name) || attributes.size >= maximumAttributes) {
      return undefined;
    }
    if (!safeAttribute(name, value)) {
      return undefined;
    }

    attributes.set(name, value);
    offset = assignment.lastIndex;
  }

  return attributes;
}

function safeText(text: string, parent: string | undefined): boolean {
  if (parent === 'style') {
    const css = text.trim().replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/u, '$1');

    return !css.includes('<') && !css.includes(']]>') && safeReferences(css);
  }
  if (!parent) {
    return /^[\t\n\r ]*$/u.test(text);
  }
  if (text.includes('<') || text.includes(']]>')) {
    return false;
  }

  return !text
    .replace(textEntity, (_entity, decimal: string | undefined, hex: string | undefined) => {
      if (decimal === undefined && hex === undefined) {
        return '';
      }

      const point = decimal === undefined ? Number.parseInt(hex ?? '', 16) : Number(decimal);
      const whitespace = point === 9 || point === 10 || point === 13;
      const basic = (point >= 0x20 && point <= 0xd7ff) || (point >= 0xe000 && point <= 0xfffd);
      const supplementary = point >= 0x10000 && point <= 0x10ffff;

      return whitespace || basic || supplementary ? '' : '&';
    })
    .includes('&');
}

function readSvgRoot(source: string): SvgRoot | undefined {
  const stack: string[] = [];
  const token = /<(\/?)([A-Za-z][\w:-]*)([^<>]*)>/gu;
  let offset = 0;
  let elements = 0;
  let root: SvgRoot | undefined;

  for (const match of source.matchAll(token)) {
    const [markup, closing, name, tail] = match;
    if (!name || tail === undefined || !svgElements.has(name)) {
      return undefined;
    }
    if (!safeText(source.slice(offset, match.index), stack.at(-1))) {
      return undefined;
    }

    offset = match.index + markup.length;
    if (closing) {
      if (!/^[\t\n\r ]*$/u.test(tail) || stack.pop() !== name) {
        return undefined;
      }

      continue;
    }

    const empty = tail.endsWith('/');
    const parameters = readAttributes(empty ? tail.slice(0, -1) : tail);
    elements += 1;
    if (!parameters || elements > maximumElements || stack.length >= maximumDepth) {
      return undefined;
    }

    if (stack.length === 0) {
      if (root || name !== 'svg') {
        return undefined;
      }

      root = { attributes: parameters, end: offset, empty };
    }
    if (!empty) {
      stack.push(name);
    }
  }

  return stack.length === 0 && safeText(source.slice(offset), undefined) ? root : undefined;
}

function dimensions(attributes: SvgRoot['attributes']) {
  const viewBox = attributes
    .get('viewBox')
    ?.trim()
    .split(/[\s,]+/u)
    .map(Number);
  const viewWidth = viewBox?.length === 4 ? viewBox[2] : undefined;
  const viewHeight = viewBox?.length === 4 ? viewBox[3] : undefined;
  const rawWidth = attributes.get('width')?.trim().match(absoluteDimension)?.[1];
  const rawHeight = attributes.get('height')?.trim().match(absoluteDimension)?.[1];
  const width = Math.ceil(rawWidth === undefined ? (viewWidth ?? 300) : Number(rawWidth));
  const height = Math.ceil(rawHeight === undefined ? (viewHeight ?? 150) : Number(rawHeight));
  const validWidth = width > 0 && width <= maximumSide;
  const validHeight = height > 0 && height <= maximumSide;

  return validWidth && validHeight && width * height <= maximumPixels
    ? { width, height }
    : undefined;
}

export function looksLikeSvgImage(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, 4096)).trimStart();

  return !head || head.startsWith('<');
}

export function readSafeSvgImage(bytes: Uint8Array): SafeSvgImage | undefined {
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error;
    }

    return undefined;
  }

  const source = decoded.replace(xmlDeclaration, '').replace(/<!--[\s\S]*?-->/gu, '');
  if (invalidXmlCharacters.test(source)) {
    return undefined;
  }

  const root = readSvgRoot(source);
  const size = root ? dimensions(root.attributes) : undefined;
  if (!root || !size) {
    return undefined;
  }

  const extra = [...root.attributes]
    .filter(([name]) => !['width', 'height', 'xmlns'].includes(name))
    .map(([name, value]) => {
      const quote = value.includes('"') ? "'" : '"';

      return ` ${name}=${quote}${value}${quote}`;
    })
    .join('');
  const xlink =
    !root.attributes.has('xmlns:xlink') && source.includes('xlink:href')
      ? ` xmlns:xlink="${xlinkNamespace}"`
      : '';
  const start = `<svg xmlns="${namespace}" width="${size.width}" height="${size.height}"${xlink}${extra}`;
  const markup = start + (root.empty ? '/>' : '>') + source.slice(root.end);
  const validDimensions = ['width', 'height'].every((name) => {
    const value = root.attributes.get(name)?.trim();

    return value === undefined || absoluteDimension.test(value);
  });
  const canKeepOriginalDimensions = root.attributes.has('xmlns') && !xlink && validDimensions;

  return {
    markup,
    size,
    originalDimensionsMarkup: canKeepOriginalDimensions ? source.trim() : undefined,
  };
}

export function encodeSafeSvgImage(image: SafeSvgImage, maximumBytes: number): Uint8Array {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(image.markup);

  return bytes.byteLength > maximumBytes && image.originalDimensionsMarkup
    ? encoder.encode(image.originalDimensionsMarkup)
    : bytes;
}
