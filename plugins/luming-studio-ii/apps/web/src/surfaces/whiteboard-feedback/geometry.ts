import type {
  FeedbackAnchor,
  FeedbackObjectTarget,
  FeedbackPoint,
  FeedbackTarget,
} from '../../data/feedback/index.js';
import type { FeedbackCanvasObject, FeedbackViewport } from './contracts.js';

type ObjectIndex = ReadonlyMap<string, FeedbackCanvasObject>;

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

export function selectionTarget(
  selectedIds: readonly string[],
  objects: ObjectIndex,
): FeedbackObjectTarget | undefined {
  const [objectId] = selectedIds;
  if (!objectId || selectedIds.length !== 1) {
    return undefined;
  }

  const object = objects.get(objectId);
  if (validObject(object)) {
    return {
      kind: 'object',
      objectId: object.id,
      u: centerFraction,
      v: centerFraction,
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

    const { x, y, width, height, rotation } = object.geometry;
    const local = rotate(
      { x: point.x - x - width * centerFraction, y: point.y - y - height * centerFraction },
      -rotation,
    );
    const u = local.x / width + centerFraction;
    const v = local.y / height + centerFraction;
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
    return anchor.targetMissing ? frozenPoint : (contentPoint ?? frozenPoint);
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
