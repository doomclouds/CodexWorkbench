import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react';
import type { CanvasFrame, CanvasFrameController } from './canvas-frame.js';
import { editableTarget, isCurrentEdit } from './canvas-model.js';
import type {
  CanvasObjectChange,
  CanvasPoint,
  CanvasProps,
  CanvasRect,
  CanvasTool,
  CanvasViewport,
} from './contracts.js';
import { previewTransform } from './gestures/index.js';
import type { ResizeHandle, TransformGesture } from './gestures/index.js';
import { queryScene } from './scene/index.js';
import type { SceneIndex } from './scene/index.js';
import { hitTest, marqueeSelection, selectObject } from './selection/index.js';
import { panViewport, screenToBoard, zoomViewport } from './viewport/index.js';
import type { CanvasViewportSize } from './viewport/index.js';

type PointerSample = Pick<PointerEvent, 'clientX' | 'clientY' | 'pointerId'>;
type TransformHandle = ResizeHandle | 'rotate';
type EditChanges = ReadonlyMap<string, CanvasObjectChange>;
type PointerAction =
  | { kind: 'pan' }
  | { kind: 'marquee'; selection: readonly string[] }
  | { kind: 'transform'; transform: TransformGesture };

interface PointerSession {
  pointerId: number;
  origin: CanvasPoint;
  start: CanvasPoint;
  viewport: CanvasViewport;
  tool: CanvasTool;
  action: PointerAction;
}

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
const dragThreshold = 4;
const wheelLineSize = 16;
const wheelZoomRate = 0.002;
const keyboardZoomFactor = 1.2;

function elementTarget(target: EventTarget | null, container: HTMLDivElement) {
  const ElementType = container.ownerDocument.defaultView?.Element;
  if (ElementType && target instanceof ElementType && container.contains(target)) {
    return target;
  }

  return undefined;
}

function ownsEvent(target: EventTarget | null, container: HTMLDivElement) {
  return elementTarget(target, container)?.closest('[data-canvas-root]') === container;
}

export function canvasNativeId(target: EventTarget | null, container: HTMLDivElement) {
  const element = elementTarget(target, container);
  let native = element?.closest('[data-canvas-native]');
  while (native && native.closest('[data-canvas-root]') !== container) {
    native = native.parentElement?.closest('[data-canvas-native]');
  }

  return native?.closest('[data-canvas-object]')?.getAttribute('data-canvas-object') ?? undefined;
}

function relativePoint(sample: Pick<PointerEvent, 'clientX' | 'clientY'>, origin: CanvasPoint) {
  return { x: sample.clientX - origin.x, y: sample.clientY - origin.y };
}

function containerOrigin(container: HTMLDivElement) {
  const { left, top } = container.getBoundingClientRect();

  return { x: left, y: top };
}

function deltaFrom(start: CanvasPoint, point: CanvasPoint) {
  return { x: point.x - start.x, y: point.y - start.y };
}

function reachedThreshold(start: CanvasPoint, point: CanvasPoint) {
  const { x, y } = deltaFrom(start, point);

  return Math.hypot(x, y) >= dragThreshold;
}

function marqueeBounds(start: CanvasPoint, point: CanvasPoint): CanvasRect {
  return {
    x: Math.min(start.x, point.x),
    y: Math.min(start.y, point.y),
    width: Math.abs(start.x - point.x),
    height: Math.abs(start.y - point.y),
  };
}

function frameAt(session: PointerSession, screen: CanvasPoint): CanvasFrame {
  const { start, viewport, action } = session;
  if (action.kind === 'pan') {
    return { viewport: panViewport(viewport, deltaFrom(start, screen)) };
  }
  if (!reachedThreshold(start, screen)) {
    return { viewport };
  }

  const point = screenToBoard(screen, viewport);
  if (action.kind === 'marquee') {
    const startPoint = screenToBoard(start, viewport);

    return { viewport, marquee: marqueeBounds(startPoint, point) };
  }

  return { viewport, preview: previewTransform(action.transform, point) };
}

function wheelDelta(event: WheelEvent, size: CanvasViewportSize): CanvasPoint {
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return { x: event.deltaX * size.width, y: event.deltaY * size.height };
  }

  const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? wheelLineSize : 1;

  return { x: event.deltaX * scale, y: event.deltaY * scale };
}

