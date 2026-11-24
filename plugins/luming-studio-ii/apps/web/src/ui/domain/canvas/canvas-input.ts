import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react';

import { canConnectTo, connectionTarget, recordInk } from './canvas-creation.js';
import {
  canvasNativeId,
  canvasSectionTitleId,
  containerOrigin,
  ownsEvent,
  relativePoint,
  wheelDelta,
} from './canvas-events.js';
import type { CanvasFrame, CanvasFrameController } from './canvas-frame.js';
import { gestureFrame } from './canvas-gesture-frame.js';
import type { PointerAction, PointerSession } from './canvas-gesture-frame.js';
import { editableTarget, isCurrentEdit } from './canvas-model.js';
import { connectionHandleBends } from './connectors/handles.js';
import type {
  CanvasConnectionEndpoint,
  CanvasObjectChange,
  CanvasPoint,
  CanvasProps,
  CanvasTool,
} from './contracts.js';
import type { ResizeHandle, TransformGesture } from './gestures/index.js';
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

type PointerSample = Pick<PointerEvent, 'clientX' | 'clientY' | 'pointerId'>;
type TransformHandle = ResizeHandle | 'rotate';
type EditChanges = ReadonlyMap<string, CanvasObjectChange>;

interface CanvasInputOptions {
  root: RefObject<HTMLDivElement | null>;
  size: CanvasViewportSize;
  index: SceneIndex;
  pending: EditChanges;
  frame: CanvasFrameController;
  props: CanvasProps;
}

const primaryButton = 0;
const middleButton = 1;
const wheelZoomRate = 0.002;
const keyboardZoomFactor = 1.2;

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

