import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type {
  CanvasFitScope,
  CanvasHandle,
  CanvasPoint,
  CanvasViewport,
  CanvasViewportRequest,
  CanvasViewportSize,
} from '../../ui/domain/canvas/index.js';
import { isTodoOverview } from '../../ui/domain/objects/todo/index.js';
import type { WhiteboardReadyState } from '../../data/whiteboard/index.js';
import type { projectScene } from './canvas-projection.js';
import type { BoardViewContext, WhiteboardEditorFeatures } from './board-features.js';
import { useBoardPresentation } from './use-board-presentation.js';

type SceneProjection = NonNullable<ReturnType<typeof projectScene>>;
type BoardViewportChange =
  | { readonly fit: CanvasFitScope }
  | { readonly zoom: number }
  | { readonly viewport: CanvasViewport };

interface BoardViewReporterProps extends BoardViewContext {
  readonly enabled: boolean;
  readonly onViewContext?: WhiteboardEditorFeatures['onViewContext'];
}

export function BoardViewReporter({
  boardId,
  selectedIds,
  viewport: { x, y, zoom },
  focusedObjectId,
  returnViewport,
  enabled,
  onViewContext,
}: BoardViewReporterProps) {
  const publish = useEffectEvent((context: BoardViewContext | undefined) =>
    onViewContext?.(context),
  );
  useEffect(() => {
    publish(
      enabled
        ? { boardId, selectedIds, viewport: { x, y, zoom }, focusedObjectId, returnViewport }
        : undefined,
    );
  }, [boardId, selectedIds, x, y, zoom, focusedObjectId, returnViewport, enabled]);
  useEffect(() => () => publish(undefined), []);

  return null;
}

export function readInitialWorkspaceView({ state, projection, features }: InitialViewportOptions) {
  const initial = features.initialBoardView;
  const restored = initial?.boardId === state.scene.boardId ? initial : undefined;
  const savedFocus = restored?.focusedObjectId;
  const returnViewport = restored?.returnViewport;
  const focus =
    savedFocus && projection.objectsById.has(savedFocus)
      ? { id: savedFocus, returnViewport }
      : undefined;
  const viewport =
    savedFocus && !focus ? (returnViewport ?? restored?.viewport) : restored?.viewport;
  const viewportRequest: CanvasViewportRequest | undefined =
    focus && !viewport ? { fit: 'auto', requestId: '0' } : undefined;

  return {
    selectedIds: restored?.selectedIds ?? [],
    viewport,
    viewportRequest,
    focus,
  };
}

interface InitialViewportOptions {
  readonly state: WhiteboardReadyState;
  readonly projection: SceneProjection;
  readonly features: Pick<WhiteboardEditorFeatures, 'initialBoardView'>;
}

interface WorkspaceViewportOptions {
  readonly initial: ReturnType<typeof readInitialWorkspaceView>;
  readonly objectsById: SceneProjection['objectsById'];
  readonly canFollow: boolean;
}

export function useWorkspaceViewport({
  initial,
  objectsById,
  canFollow,
}: WorkspaceViewportOptions) {
  const canvasRef = useRef<CanvasHandle>(null);
  const [canvasArea, setCanvasArea] = useState<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<CanvasViewport>(
    () => initial.viewport ?? { x: 0, y: 0, zoom: 1 },
  );
  const [viewportSize, setViewportSize] = useState<CanvasViewportSize>();
  const [detachSequence, setDetachSequence] = useState(0);
  const [viewportRequest, setViewportRequest] = useState<CanvasViewportRequest | undefined>(
    initial.viewportRequest,
  );

  function requestViewport(request: BoardViewportChange) {
    setViewportRequest((current) => ({
      ...request,
      requestId: String(Number(current?.requestId ?? 0) + 1),
    }));
  }

  function fitViewport(fit: CanvasFitScope) {
    requestViewport({ fit });
  }

  function handleZoomBoard(zoom: number) {
    requestViewport({ zoom });
  }

  function detachFollow() {
    if (canFollow) {
      setDetachSequence((sequence) => sequence + 1);
    }
  }

  function handleManualZoom(zoom: number) {
    detachFollow();
    handleZoomBoard(zoom);
  }

  function handleManualFit(fit: CanvasFitScope) {
    detachFollow();
    fitViewport(fit);
  }

  function restoreViewport(restored: CanvasViewport) {
    requestViewport({ viewport: restored });
  }

  function focusCanvas() {
    canvasRef.current?.focus();
  }

  function focusWorldPoint(point: CanvasPoint) {
    const bounds = canvasArea?.getBoundingClientRect();
    if (bounds) {
      restoreViewport({
        x: bounds.width / 2 - point.x * viewport.zoom,
        y: bounds.height / 2 - point.y * viewport.zoom,
        zoom: viewport.zoom,
      });
    }
  }

  function fitPresentation() {
    fitViewport('auto');
  }

  const { scope, focusedObjectId, returnViewport, enter, exit } = useBoardPresentation({
    objects: objectsById,
    viewport,
    initialFocus: initial.focus,
    onRestore: restoreViewport,
    onFit: fitPresentation,
    focusCanvas,
    findViewingTrigger: () =>
      canvasArea?.querySelector<HTMLButtonElement>('.whiteboard-chrome__selection-viewing') ??
      undefined,
  });

  function focusContentObject(id: string) {
    const object = objectsById.get(id);
    if (!object || scope?.focusObjectId === id) {
      return;
    }

    if (scope) {
      exit();
    }
    const { geometry, kind } = object;
    const { width, height } = geometry;
    if (kind === 'todo' && isTodoOverview(width * viewport.zoom, height * viewport.zoom)) {
      const fit = () => canvasRef.current?.fitToObjects([id]);
      if (scope) {
        requestAnimationFrame(fit);
      } else {
        fit();
      }
      return;
    }

    focusWorldPoint({ x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 });
  }

  function placementPoint() {
    const bounds = canvasArea?.getBoundingClientRect();
    return bounds && { x: bounds.width / 2, y: bounds.height / 2 };
  }

  function worldCenter(): CanvasPoint {
    const center = placementPoint();
    return {
      x: ((center?.x ?? 0) - viewport.x) / viewport.zoom,
      y: ((center?.y ?? 0) - viewport.y) / viewport.zoom,
    };
  }

  return {
    canvasRef,
    canvasArea,
    setCanvasArea,
    viewport,
    setViewport,
    viewportSize,
    setViewportSize,
    viewportRequest,
    detachSequence,
    detachFollow,
    restoreViewport,
    fitViewport,
    handleZoomBoard,
    handleManualZoom,
    handleManualFit,
    focusCanvas,
    focusWorldPoint,
    fitPresentation,
    scope,
    focusedObjectId,
    returnViewport,
    enter,
    exit,
    focusContentObject,
    placementPoint,
    worldCenter,
  };
}
