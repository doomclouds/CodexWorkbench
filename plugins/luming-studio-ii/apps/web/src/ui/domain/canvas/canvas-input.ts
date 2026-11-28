import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react';

import { canConnectTo, connectionTarget, placementDraft, recordInk } from './canvas-creation.js';
import {
  canvasNativeId,
  canvasDragSurface,
  canvasLabelId,
  containerOrigin,
  isCanvasActivationControl,
  isCanvasHandle,
  isCanvasKeyboardControl,
  ownsEvent,
  relativePoint,
  wheelDelta,
  wheelZoomFactor,
} from './canvas-events.js';
import type { CanvasFrame, CanvasFrameController } from './canvas-frame.js';
import { gestureFrame } from './canvas-gesture-frame.js';
import type { PointerAction, PointerSession } from './canvas-gesture-frame.js';
import { editableTarget, isCurrentEdit } from './canvas-model.js';
import { useObjectNavigation } from './canvas-object-navigation.js';
import { translateConnection } from './connectors/geometry.js';
import { connectionHandleBends } from './connectors/handles.js';
import type {
  CanvasConnectionEndpoint,
  CanvasFitScope,
  CanvasObjectChange,
  CanvasObjectKind,
  CanvasNudgeScope,
  CanvasObjectNavigation,
  CanvasObjectRegistry,
  CanvasPoint,
  CanvasProps,
  CanvasTool,
  CanvasViewport,
} from './contracts.js';
import { previewTransform, type ResizeHandle, type TransformGesture } from './gestures/index.js';
import { maxInkSamples } from './ink/geometry.js';
import { projectObject, queryScene } from './scene/index.js';
import type { SceneIndex } from './scene/index.js';
import {
  canvasHitBounds,
  expandMoveIds,
  hitTest,
  marqueeSelection,
  selectObject,
} from './selection/index.js';
import { panViewport, screenToBoard, zoomViewport } from './viewport/index.js';
import type { CanvasViewportSize } from './viewport/index.js';

type PointerSample = Pick<PointerEvent, 'clientX' | 'clientY' | 'pointerId'> &
  Partial<Pick<PointerEvent, 'target'>>;
type TargetSample = Pick<ReactMouseEvent, 'clientX' | 'clientY' | 'target'>;
type TransformHandle = ResizeHandle | 'rotate';
type EditChanges = ReadonlyMap<string, CanvasObjectChange>;

interface QueuedNudges extends CanvasNudgeScope {
  readonly steps: CanvasPoint[];
  lastSubmittedAt?: number;
}

function sameIds(first: readonly string[], second: readonly string[]) {
  return first.length === second.length && first.every((id, index) => id === second[index]);
}

interface CapturedPointerSession extends PointerSession {
  readonly captureTarget: Element;
}

interface CanvasInputOptions {
  root: RefObject<HTMLDivElement | null>;
  size: CanvasViewportSize;
  index: SceneIndex;
  pending: EditChanges;
  registry: CanvasObjectRegistry;
  frame: CanvasFrameController;
  props: CanvasProps;
  fitScene: (scope: CanvasFitScope) => CanvasViewport | undefined;
}

const primaryButton = 0;
const middleButton = 1;
const keyboardZoomFactor = 1.2;
const keyboardFastStep = 10;
const keyboardPanFactor = 24;
const keyboardDirections = new Map<string, CanvasPoint>([
  ['ArrowUp', { x: 0, y: -1 }],
  ['ArrowRight', { x: 1, y: 0 }],
  ['ArrowDown', { x: 0, y: 1 }],
  ['ArrowLeft', { x: -1, y: 0 }],
]);

function keyboardFit(event: ReactKeyboardEvent<HTMLDivElement>): CanvasFitScope | undefined {
  if (event.ctrlKey || event.metaKey) {
    return event.key === '0' ? 'auto' : undefined;
  }
  if (!event.shiftKey) {
    return undefined;
  }
  if (event.code === 'Digit1') {
    return 'board';
  }
  if (event.code === 'Digit2') {
    return 'selection';
  }
}

function keyboardZoom(event: ReactKeyboardEvent<HTMLDivElement>, zoom: number) {
  const reset = event.shiftKey && event.code === 'Digit0';
  if (reset && !event.ctrlKey && !event.metaKey) {
    return 1 / zoom;
  }
  if (!event.ctrlKey && !event.metaKey) {
    return undefined;
  }
  if (event.key === '+' || event.key === '=') {
    return keyboardZoomFactor;
  }
  if (event.key === '-') {
    return 1 / keyboardZoomFactor;
  }
}

