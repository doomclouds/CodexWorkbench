import type { CanvasGeometry, CanvasPoint, CanvasRect, CanvasViewport } from '../contracts.js';

export type CanvasViewportSize = Pick<CanvasRect, 'width' | 'height'>;

const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;
const MAX_PADDED_FIT_ZOOM = 1;
const DEGREES_PER_TURN = 360;
const RADIANS_PER_DEGREE = Math.PI / 180;
const FLAT_ROTATION = { cos: 1, sin: 0 };

export const defaultViewport: CanvasViewport = Object.freeze({ x: 0, y: 0, zoom: 1 });

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function isFinitePoint(point: CanvasPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function isValidExtent(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function isValidRect(rect: CanvasRect): boolean {
  return isFinitePoint(rect) && isValidExtent(rect.width) && isValidExtent(rect.height);
}

function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

export function normalizeViewport(view: CanvasViewport = defaultViewport): CanvasViewport {
  const x = finiteOrZero(view.x);
  const y = finiteOrZero(view.y);
  const zoom =
    Number.isFinite(view.zoom) && view.zoom > 0 ? clampZoom(view.zoom) : defaultViewport.zoom;

  return x === view.x && y === view.y && zoom === view.zoom ? view : { x, y, zoom };
}

export function screenToBoard(point: CanvasPoint, view: CanvasViewport): CanvasPoint {
  const { x, y, zoom } = normalizeViewport(view);

  return { x: (finiteOrZero(point.x) - x) / zoom, y: (finiteOrZero(point.y) - y) / zoom };
}

export function boardToScreen(point: CanvasPoint, view: CanvasViewport): CanvasPoint {
  const { x, y, zoom } = normalizeViewport(view);

  return { x: finiteOrZero(point.x) * zoom + x, y: finiteOrZero(point.y) * zoom + y };
}

export function getViewportBounds(
  view: CanvasViewport,
  size: CanvasViewportSize,
  overscanPx = 0,
): CanvasRect {
  const { x, y, zoom } = normalizeViewport(view);
  const overscan = Math.max(0, finiteOrZero(overscanPx));
  const width = Math.max(0, finiteOrZero(size.width));
  const height = Math.max(0, finiteOrZero(size.height));

  return {
    x: (0 - (x + overscan)) / zoom,
    y: (0 - (y + overscan)) / zoom,
    width: (width + overscan * 2) / zoom,
    height: (height + overscan * 2) / zoom,
  };
}

export function panViewport(view: CanvasViewport, delta: CanvasPoint): CanvasViewport {
  const { x, y, zoom } = normalizeViewport(view);

  return { x: x + finiteOrZero(delta.x), y: y + finiteOrZero(delta.y), zoom };
}

export function zoomViewport(
  view: CanvasViewport,
  anchorScreen: CanvasPoint,
  factor: number,
): CanvasViewport {
  const current = normalizeViewport(view);
  if (!Number.isFinite(factor) || factor <= 0 || !isFinitePoint(anchorScreen)) {
    return current;
  }

  const zoom = clampZoom(current.zoom * factor);
  if (zoom === current.zoom) {
    return current;
  }

  const ratio = zoom / current.zoom;

  return {
    x: anchorScreen.x - (anchorScreen.x - current.x) * ratio,
    y: anchorScreen.y - (anchorScreen.y - current.y) * ratio,
    zoom,
  };
}

export function fitViewport(
  rect: CanvasRect | undefined,
  size: CanvasViewportSize,
  padding?: number,
  maxZoom = padding === undefined ? MAX_ZOOM : MAX_PADDED_FIT_ZOOM,
): CanvasViewport {
  if (!rect || !isValidRect(rect)) {
    return defaultViewport;
  }

  const { width, height } = size;
  const hasViewport = width > 0 && height > 0;
  if (!hasViewport || !isValidExtent(width) || !isValidExtent(height)) {
    return defaultViewport;
  }

  const inset = 2 * Math.max(0, finiteOrZero(padding ?? 0));
  const availableWidth = padding === undefined ? width : Math.max(1, width - inset);
  const availableHeight = padding === undefined ? height : Math.max(1, height - inset);
  const widthZoom = rect.width > 0 ? availableWidth / rect.width : Infinity;
  const heightZoom = rect.height > 0 ? availableHeight / rect.height : Infinity;
  const zoom = clampZoom(Math.min(widthZoom, heightZoom, maxZoom));

  return {
    x: (width - rect.width * zoom) / 2 - rect.x * zoom,
    y: (height - rect.height * zoom) / 2 - rect.y * zoom,
    zoom,
  };
}

function geometryRotation(rotation: number) {
  const angle = (finiteOrZero(rotation) % DEGREES_PER_TURN) * RADIANS_PER_DEGREE;

  return angle === 0 ? FLAT_ROTATION : { cos: Math.cos(angle), sin: Math.sin(angle) };
}

export function getObjectBounds(geometry: CanvasGeometry): CanvasRect {
  const { x, y, width, height, rotation } = geometry;
  if (!isValidRect(geometry)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const { cos, sin } = geometryRotation(rotation);
  const boundsWidth = width * Math.abs(cos) + height * Math.abs(sin);
  const boundsHeight = width * Math.abs(sin) + height * Math.abs(cos);

  return {
    x: x + (width - boundsWidth) / 2,
    y: y + (height - boundsHeight) / 2,
    width: boundsWidth,
    height: boundsHeight,
  };
}

export function containsPoint(point: CanvasPoint, geometry: CanvasGeometry): boolean {
  if (!isFinitePoint(point) || !isValidRect(geometry)) {
    return false;
  }

  const halfWidth = geometry.width / 2;
  const halfHeight = geometry.height / 2;
  const dx = point.x - geometry.x - halfWidth;
  const dy = point.y - geometry.y - halfHeight;
  const { cos, sin } = geometryRotation(geometry.rotation);
  const localX = dx * cos + dy * sin;
  const localY = -dx * sin + dy * cos;
  const tolerance = Number.EPSILON * Math.max(halfWidth, halfHeight);

  return Math.abs(localX) <= halfWidth + tolerance && Math.abs(localY) <= halfHeight + tolerance;
}

export function rectsIntersect(a: CanvasRect, b: CanvasRect): boolean {
  if (!isValidRect(a) || !isValidRect(b)) {
    return false;
  }

  const overlapsX = a.x <= b.x + b.width && a.x + a.width >= b.x;

  return overlapsX && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

export function mergeRects(rects: readonly CanvasRect[]): CanvasRect | undefined {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const rect of rects) {
    if (!isValidRect(rect)) {
      continue;
    }

    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }

  if (left === Infinity) {
    return undefined;
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
}
