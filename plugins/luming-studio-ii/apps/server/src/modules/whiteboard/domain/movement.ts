import type {
  BoardObject,
  ConnectorDetail,
  ConnectorEndpoint,
  Geometry,
  MoveCommand,
  MoveDelta,
  Point,
} from './model.js';

const maxStoredVersion = (1n << 63n) - 1n;

function validVersion(version: bigint): boolean {
  return version >= 0n && version <= maxStoredVersion;
}

export function canAdvanceVersion(version: bigint): boolean {
  return validVersion(version) && version < maxStoredVersion;
}

export function commandSignature({ delta, targets }: MoveCommand): string {
  const targetKeys = targets.map(({ objectId, expectedGeometryVersion }) =>
    JSON.stringify([objectId, expectedGeometryVersion.toString()]),
  );

  return JSON.stringify([delta.dx.toString(), delta.dy.toString(), targetKeys.sort()]);
}

export function hasValidMoveInput({ commandId, delta, targets }: MoveCommand): boolean {
  if (!commandId.trim() || !targets.length) {
    return false;
  }
  if (![delta.dx, delta.dy].every(Number.isFinite) || (delta.dx === 0 && delta.dy === 0)) {
    return false;
  }

  const ids = new Set<string>();
  for (const { objectId, expectedGeometryVersion } of targets) {
    if (!objectId.trim() || ids.has(objectId) || !validVersion(expectedGeometryVersion)) {
      return false;
    }

    ids.add(objectId);
  }

  return true;
}

export function canTranslate({ detail }: BoardObject): boolean {
  if (detail?.kind !== 'connector') {
    return true;
  }

  return !detail.start.attachment || !detail.end.attachment || detail.bends.length > 0;
}

function translatePoint({ x, y }: Point, { dx, dy }: MoveDelta): Point {
  return { x: x + dx, y: y + dy };
}

function translateEndpoint(endpoint: ConnectorEndpoint, delta: MoveDelta): ConnectorEndpoint {
  return endpoint.attachment ? endpoint : { point: translatePoint(endpoint.point, delta) };
}

function translateConnector(
  detail: ConnectorDetail,
  delta: MoveDelta,
): ConnectorDetail | undefined {
  const start = translateEndpoint(detail.start, delta);
  const end = translateEndpoint(detail.end, delta);
  const bends = detail.bends.map((point) => translatePoint(point, delta));

  if (
    ![start.point, end.point, ...bends].every(
      ({ x, y }) => Number.isFinite(x) && Number.isFinite(y),
    )
  ) {
    return undefined;
  }

  return { ...detail, start, end, bends };
}

function hasFiniteGeometry({ x, y, width, height, rotation }: Geometry): boolean {
  const coordinates = [x, y, width, height, rotation, x + width, y + height];

  return coordinates.every(Number.isFinite) && Math.min(width, height) >= 0;
}

export function translateObject(object: BoardObject, delta: MoveDelta): BoardObject | undefined {
  const geometry = { ...object.geometry, ...translatePoint(object.geometry, delta) };
  if (!hasFiniteGeometry(geometry) || !canAdvanceVersion(object.geometryVersion)) {
    return undefined;
  }

  const translated = { ...object, geometry, geometryVersion: object.geometryVersion + 1n };
  if (object.detail?.kind !== 'connector') {
    return translated;
  }

  const detail = translateConnector(object.detail, delta);

  return detail && { ...translated, detail };
}
