import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import {
  createWhiteboardSession,
  type BoardEditReceipt,
  type WhiteboardService,
} from '../../data/whiteboard/index.js';
import { Button, OperationNotice, StatePanel, type ActionMenuAnchor } from '../../ui/base/index.js';
import {
  type CanvasFitScope,
  type CanvasGeometry,
  type CanvasEditIntent,
  type CanvasHandle,
  type CanvasNativeSource,
  type CanvasInlineFormat,
  type CanvasObjectIntent,
  type CanvasPoint,
  type CanvasPresentation,
  type CanvasObjectExtension,
  type CanvasProps,
  type CanvasViewport,
  type CanvasViewportRequest,
  type CanvasViewportSize,
} from '../../ui/domain/canvas/index.js';
import { studioObjectExtensions } from '../../ui/domain/objects/index.js';
import { documentExtension } from '../../ui/domain/objects/document/index.js';
import { LinkDialog } from '../../ui/domain/objects/media/index.js';
import { textExtension } from '../../ui/domain/objects/text/index.js';
import { isTodoOverview } from '../../ui/domain/objects/todo/index.js';
import { canvasOwnsClipboard } from './board-clipboard.js';
import type { BoardTool } from './BoardChrome.js';
import { BoardDraftRecovery } from './BoardDraftRecovery.js';
import { BoardHtmlCreation, useBoardHtmlCreation } from './BoardHtmlCreation.js';
import { BoardViewportTools } from './BoardViewportTools.js';
import { BoardWelcome } from './BoardWelcome.js';
import { renderBoardHistoryCanvas } from './HistoryCanvasView.js';
import type {
  BoardFeedbackFrame,
  BoardMediaUpload,
  BoardPresenceSlot,
  BoardViewContext,
  WhiteboardEditorFeatures,
} from './board-features.js';
import { projectPayloads, projectScene, projectTextStyles } from './canvas-projection.js';
import { GeometryBoardMenu } from './geometry-controls.js';
import { adjacentTextDraft, clipboardTextDraft } from './geometry-commands.js';
import { useGeometryEdits } from './geometry-session.js';
import { readBoardDraftCurrent } from './local-board-drafts.js';
import { useMoveSession } from './move-session.js';
import { renderSuggestionPreview } from './suggestion-preview.js';
import { useBoardPresentation } from './use-board-presentation.js';
import { useBoardClipboard } from './use-board-clipboard.js';
import { useBoardTitle, type RenameBoard } from './use-board-title.js';
import { useBoardContentTracking } from './use-board-content-tracking.js';
import { useBoardUndo } from './use-board-undo.js';
import { useContentEdits } from './use-content-edits.js';
import { record } from './content-edit-value.js';
import {
  WorkspaceCanvas,
  WorkspaceExport,
  WorkspaceHeader,
  WorkspacePanels,
  WorkspaceSelectionBar,
  WorkspaceToolbar,
} from './WorkspaceChrome.js';
import './whiteboard-editor.css';

export interface WhiteboardEditorSurfaceProps {
  readonly boardId: string;
  readonly service: WhiteboardService;
  readonly createCommandId: () => string;
  readonly onBack?: () => void;
  readonly renameBoard?: RenameBoard;
  readonly features: WhiteboardEditorFeatures;
}

type WhiteboardSession = ReturnType<typeof createWhiteboardSession>;
type WhiteboardState = ReturnType<WhiteboardSession['getSnapshot']>;
type ReadyState = Extract<WhiteboardState, { kind: 'ready' }>;
type SceneProjection = NonNullable<ReturnType<typeof projectScene>>;
type BoardViewportChange =
  | { readonly fit: CanvasFitScope }
  | { readonly zoom: number }
  | { readonly viewport: CanvasViewport };

interface BoardWorkspaceProps {
  readonly state: ReadyState;
  readonly session: WhiteboardSession;
  readonly service: WhiteboardService;
  readonly projection: SceneProjection;
  readonly createCommandId: () => string;
  readonly onBack?: () => void;
  readonly renameBoard?: RenameBoard;
  readonly features: WhiteboardEditorFeatures;
}

interface BoardSurfaceProps {
  readonly state: ReadyState;
  readonly session: WhiteboardSession;
  readonly service: WhiteboardService;
  readonly createCommandId: () => string;
  readonly onBack?: () => void;
  readonly renameBoard?: RenameBoard;
  readonly features: WhiteboardEditorFeatures;
}

const movable = {
  move: true,
  resize: false,
  rotate: false,
  connect: false,
} as const;
const newLink = { title: '链接', href: '' } as const;
const nativeDropTypes = new Set(['image', 'video']);
const adjacentTextKinds = new Set(['text', 'note', 'shape', 'section']);

const moveExtensions: readonly CanvasObjectExtension[] = [
  ...studioObjectExtensions.map((extension) => ({
    ...extension,
    placement: undefined,
    portClick: undefined,
    capabilities: { ...extension.capabilities, resize: false, rotate: false, connect: false },
  })),
  { kind: 'ink', capabilities: { ...movable, content: 'passive' }, blocksPlacement: false },
  { kind: 'native', capabilities: { ...movable, content: 'native' } },
];