export function useCanvasInput({ root, size, index, pending, frame, props }: CanvasInputOptions) {
  const active = useRef<PointerSession | null>(null);
  const [pointerActive, setPointerActive] = useState(false);
  const spaceHeld = useRef(false);
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
  const { read, update, draw } = frame;
  const key = typeof tool === 'string' ? tool : 'place:' + tool.requestId;
  const [activation, setActivation] = useState({ key, completed: false });
  const settled = useRef<typeof activation | undefined>(undefined);
  if (activation.key !== key) {
    setActivation({ key, completed: false });
  }

  const toolAvailable = tool === 'pan' || (canEdit && !activation.completed);
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

  function begin(
    container: HTMLDivElement,
    sample: PointerSample,
    origin: CanvasPoint,
    action: PointerAction,
  ) {
    active.current = {
      pointerId: sample.pointerId,
      origin,
      start: relativePoint(sample, origin),
      viewport: read().viewport,
      tool: currentTool(),
      action,
    };
    container.setPointerCapture?.(sample.pointerId);
    setPointerActive(true);
  }

  function end(session: PointerSession) {
    active.current = null;
    setPointerActive(false);
    const element = root.current;
    if (element?.hasPointerCapture?.(session.pointerId)) {
      element.releasePointerCapture(session.pointerId);
    }
  }

  function cancel(timing: 'now' | 'frame' = 'now') {
    const session = active.current;
    if (session) {
      end(session);
    }

    update({ viewport: read().viewport }, timing);
  }

  function clearSpace() {
    spaceHeld.current = false;
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
    if (!canEdit) {
      return false;
    }
    if (action.kind === 'transform') {
      return isCurrentEdit(index, pending, action.transform.targets);
    }
    if (action.kind === 'edit-connection') {
      return editableTarget(index, pending, action.target.id)?.version === action.target.version;
    }

    return true;
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
  }, [canEdit, index, pending, key]);

  function beginTransform(
    container: HTMLDivElement,
    sample: ReactPointerEvent<HTMLElement>,
    origin: CanvasPoint,
    kind: TransformGesture['kind'],
    ids: readonly string[],
    handle?: ResizeHandle,
  ) {
    if (!canEdit) {
      return;
    }

    const moves = kind === 'move';
    const duplicate = moves && sample.altKey;
    const candidateIds = moves ? expandMoveIds(index, ids, pending) : ids;
    const targets = candidateIds.flatMap((id) => {
      const object = editableTarget(index, pending, id);
      const projection = object && projectObject(index, pending, id);
      const canTransform = !moves || duplicate || canMove(index, id);
      if (!object || !projection || !canTransform) {
        return [];
      }

      return [{ id, expectedVersion: object.version, geometry: projection.geometry }];
    });

    if (targets.length === 0 || (!moves && targets.length !== ids.length)) {
      return;
    }

    const start = screenToBoard(relativePoint(sample, origin), read().viewport);
    begin(container, sample, origin, {
      kind: 'transform',
      duplicate,
      transform: { kind, interactionId: interactionId(), start, targets, handle },
    });
  }

  function objectAt(
    event: ReactPointerEvent<HTMLElement>,
    container: HTMLDivElement,
    origin: CanvasPoint,
  ) {
    const title = canvasSectionTitleId(event.target, container);
    if (title && index.get(title)?.kind === 'section') {
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
    if (!toggle && editableTarget(index, pending, id)) {
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
      const { endpoint } = connectionTarget(start, viewport.zoom, { index, pending });
      begin(container, event, origin, {
        kind: 'create-connection',
        interactionId: id,
        start: endpoint,
      });
    } else {
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
    const pan = wantsPan(event.button);
    const selecting = chosenTool === 'select' && !pan;
    const id = selecting ? objectAt(event, container, origin) : undefined;
    const native = selecting ? canvasNativeId(event.target, container) : undefined;
    if (native && native === id) {
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

  function handlePointerDownCapture(event: ReactPointerEvent<HTMLDivElement>) {
    if (!wantsPan(event.button)) {
      return;
    }

    handlePointerDown(event);
    if (active.current?.pointerId === event.pointerId && active.current.action.kind === 'pan') {
      event.stopPropagation();
    }
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
    const object = id && index.get(id);
    const validSource = object && canConnectTo(object);
    if (!container || !canEdit || !validSource) {
      return;
    }

    begin(container, event, containerOrigin(container), {
      kind: 'create-connection',
      interactionId: interactionId(),
      start,
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

  function complete(session: PointerSession, next: CanvasFrame) {
    end(session);
    update({ viewport: next.viewport }, 'now');
    if (session.action.kind === 'marquee' && next.marquee) {
      const objects = queryScene(index, next.marquee, pending);
      onSelectionChange(marqueeSelection(objects, next.marquee, session.action.selection));
    }

    const intent = next.preview ?? next.draft;
    if (intent?.kind === 'create') {
      exitDrawingTool();
    }
    if (intent) {
      onEditIntent(intent);
    }
  }

  function sampleGesture(
    session: PointerSession,
    event: ReactPointerEvent<HTMLDivElement>,
    final: boolean,
  ) {
    const screen = relativePoint(event, session.origin);
    const modifiers = { altKey: event.altKey, shiftKey: event.shiftKey };
    const { action, viewport } = session;
    if (action.kind === 'ink') {
      const point = screenToBoard(screen, viewport);
      recordInk(action, point, viewport.zoom, event.shiftKey, final);
    }

    const resolve = () => gestureFrame(session, screen, modifiers, { index, pending, size });

    if (final || (action.kind === 'ink' && action.samples.length >= maxInkSamples)) {
      complete(session, resolve());
    } else {
      draw(resolve);
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!ownsEvent(event.target, event.currentTarget)) {
      return;
    }

    const session = active.current;
    if (!session) {
      if (currentTool() === 'connector') {
        hoverPorts(event);
      }

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

  function hoverPorts(event: ReactPointerEvent<HTMLDivElement>) {
    const screen = relativePoint(event, containerOrigin(event.currentTarget));
    const { viewport } = read();
    draw(() => {
      const point = screenToBoard(screen, viewport);
      const { ports, activePort } = connectionTarget(point, viewport.zoom, { index, pending });

      return { viewport, ports, activePort };
    });
  }

  function handlePointerLeave() {
    if (!active.current && currentTool() === 'connector') {
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

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.nativeEvent.isComposing) {
      return;
    }
    if (
      !ownsEvent(event.target, event.currentTarget) ||
      canvasNativeId(event.target, event.currentTarget)
    ) {
      return;
    }

    const modified = event.ctrlKey || event.metaKey || event.altKey;
    if (modified) {
      return;
    }

    const toolNow = currentTool();
    const drawingTool = toolNow !== 'select' && toolNow !== 'pan';
    if (event.key === 'Escape' && (active.current || drawingTool)) {
      event.preventDefault();
      cancel();
      exitDrawingTool();
    }
    if (event.key === ' ') {
      event.preventDefault();
      spaceHeld.current = true;
    }
    if (event.key === '+' || event.key === '=' || event.key === '-') {
      event.preventDefault();
      cancel();
      const anchor = { x: size.width / 2, y: size.height / 2 };
      const factor = event.key === '-' ? 1 / keyboardZoomFactor : keyboardZoomFactor;
      update({ viewport: zoomViewport(read().viewport, anchor, factor) }, 'now');
    }
  }

  function handleKeyUp(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === ' ' && ownsEvent(event.target, event.currentTarget)) {
      clearSpace();
    }
  }

  const onWheel = useEffectEvent((event: WheelEvent, element: HTMLDivElement) => {
    const zoom = event.ctrlKey || event.metaKey;
    const native = canvasNativeId(event.target, element);
    if (event.defaultPrevented || !ownsEvent(event.target, element)) {
      return;
    }
    if (!zoom && currentTool() === 'select' && native) {
      return;
    }

    event.preventDefault();
    if (active.current) {
      return;
    }

    const delta = wheelDelta(event, size);
    const { viewport } = read();
    if (zoom) {
      const point = relativePoint(event, containerOrigin(element));
      update({ viewport: zoomViewport(viewport, point, Math.exp(-delta.y * wheelZoomRate)) });
    } else {
      update({ viewport: panViewport(viewport, { x: -delta.x, y: -delta.y }) });
    }
  });

  const onWindowBlur = useEffectEvent(() => {
    clearSpace();
    cancel();
  });

  useEffect(() => {
    const element = root.current;
    if (!element) {
      return;
    }

    const container = element;
    const view = element.ownerDocument.defaultView;
    function handleWheel(event: WheelEvent) {
      onWheel(event, container);
    }
    function handleWindowBlur() {
      onWindowBlur();
    }

    element.addEventListener('wheel', handleWheel, { passive: false });
    view?.addEventListener('blur', handleWindowBlur);

    return () => {
      element.removeEventListener('wheel', handleWheel);
      view?.removeEventListener('blur', handleWindowBlur);
    };
  }, [root]);

  return {
    toolKind,
    pointerActive,
    cancel,
    clearSpace,
    handlePointerDownCapture,
    handlePointerDown,
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
