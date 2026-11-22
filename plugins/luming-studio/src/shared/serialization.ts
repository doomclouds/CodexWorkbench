import type { Board, BoardElement, Json } from '../contracts/studio.js';
import { normalizeTodoItems, type TodoItem } from '../contracts/todo.js';
import { semanticColor } from './theme.js';
import {
  arrowGeometry,
  arrowHeads,
  arrowLabelBox,
  shapePath,
  strokePath,
  type Point,
} from './whiteboard-geometry.js';
import { boardStickerMarkup } from './whiteboard-stickers.js';
import { tableValues } from './whiteboard-table.js';
import { parseRichText, safeHttpLink, type RichTextSegment } from './rich-text.js';
import {
  documentPlainText,
  flattenDocumentBlocks,
  type DocumentContent,
} from '../contracts/document.js';
import { blocksHtml, documentSurfaceCss, DOCUMENT_EXPORT_CSS } from './document-serialization.js';
import { documentSurface } from './document-surface.js';
import {
  nativeBackdrop,
  nativeFill,
  nativeSurfaces,
  nativeTableInk,
  nativeTextInk,
} from './native-surface.js';

export interface ExportOptions {
  regionId?: string;
  elementId?: string;
  ids?: string[];
  padding?: number;
  scale?: number;
  [key: string]: unknown;
}
interface SvgViewport {
  bounds: { x: number; y: number; width: number; height: number };
  width: number;
  height: number;
}

export class ExportError extends Error {
  constructor(
    public code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ExportError';
  }
}

export function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function filenameFor(title: string, extension: string): string {
  let name =
    title
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
      .replace(/[. ]+$/g, '')
      .trim()
      .slice(0, 100) || '白板';

  if (/^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(name)) {
    name = `_${name}`;
  }
  return `${name}.${extension}`;
}

export function selectedElements(board: Board, options: ExportOptions = {}): BoardElement[] {
  const id = options.regionId ?? options.elementId;
  const ids = id ? [id] : options.ids;
  if (!ids) {
    return board.elements;
  }

  const selected = board.elements.filter((e) => ids.includes(e.id));
  if (selected.length !== new Set(ids).size) {
    throw new ExportError('ELEMENT_NOT_FOUND', '部分导出对象已不存在，请刷新后重试。');
  }

  return selected;
}

export const isHtmlRegionElement = (element: BoardElement): boolean =>
  element.type === 'html' || (element.type === 'diagram' && typeof element.html === 'string');

