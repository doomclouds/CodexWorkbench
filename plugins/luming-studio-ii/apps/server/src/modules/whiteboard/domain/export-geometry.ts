import {
  resolveConnectorRoute,
  type ConnectorTarget,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/connector-route';
import type { BoardObject, ConnectorDetail, ConnectorEndpoint, Geometry, Point } from './model.js';

export interface ExportConnector {
  readonly points: readonly Point[];
  readonly label: Point;
}

const maxCoordinate = 1_000_000_000;

export function finitePoint({ x, y }: Point): boolean {
  return Math.abs(x) <= maxCoordinate && Math.abs(y) <= maxCoordinate;
}

export function rotatePoint({ x, y }: Point, rotation: number): Point {
  const angle = ((rotation % 360) * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);

  return { x: x * cosine - y * sine, y: x * sine + y * cosine };
}

export function geometryCenter({ x, y, width, height }: Geometry): Point {
  return { x: x + width / 2, y: y + height / 2 };
}

export function geometryCorners(geometry: Geometry): readonly Point[] {
  const center = geometryCenter(geometry);
  const horizontal = geometry.width / 2;
  const vertical = geometry.height / 2;

  return [
    { x: -horizontal, y: -vertical },
    { x: horizontal, y: -vertical },
    { x: horizontal, y: vertical },
    { x: -horizontal, y: vertical },
  ].map((point) => {
    const rotated = rotatePoint(point, geometry.rotation);

    return { x: center.x + rotated.x, y: center.y + rotated.y };
  });
}

function target(
  endpoint: ConnectorEndpoint,
  geometry: ReadonlyMap<string, BoardObject>,
): ConnectorTarget {
  const { attachment, point } = endpoint;
  const object = attachment && geometry.get(attachment.objectId);

  return { fallback: point, geometry: object?.geometry, port: attachment?.port };
}

export function exportConnector(
  detail: ConnectorDetail,
  geometry: ReadonlyMap<string, BoardObject>,
): ExportConnector | undefined {
  const points = resolveConnectorRoute(
    target(detail.start, geometry),
    target(detail.end, geometry),
    detail.bends,
    detail.relativeBends,
  );
  const middle = Math.floor((points.length - 1) / 2);
  const first = points[middle];
  if (!first || !points.every(finitePoint)) {
    return undefined;
  }

  const second = points[middle + 1] ?? first;
  const label = {
    x: (first.x + second.x) / 2 + (detail.labelOffset?.x ?? 0),
    y: (first.y + second.y) / 2 + (detail.labelOffset?.y ?? 0),
  };

  return finitePoint(label) ? { points, label } : undefined;
}
