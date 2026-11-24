import type {
  CanvasConnection,
  CanvasConnectionEndpoint,
  CanvasGeometry,
  CanvasPoint,
  CanvasPort,
  CanvasRelativeBends,
} from '../contracts.js';
import { containsPoint, normalizeViewport } from '../viewport/index.js';
import { connectionHeadHalfWidth, connectionLineWidth, hitRoundedConnection } from './path.js';

export interface ResolvedConnection {
  readonly points: readonly CanvasPoint[];
  readonly geometry: CanvasGeometry;
  readonly strokeWidth: number;
  readonly labelPosition: CanvasPoint | undefined;
}

interface PortCandidate {
  readonly id: string;
  readonly geometry: CanvasGeometry;
}

interface ResolvedEndpoint {
  readonly point: CanvasPoint;
  readonly horizontal?: boolean;
}

interface EndpointTarget {
  readonly fallback: CanvasPoint;
  readonly geometry: CanvasGeometry | undefined;
  readonly port: CanvasPort | undefined;
}

type FindGeometry = (id: string) => CanvasGeometry | undefined;

export const connectionPorts: readonly CanvasPort[] = ['top', 'right', 'bottom', 'left'];

const portDirections: Record<CanvasPort, CanvasPoint> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

const screenPortOffset = 12;
const screenPortReach = 12;
const screenHitReach = 8;
const straightTolerance = 1;
const maximumRelativeBends = 12;
const degreesPerTurn = 360;
const radiansPerDegree = Math.PI / 180;
const emptyGeometry: CanvasGeometry = { x: 0, y: 0, width: 0, height: 0, rotation: 0 };

function boardDistance(pixels: number, zoom: number) {
  return pixels / normalizeViewport({ x: 0, y: 0, zoom }).zoom;
}

export function connectionPortOffset(zoom: number) {
  return boardDistance(screenPortOffset, zoom);
}

export function connectionPortRadius(zoom: number) {
  return boardDistance(screenPortOffset + screenPortReach, zoom);
}

export function connectionHitRadius(zoom: number) {
  return boardDistance(screenHitReach, zoom);
}

function rotateVector(vector: CanvasPoint, radians: number): CanvasPoint {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);

  return {
    x: vector.x * cosine - vector.y * sine,
    y: vector.x * sine + vector.y * cosine,
  };
}

function rotationAngle(rotation: number) {
  return (rotation % degreesPerTurn) * radiansPerDegree;
}

function geometryCenter({ x, y, width, height }: CanvasGeometry): CanvasPoint {
  return { x: x + width / 2, y: y + height / 2 };
}

export function portPoint(geometry: CanvasGeometry, port: CanvasPort, offset = 0): CanvasPoint {
  const { width, height, rotation } = geometry;
  const center = geometryCenter(geometry);
  const direction = portDirections[port];
  const local = {
    x: direction.x * (width / 2 + offset),
    y: direction.y * (height / 2 + offset),
  };
  const rotated = rotateVector(local, rotationAngle(rotation));

  return { x: center.x + rotated.x, y: center.y + rotated.y };
}

function squaredDistance(left: CanvasPoint, right: CanvasPoint) {
  return (left.x - right.x) ** 2 + (left.y - right.y) ** 2;
}

function nearestPort(point: CanvasPoint, geometry: CanvasGeometry, offset: number, reach: number) {
  let distance = reach ** 2;
  let nearest: CanvasPort | undefined;

  for (const port of connectionPorts) {
    const next = squaredDistance(point, portPoint(geometry, port, offset));
    if (next <= distance && (next < distance || !nearest)) {
      distance = next;
      nearest = port;
    }
  }

  return nearest;
}

function candidateEndpoint(
  point: CanvasPoint,
  { id, geometry }: PortCandidate,
  offset: number,
  reach: number,
): CanvasConnectionEndpoint | undefined {
  const handle = nearestPort(point, geometry, offset, reach);
  if (handle) {
    return { point: portPoint(geometry, handle), attachment: { objectId: id, port: handle } };
  }
  if (!containsPoint(point, geometry)) {
    return undefined;
  }

  const fallback = nearestPort(point, geometry, 0, Infinity);

  return { point: fallback ? portPoint(geometry, fallback) : point, attachment: { objectId: id } };
}