export function useCanvasInput({ root, size, index, pending, frame, props }: CanvasInputOptions) {
  const active = useRef<PointerSession | null>(null);
  const spaceHeld = useRef(false);
  const nextInteraction = useRef(0);
  const instanceId = useId();
  const { tool, canEdit, selection, onSelectionChange, onEditIntent, viewId } = props;
  const { read, update } = frame;

  function begin(
    container: HTMLDivElement,
    sample: PointerSample,
    origin: CanvasPoint,
    action: PointerAction,
  ) {
    const viewport = read().viewport;
    active.current = {
      pointerId: sample.pointerId,
      origin,
      start: relativePoint(sample, origin),
      viewport,
      tool,
      action,
    };
    container.setPointerCapture?.(sample.pointerId);
  }

  function end(session: PointerSession) {
    active.current = null;
    const element = root.current;
    if (element?.hasPointerCapture?.(session.pointerId)) {
      element.releasePointerCapture(session.pointerId);
    }
  }

  function cancel(timing: 'now' | 'frame' = 'now') {
    const session = active.current;
    if (session) {
      end(session);
      update({ viewport: read().viewport }, timing);
    }
  }

  function clearSpace() {
    spaceHeld.current = false;
  }

  function currentSession(session: PointerSession) {
    if (session.tool !== tool) {
      return false;
    }
    if (session.action.kind !== 'transform') {
      return true;
    }

    return canEdit && isCurrentEdit(index, pending, session.action.transform.targets);
  }

  const cancelStaleSession = useEffectEvent(() => {
    const session = active.current;
    if (session && !currentSession(session)) {
      cancel('frame');
    }
  });
  useLayoutEffect(() => {
    cancelStaleSession();
  }, [canEdit, index, pending, tool]);

  function beginTransform(
    container: HTMLDivElement,
    sample: PointerSample,
    origin: CanvasPoint,
    ids: readonly string[],
    kind: TransformGesture['kind'],
    handle?: ResizeHandle,
  ) {
    if (!canEdit) {
      return;
    }

    const targets = ids.flatMap((id) => {
      const object = editableTarget(index, pending, id);

      return object ? [{ id, expectedVersion: object.version, geometry: object.geometry }] : [];
    });

    if (targets.length === 0) {
      return;
    }

    nextInteraction.current += 1;
    const start = screenToBoard(relativePoint(sample, origin), read().viewport);
    begin(container, sample, origin, {
      kind: 'transform',
      transform: {
        kind,
        interactionId: viewId + ':' + instanceId + ':' + nextInteraction.current,
        start,
        targets,
        handle,
      },
    });
  }

  function beginSelection(
    container: HTMLDivElement,
    event: ReactPointerEvent<HTMLDivElement>,
    origin: CanvasPoint,
  ) {
    const point = screenToBoard(relativePoint(event, origin), read().viewport);
    const hits = queryScene(index, { ...point, width: 0, height: 0 }, pending);
    const id = hitTest(hits, point);
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
    const selected = held ? selection : selectObject(selection, id, toggle);
    if (!held) {
      onSelectionChange(selected);
    }
    if (!toggle && editableTarget(index, pending, id)) {
      beginTransform(container, event, origin, selected, 'move');
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (active.current || event.defaultPrevented) {
      return;
    }
    if (event.button !== primaryButton && event.button !== middleButton) {
      return;
    }
    if (event.pointerType === 'touch' && !event.isPrimary) {
      return;
    }

    const container = event.currentTarget;
    if (!ownsEvent(event.target, container)) {
      return;
    }

    const pan = event.button === middleButton || tool === 'pan' || spaceHeld.current;
    const native = canvasNativeId(event.target, container);
    if (native && !pan) {
      if (!selection.includes(native)) {
        onSelectionChange([native]);
      }
      return;
    }

    event.preventDefault();
    container.focus({ preventScroll: true });
    const origin = containerOrigin(container);
    if (pan) {
      begin(container, event, origin, { kind: 'pan' });
    } else {
      beginSelection(container, event, origin);
    }
  }

  function handleHandlePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    id: string,
    handle: TransformHandle,
  ) {
    const container = root.current;
    if (!container || active.current) {
      return;
    }
    if (event.pointerType === 'touch' && !event.isPrimary) {
      return;
    }

    event.preventDefault();
    container.focus({ preventScroll: true });
    const origin = containerOrigin(container);
    if (tool === 'pan' || spaceHeld.current) {
      begin(container, event, origin, { kind: 'pan' });
    } else if (handle === 'rotate') {
      beginTransform(container, event, origin, [id], 'rotate');
    } else {
      beginTransform(container, event, origin, [id], 'resize', handle);
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const session = active.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    if (!ownsEvent(event.target, event.currentTarget)) {
      return;
    }

    if (!currentSession(session)) {
      cancel();
      return;
    }

    update(frameAt(session, relativePoint(event, session.origin)));
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const session = active.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    if (!ownsEvent(event.target, event.currentTarget)) {
      return;
    }

    if (!currentSession(session)) {
      cancel();
      return;
    }

    const next = frameAt(session, relativePoint(event, session.origin));
    end(session);
    update({ viewport: next.viewport }, 'now');
    if (session.action.kind === 'marquee' && next.marquee) {
      const objects = queryScene(index, next.marquee, pending);
      onSelectionChange(marqueeSelection(objects, next.marquee, session.action.selection));
    }
    if (next.preview) {
      onEditIntent(next.preview);
    }
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
    if (!ownsEvent(event.target, event.currentTarget)) {
      return;
    }
    if (canvasNativeId(event.target, event.currentTarget)) {
      return;
    }

    const modified = event.ctrlKey || event.metaKey || event.altKey;
    if (modified) {
      return;
    }

    if (event.key === 'Escape' && active.current) {
      event.preventDefault();
      cancel();
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
    if (!zoom && tool !== 'pan' && native) {
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
    cancel,
    clearSpace,
    handlePointerDown,
    handleHandlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handleKeyDown,
    handleKeyUp,
  };
}
