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
import type {
  CanvasFitScope,
  CanvasObjectActivation,
  CanvasProps,
  CanvasViewportRequest,
  CanvasViewportSize,
} from './contracts.js';
import { CanvasOverlays } from './overlays/index.js';
import { CanvasObjects } from './rendering/index.js';
import { isObjectLocked, projectedObjectBounds, projectObject } from './scene/index.js';
import { expandSelectionIds } from './selection/index.js';
import {
  fitViewport,
  MAX_ZOOM,
  mergeRects,
  normalizeViewport,
  zoomViewport,
} from './viewport/index.js';
import './Canvas.css';

const fitPadding = 72;
const presentationPadding = 48;

function gridSpacing(zoom: number) {
  const spacing = 24 * zoom;

  return spacing >= 8 ? spacing : spacing * 2 ** Math.ceil(Math.log2(8 / spacing));
}

function sameIds(previous: readonly string[] | undefined, next: readonly string[]) {
  if (!previous || previous.length !== next.length) {
    return false;
  }

  return previous.every((id, index) => id === next[index]);
}

function selectionActionSlot(props: CanvasProps, input: ReturnType<typeof useCanvasInput>) {
  const selecting = input.toolKind === 'select' && !input.temporaryPan;
  const visible = selecting && !input.pointerActive && !props.presentation;

  return visible ? props.selectionActions : undefined;
}