export function findPort(
  point: CanvasPoint,
  candidates: readonly PortCandidate[],
  zoom: number,
  excludeId?: string,
): CanvasConnectionEndpoint {
  const offset = connectionPortOffset(zoom);
  const reach = boardDistance(screenPortReach, zoom);

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (!candidate || candidate.id === excludeId) {
      continue;
    }

    const endpoint = candidateEndpoint(point, candidate, offset, reach);
    if (endpoint) {
      return endpoint;
    }
  }

  return { point };
}

function isFinitePoint(point: CanvasPoint) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function endpointTarget(
  endpoint: CanvasConnectionEndpoint,
  findGeometry: FindGeometry | undefined,
): EndpointTarget {
  const { attachment } = endpoint;
  const geometry = attachment && findGeometry?.(attachment.objectId);

  return { fallback: endpoint.point, geometry, port: attachment?.port };
}

function facingPoint({ geometry, fallback }: EndpointTarget): CanvasPoint {
  const center = geometry && geometryCenter(geometry);

  return center && isFinitePoint(center) ? center : fallback;
}

function facingPort(geometry: CanvasGeometry, other: CanvasPoint): CanvasPort {
  const center = geometryCenter(geometry);
  const direction = { x: other.x - center.x, y: other.y - center.y };
  const local = rotateVector(direction, -rotationAngle(geometry.rotation));
  if (Math.abs(local.x) > Math.abs(local.y)) {
    return local.x >= 0 ? 'right' : 'left';
  }

  return local.y >= 0 ? 'bottom' : 'top';
}

function resolveEndpoint(target: EndpointTarget, other: CanvasPoint): ResolvedEndpoint {
  const { fallback, geometry } = target;
  if (!geometry) {
    return { point: fallback };
  }

  const port = target.port ?? facingPort(geometry, other);
  const point = portPoint(geometry, port);
  if (!isFinitePoint(point)) {
    return { point: fallback };
  }

  const direction = rotateVector(portDirections[port], rotationAngle(geometry.rotation));

  return { point, horizontal: Math.abs(direction.x) >= Math.abs(direction.y) };
}

function automaticRoute(start: ResolvedEndpoint, end: ResolvedEndpoint) {
  const from = start.point;
  const to = end.point;
  const distanceX = Math.abs(to.x - from.x);
  const distanceY = Math.abs(to.y - from.y);
  if (distanceX < straightTolerance || distanceY < straightTolerance) {
    return [from, to];
  }

  const horizontal = start.horizontal ?? end.horizontal ?? distanceX >= distanceY;
  if (horizontal) {
    const middle = (from.x + to.x) / 2;

    return [from, { x: middle, y: from.y }, { x: middle, y: to.y }, to];
  }

  const middle = (from.y + to.y) / 2;

  return [from, { x: from.x, y: middle }, { x: to.x, y: middle }, to];
}

function stepAlong(point: CanvasPoint, coordinate: number, horizontal: boolean): CanvasPoint {
  return horizontal ? { x: coordinate, y: point.y } : { x: point.x, y: coordinate };
}

function clearsEndpoint(target: EndpointTarget, tip: CanvasPoint, neighbor?: CanvasPoint) {
  if (!target.geometry) {
    return true;
  }
  if (!neighbor) {
    return false;
  }

  const center = geometryCenter(target.geometry);
  const outwardX = (neighbor.x - tip.x) * (tip.x - center.x);
  const outwardY = (neighbor.y - tip.y) * (tip.y - center.y);

  return outwardX + outwardY > 0;
}

function relativeRoute(bends: CanvasRelativeBends, from: EndpointTarget, to: EndpointTarget) {
  const { offsets } = bends;
  if (!offsets.length || offsets.length > maximumRelativeBends || !offsets.every(Number.isFinite)) {
    return undefined;
  }

  const fromCenter = facingPoint(from);
  const toCenter = facingPoint(to);
  const firstHorizontal = bends.firstAxis === 'horizontal';
  const lastHorizontal = firstHorizontal === (offsets.length % 2 === 0);
  const split = Math.ceil(offsets.length / 2);
  const coordinates = offsets.map((offset, index) => {
    const center = index < split ? fromCenter : toCenter;
    const horizontal = firstHorizontal === (index % 2 === 0);

    return offset + (horizontal ? center.x : center.y);
  });
  const first = coordinates[0];
  const last = coordinates.at(-1);
  if (first === undefined || last === undefined) {
    return undefined;
  }

  const start = resolveEndpoint(from, stepAlong(fromCenter, first, firstHorizontal)).point;
  const end = resolveEndpoint(to, stepAlong(toCenter, last, !lastHorizontal)).point;
  const points = [start];
  let cursor = start;

  coordinates.forEach((coordinate, index) => {
    cursor = stepAlong(cursor, coordinate, firstHorizontal === (index % 2 === 0));
    points.push(cursor);
  });

  points.push(stepAlong(cursor, lastHorizontal ? end.x : end.y, lastHorizontal), end);
  const clearsStart = clearsEndpoint(from, start, points[1]);
  const clearsEnd = clearsEndpoint(to, end, points.at(-2));

  return clearsStart && clearsEnd && points.every(isFinitePoint) ? points : undefined;
}

