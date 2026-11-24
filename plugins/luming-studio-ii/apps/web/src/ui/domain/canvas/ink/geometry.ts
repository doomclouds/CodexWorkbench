import type {
  CanvasGeometry,
  CanvasInk,
  CanvasObjectDraft,
  CanvasPoint,
  CanvasRect,
} from '../contracts.js';
import { getObjectBounds, normalizeViewport } from '../viewport/index.js';

interface InkSegment {
  readonly start: CanvasPoint;
  readonly end: CanvasPoint;
  readonly control?: CanvasPoint;
}

const defaultWidth = 3;
const minimumWidth = 0.1;
const maximumWidth = 100;
const sampleSpacing = 2;
export const maxInkSamples = 20_000;
const overviewZoom = 0.5;
const minimumOverviewPixels = 0.7;
const minimumZoom = normalizeViewport({ x: 0, y: 0, zoom: Number.MIN_VALUE }).zoom;
const straightAngle = Math.PI / 4;
const radiansPerDegree = Math.PI / 180;
const hitMargin = 4;
const maximumSubdivisions = 8;
const normalizedBoundsCache = new WeakMap<readonly CanvasPoint[], CanvasRect>();

function validPoint({ x, y }: CanvasPoint) {
  return Number.isFinite(x) && Number.isFinite(y);
}

function validWidth(width: number) {
  return Number.isFinite(width) && width > 0 ? width : defaultWidth;
}

export function appendInkSample(
  samples: CanvasPoint[],
  point: CanvasPoint,
  zoom: number,
  final = false,
): boolean {
  if (!validPoint(point) || samples.length >= maxInkSamples) {
    return false;
  }

  const previous = samples.at(-1);
  if (previous) {
    const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
    const belowSpacing = distance * zoom < sampleSpacing;
    if (distance === 0 || (!final && belowSpacing)) {
      return false;
    }
  }
  samples.push(point);

  return true;
}

export function snapInkPoint(anchor: CanvasPoint, point: CanvasPoint): CanvasPoint {
  const x = point.x - anchor.x;
  const y = point.y - anchor.y;
  const angle = Math.round(Math.atan2(y, x) / straightAngle) * straightAngle;
  const distance = Math.hypot(x, y);

  return { x: anchor.x + Math.cos(angle) * distance, y: anchor.y + Math.sin(angle) * distance };
}

function pointBounds(samples: readonly CanvasPoint[]): CanvasRect | undefined {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const point of samples) {
    if (!validPoint(point)) {
      return;
    }

    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }

  const width = right - left;
  const height = bottom - top;
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return;
  }

  return { x: left, y: top, width, height };
}

function addStrokeWidth({ x, y, width, height }: CanvasRect, strokeWidth: number): CanvasRect {
  return {
    x: x - strokeWidth / 2,
    y: y - strokeWidth / 2,
    width: width + strokeWidth,
    height: height + strokeWidth,
  };
}

export function makeInkDraft(
  samples: readonly CanvasPoint[],
  width: number,
  label: string,
): Extract<CanvasObjectDraft, { kind: 'ink' }> | undefined {
  const strokeWidth = validWidth(width);
  const bounds = pointBounds(samples);
  if (!bounds) {
    return;
  }

  const geometry = { ...addStrokeWidth(bounds, strokeWidth), rotation: 0 };
  const points = samples.map((point) => ({
    x: (point.x - geometry.x) / geometry.width,
    y: (point.y - geometry.y) / geometry.height,
  }));

  return { kind: 'ink', label, geometry, ink: { points, width: strokeWidth } };
}

function axisScale(before: number, after: number) {
  return before > 0 && Number.isFinite(after) ? Math.abs(after / before) : 1;
}

export function scaleInk(ink: CanvasInk, before: CanvasGeometry, after: CanvasGeometry): CanvasInk {
  if (before.width === after.width && before.height === after.height) {
    return ink;
  }

  const scale = (axisScale(before.width, after.width) + axisScale(before.height, after.height)) / 2;
  const width = Math.min(maximumWidth, Math.max(minimumWidth, validWidth(ink.width) * scale));

  return width === ink.width ? ink : { points: ink.points, width };
}

export function renderedInkWidth(ink: CanvasInk, zoom: number): number {
  const width = validWidth(ink.width);

  return zoom < overviewZoom ? Math.max(width, minimumOverviewPixels / zoom) : width;
}

function normalizedBounds(points: readonly CanvasPoint[]) {
  const cached = normalizedBoundsCache.get(points);
  if (cached) {
    return cached;
  }

  const measured = pointBounds(points);
  if (measured) {
    normalizedBoundsCache.set(points, measured);
  }

  return measured;
}

