import type { Board } from '../contracts/studio.js';
import { boardBounds, buildBoardHtml, buildBoardSvg, ExportError, extractRegionSvg, filenameFor, selectedElements, type ExportOptions } from '../core/serialization.js';

async function embedImages(board: Board, options: ExportOptions): Promise<Board> {
  const baseUrl = typeof options.baseUrl === 'string' ? options.baseUrl : location.origin;
  const cloned = structuredClone(board);
  const cache = new Map<string, Promise<string>>();
  const read = (source: string): Promise<string> => {
    if (source.startsWith('data:')) return Promise.resolve(source);
    if (!cache.has(source)) cache.set(source, (async () => {
      const url = new URL(source, baseUrl);
      if (url.origin !== new URL(baseUrl).origin) throw new ExportError('EXTERNAL_ASSET', '请先将外部图片上传到这块白板，再导出独立图片。');
      if (typeof options.token === 'string') url.searchParams.set('token', options.token);
      const response = await fetch(url);
      if (!response.ok) throw new ExportError('ASSET_UNAVAILABLE', '图片资源读取失败，请重新加载后导出。');
      const blob = await response.blob();
      return await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new ExportError('ASSET_UNAVAILABLE', '图片资源转换失败。')); reader.readAsDataURL(blob); });
    })());
    return cache.get(source)!;
  };
  await Promise.all(cloned.elements.map(async element => {
    if (element.type === 'image' && element.src) element.src = await read(element.src);
    if (element.type === 'html' && element.html) {
      const document = new DOMParser().parseFromString(element.html, 'text/html');
      await Promise.all([...document.querySelectorAll('img[src],image[href]')].map(async image => {
        const attribute = image.tagName.toLowerCase() === 'img' ? 'src' : 'href'; const source = image.getAttribute(attribute);
        if (source && !source.startsWith('#')) image.setAttribute(attribute, await read(source));
      }));
      element.html = `<!doctype html>${document.documentElement.outerHTML}`;
    }
  }));
  return cloned;
}
async function captureRegion(html: string, width: number, height: number): Promise<string> {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;height:${height}px;border:0;pointer-events:none;opacity:0`;
  const policy = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\';style-src \'unsafe-inline\';img-src data:;font-src data:;script-src \'none\';connect-src \'none\'">';
  const loaded = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new ExportError('REGION_RENDER_TIMEOUT', 'HTML 区域排版超时，请重试或导出 HTML。')), 15_000);
    frame.onload = () => { clearTimeout(timeout); resolve(); };
    frame.onerror = () => { clearTimeout(timeout); reject(new ExportError('REGION_RENDER_FAILED', 'HTML 区域无法完成离线排版。')); };
  });
  frame.srcdoc = policy + html;
  document.body.append(frame);
  try {
    await loaded;
    const source = frame.contentDocument; const view = frame.contentWindow;
    if (!source?.body || !view) throw new ExportError('BROWSER_EXPORT_BLOCKED', '当前浏览器不允许读取隔离预览的排版，请导出 HTML。');
    await source.fonts?.ready;
    const clone = source.body.cloneNode(true) as HTMLElement;
    const originals: Element[] = [source.body, ...source.body.querySelectorAll('*')];
    const copies: Element[] = [clone, ...clone.querySelectorAll('*')];
    for (let i = 0; i < originals.length; i++) {
      const target = copies[i]; const style = view.getComputedStyle(originals[i]);
      target.setAttribute('style', [...style].map(property => `${property}:${style.getPropertyValue(property)}`).join(';') + ';animation:none;transition:none');
      for (const attribute of [...target.attributes]) if (/^on/i.test(attribute.name)) target.removeAttribute(attribute.name);
    }
    clone.querySelectorAll('script,style,link,meta,iframe,object,embed').forEach(node => node.remove());
    clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    return new XMLSerializer().serializeToString(clone);
  } finally { frame.remove(); }
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = filename; link.hidden = true; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
async function rasterize(svg: string, width: number, height: number): Promise<Blob> {
  if (width > 16384 || height > 16384 || width * height > 32_000_000) throw new ExportError('EXPORT_TOO_LARGE', 'PNG 超过 3200 万像素，请缩小范围或降低导出倍数。');
  await document.fonts?.ready;
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new ExportError('BROWSER_RENDER_FAILED', '浏览器图片渲染超时，请导出 HTML 保留完整内容。')), 15_000);
    image.onload = () => { clearTimeout(timeout); resolve(); }; image.onerror = () => { clearTimeout(timeout); reject(new ExportError('BROWSER_RENDER_FAILED', '浏览器无法把这个 HTML 区域转换为图片，请导出 HTML 保留完整内容。')); };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new ExportError('CANVAS_UNAVAILABLE', '当前页面无法创建 PNG 画布。');
  context.drawImage(image, 0, 0, width, height);
  try { context.getImageData(0, 0, 1, 1); }
  catch { throw new ExportError('BROWSER_EXPORT_BLOCKED', '浏览器阻止了 HTML 或外部图片的像素读取，请导出 HTML；未生成 PNG。'); }
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new ExportError('BROWSER_RENDER_FAILED', 'PNG 编码失败；未生成图片。')), 'image/png'));
}
export async function renderBoardPng(board: Board, options: ExportOptions = {}): Promise<Blob> {
  board = await embedImages(board, options);
  const elements = selectedElements(board, options); const selectedRegion = (options.regionId || options.elementId) && elements.length === 1 && elements[0].type === 'html' ? elements[0] : undefined;
  let svg = selectedRegion ? extractRegionSvg(String(selectedRegion.html ?? ''), selectedRegion.id) : undefined;
  if (!svg) {
    const xhtmlRegions: Record<string, string> = {};
    await Promise.all(elements.filter(element => element.type === 'html').map(async element => { xhtmlRegions[element.id] = await captureRegion(String(element.html ?? ''), element.w, element.h); }));
    svg = buildBoardSvg(board, { ...options, xhtmlRegions });
  }
  const bounds = boardBounds(elements, typeof options.padding === 'number' ? options.padding : 32, board.elements);
  const viewBox = selectedRegion ? /\bviewBox\s*=\s*["']\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(svg) : undefined;
  const width = viewBox ? Number(viewBox[1]) : bounds.width; const height = viewBox ? Number(viewBox[2]) : bounds.height;
  const scale = typeof options.scale === 'number' ? options.scale : 1;
  if (!Number.isFinite(scale) || scale <= 0 || scale > 4) throw new ExportError('INVALID_EXPORT_SCALE', '导出缩放倍数必须大于 0 且不超过 4。');
  return rasterize(svg, Math.max(1, Math.ceil(width * scale)), Math.max(1, Math.ceil(height * scale)));
}
export async function downloadBoard(board: Board, format: string, options: ExportOptions = {}): Promise<void> {
  const originalTitle = selectedElements(board, options)[0]?.text || board.artifact.title;
  if (format === 'png') { download(await renderBoardPng(board, options), filenameFor((options.regionId || options.elementId) ? originalTitle : board.artifact.title, 'png')); return; }
  if (format === 'svg') board = await embedImages(board, options);
  const elements = selectedElements(board, options); const selectedRegion = (options.regionId || options.elementId) && elements.length === 1 && elements[0].type === 'html' ? elements[0] : undefined;
  const title = selectedRegion?.text || board.artifact.title;
  if (format === 'json') { download(new Blob([JSON.stringify({ ...board, elements }, null, 2)], { type: 'application/json' }), filenameFor(title, 'json')); return; }
  if (format === 'html') { download(new Blob([selectedRegion ? String(selectedRegion.html ?? '') : buildBoardHtml(board, options)], { type: 'text/html' }), filenameFor(title, 'html')); return; }
  let svg = selectedRegion ? extractRegionSvg(String(selectedRegion.html ?? ''), selectedRegion.id) : undefined;
  svg ??= buildBoardSvg(board, options);
  if (format === 'svg') { download(new Blob([svg], { type: 'image/svg+xml' }), filenameFor(title, 'svg')); return; }
  throw new ExportError('UNSUPPORTED_EXPORT', '支持导出 HTML、SVG、PNG 和白板 JSON。');
}
