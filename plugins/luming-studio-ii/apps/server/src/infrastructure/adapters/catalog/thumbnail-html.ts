import { parse, type DefaultTreeAdapterMap } from 'parse5';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];

const svgNamespace = 'http://www.w3.org/2000/svg';
const htmlTags = new Set(
  'article aside b blockquote br caption code dd div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i li main ol p pre section small span strong sub sup table tbody td th thead tr u ul'.split(
    ' ',
  ),
);
const svgTags = new Set(
  'svg g path circle rect ellipse line polyline polygon text tspan defs clipPath marker linearGradient radialGradient stop'.split(
    ' ',
  ),
);
const excludedTags = new Set(
  'audio canvas embed foreignObject head iframe link math meta noscript object script style template video'.split(
    ' ',
  ),
);
const svgAttributes = new Set(
  'viewBox preserveAspectRatio width height x y x1 y1 x2 y2 cx cy r rx ry d points transform fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-dasharray stroke-linecap stroke-linejoin opacity text-anchor dominant-baseline font-family font-size font-weight dx dy markerHeight markerWidth markerUnits orient refX refY gradientTransform gradientUnits offset stop-color stop-opacity'.split(
    ' ',
  ),
);
const cssProperties = new Set(
  'background background-color border border-color border-radius border-style border-width box-sizing color column-gap display flex flex-basis flex-direction flex-grow flex-shrink flex-wrap font-family font-size font-style font-weight gap grid-area grid-auto-columns grid-auto-flow grid-auto-rows grid-column grid-row grid-template-areas grid-template-columns grid-template-rows height justify-content justify-items justify-self align-content align-items align-self left letter-spacing line-height margin margin-bottom margin-left margin-right margin-top max-height max-width min-height min-width opacity overflow padding padding-bottom padding-left padding-right padding-top position right row-gap text-align text-decoration text-overflow text-transform top bottom vertical-align white-space width word-break word-wrap z-index'.split(
    ' ',
  ),
);
const safeCssValue = /^[\w\s#.,%+'"()/-]+$/u;
const safeCssFunctions = new Set([
  'calc',
  'clamp',
  'hsl',
  'hsla',
  'linear-gradient',
  'max',
  'min',
  'minmax',
  'radial-gradient',
  'repeat',
  'rgb',
  'rgba',
]);
const safeSelector = /^[a-z\d_.#\s>+~-]+$/iu;
const safeSvgValue = /^[\w\s#.,%+'()/-]+$/u;
const safeId = /^[a-z_][\w-]{0,100}$/iu;
const localSvgReference = /^url\(\s*#([a-z_][\w-]{0,100})\s*\)$/iu;
const svgReferenceAttributes = new Set([
  'clip-path',
  'fill',
  'marker-end',
  'marker-mid',
  'marker-start',
  'stroke',
]);
const maximumNodes = 400;
const maximumDepth = 20;
const maximumText = 3_000;

function xml(value: string) {
  return value
    .replace(/\p{Cc}|[\uFFFE\uFFFF]/gu, (character) =>
      /[\t\r\n]/u.test(character) ? character : '',
    )
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function safeDeclaration(declaration: string) {
  const colon = declaration.indexOf(':');
  const property = declaration.slice(0, colon).trim().toLowerCase();
  const value = declaration.slice(colon + 1).trim();
  if (colon < 1 || !cssProperties.has(property) || !safeCssValue.test(value)) {
    return [];
  }

  const functions = Array.from(value.matchAll(/(?<![\w-])([\w-]+)\s*\(/gu), (match) => match[1]);

  return functions.every((name) => name && safeCssFunctions.has(name.toLowerCase()))
    ? [property + ':' + value]
    : [];
}

function safeDeclarations(value: string) {
  return value.slice(0, 8000).split(';').flatMap(safeDeclaration).join(';');
}

function safeSelectors(value: string, scope: string) {
  return value.split(',').flatMap((part) => {
    const selector = part.trim();
    if (!safeSelector.test(selector)) {
      return [];
    }

    const local = selector.replace(/#([a-z_][\w-]*)/giu, scope + '-$1');
    const root = /^(?:html\s+body|body|html)(?=[.#\s>+~]|$)/iu;
    if (root.test(local)) {
      return [local.replace(root, scope)];
    }

    return [scope + ' ' + local];
  });
}

function safeStylesheet(value: string, scope: string) {
  const rules = value
    .slice(0, 12_000)
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('}');

  return rules
    .map((rule) => {
      const [selectors, declarations, nesting] = rule.split('{');
      if (!selectors || !declarations || nesting !== undefined) {
        return '';
      }

      const scoped = safeSelectors(selectors, scope);
      const style = safeDeclarations(declarations);

      return scoped.length && style ? scoped.join(',') + '{' + style + '}' : '';
    })
    .join('');
}

function isElement(node: Node): node is Element {
  return 'tagName' in node;
}

function attribute(node: Element, name: string) {
  return node.attrs.find((value) => value.name === name && !value.namespace)?.value;
}

function svgAttribute(name: string, value: string, id: string) {
  const local = svgReferenceAttributes.has(name) ? localSvgReference.exec(value)?.[1] : undefined;
  if (local) {
    return [' ' + name + '="url(#' + id + '-' + local + ')"'];
  }

  const literal = value.length <= 4096 && safeSvgValue.test(value) && !/url\s*\(/iu.test(value);

  return svgAttributes.has(name) && literal ? [' ' + name + '="' + xml(value) + '"'] : [];
}

function safeAttributes(node: Element, svg: boolean, id: string) {
  return node.attrs
    .flatMap(({ name, value, namespace }) => {
      if (namespace) {
        return [];
      }

      if (name === 'style') {
        const style = safeDeclarations(value);

        return style ? [' style="' + xml(style) + '"'] : [];
      }
      if (name === 'class' && /^[\w\s-]{1,300}$/u.test(value)) {
        return [' class="' + xml(value) + '"'];
      }
      if (name === 'id' && safeId.test(value)) {
        return [' id="' + id + '-' + value + '"'];
      }

      return svg ? svgAttribute(name, value, id) : [];
    })
    .join('');
}

interface HtmlBudget {
  readonly id: string;
  nodes: number;
  characters: number;
}

function staticMarkup(node: Node, budget: HtmlBudget, depth: number): string {
  if (depth > maximumDepth || budget.nodes <= 0) {
    return '';
  }

  budget.nodes -= 1;
  if ('value' in node) {
    const text = node.value.slice(0, budget.characters);
    budget.characters -= text.length;

    return xml(text);
  }
  if (!isElement(node) || excludedTags.has(node.tagName)) {
    return '';
  }
  if (attribute(node, 'hidden') !== undefined || attribute(node, 'aria-hidden') === 'true') {
    return '';
  }

  const { tagName } = node;
  const svg = node.namespaceURI === svgNamespace;
  const content = node.childNodes.map((child) => staticMarkup(child, budget, depth + 1)).join('');
  if (!(svg ? svgTags : htmlTags).has(tagName)) {
    return content;
  }

  const attributes = safeAttributes(node, svg, budget.id);
  const ns = tagName === 'svg' ? ' xmlns="' + svgNamespace + '"' : '';

  return tagName === 'br' || tagName === 'hr'
    ? '<' + tagName + attributes + '/>'
    : '<' + tagName + ns + attributes + '>' + content + '</' + tagName + '>';
}

function childElement(node: DefaultTreeAdapterMap['parentNode'] | undefined, tag: string) {
  return node?.childNodes.find(
    (child): child is Element => isElement(child) && child.tagName === tag,
  );
}

export function sanitizeThumbnailHtml(source: string, index: number): string | undefined {
  const document = parse(source);
  const html = childElement(document, 'html');
  const body = childElement(html, 'body');
  if (!body) {
    return undefined;
  }

  const id = 'thumbnail-html-' + index;
  const budget = { id, nodes: maximumNodes, characters: maximumText };
  const markup = body.childNodes.map((child) => staticMarkup(child, budget, 1)).join('');
  if (!markup.trim()) {
    return undefined;
  }

  const styles = [childElement(html, 'head'), body].flatMap(
    (root) =>
      root?.childNodes.filter(
        (child): child is Element => isElement(child) && child.tagName === 'style',
      ) ?? [],
  );
  const css = styles
    .slice(0, 4)
    .flatMap((style) => style.childNodes.map((child) => ('value' in child ? child.value : '')))
    .join('\n');
  const stylesheet = safeStylesheet(css, '#' + id);
  const bodyStyle = safeDeclarations(attribute(body, 'style') ?? '');

  return (
    '<div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;overflow:hidden;font:14px sans-serif">' +
    (stylesheet && '<style>' + xml(stylesheet) + '</style>') +
    '<div id="' +
    id +
    '" style="' +
    xml('min-height:100%;' + bodyStyle) +
    '">' +
    markup +
    '</div></div>'
  );
}
