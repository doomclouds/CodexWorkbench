import type { CanvasFrame } from './canvas-frame.js';
import { placementFromPort } from './canvas-adjacent.js';
import {
  connectionTarget,
  connectorDraft,
  inkFrame,
  placementDraft,
  resolveCanvasConnection,
} from './canvas-creation.js';
import type { CanvasProjection, InkGesture } from './canvas-creation.js';
import { rotateConnection, translateConnection } from './connectors/geometry.js';
import type {
  CanvasConnection,
  CanvasConnectionEndpoint,
  CanvasObject,
  CanvasObjectChange,
  CanvasPenStyle,
  CanvasPlacement,
  CanvasPoint,
  CanvasTool,
  CanvasViewport,
} from './contracts.js';
import { getMoveSnapBounds, previewTransform, snapMove } from './gestures/index.js';
import type { TransformGesture, TransformModifiers } from './gestures/index.js';
import { scaleInk, snapInkPoint } from './ink/geometry.js';
import { projectObject, queryScene } from './scene/index.js';
import {
  getObjectBounds,
  getViewportBounds,
  panViewport,
  screenToBoard,
} from './viewport/index.js';
import type { CanvasViewportSize } from './viewport/index.js';

interface PlacementGesture {
  kind: 'place';
  interactionId: string;
  placement: CanvasPlacement;
}

interface ConnectionGesture {
  kind: 'create-connection';
  interactionId: string;
  start: CanvasConnectionEndpoint;
  style?: CanvasPenStyle;
  sourceVersion?: number;
  clickOnly?: boolean;
}

interface EndpointGesture {
  kind: 'edit-connection';
  interactionId: string;
  target: Extract<CanvasObject, { kind: 'connector' }>;
  handle: 'start' | 'end' | number;
  bends?: readonly CanvasPoint[];
}

interface TransformAction {
  kind: 'transform';
  transform: TransformGesture;
  duplicate: boolean;
}

export type PointerAction =
  | { kind: 'pan'; reported?: boolean }
  | { kind: 'marquee'; selection: readonly string[] }
  | TransformAction
  | PlacementGesture
  | InkGesture
  | ConnectionGesture
  | EndpointGesture;

export interface PointerSession {
  pointerId: number;
  origin: CanvasPoint;
  start: CanvasPoint;
  viewport: CanvasViewport;
  tool: CanvasTool;
  action: PointerAction;
}

interface FrameProjection extends CanvasProjection {
  size: CanvasViewportSize;
}

const dragThreshold = 4;
const moveThreshold = 5;
const placementThreshold = 5;
const snappingOverscan = 12;

function offset(start: CanvasPoint, end: CanvasPoint) {
  return { x: end.x - start.x, y: end.y - start.y };
}

function distance(start: CanvasPoint, end: CanvasPoint) {
  return Math.hypot(end.x - start.x, end.y - start.y);
}

function dragThresholdFor(action: PointerAction) {
  const moving = action.kind === 'transform' && action.transform.kind === 'move';

  return moving ? moveThreshold : dragThreshold;
}

function marqueeBetween(start: CanvasPoint, end: CanvasPoint) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function changeGeometry(
  change: CanvasObjectChange,
  intent: NonNullable<CanvasFrame['preview']>,
  view: FrameProjection,
): CanvasObjectChange {
  const object = view.index.get(change.id);
  if (object?.kind === 'connector' && intent.kind === 'move') {
    return { ...change, connection: translateConnection(object.connection, intent.delta) };
  }
  if (object?.kind === 'ink' && intent.kind === 'resize') {
    return { ...change, ink: scaleInk(object.ink, object.geometry, change.geometry) };
  }

  return change;
}

function rotationChanges(changes: readonly CanvasObjectChange[], view: FrameProjection) {
  if (!changes.some(({ id }) => view.index.get(id)?.kind === 'connector')) {
    return changes;
  }

  const pending = new Map(view.pending);
  for (const change of changes) {
    pending.set(change.id, change);
  }
  const next = { ...view, pending };

  return changes.map((change) => {
    const current = projectObject(view.index, view.pending, change.id);
    if (current?.object.kind !== 'connector' || !current.connectorRoute) {
      return change;
    }

    const connection = rotateConnection(
      current.object.connection,
      current.geometry,
      change.geometry,
      current.connectorRoute.points,
    );
    const { geometry } = resolveCanvasConnection(connection, next);
    return {
      ...change,
      connection,
      geometry: { ...geometry, rotation: current.object.geometry.rotation },
    };
  });
}

