import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { X } from 'lucide-react';
import type { Board, BoardElement } from '../../../../../../contracts/studio.js';
import {
  loadPanelReadingView,
  storePanelReadingView,
  type PanelReadingView,
} from '../../../../../panel-view-state.js';
import type { DocumentFocusSurface } from '../../objects/document/useDocumentFocusSurface.js';
import {
  clamp,
  expandMoveIds,
  fitViewport,
  MAX_ZOOM,
  MIN_ZOOM,
  zoomAt,
  type Point,
  type Viewport,
} from '../../scene/canvas-model.js';
import { selectionBounds as nativeSelectionBounds } from '../../scene/native-geometry.js';
import { useCommittedRef } from '../../useCommittedRef.js';
import type { Tool } from '../CanvasEditingControls.js';
import ReadingControls from './ReadingControls.js';
import ReadingMarker from './ReadingMarker.js';

const DOCUMENT_READING_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };
const UNMEASURED_VIEWPORT: Viewport = { x: 100, y: 80, zoom: 1 };

function requestedCanvasViewport(viewport?: Viewport): Viewport | undefined {
  if (!viewport) {
    return undefined;
  }

  const finitePosition = Number.isFinite(viewport.x) && Number.isFinite(viewport.y);
  if (!finitePosition || !(viewport.zoom > 0)) {
    return undefined;
  }

  return { ...viewport, zoom: clamp(viewport.zoom, MIN_ZOOM, MAX_ZOOM) };
}

interface ReadingSession {
  ids: string[];
  viewport: Viewport;
  tool: Tool;
}

interface CanvasReadingOptions {
  board: Board;
  boardRef: RefObject<Board>;
  viewportElement: RefObject<HTMLDivElement | null>;
  panelViewId?: string;
  restoreReadingFrom?: string;
  preview?: boolean;
  externalViewport?: Viewport;
  onReadingChange?: (active: boolean, kind?: 'canvas' | 'document') => void;
  onViewportInteract: () => void;
  cancelCanvasInput: () => void;
  closeCanvasMenus: () => void;
  setTool: (tool: Tool) => void;
}

