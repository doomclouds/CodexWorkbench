export interface EmbedOverviewSize {
  readonly width: number;
  readonly height: number;
}

const maxSource = 48_000;
const maxDimension = 4_096;
const maxCachedPreviews = 32;
const cache = new Map<string, string | undefined>();
const svgNamespace = 'http://www.w3.org/2000/svg';
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
const allowedSvgTags = new Set(
  'circle clipPath defs desc ellipse g line linearGradient marker mask path pattern polygon polyline radialGradient rect stop style svg text title tspan'.split(
    ' ',
  ),
);
const allowedSvgAttributes = new Set(
  'alignment-baseline class clip-path clip-rule clipPathUnits color cx cy d dominant-baseline dx dy fill fill-opacity fill-rule font-family font-size font-style font-weight fx fy gradientTransform gradientUnits height id marker-end marker-mid marker-start markerHeight markerUnits markerWidth mask maskContentUnits maskUnits offset opacity orient paint-order pathLength patternContentUnits patternTransform patternUnits points preserveAspectRatio r refX refY role rx ry stop-color stop-opacity stroke stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width style text-anchor textLength lengthAdjust transform vector-effect viewBox width x x1 x2 xmlns y y1 y2'.split(
    ' ',
  ),
);
const defaultStyle =
  'html{color-scheme:light;background:#f5f5f5;color:#2d3142}body{margin:0;font-family:Arial,"Microsoft YaHei",sans-serif}*{box-sizing:border-box}svg{max-width:100%}';
const unsupportedCss =
  /[@\\]|\b(?:url|image-set|element|paint|expression)\s*\(|\banimation(?:-[a-z-]+)?\s*:|(?:\d|\.)\s*[dsl]?v(?:w|h|i|b|min|max)\b/iu;
const localPaint = /\burl\s*\(\s*(["']?)#[A-Za-z\d_.:-]+\1\s*\)/giu;
const htmlRootSelector = /(^|\})(\s*):root(?=\s*\{)/giu;
const inlineImage = /^data:image\/(?:png|jpeg|webp|avif|bmp);base64,[A-Za-z\d+/]+={0,2}$/u;
const unstableDocument =
  /<(?:base|iframe|frame|frameset|object|embed|applet|portal|link|script|noscript|template|form|audio|video|source|picture|input|textarea|select|button)(?=[\s/>])/iu;

function supportedStyle(value: string) {
  return !unsupportedCss.test(value.replace(localPaint, ''));
}

function supportedAttributes(element: Element) {
  const svg = element.namespaceURI === svgNamespace;
  const supported = svg ? allowedSvgAttributes : allowedAttributes;
  for (const { name, value } of element.attributes) {
    const htmlImageSource = !svg && name === 'src' && element.localName === 'img';
    if (htmlImageSource && inlineImage.test(value)) {
      continue;
    }
    if ((svg || name === 'style') && !supportedStyle(value)) {
      return false;
    }
    if (!supported.has(name) && !name.startsWith('data-') && !name.startsWith('aria-')) {
      return false;
    }
  }

  return true;
}

function supportedMetadata(element: Element) {
  if (element.hasAttribute('charset')) {
    return element.attributes.length === 1;
  }

  return (
    element.attributes.length === 2 &&
    element.getAttribute('name')?.toLowerCase() === 'viewport' &&
    element.hasAttribute('content')
  );
}

function supportedTree(elements: NodeListOf<Element>) {
  if (elements.length > 300) {
    return false;
  }

  for (const element of elements) {
    if (element.localName === 'meta') {
      if (!supportedMetadata(element)) {
        return false;
      }

      continue;
    }
    if (element.localName === 'style' && !supportedStyle(element.textContent ?? '')) {
      return false;
    }

    const tags = element.namespaceURI === svgNamespace ? allowedSvgTags : allowedTags;
    if (!tags.has(element.localName) || !supportedAttributes(element)) {
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
  if (
    shell.some((element) =>
      [...element.attributes].some(({ name }) => name !== 'lang' && name !== 'dir'),
    )
  ) {
    return undefined;
  }
  if (!supportedTree(parsed.querySelectorAll('head *, body *'))) {
    return undefined;
  }

  parsed.querySelectorAll('meta').forEach((element) => element.remove());
  for (const style of parsed.querySelectorAll('style')) {
    style.textContent = (style.textContent ?? '').replace(htmlRootSelector, '$1$2html');
  }
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
