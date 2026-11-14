import type { Board, BoardElement } from '../contracts/studio.js';
import { contrastRatio, readableText, semanticColor } from './theme.js';
import { arrowGeometry, arrowHeads, shapePath, strokePath, type Point } from './products/whiteboard-geometry.js';
import { parseRichText, safeHttpLink, type RichTextSegment } from './shared/rich-text.js';

export interface ExportOptions { regionId?: string; elementId?: string; ids?: string[]; padding?: number; scale?: number; [key: string]: unknown }
export class ExportError extends Error { constructor(public code: string, message: string) { super(message); this.name = 'ExportError'; } }
export function escapeXml(value: unknown): string { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
export function filenameFor(title: string, extension: string): string {
  let name = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').trim().slice(0, 100) || '白板';
  if (/^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(name)) name = `_${name}`;
  return `${name}.${extension}`;
}
export function selectedElements(board: Board, options: ExportOptions = {}): BoardElement[] {
  const id = options.regionId ?? options.elementId;
  const ids = id ? [id] : options.ids;
  if (!ids) return board.elements;
  const selected = board.elements.filter(e => ids.includes(e.id));
  if (selected.length !== new Set(ids).size) throw new ExportError('ELEMENT_NOT_FOUND', '部分导出对象已不存在，请刷新后重试。');
  return selected;
}
function scalar(value: unknown, fallback: number): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
export function boardBounds(elements: BoardElement[], padding = 32, scene: BoardElement[] = elements) {
  if (!elements.length) return { x: 0, y: 0, width: 960, height: 540 };
  const boxes = elements.map(e => {
    if (e.type === 'arrow') {
      endpoint(e.from, scene); endpoint(e.to, scene);
      const points = arrowGeometry(e, scene).points;
      const xs = points.map(point => point.x), ys = points.map(point => point.y);
      return { x: Math.min(...xs) - 16, y: Math.min(...ys) - 28, w: Math.max(32, Math.max(...xs) - Math.min(...xs) + 32), h: Math.max(48, Math.max(...ys) - Math.min(...ys) + 48) };
    }
    if (e.type === 'stroke' && e.points?.length) {
      const xs = e.points.filter((_n, i) => i % 2 === 0); const ys = e.points.filter((_n, i) => i % 2 === 1); const pen = scalar(e.strokeWidth ?? e.width, 3);
      return { x: e.x + Math.min(...xs) - pen, y: e.y + Math.min(...ys) - pen, w: Math.max(...xs) - Math.min(...xs) + pen * 2, h: Math.max(...ys) - Math.min(...ys) + pen * 2 };
    }
    const radians = scalar(e.rotation, 0) * Math.PI / 180; const w = Math.max(1, scalar(e.w, 200)); const h = Math.max(1, scalar(e.h, 100));
    const turnedWidth = Math.abs(w * Math.cos(radians)) + Math.abs(h * Math.sin(radians)); const turnedHeight = Math.abs(w * Math.sin(radians)) + Math.abs(h * Math.cos(radians));
    return { x: scalar(e.x, 0) + (w - turnedWidth) / 2, y: scalar(e.y, 0) + (h - turnedHeight) / 2, w: turnedWidth, h: turnedHeight };
  });
  const left = Math.min(...boxes.map(e => e.x)); const top = Math.min(...boxes.map(e => e.y));
  const right = Math.max(...boxes.map(e => e.x + e.w)); const bottom = Math.max(...boxes.map(e => e.y + e.h));
  return { x: left - padding, y: top - padding, width: Math.max(1, Math.ceil(right - left + padding * 2)), height: Math.max(1, Math.ceil(bottom - top + padding * 2)) };
}
export function extractRegionSvg(html: string, prefix: string): string | undefined {
  const start = html.search(/<svg\b/i); if (start < 0) return undefined;
  const tags = /<!--[^]*?-->|<!\[CDATA\[[^]*?\]\]>|<\/?svg\b[^>]*>/gi;
  tags.lastIndex = start;
  let depth = 0; let end = -1; let tag: RegExpExecArray | null;
  while ((tag = tags.exec(html))) {
    if (tag[0].startsWith('<!--') || tag[0].startsWith('<![')) continue;
    if (/^<\/svg/i.test(tag[0])) depth--; else if (!/\/\s*>$/.test(tag[0])) depth++;
    if (depth === 0) { end = tags.lastIndex; break; }
  }
  if (end < 0) throw new ExportError('INVALID_SVG', 'HTML 区域中的 SVG 没有正确闭合。');
  let svg = html.slice(start, end);
  const styles = [...html.matchAll(/<style\b[^>]*>([^]*?)<\/style\s*>/gi)].map(m => m[1]).join('\n').replace(/@import[^;]+;/gi, '').replace(/url\(\s*['"]?https?:[^)]*\)/gi, 'none');
  svg = svg.replace(/<script\b[^>]*>[^]*?<\/script\s*>/gi, '').replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/<!DOCTYPE[^>]*>/gi, '');
  svg = svg.replace(/\s(?:href|xlink:href)\s*=\s*(["'])([^]*?)\1/gi, (match, quote: string, url: string) => /^(?:#|data:image\/)/i.test(url.trim()) ? match : '');
  if (!/\bxmlns\s*=/.test(svg.slice(0, svg.indexOf('>')))) svg = svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (styles) svg = svg.replace(/(<svg\b[^>]*>)/i, `$1<style><![CDATA[${styles.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]></style>`);
  const ids = [...svg.matchAll(/\bid\s*=\s*(["'])(.*?)\1/g)].map(m => m[2]);
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '_');
  const names = new Map(ids.map(id => [id, `${safePrefix}_${id}`]));
  svg = svg.replace(/(\bid\s*=\s*)(["'])(.*?)\2/g, (_match, before: string, quote: string, id: string) => `${before}${quote}${names.get(id) ?? id}${quote}`);
  svg = svg.replace(/url\(\s*(["']?)#([^\s)'" ]+)\1\s*\)/g, (_match, quote: string, id: string) => `url(${quote}#${names.get(id) ?? id}${quote})`);
  svg = svg.replace(/((?:href|xlink:href)\s*=\s*)(["'])#([^"']+)\2/g, (_match, before: string, quote: string, id: string) => `${before}${quote}#${names.get(id) ?? id}${quote}`);
  svg = svg.replace(/(aria-(?:labelledby|describedby)\s*=\s*)(["'])(.*?)\2/g, (_match, before: string, quote: string, values: string) => `${before}${quote}${values.split(/\s+/).map(id => names.get(id) ?? id).join(' ')}${quote}`);
  svg = svg.replace(/(<style\b[^>]*>)([^]*?)(<\/style\s*>)/gi, (_match, startTag: string, css: string, endTag: string) => {
    // Rewrite selectors, never declaration colors such as #fff when an ID is also 'fff'.
    const selectors = css.replace(/([^{}]+)\{/g, (_selectorMatch, selector: string) => `${selector.replace(/#([\w-]+)/g, (match: string, id: string) => names.has(id) ? `#${names.get(id)}` : match)}{`);
    return startTag + selectors + endTag;
  });
  return svg;
}
function wrap(text: string, width: number, size: number): RichTextSegment[][] {
  const rows: RichTextSegment[][] = [];
  for (const line of parseRichText(text)) {
    const segments: RichTextSegment[] = [...(line.marker ? [{ type: 'text' as const, text: `${line.marker} ` }] : []), ...line.segments];
    let row: RichTextSegment[] = []; let used = 0;
    for (const segment of segments) for (const character of segment.text) {
      const cost = /[\u2e80-\uffff]/u.test(character) ? size : size * (segment.type === 'code' ? .62 : .6);
      if (used && used + cost > width) { rows.push(row); row = []; used = 0; }
      const previous = row.at(-1);
      if (previous?.type === segment.type && previous.href === segment.href) previous.text += character;
      else row.push({ ...segment, text: character });
      used += cost;
    }
    rows.push(row);
  }
  return rows;
}
function textSvg(e: BoardElement, board: Board, color: string, center = false): string {
  const size = Math.max(12, scalar(e.fontSize, e.type === 'text' ? 20 : 16));
  const lines = wrap(String(e.text ?? ''), Math.max(size, e.w - (center ? 24 : 4)), size);
  const aligned = e.textAlign ?? (center ? 'center' : 'left');
  const x = aligned === 'center' ? e.x + e.w / 2 : aligned === 'right' ? e.x + e.w - 12 : e.x + (center ? 12 : 0);
  const y = center ? e.y + Math.max(16, (e.h - (lines.length - 1) * size * 1.45) / 2) + size * .35 : e.y + size;
  const segment = (part: RichTextSegment) => { const span = `<tspan${part.type === 'bold' ? ' font-weight="700"' : ''}${part.type === 'italic' ? ' font-style="italic"' : ''}${part.type === 'code' ? ` font-family="${escapeXml(board.style.monoFont)}"` : ''}>${escapeXml(part.text)}</tspan>`; return part.type === 'link' && part.href ? `<a href="${escapeXml(part.href)}" fill="${escapeXml(board.style.link)}">${span}</a>` : span; };
  return `<text fill="${escapeXml(color)}" font-family="${escapeXml(e.fontFamily ?? board.style.fontFamily)}" font-size="${size}" font-weight="${e.bold ? 700 : 400}" font-style="${e.italic ? 'italic' : 'normal'}" text-anchor="${aligned === 'center' ? 'middle' : aligned === 'right' ? 'end' : 'start'}">${lines.map((line, i) => `<tspan x="${x}" y="${y + i * size * 1.45}">${line.map(segment).join('')}</tspan>`).join('')}</text>`;
}
function shapeSvg(e: BoardElement, fill: string, stroke: string): string {
  const common = `fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="${scalar(e.strokeWidth ?? e.width, 1.5)}"${e.dash ? ' stroke-dasharray="6 5"' : ''}`;
  const { x, y, w, h } = e;
  if (e.kind === 'ellipse' || e.kind === 'circle') return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${common}/>`;
  const path = shapePath(e);
  if (path) return `<path transform="translate(${x} ${y})" d="${path}" ${common}/>`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${e.kind === 'pill' ? h / 2 : e.kind === 'rect' || e.kind === 'queue' ? 0 : 7}" ${common}/>` + (e.kind === 'queue' ? `<path d="M${x + 14},${y}V${y + h} M${x + w - 14},${y}V${y + h}" fill="none" stroke="${escapeXml(stroke)}"/>` : '');
}
function endpoint(value: BoardElement['from'], elements: BoardElement[]): [number, number] {
  if (Array.isArray(value)) return value;
  const target = elements.find(e => e.id === value);
  if (!target) throw new ExportError('INVALID_ARROW', '一条连线引用的对象已不存在，请修复后导出。');
  return [target.x + target.w / 2, target.y + target.h / 2];
}
function headSvg(kind: string, tip: Point, inside: Point, color: string): string {
  if (kind === 'none') return '';
  if (kind === 'circle') return `<circle cx="${tip.x}" cy="${tip.y}" r="4.5" fill="${escapeXml(color)}"/>`;
  const length = Math.hypot(inside.x - tip.x, inside.y - tip.y) || 1;
  const dx = (inside.x - tip.x) / length, dy = (inside.y - tip.y) / length;
  return `<polygon points="${tip.x},${tip.y} ${tip.x + dx * 10 - dy * 4},${tip.y + dy * 10 + dx * 4} ${tip.x + dx * 10 + dy * 4},${tip.y + dy * 10 - dx * 4}" fill="${escapeXml(color)}"/>`;
}
export function elementSvg(e: BoardElement, board: Board, options: ExportOptions = {}): string {
  const style = board.style; const ink = semanticColor(e.stroke, style, style.muted);
  let markup = '';
  if (e.type === 'html') {
    const html = String(e.html ?? '');
    if (options.svgRegions === true) {
      const svg = extractRegionSvg(html, e.id);
      if (!svg) throw new ExportError('EXPORT_BROWSER_REQUIRED', '该 HTML 区域没有内联 SVG，请在界面导出 PNG，或导出 HTML 保留完整内容。');
      markup = svg.replace(/<svg\b([^>]*)>/i, (_m, attrs: string) => `<svg${attrs.replace(/\s(?:x|y|width|height)\s*=\s*(["']).*?\1/gi, '')} x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}">`);
    } else {
      const body = /<body\b[^>]*>([^]*?)<\/body\s*>/i.exec(html)?.[1] ?? html.replace(/<!doctype[^>]*>|<\/?(?:html|head)\b[^>]*>/gi, '');
      const styles = [...html.matchAll(/<style\b[^>]*>[^]*?<\/style\s*>/gi)].map(m => m[0]).join('');
      const computed = typeof options.xhtmlRegions === 'object' && options.xhtmlRegions ? (options.xhtmlRegions as Record<string, string>)[e.id] : undefined;
      const safe = computed ?? (styles + body).replace(/<script\b[^>]*>[^]*?<\/script\s*>/gi, '').replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b([^>]*?)(?<!\/)\s*>/gi, '<$1$2/>').replace(/&nbsp;/gi, '&#160;').replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/gi, '&amp;');
      markup = `<foreignObject x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;overflow:hidden">${safe}</div></foreignObject>`;
    }
  } else if (e.type === 'text' || e.type === 'sticker') markup = textSvg(e, board, semanticColor(e.color, style, style.ink));
  else if (e.type === 'stroke') {
    markup = `<path d="${strokePath(e.points, e)}" fill="none" stroke="${escapeXml(semanticColor(e.stroke ?? e.color, style, style.muted))}" stroke-width="${scalar(e.strokeWidth ?? e.width, 3)}"${e.dash ? ' stroke-dasharray="6 5"' : ''} stroke-linecap="round" stroke-linejoin="round"/>`;
  } else if (e.type === 'arrow') {
    endpoint(e.from, board.elements); endpoint(e.to, board.elements);
    const route = arrowGeometry(e, board.elements), heads = arrowHeads(e);
    const color = semanticColor(e.stroke ?? e.color, style, style.muted);
    markup = `<path d="${route.path}" fill="none" stroke="${escapeXml(color)}" stroke-width="${scalar(e.strokeWidth ?? e.width, 1.5)}" stroke-linejoin="round" ${e.dash ? 'stroke-dasharray="5 4"' : ''}/>` + headSvg(heads[0], route.points[0], route.points[1] ?? route.points[0], color) + headSvg(heads[1], route.points.at(-1)!, route.points.at(-2) ?? route.points.at(-1)!, color);
    if (e.label) { const width = Math.max(28, [...e.label].length * 14 + 16); markup += `<rect x="${route.label.x - width / 2}" y="${route.label.y - 22}" width="${width}" height="20" fill="${escapeXml(style.paper)}"/>` + textSvg({ ...e, x: route.label.x - width / 2, y: route.label.y - 22, w: width, h: 20, text: e.label, fontSize: 12, textAlign: 'center' }, board, style.muted, true); }
  } else if (e.type === 'image') {
    const source = typeof options.assets === 'object' && options.assets ? (options.assets as Record<string, string>)[String(e.src)] ?? e.src : e.src;
    if (source && /^data:image\//i.test(source)) {
      if (e.crop) {
        const naturalWidth = scalar(e.data?.naturalWidth, 0), naturalHeight = scalar(e.data?.naturalHeight, 0);
        if (!naturalWidth || !naturalHeight) throw new ExportError('EXPORT_BROWSER_REQUIRED', '裁剪图片缺少原始尺寸，请在白板中打开裁剪面板保存后导出。');
        const zoom = Math.max(1, scalar(e.crop.zoom, 1)), x = Math.min(1, Math.max(0, scalar(e.crop.x, .5))), y = Math.min(1, Math.max(0, scalar(e.crop.y, .5)));
        const scale = Math.max(e.w / naturalWidth, e.h / naturalHeight) * zoom, width = naturalWidth * scale, height = naturalHeight * scale;
        const clipId = `studio-crop-${[...e.id].map(c => c.codePointAt(0)!.toString(16)).join('_')}`;
        markup = `<defs><clipPath id="${clipId}"><rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}"/></clipPath></defs><g clip-path="url(#${clipId})"><image x="${e.x + (e.w - width) * x}" y="${e.y + (e.h - height) * y}" width="${width}" height="${height}" href="${escapeXml(source)}" preserveAspectRatio="none"/></g>`;
      } else markup = `<image x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" href="${escapeXml(source)}" preserveAspectRatio="xMidYMid meet"/>`;
    }
    else throw new ExportError('ASSET_NOT_EMBEDDED', '导出需要嵌入图片资源，请从白板界面导出或重新加载图片。');
    const href = !e.video && safeHttpLink(e.href);
    if (href) markup = `<a href="${escapeXml(href)}" target="_blank" rel="noopener noreferrer">${markup}</a>`;
  } else if (e.type === 'table') {
    const rows = Array.isArray(e.data?.rows) ? e.data.rows as unknown[][] : [];
    const cols = Math.max(1, ...rows.map(row => Array.isArray(row) ? row.length : 1)); const rowHeight = e.h / Math.max(1, rows.length);
    markup = rows.map((row, ri) => row.map((cell, ci) => `<rect x="${e.x + ci * e.w / cols}" y="${e.y + ri * rowHeight}" width="${e.w / cols}" height="${rowHeight}" fill="${escapeXml(ri ? style.paper : style['paper-2'] ?? style.paper)}" stroke="${escapeXml(ink)}"/>${textSvg({ ...e, x: e.x + ci * e.w / cols + 8, y: e.y + ri * rowHeight, w: e.w / cols - 16, h: rowHeight, text: String(cell), fontSize: 14 }, board, style.ink, true)}`).join('')).join('');
  } else {
    const fill = e.type === 'container' || e.hollow ? 'none' : semanticColor(e.fill, style, e.type === 'note' ? '#fff0b5' : style['paper-2'] ?? style.paper);
    let textColor = semanticColor(e.color, style, style.ink);
    if (contrastRatio(textColor, fill === 'none' ? 'transparent' : fill, style.paper) < 4.5) textColor = readableText(fill === 'none' ? 'transparent' : fill, style.paper);
    markup = shapeSvg(e, fill, ink) + textSvg(e, board, textColor, true);
  }
  return `<g data-studio-id="${escapeXml(e.id)}"${e.rotation ? ` transform="rotate(${e.rotation} ${e.x + e.w / 2} ${e.y + e.h / 2})"` : ''}>${markup}</g>`;
}
export function buildBoardSvg(board: Board, options: ExportOptions = {}): string {
  const elements = selectedElements(board, options); const bounds = boardBounds(elements, Math.max(0, Math.min(500, scalar(options.padding, 32))), board.elements);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" role="img" aria-labelledby="studio-export-title studio-export-description"><title id="studio-export-title">${escapeXml(board.artifact.title)}</title><desc id="studio-export-description">白板版本 ${board.artifact.revision}，包含 ${elements.length} 个对象。</desc><defs><marker id="studio-export-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="${escapeXml(board.style.muted)}"/></marker></defs><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="${escapeXml(board.style.paper)}"/>${elements.map(e => elementSvg(e, board, options)).join('')}</svg>`;
}
export function buildBoardHtml(board: Board, options: ExportOptions = {}): string {
  const elements = selectedElements(board, options); const bounds = boardBounds(elements, 32, board.elements);
  const layers = elements.map(e => {
    if (e.type === 'html') return `<iframe title="${escapeXml(e.text || e.id)}" sandbox="allow-scripts" style="position:absolute;border:0;left:${e.x - bounds.x}px;top:${e.y - bounds.y}px;width:${e.w}px;height:${e.h}px;transform:rotate(${scalar(e.rotation, 0)}deg)" srcdoc="${escapeXml(String(e.html ?? ''))}"></iframe>`;
    const box = boardBounds([e], 2, board.elements); const markerId = `arrow_${e.id.replace(/[^\w-]/g, '_')}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;left:${box.x - bounds.x}px;top:${box.y - bounds.y}px" width="${box.width}" height="${box.height}" viewBox="${box.x} ${box.y} ${box.width} ${box.height}"><defs><marker id="${markerId}" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="${escapeXml(board.style.muted)}"/></marker></defs>${elementSvg(e, board, { ...options, markerId })}</svg>`;
  }).join('');
  return `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'unsafe-inline';style-src 'unsafe-inline';img-src data: blob:;font-src data:;frame-src 'self' data: blob:;connect-src 'none'"><title>${escapeXml(board.artifact.title)}</title><style>body{margin:0;background:${escapeXml(board.style.paper)};color:${escapeXml(board.style.ink)}main{position:relative;width:${bounds.width}px;height:${bounds.height}px;margin:auto}svg{display:block}iframe{background:transparent}@media print{main{margin:0}}</style></head><body><main aria-label="${escapeXml(board.artifact.title)}">${layers}</main></body></html>\n`;
}