export function useCanvasReading({
  board,
  boardRef,
  viewportElement,
  panelViewId,
  restoreReadingFrom,
  preview,
  externalViewport,
  onReadingChange,
  onViewportInteract,
  cancelCanvasInput,
  closeCanvasMenus,
  setTool,
}: CanvasReadingOptions) {
  const readingStorageId = preview ? undefined : panelViewId;
  const viewArtifactId = board.artifact.id;
  const [openingView] = useState(() => {
    const saved =
      readingStorageId && restoreReadingFrom
        ? loadPanelReadingView(restoreReadingFrom, viewArtifactId)
        : undefined;
    const ids = saved?.ids.filter((id) => board.elements.some((element) => element.id === id));
    return {
      storageId: readingStorageId,
      reading: saved && ids?.length ? { ...saved, ids } : undefined,
    };
  });
  const savedReading = openingView.reading;
  const requestedViewport = useMemo(
    () => requestedCanvasViewport(externalViewport),
    [externalViewport],
  );
  const initialViewport = savedReading?.viewport ?? requestedViewport;
  const [viewport, setViewport] = useState<Viewport>(() => initialViewport ?? UNMEASURED_VIEWPORT);
  const [openingFit, setOpeningFit] = useState<boolean | null>(() =>
    initialViewport ? true : null,
  );
  const [presentationZoom, setPresentationZoom] = useState(viewport.zoom);
  useEffect(() => {
    const timer = window.setTimeout(() => setPresentationZoom(viewport.zoom), 110);
    return () => window.clearTimeout(timer);
  }, [viewport.zoom]);
  const viewportRef = useCommittedRef(viewport);
  const requestedViewportRef = useCommittedRef(requestedViewport);
  useLayoutEffect(() => {
    const host = viewportElement.current;
    if (openingFit !== null || !host) {
      return;
    }

    const { clientWidth, clientHeight } = host;
    const measured = clientWidth > 0 && clientHeight > 0;
    if (measured) {
      const next = fitViewport(boardRef.current.elements, clientWidth, clientHeight);
      setViewport(next);
      setPresentationZoom(next.zoom);
    }

    setOpeningFit(measured);
  }, [openingFit, boardRef, viewportElement]);
  useEffect(() => {
    if (openingFit !== false) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      const host = viewportElement.current;
      if (host && !requestedViewportRef.current) {
        setViewport(fitViewport(boardRef.current.elements, host.clientWidth, host.clientHeight));
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [openingFit, boardRef, viewportElement, requestedViewportRef]);
  const [reading, setReading] = useState<ReadingSession | null>(() =>
    savedReading
      ? { ids: savedReading.ids, viewport: savedReading.returnViewport, tool: 'select' }
      : null,
  );
  const [restoredReadingScroll, setRestoredReadingScroll] = useState<PanelReadingView['scroll']>(
    savedReading?.scroll,
  );
  const readingDocument = Boolean(
    reading?.ids.length === 1 &&
    board.elements.find((element) => element.id === reading.ids[0])?.type === 'document',
  );
  const restoredReadingViewportRef = useRef(Boolean(savedReading));
  const readingScroll = useRef<PanelReadingView['scroll']>(savedReading?.scroll);
  const readingRef = useCommittedRef(reading);
  useEffect(() => {
    if (readingRef.current || !requestedViewport) {
      return;
    }

    setViewport((current) =>
      current.x === requestedViewport.x &&
      current.y === requestedViewport.y &&
      current.zoom === requestedViewport.zoom
        ? current
        : requestedViewport,
    );
  }, [requestedViewport, readingRef]);
  const documentFocusSurface = useRef<DocumentFocusSurface | null>(null);
  const [focusedDocumentSurface, setFocusedDocumentSurface] = useState<DocumentFocusSurface | null>(
    null,
  );
  const panelViewTimer = useRef<number | undefined>(undefined);
  const saveReadingView = useCallback(() => {
    const current = readingRef.current;
    if (!readingStorageId || !current) {
      return;
    }

    storePanelReadingView(readingStorageId, {
      artifactId: viewArtifactId,
      ids: current.ids,
      viewport: viewportRef.current,
      returnViewport: current.viewport,
      scroll: readingScroll.current,
    });
  }, [readingStorageId, viewArtifactId, readingRef, viewportRef]);
  const scheduleReadingView = useCallback(() => {
    if (!readingStorageId || panelViewTimer.current !== undefined) {
      return;
    }

    panelViewTimer.current = window.setTimeout(() => {
      panelViewTimer.current = undefined;
      saveReadingView();
    }, 150);
  }, [readingStorageId, saveReadingView]);

  function regionScrolled(elementId: string, point: Point) {
    if (!readingStorageId || !readingRef.current?.ids.includes(elementId)) {
      return;
    }

    readingScroll.current = { elementId, ...point };
    scheduleReadingView();
  }

  useEffect(() => {
    if (reading) {
      scheduleReadingView();
    }
  }, [reading, viewport, scheduleReadingView]);
  useEffect(() => {
    if (!readingStorageId) {
      return;
    }

    const visibility = () => {
      if (document.visibilityState === 'hidden') {
        saveReadingView();
      }
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', saveReadingView);
    return () => {
      window.clearTimeout(panelViewTimer.current);
      panelViewTimer.current = undefined;
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', saveReadingView);
      saveReadingView();
    };
  }, [readingStorageId, saveReadingView]);
  const readingCallback = useCommittedRef(onReadingChange);
  const [readingHint, setReadingHint] = useState(false);
  const readingExit = useRef<HTMLButtonElement>(null);
  const [readingMarker, setReadingMarker] = useState(false);
  const [readingClearRevision, setReadingClearRevision] = useState(0);
  const restoreOpeningReadingView = useCallback(() => {
    const { reading: restored, storageId } = openingView;
    if (storageId) {
      storePanelReadingView(storageId, restored ?? null);
    }
    if (restored) {
      const { ids } = restored;
      const kind =
        ids.length === 1 &&
        boardRef.current.elements.some(
          (element) => element.id === ids[0] && element.type === 'document',
        )
          ? 'document'
          : 'canvas';
      readingCallback.current?.(true, kind);
    }
  }, [openingView, readingCallback, boardRef]);

  function handleExitReading() {
    const previous = readingRef.current;
    if (!previous) {
      return;
    }

    cancelCanvasInput();
    readingRef.current = null;
    setReading(null);
    setReadingHint(false);
    setReadingMarker(false);
    readingScroll.current = undefined;
    setRestoredReadingScroll(undefined);
    if (readingStorageId) {
      storePanelReadingView(readingStorageId, null);
    }
    documentFocusSurface.current = null;
    setFocusedDocumentSurface(null);
    setViewport(previous.viewport);
    setTool(previous.tool);
    readingCallback.current?.(false);
    requestAnimationFrame(() => {
      const button = viewportElement.current?.parentElement?.querySelector<HTMLElement>(
        '[aria-label="全屏观看选区"]',
      );
      (button ?? viewportElement.current)?.focus({ preventScroll: true });
    });
  }

  async function requestExitReading() {
    const previous = readingRef.current;
    const surface = documentFocusSurface.current;
    if (!previous) {
      return;
    }

    const opensThatDocument = previous.ids.length === 1 && previous.ids[0] === surface?.id;
    if (opensThatDocument && surface.prepareExit && !(await surface.prepareExit())) {
      return;
    }

    if (readingRef.current === previous) {
      handleExitReading();
    }
  }

  function enterReading(selectedIds: string[], tool: Tool) {
    const ids = expandMoveIds(
      boardRef.current.elements.map((element) =>
        element.locked ? { ...element, locked: false } : element,
      ),
      selectedIds,
    );
    const document =
      ids.length === 1 &&
      boardRef.current.elements.find((element) => element.id === ids[0])?.type === 'document';
    const next = {
      ids,
      viewport: { ...viewportRef.current },
      tool: document ? ('select' as const) : tool,
    };
    readingRef.current = next;
    setReading(next);
    setReadingHint(true);
    setReadingMarker(false);
    cancelCanvasInput();
    closeCanvasMenus();
    setTool('select');
    onViewportInteract();
    if (document) {
      setViewport(DOCUMENT_READING_VIEWPORT);
      readingCallback.current?.(true, 'document');
    } else {
      readingCallback.current?.(true);
    }
  }

  function handleDocumentFocusSurface(elementId: string, surface: DocumentFocusSurface | null) {
    if (surface || documentFocusSurface.current?.id === elementId) {
      documentFocusSurface.current = surface;
      setFocusedDocumentSurface(surface);
    }
  }

  function handleFitReadingContent() {
    const current = readingRef.current;
    const host = viewportElement.current;
    if (!current || !host) {
      return;
    }

    if (
      current.ids.length === 1 &&
      boardRef.current.elements.find((element) => element.id === current.ids[0])?.type ===
        'document'
    ) {
      onViewportInteract();
      documentFocusSurface.current?.setZoomAnchor(null);
      setViewport(DOCUMENT_READING_VIEWPORT);
      return;
    }
    const bounds = nativeSelectionBounds(boardRef.current.elements, current.ids);
    if (!bounds) {
      handleExitReading();
      return;
    }
    onViewportInteract();
    setViewport(fitViewport([bounds], host.clientWidth, host.clientHeight, 48, 8));
  }

  function handleReadingZoom(zoom: number) {
    const host = viewportElement.current;
    if (!host) {
      return;
    }

    onViewportInteract();
    documentFocusSurface.current?.setZoomAnchor(null);
    setViewport((value) =>
      zoomAt(value, { x: host.clientWidth / 2, y: host.clientHeight / 2 }, zoom),
    );
  }

  const readingBoundsKey = reading
    ? JSON.stringify(nativeSelectionBounds(board.elements, reading.ids))
    : '';

  function renderReadingControls() {
    return (
      reading &&
      !readingDocument && (
        <>
          <div
            className={`studio-reading-hint${readingHint && !readingMarker ? ' is-visible' : ''}`}
            role="status"
          >
            全屏观看 · 按 <kbd>Esc</kbd> 退出
          </div>
          <button
            ref={readingExit}
            type="button"
            className="studio-reading-exit"
            aria-label="退出全屏观看"
            title="退出全屏观看（Esc）"
            onClick={handleExitReading}
          >
            <X size={18} />
            <span>退出全屏</span>
            <kbd>Esc</kbd>
          </button>
          <ReadingControls
            zoom={viewport.zoom}
            onZoom={handleReadingZoom}
            onFit={handleFitReadingContent}
            markerMode={readingMarker}
            onMarkerModeChange={setReadingMarker}
            onClear={() => setReadingClearRevision((value) => value + 1)}
            onCanvasFocus={() => viewportElement.current?.focus({ preventScroll: true })}
            onInteract={() => setReadingHint(false)}
          />
        </>
      )
    );
  }

  function renderReadingMarker(queueScope: string, navigationActive: boolean) {
    return (
      reading &&
      !readingDocument && (
        <ReadingMarker
          viewport={
            focusedDocumentSurface
              ? {
                  x: focusedDocumentSurface.origin.x,
                  y: focusedDocumentSurface.origin.y,
                  zoom: focusedDocumentSurface.zoom,
                }
              : viewport
          }
          clip={focusedDocumentSurface?.clip}
          active={readingMarker}
          scopeKey={
            focusedDocumentSurface
              ? `${queueScope}:${focusedDocumentSurface.scopeKey}`
              : `${queueScope}:${reading.ids.join(',')}:${readingBoundsKey}`
          }
          clearRevision={readingClearRevision}
          navigationActive={navigationActive}
        />
      )
    );
  }

  return {
    viewport,
    viewportRef,
    setViewport,
    presentationZoom,
    openingViewportReady: openingFit !== null,
    savedReadingIds: savedReading?.ids,
    reading,
    readingRef,
    readingDocument,
    readingStorageId,
    restoredReadingScroll,
    documentFocusSurface,
    restoreOpeningReadingView,
    regionScrolled,
    enterReading,
    handleExitReading,
    requestExitReading,
    handleDocumentFocusSurface,
    renderReadingControls,
    renderReadingMarker,
    readingLayout: {
      reading,
      readingRef,
      readingCallback,
      readingBoundsKey,
      restoredReadingViewportRef,
      viewportElement,
      readingExit,
      setReadingHint,
      handleFitReadingContent,
      handleExitReading,
      elements: board.elements,
    },
  };
}

export function useCanvasReadingLayout({
  reading,
  readingRef,
  readingCallback,
  readingBoundsKey,
  restoredReadingViewportRef,
  viewportElement,
  readingExit,
  setReadingHint,
  handleFitReadingContent,
  handleExitReading,
  elements,
}: ReturnType<typeof useCanvasReading>['readingLayout']) {
  const refitReading = useEffectEvent(handleFitReadingContent);
  useEffect(() => {
    if (!reading) {
      return;
    }

    const host = viewportElement.current!;
    const fitReading = () => refitReading();
    let width = host.clientWidth;
    let height = host.clientHeight;
    if (!restoredReadingViewportRef.current) {
      fitReading();
    }
    restoredReadingViewportRef.current = false;
    const observer =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            if (width === host.clientWidth && height === host.clientHeight) {
              return;
            }

            width = host.clientWidth;
            height = host.clientHeight;
            fitReading();
          })
        : undefined;
    observer?.observe(host);
    window.addEventListener('resize', fitReading);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', fitReading);
    };
  }, [reading, readingBoundsKey, restoredReadingViewportRef, viewportElement]);
  const isReading = Boolean(reading);
  useEffect(() => {
    if (!isReading) {
      return;
    }

    readingExit.current?.focus({ preventScroll: true });
    const timer = setTimeout(() => setReadingHint(false), 3500);
    return () => clearTimeout(timer);
  }, [isReading, readingExit, setReadingHint]);
  const exitRemovedReading = useEffectEvent((elements: BoardElement[]) => {
    if (
      readingRef.current &&
      !elements.some((element) => readingRef.current!.ids.includes(element.id))
    ) {
      handleExitReading();
    }
  });
  useEffect(() => {
    exitRemovedReading(elements);
  }, [elements]);
  useEffect(
    () => () => {
      if (readingRef.current) {
        readingCallback.current?.(false);
      }
    },
    [readingRef, readingCallback],
  );
}
