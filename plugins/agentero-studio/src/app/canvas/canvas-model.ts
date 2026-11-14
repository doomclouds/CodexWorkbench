import { DEFAULT_STYLE, type BoardElement, type ElementType, type Operation, type StudioClient, type StyleProfile } from '../../contracts/studio.js';
import { DARK_THEME, LIGHT_THEME } from '../../core/theme.js';
export { arrowGeometry, arrowEnd, arrowHeads } from '../../core/products/whiteboard-geometry.js';
export { safeHttpLink } from '../../core/shared/rich-text.js';

export interface Point { x: number; y: number }
export interface Rect extends Point { w: number; h: number }
export interface Viewport extends Point { zoom: number }

export const MIN_ZOOM = 0.12;
export const MAX_ZOOM = 3;
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const newId = () => `e-${crypto.randomUUID()}`;

/** Host theme projects the uncustomized palette; it never rewrites the shared board or an HTML region. */
export function canvasStyle(style: StyleProfile, theme: 'light' | 'dark'): StyleProfile {
  const pristine = style.name === DEFAULT_STYLE.name && (['paper', 'ink', 'muted', 'accent', 'link'] as const).every((key) => style[key] === DEFAULT_STYLE[key]);
  if (!pristine) return style;
  return { ...style, ...(theme === 'dark' ? DARK_THEME : LIGHT_THEME), fontFamily: style.fontFamily, titleFont: style.titleFont, monoFont: style.monoFont };
}

export function normalizedRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

export function contains(a: Rect, b: Rect): boolean {
  return b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;
}

