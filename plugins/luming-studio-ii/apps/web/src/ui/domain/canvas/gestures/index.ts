import type {
  CanvasEditIntent,
  CanvasGeometry,
  CanvasMoveIntent,
  CanvasObjectChange,
  CanvasPoint,
} from '../contracts.js';

export type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se';

export interface TransformGesture {
  readonly kind: 'move' | 'resize' | 'rotate';
  readonly interactionId: string;
  readonly start: CanvasPoint;
  readonly targets: readonly CanvasObjectChange[];
  readonly handle?: ResizeHandle;
}

const minimumResizeSize = 24;
const degreesPerRadian = 180 / Math.PI;
const handleDirections: Record<ResizeHandle, CanvasPoint> = {
  nw: { x: -1, y: -1 },
  ne: { x: 1, y: -1 },
  sw: { x: -1, y: 1 },
  se: { x: 1, y: 1 },
};

function subtract(point: CanvasPoint, origin: CanvasPoint): CanvasPoint {
  return { x: point.x - origin.x, y: point.y - origin.y };
}

function isFinitePoint(point: CanvasPoint) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function hasOffset(point: CanvasPoint) {
  return point.x !== 0 || point.y !== 0;
}

function isValidGeometry(geometry: CanvasGeometry) {
  const values = [geometry.x, geometry.y, geometry.width, geometry.height, geometry.rotation];

  return values.every(Number.isFinite) && geometry.width > 0 && geometry.height > 0;
}

function normalizeDegrees(angle: number) {
  return (((angle % 360) + 540) % 360) - 180;
}

function turn(point: CanvasPoint, angle: number): CanvasPoint {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);

  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine,
  };
}

function move(gesture: TransformGesture, delta: CanvasPoint): CanvasMoveIntent | undefined {
  const changes: CanvasObjectChange[] = [];
  let moved = false;
  for (const target of gesture.targets) {
    const old = target.geometry;
    const geometry = { ...old, x: old.x + delta.x, y: old.y + delta.y };
    if (!isValidGeometry(geometry)) {
      return undefined;
    }

    if (geometry.x !== old.x || geometry.y !== old.y) {
      moved = true;
    }
    changes.push({ ...target, geometry });
  }

  if (!moved) {
    return undefined;
  }

  return { kind: 'move', interactionId: gesture.interactionId, delta, changes };
}

function resize(
  geometry: CanvasGeometry,
  delta: CanvasPoint,
  handle: ResizeHandle | undefined,
): CanvasGeometry | undefined {
  const direction = handle && handleDirections[handle];
  if (!direction) {
    return undefined;
  }

  const angle = normalizeDegrees(geometry.rotation) / degreesPerRadian;
  const local = turn(delta, -angle);
  const minWidth = Math.min(geometry.width, minimumResizeSize);
  const minHeight = Math.min(geometry.height, minimumResizeSize);
  const width = Math.max(minWidth, geometry.width + local.x * direction.x);
  const height = Math.max(minHeight, geometry.height + local.y * direction.y);
  const change = { x: (width - geometry.width) / 2, y: (height - geometry.height) / 2 };
  if (!hasOffset(change)) {
    return undefined;
  }

  const shift = turn({ x: change.x * direction.x, y: change.y * direction.y }, angle);

  return {
    x: geometry.x + (shift.x - change.x),
    y: geometry.y + (shift.y - change.y),
    width,
    height,
    rotation: geometry.rotation,
  };
}

function bearing(point: CanvasPoint, center: CanvasPoint): number | undefined {
  const offset = subtract(point, center);
  if (!isFinitePoint(offset) || !hasOffset(offset)) {
    return undefined;
  }

  return Math.atan2(offset.y, offset.x) * degreesPerRadian;
}

function rotate(geometry: CanvasGeometry, start: CanvasPoint, point: CanvasPoint) {
  const center = { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 };
  const from = bearing(start, center);
  const to = bearing(point, center);
  if (from === undefined || to === undefined) {
    return undefined;
  }

  const original = normalizeDegrees(geometry.rotation);
  const rotation = normalizeDegrees(original + normalizeDegrees(to - from));

  return rotation === original ? undefined : { ...geometry, rotation };
}

export function previewTransform(
  gesture: TransformGesture,
  point: CanvasPoint,
): CanvasEditIntent | undefined {
  const delta = subtract(point, gesture.start);
  if (!isFinitePoint(delta) || !hasOffset(delta)) {
    return undefined;
  }
  if (gesture.kind === 'move') {
    return move(gesture, delta);
  }

  const [target] = gesture.targets;
  if (!target || gesture.targets.length !== 1 || !isValidGeometry(target.geometry)) {
    return undefined;
  }

  const geometry =
    gesture.kind === 'resize'
      ? resize(target.geometry, delta, gesture.handle)
      : rotate(target.geometry, gesture.start, point);

  if (!geometry || !isValidGeometry(geometry)) {
    return undefined;
  }

  return {
    kind: gesture.kind,
    interactionId: gesture.interactionId,
    changes: [{ ...target, geometry }],
  };
}
