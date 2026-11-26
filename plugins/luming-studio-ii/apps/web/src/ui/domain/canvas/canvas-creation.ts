import {
  connectionPortOffset,
  connectionPortRadius,
  connectionPorts,
  findPort,
  portPoint,
  resolveConnection,
} from './connectors/geometry.js';
import type {
  CanvasConnection,
  CanvasObject,
  CanvasObjectChange,
  CanvasObjectRegistry,
  CanvasPenStyle,
  CanvasPlacement,
  CanvasPoint,
  CanvasViewport,
} from './contracts.js';
import type { CanvasFrame } from './canvas-frame.js';
import { appendInkSample, makeInkDraft, snapInkPoint } from './ink/geometry.js';
import { projectObject, queryScene } from './scene/index.js';
import type { SceneIndex } from './scene/index.js';

export interface CanvasProjection {
  index: SceneIndex;
  pending: ReadonlyMap<string, CanvasObjectChange>;
  registry?: CanvasObjectRegistry;
}

export interface InkGesture {
  kind: 'ink';
  interactionId: string;
  samples: CanvasPoint[];
  straightEnd?: CanvasPoint;
  style?: CanvasPenStyle;
}

const inkWidth = 3;
const inkLabel = '笔迹';
const minimumPlacementWidth = 32;
const minimumPlacementHeight = 28;
const connectorLabel = '连线';

export function canConnectTo(object: CanvasObject, registry?: CanvasObjectRegistry) {
  if (registry) {
    return registry.get(object.kind)?.capabilities.connect === true;
  }

  return object.kind !== 'ink' && object.kind !== 'connector' && object.kind !== 'section';
}

export function placementDraft(
  placement: CanvasPlacement,
  start: CanvasPoint,
  end?: CanvasPoint,
  square = false,
) {
  const { width, height, ...appearance } = placement;
  if (!end) {
    return { ...appearance, geometry: { ...start, width, height, rotation: 0 } };
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  const matchSides = square && appearance.kind === 'shape';
  const right = matchSides ? start.x + Math.sign(dx || 1) * side : end.x;
  const bottom = matchSides ? start.y + Math.sign(dy || 1) * side : end.y;

  return {
    ...appearance,
    geometry: {
      x: Math.min(start.x, right),
      y: Math.min(start.y, bottom),
      width: Math.max(minimumPlacementWidth, Math.abs(right - start.x)),
      height: Math.max(minimumPlacementHeight, Math.abs(bottom - start.y)),
      rotation: 0,
    },
  };
}

export function recordInk(
  gesture: InkGesture,
  point: CanvasPoint,
  zoom: number,
  straight: boolean,
  final: boolean,
) {
  const last = gesture.samples.at(-1);
  if (straight && last) {
    gesture.straightEnd = snapInkPoint(last, point);
    return;
  }

  if (gesture.straightEnd) {
    appendInkSample(gesture.samples, gesture.straightEnd, zoom, true);
    gesture.straightEnd = undefined;
  }

  appendInkSample(gesture.samples, point, zoom, final);
}

export function inkFrame(gesture: InkGesture, viewport: CanvasViewport): CanvasFrame {
  const samples = gesture.straightEnd ? [...gesture.samples, gesture.straightEnd] : gesture.samples;
  const object = makeInkDraft(samples, gesture.style?.width ?? inkWidth, inkLabel);
  const draft = object && { ...object, stroke: gesture.style?.stroke };

  return {
    viewport,
    draft: draft && { kind: 'create', interactionId: gesture.interactionId, object: draft },
  };
}

export function resolveCanvasConnection(connection: CanvasConnection, view: CanvasProjection) {
  const { index, pending } = view;

  return resolveConnection(connection, (id) => {
    const object = index.get(id);

    const usable = object && object.kind !== 'connector' && object.kind !== 'ink';

    return usable ? projectObject(index, pending, id)?.geometry : undefined;
  });
}

export function connectorDraft(
  connection: CanvasConnection,
  view: CanvasProjection,
  style?: CanvasPenStyle,
) {
  return {
    kind: 'connector' as const,
    label: connectorLabel,
    geometry: resolveCanvasConnection(connection, view).geometry,
    connection,
    stroke: style?.stroke,
    strokeWidth: style?.width,
  };
}

export function connectionTarget(
  point: CanvasPoint,
  zoom: number,
  { index, pending, registry }: CanvasProjection,
  excludedId?: string,
) {
  const radius = connectionPortRadius(zoom);
  const limits = {
    x: point.x - radius,
    y: point.y - radius,
    width: radius * 2,
    height: radius * 2,
  };
  const candidates = queryScene(index, limits, pending)
    .filter(({ object }) => canConnectTo(object, registry))
    .map(({ object, geometry }) => ({ id: object.id, geometry }));
  const endpoint = findPort(point, candidates, zoom, excludedId);
  const target = candidates.find(({ id }) => id === endpoint.attachment?.objectId);
  const ports = target
    ? connectionPorts.map((port) => portPoint(target.geometry, port, connectionPortOffset(zoom)))
    : undefined;

  return { endpoint, ports, activePort: endpoint.attachment ? endpoint.point : undefined };
}
