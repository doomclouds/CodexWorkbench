import {
  DEFAULT_STYLE,
  type Anchor,
  type BoardElement,
  type ElementType,
  type Operation,
  type StudioClient,
  type StyleProfile,
} from '../../contracts/studio.js';
import { newClientId } from '../shared/client-id.js';
import { DEFAULT_REGION_FILL } from '../../core/products/document-surface.js';
import { DARK_THEME, LIGHT_THEME } from '../../core/theme.js';
import { arrowGeometry, arrowLabelBox } from '../../core/products/whiteboard-geometry.js';
import { defaultDocument } from '../../contracts/document.js';

export { arrowGeometry, arrowEnd, arrowHeads } from '../../core/products/whiteboard-geometry.js';
export { safeHttpLink } from '../../core/shared/rich-text.js';

export interface Point {
  x: number;
  y: number;
}
export interface Rect extends Point {
  w: number;
  h: number;
}
export interface Viewport extends Point {
  zoom: number;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;
export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
export const newId = () => newClientId('e');

export function canvasStyle(style: StyleProfile, theme: 'light' | 'dark'): StyleProfile {
  const pristine =
    style.name === DEFAULT_STYLE.name &&
    (['paper', 'ink', 'muted', 'accent', 'link'] as const).every(
      (key) => style[key] === DEFAULT_STYLE[key],
    );

  if (!pristine) {
    return style;
  }

  return {
    ...style,
    ...(theme === 'dark' ? DARK_THEME : LIGHT_THEME),
    fontFamily: style.fontFamily,
    titleFont: style.titleFont,
    monoFont: style.monoFont,
  };
}

export function normalizedRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

export function contains(a: Rect, b: Rect): boolean {
  return b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;
}

export function boundsOf(elements: readonly Rect[]): Rect | null {
  if (!elements.length) {
    return null;
  }

  const left = Math.min(...elements.map((e) => e.x));
  const top = Math.min(...elements.map((e) => e.y));
  const right = Math.max(...elements.map((e) => e.x + Math.max(e.w, 1)));
  const bottom = Math.max(...elements.map((e) => e.y + Math.max(e.h, 1)));

  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function elementBounds(element: BoardElement, elements: readonly BoardElement[]): Rect {
  if (element.type !== 'arrow') {
    return element;
  }

  const route = arrowGeometry(element, elements);
  const path = boundsOf(route.points.map((point) => ({ ...point, w: 0, h: 0 })))!;
  const label = arrowLabelBox(element, route.label);

  return label ? boundsOf([path, label])! : path;
}

export function relativeElementPoint(element: BoardElement, point: Point): Point {
  const angle = (-(element.rotation ?? 0) * Math.PI) / 180;
  const dx = point.x - element.x - element.w / 2;
  const dy = point.y - element.y - element.h / 2;

  return {
    x: clamp((dx * Math.cos(angle) - dy * Math.sin(angle)) / Math.max(1, element.w) + 0.5, 0, 1),
    y: clamp((dx * Math.sin(angle) + dy * Math.cos(angle)) / Math.max(1, element.h) + 0.5, 0, 1),
  };
}

export function anchorBounds(anchor: Anchor, elements: readonly BoardElement[]): Rect | null {
  const target = elements.find(
    (element) => element.id === (anchor.regionId ?? anchor.elementIds?.[0]),
  );
  const positioned = Number.isFinite(anchor.x) && Number.isFinite(anchor.y);
  if (positioned && anchor.coordinateSpace === 'element') {
    if (!target) {
      return null;
    }

    const bounds = elementBounds(target, elements);
    const angle = ((target.rotation ?? 0) * Math.PI) / 180;
    const dx = (anchor.x! - 0.5) * bounds.w;
    const dy = (anchor.y! - 0.5) * bounds.h;

    return {
      x: bounds.x + bounds.w / 2 + dx * Math.cos(angle) - dy * Math.sin(angle),
      y: bounds.y + bounds.h / 2 + dx * Math.sin(angle) + dy * Math.cos(angle),
      w: (anchor.w ?? 0) * bounds.w,
      h: (anchor.h ?? 0) * bounds.h,
    };
  }

  const relativeToHtml =
    anchor.coordinateSpace === 'html' || (!anchor.coordinateSpace && anchor.regionId);

  if (positioned && relativeToHtml) {
    if (!target) {
      return null;
    }

    return { x: target.x + anchor.x!, y: target.y + anchor.y!, w: anchor.w ?? 0, h: anchor.h ?? 0 };
  }
  if (positioned) {
    return { x: anchor.x!, y: anchor.y!, w: anchor.w ?? 0, h: anchor.h ?? 0 };
  }

  const ids = [...(anchor.elementIds ?? []), ...(anchor.regionId ? [anchor.regionId] : [])];

  return boundsOf(
    elements
      .filter((element) => ids.includes(element.id))
      .map((element) => elementBounds(element, elements)),
  );
}

export function fitViewport(
  elements: readonly Rect[],
  width: number,
  height: number,
  padding = 72,
  maxZoom = 1,
): Viewport {
  const scene = elements as readonly BoardElement[];
  const bounds = boundsOf(
    elements.map((element) =>
      'type' in element && element.type === 'arrow'
        ? elementBounds(element as BoardElement, scene)
        : element,
    ),
  );

  if (!bounds) {
    return { x: width / 2 - 400, y: height / 2 - 240, zoom: 1 };
  }

  const zoom = clamp(
    Math.min(
      Math.max(1, width - padding * 2) / Math.max(1, bounds.w),
      Math.max(1, height - padding * 2) / Math.max(1, bounds.h),
      maxZoom,
    ),
    MIN_ZOOM,
    MAX_ZOOM,
  );

  return {
    x: (width - bounds.w * zoom) / 2 - bounds.x * zoom,
    y: (height - bounds.h * zoom) / 2 - bounds.y * zoom,
    zoom,
  };
}

export function zoomAt(viewport: Viewport, point: Point, zoom: number): Viewport {
  const nextZoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);

  return {
    x: point.x - ((point.x - viewport.x) / viewport.zoom) * nextZoom,
    y: point.y - ((point.y - viewport.y) / viewport.zoom) * nextZoom,
    zoom: nextZoom,
  };
}

export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  let pixels = deltaY;
  if (deltaMode === 1) {
    pixels *= 16;
  } else if (deltaMode === 2) {
    pixels *= 800;
  }

