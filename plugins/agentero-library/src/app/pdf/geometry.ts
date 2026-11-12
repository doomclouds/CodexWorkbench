import type { PDFPageProxy } from 'pdfjs-dist';
import type { MarkColor, MarkRect, ReaderMark } from '../../contracts/reader';

export const COLORS: MarkColor[] = ['yellow', 'green', 'blue', 'pink', 'purple'];
export const COLOR_HEX: Record<MarkColor, string> = { yellow: '#fcd34d', green: '#86efac', blue: '#7dd3fc', pink: '#f9a8d4', purple: '#d8b4fe' };
export const COLOR_LABEL: Record<MarkColor, string> = { yellow: '黄色', green: '绿色', blue: '蓝色', pink: '粉色', purple: '紫色' };
export const KIND_LABEL = { highlight: '高亮', underline: '下划线', ask: '提问', translate: '翻译', visual: '区域' };
export type PageViewport = ReturnType<PDFPageProxy['getViewport']>;
export interface PageGeometry { viewport: PageViewport; view: number[]; width: number; height: number }

/** Fit is page-local: mixed orientations must not reuse the first page's width. */
export function fitPageScale(pageWidth: number, availableWidth: number): number {
  if (!Number.isFinite(pageWidth) || pageWidth <= 0 || !Number.isFinite(availableWidth) || availableWidth <= 0) return 1;
  return Math.max(.001, Math.min(3, availableWidth / pageWidth));
}

export function pageGeometry(page: PDFPageProxy, scale = 1, rotation = page.rotate): PageGeometry {
  return { viewport: page.getViewport({ scale, rotation }), view: page.view, width: page.view[2] - page.view[0], height: page.view[3] - page.view[1] };
}
export function viewportRectToPoints(rect: MarkRect, geometry: PageGeometry): MarkRect {
  const { viewport, view } = geometry;
  const points = [[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h]].map(([x, y]) => viewport.convertToPdfPoint(x, y));
  const left = Math.min(...points.map(point => point[0])); const right = Math.max(...points.map(point => point[0]));
  const bottom = Math.min(...points.map(point => point[1])); const top = Math.max(...points.map(point => point[1]));
  return { x: Math.max(0, left - view[0]), y: Math.max(0, view[3] - top), w: Math.min(geometry.width, right - left), h: Math.min(geometry.height, top - bottom) };
}
export function pointsRectToViewport(rect: MarkRect, geometry: PageGeometry, normalized = false): MarkRect {
  const r = normalized ? { x: rect.x * geometry.width, y: rect.y * geometry.height, w: rect.w * geometry.width, h: rect.h * geometry.height } : rect;
  const { viewport, view } = geometry;
  const a = viewport.convertToViewportPoint(view[0] + r.x, view[3] - r.y - r.h);
  const b = viewport.convertToViewportPoint(view[0] + r.x + r.w, view[3] - r.y);
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
}
export function screenRectToPoints(rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, pageBounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, geometry: PageGeometry): MarkRect {
  const sx = geometry.viewport.width / pageBounds.width; const sy = geometry.viewport.height / pageBounds.height;
  return viewportRectToPoints({ x: (rect.left - pageBounds.left) * sx, y: (rect.top - pageBounds.top) * sy, w: rect.width * sx, h: rect.height * sy }, geometry);
}
export function usefulRects(rects: MarkRect[]): MarkRect[] {
  let result: MarkRect[] = [];
  for (const rect of rects) {
    if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) || rect.w < .2 || rect.h < .2) continue;
    if (result.some(other => Math.abs(other.x - rect.x) < .4 && Math.abs(other.y - rect.y) < .4 && Math.abs(other.w - rect.w) < .4 && Math.abs(other.h - rect.h) < .4)) continue;
    // Preserve the exact union, rather than a bounding box across lines/columns.
    // DOM ranges can include both a parent span and its nested text rectangles.
    result = result.filter(other => !containsRect(rect, other));
    let remaining = [rect];
    for (const other of result) remaining = remaining.flatMap(piece => subtractRect(piece, other));
    result.push(...remaining);
  }
  return result;
}
function containsRect(outer: MarkRect, inner: MarkRect) { return outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.w >= inner.x + inner.w && outer.y + outer.h >= inner.y + inner.h; }
function subtractRect(rect: MarkRect, other: MarkRect): MarkRect[] {
  const left = Math.max(rect.x, other.x); const right = Math.min(rect.x + rect.w, other.x + other.w);
  const top = Math.max(rect.y, other.y); const bottom = Math.min(rect.y + rect.h, other.y + other.h);
  if (right <= left || bottom <= top) return [rect];
  return [
    { x: rect.x, y: rect.y, w: rect.w, h: top - rect.y },
    { x: rect.x, y: bottom, w: rect.w, h: rect.y + rect.h - bottom },
    { x: rect.x, y: top, w: left - rect.x, h: bottom - top },
    { x: right, y: top, w: rect.x + rect.w - right, h: bottom - top },
  ].filter(piece => piece.w > 0 && piece.h > 0);
}
export function rectEnvelope(rects: MarkRect[]): MarkRect | null {
  if (!rects.length) return null;
  const x = Math.min(...rects.map(rect => rect.x)); const y = Math.min(...rects.map(rect => rect.y));
  return { x, y, w: Math.max(...rects.map(rect => rect.x + rect.w)) - x, h: Math.max(...rects.map(rect => rect.y + rect.h)) - y };
}
export function hasMarkContent(mark: ReaderMark): boolean { return Boolean(mark.comment?.trim() || mark.question?.trim() || mark.result?.trim() || mark.note?.trim() || mark.messages?.length || mark.asset); }
export function markText(mark: ReaderMark) { return mark.result || mark.comment || mark.question || mark.note || ''; }
export function safePdfUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
