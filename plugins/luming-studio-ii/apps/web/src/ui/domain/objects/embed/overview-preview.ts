export interface EmbedOverviewSize {
  readonly width: number;
  readonly height: number;
}

const maxSource = 48_000;
const maxDimension = 4_096;
const maxCachedPreviews = 32;
const cache = new Map<string, string | undefined>();
const allowedTags = new Set(
  'a abbr article aside b bdi bdo blockquote br caption cite code col colgroup dd del dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hgroup hr i img ins kbd li main mark nav ol p pre q rp rt ruby s samp section small span strong style sub sup table tbody td tfoot th thead time title tr u ul var wbr'.split(
    ' ',
  ),
);
const allowedAttributes = new Set(
  'alt class colspan datetime dir height id lang rowspan scope span start style title type value width'.split(
    ' ',
  ),
);
const defaultStyle =
  'html{color-scheme:light;background:#f5f5f5;color:#2d3142}body{margin:0;font-family:Arial,"Microsoft YaHei",sans-serif}*{box-sizing:border-box}';
const unsupportedCss =
  /[@\\]|\b(?:url|image-set|element|paint|expression)\s*\(|:root|\banimation(?:-[a-z-]+)?\s*:|(?:\d|\.)\s*[dsl]?v(?:w|h|i|b|min|max)\b/iu;
const inlineImage = /^data:image\/(?:png|jpeg|webp|avif|bmp);base64,[A-Za-z\d+/]+={0,2}$/u;
const unstableDocument =
  /<(?:html|body|head)[\s/]+[^>\s]|<(?:base|iframe|frame|frameset|object|embed|applet|portal|link|script|noscript|template|form|audio|video|source|picture|input|textarea|select|button)(?=[\s/>])/iu;

function supportedAttributes(element: Element) {
  for (const { name, value } of element.attributes) {
    if (name === 'src' && element.localName === 'img' && inlineImage.test(value)) {
      continue;
    }
    if (name === 'style' && unsupportedCss.test(value)) {
      return false;
    }
    if (!allowedAttributes.has(name) && !name.startsWith('data-') && !name.startsWith('aria-')) {
      return false;
    }
  }

  return true;
}

function supportedTree(elements: NodeListOf<Element>) {
  if (elements.length > 300) {
    return false;
  }

  for (const element of elements) {
    if (element.localName === 'meta' && element.hasAttribute('charset')) {
      if (element.attributes.length !== 1) {
        return false;
      }

      continue;
    }
    if (element.localName === 'style' && unsupportedCss.test(element.textContent ?? '')) {
      return false;
    }
    if (!allowedTags.has(element.localName) || !supportedAttributes(element)) {
      return false;
    }
  }

  return true;
}

function parseStaticDocument(source: string) {
  const template = document.createElement('template');
  template.innerHTML = source;
  if (!supportedTree(template.content.querySelectorAll('*'))) {
    return undefined;
  }

  const parsed = new DOMParser().parseFromString(source, 'text/html');
  const shell = [parsed.documentElement, parsed.head, parsed.body];
  if (shell.some((element) => element.attributes.length > 0)) {
    return undefined;
  }
  if (!supportedTree(parsed.querySelectorAll('head *, body *'))) {
    return undefined;
  }

  parsed.querySelectorAll('meta[charset]').forEach((element) => element.remove());
  return parsed;
}

function renderPreview(source: string, width: number, height: number) {
  const parsed = parseStaticDocument(source);
  if (!parsed) {
    return undefined;
  }

  const style = parsed.createElement('style');
  style.textContent = defaultStyle + `html{min-height:${height}px}`;
  parsed.head.prepend(style);
  const xml = new XMLSerializer().serializeToString(parsed.documentElement);
  const image = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f5f5f5"/><foreignObject width="${width}" height="${height}">${xml}</foreignObject></svg>`;

  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(image);
}

export function embedOverviewPreview(source: string | undefined, size: EmbedOverviewSize) {
  const width = Math.round(size.width) - 2;
  const height = Math.round(size.height) - 2;
  if (!source || source.length > maxSource || typeof document === 'undefined') {
    return undefined;
  }

  const validWidth = width > 0 && width <= maxDimension;
  const validHeight = height > 0 && height <= maxDimension;
  if (!validWidth || !validHeight) {
    return undefined;
  }
  if (unstableDocument.test(source)) {
    return undefined;
  }

  const key = `${width}:${height}:${source}`;
  if (cache.has(key)) {
    return cache.get(key);
  }

  const image = renderPreview(source, width, height);
  if (cache.size >= maxCachedPreviews) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  cache.set(key, image);

  return image;
}
