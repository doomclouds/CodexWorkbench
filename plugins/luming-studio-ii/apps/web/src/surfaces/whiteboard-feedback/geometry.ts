import type {
  FeedbackAnchor,
  FeedbackObjectTarget,
  FeedbackPoint,
  FeedbackTarget,
} from '../../data/feedback/index.js';
import type { FeedbackCanvasObject, FeedbackViewport } from './contracts.js';

type ObjectIndex = ReadonlyMap<string, FeedbackCanvasObject>;
type ViewportSize = Readonly<{ width: number; height: number }>;

const degreesPerRadian = 180 / Math.PI;
const centerFraction = 0.5;

function rotate({ x, y }: FeedbackPoint, rotation: number): FeedbackPoint {
  const radians = rotation / degreesPerRadian;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

function objectPoint(
  { x, y, width, height, rotation }: FeedbackCanvasObject['geometry'],
  u: number,
  v: number,
): FeedbackPoint {
  const local = rotate(
    { x: (u - centerFraction) * width, y: (v - centerFraction) * height },
    rotation,
  );

  return { x: x + width * centerFraction + local.x, y: y + height * centerFraction + local.y };
}

function validObject(object: FeedbackCanvasObject | undefined): object is FeedbackCanvasObject {
  return Boolean(object && object.geometry.width > 0 && object.geometry.height > 0);
}

function objectFractions(
  { x, y, width, height, rotation }: FeedbackCanvasObject['geometry'],
  point: FeedbackPoint,
) {
  const local = rotate(
    { x: point.x - x - width * centerFraction, y: point.y - y - height * centerFraction },
    -rotation,
  );

  return { u: local.x / width + centerFraction, v: local.y / height + centerFraction };
}

function visibleTopRight(
  geometry: FeedbackCanvasObject['geometry'],
  viewport: FeedbackViewport,
  size?: ViewportSize,
) {
  const corners = [
    objectPoint(geometry, 0, 0),
    objectPoint(geometry, 1, 0),
    objectPoint(geometry, 1, 1),
    objectPoint(geometry, 0, 1),
  ].map((point) => screenPoint(point, viewport));
  const x = corners.map(({ left }) => left);
  const y = corners.map(({ top }) => top);
  const bounds = {
    left: Math.min(...x),
    top: Math.min(...y),
    right: Math.max(...x),
    bottom: Math.max(...y),
  };
  const clipped = {
    left: Math.max(bounds.left, 0),
    top: Math.max(bounds.top, 0),
    right: Math.min(bounds.right, size?.width ?? bounds.right),
    bottom: Math.min(bounds.bottom, size?.height ?? bounds.bottom),
  };
  const visible = clipped.right > clipped.left && clipped.bottom > clipped.top ? clipped : bounds;
  const inset = Math.min(
    16,
    (visible.right - visible.left) / 4,
    (visible.bottom - visible.top) / 4,
  );

  return worldPoint({ x: visible.right - inset, y: visible.top + inset }, viewport);
}

export function selectionTarget(
  objectId: string,
  objects: ObjectIndex,
  viewport: FeedbackViewport,
  size?: ViewportSize,
): FeedbackObjectTarget | undefined {
  const object = objects.get(objectId);
  if (validObject(object)) {
    const corner = visibleTopRight(object.geometry, viewport, size);
    const { u, v } = objectFractions(object.geometry, corner);

    return {
      kind: 'object',
      objectId: object.id,
      u: Math.max(0, Math.min(1, u)),
      v: Math.max(0, Math.min(1, v)),
      geometryVersion: object.geometryVersion,
    };
  }
}

export function targetAt(
  point: FeedbackPoint,
  objects: readonly FeedbackCanvasObject[],
): FeedbackTarget {
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const object = objects[index];
    if (!validObject(object)) {
      continue;
    }

    const { u, v } = objectFractions(object.geometry, point);
    const horizontal = u >= 0 && u <= 1;
    const vertical = v >= 0 && v <= 1;
    if (horizontal && vertical) {
      return { kind: 'object', objectId: object.id, u, v, geometryVersion: object.geometryVersion };
    }
  }

  return { kind: 'board', point };
}

export function locateAnchor(
  anchor: FeedbackAnchor,
  objects: ObjectIndex,
  contentPoint?: FeedbackPoint,
): FeedbackPoint {
  const { target, frozenPoint } = anchor;
  if (target.kind === 'content') {
    return !anchor.targetMissing && validObject(objects.get(target.objectId))
      ? (contentPoint ?? frozenPoint)
      : frozenPoint;
  }

  if (target.kind === 'object') {
    const object = objects.get(target.objectId);
    return validObject(object) ? objectPoint(object.geometry, target.u, target.v) : frozenPoint;
  }

  return target.point;
}

export function locateDraft(
  target: FeedbackTarget,
  objects: ObjectIndex,
): FeedbackPoint | undefined {
  if (target.kind === 'board') {
    return target.point;
  }

  const object = objects.get(target.objectId);
  return validObject(object) ? objectPoint(object.geometry, target.u, target.v) : undefined;
}

export function screenPoint(point: FeedbackPoint, viewport: FeedbackViewport) {
  return {
    left: point.x * viewport.zoom + viewport.x,
    top: point.y * (viewport.zoomY ?? viewport.zoom) + viewport.y,
  };
}

export function worldPoint(point: FeedbackPoint, viewport: FeedbackViewport): FeedbackPoint {
  return {
    x: (point.x - viewport.x) / viewport.zoom,
    y: (point.y - viewport.y) / (viewport.zoomY ?? viewport.zoom),
  };
}
