import type {
  CanvasGeometry,
  CanvasMoveIntent,
  CanvasObjectChange,
  CanvasPoint,
  CanvasRect,
  CanvasTransformIntent,
} from '../contracts.js';
import { getObjectBounds, mergeRects } from '../viewport/index.js';

export { snapMove } from './snap.js';
export type { AlignmentGuide } from './snap.js';

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface TransformGesture {
  readonly kind: 'move' | 'resize' | 'rotate';
  readonly interactionId: string;
  readonly start: CanvasPoint;
  readonly targets: readonly CanvasObjectChange[];
  readonly handle?: ResizeHandle;
}

export interface TransformModifiers {
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
}

const minimumResizeSize = 24;
const rotationSnapDegrees = 15;
const degreesPerRadian = 180 / Math.PI;
const handleDirections: Record<ResizeHandle, CanvasPoint> = {
  nw: { x: -1, y: -1 },
  n: { x: 0, y: -1 },
  ne: { x: 1, y: -1 },
  e: { x: 1, y: 0 },
  se: { x: 1, y: 1 },
  s: { x: 0, y: 1 },
  sw: { x: -1, y: 1 },
  w: { x: -1, y: 0 },
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

export function getTransformBox(geometries: readonly CanvasGeometry[]): CanvasGeometry | undefined {
  if (!geometries.every(isValidGeometry)) {
    return undefined;
  }
  if (geometries.length === 1) {
    return geometries[0];
  }

  const bounds = mergeRects(geometries.map(getObjectBounds));
  const box = bounds && { ...bounds, rotation: 0 };

  return box && isValidGeometry(box) ? box : undefined;
}

export function getMoveSnapBounds(
  gesture: TransformGesture,
  point: CanvasPoint,
): CanvasRect | undefined {
  const delta = subtract(point, gesture.start);
  if (gesture.kind !== 'move' || !isFinitePoint(delta)) {
    return undefined;
  }

  const box = getTransformBox(gesture.targets.map((target) => target.geometry));
  if (!box) {
    return undefined;
  }

  const bounds = getObjectBounds(box);
  const position = { x: bounds.x + delta.x, y: bounds.y + delta.y };

  return isFinitePoint(position) ? { ...bounds, ...position } : undefined;
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

function resizeSize(geometry: CanvasGeometry, delta: CanvasPoint, modifiers: TransformModifiers) {
  const factor = modifiers.altKey ? 2 : 1;
  const width = geometry.width + delta.x * factor;
  const height = geometry.height + delta.y * factor;
  const minWidth = Math.min(geometry.width, minimumResizeSize);
  const minHeight = Math.min(geometry.height, minimumResizeSize);
  if (!modifiers.shiftKey) {
    return { width: Math.max(minWidth, width), height: Math.max(minHeight, height) };
  }

  const scaleX = width / geometry.width;
  const scaleY = height / geometry.height;
  const scale = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
  const constrainedScale = Math.max(scale, minWidth / geometry.width, minHeight / geometry.height);

  return { width: geometry.width * constrainedScale, height: geometry.height * constrainedScale };
}

function resize(
  geometry: CanvasGeometry,
  delta: CanvasPoint,
  handle: ResizeHandle | undefined,
  modifiers: TransformModifiers,
): CanvasGeometry | undefined {
  const direction = handle && handleDirections[handle];
  if (!direction) {
    return undefined;
  }

  const angle = normalizeDegrees(geometry.rotation) / degreesPerRadian;
  const local = turn(delta, -angle);
  const { width, height } = resizeSize(
    geometry,
    { x: local.x * direction.x, y: local.y * direction.y },
    modifiers,
  );
  const change = { x: (width - geometry.width) / 2, y: (height - geometry.height) / 2 };
  if (!hasOffset(change)) {
    return undefined;
  }

  const shift = modifiers.altKey
    ? { x: 0, y: 0 }
    : turn({ x: change.x * direction.x, y: change.y * direction.y }, angle);

  return {
    x: geometry.x + (shift.x - change.x),
    y: geometry.y + (shift.y - change.y),
    width,
    height,
    rotation: geometry.rotation,
  };
}

function centerOf(geometry: CanvasGeometry): CanvasPoint {
  return { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 };
}

function scaleMember(geometry: CanvasGeometry, before: CanvasGeometry, after: CanvasGeometry) {
  const sx = after.width / before.width;
  const sy = after.height / before.height;
  const center = centerOf(geometry);
  const width = geometry.width * sx;
  const height = geometry.height * sy;

  return {
    x: after.x + (center.x - before.x) * sx - width / 2,
    y: after.y + (center.y - before.y) * sy - height / 2,
    width,
    height,
    rotation: geometry.rotation,
  };
}

function transformTargets(
  gesture: TransformGesture,
  kind: 'resize' | 'rotate',
  transform: (geometry: CanvasGeometry) => CanvasGeometry,
): CanvasTransformIntent | undefined {
  const changes: CanvasObjectChange[] = [];
  for (const target of gesture.targets) {
    const geometry = transform(target.geometry);
    if (!isValidGeometry(geometry)) {
      return undefined;
    }

    changes.push({ ...target, geometry });
  }

  return { kind, interactionId: gesture.interactionId, changes };
}

function resizeTargets(
  gesture: TransformGesture,
  box: CanvasGeometry,
  delta: CanvasPoint,
  modifiers: TransformModifiers,
): CanvasTransformIntent | undefined {
  const single = gesture.targets.length === 1;
  const rotatedGroup =
    !single && gesture.targets.some(({ geometry }) => normalizeDegrees(geometry.rotation) !== 0);
  const resizeModifiers = { ...modifiers, shiftKey: modifiers.shiftKey || rotatedGroup };
  const resized = resize(box, delta, gesture.handle, resizeModifiers);
  if (!resized || !isValidGeometry(resized)) {
    return undefined;
  }

  return transformTargets(gesture, 'resize', (geometry) =>
    single ? resized : scaleMember(geometry, box, resized),
  );
}

function bearing(point: CanvasPoint, center: CanvasPoint): number | undefined {
  const offset = subtract(point, center);
  if (!isFinitePoint(offset) || !hasOffset(offset)) {
    return undefined;
  }

  return Math.atan2(offset.y, offset.x) * degreesPerRadian;
}

function rotateMember(geometry: CanvasGeometry, center: CanvasPoint, angle: number) {
  const offset = turn(subtract(centerOf(geometry), center), angle / degreesPerRadian);

  return {
    ...geometry,
    x: center.x + offset.x - geometry.width / 2,
    y: center.y + offset.y - geometry.height / 2,
    rotation: normalizeDegrees(normalizeDegrees(geometry.rotation) + angle),
  };
}

function rotateTargets(
  gesture: TransformGesture,
  box: CanvasGeometry,
  point: CanvasPoint,
  modifiers: TransformModifiers,
): CanvasTransformIntent | undefined {
  const center = centerOf(box);
  const from = bearing(gesture.start, center);
  const to = bearing(point, center);
  if (from === undefined || to === undefined) {
    return undefined;
  }

  const delta = normalizeDegrees(to - from);
  const angle = modifiers.shiftKey
    ? Math.round(delta / rotationSnapDegrees) * rotationSnapDegrees
    : delta;

  if (angle === 0) {
    return undefined;
  }

  return transformTargets(gesture, 'rotate', (geometry) => {
    if (gesture.targets.length === 1) {
      return {
        ...geometry,
        rotation: normalizeDegrees(normalizeDegrees(geometry.rotation) + angle),
      };
    }

    return rotateMember(geometry, center, angle);
  });
}

export function previewTransform(
  gesture: TransformGesture,
  point: CanvasPoint,
  modifiers: TransformModifiers = {},
): CanvasMoveIntent | CanvasTransformIntent | undefined {
  const delta = subtract(point, gesture.start);
  if (!isFinitePoint(delta) || !hasOffset(delta)) {
    return undefined;
  }
  if (gesture.kind === 'move') {
    return move(gesture, delta);
  }

  const box = getTransformBox(gesture.targets.map(({ geometry }) => geometry));
  if (!box) {
    return undefined;
  }

  return gesture.kind === 'resize'
    ? resizeTargets(gesture, box, delta, modifiers)
    : rotateTargets(gesture, box, point, modifiers);
}
