import type {
  GestureChange,
  GesturePreview,
  PresenceInput,
  RoomPoint,
  RoomViewport,
} from './model.js';

const boardLimit = 10_000_000;
const maximumScreenDimension = 20_000;
const maximumZoom = 32;
const viewIdPattern = /^[A-Za-z0-9_-]{1,120}$/u;
const maxGestureObjects = 32;
const maxGestureObjectIdLength = 160;
const maxGeometryVersion = BigInt(Number.MAX_SAFE_INTEGER);

export function validViewId(id: string): boolean {
  return viewIdPattern.test(id);
}

function withinWorld(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= boardLimit;
}

function validCursor(point: RoomPoint | undefined): boolean {
  return point === undefined || [point.x, point.y].every(withinWorld);
}

function validViewport(viewport: RoomViewport | undefined): boolean {
  if (!viewport) {
    return true;
  }

  const { centerX, centerY, zoom, width, height } = viewport;
  const center = [centerX, centerY].every(withinWorld);
  const magnification = Number.isFinite(zoom) && zoom >= 0.001 && zoom <= maximumZoom;
  const dimensions = [width, height].every(
    (value) => Number.isFinite(value) && value > 0 && value <= maximumScreenDimension,
  );

  return center && magnification && dimensions;
}

export function validPresence(input: PresenceInput): boolean {
  const freshIdentity = validViewId(input.viewId) && input.sequence > 0n;

  const validView = validCursor(input.cursor) && validViewport(input.viewport);

  return freshIdentity && validView && validGesture(input.gesture);
}

function validGestureChange({ objectId, expectedGeometryVersion, geometry }: GestureChange) {
  const validId = objectId.trim().length > 0 && objectId.length <= maxGestureObjectIdLength;
  const validVersion =
    expectedGeometryVersion >= 0n && expectedGeometryVersion <= maxGeometryVersion;
  const { x, y, width, height, rotation } = geometry;
  const coordinatesFit = [x, y, width, height, rotation].every(withinWorld);
  const positiveSize = width > 0 && height > 0;

  return validId && validVersion && coordinatesFit && positiveSize;
}

function validGesture(gesture: GesturePreview | undefined): boolean {
  if (!gesture) {
    return true;
  }

  const { changes } = gesture;
  const bounded = changes.length > 0 && changes.length <= maxGestureObjects;
  const unique = new Set(changes.map(({ objectId }) => objectId)).size === changes.length;

  return bounded && unique && changes.every(validGestureChange);
}