function transformFrame(
  action: TransformAction,
  point: CanvasPoint,
  viewport: CanvasViewport,
  modifiers: TransformModifiers,
  view: FrameProjection,
): CanvasFrame {
  const bounds = getMoveSnapBounds(action.transform, point);
  const visible = getViewportBounds(viewport, view.size, snappingOverscan);
  const references = bounds ? alignmentReferences(action.transform, visible, view) : [];
  const snap = bounds && snapMove(bounds, references, viewport.zoom);
  const aim = snap ? { x: point.x + snap.offset.x, y: point.y + snap.offset.y } : point;
  const intent = previewTransform(action.transform, aim, modifiers);
  if (!intent) {
    return { viewport };
  }

  const changes =
    intent.kind === 'rotate'
      ? rotationChanges(intent.changes, view)
      : intent.changes.map((change) => changeGeometry(change, intent, view));

  if (action.duplicate && intent.kind === 'move') {
    const { interactionId, delta } = intent;

    return {
      viewport,
      guides: snap?.guides,
      draft: { kind: 'duplicate', interactionId, delta, sources: changes },
    };
  }

  return { viewport, guides: snap?.guides, preview: { ...intent, changes } };
}

function alignmentReferences(
  transform: TransformGesture,
  bounds: ReturnType<typeof getViewportBounds>,
  { index, pending }: FrameProjection,
) {
  const ids = new Set(transform.targets.map(({ id }) => id));

  return queryScene(index, bounds, pending)
    .filter(
      ({ object }) => !ids.has(object.id) && object.kind !== 'ink' && object.kind !== 'connector',
    )
    .map(({ geometry }) => getObjectBounds(geometry));
}

function connectionFrame(
  action: ConnectionGesture,
  point: CanvasPoint,
  viewport: CanvasViewport,
  modifiers: TransformModifiers,
  view: FrameProjection,
): CanvasFrame {
  const { start, interactionId } = action;
  const { endpoint, ports, activePort } = connectionTarget(
    point,
    viewport.zoom,
    view,
    start.attachment?.objectId,
  );
  const end =
    modifiers.shiftKey && !endpoint.attachment
      ? { point: snapInkPoint(start.point, point) }
      : endpoint;

  return {
    viewport,
    ports,
    activePort,
    draft: {
      kind: 'create',
      interactionId,
      object: connectorDraft({ start, end }, view, action.style),
    },
  };
}

function editConnectionFrame(
  { target, handle, bends, interactionId }: EndpointGesture,
  point: CanvasPoint,
  viewport: CanvasViewport,
  view: FrameProjection,
): CanvasFrame {
  const current = target.connection;
  const other = handle === 'start' ? current.end : current.start;
  const targetPort =
    typeof handle === 'string'
      ? connectionTarget(point, viewport.zoom, view, other.attachment?.objectId)
      : undefined;
  const connection: CanvasConnection =
    targetPort && typeof handle === 'string'
      ? { ...current, [handle]: targetPort.endpoint }
      : {
          ...current,
          relativeBends: undefined,
          bends: bends?.map((bend, index) => (index === handle ? point : bend)),
        };
  const change = {
    id: target.id,
    expectedVersion: target.version,
    geometry: resolveCanvasConnection(connection, view).geometry,
    connection,
  };

  return {
    viewport,
    ports: targetPort?.ports,
    activePort: targetPort?.activePort,
    preview: { kind: 'connect', interactionId, changes: [change] },
  };
}

export function gestureFrame(
  session: PointerSession,
  screen: CanvasPoint,
  modifiers: TransformModifiers,
  view: FrameProjection,
  final = false,
): CanvasFrame {
  const { action, start, viewport } = session;
  if (action.kind === 'pan') {
    return { viewport: panViewport(viewport, offset(start, screen)) };
  }
  if (action.kind === 'ink') {
    return inkFrame(action, viewport);
  }

  const point = screenToBoard(screen, viewport);
  const anchor = screenToBoard(start, viewport);
  const travel = distance(start, screen);
  if (action.kind === 'place') {
    const end = travel >= placementThreshold ? point : undefined;
    const object = placementDraft(action.placement, anchor, end, modifiers.shiftKey);

    return { viewport, draft: { kind: 'create', interactionId: action.interactionId, object } };
  }
  if (travel < dragThresholdFor(action)) {
    if (final && action.kind === 'create-connection' && action.sourceVersion !== undefined) {
      const from = action.start.attachment;
      if (from?.port) {
        return {
          viewport,
          draft: placementFromPort(
            view,
            from.objectId,
            from.port,
            action.interactionId,
            action.style,
          ),
        };
      }
    }

    return { viewport };
  }

  switch (action.kind) {
    case 'marquee':
      return { viewport, marquee: marqueeBetween(anchor, point) };
    case 'transform':
      return transformFrame(action, point, viewport, modifiers, view);
    case 'create-connection':
      return action.clickOnly
        ? { viewport }
        : connectionFrame(action, point, viewport, modifiers, view);
    case 'edit-connection':
      return editConnectionFrame(action, point, viewport, view);
  }
}
