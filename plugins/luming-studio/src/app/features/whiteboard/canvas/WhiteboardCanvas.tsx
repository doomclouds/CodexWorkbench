import { createCanvasClipboard } from './interaction/canvas-clipboard.js';
import { useCanvasWheel } from './interaction/useCanvasWheel.js';
import { CanvasViewportToolbar } from './controls/CanvasViewportToolbar.js';
import { useCommittedRef } from './useCommittedRef.js';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import {
  type Actor,
  type AgentTaskReleaseTarget,
  type Anchor,
  type Board,
  type BoardElement,
  type CollaborationRoom,
  type ElementType,
  type Feedback,
  type HtmlSelection,
  type Json,
  type Operation,
  type Presence,
  type StudioClient,
} from '../../../../contracts/studio.js';

import { CanvasHtmlObject } from './objects/CanvasHtmlObject.js';
import {
  CanvasLocalDraftNotices,
  CanvasSaveNotices,
  DetachedCanvasDraftNotices,
} from './controls/CanvasSaveNotices.js';
import type { HtmlNavigationEvent } from '../../../shared/html-region/runtime.js';
import {
  anchorBounds,
  assetDisplayUrl,
  boundsOf,
  canvasStyle,
  clamp,
  duplicateElements,
  elementBounds,
  fitViewport,
  makeElement,
  newId,
  relativeElementPoint,
  wheelZoomFactor,
  zoomAt,
  type Point,
  type Rect,
  type Viewport,
} from './scene/canvas-model.js';
import { canvasGridSpacing, tableDetail } from './scene/canvas-presentation.js';
import { useCanvasScene } from './scene/useCanvasScene.js';
import { ImageCropDialog } from './objects/NativeMedia.js';
import { measureNativeIssues, type NativeIssue } from './scene/native-issues.js';
import { getBoardSticker } from '../../../../shared/whiteboard-stickers.js';
import { COMMENT_CURSOR } from '../../../shared/comments/cursor.js';
import { useCanvasReading, useCanvasReadingLayout } from './controls/reading/useCanvasReading.js';
import {
  CanvasObject,
  isHtmlEmbed,
  type CanvasObjectScene,
  type CanvasObjectView,
  type CanvasRegionView,
} from './objects/CanvasObject.js';
import { CanvasObjectTextEditor } from './objects/CanvasObjectTextEditor.js';
import {
  acceptTextDraft,
  describeCanvasTextDraft,
  refreshTextDraft,
} from './objects/text/text-draft.js';
import {
  useCanvasTextEditingCommands,
  useCanvasTextEditingState,
} from './objects/text/useCanvasTextEditing.js';
import { projectGestureGeometry, type Gesture } from './interaction/canvas-gesture-placement.js';
import {
  canvasDraftForStorage,
  decodeCanvasDraft,
  promoteCanvasDraft,
  storeCanvasDraft,
  type CanvasDraftRecovery,
  type PropertyDrafts,
  type TextDraft,
} from './sync/canvas-drafts.js';
import { createDraftWorkspace, type DraftWorkspace } from '../draft-workspace.js';
import { DraftRecoveryPicker } from '../DraftRecoveryPicker.js';
import CanvasDialog, { type CanvasDialogSpec } from './controls/CanvasDialog.js';
import type { CanvasCommand } from './controls/CanvasActionsMenu.js';
import {
  CanvasEditingControls,
  CanvasEmptyState,
  type CanvasActionMenuView,
  type CanvasFormatView,
  type Tool,
} from './controls/CanvasEditingControls.js';
import { useCanvasKeyboard } from './interaction/useCanvasKeyboard.js';
import NativeTable from './objects/table/NativeTable.js';
import DocumentRegion, { type DocumentActivity } from './objects/document/DocumentRegion.js';
import { CanvasTodoObject } from './objects/todo/CanvasTodoObject.js';
import { normalizeTodoItems, type TodoSourceRef } from '../../../../contracts/todo.js';
import { defaultDocument, documentOperations } from '../../../../contracts/document.js';
import {
  CanvasMarquee,
  CanvasSelectionOverlays,
  type ArrowPointStart,
} from './interaction/CanvasSelectionOverlays.js';
import type { ConnectionSide } from './interaction/selection-affordances.js';
import type { InlineTextEditorHandle, InlineTextFormatState } from './controls/InlineTextEditor.js';
import { newClientId } from '../../../shared/client-id.js';
import { PEN_CURSOR } from './scene/native-palette.js';
import {
  alignSelection,
  tidySelection,
  geometryBounds,
  selectionBounds as nativeSelectionBounds,
  type ResizeHandle,
  type AlignmentGuide,
} from './scene/native-geometry.js';
import { visibleCommentCorner } from '../../../shared/comments/comment-target.js';
import {
  CanvasFeedbackClusters,
  CanvasFeedbackOverlays,
  CanvasPeerPreviews,
  CanvasPlacementOverlays,
} from './scene/CanvasSceneOverlays.js';
import { copyPlainText } from '../../../clipboard.js';
import { downloadStudioBlob } from '../../../transport/client.js';
import PeerPresenceOverlay from './scene/PeerPresenceOverlay.js';
import {
  isContentDraft,
  sameContentOperations,
  sameContentValue,
  sameWireContentValue,
  NativeContentQueue,
  overlayContent,
  type ContentTask,
  type ContentReceipt,
} from './sync/content-queue.js';
import { useCanvasHistory } from './sync/canvas-history.js';
import type { NativeTableDraft } from './objects/table/NativeTable.js';
import ContentConflictDialog from './controls/ContentConflictDialog.js';
import { useNativeGestureSync, type NativeGesture } from '../../../shared/useNativeGestureSync.js';
import {
  annotationElementLabel,
  completeCanvasGesture,
  type NativeAnnotation,
} from './interaction/canvas-gesture-end.js';
import {
  applyPointerFrame,
  preparePointerRelease,
  focusedDocumentCursor,
  projectPointerFrame,
} from './interaction/canvas-pointer-frame.js';
import { createCanvasPointerCapture } from './interaction/canvas-pointer-capture.js';
import {
  pointerBelongsToObjectControl,
  prepareSelectionTransform,
  selectForPointerMove,
  startCreationGesture,
  startMoveGesture,
  type SelectionTransform,
} from './interaction/canvas-gesture-start.js';
import { CanvasMediaInput, CanvasMediaPlaceholders } from './media/CanvasMediaUpload.js';
import { useCanvasMediaUpload } from './media/useCanvasMediaUpload.js';
import { sendCanvasSave, verifyCanvasSave } from '../save-receipt.js';
import './canvas.css';
import { isEscapeActive } from '../../../shared/escape.js';

export interface WhiteboardCanvasProps {
  board: Board;
  client: StudioClient;
  actor: Actor;
  onChanged: (board: Board) => void;
  onAnnotate: (selection: HtmlSelection, pin?: Anchor['pin']) => void;
  readOnly?: boolean;
  viewTheme?: 'light' | 'dark';
  onSelectionChange?: (ids: string[]) => void;
  onViewportChange?: (viewport: Viewport) => void;
  presence?: Presence[];
  selfPeerId?: string;
  onCursorMove?: (point: Point | null) => void;
  onViewportInteract?: () => void;
  onReleaseAgentTask?: (target: AgentTaskReleaseTarget) => Promise<void>;
  room?: CollaborationRoom;
  externalViewport?: Viewport;
  externalSelectedIds?: string[];
  panelViewId?: string;
  restoreReadingFrom?: string;
  draftWorkspace?: DraftWorkspace;
  onActivityChange?: (state: {
    editingIds: string[];
    movingIds: string[];
    savingIds?: string[];
    dirty: boolean;
    saving?: boolean;
    saveError?: string;
    issues?: NativeIssue[];
  }) => void;
  activities?: Feedback[];
  annotationActive?: boolean;
  annotationTarget?: Anchor;
  activeFeedbackId?: string;
  onAnnotationModeChange?: (active: boolean) => void;
  onAnnotateNative?: (selection: NativeAnnotation) => void;
  onFeedbackSelect?: (feedback: Feedback, screenPoint: Point) => void;
  onReadingChange?: (active: boolean, kind?: 'canvas' | 'document') => void;
  onEditHtml?: (element?: BoardElement) => void;
  documentControls?: ReactNode;
  preview?: boolean;
  contentQueue?: NativeContentQueue;
  clockOffsetMs?: number;
  insertedElementId?: string;
}

export type { NativeAnnotation } from './interaction/canvas-gesture-end.js';

function readCustomColors(nativeInks: string | undefined) {
  const colors = nativeInks ? nativeInks.split(',').map((value) => `#${value}`) : [];
  return colors.every((value) => /^#[0-9a-f]{6}$/i.test(value)) ? colors : null;
}

function errorText(error: unknown): string {
  let message: string;
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === 'object' && error !== null && 'message' in error) {
    message = String(error.message);
  } else {
    message = String(error);
  }
  return /CONFLICT|已被修改|版本/i.test(message)
    ? '对象已被其他人修改，本次更改未覆盖他人的内容。请比较双方内容后选择，或保留草稿。'
    : message;
}

function isEmbeddedStateSave(task: ContentTask, id: string): boolean {
  const operation = task.operations[0];
  return (
    task.operations.length === 1 &&
    operation?.op === 'update' &&
    operation.id === id &&
    Boolean(
      operation.changes &&
      Object.keys(operation.changes).length === 1 &&
      Object.hasOwn(operation.changes, 'state'),
    )
  );
}

function embeddedSaveSourceChanged(task: ContentTask, elements: readonly BoardElement[]): boolean {
  const source = task.sources.find(
    (item) => isHtmlEmbed(item) && isEmbeddedStateSave(task, item.id),
  );

  if (!source) {
    return false;
  }

  const current = elements.find((item) => item.id === source.id);
  return Boolean(
    current &&
    (!isHtmlEmbed(current) ||
      source.sourceRevision !== current.sourceRevision ||
      source.html !== current.html),
  );
}

function isDocumentSave(task: ContentTask, id: string): boolean {
  return (
    (task.stream === '编辑文档' || task.summary === '编辑文档') &&
    task.sources.some((source) => source.id === id && source.type === 'document') &&
    task.operations.length > 0 &&
    task.operations.every(
      (operation) =>
        operation.id === id &&
        (operation.op === 'document' ||
          (operation.op === 'update' &&
            operation.changes &&
            Object.keys(operation.changes).length === 1 &&
            Object.hasOwn(operation.changes, 'text'))),
    )
  );
}

export default function WhiteboardCanvas(props: WhiteboardCanvasProps) {
  const sessionKey = JSON.stringify([
    props.board.artifact.id,
    props.actor.id,
    props.client.baseUrl,
    Boolean(props.preview),
  ]);

  return <CanvasSession key={sessionKey} {...props} />;
}

function isGestureDirty(gesture: Gesture | null): boolean {
  if (!gesture) {
    return false;
  }

  switch (gesture.kind) {
    case 'move':
    case 'connect':
      return gesture.current.x !== gesture.start.x || gesture.current.y !== gesture.start.y;
    case 'resize':
    case 'rotate':
    case 'arrow-point':
      return gesture.operations.length > 0;
    case 'draw':
    case 'create':
      return true;
    case 'annotate':
    case 'marquee':
    case 'pan':
      return false;
  }
}

function findAnnotationHover(
  annotating: boolean,
  gesture: Gesture | null,
  elementId: string | null,
  elements: readonly BoardElement[],
) {
  if (annotating && !gesture) {
    return elements.find((element) => element.id === elementId);
  }

  return undefined;
}

function useCanvasOperationNotice(nativeInks: string | undefined, recoveryError: string) {
  const initialColors = readCustomColors(nativeInks);
  const [error, setError] = useState(
    recoveryError || (initialColors ? '' : '自定义色板数据无效，请重新选择颜色。'),
  );

  const [customColors, setCustomColors] = useState(() => initialColors ?? []);
  const [observedInks, setObservedInks] = useState(nativeInks);
  if (observedInks !== nativeInks) {
    setObservedInks(nativeInks);
    if (initialColors) {
      setCustomColors(initialColors);
    } else {
      setError('自定义色板数据无效，请重新选择颜色。');
    }
  }

  return { error, setError, customColors };
}

function canvasSaveStatus(
  queueSaving: boolean,
  uploading: boolean,
  uploadError: string,
  queueSaveError: string,
  documentActivities: Record<string, DocumentActivity>,
) {
  const documentDirty = Object.values(documentActivities).some((state) => state.dirty);
  const saving =
    queueSaving || uploading || Object.values(documentActivities).some((state) => state.saving);

  const saveError =
    uploadError ||
    queueSaveError ||
    Object.values(documentActivities).find((state) => state.error)?.error ||
    '';

  return { documentDirty, saving, saveError };
}

function useCanvasAnnotationState(
  actorRole: Actor['role'],
  reading: unknown,
  readingDocument: boolean,
  annotationActive: boolean | undefined,
  tool: Tool,
  setTool: (tool: Tool) => void,
  onAnnotationModeChange: WhiteboardCanvasProps['onAnnotationModeChange'],
) {
  const [annotationHoverId, setAnnotationHoverId] = useState<string | null>(null);
  const [localAnnotationTarget, setLocalAnnotationTarget] = useState<Anchor | null>(null);
  const canAnnotate = actorRole !== 'viewer';
  const annotating =
    (!reading || readingDocument) && canAnnotate && (annotationActive ?? tool === 'annotate');
  const annotationCallback = useCommittedRef(onAnnotationModeChange);
  const [observedAnnotation, setObservedAnnotation] = useState({ annotationActive, annotating });
  if (
    observedAnnotation.annotationActive !== annotationActive ||
    observedAnnotation.annotating !== annotating
  ) {
    setObservedAnnotation({ annotationActive, annotating });
    setAnnotationHoverId(null);
    if (observedAnnotation.annotationActive !== annotationActive && annotationActive === false) {
      if (tool === 'annotate') {
        setTool('select');
      }
      setLocalAnnotationTarget(null);
    }
  }

  return {
    canAnnotate,
    annotating,
    annotationCallback,
    annotationHoverId,
    setAnnotationHoverId,
    localAnnotationTarget,
    setLocalAnnotationTarget,
  };
}

function useCanvasBoardReconciliation(
  board: Board,
  selection: string[],
  setSelection: (selection: string[]) => void,
  editing: TextDraft | null,
  setEditing: (draft: TextDraft | null) => void,
  queueTasks: ContentTask[],
) {
  const [observedBoard, setObservedBoard] = useState(board);
  if (observedBoard !== board) {
    setObservedBoard(board);
    const remaining = selection.filter((id) => board.elements.some((element) => element.id === id));
    if (selection.length !== remaining.length) {
      setSelection(remaining);
    }
    const refreshedDraft = refreshTextDraft(editing, board.elements, queueTasks);
    if (refreshedDraft !== editing) {
      setEditing(refreshedDraft);
    }
  }
}

