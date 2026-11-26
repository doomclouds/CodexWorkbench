import type {
  BoardObject,
  ConnectorDetail,
  ConnectorEndpoint,
  ConnectorPort,
  Geometry,
  Point,
} from './model.js';

interface Target {
  readonly fallback: Point;
  readonly geometry?: Geometry;
  readonly port?: ConnectorPort;
}

export interface ExportConnector {
  readonly points: readonly Point[];
  readonly label: Point;
}

const portOffsets: Record<ConnectorPort, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};
const maxCoordinate = 1_000_000_000;
const maxBends = 12;
const straightTolerance = 1;

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

function target(endpoint: ConnectorEndpoint, geometry: ReadonlyMap<string, BoardObject>): Target {
  const { attachment, point } = endpoint;
  const object = attachment && geometry.get(attachment.objectId);

  return { fallback: point, geometry: object?.geometry, port: attachment?.port };
}

function centerOf(entry: Target) {
  return entry.geometry ? geometryCenter(entry.geometry) : entry.fallback;
}

function facingPort(geometry: Geometry, other: Point): ConnectorPort {
  const center = geometryCenter(geometry);
  const local = rotatePoint({ x: other.x - center.x, y: other.y - center.y }, -geometry.rotation);
  if (Math.abs(local.x) > Math.abs(local.y)) {
    return local.x >= 0 ? 'right' : 'left';
  }

  return local.y >= 0 ? 'bottom' : 'top';
}

function resolveEnd(entry: Target, other: Point) {
  const { geometry } = entry;
  if (!geometry) {
    return { point: entry.fallback };
  }

  const offset = portOffsets[entry.port ?? facingPort(geometry, other)];
  const local = rotatePoint(
    { x: (offset.x * geometry.width) / 2, y: (offset.y * geometry.height) / 2 },
    geometry.rotation,
  );
  const center = geometryCenter(geometry);
  const direction = rotatePoint(offset, geometry.rotation);

  return {
    point: { x: center.x + local.x, y: center.y + local.y },
    horizontal: Math.abs(direction.x) >= Math.abs(direction.y),
  };
}

function step(point: Point, coordinate: number, horizontal: boolean): Point {
  return horizontal ? { x: coordinate, y: point.y } : { x: point.x, y: coordinate };
}

function clearsEndpoint(entry: Target, tip: Point, neighbor?: Point): boolean {
  if (!entry.geometry) {
    return true;
  }
  if (!neighbor) {
    return false;
  }

  const origin = centerOf(entry);

  return (neighbor.x - tip.x) * (tip.x - origin.x) + (neighbor.y - tip.y) * (tip.y - origin.y) > 0;
}

function relativeRoute(
  relative: NonNullable<ConnectorDetail['relativeBends']>,
  from: Target,
  to: Target,
): readonly Point[] | undefined {
  const { offsets } = relative;
  if (!offsets.length || offsets.length > maxBends || !offsets.every(Number.isFinite)) {
    return undefined;
  }

  const start = centerOf(from);
  const end = centerOf(to);
  const firstHorizontal = relative.firstAxis === 'horizontal';
  const lastHorizontal = firstHorizontal === (offsets.length % 2 === 0);
  const split = Math.ceil(offsets.length / 2);
  const coordinates = offsets.map((offset, index) => {
    const center = index < split ? start : end;
    const horizontal = firstHorizontal === (index % 2 === 0);

    return offset + (horizontal ? center.x : center.y);
  });
  const first = coordinates[0];
  const last = coordinates.at(-1);
  if (first === undefined || last === undefined) {
    return undefined;
  }

  const tip = resolveEnd(from, step(start, first, firstHorizontal)).point;
  const destination = resolveEnd(to, step(end, last, !lastHorizontal)).point;
  const points = [tip];
  let cursor = tip;

  coordinates.forEach((coordinate, index) => {
    cursor = step(cursor, coordinate, firstHorizontal === (index % 2 === 0));
    points.push(cursor);
  });

  points.push(
    step(cursor, lastHorizontal ? destination.x : destination.y, lastHorizontal),
    destination,
  );
  const clearsStart = clearsEndpoint(from, tip, points[1]);
  const clearsEnd = clearsEndpoint(to, destination, points.at(-2));
  const clearsTargets = clearsStart && clearsEnd;

  return clearsTargets && points.every(finitePoint) ? points : undefined;
}

function automaticRoute(
  start: ReturnType<typeof resolveEnd>,
  end: ReturnType<typeof resolveEnd>,
): readonly Point[] {
  const from = start.point;
  const to = end.point;
  const horizontalDistance = Math.abs(to.x - from.x);
  const verticalDistance = Math.abs(to.y - from.y);
  if (horizontalDistance < straightTolerance || verticalDistance < straightTolerance) {
    return [from, to];
  }

  const horizontal = start.horizontal ?? end.horizontal ?? horizontalDistance >= verticalDistance;
  const middle = horizontal ? (from.x + to.x) / 2 : (from.y + to.y) / 2;

  return [from, step(from, middle, horizontal), step(to, middle, horizontal), to];
}

function route(detail: ConnectorDetail, from: Target, to: Target): readonly Point[] {
  const relative = detail.relativeBends && relativeRoute(detail.relativeBends, from, to);
  if (relative) {
    return relative;
  }

  const start = resolveEnd(from, centerOf(to));
  const end = resolveEnd(to, centerOf(from));

  return detail.bends.length
    ? [start.point, ...detail.bends, end.point]
    : automaticRoute(start, end);
}

export function exportConnector(
  detail: ConnectorDetail,
  geometry: ReadonlyMap<string, BoardObject>,
): ExportConnector | undefined {
  const raw = route(detail, target(detail.start, geometry), target(detail.end, geometry));
  const points = raw.filter((point, index) => {
    const previous = raw[index - 1];

    return !previous || previous.x !== point.x || previous.y !== point.y;
  });
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