function placeInkBounds(normalized: CanvasRect, geometry: CanvasGeometry): CanvasGeometry {
  const { rotation } = geometry;
  const width = normalized.width * geometry.width;
  const height = normalized.height * geometry.height;
  const offsetX = (normalized.x + normalized.width / 2 - 0.5) * geometry.width;
  const offsetY = (normalized.y + normalized.height / 2 - 0.5) * geometry.height;
  const cos = Math.cos(rotation * radiansPerDegree);
  const sin = Math.sin(rotation * radiansPerDegree);
  const centerX = geometry.x + geometry.width / 2 + offsetX * cos - offsetY * sin;
  const centerY = geometry.y + geometry.height / 2 + offsetX * sin + offsetY * cos;

  return { x: centerX - width / 2, y: centerY - height / 2, width, height, rotation };
}

export function inkBounds(
  ink: CanvasInk,
  geometry: CanvasGeometry,
  zoom = minimumZoom,
): CanvasRect {
  const content = normalizedBounds(ink.points);
  const bounds = getObjectBounds(content ? placeInkBounds(content, geometry) : geometry);

  return addStrokeWidth(bounds, renderedInkWidth(ink, zoom));
}

function localPoint(point: CanvasPoint, width: number, height: number): CanvasPoint {
  return { x: point.x * width, y: point.y * height };
}

function midpoint(start: CanvasPoint, end: CanvasPoint): CanvasPoint {
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
}

function* inkSegments(ink: CanvasInk, width: number, height: number): Iterable<InkSegment> {
  const first = ink.points[0];
  const last = ink.points.at(-1);
  if (!first || !last) {
    return;
  }

  let start = localPoint(first, width, height);
  for (let index = 1; index < ink.points.length - 1; index += 1) {
    const at = ink.points[index];
    const next = ink.points[index + 1];
    if (!at || !next) {
      continue;
    }

    const control = localPoint(at, width, height);
    const end = midpoint(control, localPoint(next, width, height));
    yield { start, control, end };
    start = end;
  }

  yield { start, end: localPoint(last, width, height) };
}

export function inkPathData(ink: CanvasInk, width: number, height: number): string {
  const first = ink.points[0];
  if (!first) {
    return '';
  }

  const start = localPoint(first, width, height);
  let path = `M ${start.x} ${start.y}`;
  for (const { control, end } of inkSegments(ink, width, height)) {
    path += control ? ` Q ${control.x} ${control.y} ${end.x} ${end.y}` : ` L ${end.x} ${end.y}`;
  }

  return path;
}

function unrotatePoint(point: CanvasPoint, { x, y, width, height, rotation }: CanvasGeometry) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const dx = point.x - x - halfWidth;
  const dy = point.y - y - halfHeight;
  const angle = rotation * radiansPerDegree;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return { x: halfWidth + dx * cos + dy * sin, y: halfHeight - dx * sin + dy * cos };
}

function segmentDistanceSquared(point: CanvasPoint, start: CanvasPoint, end: CanvasPoint) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const along = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  const ratio = lengthSquared > 0 ? Math.max(0, Math.min(1, along)) : 0;

  return (point.x - start.x - dx * ratio) ** 2 + (point.y - start.y - dy * ratio) ** 2;
}

function curveIsNear(point: CanvasPoint, segment: Required<InkSegment>, radius: number) {
  const { start, control, end } = segment;
  const nearX =
    point.x >= Math.min(start.x, control.x, end.x) - radius &&
    point.x <= Math.max(start.x, control.x, end.x) + radius;
  const nearY =
    point.y >= Math.min(start.y, control.y, end.y) - radius &&
    point.y <= Math.max(start.y, control.y, end.y) + radius;

  return nearX && nearY;
}

function hitSegment(point: CanvasPoint, segment: InkSegment, radius: number, depth = 0): boolean {
  const { start, control, end } = segment;
  const radiusSquared = radius * radius;
  const flatnessSquared = radiusSquared / 256;
  if (!control || depth >= maximumSubdivisions) {
    return segmentDistanceSquared(point, start, end) <= radiusSquared;
  }
  if (!curveIsNear(point, { start, control, end }, radius)) {
    return false;
  }
  if (segmentDistanceSquared(control, start, end) <= flatnessSquared) {
    return segmentDistanceSquared(point, start, end) <= radiusSquared;
  }

  const from = midpoint(start, control);
  const to = midpoint(control, end);
  const middle = midpoint(from, to);

  return (
    hitSegment(point, { start, control: from, end: middle }, radius, depth + 1) ||
    hitSegment(point, { start: middle, control: to, end }, radius, depth + 1)
  );
}

export function hitInk(ink: CanvasInk, geometry: CanvasGeometry, point: CanvasPoint, zoom = 1) {
  const cursor = unrotatePoint(point, geometry);
  const validZoom = normalizeViewport({ x: 0, y: 0, zoom }).zoom;
  const radius = renderedInkWidth(ink, validZoom) / 2 + hitMargin / validZoom;

  for (const segment of inkSegments(ink, geometry.width, geometry.height)) {
    if (hitSegment(cursor, segment, radius)) {
      return true;
    }
  }

  return false;
}