function canvasInputTool(
  tool: Tool,
  gesture: Gesture | null,
  spacePan: boolean,
  annotating: boolean,
): Tool {
  if (spacePan || gesture?.kind === 'pan') {
    return 'pan';
  }

  return annotating ? 'annotate' : tool;
}

function canCropStillImage(element: BoardElement) {
  const isStillImage = element.type === 'image' && Boolean(element.src) && !element.video;
  return isStillImage && !element.locked;
}

interface GesturePreview {
  ids: string[];
  kind: NativeGesture['kind'];
  origin: 'create' | 'existing';
}

function describeGesturePreview(gesture: Gesture): GesturePreview | null {
  switch (gesture.kind) {
    case 'move':
      return gesture.dragging
        ? { ids: gesture.ids, kind: 'move', origin: gesture.copies ? 'create' : 'existing' }
        : null;
    case 'resize':
      return gesture.operations.length
        ? { ids: gesture.ids, kind: 'resize', origin: 'existing' }
        : null;
    case 'rotate':
      return gesture.operations.length
        ? { ids: gesture.ids, kind: 'turn', origin: 'existing' }
        : null;
    case 'arrow-point':
      return gesture.operations.length
        ? { ids: [gesture.element.id], kind: 'arrow', origin: 'existing' }
        : null;
    case 'draw':
      return {
        ids: [gesture.element.id],
        kind: gesture.element.type === 'stroke' ? 'ink' : 'arrow',
        origin: 'create',
      };
    case 'create':
      return { ids: [gesture.element.id], kind: 'shape', origin: 'create' };
    case 'connect':
      return { ids: ['connection-preview'], kind: 'arrow', origin: 'create' };
    case 'pan':
    case 'marquee':
    case 'annotate':
      return null;
  }
}

function currentMoveElements(
  moving: Extract<Gesture, { kind: 'move' }>,
  elements: BoardElement[],
  patches: Operation[],
) {
  return moving.copies
    ? [...elements, ...projectGestureGeometry(moving.copies, patches)]
    : projectGestureGeometry(elements, patches);
}

function canvasViewportTabIndex(readingDocument: boolean) {
  return readingDocument ? undefined : 0;
}

function canvasViewportStyle(
  gesture: Gesture | null,
  viewport: Viewport,
  showGrid: boolean,
  reading: boolean,
): CSSProperties {
  return {
    cursor: gesture?.kind === 'pan' ? 'grabbing' : undefined,
    backgroundPosition: `${viewport.x}px ${viewport.y}px`,
    backgroundSize: `${canvasGridSpacing(viewport.zoom)}px ${canvasGridSpacing(viewport.zoom)}px`,
    ...(!showGrid || reading ? { backgroundImage: 'none' } : {}),
  };
}

function toggleBulletList(text: string) {
  if (text.split('\n').every((line) => /^- /.test(line))) {
    return text.replace(/^- /gm, '');
  }

  return text.replace(/^(?!- )/gm, '- ');
}