export function boundsOf(elements: readonly Rect[]): Rect | null {
  if (!elements.length) return null;
  const left = Math.min(...elements.map((e) => e.x));
  const top = Math.min(...elements.map((e) => e.y));
  const right = Math.max(...elements.map((e) => e.x + Math.max(e.w, 1)));
  const bottom = Math.max(...elements.map((e) => e.y + Math.max(e.h, 1)));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function fitViewport(elements: readonly Rect[], width: number, height: number, padding = 72): Viewport {
  const bounds = boundsOf(elements);
  if (!bounds) return { x: width / 2 - 400, y: height / 2 - 240, zoom: 1 };
  const zoom = clamp(Math.min(Math.max(1, width - padding * 2) / Math.max(1, bounds.w), Math.max(1, height - padding * 2) / Math.max(1, bounds.h), 1), MIN_ZOOM, MAX_ZOOM);
  return { x: (width - bounds.w * zoom) / 2 - bounds.x * zoom, y: (height - bounds.h * zoom) / 2 - bounds.y * zoom, zoom };
}

export function zoomAt(viewport: Viewport, point: Point, zoom: number): Viewport {
  const nextZoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  return { x: point.x - (point.x - viewport.x) / viewport.zoom * nextZoom, y: point.y - (point.y - viewport.y) / viewport.zoom * nextZoom, zoom: nextZoom };
}

/** Groups and containers move together; attached arrows derive their endpoints at render time. */
export function expandMoveIds(elements: readonly BoardElement[], selected: readonly string[]): string[] {
  const ids = new Set(selected);
  let changed = true;
  while (changed) {
    changed = false;
    const groups = new Set(elements.filter((e) => ids.has(e.id) && e.groupId).map((e) => e.groupId));
    const frames = elements.filter((e) => ids.has(e.id) && e.type === 'container');
    for (const element of elements) {
      if (ids.has(element.id) || element.locked) continue;
      if ((element.groupId && groups.has(element.groupId)) || (element.parentId && ids.has(element.parentId)) || frames.some((frame) => contains(frame, element))) {
        ids.add(element.id);
        changed = true;
      }
    }
  }
  return [...ids];
}

export function editableFields(element: BoardElement): Partial<BoardElement> {
  const { id: _id, version: _version, ...fields } = element;
  return fields;
}

export function makeElement(type: ElementType, point: Point, overrides: Partial<BoardElement> = {}): BoardElement {
  const defaults: Partial<Record<ElementType, Partial<BoardElement>>> = {
    shape: { w: 208, h: 112, kind: 'rounded', text: '新建节点', fill: '#ffffff', stroke: 'muted', fontSize: 17 },
    note: { w: 208, h: 184, text: '写下你的想法', fill: '#fff0b5', color: '#4b422a', fontSize: 18 },
    text: { w: 300, h: 70, text: '双击编辑文字', fontSize: 24, fill: 'transparent' },
    container: { w: 600, h: 360, text: '分区', fill: 'transparent', stroke: '#9ca3af', fontSize: 18 },
    stroke: { w: 1, h: 1, points: [0, 0, 1, 1], stroke: 'muted', strokeWidth: 3 },
    arrow: { w: 180, h: 1, from: [point.x, point.y], to: [point.x + 180, point.y], color: 'muted', head: 'end' },
    html: { w: 1000, h: 680, text: 'HTML 图解', html: '' },
    image: { w: 360, h: 240 },
    table: { w: 480, h: 180, data: { rows: [['名称', '说明', '状态'], ['项目 A', '双击编辑表格', '进行中'], ['项目 B', '待补充', '待处理']] }, fill: '#ffffff', color: '#2d3142' },
    link: { w: 320, h: 94, text: '链接', href: 'https://example.com', fill: '#ffffff' },
    sticker: { w: 64, h: 64, text: '★', color: '#eb6c36', fontSize: 48, fill: 'transparent' },
  };
  return { id: newId(), type, x: point.x, y: point.y, w: 208, h: 112, version: 0, color: 'ink', ...defaults[type], ...overrides };
}

export function duplicateElements(elements: readonly BoardElement[], selected: readonly string[], offset: Point = { x: 32, y: 32 }): BoardElement[] {
  const ids = new Set(expandMoveIds(elements, selected));
  const source = elements.filter((e) => ids.has(e.id));
  const remap = new Map(source.map((e) => [e.id, newId()]));
  const groups = new Map<string, string>();
  return source.map((element) => {
    const copy: BoardElement = structuredClone(element);
    copy.id = remap.get(element.id)!;
    copy.version = 0;
    copy.x += offset.x;
    copy.y += offset.y;
    if (copy.groupId) {
      if (!groups.has(copy.groupId)) groups.set(copy.groupId, newId());
      copy.groupId = groups.get(copy.groupId);
    }
    if (copy.parentId) copy.parentId = remap.get(copy.parentId);
    for (const end of ['from', 'to'] as const) {
      const value = copy[end];
      if (typeof value === 'string') copy[end] = remap.get(value) ?? value;
      else if (Array.isArray(value)) copy[end] = [value[0] + offset.x, value[1] + offset.y];
    }
    return copy;
  });
}

export function moveOperations(elements: readonly BoardElement[], ids: readonly string[], delta: Point): Operation[] {
  const selected = new Set(ids);
  return elements.filter((e) => selected.has(e.id) && !e.locked).map((e) => {
    const changes: Partial<BoardElement> = { x: e.x + delta.x, y: e.y + delta.y };
    if (e.type === 'arrow') {
      if (Array.isArray(e.from)) changes.from = [e.from[0] + delta.x, e.from[1] + delta.y];
      if (Array.isArray(e.to)) changes.to = [e.to[0] + delta.x, e.to[1] + delta.y];
      if (e.bends && typeof e.bends[0] === 'number') changes.bends = e.bends.map((value, index) => Number(value) + (index % 2 ? delta.y : delta.x));
    }
    return { op: 'update', id: e.id, changes };
  });
}

export function assetDisplayUrl(src: string | undefined, client: StudioClient): string | undefined {
  if (!src) return undefined;
  if (/^data:(?:image|video)\//i.test(src) || src.startsWith('blob:')) return src;
  try {
    const url = new URL(src, client.baseUrl ?? globalThis.location?.href);
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    if (client.baseUrl && url.origin === new URL(client.baseUrl).origin && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/api/assets/')) && client.token) url.searchParams.set('token', client.token);
    return url.href;
  } catch { return undefined; }
}

export function tableRows(element: BoardElement): string[][] {
  const rows = element.data?.rows;
  return Array.isArray(rows) && rows.every(Array.isArray) ? rows.map((row) => row.map((cell: unknown) => String(cell ?? ''))) : [['名称', '说明'], ['项目', '双击编辑']];
}