function connectionPoints(connection: CanvasConnection, from: EndpointTarget, to: EndpointTarget) {
  const relative = connection.relativeBends && relativeRoute(connection.relativeBends, from, to);
  if (relative) {
    return relative;
  }

  const start = resolveEndpoint(from, facingPoint(to));
  const end = resolveEndpoint(to, facingPoint(from));
  if (!isFinitePoint(start.point) || !isFinitePoint(end.point)) {
    return [];
  }

  const bends = connection.bends;

  return bends?.length && bends.every(isFinitePoint)
    ? [start.point, ...bends, end.point]
    : automaticRoute(start, end);
}

function getLabelPosition(
  points: readonly CanvasPoint[],
  offset?: CanvasPoint,
): CanvasPoint | undefined {
  const middle = Math.floor((points.length - 1) / 2);
  const start = points[middle];
  if (!start) {
    return undefined;
  }

  const end = points[middle + 1] ?? start;
  const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };

  return offset && isFinitePoint(offset) ? offsetPoint(center, offset) : center;
}

function routeBounds(
  points: readonly CanvasPoint[],
  strokeWidth: number,
  labelPosition: CanvasPoint | undefined,
): CanvasGeometry {
  if (!points.length) {
    return emptyGeometry;
  }

  let left = labelPosition?.x ?? Infinity;
  let top = labelPosition?.y ?? Infinity;
  let right = labelPosition?.x ?? -Infinity;
  let bottom = labelPosition?.y ?? -Infinity;

  for (const { x, y } of points) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }

  const inset = (connectionHeadHalfWidth * strokeWidth) / connectionLineWidth + strokeWidth / 2;

  return {
    x: left - inset,
    y: top - inset,
    width: right - left + inset * 2,
    height: bottom - top + inset * 2,
    rotation: 0,
  };
}

export function resolveConnection(
  connection: CanvasConnection,
  findGeometry?: FindGeometry,
  width = connectionLineWidth,
): ResolvedConnection {
  const strokeWidth = Number.isFinite(width) && width > 0 ? width : connectionLineWidth;
  const from = endpointTarget(connection.start, findGeometry);
  const to = endpointTarget(connection.end, findGeometry);
  const route = connectionPoints(connection, from, to);
  const points = route.filter((point, index) => {
    const previous = route[index - 1];

    return !previous || squaredDistance(previous, point) !== 0;
  });
  const labelPosition = getLabelPosition(points, connection.labelOffset);

  return {
    points,
    geometry: routeBounds(points, strokeWidth, labelPosition),
    strokeWidth,
    labelPosition,
  };
}

export function hitConnection(route: ResolvedConnection, point: CanvasPoint, zoom: number) {
  const reach = Math.max(connectionHitRadius(zoom), route.strokeWidth / 2);

  return hitRoundedConnection(route.points, point, reach);
}

function offsetPoint(point: CanvasPoint, delta: CanvasPoint): CanvasPoint {
  return { x: point.x + delta.x, y: point.y + delta.y };
}

function moveEndpoint(endpoint: CanvasConnectionEndpoint, delta: CanvasPoint) {
  return endpoint.attachment ? endpoint : { point: offsetPoint(endpoint.point, delta) };
}

export function translateConnection(connection: CanvasConnection, delta: CanvasPoint) {
  return {
    ...connection,
    start: moveEndpoint(connection.start, delta),
    end: moveEndpoint(connection.end, delta),
    ...(connection.bends && { bends: connection.bends.map((point) => offsetPoint(point, delta)) }),
  };
}
