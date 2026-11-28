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
import { builtInFrame } from './adapters/index.js';
import { useActiveObjectZoom, useCanvasCamera, useCanvasDetailZoom } from './canvas-camera.js';
import { useCanvasDrafts } from './canvas-drafts.js';
import { canvasNativeId } from './canvas-events.js';
import { useCanvasFrame, useCanvasSize } from './canvas-frame.js';
import { useCanvasGesturePreview } from './canvas-gesture-preview.js';
import { useCanvasInput } from './canvas-input.js';
import { selectionControls, useCanvasModel } from './canvas-model.js';
import { createCanvasObjectRegistry } from './canvas-registry.js';
import { useCanvasRenderActions } from './canvas-render-actions.js';
import { canvasCaptionLayout } from './canvas-section-captions.js';
import type {
  CanvasFitScope,
  CanvasObjectActivation,
  CanvasObjectRegistry,
  CanvasProps,
  CanvasViewportRequest,
  CanvasViewportSize,
} from './contracts.js';
import { CanvasOverlays } from './overlays/index.js';
import { CanvasObjects } from './rendering/index.js';
import { createCanvasObjectStore } from './rendering/object-store.js';
import { isObjectLocked, projectedObjectBounds, projectObject } from './scene/index.js';
import type { ProjectedCanvasObject } from './scene/index.js';
import type { SceneIndex } from './scene/index.js';
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

function availableFormatRequest(props: CanvasProps, input: ReturnType<typeof useCanvasInput>) {
  const selecting = input.toolKind === 'select' && !input.temporaryPan;
  const blocked = props.presentation || props.annotationActive || input.pointerActive;

  return props.canEdit && selecting && !blocked ? props.formatObjectRequest : undefined;
}

