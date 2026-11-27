const maximumSvgBytes = 1024 * 1024;
const maximumElements = 4096;
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
const textEntity = /&(?:amp|lt|gt|quot|apos|#\d{1,7}|#x[\da-f]{1,6});/giu;
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
  const assignment = /\s+([A-Za-z_][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/guy;
  let offset = 0;
  while (tail.slice(offset).trim()) {
    assignment.lastIndex = offset;
    const match = assignment.exec(tail);
    const name = match?.[1];
    const value = match?.[2] ?? match?.[3];
    if (name === undefined || value === undefined || attributes.has(name)) {
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

    return !css.includes('<') && safeReferences(css);
  }
  if (!parent) {
    return text.trim() === '';
  }

  return !text.includes('<') && !text.replace(textEntity, '').includes('&');
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
      if (tail.trim() || stack.pop() !== name) {
        return undefined;
      }

      continue;
    }

    const empty = /\/\s*$/u.test(tail);
    const parameters = readAttributes(empty ? tail.replace(/\/\s*$/u, '') : tail);
    elements += 1;
    if (!parameters || elements > maximumElements) {
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
  const rawWidth = attributes
    .get('width')
    ?.trim()
    .match(/^(\d+(?:\.\d+)?|\.\d+)(?:px)?$/u)?.[1];
  const rawHeight = attributes
    .get('height')
    ?.trim()
    .match(/^(\d+(?:\.\d+)?|\.\d+)(?:px)?$/u)?.[1];
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

  return head.startsWith('<');
}

export function svgForImagePreview(bytes: Uint8Array): string | undefined {
  if (bytes.byteLength > maximumSvgBytes) {
    return undefined;
  }

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
  const root = readSvgRoot(source);
  const size = root ? dimensions(root.attributes) : undefined;
  if (!root || !size) {
    return undefined;
  }

  const extra = [...root.attributes]
    .filter(([name]) => !['width', 'height', 'xmlns'].includes(name))
    .map(([name, value]) => ` ${name}="${value.replaceAll('"', '&quot;')}"`)
    .join('');
  const start = `<svg xmlns="${namespace}" width="${size.width}" height="${size.height}"${extra}`;

  return start + (root.empty ? '/>' : '>') + source.slice(root.end);
}