function useBoardPanels() {
  const [exportAnchor, setExportAnchor] = useState<HTMLButtonElement>();
  const [historyAnchor, setHistoryAnchor] = useState<HTMLButtonElement | null>(null);
  const [historyPreview, setHistoryPreview] = useState(false);
  const [feedbackAnchor, setFeedbackAnchor] = useState<HTMLButtonElement | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [suggestionAnchor, setSuggestionAnchor] = useState<HTMLButtonElement | null>(null);
  const [suggestionThreadId, setSuggestionThreadId] = useState<string>();
  const [suggestionPreview, setSuggestionPreview] = useState(false);

  function closeSuggestions() {
    setSuggestionAnchor(null);
    setSuggestionThreadId(undefined);
    setSuggestionPreview(false);
  }

  function openSuggestions(anchor: HTMLButtonElement, threadId?: string) {
    setExportAnchor(undefined);
    setHistoryAnchor(null);
    setFeedbackOpen(false);
    setSuggestionThreadId(threadId);
    setSuggestionAnchor((current) => (current === anchor && !threadId ? null : anchor));
  }

  function openHistory(anchor: HTMLButtonElement) {
    closeSuggestions();
    setExportAnchor(undefined);
    setFeedbackOpen(false);
    setHistoryAnchor((current) => (current === anchor ? null : anchor));
  }

  function toggleFeedback(anchor: HTMLButtonElement) {
    closeSuggestions();
    setExportAnchor(undefined);
    setHistoryAnchor(null);
    setFeedbackAnchor(anchor);
    setFeedbackOpen((open) => !open);
  }

  function openExport(anchor: HTMLButtonElement) {
    closeSuggestions();
    setHistoryAnchor(null);
    setFeedbackOpen(false);
    setExportAnchor((current) => (current === anchor ? undefined : anchor));
  }

  function closeExport() {
    setExportAnchor(undefined);
  }

  function closeHistory() {
    setHistoryAnchor(null);
  }

  return {
    exportAnchor,
    historyAnchor,
    historyPreview,
    feedbackAnchor,
    feedbackOpen,
    suggestionAnchor,
    suggestionThreadId,
    suggestionPreview,
    openSuggestions,
    closeSuggestions,
    setSuggestionPreview,
    openHistory,
    toggleFeedback,
    openExport,
    closeExport,
    closeHistory,
    setHistoryPreview,
    setFeedbackOpen,
  };
}

function boardPanelActions(
  features: WhiteboardEditorFeatures,
  panels: ReturnType<typeof useBoardPanels>,
) {
  const standaloneSuggestions = features.renderSuggestions && !features.renderFeedback;
  return {
    onOpenShare: features.renderExport ? panels.openExport : undefined,
    onOpenHistory: features.renderHistory ? panels.openHistory : undefined,
    onToggleFeedback: features.renderFeedback ? panels.toggleFeedback : undefined,
    onOpenSuggestions: standaloneSuggestions ? panels.openSuggestions : undefined,
  };
}

function selectedObjectsFor(projected: SceneProjection, ids: readonly string[]) {
  return ids.flatMap((id) => {
    const object = projected.objectsById.get(id);

    return object ? [object] : [];
  });
}

function selectedSection(objects: ReturnType<typeof selectedObjectsFor>) {
  const [first] = objects;
  return objects.length === 1 && first?.kind === 'section' ? first : undefined;
}

function selectedHtmlObjectId(
  objects: ReturnType<typeof selectedObjectsFor>,
  payloads: ReadyState['payloads'],
) {
  const [object] = objects;
  if (objects.length !== 1 || !object) {
    return undefined;
  }
  if (object.kind !== 'html' && object.kind !== 'diagram') {
    return undefined;
  }

  const body = payloads.get(object.id)?.body;
  return body?.kind === 'embed' && typeof body.value.html === 'string' ? object.id : undefined;
}

function welcomeAvailable(
  viewOnly: boolean,
  annotating: boolean,
  tool: BoardTool,
  objectCount: number,
) {
  const interacting = annotating || typeof tool !== 'string';

  return !viewOnly && !interacting && objectCount === 0;
}

function bodyEditingAvailable(online: boolean, expanded: boolean, scope?: string) {
  return online || (expanded && Boolean(scope));
}

function annotationActions(
  online: boolean,
  feedbackEnabled: boolean,
  onToggleAnnotation: () => void,
  onAnnotate: () => void,
) {
  if (!online || !feedbackEnabled) {
    return {};
  }

  return { onToggleAnnotation, onAnnotate };
}

function availableEditAccess(
  mayEdit: boolean,
  mayComment: boolean | undefined,
  watching: boolean,
  previewing: boolean,
  documentReading: boolean,
) {
  const viewOnly = watching || previewing;
  const mayAnnotate = !previewing && (!watching || documentReading);
  return {
    viewOnly,
    online: mayEdit && !viewOnly,
    canComment: (mayComment ?? mayEdit) && mayAnnotate,
    canEditExpanded: mayEdit && !previewing,
  };
}

function feedbackCoordinates(
  viewport: CanvasViewport,
  geometry: CanvasGeometry | undefined,
  size: CanvasViewportSize | undefined,
): BoardFeedbackFrame['viewport'] {
  if (!geometry || !size || size.width <= 0) {
    return viewport;
  }

  const zoom = size.width / geometry.width;
  const zoomY = size.height / geometry.height;
  return { x: -geometry.x * zoom, y: -geometry.y * zoomY, zoom, zoomY };
}

function readFeedbackView(
  scope: CanvasPresentation | undefined,
  projection: SceneProjection,
  viewport: CanvasViewport,
  viewportSize: CanvasViewportSize | undefined,
  history: boolean,
) {
  const focusedObjectId = scope?.focusObjectId;
  const documentReading = Boolean(focusedObjectId);
  const geometry = focusedObjectId
    ? projection.objectsById.get(focusedObjectId)?.geometry
    : undefined;

  return {
    documentReading,
    focusedObjectId,
    viewport: feedbackCoordinates(viewport, geometry, viewportSize),
    hidingFeedback: history || Boolean(scope && !documentReading),
  };
}

interface BoardViewReporterProps extends BoardViewContext {
  readonly enabled: boolean;
  readonly onViewContext?: WhiteboardEditorFeatures['onViewContext'];
}