function CanvasSession(props: CanvasProps) {
  const {
    label,
    canEdit,
    initialViewport,
    fitOnMount,
    onViewportChange,
    onViewportSizeChange,
    onVisibleObjectsChange,
    presentation,
    ref,
  } = props;
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
  const focusedId = presentation?.focusObjectId;
  const { frame, update } = controller;
  const { index, pending, selected, painted, visibleIds } = useCanvasModel(
    props,
    frame,
    size,
    focusedId ?? retainedId,
    retainedIds,
    registry,
  );
  const presentationIds = useMemo(() => {
    if (focusedId) {
      return new Set([focusedId]);
    }
    if (!presentation || presentation.objectIds.length === 0) {
      return undefined;
    }

    return new Set(expandSelectionIds(index, presentation.objectIds, pending));
  }, [focusedId, presentation, index, pending]);
  const visibleInMode = useMemo(() => {
    if (focusedId) {
      return [focusedId];
    }

    return presentationIds ? visibleIds.filter((id) => presentationIds.has(id)) : visibleIds;
  }, [focusedId, presentationIds, visibleIds]);

  function fittedViewport(ids: readonly string[], maxZoom?: number) {
    const bounds = ids.flatMap((id) => {
      const item = projectObject(index, pending, id);

      return item ? [projectedObjectBounds(item)] : [];
    });
    const target = mergeRects(bounds);
    if (!target || size.width <= 0 || size.height <= 0) {
      return undefined;
    }

    return fitViewport(target, size, presentation ? presentationPadding : fitPadding, maxZoom);
  }

  function resolveSceneFit(scope: CanvasFitScope) {
    if (presentation) {
      const ids = presentationIds ?? props.scene.objects.map(({ id }) => id);

      return fittedViewport([...ids], MAX_ZOOM);
    }

    const selectedIds =
      scope === 'board' ? [] : expandSelectionIds(index, props.selection, pending);
    const ids = selectedIds.length > 0 ? selectedIds : props.scene.objects.map(({ id }) => id);

    return fittedViewport(ids, scope === 'selection' ? MAX_ZOOM : undefined);
  }

  const input = useCanvasInput({
    root,
    size,
    index,
    pending,
    registry,
    frame: controller,
    fitScene: resolveSceneFit,
    props: { ...props, onObjectActivate: activateObject },
  });
  const drafts = useCanvasDrafts(props.pendingEdits, canEdit ? frame.draft : undefined, {
    index,
    pending,
  });
  const selecting = input.toolKind === 'select';
  const controls = selectionControls(
    selecting && !input.temporaryPan ? selected : [],
    index,
    pending,
    registry,
    canEdit,
  );
  const activeEmbedId =
    selecting && !input.pointerActive && props.selection.length === 1
      ? props.selection[0]
      : undefined;
  const previousVisible = useRef<readonly string[] | undefined>(undefined);
  const appliedViewportRequest = useRef<string | undefined>(undefined);
  const openingFitApplied = useRef(false);
  const observeVisible = useEffectEvent((ids: readonly string[]) => onVisibleObjectsChange?.(ids));
  const observeViewport = useEffectEvent(onViewportChange ?? (() => undefined));
  const observeViewportSize = useEffectEvent((value: CanvasViewportSize) =>
    onViewportSizeChange?.(value),
  );

  function requestedViewport(request: CanvasViewportRequest) {
    if ('viewport' in request) {
      return normalizeViewport(request.viewport);
    }
    if ('fit' in request) {
      return resolveSceneFit(request.fit);
    }

    const current = controller.read().viewport;

    return zoomViewport(
      current,
      { x: size.width / 2, y: size.height / 2 },
      request.zoom / current.zoom,
    );
  }

  const applyViewportRequest = useEffectEvent((request: CanvasViewportRequest | undefined) => {
    if (!request || appliedViewportRequest.current === request.requestId) {
      return;
    }

    const viewport = requestedViewport(request);
    if (!viewport) {
      return;
    }

    appliedViewportRequest.current = request.requestId;
    input.cancel('frame');
    update({ viewport });
  });

  useLayoutEffect(() => {
    applyViewportRequest(props.viewportRequest);
  }, [props.viewportRequest, props.scene.objects, size]);

  useEffect(() => {
    if (sameIds(previousVisible.current, visibleInMode)) {
      return;
    }

    previousVisible.current = visibleInMode;
    observeVisible(visibleInMode);
  }, [visibleInMode]);

  useEffect(() => {
    observeViewport(frame.viewport);
  }, [frame.viewport]);

  useEffect(() => {
    observeViewportSize(size);
  }, [size]);

  function focus() {
    root.current?.focus({ preventScroll: true });
  }

  function activateObject(activation: CanvasObjectActivation) {
    requestObjectEdit(activation.id);
    props.onObjectActivate?.(activation);
  }

  function requestObjectEdit(id: string) {
    const object = index.get(id);

    const editable =
      canEdit || (props.canEditExpandedObject && presentation?.expandedObjectId === id);

    if (!editable || !object || props.canWriteObject?.(object.kind) === false) {
      return;
    }

    nextEditSequence.current += 1;

    setEditRequest({ id, sequence: nextEditSequence.current });
  }

  const applyObjectEdit = useEffectEvent((request: CanvasProps['editObjectRequest']) => {
    if (request) {
      requestObjectEdit(request.id);
    }
  });
  useLayoutEffect(() => {
    applyObjectEdit(props.editObjectRequest);
  }, [props.editObjectRequest]);

  function fitObjects(ids: readonly string[], timing: 'now' | 'frame') {
    const viewport = fittedViewport(ids);
    if (!viewport) {
      return false;
    }

    input.cancel(timing);
    update({ viewport }, timing);

    return true;
  }

  function fitToObjects(ids: readonly string[]) {
    fitObjects(ids, 'now');
  }

  useImperativeHandle(ref, () => ({ focus, fitToObjects }));

  const fitOpeningScene = useEffectEvent(() => {
    if (!fitOnMount || openingFitApplied.current) {
      return;
    }

    if (initialViewport || appliedViewportRequest.current !== undefined) {
      openingFitApplied.current = true;
      return;
    }

    openingFitApplied.current = fitObjects(
      props.scene.objects.map(({ id }) => id),
      'frame',
    );
  });
  useLayoutEffect(() => {
    fitOpeningScene();
  }, [fitOnMount, initialViewport, props.scene.objects, props.viewportRequest, size]);

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
  const spacing = gridSpacing(zoom);
  const paintedInMode = presentationIds
    ? painted.filter(({ object }) => presentationIds.has(object.id))
    : painted;

  return (
    <div
      ref={root}
      role="region"
      aria-label={label}
      tabIndex={0}
      className="studio-canvas"
      data-canvas-root={props.viewId}
      data-tool={input.toolKind}
      data-canvas-presentation={presentation ? '' : undefined}
      onPointerDownCapture={input.handlePointerDownCapture}
      onPointerDown={input.handlePointerDown}
      onDoubleClick={input.handleDoubleClick}
      onContextMenu={input.handleContextMenu}
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
      <div
        className="studio-canvas__background"
        style={{
          backgroundImage: props.showGrid === false || focusedId ? 'none' : undefined,
          backgroundPosition: `${x}px ${y}px`,
          backgroundSize: `${spacing}px ${spacing}px`,
        }}
        aria-hidden="true"
      />
      <div
        className="studio-canvas__world"
        style={{ transform: focusedId ? undefined : transform }}
        inert={input.toolKind !== 'select'}
      >
        <CanvasObjects
          objects={paintedInMode}
          contentById={props.contentById}
          drafts={drafts}
          zoom={zoom}
          activeEmbedId={activeEmbedId}
          registry={registry}
          payloadById={props.payloadById}
          selection={props.selection}
          viewing={Boolean(presentation)}
          focusObjectId={focusedId}
          expandedObjectId={presentation?.expandedObjectId}
          canEdit={canEdit}
          canEditExpandedObject={props.canEditExpandedObject}
          editRequest={editRequest}
          readHtmlSource={props.readHtmlSource}
          isLocked={(id) => isObjectLocked(index, id)}
          canWriteObject={props.canWriteObject}
          onObjectIntent={props.onObjectIntent}
          onOpenPresentation={props.onOpenPresentation}
          onClosePresentation={props.onClosePresentation}
          onObjectNavigation={input.handleObjectNavigation}
          onObjectRetentionChange={handleRetention}
        />
      </div>
      <CanvasOverlays
        viewport={frame.viewport}
        viewportSize={size}
        selectionActions={selectionActionSlot(props, input)}
        selected={selecting ? selected : []}
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
