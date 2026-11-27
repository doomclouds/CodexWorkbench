const regionPolicy =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'\">";
const removeElements = [
  'script',
  'style',
  'link',
  'meta',
  'base',
  'iframe',
  'object',
  'embed',
  'applet',
  'foreignObject',
  'animate',
  'animateColor',
  'animateMotion',
  'animateTransform',
  'set',
  'discard',
].join(', ');
const htmlNamespace = 'http://www.w3.org/1999/xhtml';
const styleUrl = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/giu;
const maxRegionNodes = 5_000;
const activeAttributes = new Set([
  'action',
  'autofocus',
  'background',
  'data',
  'formaction',
  'href',
  'ping',
  'poster',
  'src',
  'srcdoc',
  'srcset',
  'target',
  'xlink:href',
  'xml:base',
]);

export function loadRenderResource(
  element: HTMLIFrameElement | HTMLImageElement,
  start: () => void,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();

  return new Promise((resolve, reject) => {
    function cleanup() {
      element.removeEventListener('load', loaded);
      element.removeEventListener('error', failed);
      signal.removeEventListener('abort', aborted);
    }

    function loaded() {
      cleanup();
      resolve();
    }

    function failed() {
      cleanup();
      reject(new Error('浏览器无法完成图片排版。'));
    }

    function aborted() {
      cleanup();
      reject(signal.reason);
    }

    element.addEventListener('load', loaded);
    element.addEventListener('error', failed);
    signal.addEventListener('abort', aborted, { once: true });
    try {
      start();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

function keepInlineResource(value: string): boolean {
  const reference = value.trim();

  return reference.startsWith('#') || /^data:image\//iu.test(reference);
}

function hasSafeImageReference(element: Element, name: string, value: string): boolean {
  const tag = element.localName;
  if (tag === 'img' && name === 'src') {
    return /^data:image\//iu.test(value.trim());
  }

  if (name === 'href' || name === 'xlink:href') {
    if (tag === 'image' || tag === 'feImage') {
      return keepInlineResource(value);
    }

    return tag === 'use' && value.trim().startsWith('#');
  }

  return false;
}

function hasExternalResource(value: string): boolean {
  for (const [, doubleQuoted, singleQuoted, bare] of value.matchAll(styleUrl)) {
    if (!keepInlineResource(doubleQuoted ?? singleQuoted ?? bare ?? '')) {
      return true;
    }
  }

  return false;
}

function freezeStyle(view: Window, original: Element, copy: Element) {
  const style = view.getComputedStyle(original);
  const rules: string[] = [];
  for (const property of style) {
    const value = style.getPropertyValue(property);
    if (!property.startsWith('--') && !hasExternalResource(value)) {
      rules.push(property + ':' + value);
    }
  }
  rules.push('animation:none', 'transition:none');
  copy.setAttribute('style', rules.join(';'));

  for (const { name, value } of [...copy.attributes]) {
    const active = activeAttributes.has(name.toLowerCase());
    const unsafeReference = active && !hasSafeImageReference(copy, name, value);
    if (/^on/iu.test(name) || unsafeReference || hasExternalResource(value)) {
      copy.removeAttribute(name);
    }
  }
}

function serializeRegion(body: HTMLElement, view: Window) {
  const elements = body.querySelectorAll('*');
  if (elements.length > maxRegionNodes) {
    throw new Error('HTML 区域内容过多，无法导出为图片。请缩小导出范围或导出 HTML。');
  }

  const clone = body.cloneNode(true) as HTMLElement;
  const copies = clone.querySelectorAll('*');
  elements.forEach((element, index) => {
    const copy = copies[index];
    if (copy) {
      freezeStyle(view, element, copy);
    }
  });
  freezeStyle(view, body, clone);
  clone.querySelectorAll(removeElements).forEach((element) => element.remove());
  clone.setAttribute('xmlns', htmlNamespace);
  clone.setAttribute('inert', '');

  return new XMLSerializer().serializeToString(clone);
}

interface BrowserVectorRegion {
  readonly html: string;
  readonly width: number;
  readonly height: number;
}

export async function captureVectorRegion(
  { html, width, height }: BrowserVectorRegion,
  signal: AbortSignal,
): Promise<string> {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.setAttribute('aria-hidden', 'true');
  frame.inert = true;
  frame.style.cssText = [
    'position:fixed',
    'left:-100000px',
    'top:0',
    'border:0',
    'pointer-events:none',
    'opacity:0',
    'width:' + width + 'px',
    'height:' + height + 'px',
  ].join(';');
  frame.srcdoc = regionPolicy + html;

  try {
    await loadRenderResource(frame, () => document.body.append(frame), signal);
    const body = frame.contentDocument?.body;
    const view = frame.contentWindow;
    if (!body || !view) {
      throw new Error('浏览器无法读取隔离的 HTML 排版。请导出 HTML。');
    }

    signal.throwIfAborted();

    return serializeRegion(body, view);
  } finally {
    frame.remove();
  }
}