function BoardViewReporter({
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

function initialWorkspaceView({
  state,
  projection,
  features,
}: Pick<BoardWorkspaceProps, 'state' | 'projection' | 'features'>) {
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

function BoardWorkspace({
  state,
  session,
  service,
  projection,
  createCommandId,
  onBack,
  renameBoard,
  features,
}: BoardWorkspaceProps) {
  const board = state.scene;
  const initial = initialWorkspaceView({ state, projection, features });
  const canvasRef = useRef<CanvasHandle>(null);
  const mediaUploadRef = useRef<BoardMediaUpload | undefined>(undefined);
  const handleUploadReady = useCallback((upload: BoardMediaUpload | undefined) => {
    mediaUploadRef.current = upload;
  }, []);
  const suggestionTrigger = useRef<HTMLButtonElement>(null);
  const [canvasArea, setCanvasArea] = useState<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState<readonly string[]>(initial.selectedIds);
  const [tool, setTool] = useState<BoardTool>('select');
  const [showGrid, setShowGrid] = useState(true);
  const [singleKeys, setSingleKeys] = useState(true);
  const [penColor, setPenColor] = useState('#2d3142');
  const [annotationActive, setAnnotationActive] = useState(false);
  const [unresolvedFeedback, setUnresolvedFeedback] = useState(false);
  const [lanSharing, setLanSharing] = useState(false);
  const [annotationRequest, setAnnotationRequest] =
    useState<BoardFeedbackFrame['annotationRequest']>();
  const [contentAnnotationRequest, setContentAnnotationRequest] =
    useState<BoardFeedbackFrame['contentAnnotationRequest']>();
  const [pointAnnotationRequest, setPointAnnotationRequest] =
    useState<BoardFeedbackFrame['pointAnnotationRequest']>();
  const contentTracking = useBoardContentTracking();
  const [nativeSourceRequest, setNativeSourceRequest] =
    useState<CanvasProps['nativeSourceRequest']>();
  const [sourceIssue, setSourceIssue] = useState<string>();
  const [linkCreation, setLinkCreation] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<ActionMenuAnchor | null>(null);
  const [objectEdit, setObjectEdit] = useState<CanvasProps['editObjectRequest']>();
  const [formatObjectRequest, setFormatObjectRequest] =
    useState<CanvasProps['formatObjectRequest']>();
  const nextFormatRequest = useRef(0);
  const newTextIds = useRef(new Set<string>());
  const selectionEpoch = useRef(0);
  const selectionBeforePlacement = useRef<readonly string[]>([]);
  const nextWelcomePlacement = useRef(0);
  const [viewport, setViewport] = useState<CanvasViewport>(
    () => initial.viewport ?? { x: 0, y: 0, zoom: 1 },
  );
  const [viewportSize, setViewportSize] = useState<CanvasViewportSize>();
  const [detachSequence, setDetachSequence] = useState(0);
  const [viewportRequest, setViewportRequest] = useState<CanvasViewportRequest | undefined>(
    initial.viewportRequest,
  );
  const panels = useBoardPanels();
  const creation = useBoardHtmlCreation();
  const selection = useMemo(
    () => selected.filter((id) => projection.objectsById.has(id)),
    [selected, projection.objectsById],
  );
  const projected = useMemo(
    () => projectPayloads(projection, state.payloads),
    [projection, state.payloads],
  );
  const textStyleById = useMemo(
    () => projectTextStyles(state.payloads, selection),
    [selection, state.payloads],
  );
  const mayEdit = board.canEdit && !state.sceneError;
  const title = board.title || '白板';

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
    if (features.renderPresence) {
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

  function handleRoomAccessLost() {
    panels.closeExport();
    panels.closeHistory();
    panels.closeSuggestions();
    panels.setFeedbackOpen(false);
    setAnnotationActive(false);
    setMenuAnchor(null);
    setFormatObjectRequest(undefined);
    session.reload();
    features.onRoomAccessLost?.();
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
    objects: projection.objectsById,
    viewport,
    initialFocus: initial.focus,
    onRestore: restoreViewport,
    onFit: fitPresentation,
    focusCanvas,
  });

  function handleOpenViewing(ids: readonly string[], trigger?: HTMLButtonElement) {
    panels.closeExport();
    panels.closeHistory();
    panels.closeSuggestions();
    panels.setFeedbackOpen(false);
    setAnnotationActive(false);
    setMenuAnchor(null);
    setFormatObjectRequest(undefined);
    enter(ids, trigger);
  }

  const watching = Boolean(scope);
  const feedbackView = readFeedbackView(
    scope,
    projection,
    viewport,
    viewportSize,
    panels.historyPreview,
  );
  const { documentReading, viewport: feedbackViewport } = feedbackView;

  function focusContentObject(id: string) {
    const object = projection.objectsById.get(id);
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
  const previewing = panels.historyPreview || panels.suggestionPreview;
  const { viewOnly, online, canComment, canEditExpanded } = availableEditAccess(
    mayEdit,
    features.commentAccess,
    watching,
    previewing,
    documentReading,
  );
  const { editService, Viewing, renderExport, renderFeedback } = features;
  const undo = useBoardUndo({
    boardId: board.boardId,
    revision: board.revision,
    enabled: online,
    service: editService,
    createCommandId,
    onApplied: session.acceptEdit,
    onConflict: session.acceptConflict,
  });
  const move = useMoveSession(session, board.boardId, online, createCommandId, undo.recordMove);
  const moving = move.pendingEdits.length > 0;
  const editingReady = online && !moving;
  const boardTitle = useBoardTitle({
    boardId: board.boardId,
    title,
    renameBoard: online ? renameBoard : undefined,
    onSaved: session.reload,
  });

  function handleEditApplied(
    receipt: Extract<BoardEditReceipt, { kind: 'applied' }>,
    ids?: readonly string[],
    context?: { readonly selectionCurrent: boolean; readonly editText: boolean },
  ) {
    session.acceptEdit(receipt);
    undo.recordEdit(receipt);
    if (ids) {
      const insertedText = receipt.objects.find(
        ({ id, kind, payloadVersion }) =>
          kind === 'text' && payloadVersion === 0n && ids.includes(id),
      );

      if (insertedText) {
        newTextIds.current.add(insertedText.id);
      }
      if (context?.selectionCurrent !== false) {
        setMenuAnchor(null);
        setSelected(ids);
        if (context?.editText && insertedText) {
          editObject(insertedText.id);
        }
      }
      creation.complete(receipt, ids);
    }
  }

  const geometry = useGeometryEdits({
    boardId: board.boardId,
    revision: board.revision,
    canEdit: editingReady,
    canWrite: mayEdit,
    service: editService,
    createCommandId,
    objectsById: projection.objectsById,
    payloadVersion: (id) =>
      state.payloads.get(id)?.version ??
      board.objects.find((object) => object.id === id)?.payloadVersion,
    readSelectionEpoch: () => selectionEpoch.current,
    onPlacementStarted: (id) => {
      selectionBeforePlacement.current = selection;
      setMenuAnchor(null);
      setSelected([id]);
    },
    onPlacementFailed: (id, selectionCurrent) => {
      const previous = selectionBeforePlacement.current;
      setSelected((current) =>
        selectionCurrent ? previous : current.filter((item) => item !== id),
      );
    },
    onApplied: handleEditApplied,
    onConflict: session.reload,
  });
  const content = useContentEdits({
    boardId: board.boardId,
    service: editService,
    localDrafts: features.localDrafts,
    canEdit:
      !undo.hasPendingEdit &&
      bodyEditingAvailable(online, canEditExpanded, scope?.expandedObjectId),
    createCommandId,
    onApplied: handleEditApplied,
    onConflict: session.acceptConflict,
  });
  const historyReady = editingReady && !geometry.hasPendingEdit;
  const canEdit = historyReady && !undo.hasPendingEdit;
  const canInsert = canEdit && Boolean(editService);
  const viewportHistory = {
    canUndo: historyReady && undo.canUndo,
    canRedo: historyReady && undo.canRedo,
    onChange: (direction: 'undo' | 'redo') => undo[direction](),
  };
  const selectedObjects = selectedObjectsFor(projection, selection);
  const selectedHtmlId = selectedHtmlObjectId(selectedObjects, state.payloads);

  async function handleObjectIntent(intent: CanvasObjectIntent) {
    const { objectId, kind, name, value } = intent;
    if (name !== 'text.commit' || !record(value) || typeof value.text !== 'string') {
      return content.handleObjectIntent(intent);
    }

    const epoch = selectionEpoch.current;
    const current = state.payloads.get(objectId)?.body;
    const previousText = current?.kind === 'text' ? current.value.text : undefined;
    const previouslyFilled = typeof previousText === 'string' && Boolean(previousText.trim());
    const blankText = value.close === true && kind === 'text' && !value.text.trim();
    const shouldRemove = blankText && (previouslyFilled || newTextIds.current.has(objectId));
    const request = shouldRemove ? { ...intent, value: { ...value, deleteEmpty: true } } : intent;
    const receipt = await content.handleObjectIntent(request);
    if (!receipt.ok) {
      return receipt;
    }

    newTextIds.current.delete(objectId);
    const currentSelection = selectionEpoch.current === epoch && selection.includes(objectId);
    if (value.adjacent === true && currentSelection && !blankText) {
      await createAdjacentText(objectId);
    }

    return receipt;
  }

  async function createAdjacentText(id: string) {
    const source = projection.objectsById.get(id);
    if (!source || !canInsert || !adjacentTextKinds.has(source.kind)) {
      return;
    }

    const object = adjacentTextDraft(source, textStyleById.get(id));
    const result = await geometry.submitEdit({
      kind: 'create',
      interactionId: 'continue-text',
      object,
    });

    if (result && 'receipt' in result && result.receipt.kind === 'applied') {
      const [created] = result.receipt.objects;
      if (created) {
        editObject(created.id);
      }
    }
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

  function insertClipboardText(text: string) {
    const object = clipboardTextDraft(text, worldCenter());
    geometry.handleEdit({ kind: 'create', interactionId: 'paste-text', object });
  }

  function uploadMedia(files: readonly File[], point?: CanvasPoint) {
    const accepted = files.filter(({ type }) => nativeDropTypes.has(type.split('/')[0] ?? ''));
    if (!canInsert || !mediaUploadRef.current || accepted.length === 0) {
      return false;
    }

    mediaUploadRef.current(accepted, point);
    return true;
  }

  const clipboard = useBoardClipboard({
    clipboard: features.clipboard,
    sourceBoardId: board.boardId,
    sourceRevision: board.revision,
    objects: projection.scene.objects,
    selection,
    active: !viewOnly && !annotationActive,
    canEdit: canInsert && !annotationActive,
    onSelectionAction: geometry.handleSelectionAction,
    onObjects: geometry.handlePaste,
    onText: insertClipboardText,
    onMedia: uploadMedia,
  });

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (event.defaultPrevented) {
      return;
    }

    const bounds = canvasArea?.getBoundingClientRect();
    const point = bounds && { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    if (uploadMedia(Array.from(event.dataTransfer.files), point)) {
      event.preventDefault();
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    const canReceiveFiles = canInsert && Boolean(mediaUploadRef.current);
    if (!event.defaultPrevented && canReceiveFiles && event.dataTransfer.types.includes('Files')) {
      event.preventDefault();
    }
  }

  function handleHistoryKey(event: KeyboardEvent<HTMLDivElement>) {
    const primary = event.ctrlKey || event.metaKey;
    const typing = event.altKey || event.nativeEvent.isComposing;
    if (!primary || typing || !canvasOwnsClipboard(event)) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key === 'z' || key === 'y') {
      event.preventDefault();
      if (historyReady) {
        undo[key === 'y' || event.shiftKey ? 'redo' : 'undo']();
      }
    }
  }

  async function handleSaveLink({
    title: label,
    href,
  }: {
    readonly title: string;
    readonly href: string;
  }) {
    const stateNow = geometry.state;
    const prior = stateNow.kind === 'unknown' ? stateNow.edit.command.operation : undefined;
    const retry =
      prior?.kind === 'create' &&
      prior.object.kind === 'link' &&
      prior.initialPayload?.kind === 'link' &&
      prior.object.label === label &&
      prior.initialPayload.value.href === href;
    const { x, y } = worldCenter();
    const result = retry
      ? await geometry.retryWithReceipt()
      : await geometry.submitEdit({
          kind: 'create',
          interactionId: 'create-link',
          object: {
            kind: 'link',
            label,
            geometry: { x, y, width: 320, height: 94, rotation: 0 },
            metadata: { href },
          },
        });

    if (!result) {
      return false;
    }
    if ('detail' in result) {
      throw new Error(result.detail);
    }

    return result.receipt.kind === 'applied';
  }

  function handleEdit(intent: CanvasEditIntent) {
    if (intent.kind === 'move') {
      move.handleEdit(intent);
      return;
    }

    geometry
      .submitEdit(intent, intent.kind === 'create' && !intent.link)
      ?.catch(geometry.reportEditFailure);
  }

  function handleRestore(receipt: BoardEditReceipt) {
    if (receipt.kind === 'applied') {
      session.acceptEdit(receipt);
      session.reload();
    }
  }

  function changeAnnotation(active: boolean) {
    if (active) {
      setMenuAnchor(null);
      setTool('select');
    }

    setAnnotationActive(active);
  }

  function handleToggleAnnotation() {
    panels.setFeedbackOpen(false);
    changeAnnotation(!annotationActive);
  }

  function handleCanvasAnnotation(event: MouseEvent<HTMLDivElement>) {
    const accepting = canComment && annotationActive && event.detail > 0;
    if (!accepting || !canvasOwnsClipboard(event)) {
      return;
    }

    const bounds = canvasArea?.getBoundingClientRect();
    if (!bounds) {
      return;
    }

    const x = (event.clientX - bounds.left - feedbackViewport.x) / feedbackViewport.zoom;
    const y =
      (event.clientY - bounds.top - feedbackViewport.y) /
      (feedbackViewport.zoomY ?? feedbackViewport.zoom);
    setPointAnnotationRequest((current) => ({
      sequence: (current?.sequence ?? 0) + 1,
      point: { x, y },
    }));
  }

  function handleAnnotateSelection() {
    const [objectId] = selection;
    if (objectId) {
      setAnnotationRequest((current) => ({ objectId, sequence: (current?.sequence ?? 0) + 1 }));
    }
  }

  const attachContentAnnotation: NonNullable<CanvasProps['onAnnotateContent']> = (id, request) => {
    const version = projected.payloadById.get(id)?.version;
    const object = projection.objectsById.get(id);
    if (!canComment || !object || version === undefined) {
      return;
    }

    const { u, v, target: content } = request;
    if (content.kind === 'object') {
      setAnnotationRequest((current) => ({
        objectId: id,
        sequence: (current?.sequence ?? 0) + 1,
        u,
        v,
      }));

      return;
    }

    setContentAnnotationRequest((current) => ({
      sequence: (current?.sequence ?? 0) + 1,
      target: {
        kind: 'content',
        objectId: id,
        geometryVersion: BigInt(object.version),
        payloadVersion: BigInt(version),
        u,
        v,
        content,
      },
    }));
  };

  function nativeSourceLabel(source: CanvasNativeSource) {
    if (!source.artifactId || source.artifactId === board.boardId) {
      return projection.objectsById.get(source.elementId)?.label;
    }
  }

  function openNativeSource(source: CanvasNativeSource) {
    if (source.artifactId && source.artifactId !== board.boardId) {
      setSourceIssue('这条来源位于其他白板。');
      return;
    }
    if (!projection.objectsById.has(source.elementId)) {
      setSourceIssue('来源对象已不存在。');
      return;
    }

    setSourceIssue(undefined);
    exit();
    detachFollow();
    changeSelection([source.elementId]);
    fitViewport('selection');
    setNativeSourceRequest((current) => ({ source, sequence: (current?.sequence ?? 0) + 1 }));
  }

  function handleToolChange(nextTool: BoardTool) {
    selectionEpoch.current += 1;
    setAnnotationActive(false);
    setMenuAnchor(null);
    setFormatObjectRequest(undefined);
    setTool(nextTool);
  }

  function handleAddDocument() {
    const object = documentExtension.placement;
    if (!object) {
      return;
    }

    nextWelcomePlacement.current += 1;
    handleToolChange({
      kind: 'place',
      requestId: 'welcome-document-' + nextWelcomePlacement.current,
      object,
    });
    focusCanvas();
  }

  function handleOpenHtml() {
    handleToolChange('select');
    creation.handleOpen();
  }

  function handleContextMenu(anchor: CanvasPoint, ids: readonly string[]) {
    changeSelection(ids);
    setMenuAnchor(anchor);
  }

  function handleSelectionMenu(trigger: HTMLButtonElement) {
    const { left, bottom } = trigger.getBoundingClientRect();

    setMenuAnchor({ x: left, y: bottom + 6 });
  }

  function editObject(id: string) {
    setObjectEdit({ id });
  }

  const section = selectedSection(selectedObjects);
  const onRenameSection = section && (() => editObject(section.id));

  function selectAll() {
    changeSelection(projected.scene.objects.map(({ id }) => id));
  }

  function changeSelection(ids: readonly string[]) {
    selectionEpoch.current += 1;
    setFormatObjectRequest(undefined);
    setSelected(ids);
  }

  function handleFormatObject(id: string, format: CanvasInlineFormat) {
    nextFormatRequest.current += 1;
    setFormatObjectRequest({ id, format, sequence: nextFormatRequest.current });
  }

  const annotation = annotationActions(
    canComment,
    Boolean(renderFeedback),
    handleToggleAnnotation,
    handleAnnotateSelection,
  );
  const selectionActions = (
    <WorkspaceSelectionBar
      selection={selectedObjects}
      editAvailable={Boolean(editService)}
      canEdit={canEdit}
      onOpenViewing={(trigger) => handleOpenViewing(selection, trigger)}
      onEditObject={editObject}
      selectedHtmlId={selectedHtmlId}
      onAction={geometry.handleSelectionAction}
      moreOpen={menuAnchor !== null}
      onOpenMore={handleSelectionMenu}
      onSelectAll={selectAll}
      onAnnotate={annotation.onAnnotate}
      onRenameSection={onRenameSection}
      clipboard={clipboard.menu}
      textStyleById={textStyleById}
      onFormatObject={handleFormatObject}
    />
  );
  const pendingEdits = moving ? move.pendingEdits : geometry.pendingEdits;
  const pendingPlacement = geometry.pendingPlacement;
  const canvasScene = useMemo(() => {
    const scene = projected.scene;
    if (!pendingPlacement || projection.objectsById.has(pendingPlacement.id)) {
      return scene;
    }

    return { ...scene, objects: [...scene.objects, pendingPlacement] };
  }, [projected.scene, projection.objectsById, pendingPlacement]);
  const canvasSelection = useMemo(() => {
    const id = pendingPlacement?.id;
    return id && selected.includes(id) && !selection.includes(id) ? [...selection, id] : selection;
  }, [pendingPlacement, selected, selection]);
  function renderCanvas(room?: BoardPresenceSlot) {
    return (
      <WorkspaceCanvas
        viewOnly={viewOnly}
        annotating={annotationActive}
        input={{
          ref: canvasRef,
          viewId: board.boardId,
          label: title,
          scene: viewOnly ? projected.scene : canvasScene,
          selection: canvasSelection,
          tool,
          penStyle: { stroke: penColor },
          fitOnMount: features.fitOnMount,
          initialViewport: initial.viewport,
          viewportRequest,
          showGrid,
          presentation: scope,
          selectionActions,
          canEdit,
          pendingResizeObjectId: online && !annotationActive ? pendingPlacement?.id : undefined,
          canEditExpandedObject: canEditExpanded,
          pendingEdits,
          objectExtensions: editService ? studioObjectExtensions : moveExtensions,
          payloadById: projected.payloadById,
          onSelectionChange: changeSelection,
          onToolChange: handleToolChange,
          onContextMenu: handleContextMenu,
          blankDoubleClickPlacement: textExtension.placement,
          editObjectRequest: objectEdit,
          formatObjectRequest,
          onEditIntent: handleEdit,
          canWriteObject: content.canWriteObject,
          onObjectIntent: handleObjectIntent,
          readHtmlSource: features.readHtmlSource,
          downloadFile: features.downloadObjectFile,
          readDocumentAsset: features.readDocumentAsset,
          uploadDocumentImage: features.uploadDocumentImage,
          annotationActive,
          onAnnotateContent: renderFeedback && canComment ? attachContentAnnotation : undefined,
          contentTracking: contentTracking.tracking,
          nativeSourceRequest,
          onOpenNativeSource: openNativeSource,
          nativeSourceLabel,
          onOpenPresentation: handleOpenViewing,
          onClosePresentation: exit,
          onViewportChange: setViewport,
          onViewportSizeChange: setViewportSize,
          onViewportNavigation: viewOnly ? undefined : detachFollow,
          onWorldPointerChange: viewOnly ? undefined : room?.onCursorChange,
          onGesturePreviewChange: room?.onGesturePreviewChange,
          remoteGesturePreviews: room?.remoteGesturePreviews,
          onVisibleObjectsChange: session.observeVisible,
        }}
      />
    );
  }
  const exportAnchor = panels.exportAnchor;

  function handleReviewThread(threadId: string) {
    if (suggestionTrigger.current) {
      panels.openSuggestions(suggestionTrigger.current, threadId);
    }
  }

  function restoreSuggestionsFocus() {
    suggestionTrigger.current?.focus({ preventScroll: true });
  }

  function renderEditNotices() {
    const undoError = 'detail' in undo.state ? undo.state.detail : undefined;
    return (
      <>
        <BoardReadNotices
          state={state}
          session={session}
          unsafePayloadVersion={projected.unsafePayloadVersion}
          renameFailure={boardTitle.failure}
        />
        {sourceIssue && (
          <OperationNotice
            id="native-source-unavailable"
            level="warning"
            message={sourceIssue}
            dismissible
            onDismiss={() => setSourceIssue(undefined)}
          />
        )}
        {clipboard.issue && (
          <OperationNotice
            id="canvas-clipboard-error"
            level="warning"
            message={clipboard.issue}
            dismissible
            onDismiss={clipboard.dismiss}
          />
        )}
        {undoError && (
          <OperationNotice
            id="canvas-history-error"
            level="warning"
            message={undoError}
            actions={
              undo.state.kind === 'unknown'
                ? [
                    {
                      id: 'check',
                      label: '查询回执',
                      onActivate: undo.checkReceipt,
                      disabled: !undo.canRetry,
                    },
                    {
                      id: 'retry',
                      label: '重试',
                      onActivate: undo.retry,
                      disabled: !undo.canRetry,
                    },
                  ]
                : undefined
            }
          />
        )}
      </>
    );
  }

  function renderWorkspace(room?: BoardPresenceSlot) {
    if (room?.accessLost) {
      return (
        <div className="whiteboard-editor__state">
          <StatePanel kind="error" title="白板访问已撤销" />
        </div>
      );
    }

    return (
      <>
        <BoardViewReporter
          boardId={board.boardId}
          selectedIds={selection}
          viewport={viewport}
          focusedObjectId={focusedObjectId}
          returnViewport={returnViewport}
          enabled={!previewing}
          onViewContext={features.onViewContext}
        />
        <WorkspaceHeader
          title={title}
          watching={watching}
          documentReading={documentReading}
          historyPreview={previewing}
          historyOpen={Boolean(panels.historyAnchor)}
          feedbackOpen={panels.feedbackOpen}
          suggestionsOpen={Boolean(panels.suggestionAnchor)}
          suggestionTrigger={suggestionTrigger}
          shareOpen={Boolean(exportAnchor)}
          lanSharing={features.lanSharing ?? lanSharing}
          consumeShareEntry={features.consumeShareEntry}
          annotationActive={annotationActive}
          unresolvedFeedback={unresolvedFeedback}
          writeAccess={board.canEdit}
          moving={moving}
          move={move}
          geometry={geometry}
          notice={content.notice}
          participants={room?.participants}
          onBack={onBack}
          titleEditor={boardTitle.editor}
          {...boardPanelActions(features, panels)}
          onToggleAnnotation={annotation.onToggleAnnotation}
          readNotices={renderEditNotices()}
        />
        {room?.notice}
        <div className="whiteboard-editor__canvas" ref={setCanvasArea}>
          <BoardDraftRecovery
            draftAccess={content.draftAccess}
            readCurrent={(objectId, signal) =>
              readBoardDraftCurrent(service, board.boardId, objectId, signal)
            }
            copyText={features.clipboard?.writeText}
            downloadFile={features.downloadObjectFile}
          />
          <div
            className="whiteboard-editor__live-canvas"
            data-canvas-toolbar-scope=""
            inert={previewing}
            {...clipboard.handlers}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onKeyDown={handleHistoryKey}
            onClick={handleCanvasAnnotation}
          >
            <Viewing
              active={watching}
              documentReading={documentReading}
              title={title}
              viewport={viewport}
              onZoom={handleZoomBoard}
              onFit={fitPresentation}
              onExit={exit}
              onCanvasFocus={focusCanvas}
            >
              {renderCanvas(room)}
            </Viewing>
            {room?.overlay}
            <div hidden={watching}>
              <BoardViewportTools
                zoom={viewport.zoom}
                onZoom={handleManualZoom}
                onFit={handleManualFit}
                hasSelection={selection.length > 0}
                showGrid={showGrid}
                onShowGridChange={setShowGrid}
                singleKeys={singleKeys}
                onSingleKeysChange={setSingleKeys}
                timerEditable={board.canEdit}
                timer={features.renderSharedTimer?.()}
                history={viewportHistory}
              />
              <WorkspaceToolbar
                boardId={board.boardId}
                tool={tool}
                viewport={viewport}
                visible={board.canEdit}
                canInsertImage={board.canEdit}
                mediaPaused={!online}
                canEditGeometry={canInsert}
                renderMedia={features.renderMedia}
                onApplied={handleEditApplied}
                onToolChange={handleToolChange}
                onCanvasFocus={focusCanvas}
                singleKeys={singleKeys}
                penColor={penColor}
                onPenColorChange={setPenColor}
                onAddHtml={canInsert ? handleOpenHtml : undefined}
                onAddLink={canInsert ? () => setLinkCreation(true) : undefined}
                placementPoint={placementPoint}
                onUploadReady={handleUploadReady}
              />
            </div>
            {welcomeAvailable(viewOnly, annotationActive, tool, canvasScene.objects.length) && (
              <BoardWelcome
                canEdit={board.canEdit}
                disabled={!canInsert}
                onAddDocument={handleAddDocument}
                onAddHtml={handleOpenHtml}
              />
            )}
          </div>
          <WorkspacePanels
            features={features}
            feedback={{
              updateKey: room?.feedbackUpdateKey,
              boardId: board.boardId,
              canEdit: canComment,
              viewing: feedbackView.hidingFeedback,
              viewport: feedbackViewport,
              objects: board.objects,
              selectedIds: selection,
              panelOpen: panels.feedbackOpen,
              onPanelOpenChange: panels.setFeedbackOpen,
              anchor: panels.feedbackAnchor,
              focusWorldPoint,
              focusContentObject,
              contentLocations: contentTracking.locations,
              onContentLocationRequests: contentTracking.requestLocations,
              annotationActive,
              onAnnotationActiveChange: changeAnnotation,
              onUnresolvedChange: setUnresolvedFeedback,
              annotationRequest,
              contentAnnotationRequest,
              pointAnnotationRequest,
              hostPicking: true,
              focusedObjectId: feedbackView.focusedObjectId,
              singleKeys,
              onReviewThread: features.renderSuggestions ? handleReviewThread : undefined,
            }}
            history={{
              boardId: board.boardId,
              title,
              revision: board.revision,
              canEdit: mayEdit && !moving && !geometry.hasPendingEdit,
              anchor: panels.historyAnchor,
              onClose: panels.closeHistory,
              onPreviewChange: panels.setHistoryPreview,
              onRestored: handleRestore,
              renderPreview: renderBoardHistoryCanvas,
            }}
            suggestions={{
              updateKey: room?.suggestionsUpdateKey,
              boardId: board.boardId,
              revision: board.revision,
              selection,
              feedbackThreadId: panels.suggestionThreadId,
              previewHost: canvasArea,
              anchor: panels.suggestionAnchor,
              onClose: panels.closeSuggestions,
              restoreFocus: restoreSuggestionsFocus,
              onApplied: handleEditApplied,
              onPreviewChange: panels.setSuggestionPreview,
              renderPreview: (key, changes) => renderSuggestionPreview(key, state, changes),
            }}
          />
        </div>
        <GeometryBoardMenu
          anchor={menuAnchor}
          selection={selectedObjects}
          canEdit={canInsert}
          onAction={geometry.handleSelectionAction}
          onFit={handleManualFit}
          onSelectAll={selectAll}
          onRequestClose={() => setMenuAnchor(null)}
          onRenameSection={onRenameSection}
          clipboard={clipboard.menu}
          returnFocus={focusCanvas}
        />
        {linkCreation && (
          <LinkDialog
            initial={newLink}
            onSave={handleSaveLink}
            onClose={() => setLinkCreation(false)}
            onRestoreFocus={focusCanvas}
            readOnly={!online}
          />
        )}
        <BoardHtmlCreation
          creation={creation}
          geometry={geometry}
          viewport={viewport}
          canInsert={canInsert}
          readHtmlSource={features.readHtmlSource}
          onRestoreFocus={focusCanvas}
        />
        <WorkspaceExport
          anchor={exportAnchor}
          context={{
            boardId: board.boardId,
            title,
            revision: board.revision,
            selectedIds: selection,
            selectedHtmlId,
          }}
          render={renderExport}
          onClose={panels.closeExport}
          onLanSharingChange={setLanSharing}
        />
      </>
    );
  }

  return features.renderPresence
    ? features.renderPresence({
        viewport: viewportSize && { ...viewport, ...viewportSize },
        paused: viewOnly,
        detachSequence,
        onViewportRequest: restoreViewport,
        onContentChanged: session.acceptRoomContent,
        onAccessLost: handleRoomAccessLost,
        render: renderWorkspace,
      })
    : renderWorkspace();
}

interface BoardReadNoticesProps {
  readonly state: ReadyState;
  readonly session: WhiteboardSession;
  readonly unsafePayloadVersion: boolean;
  readonly renameFailure?: ReturnType<typeof useBoardTitle>['failure'];
}

function BoardReadNotices({
  state,
  session,
  unsafePayloadVersion,
  renameFailure,
}: BoardReadNoticesProps) {
  return (
    <>
      {renameFailure && (
        <OperationNotice
          id="whiteboard-rename-failed"
          level="error"
          message={renameFailure.message}
          actions={
            renameFailure.retry && [
              { id: 'retry-rename', label: '重试改名', onActivate: renameFailure.retry },
            ]
          }
        />
      )}
      {state.sceneError && (
        <OperationNotice
          id="whiteboard-reload-failed"
          level="error"
          message={'白板刷新失败。' + state.sceneError}
          actions={[{ id: 'reload', label: '重新加载', onActivate: session.reload }]}
        />
      )}
      {state.payloadError && (
        <OperationNotice
          id="whiteboard-payload-failed"
          level="warning"
          message={'对象正文加载失败。' + state.payloadError}
          actions={[{ id: 'retry-payloads', label: '重试正文', onActivate: session.retryPayloads }]}
        />
      )}
      {unsafePayloadVersion && (
        <OperationNotice
          id="whiteboard-payload-version"
          level="warning"
          message="部分对象的正文版本超出当前画布的安全整数范围。"
        />
      )}
    </>
  );
}

function LoadedBoard({
  state,
  session,
  service,
  createCommandId,
  onBack,
  renameBoard,
  features,
}: BoardSurfaceProps) {
  const projection = useMemo(() => projectScene(state.scene), [state.scene]);
  if (!projection) {
    return (
      <div className="whiteboard-editor__state">
        <StatePanel
          kind="error"
          title="无法打开画布"
          detail="白板或对象的位置版本超出当前画布的安全整数范围。"
          action={<Button label="重新加载" onActivate={session.reload} />}
        />
      </div>
    );
  }

  return (
    <BoardWorkspace
      state={state}
      session={session}
      service={service}
      projection={projection}
      createCommandId={createCommandId}
      onBack={onBack}
      renameBoard={renameBoard}
      features={features}
    />
  );
}

export function WhiteboardEditorSurface({
  boardId,
  service,
  createCommandId,
  onBack,
  renameBoard,
  features,
}: WhiteboardEditorSurfaceProps) {
  const session = useMemo(() => createWhiteboardSession(service, boardId), [service, boardId]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);

  useEffect(() => session.open(), [session]);

  return (
    <section className="whiteboard-editor" aria-label="白板编辑">
      {state.kind === 'loading' && (
        <div className="whiteboard-editor__state">
          <StatePanel kind="initial-loading" title="正在打开白板" />
        </div>
      )}
      {state.kind === 'failed' && (
        <div className="whiteboard-editor__state">
          <StatePanel
            kind="error"
            title="无法打开白板"
            detail={state.message}
            action={<Button label="重新加载" onActivate={session.reload} />}
          />
        </div>
      )}
      {state.kind === 'ready' && (
        <LoadedBoard
          key={boardId}
          state={state}
          session={session}
          service={service}
          createCommandId={createCommandId}
          onBack={onBack}
          renameBoard={renameBoard}
          features={features}
        />
      )}
    </section>
  );
}