  return Math.exp(-clamp(pixels, -120, 120) * 0.0015);
}

export function expandMoveIds(
  elements: readonly BoardElement[],
  selected: readonly string[],
): string[] {
  const ids = new Set(selected);
  let changed = true;
  while (changed) {
    changed = false;
    const groups = new Set(
      elements.filter((e) => ids.has(e.id) && e.groupId).map((e) => e.groupId),
    );
    const frames = elements.filter((e) => ids.has(e.id) && e.type === 'container');
    for (const element of elements) {
      if (ids.has(element.id) || element.locked) {
        continue;
      }

      const inSelectedGroup = element.groupId && groups.has(element.groupId);
      const attachedToSelection = element.parentId && ids.has(element.parentId);
      if (
        inSelectedGroup ||
        attachedToSelection ||
        frames.some((frame) => contains(frame, element))
      ) {
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

export function makeElement(
  type: ElementType,
  point: Point,
  overrides: Partial<BoardElement> = {},
): BoardElement {
  const defaults: Partial<Record<ElementType, Partial<BoardElement>>> = {
    shape: {
      w: 208,
      h: 112,
      kind: 'rounded',
      text: '',
      fill: '#EFEFEF',
      stroke: 'transparent',
      fontSize: 16,
    },
    note: { w: 208, h: 184, text: '', fill: '#F9E56F', color: '#0B0B0B', fontSize: 15 },
    text: { w: 300, h: 70, text: '', fontSize: 16, fill: 'transparent' },
    container: {
      w: 600,
      h: 360,
      text: '分区',
      fill: DEFAULT_REGION_FILL,
      stroke: '#9ca3af',
      fontSize: 18,
    },
    stroke: { w: 1, h: 1, points: [0, 0, 1, 1], stroke: 'muted', strokeWidth: 3 },
    arrow: {
      w: 180,
      h: 1,
      from: [point.x, point.y],
      to: [point.x + 180, point.y],
      color: 'muted',
      head: 'end',
    },
    html: { w: 1440, h: 1120, text: 'HTML 图解', html: '' },
    document: {
      w: 680,
      h: 560,
      text: '文档',
      fill: DEFAULT_REGION_FILL,
      document: defaultDocument(),
    },
    todo: { w: 540, h: 420, text: '任务清单', fill: DEFAULT_REGION_FILL, data: { items: [] } },
    image: { w: 360, h: 240 },
    table: {
      w: 480,
      h: 180,
      data: {
        rows: [
          ['名称', '说明', '状态'],
          ['项目 A', '双击编辑表格', '进行中'],
          ['项目 B', '待补充', '待处理'],
        ],
      },
      fill: '#ffffff',
      color: '#2d3142',
    },
    link: { w: 320, h: 94, text: '链接', href: 'https://example.com', fill: '#ffffff' },
    sticker: { w: 64, h: 64, text: '★', color: '#eb6c36', fontSize: 48, fill: 'transparent' },
  };

  return {
    id: newId(),
    type,
    x: point.x,
    y: point.y,
    w: 208,
    h: 112,
    version: 0,
    color: 'ink',
    ...defaults[type],
    ...overrides,
  };
}

export function duplicateElements(
  elements: readonly BoardElement[],
  selected: readonly string[],
  offset: Point = { x: 32, y: 32 },
): BoardElement[] {
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
      if (!groups.has(copy.groupId)) {
        groups.set(copy.groupId, newId());
      }

      copy.groupId = groups.get(copy.groupId);
    }
    if (copy.parentId) {
      copy.parentId = remap.get(copy.parentId);
    }

    for (const end of ['from', 'to'] as const) {
      const value = copy[end];
      if (typeof value === 'string') {
        copy[end] = remap.get(value) ?? value;
      } else if (Array.isArray(value)) {
        copy[end] = [value[0] + offset.x, value[1] + offset.y];
      }
    }

    return copy;
  });
}

export function moveOperations(
  elements: readonly BoardElement[],
  ids: readonly string[],
  delta: Point,
): Operation[] {
  const selected = new Set(ids);

  return elements
    .filter((e) => selected.has(e.id) && !e.locked)
    .map((e) => {
      const changes: Partial<BoardElement> = { x: e.x + delta.x, y: e.y + delta.y };
      if (e.type === 'arrow') {
        if (e.labelOffset) {
          changes.labelOffset = { ...e.labelOffset };
        }
        if (e.labelSize) {
          changes.labelSize = { ...e.labelSize };
        }
        if (Array.isArray(e.from)) {
          changes.from = [e.from[0] + delta.x, e.from[1] + delta.y];
        }
        if (Array.isArray(e.to)) {
          changes.to = [e.to[0] + delta.x, e.to[1] + delta.y];
        }
        if (e.bends && typeof e.bends[0] === 'number') {
          changes.bends = e.bends.map(
            (value, index) => Number(value) + (index % 2 ? delta.y : delta.x),
          );
        }
      }

      return { op: 'update', id: e.id, changes };
    });
}

export function assetDisplayUrl(src: string | undefined, client: StudioClient): string | undefined {
  if (!src) {
    return undefined;
  }
  if (/^data:(?:image|video)\//i.test(src) || src.startsWith('blob:')) {
    return src;
  }

  try {
    const url = new URL(src, client.baseUrl ?? globalThis.location?.href);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return undefined;
    }

    const assetRoute =
      url.pathname.startsWith('/assets/') || url.pathname.startsWith('/api/assets/');

    if (client.baseUrl && url.origin === new URL(client.baseUrl).origin && assetRoute) {
      if (client.assetUrl) {
        return client.assetUrl(src);
      }

      if (client.token) {
        url.searchParams.set('token', client.token);
      }
    }

    return url.href;
  } catch (error) {
    if (error instanceof TypeError) {
      return undefined;
    }

    throw error;
  }
}

