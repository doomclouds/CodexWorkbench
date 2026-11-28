import {
  connectorArrowHalfWidthRatio,
  connectorPortPoint,
  resolveConnectorRoute,
  type ConnectorTarget,
} from '@codexworkbench/luming-studio-ii-whiteboard-shared/connector-route';
import type {
  CanvasConnection,
  CanvasConnectionEndpoint,
  CanvasGeometry,
  CanvasPoint,
  CanvasPort,
} from '../contracts.js';
import { containsPoint, normalizeViewport } from '../viewport/index.js';
import { connectionLineWidth, hitRoundedConnection } from './path.js';

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

type FindGeometry = (id: string) => CanvasGeometry | undefined;

export const connectionPorts: readonly CanvasPort[] = ['top', 'right', 'bottom', 'left'];

const screenPortOffset = 12;
const screenPortReach = 12;
const screenHitReach = 8;
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

export const portPoint = connectorPortPoint;

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
): ConnectorTarget {
  const { attachment } = endpoint;
  const geometry = attachment && findGeometry?.(attachment.objectId);

  return { fallback: endpoint.point, geometry, port: attachment?.port };
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

  const inset = (connectorArrowHalfWidthRatio + 0.5) * strokeWidth;

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
  const points = resolveConnectorRoute(from, to, connection.bends, connection.relativeBends);
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

export function rotateConnection(
  connection: CanvasConnection,
  before: CanvasGeometry,
  after: CanvasGeometry,
  points: readonly CanvasPoint[],
): CanvasConnection {
  const from = geometryCenter(before);
  const to = geometryCenter(after);
  const angle = rotationAngle(after.rotation - before.rotation);
  const { start, end, labelOffset, relativeBends, bends } = connection;
  const fixedRoute = Boolean(bends?.length || relativeBends?.offsets.length);

  function turnPoint(point: CanvasPoint) {
    const offset = { x: point.x - from.x, y: point.y - from.y };
    return offsetPoint(rotateVector(offset, angle), to);
  }

  function turnEndpoint(endpoint: CanvasConnectionEndpoint) {
    return endpoint.attachment ? endpoint : { point: turnPoint(endpoint.point) };
  }

  return {
    ...connection,
    start: turnEndpoint(start),
    end: turnEndpoint(end),
    bends: fixedRoute ? points.slice(1, -1).map(turnPoint) : undefined,
    relativeBends: undefined,
    labelOffset: labelOffset && rotateVector(labelOffset, angle),
  };
}