export async function inlineExportAssets(
  board: Board,
  format: string,
  options: ExportOptions,
  resolveSource: (source: string) => Promise<string>,
): Promise<Board> {
  const cloned = structuredClone(board);
  const resolved = new Map<string, Promise<string>>();
  const read = (source: string) => {
    if (/^(?:data:|#)/i.test(source)) {
      return Promise.resolve(source);
    }

    if (!resolved.has(source)) {
      resolved.set(source, resolveSource(source));
    }
    return resolved.get(source)!;
  };

  for (const element of selectedElements(cloned, options)) {
    if (element.type === 'document' && element.document) {
      await inlineDocumentImages(element.document, read);
    }
    if (element.type === 'image') {
      if (typeof element.src === 'string') {
        element.src = await read(element.src);
      }
      if (format === 'html' && typeof element.video === 'string') {
        element.video = await read(element.video);
      }
    }
    if (!isHtmlRegionElement(element) || typeof element.html !== 'string') {
      continue;
    }

    const attributes = /((?:src|href|poster)\s*=\s*["'])(\/assets\/[^"'<>]+)(["'])/gi;
    const urls = /url\(\s*["']?(\/assets\/[^)"']+)["']?\s*\)/gi;
    const references = new Set(
      [...element.html.matchAll(attributes)]
        .map((match) => match[2]!)
        .concat([...element.html.matchAll(urls)].map((match) => match[1]!)),
    );
    const values = new Map<string, string>();
    for (const reference of references) {
      values.set(reference, await read(reference.trim()));
    }
    element.html = element.html
      .replace(
        attributes,
        (_, prefix, reference, suffix) => `${prefix}${values.get(reference)}${suffix}`,
      )
      .replace(urls, (_, reference) => `url("${values.get(reference)}")`);
  }
  return cloned;
}

async function inlineDocumentImages(
  document: DocumentContent,
  read: (source: string) => Promise<string>,
): Promise<void> {
  for (const block of flattenDocumentBlocks(document.blocks)) {
    if (block.type !== 'image' || typeof block.props.url !== 'string' || !block.props.url) {
      continue;
    }

    block.props.url = await read(block.props.url);
    if (!/^data:image\//i.test(block.props.url)) {
      throw new ExportError(
        'ASSET_NOT_EMBEDDED',
        '文档图片尚未嵌入，请先导入 Studio 图片资源后导出。',
      );
    }
  }
}

function scalar(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function boardBounds(
  elements: BoardElement[],
  padding = 32,
  scene: BoardElement[] = elements,
) {
  if (!elements.length) {
    return { x: 0, y: 0, width: 960, height: 540 };
  }

  const boxes = elements.map((e) => {
    if (e.type === 'arrow') {
      endpoint(e.from, scene);
      endpoint(e.to, scene);
      const route = arrowGeometry(e, scene);
      const points = route.points;
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const path = {
        x: Math.min(...xs) - 16,
        y: Math.min(...ys) - 28,
        w: Math.max(32, Math.max(...xs) - Math.min(...xs) + 32),
        h: Math.max(48, Math.max(...ys) - Math.min(...ys) + 48),
      };
      const label = arrowLabelBox(e, route.label);
      if (!label) {
        return path;
      }

      const x = Math.min(path.x, label.x);
      const y = Math.min(path.y, label.y);
      return {
        x,
        y,
        w: Math.max(path.x + path.w, label.x + label.w) - x,
        h: Math.max(path.y + path.h, label.y + label.h) - y,
      };
    }
    if (e.type === 'stroke' && e.points?.length) {
      const xs = e.points.filter((_n, i) => i % 2 === 0);
      const ys = e.points.filter((_n, i) => i % 2 === 1);
      const pen = scalar(e.strokeWidth ?? e.width, 3);
      return {
        x: e.x + Math.min(...xs) - pen,
        y: e.y + Math.min(...ys) - pen,
        w: Math.max(...xs) - Math.min(...xs) + pen * 2,
        h: Math.max(...ys) - Math.min(...ys) + pen * 2,
      };
    }
    const radians = (scalar(e.rotation, 0) * Math.PI) / 180;
    const w = Math.max(1, scalar(e.w, 200));
    const h = Math.max(1, scalar(e.h, 100));
    const turnedWidth = Math.abs(w * Math.cos(radians)) + Math.abs(h * Math.sin(radians));
    const turnedHeight = Math.abs(w * Math.sin(radians)) + Math.abs(h * Math.cos(radians));
    return {
      x: scalar(e.x, 0) + (w - turnedWidth) / 2,
      y: scalar(e.y, 0) + (h - turnedHeight) / 2,
      w: turnedWidth,
      h: turnedHeight,
    };
  });
  const left = Math.min(...boxes.map((e) => e.x));
  const top = Math.min(...boxes.map((e) => e.y));
  const right = Math.max(...boxes.map((e) => e.x + e.w));
  const bottom = Math.max(...boxes.map((e) => e.y + e.h));
  return {
    x: left - padding,
    y: top - padding,
    width: Math.max(1, Math.ceil(right - left + padding * 2)),
    height: Math.max(1, Math.ceil(bottom - top + padding * 2)),
  };
}

export function extractRegionSvg(html: string, prefix: string): string | undefined {
  const start = html.search(/<svg\b/i);
  if (start < 0) {
    return undefined;
  }

  const tags = /<!--[^]*?-->|<!\[CDATA\[[^]*?\]\]>|<\/?svg\b[^>]*>/gi;
  tags.lastIndex = start;
  let depth = 0;
  let end = -1;
  let tag: RegExpExecArray | null;
  while ((tag = tags.exec(html))) {
    if (tag[0].startsWith('<!--') || tag[0].startsWith('<![')) {
      continue;
    }

    if (/^<\/svg/i.test(tag[0])) {
      depth--;
    } else if (!/\/\s*>$/.test(tag[0])) {
      depth++;
    }
    if (depth === 0) {
      end = tags.lastIndex;
      break;
    }
  }
  if (end < 0) {
    throw new ExportError('INVALID_SVG', 'HTML 区域中的 SVG 没有正确闭合。');
  }

  let svg = html.slice(start, end);
  const styles = [...html.matchAll(/<style\b[^>]*>([^]*?)<\/style\s*>/gi)]
    .map((m) => m[1])
    .join('\n')
    .replace(/@import[^;]+;/gi, '')
    .replace(/url\(\s*['"]?https?:[^)]*\)/gi, 'none');
  svg = svg
    .replace(/<script\b[^>]*>[^]*?<\/script\s*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '');
  svg = svg.replace(
    /\s(?:href|xlink:href)\s*=\s*(["'])([^]*?)\1/gi,
    (match, quote: string, url: string) => (/^(?:#|data:image\/)/i.test(url.trim()) ? match : ''),
  );

  if (!/\bxmlns\s*=/.test(svg.slice(0, svg.indexOf('>')))) {
    svg = svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (styles) {
    svg = svg.replace(
      /(<svg\b[^>]*>)/i,
      `$1<style><![CDATA[${styles.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]></style>`,
    );
  }
  const ids = [...svg.matchAll(/\bid\s*=\s*(["'])(.*?)\1/g)].map((m) => m[2]);
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '_');
  const names = new Map(ids.map((id) => [id, `${safePrefix}_${id}`]));
  svg = svg.replace(
    /(\bid\s*=\s*)(["'])(.*?)\2/g,
    (_match, before: string, quote: string, id: string) =>
      `${before}${quote}${names.get(id) ?? id}${quote}`,
  );
  svg = svg.replace(
    /url\(\s*(["']?)#([^\s)'" ]+)\1\s*\)/g,
    (_match, quote: string, id: string) => `url(${quote}#${names.get(id) ?? id}${quote})`,
  );
  svg = svg.replace(
    /((?:href|xlink:href)\s*=\s*)(["'])#([^"']+)\2/g,
    (_match, before: string, quote: string, id: string) =>
      `${before}${quote}#${names.get(id) ?? id}${quote}`,
  );
  svg = svg.replace(
    /(aria-(?:labelledby|describedby)\s*=\s*)(["'])(.*?)\2/g,
    (_match, before: string, quote: string, values: string) =>
      `${before}${quote}${values
        .split(/\s+/)
        .map((id) => names.get(id) ?? id)
        .join(' ')}${quote}`,
  );
  svg = svg.replace(
    /(<style\b[^>]*>)([^]*?)(<\/style\s*>)/gi,
    (_match, startTag: string, css: string, endTag: string) => {
      const selectors = css.replace(
        /([^{}]+)\{/g,
        (_selectorMatch, selector: string) =>
          `${selector.replace(/#([\w-]+)/g, (match: string, id: string) => (names.has(id) ? `#${names.get(id)}` : match))}{`,
      );

      return startTag + selectors + endTag;
    },
  );

  return svg;
}

function wrap(text: string, width: number, size: number): RichTextSegment[][] {
  const rows: RichTextSegment[][] = [];
  for (const line of parseRichText(text)) {
    const segments: RichTextSegment[] = [
      ...(line.marker
        ? [{ type: 'text' as const, text: `${'  '.repeat(line.indent ?? 0)}${line.marker} ` }]
        : []),
      ...line.segments,
    ];
    appendWrappedRows(rows, segments, width, size);
  }
  return rows;
}

function appendWrappedRows(
  rows: RichTextSegment[][],
  segments: RichTextSegment[],
  width: number,
  size: number,
): void {
  let row: RichTextSegment[] = [];
  let used = 0;
  for (const segment of segments) {
    const narrowWidth = size * (segment.type === 'code' || segment.code ? 0.62 : 0.6);
    for (const character of segment.text) {
      const cost = /[\u2e80-\uffff]/u.test(character) ? size : narrowWidth;
      if (used && used + cost > width) {
        rows.push(row);
        row = [];
        used = 0;
      }
      appendCharacter(row, segment, character);
      used += cost;
    }
  }
  rows.push(row);
}

function appendCharacter(row: RichTextSegment[], segment: RichTextSegment, character: string) {
  const previous = row.at(-1);
  if (previous?.type !== segment.type || previous.href !== segment.href) {
    row.push({ ...segment, text: character });
    return;
  }
  const sameEmphasis = previous.bold === segment.bold && previous.italic === segment.italic;
  if (sameEmphasis && previous.code === segment.code) {
    previous.text += character;
  } else {
    row.push({ ...segment, text: character });
  }
}

function textAlignment(element: BoardElement, center: boolean) {
  const aligned = element.textAlign ?? (center ? 'center' : 'left');
  if (aligned === 'center') {
    return { x: element.x + element.w / 2, anchor: 'middle' };
  }
  if (aligned === 'right') {
    return { x: element.x + element.w - 12, anchor: 'end' };
  }

  return { x: element.x + (center ? 12 : 0), anchor: 'start' };
}

function textSvg(e: BoardElement, board: Board, color: string, center = false): string {
  const size = Math.max(12, scalar(e.fontSize, e.type === 'text' ? 20 : 16));
  const lines = wrap(String(e.text ?? ''), Math.max(size, e.w - (center ? 24 : 4)), size);
  const { x, anchor } = textAlignment(e, center);
  const y = center
    ? e.y + Math.max(16, (e.h - (lines.length - 1) * size * 1.45) / 2) + size * 0.35
    : e.y + size;
  const segment = (part: RichTextSegment) => {
    const span = `<tspan${part.type === 'bold' || part.bold ? ' font-weight="700"' : ''}${part.type === 'italic' || part.italic ? ' font-style="italic"' : ''}${part.type === 'code' || part.code ? ` font-family="${escapeXml(board.style.monoFont)}"` : ''}>${escapeXml(part.text)}</tspan>`;
    return part.type === 'link' && part.href
      ? `<a href="${escapeXml(part.href)}" fill="${escapeXml(board.style.link)}">${span}</a>`
      : span;
  };

  return `<text fill="${escapeXml(color)}" font-family="${escapeXml(e.fontFamily ?? board.style.fontFamily)}" font-size="${size}" font-weight="${e.bold ? 700 : 400}" font-style="${e.italic ? 'italic' : 'normal'}" text-anchor="${anchor}">${lines.map((line, i) => `<tspan x="${x}" y="${y + i * size * 1.45}">${line.map(segment).join('')}</tspan>`).join('')}</text>`;
}

function shapeSvg(e: BoardElement, fill: string, stroke: string): string {
  const common = `fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="${scalar(e.strokeWidth ?? e.width, 1.5)}"${e.dash ? ' stroke-dasharray="6 5"' : ''}`;
  const { x, y, w, h } = e;
  if (e.kind === 'ellipse' || e.kind === 'circle') {
    return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${common}/>`;
  }

  const path = shapePath(e);
  if (path) {
    return `<path transform="translate(${x} ${y})" d="${path}" ${common}/>`;
  }

  let radius = 7;
  if (e.kind === 'pill') {
    radius = h / 2;
  } else if (e.kind === 'rect' || e.kind === 'queue') {
    radius = 0;
  }
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" ${common}/>` +
    (e.kind === 'queue'
      ? `<path d="M${x + 14},${y}V${y + h} M${x + w - 14},${y}V${y + h}" fill="none" stroke="${escapeXml(stroke)}"/>`
      : '')
  );
}

function todoSourceAttribute(item: TodoItem): string {
  return item.sourceRef ? ` data-source-ref="${escapeXml(JSON.stringify(item.sourceRef))}"` : '';
}

function todoSvg(e: BoardElement, board: Board): string {
  const surface = documentSurface(e, board.style);
  const items = normalizeTodoItems(e.data?.items);
  const count = items.filter((item) => item.checked).length;
  const { x, y, w, h } = e;
  const clipId = `studio-todo-${[...e.id].map((c) => c.codePointAt(0)!.toString(16)).join('_')}`;
  const paper = escapeXml(surface.paper);
  const ink = escapeXml(surface.ink);
  const muted = escapeXml(surface.muted);
  const line = escapeXml(surface.rule);
  const accent = escapeXml(surface.link);
  const title = `<svg x="${x + 12}" y="${y}" width="${Math.max(1, w - 72)}" height="40" overflow="hidden"><text y="26" fill="${ink}" font-size="17" font-weight="600">${escapeXml(e.text || '任务清单')}</text></svg>`;
  const progress = `<text x="${x + w - 12}" y="${y + 25}" fill="${muted}" font-size="12" text-anchor="end">${count}/${items.length}</text>`;
  const rows = items
    .map((item, index) => {
      const rowY = y + 40 + index * 32;
      const bx = x + 14;
      const by = rowY + 9;
      const check = item.checked
        ? `<path d="M${bx + 3} ${by + 7}l3 3l5 -6" fill="none" stroke="${paper}" stroke-width="1.5"/>`
        : '';

      return `<g data-studio-task-id="${escapeXml(item.id)}" data-checked="${item.checked}"${todoSourceAttribute(item)}>
      <path d="M${x} ${rowY}H${x + w}" stroke="${line}"/>
      <rect x="${bx}" y="${by}" width="14" height="14" rx="3" fill="${item.checked ? accent : paper}" stroke="${item.checked ? accent : line}"/>${check}
      <text x="${x + 38}" y="${rowY + 21}" fill="${item.checked ? muted : ink}" font-size="14">${escapeXml(item.text.replace(/\s+/g, ' '))}</text>
    </g>`;
    })
    .join('');

  return `<defs><clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7"/></clipPath></defs>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${paper}" stroke="${line}"/>
    <g clip-path="url(#${clipId})" font-family="${escapeXml(e.fontFamily ?? board.style.fontFamily)}">${title}${progress}${rows}</g>`;
}

function endpoint(value: BoardElement['from'], elements: BoardElement[]): [number, number] {
  if (Array.isArray(value)) {
    return value;
  }

  const target = elements.find((e) => e.id === value);
  if (!target) {
    throw new ExportError('INVALID_ARROW', '一条连线引用的对象已不存在，请修复后导出。');
  }

  return [target.x + target.w / 2, target.y + target.h / 2];
}

function headSvg(kind: string, tip: Point, inside: Point, color: string): string {
  if (kind === 'none') {
    return '';
  }
  if (kind === 'circle') {
    return `<circle cx="${tip.x}" cy="${tip.y}" r="4.5" fill="${escapeXml(color)}"/>`;
  }

  const length = Math.hypot(inside.x - tip.x, inside.y - tip.y) || 1;
  const dx = (inside.x - tip.x) / length;
  const dy = (inside.y - tip.y) / length;
  return `<polygon points="${tip.x},${tip.y} ${tip.x + dx * 10 - dy * 4},${tip.y + dy * 10 + dx * 4} ${tip.x + dx * 10 + dy * 4},${tip.y + dy * 10 - dx * 4}" fill="${escapeXml(color)}"/>`;
}

function documentPreviewSvg(e: BoardElement, document: DocumentContent, board: Board): string {
  const style = board.style;
  const surface = documentSurface(e, style);
  const preview = {
    ...e,
    text: `${e.text || '文档'}\n${documentPlainText(document).slice(0, 200)}`,
    fontSize: 15,
  };

  return `<rect data-document-backdrop="true" x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" fill="${escapeXml(surface.backdrop)}" rx="7"/><rect data-document-paper="true" x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" fill="${escapeXml(surface.paper)}" stroke="${escapeXml(surface.rule)}" rx="7"/>${textSvg(preview, board, surface.ink)}`;
}

function htmlRegionSvg(e: BoardElement, options: ExportOptions): string {
  const html = String(e.html ?? '');
  if (options.svgRegions === true) {
    const svg = extractRegionSvg(html, e.id);
    if (!svg) {
      throw new ExportError(
        'EXPORT_BROWSER_REQUIRED',
        '该 HTML 区域没有内联 SVG，请在界面导出 PNG，或导出 HTML 保留完整内容。',
      );
    }

    return svg.replace(
      /<svg\b([^>]*)>/i,
      (_m, attrs: string) =>
        `<svg${attrs.replace(/\s(?:x|y|width|height)\s*=\s*(["']).*?\1/gi, '')} x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}">`,
    );
  }
  const body =
    /<body\b[^>]*>([^]*?)<\/body\s*>/i.exec(html)?.[1] ??
    html.replace(/<!doctype[^>]*>|<\/?(?:html|head)\b[^>]*>/gi, '');
  const styles = [...html.matchAll(/<style\b[^>]*>[^]*?<\/style\s*>/gi)].map((m) => m[0]).join('');
  const computed =
    typeof options.xhtmlRegions === 'object' && options.xhtmlRegions
      ? (options.xhtmlRegions as Record<string, string>)[e.id]
      : undefined;
  const safe =
    computed ??
    (styles + body)
      .replace(/<script\b[^>]*>[^]*?<\/script\s*>/gi, '')
      .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(
        /<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b([^>]*?)(?<!\/)\s*>/gi,
        '<$1$2/>',
      )
      .replace(/&nbsp;/gi, '&#160;')
      .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/gi, '&amp;');

  return `<foreignObject x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;overflow:hidden">${safe}</div></foreignObject>`;
}

function arrowSvg(e: BoardElement, board: Board): string {
  const style = board.style;
  endpoint(e.from, board.elements);
  endpoint(e.to, board.elements);
  const route = arrowGeometry(e, board.elements);
  const heads = arrowHeads(e);
  const color = semanticColor(e.stroke ?? e.color, style, style.muted);
  let markup =
    `<path d="${route.path}" fill="none" stroke="${escapeXml(color)}" stroke-width="${scalar(e.strokeWidth ?? e.width, 1.5)}" stroke-linejoin="round" ${e.dash ? 'stroke-dasharray="5 4"' : ''}/>` +
    headSvg(heads[0], route.points[0], route.points[1] ?? route.points[0], color) +
    headSvg(heads[1], route.points.at(-1)!, route.points.at(-2) ?? route.points.at(-1)!, color);

  if (e.label) {
    const box = arrowLabelBox(e, route.label)!;
    markup +=
      `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="${escapeXml(style.paper)}"/>` +
      textSvg(
        { ...e, ...box, text: e.label, fontSize: e.labelSize ? 13 : 12, textAlign: 'center' },
        board,
        style.muted,
        true,
      );
  }

  return markup;
}

function croppedImageSvg(
  e: BoardElement,
  crop: NonNullable<BoardElement['crop']>,
  source: string,
): string {
  const naturalWidth = scalar(e.data?.naturalWidth, 0);
  const naturalHeight = scalar(e.data?.naturalHeight, 0);
  if (!naturalWidth || !naturalHeight) {
    throw new ExportError(
      'EXPORT_BROWSER_REQUIRED',
      '裁剪图片缺少原始尺寸，请在白板中打开裁剪面板保存后导出。',
    );
  }

  const zoom = Math.max(1, scalar(crop.zoom, 1));
  const x = Math.min(1, Math.max(0, scalar(crop.x, 0.5)));
  const y = Math.min(1, Math.max(0, scalar(crop.y, 0.5)));
  const scale = Math.max(e.w / naturalWidth, e.h / naturalHeight) * zoom;
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  const clipId = `studio-crop-${[...e.id].map((c) => c.codePointAt(0)!.toString(16)).join('_')}`;
  return `<defs><clipPath id="${clipId}"><rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}"/></clipPath></defs><g clip-path="url(#${clipId})"><image x="${e.x + (e.w - width) * x}" y="${e.y + (e.h - height) * y}" width="${width}" height="${height}" href="${escapeXml(source)}" preserveAspectRatio="none"/></g>`;
}

function imageSvg(e: BoardElement, options: ExportOptions): string {
  const source =
    typeof options.assets === 'object' && options.assets
      ? ((options.assets as Record<string, string>)[String(e.src)] ?? e.src)
      : e.src;

  if (!source || !/^data:image\//i.test(source)) {
    throw new ExportError(
      'ASSET_NOT_EMBEDDED',
      '导出需要嵌入图片资源，请从白板界面导出或重新加载图片。',
    );
  }

  const markup = e.crop
    ? croppedImageSvg(e, e.crop, source)
    : `<image x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" href="${escapeXml(source)}" preserveAspectRatio="xMidYMid meet"/>`;
  const href = !e.video && safeHttpLink(e.href);
  return href
    ? `<a href="${escapeXml(href)}" target="_blank" rel="noopener noreferrer">${markup}</a>`
    : markup;
}

function tableSvg(e: BoardElement, board: Board, ink: string): string {
  const style = board.style;
  const rows = tableValues(e);
  const cols = Math.max(1, ...rows.map((row) => (Array.isArray(row) ? row.length : 1)));
  const rowHeight = e.h / Math.max(1, rows.length);
  const stored = e.data?.columnWidths;
  const proportions =
    Array.isArray(stored) &&
    stored.length === cols &&
    stored.every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)
      ? (stored as number[])
      : Array.from({ length: cols }, () => 1);
  const total = proportions.reduce((sum, value) => sum + value, 0);
  const widths = proportions.map((value) => (value / total) * e.w);
  const offsets = [0];
  for (const width of widths) {
    offsets.push(offsets.at(-1)! + width);
  }
  const headerFill = nativeFill(e, style);
  const headerInk = nativeTableInk(e.color, style, headerFill);
  const bodyInk = nativeTableInk(e.color, style, style.paper);
  return rows
    .map((row, ri) => {
      const header = ri === 0 && e.data?.head !== false;
      const fill = header ? headerFill : style.paper;
      const cellInk = header ? headerInk : bodyInk;
      return row
        .map(
          (cell, ci) =>
            `<rect x="${e.x + offsets[ci]}" y="${e.y + ri * rowHeight}" width="${widths[ci]}" height="${rowHeight}" fill="${escapeXml(fill)}" stroke="${escapeXml(ink)}"/>${textSvg({ ...e, x: e.x + offsets[ci] + 8, y: e.y + ri * rowHeight, w: widths[ci] - 16, h: rowHeight, text: String(cell), fontSize: e.fontSize ?? 14, bold: header || e.bold }, board, cellInk, true)}`,
        )
        .join('');
    })
    .join('');
}

function elementMarkup(
  e: BoardElement,
  board: Board,
  options: ExportOptions,
  surfaces: ReturnType<typeof nativeSurfaces>,
): string {
  const style = board.style;
  if (e.type === 'todo') {
    return todoSvg(e, board);
  }
  if (e.type === 'document' && e.document) {
    return documentPreviewSvg(e, e.document, board);
  }
  if (isHtmlRegionElement(e)) {
    return htmlRegionSvg(e, options);
  }

  if (e.type === 'sticker') {
    const sticker = boardStickerMarkup(e.data?.stickerIconId);
    if (sticker) {
      return `<svg x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" viewBox="0 0 24 24" data-sticker-icon-id="${escapeXml(e.data?.stickerIconId)}">${sticker}</svg>`;
    }

    return textSvg(e, board, semanticColor(e.color, style, style.ink));
  }
  if (e.type === 'text') {
    const backdrop = nativeBackdrop(e, surfaces, 'transparent');
    return textSvg(e, board, nativeTextInk(e.color, style, 'transparent', backdrop));
  }
  if (e.type === 'stroke') {
    return `<path d="${strokePath(e.points, e)}" fill="none" stroke="${escapeXml(semanticColor(e.stroke ?? e.color, style, style.muted))}" stroke-width="${scalar(e.strokeWidth ?? e.width, 3)}"${e.dash ? ' stroke-dasharray="6 5"' : ''} stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  if (e.type === 'arrow') {
    return arrowSvg(e, board);
  }
  if (e.type === 'image') {
    return imageSvg(e, options);
  }

  const ink = semanticColor(e.stroke, style, style.muted);
  if (e.type === 'table') {
    return tableSvg(e, board, ink);
  }

  const fill = nativeFill(e, style);
  const textColor = nativeTextInk(e.color, style, fill, nativeBackdrop(e, surfaces, fill));
  return shapeSvg(e, fill, ink) + textSvg(e, board, textColor, true);
}

export function elementSvg(
  e: BoardElement,
  board: Board,
  options: ExportOptions = {},
  surfaces = nativeSurfaces(selectedElements(board, options), board.style),
): string {
  const markup = elementMarkup(e, board, options, surfaces);
  return `<g data-studio-id="${escapeXml(e.id)}"${e.rotation ? ` transform="rotate(${e.rotation} ${e.x + e.w / 2} ${e.y + e.h / 2})"` : ''}>${markup}</g>`;
}

export function buildBoardSvg(
  board: Board,
  options: ExportOptions = {},
  viewport?: SvgViewport,
): string {
  const elements = selectedElements(board, options);
  const bounds =
    viewport?.bounds ??
    boardBounds(elements, Math.max(0, Math.min(500, scalar(options.padding, 32))), board.elements);
  const surfaces = nativeSurfaces(elements, board.style);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${viewport?.width ?? bounds.width}" height="${viewport?.height ?? bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}"${viewport ? ' preserveAspectRatio="none"' : ''} role="img" aria-labelledby="studio-export-title studio-export-description"><title id="studio-export-title">${escapeXml(board.artifact.title)}</title><desc id="studio-export-description">白板版本 ${board.artifact.revision}，包含 ${elements.length} 个对象。</desc><defs><marker id="studio-export-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="${escapeXml(board.style.muted)}"/></marker></defs><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="${escapeXml(board.style.paper)}"/>${elements.map((e) => elementSvg(e, board, options, surfaces)).join('')}</svg>`;
}

function offlineEmbedState(initial: Json): void {
  let state = JSON.parse(JSON.stringify(initial)) as Json;
  const listeners = new Set<(value: Json) => void>();
  const copy = () => JSON.parse(JSON.stringify(state)) as Json;
  const error = (message: string) =>
    window.dispatchEvent(
      new CustomEvent('studio-embed-error', { detail: { message, localState: copy() } }),
    );
  Object.defineProperty(window, 'studioEmbed', {
    configurable: false,
    writable: false,
    value: Object.freeze({
      load: copy,
      save(value: unknown) {
        let encoded: string | undefined;
        try {
          encoded = JSON.stringify(value);
        } catch (failure) {
          console.error(
            'Offline embed state serialization failed.',
            failure instanceof Error ? failure.name : typeof failure,
          );
          error('嵌入状态必须是可序列化的 JSON 对象。');
          return;
        }
        const isObject = value && typeof value === 'object' && !Array.isArray(value);
        const maximumBytes = 65_536;
        if (!isObject || !encoded || new TextEncoder().encode(encoded).byteLength > maximumBytes) {
          error('嵌入状态必须是 64 KB 以内的 JSON 对象。');
          return;
        }
        const next = JSON.parse(encoded) as Json;
        if (!next || typeof next !== 'object' || Array.isArray(next)) {
          error('嵌入状态必须是可序列化的 JSON 对象。');
          return;
        }
        if (encoded === JSON.stringify(state)) {
          return;
        }

        state = next;
        for (const listener of listeners) {
          try {
            listener(copy());
          } catch (failure) {
            console.error('Offline embed state listener failed.', failure);
          }
        }
      },
      onLoad(listener: (value: Json) => void) {
        if (typeof listener !== 'function') {
          throw new TypeError('onLoad 需要一个函数。');
        }

        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    }),
  });
}

function offlineRegionHtml(element: BoardElement): string {
  const source = String(element.html ?? '');
  const seed = JSON.stringify(element.state ?? null).replace(/</g, '\\u003c');
  const bridge = `<script data-studio-export-runtime="state">(${offlineEmbedState.toString()})(${seed});</script>`;

  const prefix = /^(?:\uFEFF|\s|<!--[^]*?-->)*<!doctype[^>]*>/i.exec(source)?.[0] ?? '';
  return `${prefix}${bridge}${source.slice(prefix.length)}`;
}

const TODO_EXPORT_CSS = `.studio-export-todo{box-sizing:border-box;overflow:auto;border:1px solid;border-radius:7px;font:14px/1.5 system-ui,sans-serif}
.studio-export-todo header{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:8px 12px;position:sticky;top:0;background:inherit}
.studio-export-todo h1{margin:0;font-size:17px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.studio-export-todo header span{color:var(--todo-muted);white-space:nowrap}
.studio-export-todo ul{margin:0;padding:0;list-style:none}
.studio-export-todo li{border-top:1px solid var(--todo-rule)}
.studio-export-todo label{display:flex;align-items:flex-start;gap:8px;padding:6px 12px}
.studio-export-todo input{margin:3px 0 0;accent-color:var(--todo-accent)}
.studio-export-todo li span{white-space:pre-wrap;overflow-wrap:anywhere}
.studio-export-todo li:has(input:checked) span{color:var(--todo-muted)}`;

export function buildBoardHtml(board: Board, options: ExportOptions = {}): string {
  const elements = selectedElements(board, options);
  const bounds = boardBounds(elements, 32, board.elements);
  const surfaces = nativeSurfaces(elements, board.style);
  const layers = elements
    .map((e) => {
      if (e.type === 'todo') {
        const surface = documentSurface(e, board.style);
        const items = normalizeTodoItems(e.data?.items);
        const count = items.filter((item) => item.checked).length;
        const design = `background:${surface.paper};color:${surface.ink};border-color:${surface.rule};--todo-rule:${surface.rule};--todo-muted:${surface.muted};--todo-accent:${surface.link};`;
        const rows = items
          .map(
            (item) =>
              `<li data-studio-task-id="${escapeXml(item.id)}"${todoSourceAttribute(item)}><label><input disabled type="checkbox"${item.checked ? ' checked' : ''}><span>${escapeXml(item.text)}</span></label></li>`,
          )
          .join('');

        return `<section data-studio-id="${escapeXml(e.id)}" class="studio-export-todo" aria-label="${escapeXml(e.text || '任务清单')}" style="${escapeXml(design)}position:absolute;left:${e.x - bounds.x}px;top:${e.y - bounds.y}px;width:${e.w}px;height:${e.h}px;transform:rotate(${scalar(e.rotation, 0)}deg)">
        <header><h1>${escapeXml(e.text || '任务清单')}</h1><span>${count}/${items.length} 完成</span></header><ul>${rows}</ul>
      </section>`;
      }
      if (e.type === 'document' && e.document) {
        const surface = documentSurface(e, board.style);
        return `<section data-studio-id="${escapeXml(e.id)}" class="studio-document" aria-label="${escapeXml(e.text || '文档')}" style="${escapeXml(documentSurfaceCss(surface))}position:absolute;left:${e.x - bounds.x}px;top:${e.y - bounds.y}px;width:${e.w}px;height:${e.h}px;overflow:auto;transform:rotate(${scalar(e.rotation, 0)}deg)"><h1>${escapeXml(e.text || '文档')}</h1>${blocksHtml(e.document.blocks, surface.scheme)}</section>`;
      }
      if (isHtmlRegionElement(e)) {
        return `<iframe title="${escapeXml(e.text || e.id)}" sandbox="allow-scripts" style="position:absolute;border:0;left:${e.x - bounds.x}px;top:${e.y - bounds.y}px;width:${e.w}px;height:${e.h}px;transform:rotate(${scalar(e.rotation, 0)}deg)" srcdoc="${escapeXml(offlineRegionHtml(e))}"></iframe>`;
      }

      if (e.type === 'image' && e.video) {
        if (!/^data:video\//i.test(e.video) || (e.src && !/^data:image\//i.test(e.src))) {
          throw new ExportError('ASSET_NOT_EMBEDDED', 'HTML 导出需要先嵌入视频和封面资源。');
        }

        return `<video data-studio-id="${escapeXml(e.id)}" controls playsinline preload="metadata" src="${escapeXml(e.video)}"${e.src ? ` poster="${escapeXml(e.src)}"` : ''} style="position:absolute;left:${e.x - bounds.x}px;top:${e.y - bounds.y}px;width:${e.w}px;height:${e.h}px;object-fit:contain;transform:rotate(${scalar(e.rotation, 0)}deg)"></video>`;
      }
      const box = boardBounds([e], 2, board.elements);
      const markerId = `arrow_${e.id.replace(/[^\w-]/g, '_')}`;
      return `<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;left:${box.x - bounds.x}px;top:${box.y - bounds.y}px" width="${box.width}" height="${box.height}" viewBox="${box.x} ${box.y} ${box.width} ${box.height}"><defs><marker id="${markerId}" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="${escapeXml(board.style.muted)}"/></marker></defs>${elementSvg(e, board, { ...options, markerId }, surfaces)}</svg>`;
    })
    .join('');
  const todoCss = elements.some((element) => element.type === 'todo') ? TODO_EXPORT_CSS : '';
  return `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'unsafe-inline';style-src 'unsafe-inline';img-src data: blob:;font-src data:;media-src data: blob:;frame-src 'self' data: blob:;connect-src 'none';object-src 'none';base-uri 'none';form-action 'none'"><title>${escapeXml(board.artifact.title)}</title><style>body{margin:0;background:${escapeXml(board.style.paper)};color:${escapeXml(board.style.ink)}}main{position:relative;width:${bounds.width}px;height:${bounds.height}px;margin:auto}svg,video{display:block}iframe{background:transparent}${DOCUMENT_EXPORT_CSS}${todoCss}@media print{main{margin:0}}</style></head><body><main aria-label="${escapeXml(board.artifact.title)}">${layers}</main></body></html>\n`;
}
