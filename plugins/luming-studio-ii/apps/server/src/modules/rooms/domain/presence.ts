import type { PresenceInput, RoomPoint, RoomViewport } from './model.js';

const boardLimit = 10_000_000;
const maximumScreenDimension = 20_000;
const maximumZoom = 32;
const viewIdPattern = /^[A-Za-z0-9_-]{1,120}$/u;

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

  return freshIdentity && validCursor(input.cursor) && validViewport(input.viewport);
}