export function tableRows(element: BoardElement): string[][] {
  const rows = element.data?.rows;
  if (Array.isArray(rows) && rows.every(Array.isArray) && rows.length) {
    return rows.map((row) => row.map((cell: unknown) => String(cell ?? '')));
  }
  if (typeof element.text === 'string' && element.text.length) {
    return element.text
      .replace(/\r\n?/g, '\n')
      .replace(/\n$/, '')
      .split('\n')
      .map((row) => row.split('\t'));
  }

  return [['']];
}

export function placeFormatToolbar(
  anchor: Rect,
  size: { w: number; h: number },
  viewport: { w: number; h: number },
  obstacles: readonly Rect[] = [],
): (Point & { w: number }) | undefined {
  const margin = 12;
  const gap = 8;
  const right = viewport.w - margin;
  const bottom = viewport.h - margin - size.h;
  const width = Math.min(size.w, right - margin);
  if (width <= 0 || bottom < margin) {
    return;
  }

  const center = anchor.x + anchor.w / 2;
  const above = anchor.y - gap - size.h;
  const below = anchor.y + anchor.h + gap;
  const fallbackRows = [
    margin,
    bottom,
    ...obstacles.flatMap((rect) => [rect.y - gap - size.h, rect.y + rect.h + gap]),
  ];
  fallbackRows.sort((a, b) => Math.abs(a - above) - Math.abs(b - above));
  const rows = [...new Set([above, below, clamp(above, margin, bottom), ...fallbackRows])].filter(
    (y) => y >= margin && y <= bottom,
  );
  let compact: (Point & { w: number }) | undefined;
  for (const y of rows) {
    const blocks = obstacles
      .filter((rect) => y + size.h + gap > rect.y && y < rect.y + rect.h + gap)
      .sort((a, b) => a.x - b.x);
    const free: Array<{ left: number; right: number }> = [];
    let left = margin;
    for (const block of blocks) {
      const end = Math.min(right, block.x - gap);
      if (end > left) {
        free.push({ left, right: end });
      }

      left = Math.max(left, block.x + block.w + gap);
    }

    if (left < right) {
      free.push({ left, right });
    }

    const candidates = free
      .map((slot) => {
        const w = Math.min(width, slot.right - slot.left);

        return { x: clamp(center, slot.left + w / 2, slot.right - w / 2), y, w };
      })
      .sort((a, b) => Math.abs(a.x - center) - Math.abs(b.x - center));
    const full = candidates.find((candidate) => candidate.w === width);
    if (full) {
      return full;
    }

    compact ??= candidates.find((candidate) => candidate.w >= Math.min(144, width));
  }

  return compact;
}
