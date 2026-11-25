import {
  useCallback,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { FocusEvent } from 'react';
import { useCanvasDrafts } from './canvas-drafts.js';
import { canvasNativeId } from './canvas-events.js';
import { useCanvasFrame, useCanvasSize } from './canvas-frame.js';
import { useCanvasInput } from './canvas-input.js';
import { selectionControls, useCanvasModel } from './canvas-model.js';
import { createCanvasObjectRegistry } from './canvas-registry.js';
import type { CanvasObjectActivation, CanvasProps, CanvasViewportRequest } from './contracts.js';
import { CanvasOverlays } from './overlays/index.js';
import { CanvasObjects } from './rendering/index.js';
import { isObjectLocked, projectedObjectBounds, projectObject } from './scene/index.js';
import { fitViewport, mergeRects, normalizeViewport } from './viewport/index.js';
import './Canvas.css';

const fitPadding = 40;

function sameIds(previous: readonly string[] | undefined, next: readonly string[]) {
  if (!previous || previous.length !== next.length) {
    return false;
  }

  return previous.every((id, index) => id === next[index]);
}

function CanvasSession(props: CanvasProps) {
  const { label, canEdit, initialViewport, onViewportChange, onVisibleObjectsChange, ref } = props;
  const root = useRef<HTMLDivElement>(null);
  const size = useCanvasSize(root);
  const [retainedId, setRetainedId] = useState<string>();
  const [retainedIds, setRetainedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [editRequest, setEditRequest] = useState<{ id: string; sequence: number }>();
  const nextEditSequence = useRef(0);
  const handleRetention = useCallback((id: string, retain: boolean) => {
    if (!retain) {
      setEditRequest((current) => (current?.id === id ? undefined : current));
    }

    setRetainedIds((held) => {
      if (held.has(id) === retain) {
        return held;
      }

      const next = new Set(held);
      if (retain) {
        next.add(id);
      } else {
        next.delete(id);
      }

      return next;
    });
  }, []);
  const registry = useMemo(
    () => createCanvasObjectRegistry(props.objectExtensions),
    [props.objectExtensions],
  );
  const controller = useCanvasFrame(root, initialViewport);
  const { frame, update } = controller;
  const { index, pending, selected, painted, visibleIds } = useCanvasModel(
    props,
    frame,
    size,
    retainedId,
    retainedIds,
    registry,
  );
  const input = useCanvasInput({
    root,
    size,
    index,
    pending,
    registry,
    frame: controller,
    props: { ...props, onObjectActivate: activateObject },
  });
  const drafts = useCanvasDrafts(props.pendingEdits, canEdit ? frame.draft : undefined, {
    index,
    pending,
  });
  const selecting = input.toolKind === 'select';
  const controls = selectionControls(selected, index, pending, registry, canEdit && selecting);
  const activeEmbedId =
    selecting && !input.pointerActive && props.selection.length === 1
      ? props.selection[0]
      : undefined;
  const previousVisible = useRef<readonly string[] | undefined>(undefined);
  const appliedViewportRequest = useRef<string | undefined>(undefined);
  const observeVisible = useEffectEvent((ids: readonly string[]) => onVisibleObjectsChange?.(ids));
  const observeViewport = useEffectEvent(onViewportChange ?? (() => undefined));
  const applyViewportRequest = useEffectEvent((request: CanvasViewportRequest | undefined) => {
    if (!request || appliedViewportRequest.current === request.requestId) {
      return;
    }

    appliedViewportRequest.current = request.requestId;
    input.cancel('frame');
    update({ viewport: normalizeViewport(request.viewport) });
  });

  useLayoutEffect(() => {
    applyViewportRequest(props.viewportRequest);
  }, [props.viewportRequest]);

  useEffect(() => {
    if (sameIds(previousVisible.current, visibleIds)) {
      return;
    }

    previousVisible.current = visibleIds;
    observeVisible(visibleIds);
  }, [visibleIds]);

  useEffect(() => {
    observeViewport(frame.viewport);
  }, [frame.viewport]);

  function focus() {
    root.current?.focus({ preventScroll: true });
  }

  function activateObject(activation: CanvasObjectActivation) {
    nextEditSequence.current += 1;
    setEditRequest({ id: activation.id, sequence: nextEditSequence.current });
    props.onObjectActivate?.(activation);
  }

  function fitToObjects(ids: readonly string[]) {
    const bounds = ids.flatMap((id) => {
      const item = projectObject(index, pending, id);

      return item ? [projectedObjectBounds(item)] : [];
    });
    const target = mergeRects(bounds);
    if (!target || size.width <= 0 || size.height <= 0) {
      return;
    }

    input.cancel();
    update({ viewport: fitViewport(target, size, fitPadding) }, 'now');
  }

  useImperativeHandle(ref, () => ({ focus, fitToObjects }));

  function handleFocus(event: FocusEvent<HTMLDivElement>) {
    setRetainedId(canvasNativeId(event.target, event.currentTarget));
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    const nextNative = canvasNativeId(event.relatedTarget, event.currentTarget);
    setRetainedId(nextNative);
    if (nextNative) {
      input.clearSpace();
    }
    if (!event.currentTarget.contains(event.relatedTarget)) {
      input.clearSpace();
      input.cancel();
    }
  }

  const { x, y, zoom } = frame.viewport;
  const transform = `translate(${x}px, ${y}px) scale(${zoom})`;

  return (
    <div
      ref={root}
      role="region"
      aria-label={label}
      tabIndex={0}
      className="studio-canvas"
      data-canvas-root={props.viewId}
      data-tool={input.toolKind}
      onPointerDownCapture={input.handlePointerDownCapture}
      onPointerDown={input.handlePointerDown}
      onDoubleClick={input.handleDoubleClick}
      onPointerMove={input.handlePointerMove}
      onPointerLeave={input.handlePointerLeave}
      onPointerUp={input.handlePointerUp}
      onPointerCancel={input.handlePointerCancel}
      onLostPointerCapture={input.handlePointerCancel}
      onKeyDown={input.handleKeyDown}
      onKeyUp={input.handleKeyUp}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      <div className="studio-canvas__background" aria-hidden="true" />
      <div
        className="studio-canvas__world"
        style={{ transform }}
        inert={input.toolKind !== 'select'}
      >
        <CanvasObjects
          objects={painted}
          contentById={props.contentById}
          drafts={drafts}
          zoom={zoom}
          activeEmbedId={activeEmbedId}
          registry={registry}
          payloadById={props.payloadById}
          selection={props.selection}
          canEdit={canEdit}
          editRequest={editRequest}
          isLocked={(id) => isObjectLocked(index, id)}
          onObjectIntent={props.onObjectIntent}
          onObjectNavigation={input.handleObjectNavigation}
          onObjectRetentionChange={handleRetention}
        />
      </div>
      <CanvasOverlays
        viewport={frame.viewport}
        selected={selected}
        marquee={frame.marquee}
        guides={canEdit ? frame.guides : undefined}
        ports={canEdit ? frame.ports : undefined}
        activePort={canEdit ? frame.activePort : undefined}
        {...controls}
        onHandlePointerDown={input.handleHandlePointerDown}
        onPortPointerDown={input.handlePortPointerDown}
        onConnectorPointerDown={input.handleConnectorPointerDown}
      />
    </div>
  );
}

export function Canvas(props: CanvasProps) {
  return <CanvasSession key={JSON.stringify([props.viewId, props.scene.boardId])} {...props} />;
}