function CanvasSession({
  board,
  client,
  actor,
  onChanged,
  onAnnotate,
  readOnly,
  viewTheme = 'light',
  onSelectionChange,
  onViewportChange,
  presence = [],
  selfPeerId,
  onCursorMove,
  externalViewport,
  externalSelectedIds,
  panelViewId,
  restoreReadingFrom,
  draftWorkspace: sharedDraftWorkspace,
  onActivityChange,
  activities = [],
  annotationActive,
  annotationTarget,
  activeFeedbackId,
  onAnnotationModeChange,
  onAnnotateNative,
  onFeedbackSelect,
  onReadingChange,
  onEditHtml,
  documentControls,
  preview,
  contentQueue,
  room,
  onViewportInteract,
  onReleaseAgentTask,
  clockOffsetMs,
  insertedElementId,
}: WhiteboardCanvasProps) {
  const viewportElement = useRef<HTMLDivElement>(null);
  const [viewportHost, setViewportHost] = useState<{
    element: HTMLDivElement;
    portalRoot: HTMLElement | null;
  } | null>(null);
  const bindViewport = useCallback((element: HTMLDivElement | null) => {
    viewportElement.current = element;
    setViewportHost(
      element
        ? {
            element,
            portalRoot:
              element.closest<HTMLElement>('.studio-session-content') ??
              element.closest<HTMLElement>('.studio'),
          }
        : null,
    );
  }, []);
  const htmlInput = useRef<HTMLInputElement>(null);
  const boardRef = useRef(board);
  useLayoutEffect(() => {
    if (board.artifact.revision >= boardRef.current.artifact.revision) {
      boardRef.current = board;
    }
  }, [board]);
  const onChangedRef = useCommittedRef(onChanged);
  const selectionCallback = useCommittedRef(onSelectionChange);
  const viewportCallback = useCommittedRef(onViewportChange);
  const [tool, setTool] = useState<Tool>('select');
  const {
    viewport,
    setViewport,
    presentationZoom,
    openingViewportReady,
    viewportRef,
    savedReadingIds,
    reading,
    readingRef,
    readingStorageId,
    restoredReadingScroll,
    readingDocument,
    documentFocusSurface,
    restoreOpeningReadingView,
    regionScrolled,
    enterReading,
    handleExitReading,
    requestExitReading,
    handleDocumentFocusSurface,
    renderReadingControls,
    renderReadingMarker,
    readingLayout,
  } = useCanvasReading({
    board,
    boardRef,
    viewportElement,
    panelViewId,
    restoreReadingFrom,
    preview,
    externalViewport,
    onReadingChange,
    onViewportInteract: () => viewportInteract.current?.(),
    cancelCanvasInput: () => {
      handleGestureCancel();
      setPointer(null);
    },
    closeCanvasMenus: () => {
      setMenu(null);
      setZoomMenu(false);
      setToolMenu(null);
    },
    setTool,
  });
  const [shapeKind, setShapeKind] = useState('rounded');
  const [lastShapeTool, setLastShapeTool] = useState<'shape' | 'table'>('shape');
  const [lastDrawTool, setLastDrawTool] = useState<'stroke' | 'arrow'>('stroke');
  const [selection, setSelection] = useState<string[]>(
    () =>
      externalSelectedIds?.filter((id) => board.elements.some((element) => element.id === id)) ??
      savedReadingIds ??
      [],
  );
  const selectionRef = useCommittedRef(selection);
  const interactionIntent = useRef(0);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [queueSaving, setQueueSaving] = useState(false);
  const [documentActivities, setDocumentActivities] = useState<Record<string, DocumentActivity>>(
    {},
  );
  const [documentEditRequest, setDocumentEditRequest] = useState<{
    id: string;
    sequence: number;
  }>();

  const [draftWorkspace] = useState(
    () =>
      sharedDraftWorkspace ??
      createDraftWorkspace(client, actor.id, board.artifact.id, panelViewId, restoreReadingFrom),
  );
  const [draftSlot] = useState(() => draftWorkspace.open('canvas'));
  const [draftRecovery, clearDraftRecovery] = useState<CanvasDraftRecovery>({
    draft: null,
    error: '',
    discardEmpty: false,
  });
  const { draft: recovered } = draftRecovery;
  const { error, setError, customColors } = useCanvasOperationNotice(
    board.style.nativeInks,
    draftRecovery.error,
  );
  const reportCanvasFailure = useCallback(
    (failure: unknown) => setError(errorText(failure)),
    [setError],
  );
  const [toolNotice, setToolNotice] = useState('');
  const [queueSaveError, setQueueSaveError] = useState('');
  const textEditing = useCanvasTextEditingState();
  const { editing, setEditing } = textEditing;
  const [dialog, setDialog] = useState<CanvasDialogSpec | null>(null);
  const [cropDialog, setCropDialog] = useState<BoardElement | null>(null);
  const [dialogDirty, setDialogDirty] = useState(false);
  const [propertyDrafts, setPropertyDrafts] = useState<PropertyDrafts>({});
  const draftsRef = useCommittedRef(propertyDrafts);
  const [propertyEditingIds, setPropertyEditingIds] = useState<string[]>([]);

  const [comparison, setComparison] = useState<string | null>(null);
  const [comparisonBoard, setComparisonBoard] = useState<Board | null>(null);
  const [detachedTask, setDetachedTask] = useState<ContentTask | null>(null);
  const [draftGeneration, setDraftGeneration] = useState(0);
  const [tableDrafts, setTableDrafts] = useState<Record<string, NativeTableDraft>>({});
  const [issues, setIssues] = useState<NativeIssue[]>([]);
  const activityCallback = useCommittedRef(onActivityChange);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [singleKeys, setSingleKeys] = useState(true);
  const [guides, setGuides] = useState<AlignmentGuide[]>([]);
  const [pointer, setPointer] = useState<Point | null>(null);
  const textEditor = useRef<InlineTextEditorHandle>(null);
  const [formatState, setFormatState] = useState<InlineTextFormatState>();
  const [linkRequest, setLinkRequest] = useState<{ key: string; value: string }>();
  const [zoomMenu, setZoomMenu] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [toolMenu, setToolMenu] = useState<'shape' | 'sticker' | null>(null);
  const [penColor, setPenColor] = useState('#0B0B0B');
  const penWidth = 3;
  const [sticker, setSticker] = useState('smile');
  const viewStyle = useMemo(() => canvasStyle(board.style, viewTheme), [board.style, viewTheme]);
  const clipboard = useRef<BoardElement[]>([]);
  const spaceHeld = useRef(false);
  const [pointerCapture] = useState(createCanvasPointerCapture);
  const [spacePan, setSpacePan] = useState(false);
  const [objectEditRequest, setObjectEditRequest] = useState<{ id: string; sequence: number }>();
  const canEdit = !readOnly && !preview && ['owner', 'editor'].includes(actor.role);
  const canEditRef = useCommittedRef(canEdit);
  const {
    gestures: peerGestures,
    publish: publishGesture,
    confirm: confirmGesture,
    fail: failGesture,
    previewStatus,
    previewError,
  } = useNativeGestureSync({ room, document: board, selfPeerId, readOnly: !canEdit, preview });
  const publishedGesture = useRef<NativeGesture | undefined>(undefined);
  const viewportInteract = useCommittedRef(onViewportInteract);
  const [, renderAssets] = useState(0);
  useEffect(() => client.subscribeAssets?.(() => renderAssets((value) => value + 1)), [client]);
  const [regionFailures, setRegionFailures] = useState(() => new Map<string, string>());
  const queueScope = `${board.artifact.id}:${actor.id}`;
  const currentScope = useCommittedRef(queueScope);
  const [localQueue] = useState(
    () =>
      new NativeContentQueue({
        send: (args) => sendCanvasSave(client, () => board, args),
        confirm: (args) => verifyCanvasSave(client, () => board, args),
        accepted: () => {},
        changed: () => {},
      }),
  );
  const queue = contentQueue ?? localQueue;
  const media = useCanvasMediaUpload({
    client,
    author: actor.name,
    scope: queueScope,
    canEdit,
    room,
    queue,
    getBoard: () => boardRef.current,
    getIntent: () => interactionIntent.current,
    preparePlacement: () => chooseTool('select'),
    selectPlaced(ids) {
      selectIds(ids);
      setTool('select');
      setToolMenu(null);
      setMenu(null);
    },
    setError,
    notify: setToolNotice,
    formatError: errorText,
    reportFailure: reportCanvasFailure,
  });
  const { view: mediaUpload, uploading, uploadError } = media;
  const { documentDirty, saving, saveError } = canvasSaveStatus(
    queueSaving,
    uploading,
    uploadError,
    queueSaveError,
    documentActivities,
  );
  useLayoutEffect(() => {
    if (!contentQueue) {
      localQueue.setSender(
        (args) => sendCanvasSave(client, () => boardRef.current, args),
        (args) => verifyCanvasSave(client, () => boardRef.current, args),
      );
    }
  }, [client, contentQueue, localQueue]);
  const activeQueue = useCommittedRef(queue);
  const { undo, redo, historyError, clearHistoryError, changeHistory, recordUndoEntry } =
    useCanvasHistory({
      queue,
      getBoard: () => boardRef.current,
      canEdit: () => canEditRef.current,
      isCurrent: () => activeQueue.current === queue && currentScope.current === queueScope,
    });
  const [queueView, setQueueView] = useState(() => ({
    queue,
    tasks: queue.tasks.map((task) => ({ ...task })),
  }));
  const queueTasks = queueView.queue === queue ? queueView.tasks : queue.tasks;
  const queueDrafts = useMemo(() => queueTasks.filter(isContentDraft), [queueTasks]);
  const unconfirmedHistory = queueTasks.find((task) => task.history && task.state === 'failed');
  const handleQueueChange = () => {
    setQueueSaving(queue.tasks.some((task) => task.state !== 'failed'));
    const failed = queue.drafts.find((task) => task.state === 'failed');
    setQueueSaveError(failed ? errorText(failed.failure ?? failed.error) : '');
    const tasks = queue.tasks.map((task) => ({ ...task }));
    setRegionFailures((current) => {
      const remaining = new Map(
        [...current].filter(([id]) => tasks.some((task) => task.id === id)),
      );

      return remaining.size === current.size ? current : remaining;
    });
    media.queueChanged();
    setQueueView({ queue, tasks });
  };
  const reportRegionSaveFailure = (
    elementId: string,
    task: ContentTask | undefined,
    fallback: string,
  ) => {
    if (task) {
      setRegionFailures((current) =>
        current.has(task.id) ? current : new Map(current).set(task.id, elementId),
      );
    }
    return task?.failure instanceof Error ? task.failure : new Error(task?.error || fallback);
  };
  const acceptQueueChange = (task: ContentTask, response: ContentReceipt) => {
    media.queueAccepted(task, response.board);
    if (response.board.artifact.revision >= boardRef.current.artifact.revision) {
      boardRef.current = response.board;
      if (!contentQueue) {
        onChangedRef.current(response.board);
      }
    }
    setEditing((current) => acceptTextDraft(current, task, response.board.elements));

    if (task.remember) {
      recordUndoEntry(task, response);
    }
  };
  const queueCallbacks = useCommittedRef({
    changed: handleQueueChange,
    accepted: acceptQueueChange,
  });
  useLayoutEffect(() => {
    queue.observe(board);
  }, [board, queue]);
  useLayoutEffect(() => {
    const unsubscribe = queue.subscribe({
      changed: () => queueCallbacks.current.changed(),
      accepted: (task, receipt) => queueCallbacks.current.accepted(task, receipt),
    });

    return () => {
      unsubscribe();
      if (!contentQueue) {
        queue.setEnabled(false);
      }
    };
  }, [queue, queueCallbacks, contentQueue]);
  useEffect(() => {
    queue.setEnabled(canEdit && !preview);
  }, [queue, canEdit, preview]);
  const {
    canAnnotate,
    annotating,
    annotationCallback,
    annotationHoverId,
    setAnnotationHoverId,
    localAnnotationTarget,
    setLocalAnnotationTarget,
  } = useCanvasAnnotationState(
    actor.role,
    reading,
    readingDocument,
    annotationActive,
    tool,
    setTool,
    onAnnotationModeChange,
  );
  const annotationMode = useRef(annotating);
  useLayoutEffect(() => {
    annotationMode.current = annotating;
  }, [annotating, setAnnotationHoverId]);
  const handleAnnotationModeChange = (active: boolean) => {
    annotationMode.current = active;
    onAnnotationModeChange?.(active);
    setTool(active ? 'annotate' : 'select');
    setToolMenu(null);
    updateGesture(null);
  };
  const contentElements = useMemo(
    () =>
      preview
        ? board.elements
        : overlayContent(board.elements, queueTasks).map((element) => ({
            ...element,
            ...propertyDrafts[element.id]?.changes,
          })),
    [board.elements, preview, propertyDrafts, queueTasks],
  );
  const committedHtml = useMemo(
    () => new Map(board.elements.filter(isHtmlEmbed).map((element) => [element.id, element])),
    [board.elements],
  );
  const { selectedElements, selected } = useMemo(() => {
    const selectedElements = contentElements.filter((element) => selection.includes(element.id));
    return {
      selectedElements,
      selected: selectedElements.length === 1 ? selectedElements[0] : undefined,
    };
  }, [contentElements, selection]);
  const updateGesture = useCallback((value: Gesture | null) => {
    if (value && !['pan', 'marquee', 'annotate'].includes(value.kind)) {
      value = {
        ...value,
        operationId: value.operationId ?? gestureRef.current?.operationId ?? newClientId('op'),
        baseRevision:
          value.baseRevision ??
          gestureRef.current?.baseRevision ??
          boardRef.current.artifact.revision,
      };
    }
    gestureRef.current = value;
    setGesture(value);
  }, []);
  const handleGestureCancel = () => {
    setAnnotationHoverId(null);
    if (publishedGesture.current) {
      publishGesture({ ...publishedGesture.current, cancelled: true });
    }
    publishedGesture.current = undefined;
    updateGesture(null);
  };
  useEffect(() => {
    if (!annotating) {
      return;
    }

    const host = viewportElement.current!;
    const clearHidden = () => {
      if (document.hidden || !isEscapeActive(host)) {
        setAnnotationHoverId(null);
      }
    };
    const clear = () => setAnnotationHoverId(null);
    const observer = new MutationObserver(clearHidden);
    for (let ancestor: HTMLElement | null = host; ancestor; ancestor = ancestor.parentElement) {
      observer.observe(ancestor, {
        attributes: true,
        attributeFilter: ['hidden', 'inert', 'aria-hidden', 'style', 'class'],
      });
    }
    document.addEventListener('visibilitychange', clearHidden);
    window.addEventListener('blur', clear);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', clearHidden);
      window.removeEventListener('blur', clear);
    };
  }, [annotating, setAnnotationHoverId]);

  const nativeIssuesTimer = useRef<number | undefined>(undefined);
  const nativeIssuesSettlingMs = 120;
  const scheduleNativeIssues = useEffectEvent((host: HTMLDivElement) => {
    window.clearTimeout(nativeIssuesTimer.current);
    if (gestureRef.current) {
      return;
    }

    nativeIssuesTimer.current = window.setTimeout(() => {
      if (gestureRef.current || viewportElement.current !== host) {
        return;
      }

      const next = measureNativeIssues(host);
      setIssues((current) => (sameContentValue(current, next) ? current : next));
    }, nativeIssuesSettlingMs);
  });
  useEffect(() => {
    const host = viewportHost?.element;
    if (!host) {
      return;
    }

    const observer =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => scheduleNativeIssues(host))
        : undefined;
    observer?.observe(host);
    return () => {
      window.clearTimeout(nativeIssuesTimer.current);
      observer?.disconnect();
    };
  }, [viewportHost]);
  const hasGesture = gesture !== null;
  useEffect(() => {
    const host = viewportHost?.element;
    if (host) {
      scheduleNativeIssues(host);
    }
  }, [
    viewportHost,
    contentElements,
    viewport,
    presentationZoom,
    viewStyle,
    reading,
    editing?.id,
    hasGesture,
  ]);
  const movingIds = useMemo(() => {
    switch (gesture?.kind) {
      case 'move':
        return gesture.dragging ? gesture.ids : [];
      case 'resize':
      case 'rotate':
        return gesture.operations.length ? gesture.ids : [];
      case 'arrow-point':
        return gesture.operations.length ? [gesture.element.id] : [];
      case undefined:
      case 'annotate':
      case 'connect':
      case 'create':
      case 'draw':
      case 'marquee':
      case 'pan':
        return [];
    }
  }, [gesture]);
  const editingId = editing?.id;
  const dialogElementId = dialog?.element?.id;
  const cropId = cropDialog?.id;
  const editingIds = useMemo(
    () =>
      [
        ...new Set([
          ...(editingId ? [editingId] : []),
          ...(dialogElementId ? [dialogElementId] : []),
          ...(cropId ? [cropId] : []),
          ...propertyEditingIds,
          ...Object.entries(documentActivities)
            .filter(([, state]) => state.editing || state.dirty)
            .map(([id]) => id),
          ...Object.keys(propertyDrafts),
        ]),
      ].filter((id) => !movingIds.includes(id)),
    [
      editingId,
      dialogElementId,
      cropId,
      propertyEditingIds,
      documentActivities,
      propertyDrafts,
      movingIds,
    ],
  );
  const savingIds = [
    ...new Set(
      queue.tasks
        .filter((task) => task.state !== 'failed')
        .flatMap((task) => task.keys.filter((key) => key !== '$board' && key !== '$order')),
    ),
  ];
  const { emptyTextBlocked, failedEmptyTextDelete, pendingTextDiffers, textDirty } =
    describeCanvasTextDraft({
      editing,
      elements: board.elements,
      projectedElements: contentElements,
      tasks: queue.tasks,
      taskView: queueTasks,
      pendingDelete: textEditing.pendingDelete,
    });
  const activity = describeCanvasActivity();
  useEffect(() => {
    activityCallback.current?.(JSON.parse(activity));
  }, [activity, activityCallback]);
  useEffect(
    () => () =>
      activityCallback.current?.({ editingIds: [], movingIds: [], dirty: false, issues: [] }),
    [activityCallback],
  );
  const activeDraft = canvasDraftForStorage(
    editing,
    textDirty,
    propertyDrafts,
    tableDrafts,
    queueDrafts,
  );
  const [draftStorageError, setDraftStorageError] = useState('');
  useEffect(() => {
    if (preview) {
      return;
    }

    const currentDraft = canvasDraftForStorage(
      editing,
      textDirty,
      propertyDrafts,
      tableDrafts,
      queueDrafts,
    );

    let warning = '';
    try {
      if (currentDraft || draftSlot.current()) {
        storeCanvasDraft(draftSlot, currentDraft, draftRecovery);
      }
    } catch (failure) {
      const message = currentDraft
        ? '本机草稿保存失败，请复制草稿或下载副本后再关闭。'
        : '无法清理本机草稿，重新打开时可能仍会显示旧草稿。';

      warning = message + errorText(failure);
    }

    let current = true;
    queueMicrotask(() => {
      if (current) {
        setDraftStorageError(warning);
      }
    });

    return () => {
      current = false;
    };
  }, [
    draftRecovery,
    draftSlot,
    editing,
    preview,
    propertyDrafts,
    queueDrafts,
    tableDrafts,
    textDirty,
  ]);

  const selectIds = useCallback(
    (ids: string[], recordIntent = true) => {
      if (recordIntent && !sameContentValue(ids, selectionRef.current)) {
        interactionIntent.current++;
      }
      setSelection(ids);
      selectionRef.current = ids;
    },
    [selectionRef],
  );
  useEffect(() => {
    selectionCallback.current?.(selection);
  }, [selection, selectionCallback]);
  useEffect(() => {
    if (openingViewportReady) {
      viewportCallback.current?.(viewport);
    }
  }, [openingViewportReady, viewport, viewportCallback]);
  useCanvasBoardReconciliation(board, selection, setSelection, editing, setEditing, queueTasks);
  useEffect(restoreOpeningReadingView, [restoreOpeningReadingView]);
  useEffect(() => {
    if (!readingRef.current && externalSelectedIds) {
      selectIds(
        externalSelectedIds.filter((id) =>
          boardRef.current.elements.some((element) => element.id === id),
        ),
      );
    }
  }, [externalSelectedIds, selectIds, readingRef]);
  const revealInsertedElement = useEffectEvent((id: string) => {
    const element = boardRef.current.elements.find((item) => item.id === id);
    const host = viewportElement.current;
    if (!element || !host) {
      return;
    }

    handleGestureCancel();
    setTool('select');
    setToolMenu(null);
    setMenu(null);
    selectIds([element.id]);
    viewportInteract.current?.();
    setViewport(fitViewport([element], host.clientWidth || 900, host.clientHeight || 600));
  });
  useEffect(() => {
    if (insertedElementId) {
      revealInsertedElement(insertedElementId);
    }
  }, [insertedElementId]);

  const apply = useCallback(
    async (
      operations: Operation[],
      summary: string,
      sourceElements?: BoardElement[],
      remember = true,
      operationId?: string,
    ): Promise<Board | null> => {
      if (!canEditRef.current || preview || !operations.length) {
        return null;
      }

      return (
        (
          await queue.enqueue(
            boardRef.current,
            operations,
            summary,
            sourceElements,
            remember,
            summary,
            operationId,
          )
        )?.board ?? null
      );
    },
    [queue, preview, canEditRef],
  );

  const handleCustomColorsChange = (colors: string[]) => {
    const nativeInks = colors
      .slice(-64)
      .map((color) => color.slice(1))
      .join(',');

    if (nativeInks !== (boardRef.current.style.nativeInks ?? '')) {
      apply([{ op: 'style', style: { nativeInks } }], '修改自定义墨色').catch(reportCanvasFailure);
    }
  };
  const stageSelected = (changes: Partial<BoardElement>) => {
    const next = { ...draftsRef.current };
    for (const element of boardRef.current.elements.filter((element) =>
      selectionRef.current.includes(element.id),
    )) {
      const draft = next[element.id] ?? { base: element, changes: {} };
      const patch = { ...draft.changes, ...changes };
      for (const key of Object.keys(patch)) {
        if (
          sameWireContentValue(patch[key], draft.base[key]) &&
          !queue.tasks.some((task) => task.keys.includes(element.id))
        ) {
          delete patch[key];
        }
      }
      if (Object.keys(patch).length) {
        next[element.id] = { base: draft.base, changes: patch };
      } else {
        delete next[element.id];
      }
    }
    draftsRef.current = next;
    setPropertyDrafts(next);
    return next;
  };
  const savePropertyDrafts = async (
    ids = selectionRef.current,
    summary = '调整元素',
    colors?: string[],
  ) => {
    const drafts = ids.flatMap((id) =>
      draftsRef.current[id] ? [{ id, ...draftsRef.current[id] }] : [],
    );
    const operations: Operation[] = drafts.map((draft) => ({
      op: 'update',
      id: draft.id,
      changes: draft.changes,
    }));
    const nativeInks = colors
      ?.slice(-64)
      .map((color) => color.slice(1))
      .join(',');

    if (nativeInks !== undefined && nativeInks !== (boardRef.current.style.nativeInks ?? '')) {
      operations.push({ op: 'style', style: { nativeInks } });
    }
    if (!operations.length) {
      return;
    }

    const saved = await apply(
      operations,
      summary,
      drafts.length ? drafts.map((draft) => draft.base) : undefined,
    );
    const next = { ...draftsRef.current };
    for (const draft of drafts) {
      if (!next[draft.id]) {
        continue;
      }

      if (saved && sameWireContentValue(next[draft.id].changes, draft.changes)) {
        delete next[draft.id];
      }
    }
    draftsRef.current = next;
    setPropertyDrafts(next);
    return saved;
  };
  const updateSelected = async (
    changes: Partial<BoardElement>,
    summary = '调整元素',
    colors?: string[],
  ) => {
    stageSelected(changes);
    await savePropertyDrafts(selectionRef.current, summary, colors);
  };
  const addElements = async (
    elements: BoardElement[],
    summary: string,
    options: { edit?: boolean; operationId?: string } = {},
  ) => {
    const saved = await apply(
      elements.map((element) => ({ op: 'add', id: element.id, element })),
      summary,
      undefined,
      true,
      options.operationId,
    );

    if (saved) {
      selectIds(elements.map((element) => element.id));
      setTool('select');
      setToolMenu(null);
      setMenu(null);
      textEditing.rememberCreatedText(elements);
      if (options.edit) {
        const next = saved.elements.find((element) => element.id === elements[0]?.id);
        if (next) {
          beginEditing(next);
        }
      }
    }
    return saved;
  };
  const { beginEditing, commitEditing, handleCancelEmptyText } = useCanvasTextEditingCommands({
    state: textEditing,
    canEdit,
    canAutosave: canEdit && !preview,
    textDirty,
    queueDrafts,
    reportCanvasFailure,
    pendingTextDiffers,
    isReading: () => Boolean(readingRef.current),
    onBeginEditing: () => {
      interactionIntent.current++;
    },
    readBoard: () => boardRef.current,
    readIntendedElements: () =>
      overlayContent(boardRef.current.elements, queue.tasks).map((element) => ({
        ...element,
        ...draftsRef.current[element.id]?.changes,
      })),
    readEditorHeight: () =>
      viewportElement.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.scrollHeight,
    focusViewport: () => viewportElement.current?.focus({ preventScroll: true }),
    queue,
    deselectDeletedText: (id) =>
      selectIds(
        selectionRef.current.filter((value) => value !== id),
        false,
      ),
    setError,
    apply,
    addAdjacentText: (element) => addElements([element], '添加相邻元素', { edit: true }),
  });
  const boardPoint = (clientX: number, clientY: number): Point => {
    const rect = viewportElement.current?.getBoundingClientRect();
    const current = viewportRef.current;
    return {
      x: (clientX - (rect?.left ?? 0) - current.x) / current.zoom,
      y: (clientY - (rect?.top ?? 0) - current.y) / current.zoom,
    };
  };
  const centerPoint = (): Point => {
    const host = viewportElement.current;
    return {
      x: ((host?.clientWidth ?? 900) / 2 - viewportRef.current.x) / viewportRef.current.zoom - 150,
      y: ((host?.clientHeight ?? 600) / 2 - viewportRef.current.y) / viewportRef.current.zoom - 100,
    };
  };
  const htmlNavigation = (element: BoardElement, input: HtmlNavigationEvent) => {
    if (input.kind === 'space') {
      if (input.held) {
        setAnnotationHoverId(null);
      }
      spaceHeld.current = input.held;
      setSpacePan(input.held);
      return;
    }
    if (input.kind === 'zoom') {
      viewportInteract.current?.();
      const point = anchorBounds(
        { coordinateSpace: 'element', elementIds: [element.id], x: input.x, y: input.y },
        [element],
      );

      if (point) {
        setViewport((current) =>
          zoomAt(
            current,
            { x: current.x + point.x * current.zoom, y: current.y + point.y * current.zoom },
            current.zoom * wheelZoomFactor(input.deltaY, input.deltaMode),
          ),
        );
      }
      return;
    }
    if (input.phase === 'start') {
      viewportInteract.current?.();
      handleGestureCancel();
      updateGesture({
        kind: 'pan',
        start: { x: input.screenX, y: input.screenY },
        viewport: viewportRef.current,
        frame: { regionId: element.id, pointerId: input.pointerId },
      });

      return;
    }
    const current = gestureRef.current;
    if (
      current?.kind !== 'pan' ||
      current.frame?.regionId !== element.id ||
      current.frame.pointerId !== input.pointerId
    ) {
      return;
    }

    if (input.phase !== 'cancel') {
      setViewport({
        ...current.viewport,
        x: current.viewport.x + input.screenX - current.start.x,
        y: current.viewport.y + input.screenY - current.start.y,
      });
    }
    if (input.phase === 'end' || input.phase === 'cancel') {
      updateGesture(null);
    }
  };
  const fit = (scope: 'all' | 'selection' | 'auto' = 'auto') => {
    viewportInteract.current?.();
    const host = viewportElement.current;
    const bounds = nativeSelectionBounds(
      boardRef.current.elements,
      scope !== 'all' && selectionRef.current.length
        ? selectionRef.current
        : boardRef.current.elements.map((element) => element.id),
    );

    if (host && bounds) {
      setViewport(
        fitViewport(
          [bounds],
          host.clientWidth,
          host.clientHeight,
          72,
          scope === 'selection' ? 8 : 1,
        ),
      );
    }
  };
  const handleOpenTodoSource = (source: TodoSourceRef) => {
    const current = boardRef.current;
    if (
      (source.artifactId && source.artifactId !== current.artifact.id) ||
      !current.elements.some((element) => element.id === source.elementId)
    ) {
      setToolNotice('当前白板找不到这条任务的来源。');
      return;
    }
    if (readingRef.current) {
      handleExitReading();
    }
    selectIds([source.elementId]);
    fit('selection');
    let unitSelector = '';
    if (source.blockId) {
      unitSelector = `[data-document-block-id="${CSS.escape(source.blockId)}"]`;
    } else if (source.itemId) {
      unitSelector = `[data-todo-item-id="${CSS.escape(source.itemId)}"]`;
    }
    if (unitSelector) {
      requestAnimationFrame(() => {
        viewportElement.current
          ?.querySelector(`[data-element-id="${CSS.escape(source.elementId)}"] ${unitSelector}`)
          ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      });
    }
  };
  const readSelection = async () => {
    if (readingRef.current || !selectionRef.current.length) {
      return;
    }

    const selectedIds = [...selectionRef.current];
    const scope = currentScope.current;
    if (editing && !(await commitEditing())) {
      return;
    }
    if (selectedIds.some((id) => draftsRef.current[id]) && !(await savePropertyDrafts())) {
      return;
    }
    if (
      !viewportElement.current ||
      scope !== currentScope.current ||
      !sameContentValue(selectedIds, selectionRef.current)
    ) {
      return;
    }

    enterReading(selectedIds, tool);
  };
  const requestDocumentEdit = async (id: string) => {
    if (
      !canEdit ||
      !boardRef.current.elements.some((element) => element.id === id && element.type === 'document')
    ) {
      return;
    }

    handleAnnotationModeChange(false);
    selectIds([id]);
    if (!readingRef.current) {
      await readSelection();
    }
    if (readingRef.current?.ids.length === 1 && readingRef.current.ids[0] === id) {
      setDocumentEditRequest((value) => ({ id, sequence: (value?.sequence ?? 0) + 1 }));
    }
  };
  const addDocument = async () => {
    if (!canEdit) {
      return;
    }

    if (await chooseTool('document')) {
      viewportElement.current?.focus({ preventScroll: true });
    }
  };
  useCanvasReadingLayout(readingLayout);
  const stepZoom = (factor: number) => {
    viewportInteract.current?.();
    const host = viewportElement.current;
    setViewport((value) =>
      zoomAt(
        value,
        { x: (host?.clientWidth ?? 900) / 2, y: (host?.clientHeight ?? 600) / 2 },
        value.zoom * factor,
      ),
    );
  };

  const remove = () => {
    const elements = boardRef.current.elements.filter((element) =>
      selectionRef.current.includes(element.id),
    );

    if (!elements.length) {
      return;
    }

    if (elements.some((element) => element.locked)) {
      setError('请先解锁位置，再删除所选元素。');
      return;
    }
    apply(
      elements.map((element) => ({ op: 'delete', id: element.id })),
      '删除元素',
      elements,
    )
      .then((saved) => {
        if (saved) {
          selectIds([]);
        }
      })
      .catch(reportCanvasFailure);
  };
  const duplicate = (fromClipboard = false) => {
    const source =
      fromClipboard && clipboard.current.length ? clipboard.current : boardRef.current.elements;
    const ids =
      fromClipboard && clipboard.current.length
        ? source.map((element) => element.id)
        : selectionRef.current;
    const copies = duplicateElements(source, ids);
    if (copies.length) {
      addElements(copies, '复制元素').catch(reportCanvasFailure);
    }
  };
  const group = async () => {
    if (selectionRef.current.length < 2) {
      return;
    }

    const groupId = newId();
    await updateSelected({ groupId }, '组合元素');
  };

  const createSelectionSection = async (elements: BoardElement[], ids: string[]) => {
    if (!canEditRef.current || readingRef.current) {
      return;
    }

    const selected = elements.filter((element) => ids.includes(element.id));
    if (selected.length < 2) {
      return;
    }

    const boxes = selected.map((element) => {
      const body = geometryBounds(element, elements);
      if (element.type !== 'container' && element.type !== 'html') {
        return body;
      }

      const title = viewportElement.current
        ?.querySelector<HTMLElement>(
          `[data-element-id="${element.id}"] > [data-canvas-external-title]`,
        )
        ?.getBoundingClientRect();

      if (title?.width && title.height) {
        const topLeft = boardPoint(title.left, title.top);
        const bottomRight = boardPoint(title.right, title.bottom);
        return boundsOf([
          body,
          { ...topLeft, w: bottomRight.x - topLeft.x, h: bottomRight.y - topLeft.y },
        ])!;
      }
      const titleSpace = element.type === 'html' ? 32 : 10 + (element.fontSize ?? 17) * 1.5;
      return { ...body, y: body.y - titleSpace, h: body.h + titleSpace };
    });
    const bounds = boundsOf(boxes)!;
    const padding = 24;
    const frame = makeElement(
      'container',
      { x: bounds.x - padding, y: bounds.y - padding },
      { w: bounds.w + 2 * padding, h: bounds.h + 2 * padding, fill: 'transparent' },
    );
    const scope = currentScope.current;
    const intent = interactionIntent.current;
    const saved = await apply(
      [{ op: 'add', id: frame.id, element: frame, data: { beforeId: selected[0]!.id } }],
      '从选区创建分区',
    );

    if (saved && currentScope.current === scope && interactionIntent.current === intent) {
      selectIds([frame.id]);
    }
  };
  const canvasClipboard = () =>
    createCanvasClipboard({
      selection: () => ({ elements: boardRef.current.elements, ids: selectionRef.current }),
      remember: (elements) => {
        clipboard.current = elements;
      },
      canPaste: !reading && canEdit,
      addElements,
      makeText: (element) => makeElement('text', centerPoint(), element),
      uploadFiles: (files) => uploadMedia(files),
      reportFailure: reportCanvasFailure,
    });

  const handleCanvasCommand = async (action: CanvasCommand) => {
    const elements = boardRef.current.elements;
    const ids = selectionRef.current;
    switch (action) {
      case 'copy':
      case 'cut':
        try {
          await canvasClipboard().copySelection();
          if (action === 'cut') {
            remove();
          }
        } catch (failure) {
          reportCanvasFailure(failure);
        }

        return;
      case 'paste':
        await canvasClipboard().pasteFromClipboard().catch(reportCanvasFailure);
        return;
      case 'duplicate':
        duplicate();
        return;
      case 'delete':
        remove();
        return;
      case 'select-all':
        selectIds(elements.map((element) => element.id));
        return;
      case 'fit':
        fit('all');
        return;
      case 'fit-selection':
        fit('selection');
        return;
      case 'group':
        group().catch(reportCanvasFailure);
        return;
      case 'ungroup':
        updateSelected({ groupId: '' }, '取消组合').catch(reportCanvasFailure);
        return;
      case 'create-section':
        await createSelectionSection(elements, ids);
        return;
      case 'lock':
        updateSelected(
          {
            locked: !elements
              .filter((element) => ids.includes(element.id))
              .every((element) => element.locked),
          },
          '锁定位置与尺寸',
        ).catch(reportCanvasFailure);

        return;
      case 'tidy':
        apply(tidySelection(elements, ids), '整理元素', elements).catch(reportCanvasFailure);
        return;
      case 'front':
      case 'back':
      case 'forward':
      case 'backward':
        apply([{ op: 'layout', preset: action, ids }], '调整层级', elements).catch(
          reportCanvasFailure,
        );

        return;
    }
  };

  const handleOpenActionsMenu = async (point: Point) => {
    if (editing && !(await commitEditing())) {
      return;
    }
    if (selectionRef.current.some((id) => draftsRef.current[id]) && !(await savePropertyDrafts())) {
      return;
    }

    const rect = viewportElement.current?.getBoundingClientRect();
    setMenu({ x: point.x - (rect?.left ?? 0), y: point.y - (rect?.top ?? 0) });
  };
  const chooseTool = async (
    choice: Tool,
    nextMenu: 'shape' | 'sticker' | null = null,
    notifyAnnotation = true,
  ) => {
    interactionIntent.current++;
    if (choice === 'annotate' && (!canAnnotate || preview)) {
      return false;
    }
    if (editing && !(await commitEditing())) {
      return false;
    }
    if (selectionRef.current.some((id) => draftsRef.current[id]) && !(await savePropertyDrafts())) {
      return false;
    }

    handleGestureCancel();
    setMenu(null);
    setZoomMenu(false);
    setTool(choice);
    setToolMenu(nextMenu);
    setToolNotice('');
    if (choice === 'arrow' || choice === 'stroke') {
      setLastDrawTool(choice);
    }
    if (choice === 'shape' || choice === 'table') {
      setLastShapeTool(choice);
    }
    if (notifyAnnotation) {
      if (choice === 'annotate') {
        annotationCallback.current?.(true);
      } else if (annotationMode.current) {
        annotationCallback.current?.(false);
      }
    }
    return true;
  };
  const openHtmlEditor = async (element?: BoardElement) => {
    if (!(await chooseTool('select'))) {
      return;
    }

    if (onEditHtml) {
      onEditHtml(element);
    } else {
      setDialog({ type: 'html', element });
    }
  };
  const editSelected = () => {
    const selected =
      selectionRef.current.length === 1 &&
      boardRef.current.elements.find((element) => element.id === selectionRef.current[0]);
    const usingSelectionTool = !annotating && tool === 'select';
    if (!selected || !canEdit || !usingSelectionTool) {
      return false;
    }

    if (isHtmlEmbed(selected)) {
      openHtmlEditor(selected).catch(reportCanvasFailure);
    } else if (selected.type === 'document') {
      requestDocumentEdit(selected.id).catch(reportCanvasFailure);
    } else if (selected.type === 'link') {
      setDialog({ type: 'link', element: selected });
    } else if (selected.type === 'image') {
      if (!selected.src || selected.video || selected.locked) {
        return false;
      }

      setCropDialog(selected);
    } else if (selected.type === 'table' || selected.type === 'todo') {
      setObjectEditRequest((current) => ({
        id: selected.id,
        sequence: (current?.sequence ?? 0) + 1,
      }));
    } else if (
      !['stroke', 'diagram', 'chart'].includes(selected.type) &&
      !(selected.type === 'sticker' && getBoardSticker(selected.data?.stickerIconId))
    ) {
      beginEditing(selected);
    } else {
      return false;
    }
    updateGesture(null);
    return true;
  };
  const chooseToolRef = useCommittedRef(chooseTool);
  useEffect(() => {
    if (
      annotationActive !== true ||
      !viewportElement.current ||
      !isEscapeActive(viewportElement.current)
    ) {
      return;
    }

    chooseToolRef
      .current('annotate', null, false)
      .then((accepted) => {
        if (!accepted) {
          annotationCallback.current?.(false);
        }
      })
      .catch(reportCanvasFailure);
  }, [annotationActive, annotationCallback, chooseToolRef, reportCanvasFailure]);

  const handleCanvasEscape = (target: EventTarget | null) => {
    if (readingRef.current && annotationMode.current) {
      handleAnnotationModeChange(false);
      return true;
    }
    if (readingRef.current) {
      requestExitReading().catch(reportCanvasFailure);
      return true;
    }
    if (
      target instanceof Element &&
      target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')
    ) {
      return false;
    }

    if (menu) {
      setMenu(null);
    } else if (zoomMenu) {
      setZoomMenu(false);
    } else if (toolMenu) {
      setToolMenu(null);
    } else if (gestureRef.current) {
      handleGestureCancel();
    } else if (annotationMode.current) {
      setAnnotationHoverId(null);
      setTool('select');
      annotationCallback.current?.(false);
    } else if (tool !== 'select') {
      setTool('select');
    } else if (target instanceof HTMLIFrameElement) {
      viewportElement.current?.focus({ preventScroll: true });
    } else {
      selectIds([]);
    }
    return true;
  };

  const activateNumericTool = useCanvasKeyboard({
    viewportElement,
    viewportRef,
    boardRef,
    readingRef,
    documentFocusSurface,
    selectionRef,
    gestureRef,
    clipboard,
    spaceHeld,
    blocked: [menu, zoomMenu, toolMenu, dialog, cropDialog, comparison, detachedTask].some(Boolean),
    singleKeys,
    canEdit,
    canAnnotate: canAnnotate && !preview,
    actions: {
      remove,
      duplicate,
      changeHistory,
      fit,
      handleCanvasCommand,
      stepZoom,
      chooseTool,
      editSelected,
    },
    onEscape: handleCanvasEscape,
    selectIds,
    updateGesture,
    setSpacePan,
    setAnnotationHoverId,
    setViewport,
    apply,
    reportCanvasFailure,
  });
  useCanvasWheel({
    viewportElement,
    boardRef,
    readingRef,
    documentFocusSurface,
    viewportInteract,
    setViewport,
  });

  const handleNavigationCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const panToolActive = tool === 'pan' && !annotationMode.current;
    const navigation = pointerCapture.prepareNavigation(
      event,
      spaceHeld.current || panToolActive,
      Boolean(readingRef.current),
    );

    if (!navigation) {
      return;
    }

    if (navigation.kind === 'document-control') {
      selectIds([navigation.id]);
      return;
    }

    viewportInteract.current?.();
    event.preventDefault();
    event.stopPropagation();
    handleGestureCancel();
    viewportElement.current?.setPointerCapture(event.pointerId);
    updateGesture({
      kind: 'pan',
      start: { x: event.clientX, y: event.clientY },
      viewport: viewportRef.current,
      pointerId: event.pointerId,
      documentId: documentFocusSurface.current?.id,
    });
  };

  const nativeAnnotationHit = (target: Element): BoardElement | 'blocked' | undefined => {
    if (
      target.closest(
        '[data-document-content],[data-document-controls],[data-todo-item-id],iframe,.studio-html-state-error',
      )
    ) {
      return 'blocked';
    }

    const id = target.closest('[data-element-id]')?.getAttribute('data-element-id');
    if (id) {
      return contentElements.find((element) => element.id === id) ?? 'blocked';
    }

    return target.closest('[data-native-interactive]') ? 'blocked' : undefined;
  };
  const handleAnnotationClickCapture = (event: ReactMouseEvent) => {
    if (annotating && nativeAnnotationHit(event.target as Element) !== 'blocked') {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const handleAnnotationHover = (event: ReactPointerEvent) => {
    if (!annotating || gestureRef.current || spaceHeld.current) {
      return;
    }

    const target = isEscapeActive(event.currentTarget as HTMLDivElement)
      ? nativeAnnotationHit(event.target as Element)
      : undefined;
    setAnnotationHoverId(target && target !== 'blocked' ? target.id : null);
  };
  const begin = (event: ReactPointerEvent<Element>, element?: BoardElement, moveHandle = false) => {
    const annotating = !moveHandle && annotationMode.current;
    const pointerTool = moveHandle ? 'select' : tool;
    if (event.button !== 0) {
      return;
    }

    pointerCapture.beginPrimaryPointer();
    const annotationHit = annotating ? nativeAnnotationHit(event.target as Element) : undefined;
    if (annotationHit === 'blocked') {
      return;
    }
    if (pointerBelongsToObjectControl(event, element, annotating, moveHandle)) {
      return;
    }

    if (readingRef.current) {
      pointerCapture.suppressNavigationClick();
      event.preventDefault();
      event.stopPropagation();
      viewportElement.current?.setPointerCapture(event.pointerId);
      updateGesture({
        kind: 'pan',
        start: { x: event.clientX, y: event.clientY },
        viewport: viewportRef.current,
      });

      return;
    }
    interactionIntent.current++;
    setToolMenu(null);
    setZoomMenu(false);
    setMenu(null);
    if (dialog) {
      return;
    }

    function commitTextBeforePointer(activeDraft: TextDraft) {
      event.preventDefault();
      event.stopPropagation();
      if (element?.id === activeDraft.id) {
        textEditor.current?.focus();
        return;
      }
      const intent = interactionIntent.current;
      const scope = currentScope.current;
      commitEditing()
        .then((saved) => {
          const sameInteraction =
            scope === currentScope.current && intent === interactionIntent.current;

          if (!saved || !viewportElement.current || !sameInteraction) {
            return;
          }

          selectIds(
            element && saved.elements.some((value) => value.id === element.id) ? [element.id] : [],
          );
          viewportElement.current.focus({ preventScroll: true });
        })
        .catch(reportCanvasFailure);

      return;
    }
    function startElementMove(element: BoardElement, host: HTMLDivElement, point: Point) {
      event.stopPropagation();
      event.preventDefault();
      const { ids, newlySingle, toggleOff } = selectForPointerMove(
        element,
        contentElements,
        selectionRef.current,
        event.shiftKey,
      );

      if (isHtmlEmbed(element) && (moveHandle || newlySingle)) {
        host.setPointerCapture(event.pointerId);
      }
      selectIds(ids);
      if (!canEdit || element.locked || toggleOff) {
        return;
      }

      updateGesture(
        startMoveGesture(
          contentElements,
          ids,
          point,
          { x: event.clientX, y: event.clientY },
          event.altKey,
        ),
      );
    }
    function startObjectCreation(host: HTMLDivElement, point: Point) {
      if (!canEdit) {
        return;
      }
      if (pointerTool === 'sticker' && !getBoardSticker(sticker)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      host.setPointerCapture(event.pointerId);
      updateGesture(
        startCreationGesture(pointerTool as ElementType, point, element, {
          shapeKind,
          pen: { color: penColor, width: penWidth },
          sticker,
        }),
      );
    }
    if (editing) {
      commitTextBeforePointer(editing);
      return;
    }
    const host = viewportElement.current;
    if (!host) {
      return;
    }

    host.focus({ preventScroll: true });
    if ((pointerTool === 'pan' && !annotating) || spaceHeld.current) {
      viewportInteract.current?.();
      event.preventDefault();
      event.stopPropagation();
      host.setPointerCapture(event.pointerId);
      updateGesture({
        kind: 'pan',
        start: { x: event.clientX, y: event.clientY },
        viewport: viewportRef.current,
      });

      return;
    }
    const point = boardPoint(event.clientX, event.clientY);
    runPointerTool(host, point, annotationHit);

    function runPointerTool(
      host: HTMLDivElement,
      point: Point,
      annotationHit: BoardElement | undefined,
    ) {
      if (annotating) {
        setAnnotationHoverId(null);
        event.preventDefault();
        event.stopPropagation();
        host.setPointerCapture(event.pointerId);
        selectIds(annotationHit ? [annotationHit.id] : []);
        setLocalAnnotationTarget(null);
        updateGesture({ kind: 'annotate', start: point, end: point, element: annotationHit });
        return;
      }
      if (pointerTool === 'select' && element) {
        startElementMove(element, host, point);
        return;
      }
      if (pointerTool === 'select') {
        event.preventDefault();
        host.setPointerCapture(event.pointerId);
        updateGesture({ kind: 'marquee', start: point, end: point, additive: event.shiftKey });
        if (!event.shiftKey) {
          selectIds([]);
        }
        return;
      }
      startObjectCreation(host, point);
    }
  };
  const moveRegion = (event: ReactPointerEvent, element: BoardElement) => {
    if (event.button !== 0 || readingRef.current) {
      return;
    }

    handleAnnotationModeChange(false);
    setTool('select');
    handleGestureCancel();
    begin(event, element, true);
  };
  const startSelectionTransform = (event: ReactPointerEvent, transform: SelectionTransform) => {
    const primaryEditPointer = event.button === 0 && canEdit && !annotating;
    if (!primaryEditPointer) {
      return;
    }

    const prepared = prepareSelectionTransform(transform, contentElements, selectionRef.current);
    if (!prepared) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    viewportElement.current?.setPointerCapture(event.pointerId);
    updateGesture({ ...prepared, start: boardPoint(event.clientX, event.clientY) });
  };
  const handleResizeStart = (event: ReactPointerEvent, handle: ResizeHandle) =>
    startSelectionTransform(event, { kind: 'resize', handle });
  const handleRotateStart = (event: ReactPointerEvent) =>
    startSelectionTransform(event, { kind: 'rotate' });
  const handleConnectStart = (
    event: ReactPointerEvent,
    element: BoardElement,
    side: ConnectionSide,
  ) => {
    const primaryEditPointer = event.button === 0 && canEdit && !annotating;
    if (!primaryEditPointer || editing || element.locked) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    viewportElement.current?.setPointerCapture(event.pointerId);
    const point = boardPoint(event.clientX, event.clientY);
    updateGesture({ kind: 'connect', start: point, current: point, element, side });
  };
  const handlePointerMove = (event: ReactPointerEvent) => {
    const screen = { x: event.clientX, y: event.clientY };
    const hovering = boardPoint(screen.x, screen.y);
    const surface = documentFocusSurface.current;
    if (surface && readingRef.current) {
      const host = viewportElement.current!.getBoundingClientRect();
      const point = { x: screen.x - host.left, y: screen.y - host.top };
      const target = boardRef.current.elements.find((element) => element.id === surface.id);
      onCursorMove?.(focusedDocumentCursor(point, surface.clip, target));
    } else {
      onCursorMove?.(hovering);
    }
    if (
      canEdit &&
      !annotating &&
      ['text', 'shape', 'note', 'container', 'table', 'sticker', 'document', 'todo'].includes(tool)
    ) {
      setPointer(hovering);
    }

    const current = gestureRef.current;
    if (current?.kind === 'pan' && current.frame) {
      return;
    }

    handleAnnotationHover(event);
    if (!current) {
      return;
    }

    const frame = projectPointerFrame(
      current,
      {
        point: boardPoint(screen.x, screen.y),
        screen,
        zoom: viewportRef.current.zoom,
        modifiers: event,
      },
      boardRef.current.elements,
    );

    applyPointerFrame(frame, {
      surface,
      capture: () => viewportElement.current?.setPointerCapture(event.pointerId),
      setViewport,
      setGuides,
      updateGesture,
      onDrawingLimit(message) {
        setToolNotice(message);
        handlePointerUp(event);
      },
    });
  };

  const handlePointerUp = (event: ReactPointerEvent) => {
    const screen = { x: event.clientX, y: event.clientY };
    const release = preparePointerRelease(
      gestureRef.current,
      screen,
      documentFocusSurface.current,
      () => ({
        point: boardPoint(screen.x, screen.y),
        zoom: viewportRef.current.zoom,
        modifiers: event,
        elements: boardRef.current.elements,
      }),
    );

    if (!release) {
      return;
    }

    const { placed, point } = release;
    const previous = publishedGesture.current;
    updateGesture(null);
    setGuides([]);
    if (viewportElement.current?.hasPointerCapture(event.pointerId)) {
      viewportElement.current.releasePointerCapture(event.pointerId);
    }

    completeCanvasGesture(
      placed,
      {
        point: placed.kind === 'annotate' ? boardPoint(screen.x, screen.y) : point,
        screen,
        zoom: viewportRef.current.zoom,
        shiftKey: event.shiftKey,
        elements: boardRef.current.elements,
        selectedIds: selectionRef.current,
        pen: { color: penColor, width: penWidth },
      },
      {
        presence: {
          previous,
          preview(value) {
            publishedGesture.current = value;
            publishGesture(value);
          },
          publish: publishGesture,
          confirm: confirmGesture,
          fail: failGesture,
        },
        write: {
          add: addElements,
          apply: (operations, summary, sources, operationId) =>
            apply(operations, summary, sources, true, operationId),
          reportFailure: reportCanvasFailure,
        },
        select: selectIds,
        annotate(local, annotation) {
          setLocalAnnotationTarget(local);
          onAnnotateNative?.(annotation);
        },
        documentPlaced() {
          pointerCapture.documentPlaced();
          setTool('select');
        },
        notify: setToolNotice,
      },
    );
  };

  const {
    renderedElements,
    arrowElementIndex,
    sectionTitles,
    titleCandidates,
    surfaceScene,
    peerPreviewFrames,
  } = useCanvasScene({
    contentElements,
    movingIds,
    editingIds,
    queueTasks,
    peerGestures,
    presence,
    gesture,
    zoom: viewport.zoom,
    penColor,
    penWidth,
    presentationZoom,
    editingId: editing?.id,
    reading,
    viewStyle,
    viewTheme,
    currentMoveElements,
  });
  const publishGesturePreview = useEffectEvent((gesture: Gesture | null, enabled: boolean) => {
    const view = enabled && gesture ? describeGesturePreview(gesture) : null;
    const operationId = gesture?.operationId;
    if (!view || !operationId) {
      if (publishedGesture.current) {
        publishGesture(undefined);
      }
      publishedGesture.current = undefined;
      return;
    }

    const { ids, kind, origin } = view;
    const next: NativeGesture = {
      id: operationId,
      operationId,
      origin,
      baseRevision: gesture?.baseRevision,
      kind,
      elements: renderedElements.filter((element) => ids.includes(element.id)),
    };
    publishedGesture.current = next;
    publishGesture(next);
  });
  useEffect(() => {
    publishGesturePreview(gesture, canEdit && !preview);
  }, [gesture, canEdit, preview, publishGesture]);

  const uploadMedia = (files: FileList | File[] | null, position = centerPoint()) =>
    media.upload(files, position);

  function handleEmbeddedNumericTool(key: string) {
    activateNumericTool(key);
  }

  async function persistEmbeddedState(element: BoardElement, state: Json, expectedVersion: number) {
    const current = boardRef.current.elements.find((item) => item.id === element.id);
    if (!current) {
      throw new Error('此嵌入区域已被删除，交互草稿仍保留。');
    }

    const operations: Operation[] = [{ op: 'update', id: element.id, changes: { state } }];
    const failed = queue.drafts.find(
      (task) => task.state === 'failed' && task.keys.includes(element.id),
    );

    if (failed && !isEmbeddedStateSave(failed, element.id)) {
      throw new Error('此区域还有未确认的画布操作，请先处理对应的画布通知。');
    }
    if (failed && embeddedSaveSourceChanged(failed, boardRef.current.elements)) {
      throw new Error('HTML 源码已有变化，请先处理旧的交互草稿。');
    }

    const replay = !!failed && sameContentOperations(failed.operations, operations);
    const source = queue.source(element.id, expectedVersion);
    if (!replay && !source) {
      throw new Error('嵌入内容的编辑基准已过期，请保留草稿后重新打开。');
    }

    const previous = failed ? await queue.retry(failed.id) : null;
    if (failed && !previous) {
      throw reportRegionSaveFailure(element.id, failed, '交互状态未能保存。');
    }

    const saved = replay
      ? previous?.board
      : await apply(operations, '更新嵌入交互状态', [source!], false);
    const next = saved?.elements.find((item) => item.id === element.id);
    if (!next) {
      const task = queue.drafts.find(
        (candidate) => candidate.state === 'failed' && isEmbeddedStateSave(candidate, element.id),
      );

      throw reportRegionSaveFailure(element.id, task, '交互状态未能保存。');
    }
    return { state: next.state ?? null, version: next.version };
  }

  function handleTodoItemAnnotation(element: BoardElement, itemId: string, point?: Point) {
    const item = normalizeTodoItems(element.data?.items).find((row) => row.id === itemId);
    const row = viewportElement.current?.querySelector(
      `[data-todo-id="${CSS.escape(element.id)}"] [data-todo-item-id="${CSS.escape(itemId)}"]`,
    );
    const bounds = row?.getBoundingClientRect();
    if (!item || !bounds) {
      return;
    }
    if (!bounds.width || !bounds.height) {
      return;
    }

    const tip = point ?? { x: bounds.right - 8, y: bounds.bottom - 4 };
    const pin: NonNullable<Anchor['pin']> = {
      coordinateSpace: 'todo',
      x: clamp((tip.x - bounds.left) / bounds.width, 0, 1),
      y: clamp((tip.y - bounds.top) / bounds.height, 0, 1),
    };
    const anchor: Anchor = {
      coordinateSpace: 'todo',
      elementIds: [element.id],
      itemId,
      sourceVersion: element.version,
      quote: item.text.slice(0, 240),
      pin,
    };
    selectIds([element.id]);
    onAnnotateNative?.({
      anchor,
      label: item.text || '任务项',
      versions: { [element.id]: element.version },
      screenPoint: tip,
    });
  }

  function handleDocumentInteraction(element: BoardElement, active: boolean) {
    if (active) {
      selectIds([element.id]);
      setTool('select');
    } else if (!readingRef.current) {
      selectIds([]);
      viewportElement.current?.focus({ preventScroll: true });
    }
  }

  function handleArrowLabelDoubleClick(
    event: ReactMouseEvent<SVGPathElement>,
    element: BoardElement,
  ) {
    event.stopPropagation();
    if (canEdit && !annotating) {
      beginEditing(element);
    }
  }

  function expandRegion(id: string) {
    selectIds([id]);
    readSelection().catch(reportCanvasFailure);
  }

  function updateRegionEditing(id: string, active: boolean) {
    setPropertyEditingIds((ids) =>
      active ? [...new Set([...ids, id])] : ids.filter((editingId) => editingId !== id),
    );
  }

  async function saveRegionOperations(
    id: string,
    operations: Operation[],
    base: BoardElement,
    summary: string,
  ) {
    const failed = queue.drafts.find(
      (task) => task.state === 'failed' && sameContentOperations(task.operations, operations),
    );
    const saved = failed
      ? (await queue.retry(failed.id))?.board
      : await apply(operations, summary, [base]);

    return saved?.elements.find((item) => item.id === id) ?? false;
  }

  function renderHtmlRegion(element: BoardElement, inlineSelected: boolean) {
    const handleHtmlAnnotation: NonNullable<
      ComponentProps<typeof CanvasHtmlObject>['onAnnotate']
    > = (selection) => {
      selectIds([element.id]);
      const point = selection.screenPoint;
      if (point) {
        onAnnotate(selection, { coordinateSpace: 'board', ...boardPoint(point.x, point.y) });
      } else {
        onAnnotate(selection);
      }
    };
    const handleUseSharedHtmlState: NonNullable<
      ComponentProps<typeof CanvasHtmlObject>['onUseSharedState']
    > = () => {
      for (const task of queue.drafts) {
        if (task.state === 'failed' && isEmbeddedStateSave(task, element.id)) {
          queue.discard(task.id);
        }
      }
    };

    return (
      <CanvasHtmlObject
        element={element}
        committedState={committedHtml.get(element.id)}
        zoom={viewport.zoom}
        annotation={annotating}
        interactive={
          reading ? reading.ids.includes(element.id) : inlineSelected && gesture?.kind !== 'move'
        }
        initialScroll={
          restoredReadingScroll?.elementId === element.id ? restoredReadingScroll : undefined
        }
        onReadingScroll={
          reading && readingStorageId ? (point) => regionScrolled(element.id, point) : undefined
        }
        panMode={spacePan || (tool === 'pan' && !annotating)}
        onNavigation={(input) => htmlNavigation(element, input)}
        onCursorMove={onCursorMove}
        onAnnotate={handleHtmlAnnotation}
        onToolShortcut={handleEmbeddedNumericTool}
        onUseSharedState={handleUseSharedHtmlState}
        onStateChange={
          canEdit
            ? (state, expectedVersion) => persistEmbeddedState(element, state, expectedVersion)
            : undefined
        }
      />
    );
  }

  function renderTodo(element: BoardElement, view: CanvasObjectView, region: CanvasRegionView) {
    return (
      <CanvasTodoObject
        element={element}
        interactive={view.expanded || view.inlineSelected}
        expanded={view.expanded}
        size={region.size}
        zoom={viewport.zoom}
        activities={activities}
        onFeedbackSelect={onFeedbackSelect}
        canEdit={canEdit && !preview && !annotating}
        annotationActive={annotating && canAnnotate && !preview}
        editRequest={objectEditRequest?.id === element.id ? objectEditRequest.sequence : undefined}
        styleProfile={board.style}
        onMoveStart={(event) => moveRegion(event, element)}
        onExpand={() => expandRegion(element.id)}
        onOpenSource={handleOpenTodoSource}
        sourceLabel={(source) =>
          !source.artifactId || source.artifactId === board.artifact.id
            ? board.elements.find((item) => item.id === source.elementId)?.text
            : undefined
        }
        onEditingChange={(active) => updateRegionEditing(element.id, active)}
        onSave={(operations, base) =>
          saveRegionOperations(element.id, operations, base, '编辑任务清单')
        }
        onAnnotateItem={(itemId, point) => handleTodoItemAnnotation(element, itemId, point)}
      />
    );
  }

  function renderDocument(element: BoardElement) {
    const handleDocumentActivity: NonNullable<
      ComponentProps<typeof DocumentRegion>['onActivity']
    > = (state) => {
      setDocumentActivities((previous) => {
        if (sameContentValue(previous[element.id], state)) {
          return previous;
        }

        return { ...previous, [element.id]: state };
      });
    };
    const handleSaveDocument: NonNullable<ComponentProps<typeof DocumentRegion>['onSave']> = async (
      document,
      title,
      base,
      overwrite,
    ) => {
      const operations: Operation[] = [];
      const blocks = documentOperations(base.document ?? defaultDocument(), document);
      if (blocks.length) {
        operations.push({ op: 'document', id: element.id, data: { operations: blocks } });
      }
      if (title !== base.text) {
        operations.push({ op: 'update', id: element.id, changes: { text: title } });
      }
      let failed = queue.drafts.find(
        (task) => task.state === 'failed' && isDocumentSave(task, element.id),
      );

      if (overwrite && failed) {
        queue.discard(failed.id);
        failed = undefined;
      }
      if (
        queue.tasks.some(
          (task) =>
            (!task.history || task.state !== 'failed') &&
            (task.keys.includes(element.id) || task.keys.includes('$board')) &&
            task.id !== failed?.id,
        )
      ) {
        throw new Error('此文档还有未确认的白板操作，请先返回画板处理，再比较最新内容后保存正文。');
      }
      if (!operations.length) {
        return base;
      }
      if (failed && !sameContentOperations(failed.operations, operations)) {
        throw new Error('前次文档草稿尚未保存，请先比较最新内容后保存。');
      }

      const saved = failed
        ? (await queue.retry(failed.id))?.board
        : await apply(operations, '编辑文档', [base]);
      const next = saved?.elements.find((item) => item.id === element.id);
      if (next) {
        return next;
      }

      const task = queue.drafts.find(
        (candidate) => candidate.state === 'failed' && isDocumentSave(candidate, element.id),
      );

      if (task) {
        throw reportRegionSaveFailure(element.id, task, '文档尚未保存，请比较最新内容或重试。');
      }

      return false;
    };
    const handleUseCurrentDocument: NonNullable<
      ComponentProps<typeof DocumentRegion>['onUseCurrent']
    > = () => {
      for (const task of queue.drafts) {
        if (task.state === 'failed' && isDocumentSave(task, element.id)) {
          queue.discard(task.id);
        }
      }
    };
    const handleDocumentAnnotation: NonNullable<
      ComponentProps<typeof DocumentRegion>['onAnnotate']
    > = (anchor, version, screenPoint) => {
      selectIds([element.id]);
      onAnnotateNative?.({
        anchor,
        label: '文档选区 · ' + (element.text || '文档'),
        versions: { [element.id]: version },
        screenPoint,
      });
    };

    return (
      <DocumentRegion
        boardPoint={boardPoint}
        activities={activities}
        onFeedbackSelect={onFeedbackSelect}
        annotationActive={annotating}
        onAnnotationModeChange={handleAnnotationModeChange}
        styleProfile={board.style}
        onMoveStart={(event) => moveRegion(event, element)}
        element={element}
        artifactId={board.artifact.id}
        draftWorkspace={draftWorkspace}
        actor={actor}
        client={client}
        canEdit={canEdit && !preview}
        canAnnotate={canAnnotate && !preview}
        interactive={
          reading
            ? reading.ids.includes(element.id)
            : selection.length === 1 && selection[0] === element.id
        }
        expanded={!!reading && reading.ids.length === 1 && reading.ids[0] === element.id}
        initialScrollTop={
          restoredReadingScroll?.elementId === element.id ? restoredReadingScroll.y : undefined
        }
        onReadingScroll={
          readingStorageId ? (point) => regionScrolled(element.id, point) : undefined
        }
        focusHost={viewportHost?.element ?? null}
        theme={viewTheme}
        readingZoom={viewport.zoom}
        editRequest={
          documentEditRequest?.id === element.id ? documentEditRequest.sequence : undefined
        }
        target={annotationTarget}
        onInteract={(active) => handleDocumentInteraction(element, active)}
        onEdit={() => {
          requestDocumentEdit(element.id).catch(reportCanvasFailure);
        }}
        onExpand={() => expandRegion(element.id)}
        onExit={handleExitReading}
        onFocusSurface={(surface) => handleDocumentFocusSurface(element.id, surface)}
        onActivity={handleDocumentActivity}
        onSave={handleSaveDocument}
        onUseCurrent={handleUseCurrentDocument}
        onAnnotate={handleDocumentAnnotation}
      />
    );
  }

  function renderTable(
    element: BoardElement,
    { picked, expanded }: CanvasObjectView,
    { size, fontSize, fill, ink, headerInk }: CanvasRegionView,
  ) {
    const handleTableDraftChange: NonNullable<
      ComponentProps<typeof NativeTable>['onDraftChange']
    > = (draft) =>
      setTableDrafts((current) => {
        const next = { ...current };
        if (draft) {
          next[element.id] = draft;
        } else {
          delete next[element.id];
        }
        return next;
      });

    return (
      <NativeTable
        bodyPaint={{ background: viewStyle.paper, color: ink }}
        headerPaint={{ background: fill, color: headerInk }}
        key={queueScope + ':' + element.id + ':' + draftGeneration}
        initialDraft={preview ? undefined : tableDrafts[element.id]}
        onDraftChange={handleTableDraftChange}
        element={element}
        detail={expanded ? 'full' : tableDetail(size, fontSize, presentationZoom)}
        selected={picked && !reading && tool === 'select' && !spacePan && gesture?.kind !== 'pan'}
        viewport={viewport}
        editRequest={objectEditRequest?.id === element.id ? objectEditRequest.sequence : undefined}
        canEdit={canEdit && !reading && !annotating && tool === 'select' && !spacePan}
        onRequestLink={(value) => setLinkRequest({ key: newClientId(), value })}
        onFormatStateChange={setFormatState}
        onEditingChange={(active) => updateRegionEditing(element.id, active)}
        onSave={(changes, base) =>
          saveRegionOperations(
            element.id,
            [{ op: 'update', id: element.id, changes }],
            base,
            '编辑表格',
          )
        }
      />
    );
  }

  function handleElementDoubleClick(event: ReactMouseEvent<HTMLDivElement>, element: BoardElement) {
    if (
      reading ||
      annotating ||
      (event.target as HTMLElement).closest('[data-native-interactive]')
    ) {
      return;
    }

    event.stopPropagation();
    if (element.type === 'document') {
      requestDocumentEdit(element.id).catch(reportCanvasFailure);
      return;
    }
    if (!canEdit) {
      return;
    }

    if (element.type === 'link') {
      setDialog({ type: 'link', element });
    } else if (canCropStillImage(element)) {
      setCropDialog(element);
    } else if (element.type === 'table' || element.type === 'todo') {
      setObjectEditRequest((current) => ({
        id: element.id,
        sequence: (current?.sequence ?? 0) + 1,
      }));
    } else if (
      !['html', 'document', 'image', 'stroke', 'diagram', 'chart'].includes(element.type) &&
      !(element.type === 'sticker' && getBoardSticker(element.data?.stickerIconId))
    ) {
      beginEditing(element);
    }
  }

  function renderObjectRegion(
    element: BoardElement,
    view: CanvasObjectView,
    region: CanvasRegionView,
  ) {
    if (isHtmlEmbed(element)) {
      return renderHtmlRegion(element, view.inlineSelected);
    }
    if (element.type === 'todo') {
      return renderTodo(element, view, region);
    }
    if (element.type === 'document') {
      return renderDocument(element);
    }
    if (element.type === 'table') {
      return renderTable(element, view, region);
    }
  }

  const objectScene: CanvasObjectScene = {
    zoom: viewport.zoom,
    presentationZoom,
    theme: viewTheme,
    style: viewStyle,
    surfaces: surfaceScene,
    arrows: arrowElementIndex,
    assets: {
      resolve: (source) => assetDisplayUrl(source, client),
      state: (source) => client.assetState?.(source),
    },
  };

  const objectActions = {
    clickCapture: handleAnnotationClickCapture,
    pointerDown: begin,
    doubleClick: handleElementDoubleClick,
    arrowDoubleClick: handleArrowLabelDoubleClick,
    moveRegion,
  };

  function renderElement(element: BoardElement) {
    if (!openingViewportReady) {
      return null;
    }

    const picked = !reading && selection.includes(element.id);
    const hidden = Boolean(reading && !reading.ids.includes(element.id));
    const selecting = tool === 'select' && !annotating;
    const view: CanvasObjectView = {
      picked,
      hidden,
      expanded: Boolean(reading && !hidden),
      sectionTitle: sectionTitles.get(element.id),
      inlineSelected: picked && selection.length === 1 && selecting,
      htmlMovable: !reading && selecting && canEdit && !element.locked,
      annotationHovered: annotationHover?.id === element.id,
    };

    return (
      <CanvasObject
        key={element.id}
        element={element}
        view={view}
        scene={objectScene}
        actions={objectActions}
        editor={editing?.id === element.id ? renderTextEditor(element) : undefined}
        region={(region) => renderObjectRegion(element, view, region)}
      />
    );
  }

  function renderTextEditor(element: BoardElement) {
    return (
      <CanvasObjectTextEditor
        element={element}
        ref={textEditor}
        value={editing?.text ?? ''}
        disabled={!canEdit}
        onChange={(text) =>
          setEditing((current) => ({
            id: element.id,
            text,
            base: current?.base ?? element,
            initialText: current?.initialText,
          }))
        }
        onFormatStateChange={setFormatState}
        onRequestLink={(value) => setLinkRequest({ key: newClientId(), value })}
        onCommit={(adjacent) => {
          commitEditing(adjacent).catch(reportCanvasFailure);
        }}
      />
    );
  }
  const failedDrafts = queueDrafts.filter((task) => task.state === 'failed');
  const failedDraftNotices = failedDrafts.filter((task) => {
    if (mediaUpload?.phase === 'failed' && task.id === mediaUpload.id) {
      return false;
    }

    const regionId = regionFailures.get(task.id);
    return (
      !regionId ||
      embeddedSaveSourceChanged(task, board.elements) ||
      !renderedElements.some(
        (element) =>
          element.id === regionId && (element.type === 'document' || isHtmlEmbed(element)),
      )
    );
  });
  const forgetDraft = (task: ContentTask) => {
    if (task.strictVersions) {
      queue.discard(task.id);
      setComparison(null);
      setDetachedTask(null);
      setError('');
      return;
    }
    queue.discardFor(task.keys);
    setEditing((value) => (value && task.keys.includes(value.id) ? null : value));
    setPropertyDrafts((value) =>
      Object.fromEntries(Object.entries(value).filter(([id]) => !task.keys.includes(id))),
    );
    setTableDrafts((value) =>
      Object.fromEntries(Object.entries(value).filter(([id]) => !task.keys.includes(id))),
    );
    setDraftGeneration((value) => value + 1);
    setComparison(null);
    setDetachedTask(null);
    setError('');
  };
  const handleInspectDetachedDraft = (base: BoardElement, changes: Partial<BoardElement>) => {
    setComparisonBoard(boardRef.current);
    setDetachedTask({
      id: newClientId('draft'),
      keys: [base.id],
      before: boardRef.current,
      sources: [base],
      operations: [{ op: 'update', id: base.id, changes }],
      summary: '未保存的草稿',
      remember: true,
      state: 'failed',
    });
  };
  const overwriteDraft = async (task: ContentTask) => {
    if (!canEditRef.current) {
      return;
    }

    if (task.strictVersions) {
      setError(
        '自动布局功能已移除，旧排布草稿不能直接覆盖当前内容。请保留并重试原操作，或采用当前已保存内容。',
      );

      return;
    }
    const current = comparisonBoard ?? boardRef.current;
    const operations = task.operations.map((operation) => {
      const base = task.sources.find((element) => element.id === operation.id);
      if (
        operation.op !== 'update' ||
        !base ||
        current.elements.some((element) => element.id === operation.id)
      ) {
        return operation;
      }

      const element = { ...base, ...operation.changes, id: newId() };
      delete (element as Partial<BoardElement>).version;
      return { op: 'add' as const, id: element.id, element };
    });
    queue.discard(task.id);
    setComparison(null);
    setDetachedTask(null);
    const saved = await apply(operations, '应用已比较的草稿', current.elements);
    if (saved) {
      forgetDraft(task);
    }
  };

  const selectionBounds = nativeSelectionBounds(renderedElements, selection);
  const annotationHover = findAnnotationHover(
    annotating,
    gesture,
    annotationHoverId,
    renderedElements,
  );
  function annotateSelectionBounds(elements: BoardElement[], ids: string[], bounds: Rect) {
    const element = elements.length === 1 ? elements[0] : undefined;
    const host = viewportElement.current?.getBoundingClientRect();
    const view = viewportRef.current;
    const corner = visibleCommentCorner(
      bounds,
      view,
      host ?? { width: window.innerWidth, height: window.innerHeight },
    );
    const relative =
      element &&
      relativeElementPoint(
        elementBounds(element, boardRef.current.elements) as BoardElement,
        corner,
      );
    const anchor: Anchor = relative
      ? { elementIds: ids, coordinateSpace: 'element', ...relative }
      : { elementIds: ids, coordinateSpace: 'board', ...corner };
    const attached = anchorBounds(anchor, boardRef.current.elements)!;
    const point = {
      x: (host?.left ?? 0) + attached.x * view.zoom + view.x,
      y: (host?.top ?? 0) + attached.y * view.zoom + view.y,
    };
    onAnnotateNative?.({
      anchor,
      label: element ? annotationElementLabel(element) : `${elements.length} 个对象`,
      versions: Object.fromEntries(elements.map((element) => [element.id, element.version])),
      screenPoint: point,
    });
  }

  const handleAnnotateSelection = async () => {
    const ids = [...selectionRef.current];
    const unchangedBase =
      editing &&
      editing.text ===
        (editing.initialText ??
          (editing.base?.type === 'arrow' ? editing.base.label : editing.base?.text) ??
          '')
        ? editing.base
        : undefined;

    if (!ids.length) {
      return;
    }
    if (editing && ids.includes(editing.id) && !(await commitEditing())) {
      return;
    }
    if (ids.some((id) => draftsRef.current[id]) && !(await savePropertyDrafts(ids))) {
      return;
    }

    const elements = boardRef.current.elements
      .filter((element) => ids.includes(element.id))
      .map((element) => (unchangedBase?.id === element.id ? unchangedBase : element));
    const bounds = nativeSelectionBounds(boardRef.current.elements, ids);
    if (!elements.length || !bounds) {
      return;
    }

    annotateSelectionBounds(elements, ids, bounds);
  };

  const handleTextFormat = (
    format: 'bold' | 'italic' | 'list' | 'link' | 'numbered',
    value?: string,
  ) => {
    const cell = viewportElement.current?.querySelector(
      '.studio-native-table [contenteditable="true"]',
    );

    if (cell) {
      cell.closest('.studio-native-table')?.dispatchEvent(
        new CustomEvent('studio-table-format', {
          detail: { format: format === 'list' ? 'bullets' : format, url: value },
        }),
      );

      return;
    }
    if (editing) {
      textEditor.current?.format(format === 'list' ? 'bullets' : format, value);
      return;
    }
    if (format === 'bold' || format === 'italic') {
      updateSelected({ [format]: !selectedElements.every((element) => element[format]) }).catch(
        reportCanvasFailure,
      );

      return;
    }
    if (!selected) {
      return;
    }

    const text = (selected.type === 'arrow' ? selected.label : selected.text) ?? '';
    const next = format === 'link' ? `[${text || '链接'}](${value})` : toggleBulletList(text);
    updateSelected(
      selected.type === 'arrow' ? { label: next } : { text: next },
      '设置文字格式',
    ).catch(reportCanvasFailure);
  };

  function describeCanvasActivity() {
    const gestureDirty = isGestureDirty(gesture);
    return JSON.stringify({
      editingIds,
      movingIds,
      savingIds,
      dirty:
        documentDirty ||
        !!mediaUpload ||
        queue.drafts.length > 0 ||
        Object.keys(tableDrafts).length > 0 ||
        saving ||
        textDirty ||
        dialogDirty ||
        Object.keys(propertyDrafts).length > 0 ||
        Boolean(gestureDirty),
      saving,
      saveError,
      issues,
    });
  }

  const handleViewportPointerDown: NonNullable<ComponentProps<'div'>['onPointerDown']> = (
    event,
  ) => {
    if (!(event.target as HTMLElement).closest('[data-native-interactive]')) {
      setToolMenu(null);
      setZoomMenu(false);
    }
    begin(event);
  };
  const handleViewportDoubleClick: NonNullable<ComponentProps<'div'>['onDoubleClick']> = (
    event,
  ) => {
    if (reading || editing || dialog) {
      return;
    }
    if (!canEdit || annotating || tool !== 'select') {
      return;
    }
    if ((event.target as HTMLElement).closest('[data-element-id],[data-native-interactive]')) {
      return;
    }

    updateGesture(null);
    addElements(
      [makeElement('text', boardPoint(event.clientX, event.clientY), { text: '' })],
      '添加文字',
      { edit: true },
    ).catch(reportCanvasFailure);
  };
  const handleViewportPointerOut: NonNullable<ComponentProps<'div'>['onPointerOut']> = (event) => {
    if (event.relatedTarget instanceof HTMLIFrameElement) {
      setAnnotationHoverId(null);
    }
  };
  const handleViewportPointerLeave: NonNullable<ComponentProps<'div'>['onPointerLeave']> = () => {
    setPointer(null);
    setAnnotationHoverId(null);
    onCursorMove?.(null);
  };
  const handleViewportLostPointerCapture: NonNullable<
    ComponentProps<'div'>['onLostPointerCapture']
  > = () => {
    if (gestureRef.current) {
      handleGestureCancel();
    }
  };
  const handleViewportContextMenu: NonNullable<ComponentProps<'div'>['onContextMenu']> = (
    event,
  ) => {
    if ((event.target as HTMLElement).closest('[data-native-interactive]')) {
      return;
    }

    if (reading) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    const id = (event.target as HTMLElement)
      .closest('[data-element-id]')
      ?.getAttribute('data-element-id');

    if (id && !selectionRef.current.includes(id)) {
      selectIds([id]);
    }
    handleOpenActionsMenu({ x: event.clientX, y: event.clientY }).catch(reportCanvasFailure);
  };
  const handleViewportDragOver: NonNullable<ComponentProps<'div'>['onDragOver']> = (event) => {
    if (!reading && canEdit && event.dataTransfer.types.includes('Files')) {
      event.preventDefault();
    }
  };
  const handleViewportDrop: NonNullable<ComponentProps<'div'>['onDrop']> = (event) => {
    event.preventDefault();
    if (reading) {
      return;
    }

    uploadMedia(event.dataTransfer.files, boardPoint(event.clientX, event.clientY)).catch(
      reportCanvasFailure,
    );
  };

  function startArrowHandle(event: ReactPointerEvent<HTMLButtonElement>, point: ArrowPointStart) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    viewportElement.current?.setPointerCapture(event.pointerId);
    updateGesture({
      kind: 'arrow-point',
      start: boardPoint(event.clientX, event.clientY),
      ...point,
      operations: [],
    });
  }

  function chooseControlTool(choice: Tool, nextMenu?: 'shape' | 'sticker' | null) {
    chooseTool(choice, nextMenu).catch(reportCanvasFailure);
  }

  function addDocumentFromControls() {
    addDocument().catch(reportCanvasFailure);
  }

  function addLinkFromControls() {
    setDialog({ type: 'link' });
    setToolMenu(null);
  }

  function addHtmlFromControls() {
    openHtmlEditor().catch(reportCanvasFailure);
    setToolMenu(null);
  }

  function uploadStickerFromControls() {
    media.pickFiles();
    setToolMenu(null);
  }

  function formatToolbarView(): CanvasFormatView | false | null | undefined {
    const editingTable = selected?.type === 'table' && propertyEditingIds.includes(selected.id);
    return (
      !reading &&
      !zoomMenu &&
      selectedElements.length > 0 &&
      selectionBounds &&
      !annotating &&
      tool === 'select' &&
      !spacePan &&
      gesture?.kind !== 'pan' && {
        selectionKey: selection.join(','),
        elements: selectedElements,
        selectionBounds,
        viewport,
        titles: titleCandidates,
        editingTitle: editing?.id,
        formatState: editing || editingTable ? formatState : undefined,
        requestLink: linkRequest,
        customColors,
        theme: viewTheme,
        canEdit,
        canAnnotate,
        saving: queue.tasks.some(
          (task) => task.state !== 'failed' && task.keys.some((id) => selection.includes(id)),
        ),
        canEditHtml: Boolean(selected && isHtmlEmbed(selected)),
        canCrop: Boolean(selected?.type === 'image' && selected.src && !selected.video),
      }
    );
  }

  function actionMenuView(): CanvasActionMenuView | null {
    const usingSelectionTool = !annotating && tool === 'select';
    const canRenameSection = selected?.type === 'container' && canEdit && usingSelectionTool;
    return (
      menu && {
        point: menu,
        canEdit,
        selected: selection.length,
        locked: selectedElements.some((element) => element.locked),
        hasClipboard: Boolean(navigator.clipboard?.readText),
        canRenameSection,
      }
    );
  }

  function compareLocalDraft(raw: string) {
    const draft = decodeCanvasDraft(raw, board.artifact.id).draft;
    const ids = new Set([
      draft?.text?.id,
      ...Object.keys(draft?.properties ?? {}),
      ...Object.keys(draft?.tables ?? {}),
      ...(draft?.tasks?.flatMap((task) => task.keys) ?? []),
    ]);
    const current = board.elements.filter((element) => ids.has(element.id));

    return {
      saved: JSON.stringify({ revision: board.artifact.revision, elements: current }, null, 2),
      draft: draft ? JSON.stringify(draft, null, 2) : raw,
      recoverable: Boolean(draft),
    };
  }

  function handleSelectRecoveryDraft(raw: string) {
    const next = decodeCanvasDraft(raw, board.artifact.id);
    storeCanvasDraft(draftSlot, null, next);
    clearDraftRecovery(next);
  }

  function applyRecoveredDraft() {
    if (!recovered) {
      return;
    }

    setEditing(recovered.text ?? null);
    setPropertyDrafts(recovered.properties ?? {});
    setTableDrafts(recovered.tables ?? {});
    queue.restore(recovered.tasks ?? []);
    setDraftGeneration((value) => value + 1);
    clearDraftRecovery({ ...draftRecovery, draft: null, error: '', discardEmpty: false });
  }

  function discardRecoveredDraft() {
    const next = {
      ...draftRecovery,
      draft: null,
      unreadableDraft: undefined,
      error: '',
      discardEmpty: false,
    };

    try {
      storeCanvasDraft(draftSlot, activeDraft, next);
      clearDraftRecovery(next);
    } catch (failure) {
      reportCanvasFailure(failure);
    }
  }

  function copyLocalDraft(text: string) {
    void copyPlainText(text).catch(reportCanvasFailure);
  }

  function downloadLocalDraft(text: string) {
    void downloadStudioBlob(
      client,
      new Blob([text], { type: 'application/json' }),
      'whiteboard-draft.json',
    ).catch(reportCanvasFailure);
  }

  function handleCompareFailedDraft(id: string) {
    setComparisonBoard(boardRef.current);
    setComparison(id);
  }

  function renderSaveNotices() {
    const failures = failedDraftNotices.map((task) => {
      const sourceChanged = embeddedSaveSourceChanged(task, board.elements);

      return {
        id: task.id,
        summary: task.summary,
        recovered: task.recovered,
        canRetry: !sourceChanged,
        message: sourceChanged
          ? 'HTML 源码已有变化，旧的交互草稿仍可查看。'
          : errorText(task.failure ?? task.error ?? '有尚未保存的草稿，请比较内容或重试。'),
      };
    });

    return (
      <CanvasSaveNotices
        messages={{ status: toolNotice || previewStatus, previewError, historyError, error }}
        unconfirmedHistory={unconfirmedHistory}
        failures={failures}
        textDeletion={{
          blocked: emptyTextBlocked,
          failedTaskId: failedEmptyTextDelete?.id,
          onCancel: handleCancelEmptyText,
        }}
        canEdit={canEdit}
        onClearHistoryError={clearHistoryError}
        onClearError={() => setError('')}
        onCompareDraft={handleCompareFailedDraft}
        onRetry={(id) => void queue.retry(id)}
      >
        {!preview && (
          <>
            <CanvasLocalDraftNotices
              activeDraft={activeDraft}
              recovery={draftRecovery}
              storageError={draftStorageError}
              actions={{
                copy: copyLocalDraft,
                download: downloadLocalDraft,
                clearStorageError: () => setDraftStorageError(''),
                apply: applyRecoveredDraft,
                discard: discardRecoveredDraft,
                viewPrevious: () =>
                  clearDraftRecovery(promoteCanvasDraft(draftRecovery, board.artifact.id)),
              }}
            >
              {canEdit && (
                <DraftRecoveryPicker
                  slot={draftSlot}
                  canRecover={!activeDraft && !recovered}
                  portalRoot={viewportHost?.portalRoot}
                  compare={compareLocalDraft}
                  onRecover={handleSelectRecoveryDraft}
                  onError={reportCanvasFailure}
                />
              )}
            </CanvasLocalDraftNotices>
            <DetachedCanvasDraftNotices
              text={editing}
              tables={tableDrafts}
              elements={board.elements}
              onInspect={handleInspectDetachedDraft}
            />
          </>
        )}
      </CanvasSaveNotices>
    );
  }

  function renderConflictDialog() {
    const comparingTask = queue.drafts.find((task) => task.id === comparison) ?? detachedTask;
    const dialogPortalRoot = viewportHost?.portalRoot ?? null;
    const handleKeepConflictDraft: NonNullable<
      ComponentProps<typeof ContentConflictDialog>['onKeep']
    > = () => {
      setComparison(null);
      setDetachedTask(null);
    };

    return (
      comparingTask && (
        <ContentConflictDialog
          portalRoot={dialogPortalRoot}
          task={comparingTask}
          current={comparisonBoard ?? board}
          disabled={!canEdit || embeddedSaveSourceChanged(comparingTask, board.elements)}
          onKeep={handleKeepConflictDraft}
          onRemote={() => forgetDraft(comparingTask)}
          onOverwrite={() => void overwriteDraft(comparingTask)}
          onCopy={() =>
            void copyPlainText(JSON.stringify(comparingTask.operations, null, 2)).catch((failure) =>
              setError(errorText(failure)),
            )
          }
        />
      )
    );
  }

  function renderHtmlInput() {
    const handleSelectHtmlFile: NonNullable<ComponentProps<'input'>['onChange']> = (event) => {
      const file = event.target.files?.[0];
      if (file) {
        file
          .text()
          .then((html) =>
            addElements(
              [
                makeElement('html', centerPoint(), {
                  html,
                  text: file.name.replace(/\.html?$/i, ''),
                }),
              ],
              '导入 HTML 图解',
            ),
          )
          .catch(reportCanvasFailure);
      }
      event.currentTarget.value = '';
    };

    return (
      <input
        ref={htmlInput}
        type="file"
        accept=".html,.htm,text/html"
        hidden
        onChange={handleSelectHtmlFile}
      />
    );
  }

  function renderCropDialog() {
    if (!cropDialog) {
      return null;
    }

    const handleCloseCrop: NonNullable<ComponentProps<typeof ImageCropDialog>['onClose']> = () => {
      setCropDialog(null);
      setDialogDirty(false);
    };
    const handleSaveCrop: NonNullable<ComponentProps<typeof ImageCropDialog>['onSave']> = async (
      changes,
    ) => {
      const saved = await apply([{ op: 'update', id: cropDialog.id, changes }], '裁剪图片', [
        cropDialog,
      ]);

      if (saved) {
        setCropDialog(null);
        setDialogDirty(false);
      }
    };

    return (
      cropDialog && (
        <ImageCropDialog
          element={cropDialog}
          src={assetDisplayUrl(cropDialog.src, client)!}
          onDirtyChange={setDialogDirty}
          onClose={handleCloseCrop}
          onSave={handleSaveCrop}
        />
      )
    );
  }

  function renderElementDialog() {
    if (!dialog) {
      return null;
    }

    const handleCloseDialog: NonNullable<ComponentProps<typeof CanvasDialog>['onClose']> = () => {
      setDialog(null);
      setDialogDirty(false);
    };
    const handleSaveDialog: NonNullable<ComponentProps<typeof CanvasDialog>['onSave']> = async (
      data,
    ) => {
      const element = dialog.element;
      if (element) {
        const saved = await apply([{ op: 'update', id: element.id, changes: data }], '编辑元素', [
          element,
        ]);

        if (saved) {
          setDialog(null);
          setDialogDirty(false);
        }
      } else {
        const saved = await addElements(
          [makeElement(dialog.type === 'sticker' ? 'sticker' : dialog.type, centerPoint(), data)],
          dialog.type === 'html' ? '添加 HTML 图解' : '添加元素',
        );

        if (saved) {
          setDialog(null);
          setDialogDirty(false);
        }
      }
    };

    return (
      dialog && (
        <CanvasDialog
          dialog={dialog}
          onDirtyChange={setDialogDirty}
          onClose={handleCloseDialog}
          onSave={handleSaveDialog}
        />
      )
    );
  }

  return (
    <div
      className={`studio-whiteboard${saving ? ' is-saving' : ''}${reading ? ' is-reading' : ''}`}
      data-tool={canvasInputTool(tool, gesture, spacePan, annotating)}
      style={
        {
          '--studio-ink': viewStyle.ink,
          '--studio-accent': viewStyle.accent,
          '--studio-link': viewStyle.link,
          '--canvas-paper': viewStyle.paper,
          '--canvas-scale': viewport.zoom,
          '--canvas-comment-cursor': COMMENT_CURSOR,
          '--canvas-pen-cursor': PEN_CURSOR,
        } as CSSProperties
      }
      onCopy={(event) => canvasClipboard().handleCanvasCopy(event)}
      onPaste={(event) => canvasClipboard().handleCanvasPaste(event)}
    >
      {renderReadingControls()}
      <CanvasViewportToolbar
        documentControls={documentControls}
        hidden={Boolean(reading)}
        zoom={viewport.zoom}
        zoomMenu={zoomMenu}
        hasSelection={selection.length > 0}
        history={{
          canEdit,
          saving: queueSaving,
          unconfirmed: Boolean(unconfirmedHistory),
          hasUndo: Boolean(undo.length),
          hasRedo: Boolean(redo.length),
        }}
        showGrid={showGrid}
        singleKeys={singleKeys}
        setZoomMenu={setZoomMenu}
        setShowGrid={setShowGrid}
        setSingleKeys={setSingleKeys}
        fit={fit}
        stepZoom={stepZoom}
        changeHistory={changeHistory}
      />
      <div
        ref={bindViewport}
        className="studio-canvas-viewport"
        tabIndex={canvasViewportTabIndex(readingDocument)}
        aria-label="白板画布"
        onPointerDownCapture={handleNavigationCapture}
        onClickCapture={pointerCapture.handleClickCapture}
        onDoubleClickCapture={pointerCapture.handleDoubleClickCapture}
        onAuxClick={pointerCapture.handleAuxClick}
        onPointerDown={handleViewportPointerDown}
        onDoubleClick={handleViewportDoubleClick}
        onPointerMove={handlePointerMove}
        onPointerOver={handleAnnotationHover}
        onPointerOut={handleViewportPointerOut}
        onPointerLeave={handleViewportPointerLeave}
        onPointerUp={handlePointerUp}
        onPointerCancel={handleGestureCancel}
        onLostPointerCapture={handleViewportLostPointerCapture}
        onContextMenu={handleViewportContextMenu}
        onDragOver={handleViewportDragOver}
        onDrop={handleViewportDrop}
        style={canvasViewportStyle(gesture, viewport, showGrid, Boolean(reading))}
      >
        {renderReadingMarker(queueScope, spacePan || gesture?.kind === 'pan')}
        <div
          className="studio-canvas-world"
          style={{
            transform: `translate(${viewport.x}px,${viewport.y}px) scale(${viewport.zoom})`,
          }}
        >
          {renderedElements.map(renderElement)}
          <CanvasMediaPlaceholders
            batch={mediaUpload}
            zoom={viewport.zoom}
            canEdit={canEdit}
            preview={preview}
            retry={media.retry}
            discard={media.discard}
          />
          <CanvasPeerPreviews frames={peerPreviewFrames} presence={presence} zoom={viewport.zoom} />
          <CanvasPlacementOverlays
            reading={Boolean(reading)}
            canEdit={canEdit}
            annotating={annotating}
            gesture={gesture}
            pointer={pointer}
            editing={Boolean(editing)}
            tool={tool}
            shapeKind={shapeKind}
            sticker={sticker}
            renderElement={renderElement}
          />
          <CanvasSelectionOverlays
            view={{
              bounds: selectionBounds,
              count: selection.length,
              selected,
              selectedElements,
              renderedElements,
              arrowIndex: arrowElementIndex,
              zoom: viewport.zoom,
            }}
            mode={{
              reading: Boolean(reading),
              canEdit,
              annotating,
              tool,
              spacePan,
              editing,
              gesture,
            }}
            actions={{
              onResize: handleResizeStart,
              onRotate: handleRotateStart,
              onConnect: handleConnectStart,
              onArrowPoint: startArrowHandle,
            }}
          />
          <CanvasFeedbackOverlays
            activities={activities}
            elements={renderedElements}
            hover={annotationHover}
            target={annotationTarget}
            fallbackTarget={localAnnotationTarget}
            guides={guides}
            zoom={viewport.zoom}
            onSelect={onFeedbackSelect}
          />
          <PeerPresenceOverlay
            peers={presence}
            geometryTargets={peerPreviewFrames
              .filter(({ peer }) => peer.kind !== 'upload')
              .map(({ peer }) => ({
                peerId: peer.peerId,
                elementIds: peer.elements.map((element) => element.id),
              }))}
            elements={renderedElements}
            artifactId={board.artifact.id}
            selfActorId={actor.id}
            zoom={viewport.zoom}
            clockOffsetMs={clockOffsetMs}
            preview={preview}
            onReleaseAgentTask={onReleaseAgentTask}
          />
          <CanvasMarquee gesture={gesture} zoom={viewport.zoom} />
        </div>
        <CanvasFeedbackClusters
          containerRef={viewportElement}
          activities={activities}
          activeFeedbackId={activeFeedbackId}
          onSelect={onFeedbackSelect}
        />
        <CanvasEmptyState
          empty={board.elements.length === 0}
          interacting={Boolean(gesture)}
          canEdit={canEdit}
          addDocument={addDocumentFromControls}
          addHtml={() => void openHtmlEditor()}
        />
      </div>
      <CanvasEditingControls
        tools={{
          tool,
          menu: toolMenu,
          lastDrawTool,
          lastShapeTool,
          shapeKind,
          sticker,
          penColor,
          ink: viewStyle.ink,
          theme: viewTheme,
          annotating,
          canEdit,
          hidden: Boolean(reading),
        }}
        actions={{
          chooseTool: chooseControlTool,
          changeShape: setShapeKind,
          changeSticker: setSticker,
          changePenColor: setPenColor,
          addLink: addLinkFromControls,
          addHtml: addHtmlFromControls,
          addDocument: addDocumentFromControls,
          uploadSticker: uploadStickerFromControls,
        }}
        format={formatToolbarView()}
        formatActions={{
          onCustomColorsChange: handleCustomColorsChange,
          onChange(changes, colors) {
            updateSelected(changes, '调整元素', colors).catch(reportCanvasFailure);
          },
          onEditText() {
            if (selected) {
              beginEditing(selected);
            }
          },
          onTextFormat: handleTextFormat,
          onAnnotate() {
            handleAnnotateSelection().catch(reportCanvasFailure);
          },
          onReadSelection() {
            readSelection().catch(reportCanvasFailure);
          },
          onEditHtml() {
            openHtmlEditor(selected).catch(reportCanvasFailure);
          },
          onCrop: () => setCropDialog(selected ?? null),
          onAlign(edge) {
            apply(
              alignSelection(boardRef.current.elements, selectionRef.current, edge),
              '对齐元素',
            ).catch(reportCanvasFailure);
          },
          onMore(point) {
            handleOpenActionsMenu(point).catch(reportCanvasFailure);
          },
        }}
        actionMenu={actionMenuView()}
        menuActions={{
          onCommand(command) {
            handleCanvasCommand(command).catch(reportCanvasFailure);
          },
          onRenameSection: editSelected,
          onClose: () => setMenu(null),
        }}
      />
      {renderSaveNotices()}
      {renderConflictDialog()}
      <CanvasMediaInput
        inputRef={media.inputRef}
        onFiles={(files) => void uploadMedia(files).catch(reportCanvasFailure)}
      />
      {renderHtmlInput()}
      {renderCropDialog()}
      {renderElementDialog()}
    </div>
  );
}