function activeSelectionViews(
  index: SceneIndex,
  registry: CanvasObjectRegistry,
  selection: readonly string[],
  input: ReturnType<typeof useCanvasInput>,
) {
  const active = input.toolKind === 'select' && !input.pointerActive;
  const id = active && selection.length === 1 ? selection[0] : undefined;
  const kind = id ? index.get(id)?.kind : undefined;
  const extension = kind && registry.get(kind);
  const activeEmbedId = extension?.capabilities.content === 'embedded' ? id : undefined;
  const hasZoomFrame = kind && builtInFrame(kind)?.usesZoom;
  const activeSelectedZoomId = extension?.View || hasZoomFrame ? id : undefined;

  return { activeEmbedId, activeSelectedZoomId };
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
  const { grid, world, present } = useCanvasCamera();
  const controller = useCanvasFrame(root, initialViewport, present);
  const focusedId = presentation?.focusObjectId;
  const { frame, viewportRequestId, read, update } = controller;
  const request = props.viewportRequest;
  const restoringViewport =
    request && 'viewport' in request && request.requestId !== viewportRequestId;
  const modelFrame = restoringViewport ? { viewport: normalizeViewport(request.viewport) } : frame;
  const detailZoom = useCanvasDetailZoom(root, modelFrame.viewport.zoom, modelFrame.continuousZoom);
  useLayoutEffect(() => present(read().viewport), [focusedId, present, read]);
  useCanvasGesturePreview(frame.preview, props.onGesturePreviewChange, canEdit);
  const { index, pending, selected, painted, visibleIds, projectedMove, presentationIds } =
    useCanvasModel(props, modelFrame, size, focusedId ?? retainedId, retainedIds, registry);
  const [movePreview] = useState(() => createCanvasObjectStore<ProjectedCanvasObject>());
  const [payloads] = useState(() => createCanvasObjectStore(props.payloadById));
  useLayoutEffect(() => movePreview.update(projectedMove), [movePreview, projectedMove]);
  useLayoutEffect(() => payloads.update(props.payloadById), [payloads, props.payloadById]);
  const visibleInMode = useMemo(
    () => (focusedId ? [focusedId] : visibleIds),
    [focusedId, visibleIds],
  );

  function fittedViewport(ids: readonly string[], maxZoom?: number, viewportSize = size) {
    const bounds = ids.flatMap((id) => {
      const item = projectObject(index, pending, id);

      return item ? [projectedObjectBounds(item)] : [];
    });
    const target = mergeRects(bounds);
    if (!target || viewportSize.width <= 0 || viewportSize.height <= 0) {
      return undefined;
    }

    return fitViewport(
      target,
      viewportSize,
      presentation ? presentationPadding : fitPadding,
      maxZoom,
    );
  }

  function resolveSceneFit(scope: CanvasFitScope) {
    if (presentation) {
      const ids = presentationIds ?? props.scene.objects.map(({ id }) => id);

      return fittedViewport([...ids], MAX_ZOOM, root.current?.getBoundingClientRect());
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
  const actions = useCanvasRenderActions(props, input.handleObjectNavigation);
  const localDraft = input.draftForFrame(frame);
  const drafts = useCanvasDrafts(props.pendingEdits, localDraft, { index, pending });
  const selecting = input.toolKind === 'select';
  const controls = selectionControls(
    selecting && !input.temporaryPan ? selected : [],
    index,
    pending,
    registry,
    canEdit,
    props.pendingResizeObjectId,
  );
  const { activeEmbedId, activeSelectedZoomId } = activeSelectionViews(
    index,
    registry,
    props.selection,
    input,
  );
  const previousVisible = useRef<readonly string[] | undefined>(undefined);
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
    if (!request || viewportRequestId === request.requestId) {
      return;
    }

    const viewport = requestedViewport(request);
    if (!viewport) {
      return;
    }

    input.cancel('frame');
    controller.applyViewportRequest(request.requestId, viewport);
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

    if (initialViewport || props.viewportRequest) {
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

  const isLocked = useCallback((id: string) => isObjectLocked(index, id), [index]);
  const overviewTitles = useMemo(
    () => canvasCaptionLayout(index, painted, detailZoom),
    [index, painted, detailZoom],
  );
  const activeZoomIds = useMemo(() => {
    const ids = new Set(retainedIds);
    for (const id of [
      retainedId,
      activeSelectedZoomId,
      focusedId,
      presentation?.expandedObjectId,
    ]) {
      if (id) {
        ids.add(id);
      }
    }

    return ids;
  }, [retainedIds, retainedId, activeSelectedZoomId, focusedId, presentation?.expandedObjectId]);
  const activeZoom = useActiveObjectZoom(
    props.scene.objects,
    activeZoomIds,
    modelFrame.viewport.zoom,
    props.contentTracking,
  );

  return (
    <div
      ref={root}
      role="region"
      aria-label={label}
      tabIndex={0}
      className="studio-canvas"
      data-canvas-root={props.viewId}
      data-tool={input.toolKind}
      data-canvas-annotating={props.annotationActive}
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
        ref={grid}
        className="studio-canvas__background"
        style={{
          backgroundImage: props.showGrid === false || focusedId ? 'none' : undefined,
        }}
        aria-hidden="true"
      />
      <div
        ref={world}
        className="studio-canvas__world"
        data-canvas-focus={focusedId}
        inert={input.toolKind !== 'select'}
      >
        <CanvasObjects
          objects={painted}
          movePreview={movePreview}
          contentById={props.contentById}
          drafts={drafts}
          zoom={detailZoom}
          sectionCaptionWidths={overviewTitles.sectionWidths}
          embedCaptionPlacements={overviewTitles.embedPlacements}
          activeZoom={activeZoom}
          activeZoomIds={activeZoomIds}
          activeEmbedId={activeEmbedId}
          registry={registry}
          payloads={payloads}
          selection={props.selection}
          viewing={Boolean(presentation)}
          presentationIds={presentationIds}
          backgroundZoom={presentation?.returnViewport?.zoom}
          focusObjectId={focusedId}
          expandedObjectId={presentation?.expandedObjectId}
          canEdit={canEdit}
          canEditExpandedObject={props.canEditExpandedObject}
          editRequest={editRequest}
          formatObjectRequest={availableFormatRequest(props, input)}
          readHtmlSource={props.readHtmlSource}
          downloadFile={props.downloadFile}
          readDocumentAsset={props.readDocumentAsset}
          uploadDocumentImage={props.uploadDocumentImage}
          onOpenNativeSource={actions.onOpenNativeSource}
          nativeSourceLabel={props.nativeSourceLabel}
          nativeSourceRequest={props.nativeSourceRequest}
          annotationActive={props.annotationActive}
          hasContentEditPermission={props.hasContentEditPermission}
          onAnnotateContent={actions.onAnnotateContent}
          contentTracking={props.contentTracking}
          isLocked={isLocked}
          canWriteObject={actions.canWriteObject}
          onObjectIntent={actions.onObjectIntent}
          onOpenPresentation={actions.onOpenPresentation}
          onClosePresentation={actions.onClosePresentation}
          onObjectNavigation={actions.onObjectNavigation}
          onObjectRetentionChange={handleRetention}
          onObjectEditingChange={actions.onObjectEditingChange}
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
