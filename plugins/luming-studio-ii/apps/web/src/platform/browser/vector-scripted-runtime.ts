interface CaptureRequest {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly maxBytes: number;
}

export function captureScriptedRuntime({ id, width, height, maxBytes }: CaptureRequest) {
  const namespace = 'http://www.w3.org/1999/xhtml';
  const blockedTags =
    'script, style, link, meta, base, iframe, object, embed, applet, animate, animateColor, animateMotion, animateTransform, set, discard';
  const resourceAttributes = new Set([
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
  const send = window.parent.postMessage.bind(window.parent);
  const getStyle = window.getComputedStyle.bind(window);
  const serialize = new XMLSerializer();

  function localResource(value: string) {
    return value.trim().startsWith('#') || /^data:image\//iu.test(value.trim());
  }

  function externalResource(value: string) {
    const urls = value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/giu);
    for (const [, doubleQuoted, singleQuoted, bare] of urls) {
      if (!localResource(doubleQuoted ?? singleQuoted ?? bare ?? '')) {
        return true;
      }
    }

    return false;
  }

  function allowResource(element: Element, name: string, value: string) {
    if (element.localName === 'img' && name === 'src') {
      return /^data:image\//iu.test(value.trim());
    }
    if (name !== 'href' && name !== 'xlink:href') {
      return false;
    }

    return ['image', 'feImage', 'use'].includes(element.localName) && localResource(value);
  }

  function copyPaint(source: Element, copy: Element) {
    const style = getStyle(source);
    const rules: string[] = [];
    for (const property of style) {
      const value = style.getPropertyValue(property);
      if (!property.startsWith('--') && !externalResource(value)) {
        rules.push(property + ':' + value);
      }
    }

    for (const { name, value } of [...copy.attributes]) {
      const lower = name.toLowerCase();
      const blocked = resourceAttributes.has(lower) && !allowResource(copy, lower, value);
      if (lower.startsWith('on') || blocked || externalResource(value)) {
        copy.removeAttribute(name);
      }
    }

    rules.push('animation:none', 'transition:none');
    copy.setAttribute('style', rules.join(';'));
  }

  function canvasImage(source: HTMLCanvasElement, copy: Element) {
    const bounds = source.getBoundingClientRect();
    const empty = !source.width || !source.height;
    if (empty || !bounds.width || !bounds.height) {
      return;
    }

    const scale = Math.min(1, width / source.width, height / source.height);
    const reduced = document.createElement('canvas');
    reduced.width = Math.max(1, Math.ceil(source.width * scale));
    reduced.height = Math.max(1, Math.ceil(source.height * scale));
    const context = reduced.getContext('2d');
    if (!context) {
      throw new Error('无法读取图解中的画布。');
    }

    context.drawImage(source, 0, 0, reduced.width, reduced.height);
    const image = document.createElement('img');
    image.setAttribute('style', copy.getAttribute('style') ?? '');
    image.src = reduced.toDataURL('image/png');
    copy.replaceWith(image);
  }

  function copyState(source: Element, copy: Element) {
    if (source instanceof HTMLCanvasElement) {
      canvasImage(source, copy);
    } else if (source instanceof HTMLInputElement) {
      copy.setAttribute('value', source.type === 'password' ? '' : source.value);
      copy.toggleAttribute('checked', source.checked);
    } else if (source instanceof HTMLTextAreaElement) {
      copy.textContent = source.value;
    } else if (source instanceof HTMLOptionElement) {
      copy.toggleAttribute('selected', source.selected);
    }
  }

  function viewportBackground(root: HTMLElement, body: HTMLElement) {
    root.style.minWidth = width + 'px';
    root.style.minHeight = height + 'px';
    if (
      root.style.backgroundImage !== 'none' ||
      root.style.backgroundColor !== 'rgba(0, 0, 0, 0)'
    ) {
      return;
    }

    for (const property of body.style) {
      if (property.startsWith('background-')) {
        root.style.setProperty(property, body.style.getPropertyValue(property));
      }
    }

    body.style.backgroundColor = 'transparent';
    body.style.backgroundImage = 'none';
  }

  function frozenMarkup() {
    const body = document.body;
    const originals = body.querySelectorAll('*');
    if (originals.length > 5_000) {
      throw new Error('图解元素过多。');
    }

    const clone = body.cloneNode(true) as HTMLElement;
    const copies = clone.querySelectorAll('*');
    for (const [index, source] of Array.from(originals).entries()) {
      const copy = copies[index];
      if (copy) {
        copyPaint(source, copy);
        copyState(source, copy);
      }
    }

    copyPaint(body, clone);
    clone.querySelectorAll(blockedTags).forEach((element) => element.remove());
    const root = document.documentElement.cloneNode(false) as HTMLElement;
    copyPaint(document.documentElement, root);
    root.setAttribute('xmlns', namespace);
    viewportBackground(root, clone);
    root.append(clone);

    return serialize.serializeToString(root);
  }

  function loadRaster(markup: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('无法渲染图解快照。'));
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="${width}" height="${height}">${markup}</foreignObject></svg>`;
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  async function capture() {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 50);
    });
    const markup = frozenMarkup();
    if (markup.length > maxBytes) {
      throw new Error('图解快照超过大小上限。');
    }

    const image = await loadRaster(markup);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('无法创建图解导出画布。');
    }

    context.drawImage(image, 0, 0);
    const png = canvas.toDataURL('image/png');
    if (png.length > maxBytes) {
      throw new Error('图解图片超过大小上限。');
    }

    send({ id, png }, '*');
  }

  function start() {
    capture().catch((error: unknown) => {
      const blocked = error instanceof DOMException && error.name === 'SecurityError';
      send({ id, failed: true, blocked }, '*');
    });
  }

  window.addEventListener('load', start, { once: true });
}
