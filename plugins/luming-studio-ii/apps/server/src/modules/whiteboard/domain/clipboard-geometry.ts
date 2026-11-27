import { exportConnector } from './export-geometry.js';
import { geometryInWorld, hasValidConnectorGeometry } from './geometry-edits.js';
import type { BoardObject, ConnectorEndpoint, MoveDelta, Point } from './model.js';
import { translateObject } from './movement.js';

export interface ClipboardGeometryScope {
  readonly ids: ReadonlyMap<string, string>;
  readonly groups: ReadonlyMap<string, string>;
  readonly geometry: ReadonlyMap<string, BoardObject>;
  readonly delta: MoveDelta;
  readonly attachableObjects: ReadonlySet<string>;
}

function copiedEndpoint(
  source: ConnectorEndpoint,
  translated: ConnectorEndpoint,
  resolved: Point | undefined,
  scope: ClipboardGeometryScope,
): ConnectorEndpoint {
  const { attachment } = source;
  if (!attachment) {
    return translated;
  }

  const copy = scope.ids.get(attachment.objectId);
  const base = resolved ?? source.point;
  const point = { x: base.x + scope.delta.dx, y: base.y + scope.delta.dy };
  if (copy !== undefined) {
    return { point, attachment: { ...attachment, objectId: copy } };
  }

  return scope.attachableObjects.has(attachment.objectId) ? source : { point };
}

export function clipboardObject(
  source: BoardObject,
  objectId: string,
  scope: ClipboardGeometryScope,
): BoardObject | undefined {
  const moved = translateObject({ ...source, geometryVersion: 0n }, scope.delta);
  if (!moved || !geometryInWorld(moved.geometry)) {
    return undefined;
  }

  const copy: BoardObject = {
    ...moved,
    objectId,
    geometryVersion: 0n,
    payloadVersion: source.payloadVersion === undefined ? undefined : 0n,
    groupId: source.groupId === undefined ? undefined : scope.groups.get(source.groupId),
    parentId: source.parentId === undefined ? undefined : scope.ids.get(source.parentId),
  };
  const { detail } = moved;
  if (source.detail?.kind !== 'connector' || detail?.kind !== 'connector') {
    return copy;
  }

  const connector = exportConnector(source.detail, scope.geometry);
  const start = copiedEndpoint(source.detail.start, detail.start, connector?.points[0], scope);
  const end = copiedEndpoint(source.detail.end, detail.end, connector?.points.at(-1), scope);
  const next = { ...detail, start, end };

  return hasValidConnectorGeometry(next) ? { ...copy, detail: next } : undefined;
}