function isPrimaryPointer(event: ReactPointerEvent<HTMLElement>) {
  return event.pointerType !== 'touch' || event.isPrimary;
}

function canMove(index: SceneIndex, id: string) {
  const object = index.get(id);

  return (
    object?.kind !== 'connector' ||
    !object.connection.start.attachment ||
    !object.connection.end.attachment ||
    Boolean(object.connection.bends?.length)
  );
}

export function useCanvasInput({
  root,
  size,
  index,
  pending,
  registry,
  frame,
  props,
  fitScene,
}: CanvasInputOptions) {
  const active = useRef<CapturedPointerSession | null>(null);
  const nudges = useRef<QueuedNudges | undefined>(undefined);
  const [pointerAction, setPointerAction] = useState<PointerAction['kind']>();
  const spaceHeld = useRef(false);
  const [spaceActive, setSpaceActive] = useState(false);
  const nextInteraction = useRef(0);
  const instanceId = useId();
  const {
    tool,
    canEdit,
    selection,
    penStyle,
    onSelectionChange,
    onToolChange,
    onEditIntent,
    viewId,
  } = props;
  const canDraw = props.canDraw ?? canEdit;
  const { read, update, draw } = frame;
  const key = typeof tool === 'string' ? tool : 'place:' + tool.requestId;
  const [activation, setActivation] = useState({ key, completed: false });
  const settled = useRef<typeof activation | undefined>(undefined);
  const objectNavigation = useObjectNavigation(
    root,
    frame,
    updateSpace,
    props.onViewportNavigation,
  );

  if (activation.key !== key) {
    setActivation({ key, completed: false });
  }

  const editableTool = tool === 'pen' ? canDraw : canEdit;
  const toolAvailable = tool === 'pan' || (editableTool && !activation.completed);
  const displayedTool = toolAvailable ? tool : 'select';
  const toolKind = typeof displayedTool === 'string' ? displayedTool : displayedTool.kind;

  function currentTool(): CanvasTool {
    return settled.current === activation ? 'select' : displayedTool;
  }

  function exitDrawingTool() {
    const current = currentTool();
    if (current === 'select' || current === 'pan') {
      return;
    }

    settled.current = activation;
    setActivation({ key, completed: true });
    onToolChange?.('select');
  }

  function interactionId() {
    nextInteraction.current += 1;

    return viewId + ':' + instanceId + ':' + nextInteraction.current;
  }

  function captureOwner(container: HTMLDivElement, sample: PointerSample, action: PointerAction) {
    if (action.kind !== 'transform' || action.transform.kind !== 'move') {
      return container;
    }

    const { target } = sample;
    const ElementType = container.ownerDocument.defaultView?.Element;
    if (!ElementType || !(target instanceof ElementType)) {
      return container;
    }

    const native = canvasNativeId(target, container);
    const object = native ? index.get(native) : undefined;
    const extension = object && registry.get(object.kind);

    return extension?.capturePointerTargetOnBodyDrag ? target : container;
  }

  function begin(
    container: HTMLDivElement,
    sample: PointerSample,
    origin: CanvasPoint,
    action: PointerAction,
  ) {
    const captureTarget = captureOwner(container, sample, action);
    active.current = {
      pointerId: sample.pointerId,
      captureTarget,
      origin,
      start: relativePoint(sample, origin),
      viewport: read().viewport,
      tool: currentTool(),
      action,
    };
    captureTarget.setPointerCapture?.(sample.pointerId);
    objectNavigation.stop();
    setPointerAction(action.kind);
  }

  function end(session: CapturedPointerSession) {
    active.current = null;
    setPointerAction(undefined);
    const { captureTarget, pointerId } = session;
    if (captureTarget.hasPointerCapture?.(pointerId)) {
      captureTarget.releasePointerCapture(pointerId);
    }
  }

  function cancel(timing: 'now' | 'frame' = 'now') {
    objectNavigation.stop();
    const session = active.current;
    if (session) {
      end(session);
    }

    update({ viewport: read().viewport }, timing);
  }

  function updateSpace(held: boolean) {
    spaceHeld.current = held;
    setSpaceActive(held);
  }

  function clearSpace() {
    updateSpace(false);
  }

  function handleObjectNavigation(id: string, event: CanvasObjectNavigation) {
    const object = index.get(id);
    const mode = object && registry.get(object.kind)?.capabilities.content;
    if (mode === 'embedded' && !active.current) {
      objectNavigation.navigate(id, event);
    }
  }

  function currentSession({ action, tool: startedTool }: PointerSession) {
    const now = currentTool();
    const sameTool =
      typeof now === 'string' || typeof startedTool === 'string'
        ? now === startedTool
        : now.requestId === startedTool.requestId;

    if (!sameTool || action.kind === 'pan' || action.kind === 'marquee') {
      return sameTool;
    }

    if (action.kind === 'transform') {
      const { targets, kind } = action.transform;

      return (
        canStartTransform(
          kind,
          targets.map(({ id }) => id),
        ) &&
        isCurrentEdit(index, pending, targets) &&
        targets.every(({ id }) => {
          const object = index.get(id);

          return object && transformAllowed(object.kind, kind);
        })
      );
    }
    if (!(action.kind === 'ink' ? canDraw : canEdit)) {
      return false;
    }
    if (action.kind === 'edit-connection') {
      return editableTarget(index, pending, action.target.id)?.version === action.target.version;
    }

    if (action.kind === 'create-connection' && action.sourceVersion !== undefined) {
      const id = action.start.attachment?.objectId;
      const source = id ? editableTarget(index, pending, id) : undefined;

      return source?.version === action.sourceVersion && canConnectTo(source, registry);
    }

    return true;
  }

  function transformAllowed(kind: CanvasObjectKind, transform: TransformGesture['kind']) {
    return registry.get(kind)?.capabilities[transform] === true;
  }

  const cancelStaleSession = useEffectEvent(() => {
    const session = active.current;
    if (session && !currentSession(session)) {
      cancel('frame');
    } else if (!session && read().ports && currentTool() !== 'connector') {
      cancel('frame');
    }
  });
  useLayoutEffect(() => {
    cancelStaleSession();
  }, [canDraw, canEdit, index, pending, key, props.pendingResizeObjectId]);

  function transformTargets(
    kind: TransformGesture['kind'],
    ids: readonly string[],
    duplicate = false,
  ) {
    const moves = kind === 'move';
    const candidateIds = moves ? expandMoveIds(index, ids, pending) : ids;
    return candidateIds.flatMap((id) => {
      const object = editableTarget(index, pending, id);
      const projection = object && projectObject(index, pending, id);
      const canTransform = !moves || duplicate || canMove(index, id);
      const capable = object && transformAllowed(object.kind, kind);
      if (!projection || !canTransform || !capable) {
        return [];
      }

      return [{ id, expectedVersion: object.version, geometry: projection.geometry }];
    });
  }

  function canStartTransform(kind: TransformGesture['kind'], ids: readonly string[]) {
    if (kind === 'rotate' && ids.length === 1 && index.get(ids[0]!)?.kind === 'connector') {
      return false;
    }

    return (
      canEdit || (kind === 'resize' && ids.length === 1 && ids[0] === props.pendingResizeObjectId)
    );
  }

  function beginTransform(
    container: HTMLDivElement,
    sample: ReactPointerEvent<HTMLElement>,
    origin: CanvasPoint,
    kind: TransformGesture['kind'],
    ids: readonly string[],
    handle?: ResizeHandle,
  ) {
    if (!canStartTransform(kind, ids)) {
      return;
    }

    const duplicate = kind === 'move' && sample.altKey;
    const targets = transformTargets(kind, ids, duplicate);
    if (targets.length === 0 || (kind !== 'move' && targets.length !== ids.length)) {
      return;
    }

    const start = screenToBoard(relativePoint(sample, origin), read().viewport);
    begin(container, sample, origin, {
      kind: 'transform',
      duplicate,
      transform: { kind, interactionId: interactionId(), start, targets, handle },
    });
  }

  function objectAt(event: TargetSample, container: HTMLDivElement, origin: CanvasPoint) {
    const title = canvasLabelId(event.target, container);
    if (title && index.get(title)) {
      return title;
    }

    const { viewport } = read();
    const point = screenToBoard(relativePoint(event, origin), viewport);
    const hits = queryScene(index, canvasHitBounds(point, viewport.zoom), pending);

    return hitTest(hits, point, viewport.zoom);
  }

  function beginSelection(
    container: HTMLDivElement,
    event: ReactPointerEvent<HTMLDivElement>,
    origin: CanvasPoint,
    id: string | undefined,
  ) {
    const toggle = event.shiftKey || event.ctrlKey || event.metaKey;
    if (!id) {
      const seed = toggle ? selection : [];
      if (!toggle && selection.length > 0) {
        onSelectionChange(seed);
      }

      begin(container, event, origin, { kind: 'marquee', selection: seed });
      return;
    }

    const held = selection.includes(id) && !toggle;
    const selected = held ? selection : selectObject(selection, id, toggle, index);
    if (!held) {
      onSelectionChange(selected);
    }
    const shiftAdded = event.shiftKey && !selection.includes(id);
    if ((!toggle || shiftAdded) && editableTarget(index, pending, id)) {
      beginTransform(container, event, origin, 'move', selected);
    }
  }

  function beginTool(
    container: HTMLDivElement,
    event: ReactPointerEvent<HTMLDivElement>,
    origin: CanvasPoint,
    chosenTool: Exclude<CanvasTool, 'select' | 'pan'>,
  ) {
    const { viewport } = read();
    const start = screenToBoard(relativePoint(event, origin), viewport);
    const id = interactionId();
    if (chosenTool === 'pen') {
      begin(container, event, origin, {
        kind: 'ink',
        interactionId: id,
        samples: [start],
        style: penStyle,
      });
    } else if (chosenTool === 'connector') {
      const { endpoint } = connectionTarget(start, viewport.zoom, { index, pending, registry });
      begin(container, event, origin, {
        kind: 'create-connection',
        interactionId: id,
        start: endpoint,
        style: penStyle,
      });
    } else if (registry.get(chosenTool.object.kind)) {
      begin(container, event, origin, {
        kind: 'place',
        interactionId: id,
        placement: chosenTool.object,
      });
    }
  }

  function wantsPan(button: number) {
    return button === middleButton || currentTool() === 'pan' || spaceHeld.current;
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (active.current || event.defaultPrevented || !isPrimaryPointer(event)) {
      return;
    }
    if (event.button !== primaryButton && event.button !== middleButton) {
      return;
    }

    const container = event.currentTarget;
    if (!ownsEvent(event.target, container)) {
      return;
    }

    const origin = containerOrigin(container);
    const chosenTool = currentTool();
    const nativeTarget = canvasNativeId(event.target, container);
    const pan = wantsPan(event.button) || Boolean(props.presentation && !nativeTarget);
    const selecting = chosenTool === 'select' && !pan;
    const id = selecting ? objectAt(event, container, origin) : undefined;
    const native = selecting ? nativeTarget : undefined;
    const surface = canvasDragSurface(event.target, container);
    if (native && native === id && nativePointer(native, surface)) {
      if (!selection.includes(native)) {
        onSelectionChange(selectObject(selection, native, false, index));
      }

      return;
    }

    event.preventDefault();
    container.focus({ preventScroll: true });
    if (pan || chosenTool === 'pan') {
      begin(container, event, origin, { kind: 'pan' });
    } else if (chosenTool === 'select') {
      beginSelection(container, event, origin, id);
    } else {
      beginTool(container, event, origin, chosenTool);
    }
  }

  function nativePointer(id: string, surface: ReturnType<typeof canvasDragSurface>) {
    if (!canEdit || !surface || !editableTarget(index, pending, id)) {
      return true;
    }

    return surface === 'background' && selection.includes(id);
  }

  function handlePointerDownCapture(event: ReactPointerEvent<HTMLDivElement>) {
    if (!wantsPan(event.button)) {
      return;
    }

    handlePointerDown(event);
    if (active.current?.pointerId === event.pointerId && active.current.action.kind === 'pan') {
      event.stopPropagation();
    }
  }

  function handleDoubleClick(event: ReactMouseEvent<HTMLDivElement>) {
    const { target, currentTarget: container } = event;
    if (event.defaultPrevented || currentTool() !== 'select' || !ownsEvent(target, container)) {
      return;
    }
    if (isCanvasHandle(target, container)) {
      return;
    }

    const origin = containerOrigin(container);
    const id = objectAt(event, container, origin);
    const native = canvasNativeId(target, container);
    const point = screenToBoard(relativePoint(event, origin), read().viewport);
    if (!id) {
      const placement = props.blankDoubleClickPlacement;
      const placeable = placement && canEdit && !props.presentation;
      const blank =
        !native &&
        !isCanvasKeyboardControl(target, container) &&
        !isCanvasActivationControl(target, container);

      if (placeable && blank) {
        onEditIntent({
          kind: 'create',
          interactionId: interactionId(),
          object: placementDraft(placement, point),
        });
      }
      return;
    }
    if (native === id) {
      return;
    }

    const object = index.get(id);
    if (object && registry.get(object.kind)?.activateOnDoubleClick === false) {
      return;
    }

    props.onObjectActivate?.({ id, point });
  }

  function handleContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    const { target, currentTarget: container } = event;
    if (!props.onContextMenu || event.defaultPrevented || !ownsEvent(target, container)) {
      return;
    }
    if (canvasNativeId(target, container) || isCanvasKeyboardControl(target, container)) {
      return;
    }

    event.preventDefault();
    const id = objectAt(event, container, containerOrigin(container));
    const hit = id ? [id] : [];
    const ids = id && selection.includes(id) ? selection : hit;
    props.onContextMenu({ x: event.clientX, y: event.clientY }, ids);
  }

  function prepareHandle(event: ReactPointerEvent<HTMLButtonElement>) {
    const container = root.current;
    const available = !active.current && currentTool() === 'select';
    if (!container || !available || !isPrimaryPointer(event)) {
      return undefined;
    }

    event.preventDefault();
    container.focus({ preventScroll: true });

    return container;
  }

  function handleHandlePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    handle: TransformHandle,
  ) {
    const container = prepareHandle(event);
    if (!container) {
      return;
    }

    const origin = containerOrigin(container);
    if (handle === 'rotate') {
      beginTransform(container, event, origin, 'rotate', selection);
    } else {
      beginTransform(container, event, origin, 'resize', selection, handle);
    }
  }

  function handlePortPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    start: CanvasConnectionEndpoint,
  ) {
    const container = prepareHandle(event);
    const id = start.attachment?.objectId;
    const object = id ? editableTarget(index, pending, id) : undefined;
    const validSource = object && canConnectTo(object, registry);
    if (!container || !canEdit || !validSource) {
      return;
    }

    begin(container, event, containerOrigin(container), {
      kind: 'create-connection',
      interactionId: interactionId(),
      start,
      style: penStyle,
      sourceVersion: object?.version,
      clickOnly: object && registry.get(object.kind)?.portClick === 'place',
    });
  }

  function handleConnectorPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    id: string,
    handle: 'start' | 'end' | number,
  ) {
    const container = prepareHandle(event);
    if (!container || !canEdit) {
      return;
    }

    const target = editableTarget(index, pending, id);
    const route = projectObject(index, pending, id)?.connectorRoute;
    if (target?.kind !== 'connector' || !route) {
      return;
    }

    begin(container, event, containerOrigin(container), {
      kind: 'edit-connection',
      interactionId: interactionId(),
      target,
      handle,
      bends: typeof handle === 'number' ? connectionHandleBends(route.points) : undefined,
    });
  }

  function complete(session: CapturedPointerSession, next: CanvasFrame) {
    end(session);
    update({ viewport: next.viewport }, 'now');
    if (session.action.kind === 'marquee' && next.marquee) {
      const objects = queryScene(index, next.marquee, pending);
      onSelectionChange(marqueeSelection(objects, next.marquee, session.action.selection));
    }

    const intent = next.preview ?? next.draft;
    if (intent?.kind === 'create' && session.action.kind !== 'ink') {
      exitDrawingTool();
    }
    if (intent) {
      onEditIntent(intent);
    }
  }

  function sampleGesture(
    session: CapturedPointerSession,
    event: ReactPointerEvent<HTMLDivElement>,
    final: boolean,
  ) {
    const screen = relativePoint(event, session.origin);
    const modifiers = { altKey: event.altKey, shiftKey: event.shiftKey };
    const { action, viewport } = session;
    const moved = screen.x !== session.start.x || screen.y !== session.start.y;
    if (action.kind === 'pan' && moved && !action.reported) {
      action.reported = true;
      props.onViewportNavigation?.('pan');
    }
    if (action.kind === 'ink') {
      const point = screenToBoard(screen, viewport);
      recordInk(action, point, viewport.zoom, event.shiftKey, final);
    }

    const resolve = () =>
      gestureFrame(session, screen, modifiers, { index, pending, registry, size }, final);

    if (final || (action.kind === 'ink' && action.samples.length >= maxInkSamples)) {
      complete(session, resolve());
    } else {
      draw(resolve);
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!ownsEvent(event.target, event.currentTarget)) {
      handlePointerLeave();
      return;
    }

    if (props.onWorldPointerChange && isPrimaryPointer(event)) {
      const screen = relativePoint(event, containerOrigin(event.currentTarget));
      props.onWorldPointerChange(screenToBoard(screen, read().viewport));
    }

    const session = active.current;
    if (!session) {
      hoverTool(event);
      return;
    }
    if (session.pointerId !== event.pointerId) {
      return;
    }

    if (!currentSession(session)) {
      cancel();
      return;
    }

    sampleGesture(session, event, false);
  }

  function availablePlacement(tool: CanvasTool) {
    const blocked = props.annotationActive || props.presentation;
    if (!blocked && typeof tool === 'object' && registry.get(tool.object.kind)) {
      return tool;
    }
  }

  function hoverTool(event: ReactPointerEvent<HTMLDivElement>) {
    if (currentTool() === 'connector') {
      hoverPorts(event);
      return;
    }

    const placement = availablePlacement(currentTool());
    if (placement && !spaceHeld.current && event.pointerType !== 'touch') {
      const point = relativePoint(event, containerOrigin(event.currentTarget));
      draw(() => ({
        viewport: read().viewport,
        placementHover: { requestId: placement.requestId, point },
      }));
    }
  }

  function draftForFrame({ viewport, draft, placementHover }: CanvasFrame): CanvasFrame['draft'] {
    if (draft) {
      return editableTool ? draft : undefined;
    }

    const placement = availablePlacement(displayedTool);
    const busy = pointerAction || spaceActive || objectNavigation.panning;
    if (!placement || placementHover?.requestId !== placement.requestId || busy) {
      return;
    }

    return {
      kind: 'create',
      interactionId: 'placement-hover',
      object: placementDraft(placement.object, screenToBoard(placementHover.point, viewport)),
    };
  }

  function hoverPorts(event: ReactPointerEvent<HTMLDivElement>) {
    const screen = relativePoint(event, containerOrigin(event.currentTarget));
    const { viewport } = read();
    draw(() => {
      const point = screenToBoard(screen, viewport);
      const { ports, activePort } = connectionTarget(point, viewport.zoom, {
        index,
        pending,
        registry,
      });

      return { viewport, ports, activePort };
    });
  }

  function handlePointerLeave() {
    props.onWorldPointerChange?.(undefined);
    const tool = currentTool();
    if (!active.current && (tool === 'connector' || typeof tool === 'object')) {
      cancel();
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const session = active.current;
    if (
      !session ||
      session.pointerId !== event.pointerId ||
      !ownsEvent(event.target, event.currentTarget)
    ) {
      return;
    }

    if (!currentSession(session)) {
      cancel();
      return;
    }

    sampleGesture(session, event, true);
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      active.current?.pointerId === event.pointerId &&
      ownsEvent(event.target, event.currentTarget)
    ) {
      cancel();
    }
  }

  function escapeCanvas(event: ReactKeyboardEvent<HTMLDivElement>) {
    props.onViewportNavigation?.('escape');
    const toolNow = currentTool();
    if (active.current?.action.kind === 'place') {
      event.preventDefault();
      cancel();
      return;
    }

    const drawingTool = toolNow !== 'select' && toolNow !== 'pan';
    if (active.current || objectNavigation.panning || drawingTool) {
      event.preventDefault();
      cancel();
      exitDrawingTool();
    } else if (toolNow === 'pan') {
      event.preventDefault();
      onToolChange?.('select');
    } else if (selection.length > 0) {
      event.preventDefault();
      onSelectionChange([]);
    }
  }

  function handleViewportKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    const fit = keyboardFit(event);
    if (fit) {
      event.preventDefault();
      const viewport = fitScene(fit);
      if (viewport) {
        props.onViewportNavigation?.('fit');
        cancel();
        update({ viewport }, 'now');
      }

      return true;
    }

    const viewport = read().viewport;
    const factor = keyboardZoom(event, viewport.zoom);
    if (factor === undefined) {
      return false;
    }

    event.preventDefault();
    props.onViewportNavigation?.('zoom');
    cancel();
    const anchor = { x: size.width / 2, y: size.height / 2 };
    update({ viewport: zoomViewport(viewport, anchor, factor) }, 'now');

    return true;
  }

  function escapeNativeDocument(event: ReactKeyboardEvent<HTMLDivElement>, id: string) {
    const modified = event.altKey || event.ctrlKey || event.metaKey;
    const selectedDocument =
      selection.length === 1 && selection[0] === id && index.get(id)?.kind === 'document';

    if (event.key !== 'Escape' || modified || !selectedDocument) {
      return;
    }

    escapeCanvas(event);
    event.currentTarget.focus({ preventScroll: true });
  }

  function editSelected(event: ReactKeyboardEvent<HTMLDivElement>) {
    const [id] = selection;
    const object = id && selection.length === 1 ? index.get(id) : undefined;
    const editable = canEdit && currentTool() === 'select';
    if (!editable || !object || !registry.get(object.kind)?.View) {
      return;
    }

    event.preventDefault();
    const { x, y, width, height } = object.geometry;
    props.onObjectActivate?.({ id: object.id, point: { x: x + width / 2, y: y + height / 2 } });
  }

  function handleNavigationKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.altKey) {
      return true;
    }

    const command = event.ctrlKey || event.metaKey;
    const wantsAll = event.key.toLowerCase() === 'a' && !event.shiftKey;
    if (command && wantsAll && !props.presentation) {
      event.preventDefault();
      onSelectionChange(props.scene.objects.map(({ id }) => id));
      return true;
    }

    return handleViewportKey(event) || command;
  }

  function submitNudge(delta: CanvasPoint, expectedTargets?: readonly string[]) {
    const targets = transformTargets('move', selection);
    if (
      expectedTargets &&
      !sameIds(
        expectedTargets,
        targets.map(({ id }) => id),
      )
    ) {
      return false;
    }

    const intent = previewTransform(
      { kind: 'move', interactionId: interactionId(), start: { x: 0, y: 0 }, targets },
      delta,
      {},
    );

    if (intent?.kind !== 'move') {
      return false;
    }

    const changes = intent.changes.map((change) => {
      const object = index.get(change.id);
      return object?.kind === 'connector'
        ? { ...change, connection: translateConnection(object.connection, intent.delta) }
        : change;
    });
    onEditIntent({ ...intent, changes, ...(props.nudgeSave && { nudgeSelection: selection }) });
    return true;
  }

  function queueNudge(scope: CanvasNudgeScope, step: CanvasPoint) {
    if (!sameIds(selection, scope.selection)) {
      return;
    }

    const batch = nudges.current;
    if (
      batch &&
      sameIds(batch.selection, scope.selection) &&
      sameIds(batch.targets, scope.targets)
    ) {
      batch.steps.push(step);
    } else {
      nudges.current = { ...scope, steps: [step] };
    }
  }

  const flushNudges = useEffectEvent(() => {
    const batch = nudges.current;
    const saved = props.nudgeSave;
    if (!batch) {
      return;
    }

    const validScope = sameIds(batch.selection, selection) && !props.presentation;
    const valid = saved && saved.kind !== 'idle' && validScope;
    if (!valid) {
      nudges.current = undefined;
      return;
    }
    if (saved.kind !== 'confirmed' || props.scene.revision < saved.revision) {
      return;
    }
    if (batch.lastSubmittedAt === saved.revision) {
      return;
    }

    const step = batch.steps.shift();
    const canSubmit = canEdit && !active.current && step;
    batch.lastSubmittedAt = saved.revision;
    const submitted = canSubmit && submitNudge(step, batch.targets);
    if (!submitted || batch.steps.length === 0) {
      nudges.current = undefined;
    }
  });
  useLayoutEffect(() => {
    flushNudges();
  }, [
    canEdit,
    index,
    pending,
    props.nudgeSave,
    props.presentation,
    props.scene.revision,
    selection,
  ]);

  function handleArrowKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    const direction = keyboardDirections.get(event.key);
    if (!direction || props.presentation || active.current) {
      return false;
    }

    event.preventDefault();
    const step = event.shiftKey ? keyboardFastStep : 1;
    const delta = { x: direction.x * step, y: direction.y * step };
    const saving = props.nudgeSave;
    const hasSelection = selection.length > 0;
    const waitingForScene = saving?.kind === 'confirmed' && props.scene.revision < saving.revision;
    if (hasSelection && saving?.kind === 'saving') {
      queueNudge(saving, delta);
    } else if (hasSelection && waitingForScene) {
      if (saving.scope) {
        queueNudge(saving.scope, delta);
      }
    } else if (hasSelection && (canEdit || pending.size > 0)) {
      if (canEdit) {
        submitNudge(delta);
      }
    } else {
      props.onViewportNavigation?.('pan');
      const offset = { x: -delta.x * keyboardPanFactor, y: -delta.y * keyboardPanFactor };
      update({ viewport: panViewport(read().viewport, offset) }, 'now');
    }
    return true;
  }

  function spacePanKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    const space = event.code === 'Space' || event.key === ' ';
    return space && !isCanvasActivationControl(event.target, event.currentTarget);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.key === 'Process') {
      return;
    }

    const { target, currentTarget } = event;
    if (!ownsEvent(target, currentTarget) || isCanvasKeyboardControl(target, currentTarget)) {
      return;
    }

    const native = canvasNativeId(target, currentTarget);
    if (native) {
      const modified = event.altKey || event.ctrlKey || event.metaKey;
      if (!props.presentation && !modified && spacePanKey(event)) {
        event.preventDefault();
        updateSpace(true);
      } else {
        escapeNativeDocument(event, native);
      }
      return;
    }

    if (handleNavigationKey(event) || handleArrowKey(event)) {
      return;
    }

    if (event.key === 'Escape') {
      escapeCanvas(event);
    } else if (event.key === 'Enter' || event.key === 'F2') {
      editSelected(event);
    } else if (spacePanKey(event)) {
      event.preventDefault();
      updateSpace(true);
    }
  }

  function handleKeyUp(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (
      (event.code === 'Space' || event.key === ' ') &&
      ownsEvent(event.target, event.currentTarget)
    ) {
      clearSpace();
    }
  }

  const onWheel = useEffectEvent((event: WheelEvent, element: HTMLDivElement) => {
    if (event.defaultPrevented || !ownsEvent(event.target, element)) {
      return;
    }

    const zoom = event.ctrlKey || event.metaKey;
    if (!zoom && canvasNativeId(event.target, element)) {
      return;
    }

    event.preventDefault();
    if (active.current) {
      return;
    }

    const { viewport, placementHover } = read();
    if (zoom) {
      const point = relativePoint(event, containerOrigin(element));
      const factor = wheelZoomFactor(event.deltaY, event.deltaMode);
      if (factor !== 1) {
        props.onViewportNavigation?.('zoom');
      }
      update({
        viewport: zoomViewport(viewport, point, factor),
        continuousZoom: true,
        placementHover,
      });
    } else {
      const delta = wheelDelta(event, size);
      if (delta.x !== 0 || delta.y !== 0) {
        props.onViewportNavigation?.('pan');
      }
      update({ viewport: panViewport(viewport, { x: -delta.x, y: -delta.y }), placementHover });
    }
  });

  const onWindowBlur = useEffectEvent(() => {
    clearSpace();
    cancel();
  });

  const onDocumentCaptureLost = useEffectEvent(({ pointerId }: PointerEvent) => {
    const session = active.current;
    if (session?.pointerId === pointerId && !session.captureTarget.isConnected) {
      cancel();
    }
  });

  useEffect(() => {
    const element = root.current;
    if (!element) {
      return;
    }

    const container = element;
    const owner = element.ownerDocument;
    const view = owner.defaultView;
    function handleWheel(event: WheelEvent) {
      onWheel(event, container);
    }
    function handleWindowBlur() {
      onWindowBlur();
    }
    function handleCaptureLost(event: PointerEvent) {
      onDocumentCaptureLost(event);
    }

    element.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    view?.addEventListener('blur', handleWindowBlur);
    owner.addEventListener('lostpointercapture', handleCaptureLost, true);

    return () => {
      element.removeEventListener('wheel', handleWheel, true);
      view?.removeEventListener('blur', handleWindowBlur);
      owner.removeEventListener('lostpointercapture', handleCaptureLost, true);
    };
  }, [root]);

  return {
    toolKind,
    draftForFrame,
    pointerActive: pointerAction !== undefined,
    temporaryPan: spaceActive || pointerAction === 'pan' || objectNavigation.panning,
    cancel,
    clearSpace,
    handlePointerDownCapture,
    handlePointerDown,
    handleDoubleClick,
    handleContextMenu,
    handleObjectNavigation,
    handleHandlePointerDown,
    handlePortPointerDown,
    handleConnectorPointerDown,
    handlePointerMove,
    handlePointerLeave,
    handlePointerUp,
    handlePointerCancel,
    handleKeyDown,
    handleKeyUp,
  };
}
