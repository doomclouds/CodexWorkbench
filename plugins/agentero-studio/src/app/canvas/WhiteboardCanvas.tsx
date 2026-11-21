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
  type RefObject,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ArrowUpRight,
  FileText,
  Braces,
  ChevronDown,
  Circle,
  ExternalLink,
  Frame,
  Hand,
  Link,
  ListTodo,
  Loader2,
  Maximize,
  Minus,
  MousePointer2,
  PenLine,
  Plus,
  Redo2,
  RotateCcw,
  Smile,
  Square,
  StickyNote,
  Table2,
  Type,
  X,
} from 'lucide-react';
import {
  STUDIO_TOOLS,
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
} from '../../contracts/studio.js';
import { readableText, semanticColor } from '../../core/theme.js';
import {
  nativeBackdrop,
  nativeFill,
  nativeSurfaces,
  nativeTableInk,
  nativeTextInk,
} from '../../core/products/native-surface.js';
import HtmlRegion from '../shared/html-region/HtmlRegion.js';
import OperationNotice from '../shared/OperationNotice.js';
import {
  loadPanelReadingView,
  storePanelReadingView,
  type PanelReadingView,
} from '../panel-view-state.js';
import type { HtmlNavigationEvent } from '../shared/html-region/runtime.js';
import {
  anchorBounds,
  arrowGeometry,
  arrowHeads,
  assetDisplayUrl,
  boundsOf,
  canvasStyle,
  clamp,
  duplicateElements,
  elementBounds,
  expandMoveIds,
  fitViewport,
  intersects,
  makeElement,
  moveOperations,
  newId,
  normalizedRect,
  relativeElementPoint,
  safeHttpLink,
  wheelZoomFactor,
  zoomAt,
  type Point,
  type Rect,
  type Viewport,
} from './canvas-model.js';
import {
  canReadCanvasText,
  canvasGridSpacing,
  mediaControlsFit,
  overviewSectionTitle,
  overviewStrokeWidth,
  projectedSize,
  sectionTitleDetails,
  showHtmlCaption,
  tableDetail,
} from './canvas-presentation.js';
import { parseRichText } from '../../core/shared/rich-text.js';
import {
  createArrowElementIndex,
  shapePath,
  strokePath,
} from '../../core/products/whiteboard-geometry.js';
import { CroppedImage, ImageCropDialog } from './NativeMedia.js';
import { measureNativeIssues, type NativeIssue } from './native-issues.js';
import RichText from './RichText.js';
import Sticker from './Sticker.js';
import StickerPalette from './StickerPalette.js';
import { getBoardSticker } from '../../core/products/whiteboard-stickers.js';
import { COMMENT_CURSOR } from '../shared/comments/cursor.js';
import CanvasFormatToolbar from './CanvasFormatToolbar.js';
import ReadingControls from './ReadingControls.js';
import ReadingMarker from './ReadingMarker.js';
import CanvasArrow from './CanvasArrow.js';
import {
  arrowPointOperations,
  creationPlacement,
  drawnElement,
  finalizeDrawing,
  finalizeGesturePlacement,
  geometryCommit,
  maxDrawingPoints,
  projectGestureGeometry,
  resizeGestureOperations,
  rotateGestureOperations,
  selectionDragDelta,
  selectionHasDragged,
  snappedDrawingPoint,
  type Gesture,
} from './canvas-gesture-placement.js';
import {
  canvasDraftForStorage,
  promoteCanvasDraft,
  readCanvasDraft,
  storeCanvasDraft,
  type PropertyDrafts,
  type TextDraft,
} from './canvas-drafts.js';
import CanvasDialog, { type CanvasDialogSpec } from './CanvasDialog.js';
import CanvasActionsMenu, { type CanvasCommand } from './CanvasActionsMenu.js';
import ColorPalette from './ColorPalette.js';
import NativeTable from './NativeTable.js';
import DocumentRegion, {
  type DocumentActivity,
  type DocumentFocusSurface,
} from './DocumentRegion.js';
import TodoRegion from './TodoRegion.js';
import { normalizeTodoItems, type TodoSourceRef } from '../../contracts/todo.js';
import { defaultDocument, documentOperations } from '../../contracts/document.js';
import SelectionChrome from './SelectionChrome.js';
import ConnectionPorts from './ConnectionPorts.js';
import {
  adjacentElement,
  canShowConnectionPorts,
  connectionAtPoint,
  connectionPoint,
  OPPOSITE_SIDE,
  ROTATABLE_TYPES,
  type ConnectionSide,
} from './selection-affordances.js';
import InlineTextEditor, {
  type InlineTextEditorHandle,
  type InlineTextFormatState,
} from './InlineTextEditor.js';
import { newClientId } from '../shared/client-id.js';
import { nativePaint, PEN_CURSOR } from './native-palette.js';
import {
  alignSelection,
  tidySelection,
  geometryBounds,
  selectionBounds as nativeSelectionBounds,
  type ResizeHandle,
  type AlignmentGuide,
} from './native-geometry.js';
import {
  commentBoardTip,
  TODO_OVERVIEW_PIN_INSET,
  visibleCommentCorner,
} from '../shared/comments/comment-target.js';
import { CommentPin } from '../shared/comments/CommentPin.js';
import { CommentClusters } from '../shared/comments/CommentClusters.js';
import { copyPlainText } from '../clipboard.js';
import { studioRequest } from '../transport.js';
import { participantColor } from '../shared/presence-members.js';
import PeerPresenceOverlay from './PeerPresenceOverlay.js';
import {
  isContentDraft,
  sameContentOperations,
  sameContentValue,
  sameWireContentValue,
  NativeContentQueue,
  overlayContent,
  type ContentTask,
  type ContentReceipt,
} from './content-queue.js';
import { downloadStudioBlob } from '../transport.js';
import type { NativeTableDraft } from './NativeTable.js';
import ContentConflictDialog from './ContentConflictDialog.js';
import {
  encodeGestureFrame,
  useNativeGestureSync,
  type NativeGesture,
} from '../shared/useNativeGestureSync.js';
import { mergeJson } from '../../core/shared/safe-merge.js';
import './canvas.css';
import { isEscapeActive, registerEscapeLayer } from '../shared/escape.js';

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

export interface NativeAnnotation {
  anchor: Anchor;
  label: string;
  versions: Record<string, number>;
  screenPoint?: Point;
}

type Tool =
  | 'select'
  | 'pan'
  | 'annotate'
  | 'shape'
  | 'note'
  | 'text'
  | 'container'
  | 'stroke'
  | 'arrow'
  | 'sticker'
  | 'table'
  | 'document'
  | 'todo';
interface ChangeRecord {
  before: BoardElement[];
  after: BoardElement[];
  ids: string[];
  summary: string;
  revision: number;
  historyId?: string;
  fields?: Record<string, string[]>;
}
interface CanvasHistory {
  undo: ChangeRecord[];
  redo: ChangeRecord[];
  lastEditRevision: number;
}

function readCustomColors(nativeInks: string | undefined) {
  const colors = nativeInks ? nativeInks.split(',').map((value) => `#${value}`) : [];
  return colors.every((value) => /^#[0-9a-f]{6}$/i.test(value)) ? colors : null;
}

const insertUndoEntry = (entries: ChangeRecord[], entry: ChangeRecord) =>
  [...entries, entry].sort((a, b) => a.revision - b.revision).slice(-50);

interface MediaUploadBatch {
  id: string;
  scope: string;
  artifactId: string;
  baseRevision: number;
  intent: number;
  files: File[];
  position: Point;
  placeholders: BoardElement[];
  elements: BoardElement[];
  phase: 'uploading' | 'queued' | 'failed';
  referenceQueued: boolean;
  error?: string;
  frame: number;
  sequence: number;
  abort: AbortController;
}

const SHAPES = [
  ['rounded', '圆角矩形'],
  ['rect', '矩形'],
  ['ellipse', '椭圆'],
  ['diamond', '菱形'],
  ['pill', '胶囊'],
  ['hexagon', '六边形'],
  ['parallelogram', '平行四边形'],
  ['database', '数据库'],
  ['queue', '队列'],
  ['document', '文档'],
  ['cloud', '云'],
  ['person', '人物'],
] as const;
const CLIPBOARD_PREFIX = 'AGENTERO_STUDIO_ELEMENTS_V1\n';
const DOCUMENT_READING_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };
const isHtmlEmbed = (element: BoardElement) =>
  element.type === 'html' || (element.type === 'diagram' && typeof element.html === 'string');
const TOOL_OPTIONS: { tool: Tool; label: string; key: string; icon: typeof Square }[] = [
  { tool: 'select', label: '选择', key: '1', icon: MousePointer2 },
  { tool: 'pan', label: '平移', key: '2', icon: Hand },
  { tool: 'text', label: '文字', key: '3', icon: Type },
  { tool: 'container', label: '分区', key: '4', icon: Frame },
  { tool: 'note', label: '便签', key: '5', icon: StickyNote },
  { tool: 'stroke', label: '画笔', key: '6', icon: PenLine },
  { tool: 'shape', label: '形状', key: '7', icon: Square },
  { tool: 'sticker', label: '贴纸', key: '8', icon: Smile },
];

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

const inlineCanvasNotice: CSSProperties = {
  position: 'relative',
  bottom: 'auto',
  left: 'auto',
  maxWidth: 'none',
  flexWrap: 'wrap',
};

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

function Shape({ element }: { element: BoardElement }) {
  const { w, h, kind = 'rounded' } = element;
  const common = {
    fill: element.hollow ? 'none' : (element.fill ?? '#ffffff'),
    stroke: element.stroke ?? '#4f5d75',
    strokeWidth: Number(element.strokeWidth ?? element.width ?? 1.4),
    strokeDasharray: element.dash ? '6 5' : undefined,
    vectorEffect: 'non-scaling-stroke' as const,
  };
  const path = shapePath(element);
  if (!SHAPES.some(([value]) => value === kind)) {
    return <div className="studio-media-missing">不支持的形状：{kind}</div>;
  }

  let outline: ReactNode;
  if (kind === 'ellipse') {
    outline = <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} {...common} />;
  } else if (path) {
    outline = <path d={path} {...common} />;
  } else {
    const squareCorners = kind === 'rect' || kind === 'queue';
    let radius = squareCorners ? 0 : 7;
    if (kind === 'pill') {
      radius = h / 2;
    }
    outline = <rect width={w} height={h} rx={radius} {...common} />;
  }
  return (
    <svg
      className="studio-shape-svg"
      viewBox={`-2 -2 ${w + 4} ${h + 4}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {outline}
      {kind === 'queue' && (
        <path d={`M 14 0 V ${h} M ${w - 14} 0 V ${h}`} {...common} fill="none" />
      )}
    </svg>
  );
}

function useCommittedRef<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  }, [value]);

  return ref;
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

function useCanvasReadingView(
  board: Board,
  {
    panelViewId,
    restoreReadingFrom,
    preview,
    externalViewport,
  }: Pick<
    WhiteboardCanvasProps,
    'panelViewId' | 'restoreReadingFrom' | 'preview' | 'externalViewport'
  >,
) {
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
  const [viewport, setViewport] = useState<Viewport>(
    () => savedReading?.viewport ?? { x: 100, y: 80, zoom: 1 },
  );
  const [presentationZoom, setPresentationZoom] = useState(externalViewport?.zoom ?? viewport.zoom);
  useEffect(() => {
    const timer = window.setTimeout(() => setPresentationZoom(viewport.zoom), 110);
    return () => window.clearTimeout(timer);
  }, [viewport.zoom]);
  const viewportRef = useCommittedRef(viewport);
  const externalViewportRef = useCommittedRef(externalViewport);
  const [reading, setReading] = useState<{ ids: string[]; viewport: Viewport; tool: Tool } | null>(
    () =>
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

  return {
    readingStorageId,
    viewArtifactId,
    openingView,
    savedReading,
    viewport,
    setViewport,
    presentationZoom,
    viewportRef,
    externalViewportRef,
    reading,
    setReading,
    restoredReadingScroll,
    setRestoredReadingScroll,
    readingDocument,
  };
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

function textDraftFromBoard(
  editing: TextDraft | null,
  board: Board,
  tasks: readonly ContentTask[],
): TextDraft | null {
  if (!editing || editing.text !== editing.initialText) {
    return editing;
  }
  if (tasks.some((task) => task.keys.includes(editing.id))) {
    return editing;
  }

  const remote = board.elements.find(
    (element) => element.id === editing.id && element.type === editing.base?.type,
  );

  if (!remote || remote.version === editing.base?.version) {
    return editing;
  }

  let text = String(remote.type === 'arrow' ? (remote.label ?? '') : (remote.text ?? ''));
  if (remote.bold) {
    text = `**${text}**`;
  }
  if (remote.italic) {
    text = `_${text}_`;
  }
  return { ...editing, base: remote, text, initialText: text };
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
    const refreshedDraft = textDraftFromBoard(editing, board, queueTasks);
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

function annotationElementLabel(element: BoardElement) {
  let kind = '对象';
  if (element.type === 'note') {
    kind = '便签';
  } else if (element.type === 'container') {
    kind = '分区';
  }
  return `${kind} · ${(element.text || element.label || element.type).slice(0, 100)}`;
}

function applyPeerGeometry(
  elements: BoardElement[],
  element: BoardElement,
  kind: NativeGesture['kind'],
) {
  const index = elements.findIndex((item) => item.id === element.id);
  if (index < 0) {
    if (kind !== 'upload') {
      elements.push(element);
    }
    return;
  }
  const geometry = Object.fromEntries(
    [
      'x',
      'y',
      'w',
      'h',
      'rotation',
      'points',
      'from',
      'to',
      'bends',
      'fromSide',
      'toSide',
      'labelOffset',
      'labelSize',
    ]
      .filter((key) => element[key] !== undefined)
      .map((key) => [key, element[key]]),
  );

  elements[index] = { ...elements[index]!, ...geometry };
}

function useCanvasUploadHeartbeat(
  mediaUpload: MediaUploadBatch | null,
  canEdit: boolean,
  room: CollaborationRoom | undefined,
  mediaUploadRef: RefObject<MediaUploadBatch | null>,
  publishUpload: (batch: MediaUploadBatch) => void,
) {
  const activeUploadId = mediaUpload?.phase !== 'failed' ? mediaUpload?.id : undefined;
  useEffect(() => {
    if (!activeUploadId || !canEdit || !room) {
      return;
    }

    const timer = setInterval(() => {
      const batch = mediaUploadRef.current;
      if (batch && batch.phase !== 'failed') {
        publishUpload(batch);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [activeUploadId, canEdit, room, publishUpload, mediaUploadRef]);
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

const uploadPhaseLabels = {
  uploading: '正在上传',
  queued: '正在加入白板',
  failed: '尚未加入白板',
};

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
  const fileInput = useRef<HTMLInputElement>(null);
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
  const {
    readingStorageId,
    viewArtifactId,
    openingView,
    savedReading,
    viewport,
    setViewport,
    presentationZoom,
    viewportRef,
    externalViewportRef,
    reading,
    setReading,
    restoredReadingScroll,
    setRestoredReadingScroll,
    readingDocument,
  } = useCanvasReadingView(board, { panelViewId, restoreReadingFrom, preview, externalViewport });
  const restoredReadingViewport = useRef(Boolean(savedReading));
  const readingScroll = useRef<PanelReadingView['scroll']>(savedReading?.scroll);
  const readingRef = useCommittedRef(reading);
  const [tool, setTool] = useState<Tool>('select');
  const [shapeKind, setShapeKind] = useState('rounded');
  const [lastShapeTool, setLastShapeTool] = useState<'shape' | 'table'>('shape');
  const [lastDrawTool, setLastDrawTool] = useState<'stroke' | 'arrow'>('stroke');
  const [selection, setSelection] = useState<string[]>(
    () =>
      externalSelectedIds?.filter((id) => board.elements.some((element) => element.id === id)) ??
      savedReading?.ids ??
      [],
  );
  const selectionRef = useCommittedRef(selection);
  const interactionIntent = useRef(0);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [queueSaving, setQueueSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [documentActivities, setDocumentActivities] = useState<Record<string, DocumentActivity>>(
    {},
  );
  const [documentEditRequest, setDocumentEditRequest] = useState<{
    id: string;
    sequence: number;
  }>();
  const documentFocusSurface = useRef<DocumentFocusSurface | null>(null);
  const [focusedDocumentSurface, setFocusedDocumentSurface] = useState<DocumentFocusSurface | null>(
    null,
  );
  const [mediaUpload, setMediaUpload] = useState<MediaUploadBatch | null>(null);
  const mediaUploadRef = useRef<MediaUploadBatch | null>(null);
  const uploadBusyRef = useRef(false);
  const uploadAlive = useRef(true);
  const [uploadError, setUploadError] = useState('');
  const draftStorageKey = `studio-draft:${client.baseUrl ?? 'embedded'}:${actor.id}:${board.artifact.id}`;
  const [draftRecovery, clearDraftRecovery] = useState(() =>
    readCanvasDraft(draftStorageKey, board.artifact.id, preview),
  );
  const { draft: recovered, unreadableDraft } = draftRecovery;
  const { error, setError, customColors } = useCanvasOperationNotice(
    board.style.nativeInks,
    draftRecovery.error,
  );
  const reportCanvasFailure = useCallback(
    (failure: unknown) => setError(errorText(failure)),
    [setError],
  );
  const [historyError, setHistoryError] = useState('');
  const [toolNotice, setToolNotice] = useState('');
  const [queueSaveError, setQueueSaveError] = useState('');
  const { documentDirty, saving, saveError } = canvasSaveStatus(
    queueSaving,
    uploading,
    uploadError,
    queueSaveError,
    documentActivities,
  );
  const [editing, setEditing] = useState<TextDraft | null>(null);
  const newTextIds = useRef(new Set<string>());
  const [emptyTextDelete, setEmptyTextDelete] = useState<{
    elementId: string;
    operationId: string;
  }>();
  const emptyTextDeleteRef = useRef<typeof emptyTextDelete>(undefined);
  const trackEmptyTextDelete = (next: typeof emptyTextDelete) => {
    emptyTextDeleteRef.current = next;
    setEmptyTextDelete(next);
  };
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
  const regionScrolled = (elementId: string, point: { x: number; y: number }) => {
    if (!readingStorageId || !readingRef.current?.ids.includes(elementId)) {
      return;
    }

    readingScroll.current = { elementId, ...point };
    scheduleReadingView();
  };
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
  const [history, setHistory] = useState<CanvasHistory>({
    undo: [],
    redo: [],
    lastEditRevision: -1,
  });
  const { undo, redo } = history;
  const historyRef = useRef(history);
  const updateHistory = (value: CanvasHistory) => {
    historyRef.current = value;
    setHistory(value);
  };
  const clipboard = useRef<BoardElement[]>([]);
  const spaceHeld = useRef(false);
  const navigationClick = useRef(false);
  const documentPlacementClick = useRef<'released' | 'clicked' | null>(null);
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
  const uploadRoom = useCommittedRef(room);
  const publishUpload = useCallback(
    (batch: MediaUploadBatch, end = false, cancelled = false) => {
      if (!canEditRef.current || batch.scope !== currentScope.current || !uploadRoom.current) {
        return;
      }

      const gesture: NativeGesture = {
        id: batch.id,
        operationId: batch.id,
        origin: 'create',
        baseRevision: batch.baseRevision,
        kind: 'upload',
        elements: batch.placeholders.map(
          (placeholder, index) => batch.elements[index] ?? placeholder,
        ),
        ...(end && !cancelled ? { storedIds: batch.elements.map((element) => element.id) } : {}),
      };
      const messages = cancelled
        ? []
        : encodeGestureFrame(gesture, ++batch.frame, () => ++batch.sequence);

      if (end || cancelled) {
        messages.push({
          id: batch.id,
          operationId: batch.id,
          origin: 'create',
          baseRevision: batch.baseRevision,
          seq: ++batch.sequence,
          phase: 'end',
          frame: batch.frame,
          kind: 'upload',
          cancelled,
          storedIds: gesture.storedIds ?? [],
        });
      }
      for (const message of messages) {
        void uploadRoom.current
          .send('upload', message)
          .then((accepted) => {
            if (!accepted && batch.scope === currentScope.current) {
              setToolNotice('上传预览暂不可用，媒体保存后会同步。');
            }
          })
          .catch((failure) => {
            if (batch.scope === currentScope.current) {
              setToolNotice(`上传预览暂不可用，媒体保存后会同步。${errorText(failure)}`);
            }
          });
      }
    },
    [canEditRef, currentScope, uploadRoom],
  );
  const finishUpload = (batch: MediaUploadBatch, accepted = false, receipt?: Board) => {
    if (mediaUploadRef.current !== batch) {
      return;
    }

    publishUpload(batch, accepted, !accepted);
    mediaUploadRef.current = null;
    uploadBusyRef.current = false;
    setMediaUpload(null);
    setUploading(false);
    setUploadError('');
    const currentIntent =
      batch.scope === currentScope.current && batch.intent === interactionIntent.current;

    if (accepted && receipt && currentIntent) {
      const current =
        boardRef.current.artifact.revision > receipt.artifact.revision ? boardRef.current : receipt;
      const ids = batch.elements
        .map((element) => element.id)
        .filter((id) => current.elements.some((element) => element.id === id));

      if (ids.length) {
        selectIds(ids);
        setTool('select');
        setToolMenu(null);
        setMenu(null);
      }
    }
  };
  const [localQueue] = useState(
    () =>
      new NativeContentQueue({
        send: (args) => client.call<ContentReceipt>(STUDIO_TOOLS.apply, args),
        accepted: () => {},
        changed: () => {},
      }),
  );
  const queue = contentQueue ?? localQueue;
  useLayoutEffect(() => {
    if (!contentQueue) {
      localQueue.setSender((args) => client.call<ContentReceipt>(STUDIO_TOOLS.apply, args));
    }
  }, [client, contentQueue, localQueue]);
  const activeQueue = useCommittedRef(queue);
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
    const batch = mediaUploadRef.current;
    if (
      batch?.referenceQueued &&
      !queue.tasks.some((task) =>
        task.keys.some((id) => batch.placeholders.some((element) => element.id === id)),
      )
    ) {
      finishUpload(batch);
    }
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
  function recordUndoEntry(task: ContentTask, response: ContentReceipt) {
    const ids = task.keys.filter((key) => key !== '$board');
    const operations = (task.args?.operations as Operation[] | undefined) ?? task.operations;
    const knownFields: Record<string, string[]> = {};
    for (const operation of operations) {
      if (operation.id && (operation.op === 'update' || operation.op === 'document')) {
        knownFields[operation.id] = [
          ...new Set([
            ...(knownFields[operation.id] ?? []),
            ...(operation.op === 'document' ? ['document'] : Object.keys(operation.changes ?? {})),
          ]),
        ];
      }
    }
    const mergedWithoutHistory =
      !response.historyEntry &&
      operations.some(
        (operation) =>
          operation.op === 'update' &&
          Object.entries(operation.changes ?? {}).some(
            ([field, value]) =>
              !sameWireContentValue(
                response.board.elements.find((element) => element.id === operation.id)?.[field],
                value,
              ),
          ),
      );
    const history = historyRef.current;
    const revision = response.historyEntry?.revision ?? response.board.artifact.revision;
    const entry = {
      before: task.appliedSources ?? task.sources,
      after: response.board.elements.filter((element) => ids.includes(element.id)),
      ids,
      summary: task.summary,
      revision,
      historyId: response.historyEntry?.id,
      fields: knownFields,
    };
    updateHistory({
      undo: mergedWithoutHistory ? history.undo : insertUndoEntry(history.undo, entry),
      redo: [],
      lastEditRevision: Math.max(history.lastEditRevision, revision),
    });
  }
  const acceptQueueChange = (task: ContentTask, response: ContentReceipt) => {
    const batch = mediaUploadRef.current;
    if (
      batch?.referenceQueued &&
      task.operations.some(
        (operation) =>
          operation.op === 'add' &&
          batch.elements.some((element) => element.id === (operation.id ?? operation.element?.id)),
      ) &&
      batch.elements.every((element) =>
        response.board.elements.some((saved) => saved.id === element.id),
      )
    ) {
      finishUpload(batch, true, response.board);
    }
    if (response.board.artifact.revision >= boardRef.current.artifact.revision) {
      boardRef.current = response.board;
      if (!contentQueue) {
        onChangedRef.current(response.board);
      }
    }
    setEditing((current) => {
      const op = ((task.args?.operations as Operation[] | undefined) ?? task.operations).find(
        (operation) =>
          operation.op === 'update' &&
          operation.id === current?.id &&
          (typeof operation.changes?.text === 'string' ||
            typeof operation.changes?.label === 'string'),
      );
      const next = response.board.elements.find((element) => element.id === current?.id);
      if (!current || !op || !next) {
        return current;
      }

      const acceptedText = String(next.type === 'arrow' ? (next.label ?? '') : (next.text ?? ''));
      const merged = mergeJson(
        String(op.changes?.[next.type === 'arrow' ? 'label' : 'text'] ?? ''),
        current.text,
        acceptedText,
      );

      return merged.conflicts.length
        ? current
        : { ...current, base: next, text: String(merged.result), initialText: acceptedText };
    });

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
  useEffect(() => {
    uploadAlive.current = true;
    return () => {
      uploadAlive.current = false;
      const batch = mediaUploadRef.current;
      if (batch) {
        batch.abort.abort();
        publishUpload(batch, false, true);
      }
    };
  }, [publishUpload]);
  useCanvasUploadHeartbeat(mediaUpload, canEdit, room, mediaUploadRef, publishUpload);
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
  const beginEditing = (element: BoardElement) => {
    if (
      readingRef.current ||
      ['html', 'document', 'image', 'table', 'todo', 'stroke', 'diagram', 'chart'].includes(
        element.type,
      )
    ) {
      return;
    }

    interactionIntent.current++;
    let text = (element.type === 'arrow' ? element.label : element.text) ?? '';
    if (element.bold) {
      text = `**${text}**`;
    }
    if (element.italic) {
      text = `_${text}_`;
    }
    setEditing({ id: element.id, text, base: element, initialText: text });
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

  useEffect(() => {
    const host = viewportElement.current;
    if (!host) {
      return;
    }

    const measure = () => {
      const next = measureNativeIssues(host);
      setIssues((current) => (sameContentValue(current, next) ? current : next));
    };
    const frame = requestAnimationFrame(measure);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : undefined;
    observer?.observe(host);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [board.elements, viewport, editing?.id, gesture]);
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
    describeTextDraft();
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
  const hadLocalDraft = useRef(draftRecovery.discardEmpty);
  const storageFailed = useRef(false);
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

    if (!currentDraft && !hadLocalDraft.current) {
      return;
    }

    try {
      storeCanvasDraft(draftStorageKey, currentDraft, draftRecovery);
      hadLocalDraft.current = Boolean(currentDraft);
      storageFailed.current = false;
    } catch (failure) {
      if (!storageFailed.current) {
        storageFailed.current = true;
        setError(`本机草稿保存失败，请复制草稿或下载副本后再关闭。${errorText(failure)}`);
      }
    }
  }, [
    draftRecovery,
    draftStorageKey,
    editing,
    preview,
    propertyDrafts,
    queueDrafts,
    setError,
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
    viewportCallback.current?.(viewport);
  }, [viewport, viewportCallback]);
  useEffect(() => {
    if (readingRef.current || !externalViewport) {
      return;
    }

    const validPosition =
      Number.isFinite(externalViewport.x) && Number.isFinite(externalViewport.y);

    if (validPosition && externalViewport.zoom > 0) {
      setViewport((current) =>
        current.x === externalViewport.x &&
        current.y === externalViewport.y &&
        current.zoom === externalViewport.zoom
          ? current
          : { ...externalViewport, zoom: clamp(externalViewport.zoom, 0.05, 8) },
      );
    }
  }, [externalViewport, readingRef, setViewport]);
  useCanvasBoardReconciliation(board, selection, setSelection, editing, setEditing, queueTasks);
  useEffect(() => {
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
      return;
    }
    const frame = requestAnimationFrame(() => {
      const host = viewportElement.current;
      if (host && !externalViewportRef.current) {
        setViewport(fitViewport(boardRef.current.elements, host.clientWidth, host.clientHeight));
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [openingView, readingCallback, externalViewportRef, setViewport]);
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
      for (const element of elements) {
        if (element.type === 'text') {
          newTextIds.current.add(element.id);
        }
      }
      if (options.edit) {
        const next = saved.elements.find((element) => element.id === elements[0]?.id);
        if (next) {
          beginEditing(next);
        }
      }
    }
    return saved;
  };
  async function commitEmptyText(
    editing: TextDraft,
    current: BoardElement,
    base: BoardElement,
    close: boolean,
  ) {
    if (!close) {
      return boardRef.current;
    }

    const cleanup =
      newTextIds.current.has(current.id) || !!(editing.initialText ?? base.text ?? '').trim();

    if (!cleanup) {
      setEditing(null);
      return boardRef.current;
    }
    const linked = boardRef.current.elements.filter(
      (element) =>
        element.type === 'arrow' && (element.from === current.id || element.to === current.id),
    );
    const intended = overlayContent(boardRef.current.elements, queue.tasks).map((element) => ({
      ...element,
      ...draftsRef.current[element.id]?.changes,
    }));

    if (
      (intended.find((element) => element.id === current.id) ?? current).locked ||
      linked.some(
        (element) => (intended.find((value) => value.id === element.id) ?? element).locked,
      )
    ) {
      setError('此文字或关联连线已锁定，不能通过清空删除。请先解锁；原内容和本地草稿已保留。');
      return null;
    }
    const previous = emptyTextDeleteRef.current;
    const operationId =
      previous?.elementId === current.id &&
      queue.tasks.some((task) => task.id === previous.operationId)
        ? previous.operationId
        : newClientId('op');
    trackEmptyTextDelete({ elementId: current.id, operationId });
    const saved = await apply(
      [{ op: 'delete', id: current.id }],
      '删除空文字',
      [base, ...linked],
      true,
      operationId,
    );

    if (saved) {
      trackEmptyTextDelete(undefined);
      newTextIds.current.delete(current.id);
      setEditing(null);
      selectIds(
        selectionRef.current.filter((id) => id !== current.id),
        false,
      );
    }
    return saved;
  }
  function changesForTextDraft(
    textDraft: TextDraft,
    current: BoardElement,
    base: BoardElement,
  ): Partial<BoardElement> {
    const editor = viewportElement.current?.querySelector<HTMLElement>('[contenteditable="true"]');
    const fitted =
      editor && !base.locked && ['text', 'note', 'shape'].includes(base.type)
        ? Math.max(
            current.h,
            editor.scrollHeight + (['note', 'shape'].includes(base.type) ? 32 : 0),
          )
        : current.h;

    return {
      ...(base.type === 'arrow' ? { label: textDraft.text } : { text: textDraft.text }),
      ...(base.bold ? { bold: false } : {}),
      ...(base.italic ? { italic: false } : {}),
      ...(fitted > current.h ? { h: fitted } : {}),
    };
  }
  async function appendAdjacentText(adjacent: boolean, base: BoardElement, current: BoardElement) {
    if (adjacent && ['text', 'note', 'shape', 'container'].includes(base.type)) {
      const next = makeElement(
        base.type,
        {
          x: current.x + (base.type === 'text' ? 0 : current.w + 24),
          y: current.y + (base.type === 'text' ? current.h + 24 : 0),
        },
        {
          w: current.w,
          h: current.h,
          kind: current.kind,
          fill: current.fill,
          color: current.color,
          fontSize: current.fontSize,
          text: '',
        },
      );
      await addElements([next], '添加相邻元素', { edit: true });
    }
  }
  const commitEditing = async (adjacent = false, close = true) => {
    if (!canEdit || !editing) {
      return;
    }

    const current = boardRef.current.elements.find((element) => element.id === editing.id);
    if (!current) {
      setError('此对象已被删除。文字草稿仍保留，可复制后使用。');
      return;
    }
    const base = editing.base ?? current;
    if (current.type === 'text' && base.type === 'text' && !editing.text.trim()) {
      return commitEmptyText(editing, current, base, close);
    }

    const changed =
      pendingTextDiffers ||
      editing.text !==
        (editing.initialText ?? (base.type === 'arrow' ? base.label : base.text) ?? '');
    const changes = changesForTextDraft(editing, current, base);
    const saved = changed
      ? await apply(
          [
            {
              op: 'update',
              id: editing.id,
              changes,
            },
          ],
          '编辑文字',
          [base],
        )
      : boardRef.current;

    if (saved) {
      if (close) {
        setEditing((value) =>
          value?.id === editing.id && value.text === editing.text ? null : value,
        );
      }
      await appendAdjacentText(adjacent, base, current);
    }
    return saved;
  };
  const handleCancelEmptyText = () => {
    if (editing && emptyTextDeleteRef.current?.elementId === editing.id) {
      const task = queue.tasks.find(
        (task) => task.id === emptyTextDeleteRef.current?.operationId && task.state === 'failed',
      );

      if (task) {
        queue.discard(task.id);
      }
      trackEmptyTextDelete(undefined);
    }
    setEditing(null);
    setError('');
    requestAnimationFrame(() => viewportElement.current?.focus({ preventScroll: true }));
  };
  const liveCommit = useCommittedRef(() => {
    commitEditing(false, false).catch(reportCanvasFailure);
  });
  const textWaitStarted = useRef<number | null>(null);
  const failedTextDraft = queueDrafts.some(
    (task) => task.state === 'failed' && task.keys.includes(editingId ?? ''),
  );
  useEffect(() => {
    const canSaveDraft = canEdit && !preview;
    if (!canSaveDraft || !textDirty || failedTextDraft) {
      textWaitStarted.current = null;
      return;
    }
    textWaitStarted.current ??= Date.now();
    const timeout = setTimeout(
      () => {
        textWaitStarted.current = null;
        liveCommit.current();
      },
      Math.max(0, Math.min(250, 1000 - (Date.now() - textWaitStarted.current))),
    );

    return () => clearTimeout(timeout);
  }, [editing?.text, editingId, textDirty, canEdit, preview, failedTextDraft, liveCommit]);
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
  const handleExitReading = () => {
    const previous = readingRef.current;
    if (!previous) {
      return;
    }

    handleGestureCancel();
    setPointer(null);
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
  };
  const requestExitReading = async () => {
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
    handleGestureCancel();
    setPointer(null);
    setMenu(null);
    setZoomMenu(false);
    setToolMenu(null);
    setTool('select');
    viewportInteract.current?.();
    if (document) {
      setViewport(DOCUMENT_READING_VIEWPORT);
      readingCallback.current?.(true, 'document');
    } else {
      readingCallback.current?.(true);
    }
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
  const handleFitReadingContent = () => {
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
      viewportInteract.current?.();
      documentFocusSurface.current?.setZoomAnchor(null);
      setViewport(DOCUMENT_READING_VIEWPORT);
      return;
    }
    const bounds = nativeSelectionBounds(boardRef.current.elements, current.ids);
    if (!bounds) {
      handleExitReading();
      return;
    }
    viewportInteract.current?.();
    setViewport(fitViewport([bounds], host.clientWidth, host.clientHeight, 48, 8));
  };
  const handleReadingZoom = (zoom: number) => {
    const host = viewportElement.current;
    if (!host) {
      return;
    }

    viewportInteract.current?.();
    documentFocusSurface.current?.setZoomAnchor(null);
    setViewport((value) =>
      zoomAt(value, { x: host.clientWidth / 2, y: host.clientHeight / 2 }, zoom),
    );
  };
  const readingBoundsKey = reading
    ? JSON.stringify(nativeSelectionBounds(board.elements, reading.ids))
    : '';
  const refitReading = useEffectEvent(handleFitReadingContent);
  useEffect(() => {
    if (!reading) {
      return;
    }

    const host = viewportElement.current!;
    const fitReading = () => refitReading();
    let width = host.clientWidth;
    let height = host.clientHeight;
    if (!restoredReadingViewport.current) {
      fitReading();
    }
    restoredReadingViewport.current = false;
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
  }, [reading, readingBoundsKey]);
  const isReading = Boolean(reading);
  useEffect(() => {
    if (!isReading) {
      return;
    }

    readingExit.current?.focus({ preventScroll: true });
    const timer = setTimeout(() => setReadingHint(false), 3500);
    return () => clearTimeout(timer);
  }, [isReading]);
  const exitRemovedReading = useEffectEvent((elements: BoardElement[]) => {
    if (
      readingRef.current &&
      !elements.some((element) => readingRef.current!.ids.includes(element.id))
    ) {
      handleExitReading();
    }
  });
  useEffect(() => {
    exitRemovedReading(board.elements);
  }, [board.elements]);
  useEffect(
    () => () => {
      if (readingRef.current) {
        readingCallback.current?.(false);
      }
    },
    [readingRef, readingCallback],
  );
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
  const copiedElements = () => {
    const ids = expandMoveIds(boardRef.current.elements, selectionRef.current);
    return structuredClone(boardRef.current.elements.filter((element) => ids.includes(element.id)));
  };
  const copySelection = async () => {
    const elements = copiedElements();
    await copyPlainText(CLIPBOARD_PREFIX + JSON.stringify(elements));
    clipboard.current = elements;
  };
  const pasteFromClipboard = async () => {
    if (!navigator.clipboard?.readText) {
      throw new Error('此浏览器无法直接读取剪贴板，请按 Ctrl/⌘ V 粘贴。');
    }

    const value = await navigator.clipboard.readText();
    if (value.length > 8 * 1024 * 1024) {
      throw new Error('剪贴板内容超过8 MB，请分批粘贴。');
    }

    if (value.startsWith(CLIPBOARD_PREFIX)) {
      const pasted = JSON.parse(value.slice(CLIPBOARD_PREFIX.length)) as BoardElement[];
      const validElement = (element: BoardElement) =>
        element && typeof element.id === 'string' && typeof element.type === 'string';

      if (!Array.isArray(pasted) || pasted.length > 200 || !pasted.every(validElement)) {
        throw new Error('剪贴板中的白板内容无效。');
      }

      await addElements(
        duplicateElements(
          pasted,
          pasted.map((element) => element.id),
        ),
        '粘贴元素',
      );

      return;
    }
    if (value.trim()) {
      await addElements(
        [makeElement('text', centerPoint(), { text: value.slice(0, 20000) })],
        '粘贴文字',
      );
    }
  };

  const handleCanvasCommand = async (action: CanvasCommand) => {
    const elements = boardRef.current.elements;
    const ids = selectionRef.current;
    switch (action) {
      case 'copy':
      case 'cut':
        try {
          await copySelection();
          if (action === 'cut') {
            remove();
          }
        } catch (failure) {
          reportCanvasFailure(failure);
        }

        return;
      case 'paste':
        await pasteFromClipboard().catch(reportCanvasFailure);
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
  function defaultStrokeWidth(type: ElementType) {
    if (type === 'stroke') {
      return 3;
    }

    return type === 'shape' ? 1.4 : 1.8;
  }

  function undoFieldChanges(
    previous: BoardElement,
    next: BoardElement,
    expected: BoardElement | undefined,
    fieldNames?: string[],
  ) {
    const changes: Partial<BoardElement> = {};
    const defaults: Partial<BoardElement> = {
      groupId: '',
      parentId: '',
      fontFamily: '',
      bold: false,
      italic: false,
      locked: false,
      hollow: false,
      dash: false,
      text: '',
      label: '',
      fill: next.type === 'link' ? '#ffffff' : '',
      color: '',
      stroke: '',
      fontSize: 17,
      textAlign: next.type === 'shape' ? 'center' : 'left',
      strokeWidth: Number(next.width ?? defaultStrokeWidth(next.type)),
      heads: arrowHeads(next),
      crop: { zoom: 1, x: 0.5, y: 0.5 },
      data: {},
    };

    for (const key of fieldNames ??
      new Set([...Object.keys(expected ?? {}), ...Object.keys(next)])) {
      if (key === 'id' || key === 'version' || sameWireContentValue(expected?.[key], next[key])) {
        continue;
      }
      if (!sameWireContentValue(previous[key] ?? defaults[key], expected?.[key] ?? defaults[key])) {
        throw Object.assign(new Error('这项内容后来已被修改。'), {
          details: { elementId: previous.id },
        });
      }

      changes[key] = next[key] ?? defaults[key];
    }
    return changes;
  }

  function comparableContent(element: BoardElement | undefined) {
    return (
      element && Object.fromEntries(Object.entries(element).filter(([key]) => key !== 'version'))
    );
  }

  function inverseElementOperation(
    id: string,
    previous: BoardElement | undefined,
    next: BoardElement | undefined,
    expected: BoardElement | undefined,
    fields?: string[],
  ): Operation | null {
    if (!next && previous) {
      if (!sameWireContentValue(comparableContent(previous), comparableContent(expected))) {
        throw Object.assign(new Error('对象后来已被修改。'), { details: { elementId: id } });
      }

      return { op: 'delete', id };
    }
    if (next && !previous) {
      if (expected) {
        throw Object.assign(new Error('对象后来已被删除。'), { details: { elementId: id } });
      }

      return { op: 'add', id, element: next };
    }
    if (!next || !previous) {
      return null;
    }

    const changes = undoFieldChanges(previous, next, expected, fields);
    return Object.keys(changes).length ? { op: 'update', id, changes } : null;
  }

  const inverseOperations = (
    direction: 'undo' | 'redo',
    record: ChangeRecord,
    current: BoardElement[],
  ): Operation[] => {
    if (record.historyId) {
      return [{ op: 'restore', versionId: record.historyId, data: { mode: 'undo' } }];
    }

    const target = direction === 'undo' ? record.before : record.after;
    const expected = direction === 'undo' ? record.after : record.before;
    const operations: Operation[] = [];
    for (const id of record.ids) {
      const operation = inverseElementOperation(
        id,
        current.find((element) => element.id === id),
        target.find((element) => element.id === id),
        expected.find((element) => element.id === id),
        record.fields?.[id],
      );

      if (operation) {
        operations.push(operation);
      }
    }
    return operations;
  };

  function historyTargetLabel(id: string | undefined, record?: ChangeRecord) {
    if (!id) {
      return undefined;
    }
    if (id === '$order') {
      return '图层顺序';
    }
    if (id === '$style') {
      return '白板样式';
    }

    const matchesId = (element: BoardElement) => element.id === id;
    const element =
      boardRef.current.elements.find(matchesId) ??
      record?.after.find(matchesId) ??
      record?.before.find(matchesId);

    return element?.text?.trim().slice(0, 60) || element?.label?.trim().slice(0, 60) || id;
  }

  const changeHistory = (direction: 'undo' | 'redo') => {
    if (!canEditRef.current || queue.unconfirmedHistory) {
      return;
    }

    setHistoryError('');
    const handleCanvasCommand = direction === 'undo' ? '撤销' : '重做';
    let record: ChangeRecord | undefined;
    queue.enqueueHistory(boardRef.current, handleCanvasCommand, {
      prepare: () => {
        if (
          !canEditRef.current ||
          activeQueue.current !== queue ||
          currentScope.current !== queueScope
        ) {
          return;
        }

        const next = historyRef.current[direction].at(-1);
        if (!next) {
          return;
        }

        record = next;
        const before = boardRef.current;
        const operations = inverseOperations(direction, next, before.elements);
        if (!operations.length) {
          return;
        }

        return {
          before,
          operations,
          summary: `${handleCanvasCommand}：${next.summary}`,
          accepted: (receipt) => {
            if (activeQueue.current !== queue || currentScope.current !== queueScope) {
              return;
            }

            const history = historyRef.current;
            const revision = receipt.historyEntry?.revision ?? receipt.board.artifact.revision;
            const entry = { ...next, revision, historyId: receipt.historyEntry?.id };
            const laterEdit = history.lastEditRevision > revision;

            if (direction === 'undo') {
              updateHistory({
                ...history,
                undo: history.undo.filter((item) => item !== next),
                redo: laterEdit ? history.redo : [...history.redo, entry],
              });
            } else {
              const undo = insertUndoEntry(history.undo, entry);
              updateHistory({
                ...history,
                undo,
                redo: history.redo.filter((item) => item !== next),
              });
            }
          },
        };
      },
      rejected: (failure) => {
        if (activeQueue.current !== queue || currentScope.current !== queueScope) {
          return;
        }

        const error = failure as { message?: string; details?: { elementId?: string } } | null;
        const id = error?.details?.elementId;
        const target = historyTargetLabel(id, record);
        setHistoryError(
          `无法${handleCanvasCommand}${record ? `「${record.summary}」` : '这一步'}。${target ? `涉及「${target}」。` : ''}${error?.message || '请查看当前内容。'}`,
        );
      },
    });
  };

  const actionsRef = useCommittedRef({
    remove,
    duplicate,
    changeHistory,
    fit,
    handleCanvasCommand,
    stepZoom,
    updateSelected,
    chooseTool,
    editSelected,
  });
  useEffect(() => {
    if (
      annotationActive !== true ||
      !viewportElement.current ||
      !isEscapeActive(viewportElement.current)
    ) {
      return;
    }

    actionsRef.current
      .chooseTool('annotate', null, false)
      .then((accepted) => {
        if (!accepted) {
          annotationCallback.current?.(false);
        }
      })
      .catch(reportCanvasFailure);
  }, [annotationActive, annotationCallback, actionsRef, reportCanvasFailure]);
  const shortcutBlockedRef = useCommittedRef(
    [menu, zoomMenu, toolMenu, dialog, cropDialog, comparison, detachedTask].some(Boolean),
  );
  const activateNumericTool = (key: string) => {
    const canvas = viewportElement.current?.closest('.studio-whiteboard');
    if (readingRef.current || !singleKeys || document.visibilityState === 'hidden') {
      return false;
    }
    if (!(canvas instanceof HTMLElement) || !isEscapeActive(canvas) || shortcutBlockedRef.current) {
      return false;
    }
    if (canvas.querySelector('.studio-format-popover,[role="menu"],[role="dialog"]')) {
      return false;
    }

    const choice = key === '9' ? 'annotate' : TOOL_OPTIONS.find((item) => item.key === key)?.tool;
    if (!choice) {
      return false;
    }

    const annotationBlocked = choice === 'annotate' && (!canAnnotate || preview);
    const editingToolBlocked = !canEdit && !['select', 'pan', 'annotate'].includes(choice);
    if (annotationBlocked || editingToolBlocked) {
      return false;
    }

    chooseTool(choice).catch(reportCanvasFailure);
    return true;
  };
  const numericTool = useCommittedRef(activateNumericTool);
  const escapeAction = useCommittedRef((target: EventTarget | null) => {
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
  });
  useEffect(
    () =>
      registerEscapeLayer(
        viewportElement.current!.closest<HTMLElement>('.studio-whiteboard')!,
        (target) => escapeAction.current(target),
        0,
      ),
    [escapeAction],
  );
  useEffect(() => {
    const host = viewportElement.current;
    if (!host) {
      return;
    }

    const wheel = (event: WheelEvent) => {
      const readingIds = readingRef.current?.ids;
      const focusedId = readingIds?.length === 1 ? readingIds[0] : undefined;
      const focusedElement = boardRef.current.elements.find((element) => element.id === focusedId);
      const zoomRequest = event.ctrlKey || event.metaKey;
      if (focusedElement?.type === 'document' && zoomRequest) {
        event.preventDefault();
        return;
      }
      if (
        !event.ctrlKey &&
        !event.metaKey &&
        (event.target as HTMLElement).closest('[data-native-interactive]')
      ) {
        return;
      }

      event.preventDefault();
      viewportInteract.current?.();
      if (event.ctrlKey || event.metaKey) {
        const rect = host.getBoundingClientRect();
        documentFocusSurface.current?.setZoomAnchor({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
        setViewport((current) =>
          zoomAt(
            current,
            { x: event.clientX - rect.left, y: event.clientY - rect.top },
            current.zoom * wheelZoomFactor(event.deltaY, event.deltaMode),
          ),
        );
      } else if (documentFocusSurface.current) {
        let factor = 1;
        if (event.deltaMode === 1) {
          factor = 16;
        } else if (event.deltaMode === 2) {
          factor = documentFocusSurface.current.clip.h;
        }
        documentFocusSurface.current.scrollBy({
          x: event.deltaX * factor,
          y: event.deltaY * factor,
        });
      } else {
        setViewport((current) => ({
          ...current,
          x: current.x - event.deltaX,
          y: current.y - event.deltaY,
        }));
      }
    };
    host.addEventListener('wheel', wheel, { passive: false, capture: true });
    return () => host.removeEventListener('wheel', wheel, true);
  }, [readingRef, viewportInteract, setViewport]);
  useEffect(() => {
    function documentOwnsShortcut(target: Element, host: HTMLDivElement) {
      const reading = readingRef.current;
      if (reading?.ids.length !== 1) {
        return false;
      }

      const id = reading.ids[0];
      const document = boardRef.current.elements.find((element) => element.id === id);
      if (document?.type !== 'document') {
        return false;
      }

      return (
        target === host ||
        target.closest<HTMLElement>('.studio-document-focus')?.dataset.documentId === id
      );
    }

    function handleViewportShortcut(
      event: KeyboardEvent,
      commandKey: boolean,
      ownsExpandedDocument: boolean,
    ) {
      const zoomShortcut = commandKey && ['+', '=', '-', '0'].includes(event.key);
      const viewShortcut = event.shiftKey && ['Digit0', 'Digit1', 'Digit2'].includes(event.code);
      if (!zoomShortcut && !viewShortcut) {
        return false;
      }
      if (readingRef.current && !ownsExpandedDocument) {
        return false;
      }

      event.preventDefault();
      if (readingRef.current) {
        return true;
      }

      const actions = actionsRef.current;
      if (zoomShortcut) {
        if (event.key === '0') {
          actions.fit();
        } else {
          actions.stepZoom(event.key === '-' ? 1 / 1.2 : 1.2);
        }
      } else if (event.code === 'Digit0') {
        actions.stepZoom(1 / viewportRef.current.zoom);
      } else {
        actions.fit(event.code === 'Digit1' ? 'all' : 'selection');
      }
      return true;
    }

    function primaryShortcut(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      const actions = actionsRef.current;
      switch (key) {
        case 'a':
          event.preventDefault();
          selectIds(boardRef.current.elements.map((element) => element.id));
          return true;
        case 'c':
          if (selectionRef.current.length) {
            const elements = boardRef.current.elements;
            const ids = expandMoveIds(elements, selectionRef.current);
            clipboard.current = structuredClone(
              elements.filter((element) => ids.includes(element.id)),
            );
          }
          return true;
        case 'x':
          event.preventDefault();
          actions.handleCanvasCommand('cut').catch(reportCanvasFailure);
          return true;
        case 'l':
          if (event.shiftKey) {
            event.preventDefault();
            actions.handleCanvasCommand('lock').catch(reportCanvasFailure);
            return true;
          }
          return false;
        default:
          return editShortcut(event, key);
      }
    }

    function editShortcut(event: KeyboardEvent, key: string) {
      if (!canEdit) {
        return false;
      }

      const actions = actionsRef.current;
      switch (key) {
        case 'g':
          event.preventDefault();
          actions
            .handleCanvasCommand(event.shiftKey ? 'ungroup' : 'group')
            .catch(reportCanvasFailure);

          return true;
        case '[':
        case ']': {
          event.preventDefault();
          const front = event.shiftKey ? 'front' : 'forward';
          const back = event.shiftKey ? 'back' : 'backward';
          actions.handleCanvasCommand(key === ']' ? front : back).catch(reportCanvasFailure);
          return true;
        }
        case 'd':
          event.preventDefault();
          actions.duplicate();
          return true;
        case 'z':
          event.preventDefault();
          actions.changeHistory(event.shiftKey ? 'redo' : 'undo');
          return true;
        case 'y':
          event.preventDefault();
          actions.changeHistory('redo');
          return true;
        default:
          return false;
      }
    }

    function handleAlignmentShortcut(event: KeyboardEvent, commandKey: boolean) {
      const alignmentKey = event.altKey && !event.shiftKey;
      if (!canEdit || commandKey || !alignmentKey) {
        return false;
      }

      type AlignmentEdge = Parameters<typeof alignSelection>[2];
      const edges: Partial<Record<string, AlignmentEdge>> = {
        a: 'left',
        h: 'hcenter',
        d: 'right',
        w: 'top',
        v: 'vcenter',
        s: 'bottom',
      };
      const edge = edges[event.key.toLowerCase()];
      if (!edge) {
        return false;
      }

      event.preventDefault();
      apply(
        alignSelection(boardRef.current.elements, selectionRef.current, edge),
        '对齐元素',
      ).catch(reportCanvasFailure);

      return true;
    }

    function handleArrowShortcut(event: KeyboardEvent) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const delta = {
        x: Number(event.key === 'ArrowRight') * step - Number(event.key === 'ArrowLeft') * step,
        y: Number(event.key === 'ArrowDown') * step - Number(event.key === 'ArrowUp') * step,
      };

      if (canEdit && selectionRef.current.length) {
        apply(
          moveOperations(boardRef.current.elements, selectionRef.current, delta),
          '移动元素',
        ).catch(reportCanvasFailure);
      } else {
        setViewport((value) => ({
          ...value,
          x: value.x - delta.x * 24,
          y: value.y - delta.y * 24,
        }));
      }
    }

    function handleSelectionShortcut(event: KeyboardEvent, commandKey: boolean) {
      if (commandKey && primaryShortcut(event)) {
        return;
      }
      if (handleAlignmentShortcut(event, commandKey)) {
        return;
      }

      if (canEdit && selectionRef.current.length && ['Delete', 'Backspace'].includes(event.key)) {
        event.preventDefault();
        actionsRef.current.remove();
        return;
      }
      if (!commandKey && event.key.startsWith('Arrow')) {
        handleArrowShortcut(event);
        return;
      }
      const modified = commandKey || event.altKey || event.shiftKey;
      if (modified || event.repeat) {
        return;
      }

      if (['Enter', 'F2'].includes(event.key) && actionsRef.current.editSelected()) {
        event.preventDefault();
        return;
      }
      if (numericTool.current(event.key)) {
        event.preventDefault();
      }
    }

    function handleCanvasNavigation(
      event: KeyboardEvent,
      target: Element,
      commandKey: boolean,
      ownsExpandedDocument: boolean,
    ) {
      if (handleViewportShortcut(event, commandKey, ownsExpandedDocument)) {
        return;
      }
      if (target.closest('[data-document-content],[data-document-controls]')) {
        return;
      }

      const activatesButton = ['Enter', ' '].includes(event.key) || event.code === 'Space';
      if (target.closest('button,a[href]') && activatesButton) {
        return;
      }

      if (event.code === 'Space') {
        setAnnotationHoverId(null);
        spaceHeld.current = true;
        setSpacePan(true);
        event.preventDefault();
        return;
      }
      if (readingRef.current) {
        const documentSearch = commandKey && event.key.toLowerCase() === 'f';
        if (documentFocusSurface.current && documentSearch) {
          event.preventDefault();
          viewportElement.current
            ?.querySelector<HTMLInputElement>('.studio-document-focus [aria-label="文档内查找"]')
            ?.focus();
        } else if (['Delete', 'Backspace'].includes(event.key)) {
          event.preventDefault();
        }
        return;
      }
      handleSelectionShortcut(event, commandKey);
    }

    const keyDown = (event: KeyboardEvent) => {
      const usesComposition = event.isComposing || event.key === 'Process';
      const host = viewportElement.current;
      if (event.defaultPrevented || usesComposition || !host) {
        return;
      }
      if (!isEscapeActive(host)) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      const canvas = host.closest('.studio-whiteboard');
      if (!target || !canvas?.contains(target) || document.visibilityState === 'hidden') {
        return;
      }

      const commandKey = event.ctrlKey || event.metaKey;
      const ownsExpandedDocument = documentOwnsShortcut(target, host);
      if (ownsExpandedDocument && commandKey && ['+', '=', '-', '0'].includes(event.key)) {
        event.preventDefault();
        return;
      }
      if (
        shortcutBlockedRef.current ||
        canvas.querySelector('.studio-format-popover,[role="menu"],[role="dialog"]')
      ) {
        return;
      }
      if (
        target.closest(
          'input,textarea,select,[contenteditable]:not([contenteditable="false"]),iframe,[role="dialog"],[role="menu"],[role="listbox"],[role="combobox"]',
        )
      ) {
        return;
      }

      handleCanvasNavigation(event, target, commandKey, ownsExpandedDocument);
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spaceHeld.current = false;
        setSpacePan(false);
      }
    };
    const resetSpace = () => {
      spaceHeld.current = false;
      setSpacePan(false);
      if (gestureRef.current?.kind === 'pan') {
        updateGesture(null);
      }
    };
    window.addEventListener('blur', resetSpace);
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    return () => {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', resetSpace);
    };
  }, [
    canEdit,
    selectIds,
    apply,
    actionsRef,
    readingRef,
    shortcutBlockedRef,
    viewportRef,
    numericTool,
    updateGesture,
    selectionRef,
    reportCanvasFailure,
    setAnnotationHoverId,
    setViewport,
  ]);

  const handleNavigationCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    navigationClick.current = false;
    const panToolActive = tool === 'pan' && !annotationMode.current;
    const leftButtonPan = event.button === 0 && (spaceHeld.current || panToolActive);
    if (event.button !== 1 && !leftButtonPan) {
      if (event.button === 0 && !readingRef.current) {
        const target = event.target as HTMLElement;
        const id = target.closest('[data-element-id]')?.getAttribute('data-element-id');
        if (id && target.closest('[data-document-controls]')) {
          selectIds([id]);
        }
      }
      return;
    }
    navigationClick.current = event.button === 0;
    const target = event.target as HTMLElement;
    const reader = target.closest<HTMLElement>('.studio-document-scroll');
    if (reader && !target.closest('input,textarea,select,[contenteditable="true"]')) {
      reader.focus({ preventScroll: true });
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

    if (documentPlacementClick.current === 'released') {
      documentPlacementClick.current = null;
    }
    const annotationHit = annotating ? nativeAnnotationHit(event.target as Element) : undefined;
    if (annotationHit === 'blocked') {
      return;
    }
    if (belongsToNativeControl()) {
      return;
    }

    if (readingRef.current) {
      navigationClick.current = true;
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

    function belongsToNativeControl() {
      if (moveHandle) {
        return false;
      }

      const target = event.target as Element;
      if (element?.type === 'document' && target.closest('[data-document-content]')) {
        event.stopPropagation();
        return true;
      }
      return Boolean(!annotating && target.closest('[data-native-interactive]'));
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
      const groupIds = element.groupId
        ? contentElements.filter((item) => item.groupId === element.groupId).map((item) => item.id)
        : [element.id];
      const current = selectionRef.current;
      const wasSelected = current.includes(element.id);
      let ids = wasSelected ? current : groupIds;
      if (event.shiftKey) {
        ids = wasSelected
          ? current.filter((id) => !groupIds.includes(id))
          : [...new Set([...current, ...groupIds])];
      }

      const newlySingleSelection = !wasSelected && ids.length === 1;
      if (isHtmlEmbed(element) && (moveHandle || newlySingleSelection)) {
        host.setPointerCapture(event.pointerId);
      }
      selectIds(ids);
      const toggleOff = event.shiftKey && wasSelected;
      if (!canEdit || element.locked || toggleOff) {
        return;
      }

      const moveIds = expandMoveIds(
        contentElements,
        ids.filter((id) => !contentElements.find((item) => item.id === id)?.locked),
      );
      const copies = event.altKey
        ? duplicateElements(contentElements, moveIds, { x: 0, y: 0 })
        : undefined;
      updateGesture({
        kind: 'move',
        start: point,
        screenStart: { x: event.clientX, y: event.clientY },
        current: point,
        ids: copies ? copies.map((element) => element.id) : moveIds,
        elements: copies ?? contentElements.filter((item) => moveIds.includes(item.id)),
        copies,
      });

      return;
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
      const created = makeElement(pointerTool as ElementType, point, {
        ...(pointerTool === 'shape' ? { kind: shapeKind } : {}),
        ...(['text', 'shape', 'note'].includes(pointerTool) ? { text: '' } : {}),
        ...(pointerTool === 'document' ? { document: defaultDocument(newClientId('block')) } : {}),
        ...(pointerTool === 'stroke' || pointerTool === 'arrow'
          ? { stroke: penColor, color: penColor, strokeWidth: penWidth }
          : {}),
        ...(pointerTool === 'sticker'
          ? { text: getBoardSticker(sticker)!.label, data: { stickerIconId: sticker } }
          : {}),
      });

      if (pointerTool === 'stroke' || pointerTool === 'arrow') {
        if (pointerTool === 'arrow') {
          created.from = element?.id ?? [point.x, point.y];
          created.to = [point.x, point.y];
        }
        updateGesture({
          kind: 'draw',
          start: point,
          points: [point],
          element: created,
          ...(element ? { from: element.id } : {}),
        });
      } else {
        updateGesture({
          kind: 'create',
          start: point,
          element: created,
          initialSize: { w: created.w, h: created.h },
        });
      }
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
    begin(event as ReactPointerEvent<HTMLDivElement>, element, true);
  };
  const handleResizeStart = (event: ReactPointerEvent, handle: ResizeHandle) => {
    const ids = selectionRef.current;
    const elements = contentElements;
    const box = nativeSelectionBounds(elements, ids);
    const primaryEditPointer = event.button === 0 && canEdit && !annotating;
    if (
      !primaryEditPointer ||
      !box ||
      elements.some((element) => ids.includes(element.id) && element.locked)
    ) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    viewportElement.current?.setPointerCapture(event.pointerId);
    updateGesture({
      kind: 'resize',
      start: boardPoint(event.clientX, event.clientY),
      elements,
      ids,
      box,
      handle,
      operations: [],
    });
  };
  const handleRotateStart = (event: ReactPointerEvent) => {
    const ids = selectionRef.current;
    const elements = contentElements;
    const box = nativeSelectionBounds(elements, ids);
    const primaryEditPointer = event.button === 0 && canEdit && !annotating;
    if (!primaryEditPointer || !box) {
      return;
    }
    if (
      elements.some((element) => {
        if (!ids.includes(element.id)) {
          return false;
        }

        return element.locked || (element.type !== 'arrow' && !ROTATABLE_TYPES.has(element.type));
      })
    ) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    viewportElement.current?.setPointerCapture(event.pointerId);
    updateGesture({
      kind: 'rotate',
      start: boardPoint(event.clientX, event.clientY),
      elements,
      ids,
      box,
      operations: [],
    });
  };
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
    const hovering = boardPoint(event.clientX, event.clientY);
    const surface = documentFocusSurface.current;
    function publishCursor() {
      if (surface && readingRef.current) {
        const host = viewportElement.current!.getBoundingClientRect();
        const point = { x: event.clientX - host.left, y: event.clientY - host.top };
        const target = boardRef.current.elements.find((element) => element.id === surface.id);
        const inside =
          point.x >= surface.clip.x &&
          point.x <= surface.clip.x + surface.clip.w &&
          point.y >= surface.clip.y &&
          point.y <= surface.clip.y + surface.clip.h;
        const position =
          inside && target
            ? anchorBounds(
                {
                  coordinateSpace: 'element',
                  elementIds: [surface.id],
                  x: (point.x - surface.clip.x) / surface.clip.w,
                  y: (point.y - surface.clip.y) / surface.clip.h,
                },
                [target],
              )
            : null;
        onCursorMove?.(position ? { x: position.x, y: position.y } : null);
      } else {
        onCursorMove?.(hovering);
      }
    }
    publishCursor();
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

    const sample = boardPoint(event.clientX, event.clientY);
    const snapArrow = event.shiftKey && current.kind === 'draw' && current.element.type === 'arrow';
    const point = snapArrow ? snappedDrawingPoint(current.start, sample) : sample;
    function dragSelection(current: Extract<Gesture, { kind: 'move' }>) {
      const screen = { x: event.clientX, y: event.clientY };
      if (!selectionHasDragged(current, screen)) {
        return;
      }

      if (!current.dragging) {
        viewportElement.current?.setPointerCapture(event.pointerId);
      }
      const snapped = selectionDragDelta(
        current,
        point,
        viewportRef.current.zoom,
        boardRef.current.elements,
      );
      setGuides(snapped.guides);
      updateGesture({
        ...current,
        dragging: true,
        current: { x: current.start.x + snapped.delta.x, y: current.start.y + snapped.delta.y },
      });
    }
    function resizeGesture(current: Extract<Gesture, { kind: 'resize' }>) {
      updateGesture({ ...current, operations: resizeGestureOperations(current, point, event) });
    }

    function rotateGesture(current: Extract<Gesture, { kind: 'rotate' }>) {
      updateGesture({
        ...current,
        operations: rotateGestureOperations(current, point, event.shiftKey),
      });
    }

    function moveArrowPoint(current: Extract<Gesture, { kind: 'arrow-point' }>) {
      updateGesture({ ...current, operations: arrowPointOperations(current, point) });
    }
    function continueDrawing(current: Extract<Gesture, { kind: 'draw' }>) {
      if (current.points.length >= maxDrawingPoints) {
        setToolNotice('本笔已达到长度上限，正在保存当前笔迹，请另起一笔。');
        handlePointerUp(event);
        return;
      }
      if (event.shiftKey && current.element.type === 'stroke') {
        const anchor = current.straightStart ?? current.points.at(-1)!;
        const prefix = current.straightPoints ?? current.points;

        updateGesture({
          ...current,
          straightStart: anchor,
          straightPoints: prefix,
          points: [...prefix, snappedDrawingPoint(anchor, point)],
        });

        return;
      }
      const previous = current.points.at(-1)!;
      if (Math.hypot(point.x - previous.x, point.y - previous.y) > 2 / viewportRef.current.zoom) {
        updateGesture({
          ...current,
          straightStart: undefined,
          straightPoints: undefined,
          points: [...current.points, point],
        });
      }
    }
    function resizeCreatedElement(current: Extract<Gesture, { kind: 'create' }>) {
      const element = creationPlacement(
        current,
        point,
        viewportRef.current.zoom,
        event.shiftKey,
        false,
      );

      if (element !== current.element) {
        updateGesture({ ...current, element });
      }
    }
    switch (current.kind) {
      case 'pan':
        if (current.documentId) {
          if (surface?.id === current.documentId) {
            surface.scrollBy({
              x: current.start.x - event.clientX,
              y: current.start.y - event.clientY,
            });
          }
          updateGesture({ ...current, start: { x: event.clientX, y: event.clientY } });
        } else {
          setViewport({
            ...current.viewport,
            x: current.viewport.x + event.clientX - current.start.x,
            y: current.viewport.y + event.clientY - current.start.y,
          });
        }
        return;
      case 'marquee':
      case 'annotate':
        updateGesture({ ...current, end: point });
        return;
      case 'move':
        return dragSelection(current);
      case 'connect':
        updateGesture({ ...current, current: point });
        return;
      case 'resize':
        return resizeGesture(current);
      case 'rotate':
        return rotateGesture(current);
      case 'arrow-point':
        return moveArrowPoint(current);
      case 'draw':
        return continueDrawing(current);
      case 'create':
        return resizeCreatedElement(current);
    }
  };
  const handlePointerUp = (event: ReactPointerEvent) => {
    let current = gestureRef.current;
    if (!current) {
      return;
    }
    if (current.kind === 'pan' && current.frame) {
      return;
    }

    if (
      current.kind === 'pan' &&
      current.documentId &&
      documentFocusSurface.current?.id === current.documentId
    ) {
      documentFocusSurface.current.scrollBy({
        x: current.start.x - event.clientX,
        y: current.start.y - event.clientY,
      });
    }
    const point = boardPoint(event.clientX, event.clientY);
    current = finalizeGesturePlacement(
      current,
      {
        point,
        screen: { x: event.clientX, y: event.clientY },
        zoom: viewportRef.current.zoom,
        modifiers: event,
      },
      boardRef.current.elements,
    );
    let finalPresence = publishedGesture.current;
    const operationId = current.operationId;
    const previewFinal = (
      elements: BoardElement[],
      origin: 'create' | 'existing',
      kind: NativeGesture['kind'],
    ) => {
      if (!operationId) {
        return;
      }

      finalPresence = {
        id: operationId,
        operationId,
        baseRevision: current!.baseRevision,
        origin,
        kind,
        elements,
        ...(origin === 'create' ? { storedIds: elements.map((element) => element.id) } : {}),
      };
      publishedGesture.current = finalPresence;
      publishGesture(finalPresence);
    };
    const settledGesture = (saved: Board | null | undefined) => {
      if (!operationId) {
        return;
      }

      if (saved) {
        confirmGesture({
          id: operationId,
          operationId,
          revision: saved.artifact.revision,
          versions: Object.fromEntries(
            (finalPresence?.elements ?? []).flatMap((element) => {
              const actual = saved.elements.find((value) => value.id === element.id);
              return actual ? [[actual.id, actual.version]] : [];
            }),
          ),
        });
      } else {
        failGesture({ id: operationId, operationId });
      }
    };
    updateGesture(null);
    setGuides([]);
    if (viewportElement.current?.hasPointerCapture(event.pointerId)) {
      viewportElement.current.releasePointerCapture(event.pointerId);
    }
    function finishAnnotation(current: Extract<Gesture, { kind: 'annotate' }>) {
      const area = normalizedRect(current.start, current.end);
      const dragged = Math.hypot(area.w, area.h) * viewportRef.current.zoom > 5;
      const element = dragged ? undefined : current.element;
      let targets = element ? [element] : [];
      if (dragged) {
        targets = boardRef.current.elements.filter((item) =>
          intersects(area, elementBounds(item, boardRef.current.elements)),
        );
      }
      const relative = element
        ? relativeElementPoint(
            elementBounds(element, boardRef.current.elements) as BoardElement,
            current.start,
          )
        : undefined;
      setLocalAnnotationTarget(
        element
          ? { elementIds: [element.id], coordinateSpace: 'element', ...relative }
          : {
              coordinateSpace: 'board',
              x: current.start.x,
              y: current.start.y,
              ...(dragged ? area : {}),
            },
      );
      const anchor: Anchor = element
        ? { elementIds: [element.id], coordinateSpace: 'element', ...relative }
        : {
            coordinateSpace: 'board',
            elementIds: targets.map((item) => item.id),
            x: current.start.x,
            y: current.start.y,
            ...(dragged ? area : {}),
          };
      anchor.pin = { coordinateSpace: 'board', ...boardPoint(event.clientX, event.clientY) };
      const rangeCount = targets.length ? ` · ${targets.length} 个对象` : '';
      let annotationLabel = dragged ? `画布范围${rangeCount}` : '画布位置';
      if (element) {
        annotationLabel = annotationElementLabel(element);
      }
      onAnnotateNative?.({
        anchor,
        label: annotationLabel,
        versions: Object.fromEntries(targets.map((item) => [item.id, item.version])),
        screenPoint: { x: event.clientX, y: event.clientY },
      });

      return;
    }
    function finishMarquee(current: Extract<Gesture, { kind: 'marquee' }>) {
      const box = normalizedRect(current.start, current.end);
      const ids = boardRef.current.elements
        .filter((element) => element.type !== 'arrow' && intersects(box, element))
        .map((element) => element.id);
      selectIds(current.additive ? [...new Set([...selectionRef.current, ...ids])] : ids);
      return;
    }
    function finishMove(current: Extract<Gesture, { kind: 'move' }>) {
      if (!current.dragging) {
        if (finalPresence) {
          publishGesture({ ...finalPresence, cancelled: true });
        }
        return;
      }
      const delta = {
        x: current.current.x - current.start.x,
        y: current.current.y - current.start.y,
      };
      const operations = moveOperations(current.elements, current.ids, delta);
      const next = projectGestureGeometry(current.elements, operations);
      previewFinal(next, current.copies ? 'create' : 'existing', 'move');
      if (current.copies) {
        addElements(next, '拖动复制', { operationId })
          .then(settledGesture)
          .catch((failure) => {
            settledGesture(null);
            reportCanvasFailure(failure);
          });
      } else {
        apply(operations, '移动元素', current.elements, true, operationId)
          .then(settledGesture)
          .catch((failure) => {
            settledGesture(null);
            reportCanvasFailure(failure);
          });
      }
    }
    function finishConnection(current: Extract<Gesture, { kind: 'connect' }>) {
      const source = current.element;
      const dragged =
        Math.hypot(point.x - current.start.x, point.y - current.start.y) *
          viewportRef.current.zoom >=
        5;

      if (!dragged && (source.type === 'note' || source.type === 'shape')) {
        const next = adjacentElement(
          source,
          current.side,
          makeElement(source.type, source, {
            w: source.w,
            h: source.h,
            kind: source.kind,
            fill: source.fill,
            color: source.color,
            stroke: source.stroke,
            strokeWidth: source.strokeWidth,
            fontSize: source.fontSize,
            text: '',
          }),
          boardRef.current.elements,
        );
        const arrow =
          source.type === 'shape'
            ? makeElement('arrow', connectionPoint(source, current.side), {
                from: source.id,
                fromSide: current.side,
                to: next.id,
                toSide: OPPOSITE_SIDE[current.side],
                color: penColor,
                stroke: penColor,
                strokeWidth: penWidth,
              })
            : undefined;
        const elements = arrow ? [next, arrow] : [next];
        previewFinal(elements, 'create', 'arrow');
        (async () => {
          const saved = await addElements(elements, '添加相邻元素', {
            edit: source.type === 'note',
            operationId,
          });
          settledGesture(saved);
          if (saved) {
            selectIds([next.id]);
          }
        })().catch(reportCanvasFailure);
      } else if (dragged && source.type !== 'note') {
        const target = connectionAtPoint(
          boardRef.current.elements,
          point,
          viewportRef.current.zoom,
          [source.id],
        );
        const start = connectionPoint(source, current.side);
        const box = normalizedRect(start, point);
        const arrow = makeElement('arrow', start, {
          ...box,
          from: source.id,
          fromSide: current.side,
          to: target?.element.id ?? [point.x, point.y],
          ...(target?.side ? { toSide: target.side } : {}),
          color: penColor,
          stroke: penColor,
          strokeWidth: penWidth,
        });
        previewFinal([arrow], 'create', 'arrow');
        addElements([arrow], '添加连接线', { operationId })
          .then(settledGesture)
          .catch((failure) => {
            settledGesture(null);
            reportCanvasFailure(failure);
          });
      } else if (finalPresence) {
        publishGesture({ ...finalPresence, cancelled: true });
      }
    }
    function finishGeometry(
      current: Extract<Gesture, { kind: 'resize' | 'rotate' | 'arrow-point' }>,
    ) {
      const commit = geometryCommit(current, point, boardRef.current.elements);
      if (!commit) {
        if (finalPresence) {
          publishGesture({ ...finalPresence, cancelled: true });
        }
        return;
      }
      previewFinal(commit.preview, 'existing', commit.kind);
      apply(commit.operations, commit.summary, commit.elements, true, operationId)
        .then(settledGesture)
        .catch((failure) => {
          settledGesture(null);
          reportCanvasFailure(failure);
        });
    }
    function finishDrawing(current: Extract<Gesture, { kind: 'draw' }>) {
      const { element: drawn, reachedLimit } = finalizeDrawing(
        current,
        point,
        event.shiftKey,
        boardRef.current.elements,
      );

      if (reachedLimit) {
        setToolNotice('本笔已达到长度上限，正在保存当前笔迹，请另起一笔。');
      }
      previewFinal([drawn], 'create', current.element.type === 'stroke' ? 'ink' : 'arrow');
      addElements([drawn], current.element.type === 'stroke' ? '添加笔迹' : '添加连接线', {
        operationId,
      })
        .then(settledGesture)
        .catch((failure) => {
          settledGesture(null);
          reportCanvasFailure(failure);
        });
    }
    function finishCreation(current: Extract<Gesture, { kind: 'create' }>) {
      previewFinal([current.element], 'create', 'shape');
      if (current.element.type === 'document') {
        documentPlacementClick.current = 'released';
        setTool('select');
      }
      addElements(
        [current.element],
        current.element.type === 'document' ? '添加文档区域' : '添加元素',
        { edit: ['text', 'note'].includes(current.element.type), operationId },
      )
        .then(settledGesture)
        .catch((failure) => {
          settledGesture(null);
          reportCanvasFailure(failure);
        });
    }
    switch (current.kind) {
      case 'pan':
        return;
      case 'annotate':
        return finishAnnotation(current);
      case 'marquee':
        return finishMarquee(current);
      case 'move':
        return finishMove(current);
      case 'connect':
        return finishConnection(current);
      case 'resize':
      case 'rotate':
      case 'arrow-point':
        return finishGeometry(current);
      case 'draw':
        return finishDrawing(current);
      case 'create':
        return finishCreation(current);
    }
  };

  const currentMoveElements = (
    moving: Extract<Gesture, { kind: 'move' }>,
    elements: BoardElement[],
    patches: Operation[],
  ) =>
    moving.copies
      ? [...elements, ...projectGestureGeometry(moving.copies, patches)]
      : projectGestureGeometry(elements, patches);

  const remoteElements = useMemo(() => {
    if (!peerGestures.length) {
      return contentElements;
    }

    const elements = contentElements.slice();
    const localIntentIds = new Set([
      ...movingIds,
      ...editingIds,
      ...queueTasks.flatMap((task) => task.keys),
    ]);

    for (const peer of peerGestures) {
      for (const element of peer.elements) {
        if (localIntentIds.has(element.id)) {
          continue;
        }

        applyPeerGeometry(elements, element, peer.kind);
      }
    }
    return elements;
  }, [contentElements, movingIds, editingIds, queueTasks, peerGestures]);
  const renderedElements = useMemo(() => {
    if (!gesture) {
      return remoteElements;
    }

    if (gesture.kind === 'move') {
      const patches = moveOperations(gesture.elements, gesture.ids, {
        x: gesture.current.x - gesture.start.x,
        y: gesture.current.y - gesture.start.y,
      });

      return currentMoveElements(gesture, remoteElements, patches);
    }
    if (gesture.kind === 'resize' || gesture.kind === 'rotate' || gesture.kind === 'arrow-point') {
      return projectGestureGeometry(remoteElements, gesture.operations);
    }
    if (gesture.kind === 'create') {
      return gesture.element.type === 'document'
        ? remoteElements
        : [...remoteElements, gesture.element];
    }

    if (
      gesture.kind === 'connect' &&
      gesture.element.type !== 'note' &&
      Math.hypot(gesture.current.x - gesture.start.x, gesture.current.y - gesture.start.y) *
        viewport.zoom >=
        5
    ) {
      const target = connectionAtPoint(contentElements, gesture.current, viewport.zoom, [
        gesture.element.id,
      ]);

      return [
        ...remoteElements,
        makeElement('arrow', connectionPoint(gesture.element, gesture.side), {
          id: 'connection-preview',
          from: gesture.element.id,
          fromSide: gesture.side,
          to: target?.element.id ?? [gesture.current.x, gesture.current.y],
          ...(target?.side ? { toSide: target.side } : {}),
          color: penColor,
          stroke: penColor,
          strokeWidth: penWidth,
        }),
      ];
    }
    if (gesture.kind === 'draw') {
      return [...remoteElements, drawnElement(gesture)];
    }

    return remoteElements;
  }, [contentElements, remoteElements, gesture, viewport.zoom, penColor, penWidth]);
  const arrowElementIndex = useMemo(
    () => createArrowElementIndex(renderedElements),
    [renderedElements],
  );
  const sectionTitles = useMemo(
    () => sectionTitleDetails(renderedElements, presentationZoom),
    [renderedElements, presentationZoom],
  );
  const titleCandidates = useMemo(
    () =>
      renderedElements.filter(
        (element) =>
          showHtmlCaption(element, viewport.zoom) ||
          (element.type === 'container' &&
            (element.id === editing?.id || sectionTitles.has(element.id))),
      ),
    [renderedElements, viewport.zoom, sectionTitles, editing?.id],
  );
  const surfaceScene = useMemo(
    () =>
      nativeSurfaces(
        reading
          ? renderedElements.filter((element) => reading.ids.includes(element.id))
          : renderedElements,
        viewStyle,
        (element) => nativeFill(element, viewStyle, nativePaint(element.fill, viewTheme)),
      ),
    [renderedElements, reading, viewStyle, viewTheme],
  );
  const peerPreviewFrames = peerGestures.flatMap((peer) => {
    const page = presence.find((page) => page.peerId === peer.peerId);
    const busyIds = [
      ...(page?.context?.editingIds ?? []),
      ...(Array.isArray(page?.context?.movingIds) ? (page.context.movingIds as string[]) : []),
    ];

    if (
      peer.kind === 'upload' &&
      peer.elements.length &&
      peer.elements.every((element) => busyIds.includes(element.id))
    ) {
      return [];
    }

    const bounds = boundsOf(peer.elements.map((element) => elementBounds(element, remoteElements)));
    return bounds ? [{ peer, bounds }] : [];
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

  const runMediaUpload = async (batch: MediaUploadBatch) => {
    if (uploadBusyRef.current || !canEditRef.current || batch.scope !== currentScope.current) {
      return;
    }

    uploadBusyRef.current = true;
    setUploadError('');
    setError('');
    const live = () =>
      uploadAlive.current &&
      mediaUploadRef.current === batch &&
      batch.scope === currentScope.current;
    batch.phase = batch.elements.length < batch.files.length ? 'uploading' : 'queued';
    batch.error = undefined;
    setUploading(batch.phase === 'uploading');
    setMediaUpload({ ...batch });
    publishUpload(batch);
    function attachUploadedMedia() {
      batch.phase = 'queued';
      batch.referenceQueued = true;
      setMediaUpload({ ...batch });
      const failed = queue.tasks.find(
        (task) =>
          task.state === 'failed' &&
          task.operations.some(
            (operation) =>
              operation.op === 'add' &&
              batch.elements.some(
                (element) => element.id === (operation.id ?? operation.element?.id),
              ),
          ),
      );
      const pending = failed
        ? queue.retry(failed.id)
        : queue.enqueue(
            boardRef.current,
            batch.elements.map((element) => ({ op: 'add', id: element.id, element })),
            '添加媒体',
            undefined,
            true,
            undefined,
            batch.id,
          );
      setUploading(false);
      return pending;
    }
    async function readMediaSource(file: File) {
      if (
        !/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type) &&
        !/^video\/(mp4|webm|quicktime)$/.test(file.type)
      ) {
        throw new Error('支持 PNG、JPEG、WebP、GIF、SVG 图片，以及 MP4、WebM、MOV 视频。');
      }
      if (file.size > 20 * 1024 * 1024) {
        throw new Error(`${file.name} 超过 20 MB，请压缩后添加。`);
      }

      let src: string;
      if (client.baseUrl) {
        const response = await studioRequest(
          client,
          new URL(`/api/assets?artifactId=${encodeURIComponent(batch.artifactId)}`, client.baseUrl),
          {
            method: 'POST',
            headers: {
              ...(client.token ? { Authorization: `Bearer ${client.token}` } : {}),
              'Content-Type': file.type,
              'X-Filename': encodeURIComponent(file.name),
              'X-Studio-Name': encodeURIComponent(actor.name),
            },
            body: file,
            signal: batch.abort.signal,
          },
        );
        const result = (await response.json()) as { src?: string; error?: { message?: string } };
        if (!response.ok || !result.src) {
          throw new Error(result.error?.message ?? `资源上传失败（${response.status}）。`);
        }

        src = result.src;
      } else {
        if (file.type.startsWith('video/') || file.size > 1024 * 1024) {
          throw new Error('大图片和视频需要连接本地 Studio 服务后添加。');
        }

        src = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('无法读取图片。'));
          reader.readAsDataURL(file);
        });
      }
      return src;
    }
    async function describeMedia(file: File, src: string) {
      const video = file.type.startsWith('video/');
      let w = video ? 480 : 360;
      let h = video ? 270 : 240;
      let data: BoardElement['data'];
      if (!video) {
        try {
          const image = new Image();
          image.src = assetDisplayUrl(src, client)!;
          await image.decode();
          const ratio = Math.min(1, 480 / image.naturalWidth, 360 / image.naturalHeight);
          w = image.naturalWidth * ratio;
          h = image.naturalHeight * ratio;
          data = { naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight };
        } catch (failure) {
          if (live()) {
            setToolNotice(`无法读取图片尺寸，已采用默认大小。${errorText(failure)}`);
          }
        }
      }
      return { video, w, h, data };
    }
    try {
      for (let index = batch.elements.length; index < batch.files.length; index++) {
        const file = batch.files[index]!;
        if (!live()) {
          return;
        }
        if (!canEditRef.current) {
          throw new Error('当前为只读，媒体草稿已保留。恢复编辑权限后可重试。');
        }

        const src = await readMediaSource(file);
        if (!live()) {
          return;
        }

        const { video, w, h, data } = await describeMedia(file, src);
        if (!live()) {
          return;
        }

        batch.elements.push(
          makeElement(
            'image',
            { x: batch.position.x + index * 32, y: batch.position.y + index * 32 },
            {
              id: batch.placeholders[index]!.id,
              w,
              h,
              text: file.name,
              data,
              ...(video ? { video: src } : { src }),
            },
          ),
        );
        setMediaUpload({ ...batch });
        publishUpload(batch);
      }
      if (!live()) {
        return;
      }
      if (!canEditRef.current) {
        throw new Error('当前为只读，已上传的媒体仍未加入白板。恢复编辑权限后可重试。');
      }

      const receipt = await attachUploadedMedia();
      if (!live()) {
        return;
      }
      if (!receipt) {
        throw (
          queue.tasks.find(
            (task) =>
              task.state === 'failed' &&
              task.keys.some((id) => batch.elements.some((element) => element.id === id)),
          )?.failure ?? new Error('媒体尚未加入白板，草稿已保留。')
        );
      }

      finishUpload(batch, true, receipt.board);
    } catch (failure) {
      if (!live()) {
        return;
      }

      batch.phase = 'failed';
      batch.error = errorText(failure);
      setMediaUpload({ ...batch });
      setUploadError(batch.error);
      publishUpload(batch, false, true);
    } finally {
      if (live()) {
        uploadBusyRef.current = false;
        setUploading(false);
      }
    }
  };
  const uploadMedia = async (files: FileList | File[] | null, position = centerPoint()) => {
    if (!files?.length || !canEditRef.current) {
      return;
    }

    const selected = [...files].slice(0, 12);
    if (mediaUploadRef.current) {
      setError('当前媒体尚未加入白板，请先完成重试或移除这份上传草稿。');
      return;
    }
    if (!(await chooseTool('select'))) {
      return;
    }

    const batch: MediaUploadBatch = {
      id: newClientId('upload'),
      scope: queueScope,
      artifactId: boardRef.current.artifact.id,
      baseRevision: boardRef.current.artifact.revision,
      intent: interactionIntent.current,
      files: selected,
      position: { ...position },
      placeholders: selected.map((file, index) =>
        makeElement(
          'image',
          { x: position.x + index * 32, y: position.y + index * 32 },
          { w: 360, h: 240, text: file.name },
        ),
      ),
      elements: [],
      phase: 'uploading',
      referenceQueued: false,
      frame: 0,
      sequence: 0,
      abort: new AbortController(),
    };
    mediaUploadRef.current = batch;
    await runMediaUpload(batch);
  };

  function handleEmbeddedNumericTool(key: string) {
    numericTool.current(key);
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

  function handleDocumentFocusSurface(element: BoardElement, surface: DocumentFocusSurface | null) {
    if (surface || documentFocusSurface.current?.id === element.id) {
      documentFocusSurface.current = surface;
      setFocusedDocumentSurface(surface);
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

  const renderElement = (element: BoardElement) => {
    function describeElement() {
      const picked = !reading && selection.includes(element.id);
      const hidden = Boolean(reading && !reading.ids.includes(element.id));
      const expanded = Boolean(reading && !hidden);
      const isEditing = editing?.id === element.id;
      const size = projectedSize(element, presentationZoom);
      const fontSize = element.fontSize ?? 17;
      const showText = expanded || isEditing || canReadCanvasText(size, fontSize, presentationZoom);
      const sectionTitle = sectionTitles.get(element.id);
      const showMediaControls = expanded || mediaControlsFit(size);
      const dash = element.dash && presentationZoom * 5 >= 1 ? '6 5' : undefined;
      const captionScale = Math.min(1 / viewport.zoom, 1);
      const inlineSelected = picked && selection.length === 1 && tool === 'select' && !annotating;
      const htmlMovable =
        !reading && tool === 'select' && !annotating && canEdit && !element.locked;
      const lineColor = semanticColor(
        nativePaint(element.stroke ?? element.color, viewTheme),
        viewStyle,
        viewStyle.muted,
      );

      return {
        picked,
        hidden,
        expanded,
        isEditing,
        size,
        fontSize,
        showText,
        sectionTitle,
        showMediaControls,
        dash,
        captionScale,
        inlineSelected,
        htmlMovable,
        lineColor,
      };
    }
    const {
      picked,
      hidden,
      expanded,
      isEditing,
      size,
      fontSize,
      showText,
      sectionTitle,
      showMediaControls,
      dash,
      captionScale,
      inlineSelected,
      htmlMovable,
      lineColor,
    } = describeElement();

    if (element.type === 'arrow') {
      return (
        <CanvasArrow
          key={element.id}
          element={element}
          elementIndex={arrowElementIndex}
          hidden={hidden}
          selected={picked}
          annotationHovered={annotationHover?.id === element.id}
          expanded={expanded}
          editing={isEditing}
          editLabel={isEditing ? renderTextEditor(element) : undefined}
          color={picked ? viewStyle.accent : lineColor}
          paper={viewStyle.paper}
          dash={dash}
          zoom={viewport.zoom}
          presentationZoom={presentationZoom}
          onClickCapture={handleAnnotationClickCapture}
          onPointerDown={(event) => begin(event, element)}
          onDoubleClick={(event) => handleArrowLabelDoubleClick(event, element)}
        />
      );
    }

    function elementPresentation() {
      const fill = nativeFill(element, viewStyle, nativePaint(element.fill, viewTheme));
      const color = nativePaint(element.color, viewTheme);
      const backdrop = nativeBackdrop(element, surfaceScene, fill);
      const textFill = element.type === 'container' ? 'transparent' : fill;
      let ink: string;
      if (element.type === 'table') {
        ink = nativeTableInk(color, viewStyle, viewStyle.paper);
      } else if (element.type === 'sticker') {
        ink = semanticColor(color, viewStyle, viewStyle.ink);
      } else {
        ink = nativeTextInk(color, viewStyle, textFill, backdrop);
      }
      const headerInk = element.type === 'table' ? nativeTableInk(color, viewStyle, fill) : ink;
      const style: CSSProperties = {
        display: hidden ? 'none' : undefined,
        left: element.x,
        top: element.y,
        width: element.w,
        height: element.h,
        color: ink,
        fontSize,
        fontFamily: element.fontFamily || viewStyle.fontFamily,
        fontWeight: element.bold ? 600 : 400,
        fontStyle: element.italic ? 'italic' : 'normal',
        textAlign: element.textAlign ?? (element.type === 'shape' ? 'center' : 'left'),
        transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
        ...(element.type === 'container'
          ? {
              borderColor: lineColor,
              borderStyle: element.dash && (expanded || dash) ? 'dashed' : 'solid',
              borderWidth: overviewStrokeWidth(element.strokeWidth ?? 1, viewport.zoom),
              background: fill !== 'transparent' ? fill : undefined,
            }
          : {}),
      };

      return { fill, ink, headerInk, style, color, backdrop };
    }
    const { fill, ink, headerInk, style, color, backdrop } = elementPresentation();
    function renderContent() {
      if (isHtmlEmbed(element)) {
        return renderHtmlRegion();
      }
      if (element.type === 'todo') {
        return renderTodo();
      }
      if (element.type === 'document') {
        return renderDocument();
      }
      if (element.type === 'stroke') {
        return renderStroke();
      }
      if (element.type === 'image') {
        return renderMedia();
      }
      if (element.type === 'table') {
        return renderTable();
      }
      if (element.type === 'link') {
        return renderLink();
      }
      if (element.type === 'sticker' && getBoardSticker(element.data?.stickerIconId)) {
        return renderSticker();
      }
      if (element.type === 'container') {
        return renderSection();
      }

      return renderBasicElement();
    }
    function renderHtmlRegion() {
      const handleHtmlPointerPosition: NonNullable<
        ComponentProps<typeof HtmlRegion>['onPointerPosition']
      > = (point) => {
        const position =
          point &&
          anchorBounds(
            { coordinateSpace: 'element', elementIds: [element.id], x: point.x, y: point.y },
            [element],
          );
        onCursorMove?.(position ? { x: position.x, y: position.y } : null);
      };
      const handleHtmlAnnotation: NonNullable<ComponentProps<typeof HtmlRegion>['onAnnotate']> = (
        selection,
      ) => {
        selectIds([element.id]);
        const point = selection.screenPoint;
        if (point) {
          onAnnotate(selection, { coordinateSpace: 'board', ...boardPoint(point.x, point.y) });
        } else {
          onAnnotate(selection);
        }
      };
      const handleUseSharedHtmlState: NonNullable<
        ComponentProps<typeof HtmlRegion>['onUseSharedState']
      > = () => {
        for (const task of queue.drafts) {
          if (task.state === 'failed' && isEmbeddedStateSave(task, element.id)) {
            queue.discard(task.id);
          }
        }
      };

      return (
        <HtmlRegion
          element={element}
          committedState={committedHtml.get(element.id)}
          zoom={viewport.zoom}
          annotation={annotating}
          interactive={
            reading ? reading.ids.includes(element.id) : inlineSelected && gesture?.kind !== 'move'
          }
          preserveScroll
          initialScroll={
            restoredReadingScroll?.elementId === element.id ? restoredReadingScroll : undefined
          }
          onReadingScroll={
            reading && readingStorageId ? (point) => regionScrolled(element.id, point) : undefined
          }
          panMode={spacePan || (tool === 'pan' && !annotating)}
          onNavigation={(input) => htmlNavigation(element, input)}
          onPointerPosition={handleHtmlPointerPosition}
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
    function renderTodo() {
      const rowFeedback = activities.filter(
        (item) =>
          item.anchor.coordinateSpace === 'todo' &&
          item.anchor.elementIds?.[0] === element.id &&
          item.anchor.pin?.coordinateSpace !== 'board',
      );
      const handleExpandTodo: NonNullable<ComponentProps<typeof TodoRegion>['onExpand']> = () => {
        selectIds([element.id]);
        readSelection().catch(reportCanvasFailure);
      };
      const handleTodoEditingChange: NonNullable<
        ComponentProps<typeof TodoRegion>['onEditingChange']
      > = (active) =>
        setPropertyEditingIds((ids) =>
          active ? [...new Set([...ids, element.id])] : ids.filter((id) => id !== element.id),
        );
      const handleSaveTodo: NonNullable<ComponentProps<typeof TodoRegion>['onSave']> = async (
        operations,
        base,
      ) => {
        const failed = queue.drafts.find(
          (task) => task.state === 'failed' && sameContentOperations(task.operations, operations),
        );
        const saved = failed
          ? (await queue.retry(failed.id))?.board
          : await apply(operations, '编辑任务清单', [base]);

        return saved?.elements.find((item) => item.id === element.id) ?? false;
      };

      return (
        <TodoRegion
          element={element}
          interactive={expanded || inlineSelected}
          expanded={expanded}
          overview={size.w < 228 || size.h < 110}
          uiScale={Math.min(1 / viewport.zoom, 1.8)}
          canEdit={canEdit && !preview && !annotating}
          annotationActive={annotating && canAnnotate && !preview}
          editRequest={
            objectEditRequest?.id === element.id ? objectEditRequest.sequence : undefined
          }
          styleProfile={board.style}
          onMoveStart={(event) => moveRegion(event, element)}
          onExpand={handleExpandTodo}
          onOpenSource={handleOpenTodoSource}
          sourceLabel={(source) =>
            !source.artifactId || source.artifactId === board.artifact.id
              ? board.elements.find((item) => item.id === source.elementId)?.text
              : undefined
          }
          onEditingChange={handleTodoEditingChange}
          onSave={handleSaveTodo}
          onAnnotateItem={(itemId, point) => handleTodoItemAnnotation(element, itemId, point)}
          renderItemAdornment={(itemId) =>
            rowFeedback
              .filter((feedback) => feedback.anchor.itemId === itemId)
              .map((feedback) => {
                const pin =
                  feedback.anchor.pin?.coordinateSpace === 'todo'
                    ? feedback.anchor.pin
                    : { x: 0.97, y: 0.9 };

                return (
                  <CommentPin
                    key={feedback.id}
                    feedback={feedback}
                    left={`${pin.x * 100}%`}
                    top={`${pin.y * 100}%`}
                    zoom={viewport.zoom}
                    onSelect={onFeedbackSelect}
                  />
                );
              })
          }
          renderOutsideRows={(ids) =>
            rowFeedback
              .filter((feedback) => !ids.includes(feedback.anchor.itemId ?? ''))
              .map((feedback) => (
                <CommentPin
                  key={feedback.id}
                  feedback={feedback}
                  left={`max(0px, calc(100% - ${TODO_OVERVIEW_PIN_INSET.right / viewport.zoom}px))`}
                  top={`max(0px, calc(100% - ${TODO_OVERVIEW_PIN_INSET.bottom / viewport.zoom}px))`}
                  zoom={viewport.zoom}
                  onSelect={onFeedbackSelect}
                />
              ))
          }
        />
      );
    }
    function renderDocument() {
      const handleExpandDocument: NonNullable<
        ComponentProps<typeof DocumentRegion>['onExpand']
      > = () => {
        selectIds([element.id]);
        readSelection().catch(reportCanvasFailure);
      };

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
      const handleSaveDocument: NonNullable<
        ComponentProps<typeof DocumentRegion>['onSave']
      > = async (document, title, base, overwrite) => {
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
          throw new Error(
            '此文档还有未确认的白板操作，请先返回画板处理，再比较最新内容后保存正文。',
          );
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
          onExpand={handleExpandDocument}
          onExit={handleExitReading}
          onFocusSurface={(surface) => handleDocumentFocusSurface(element, surface)}
          onActivity={handleDocumentActivity}
          onSave={handleSaveDocument}
          onUseCurrent={handleUseCurrentDocument}
          onAnnotate={handleDocumentAnnotation}
        />
      );
    }
    function renderStroke() {
      return (
        <svg className="studio-stroke-svg" overflow="visible" aria-hidden="true">
          <path
            d={strokePath(element.points)}
            fill="none"
            stroke={lineColor}
            strokeWidth={overviewStrokeWidth(
              Number(element.strokeWidth ?? element.width ?? 3),
              viewport.zoom,
            )}
            strokeDasharray={expanded && element.dash ? '6 5' : dash}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    }
    function renderMedia() {
      const src = assetDisplayUrl(element.src, client);
      const video = assetDisplayUrl(element.video, client);
      const href = safeHttpLink(element.href);
      const mediaState = client.assetState?.(element.video || element.src || '');
      const unavailable = Boolean((element.video && !video) || (!element.video && !src));
      function renderMediaBody() {
        if (video) {
          return (
            <video
              src={video}
              controls={showMediaControls}
              preload="metadata"
              playsInline
              poster={src}
              data-native-interactive={showMediaControls ? 'true' : undefined}
              style={showMediaControls ? undefined : { pointerEvents: 'none' }}
              tabIndex={showMediaControls ? undefined : -1}
            />
          );
        }
        if (src) {
          return (
            <>
              <CroppedImage element={element} src={src} />
              {href && showMediaControls && (
                <a
                  className="studio-image-link"
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="打开图片链接"
                  data-native-interactive="true"
                >
                  <ExternalLink size={16} />
                </a>
              )}
            </>
          );
        }

        return null;
      }

      let message = '无法读取媒体';
      if (mediaState?.status === 'loading') {
        message = '正在加载媒体…';
      } else if (mediaState?.status === 'error') {
        message = mediaState.message || '媒体加载失败。';
      }
      return (
        <>
          {renderMediaBody()}
          {unavailable && (
            <div
              className="studio-media-missing studio-media-state"
              role={mediaState?.status === 'error' ? 'alert' : 'status'}
            >
              {message}
            </div>
          )}
        </>
      );
    }
    function renderTable() {
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
      const handleTableEditingChange: NonNullable<
        ComponentProps<typeof NativeTable>['onEditingChange']
      > = (active) =>
        setPropertyEditingIds((ids) =>
          active ? [...new Set([...ids, element.id])] : ids.filter((id) => id !== element.id),
        );
      const handleSaveTable: NonNullable<ComponentProps<typeof NativeTable>['onSave']> = async (
        changes,
        base,
      ) => {
        const failed = queue.drafts.find(
          (task) =>
            task.state === 'failed' &&
            sameContentOperations(task.operations, [{ op: 'update', id: element.id, changes }]),
        );
        const saved = failed
          ? (await queue.retry(failed.id))?.board
          : await apply([{ op: 'update', id: element.id, changes }], '编辑表格', [base]);

        return saved?.elements.find((item) => item.id === element.id) ?? false;
      };

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
          editRequest={
            objectEditRequest?.id === element.id ? objectEditRequest.sequence : undefined
          }
          canEdit={canEdit && !reading && !annotating && tool === 'select' && !spacePan}
          onRequestLink={(value) => setLinkRequest({ key: newClientId(), value })}
          onFormatStateChange={setFormatState}
          onEditingChange={handleTableEditingChange}
          onSave={handleSaveTable}
        />
      );
    }
    function renderLink() {
      return (
        <div className="studio-link-card" style={{ background: fill }}>
          <Link size={22} />
          {showText && (
            <>
              <div>
                <strong>{element.text || '链接'}</strong>
                <span style={{ color: nativeTextInk(color ?? 'muted', viewStyle, fill, backdrop) }}>
                  {element.href}
                </span>
              </div>
              <a
                href={safeHttpLink(element.href)}
                target="_blank"
                rel="noreferrer"
                aria-label="打开链接"
                data-native-interactive="true"
              >
                <ExternalLink size={17} />
              </a>
            </>
          )}
        </div>
      );
    }
    function renderSticker() {
      return <Sticker id={element.data?.stickerIconId} />;
    }
    function renderSection() {
      if (isEditing || expanded || sectionTitle?.mode === 'full') {
        return (
          <div className="studio-section-title" data-canvas-external-title="">
            {isEditing ? renderTextEditor(element) : <RichText text={element.text} />}
          </div>
        );
      } else if (sectionTitle?.mode === 'overview') {
        const name = parseRichText(element.text ?? '')
          .map((line) => line.segments.map((segment) => segment.text).join(''))
          .join(' ')
          .trim();
        const { fontSize, height, gap } = overviewSectionTitle;
        return (
          <div
            className="studio-section-title is-overview"
            data-canvas-external-title="overview"
            title={name}
            style={{
              fontSize: fontSize / viewport.zoom,
              lineHeight: `${height / viewport.zoom}px`,
              maxWidth: `min(100%, ${sectionTitle.width}px)`,
              bottom: `calc(100% + ${gap / viewport.zoom}px)`,
            }}
          >
            {name}
          </div>
        );
      }
    }
    function renderBasicElement() {
      return (
        <>
          {element.type === 'shape' && (
            <Shape
              element={{
                ...element,
                fill,
                stroke: lineColor,
                dash: !!(element.dash && (expanded || dash)),
              }}
            />
          )}
          {element.type === 'note' && (
            <div className="studio-note-fill" style={{ background: fill }} />
          )}
          {showText || element.type === 'sticker' ? (
            <div
              className={`studio-element-text${element.type === 'sticker' ? ' studio-sticker-text' : ''}`}
              style={{
                padding: element.type === 'text' || element.type === 'sticker' ? 2 : 16,
                ...(element.kind === 'person' ? { top: '39%', paddingTop: 4 } : {}),
              }}
            >
              {isEditing ? renderTextEditor(element) : <RichText text={element.text} />}
            </div>
          ) : (
            element.type === 'text' &&
            !!element.text && (
              <span
                className="studio-text-preview"
                aria-hidden="true"
                style={{ height: Math.min(2 / viewport.zoom, element.h / 3) }}
              />
            )
          )}
        </>
      );
    }
    function showElementTitle() {
      const textIsVisible =
        element.type === 'container' ? expanded || isEditing || Boolean(sectionTitle) : showText;

      return !textIsVisible && Boolean(element.text);
    }

    const content = renderContent();
    const handleElementDoubleClick: NonNullable<ComponentProps<'div'>['onDoubleClick']> = (
      event,
    ) => {
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
    };

    return (
      <div
        key={element.id}
        className={`studio-board-element studio-element-${element.type}${picked ? ' is-selected' : ''}${element.locked ? ' is-locked' : ''}${isEditing ? ' is-editing' : ''}`}
        data-element-id={element.id}
        title={showElementTitle() ? element.text?.slice(0, 160) : undefined}
        style={style}
        onClickCapture={handleAnnotationClickCapture}
        onPointerDown={(event) => begin(event, element)}
        onDoubleClick={handleElementDoubleClick}
      >
        {content}
        {isHtmlEmbed(element) && inlineSelected && htmlMovable && (
          <div
            className="studio-html-move-edge"
            aria-hidden="true"
            style={{ height: Math.min(6 / viewport.zoom, element.h / 4) }}
            onPointerDown={(event) => moveRegion(event, element)}
          />
        )}
        {showHtmlCaption(element, viewport.zoom) && (
          <div
            className="studio-html-caption"
            data-canvas-external-title=""
            style={{
              bottom: `calc(100% + ${8 * captionScale}px)`,
              width: element.w / captionScale,
              transform: `scale(${captionScale})`,
            }}
            onPointerDown={htmlMovable ? (event) => moveRegion(event, element) : undefined}
          >
            <strong title={element.text}>{element.text || 'HTML 图解'}</strong>
          </div>
        )}
      </div>
    );
  };

  function renderTextEditor(element: BoardElement) {
    return (
      <InlineTextEditor
        key={element.id}
        ref={textEditor}
        className="studio-inline-editor"
        value={editing?.text ?? ''}
        disabled={!canEdit}
        style={{ fontWeight: 400, fontStyle: 'normal' }}
        singleLine={['container', 'arrow'].includes(element.type)}
        ariaLabel={element.type === 'arrow' ? '连接线文字' : '编辑文字'}
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

  function describeTextDraft() {
    const editBase = editing?.base ?? board.elements.find((element) => element.id === editing?.id);
    const emptyTextBlocked = Boolean(
      editing &&
      editBase?.type === 'text' &&
      !editing.text.trim() &&
      (contentElements.some((element) => element.id === editing.id && element.locked) ||
        contentElements.some(
          (element) =>
            element.type === 'arrow' &&
            element.locked &&
            (element.from === editing.id || element.to === editing.id),
        )),
    );
    const failedEmptyTextDelete =
      editing && emptyTextDelete?.elementId === editing.id
        ? queueTasks.find(
            (task) => task.id === emptyTextDelete.operationId && task.state === 'failed',
          )
        : undefined;
    const pendingTextDiffers = Boolean(
      editing &&
      queue.tasks.some(
        (task) =>
          task.keys.includes(editing.id) &&
          task.operations.some(
            (operation) =>
              operation.op === 'update' &&
              ((typeof operation.changes?.text === 'string' &&
                operation.changes.text !== editing.text) ||
                (typeof operation.changes?.label === 'string' &&
                  operation.changes.label !== editing.text)),
          ),
      ),
    );
    const textDirty = Boolean(
      editing &&
      (pendingTextDiffers ||
        editing.text !==
          (editing.initialText ??
            (editBase?.type === 'arrow' ? editBase.label : editBase?.text) ??
            '')),
    );

    return { emptyTextBlocked, failedEmptyTextDelete, pendingTextDiffers, textDirty };
  }
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

  function renderTopTools() {
    const handleFitBoard: NonNullable<ComponentProps<'button'>['onClick']> = () => {
      fit('all');
      setZoomMenu(false);
    };
    const handleFitSelection: NonNullable<ComponentProps<'button'>['onClick']> = () => {
      fit('selection');
      setZoomMenu(false);
    };

    return (
      <div
        className="studio-canvas-top-tools"
        hidden={Boolean(reading)}
        data-native-interactive="true"
      >
        {documentControls}
        {documentControls && <span className="studio-tool-divider" />}
        <button
          type="button"
          className="studio-zoom-value"
          aria-label="缩放菜单"
          aria-expanded={zoomMenu}
          title="缩放与视图"
          onClick={() => setZoomMenu((value) => !value)}
        >
          {Math.round(viewport.zoom * 100)}%<ChevronDown size={14} />
        </button>
        {zoomMenu && (
          <div className="studio-zoom-menu" role="menu" aria-label="缩放与视图">
            <div className="studio-zoom-steps">
              <button type="button" aria-label="缩小" onClick={() => stepZoom(1 / 1.2)}>
                <Minus size={16} />
              </button>
              <span>{Math.round(viewport.zoom * 100)}%</span>
              <button type="button" aria-label="放大" onClick={() => stepZoom(1.2)}>
                <Plus size={16} />
              </button>
            </div>
            {[25, 50, 75, 100, 150, 200].map((value) => {
              const handlePresetZoom: NonNullable<ComponentProps<'button'>['onClick']> = () => {
                stepZoom(value / 100 / viewport.zoom);
                setZoomMenu(false);
              };

              return (
                <button type="button" role="menuitem" key={value} onClick={handlePresetZoom}>
                  {value}%
                </button>
              );
            })}
            <button type="button" role="menuitem" onClick={handleFitBoard}>
              <Maximize size={15} />
              适应白板
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!selection.length}
              onClick={handleFitSelection}
            >
              <Maximize size={15} />
              适应选区
            </button>
            <hr />
            <button
              type="button"
              role="menuitem"
              aria-label="撤销"
              disabled={!canEdit || queueSaving || !!unconfirmedHistory || !undo.length}
              onClick={() => changeHistory('undo')}
            >
              <RotateCcw size={15} />
              撤销<span>⌘/Ctrl Z</span>
            </button>
            <button
              type="button"
              role="menuitem"
              aria-label="重做"
              disabled={!canEdit || queueSaving || !!unconfirmedHistory || !redo.length}
              onClick={() => changeHistory('redo')}
            >
              <Redo2 size={15} />
              重做
            </button>
            <details>
              <summary>视图设置</summary>
              <label>
                <input
                  type="checkbox"
                  checked={showGrid}
                  onChange={(event) => setShowGrid(event.target.checked)}
                />
                显示网格
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={singleKeys}
                  onChange={(event) => setSingleKeys(event.target.checked)}
                />
                数字工具快捷键
              </label>
            </details>
          </div>
        )}
      </div>
    );
  }

  const handleViewportClickCapture: NonNullable<ComponentProps<'div'>['onClickCapture']> = (
    event,
  ) => {
    if (documentPlacementClick.current === 'released') {
      documentPlacementClick.current = 'clicked';
    } else if (event.detail === 1) {
      documentPlacementClick.current = null;
    }
    const blocked = navigationClick.current;
    navigationClick.current = false;
    if (blocked && event.detail !== 0) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const handleViewportDoubleClickCapture: NonNullable<
    ComponentProps<'div'>['onDoubleClickCapture']
  > = (event) => {
    if (documentPlacementClick.current === 'clicked') {
      documentPlacementClick.current = null;
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const handleViewportAuxClick: NonNullable<ComponentProps<'div'>['onAuxClick']> = (event) => {
    if (event.button === 1) {
      event.preventDefault();
    }
  };
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

  function renderReadingMarker() {
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
          navigationActive={spacePan || gesture?.kind === 'pan'}
        />
      )
    );
  }

  function renderMediaPlaceholders() {
    return (
      !preview &&
      mediaUpload &&
      mediaUpload.placeholders.map((placeholder, index) => {
        const element = mediaUpload.elements[index] ?? placeholder;
        const handleRetryUpload: NonNullable<ComponentProps<'button'>['onClick']> = () => {
          const batch = mediaUploadRef.current;
          if (batch) {
            runMediaUpload(batch).catch(reportCanvasFailure);
          }
        };
        const handleDiscardUpload: NonNullable<ComponentProps<'button'>['onClick']> = () => {
          const batch = mediaUploadRef.current;
          if (!batch) {
            return;
          }

          batch.abort.abort();
          queue.discardFor(batch.placeholders.map((placeholder) => placeholder.id));
          finishUpload(batch);
          setError('');
        };

        return (
          <div
            key={`upload-${placeholder.id}`}
            data-upload-placeholder={placeholder.id}
            data-upload-phase={mediaUpload.phase}
            style={{
              position: 'absolute',
              left: element.x,
              top: element.y,
              width: element.w,
              height: element.h,
              border: `${1 / viewport.zoom}px dashed var(--studio-accent)`,
              background:
                mediaUpload.phase === 'uploading'
                  ? 'color-mix(in srgb, var(--canvas-ui) 85%, transparent)'
                  : undefined,
              pointerEvents: 'none',
              zIndex: 73,
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 8 / viewport.zoom,
                top: 8 / viewport.zoom,
                transform: `scale(${1 / viewport.zoom})`,
                transformOrigin: 'left top',
                padding: '6px 8px',
                borderRadius: 5,
                background: 'var(--canvas-ui)',
                color: 'var(--canvas-ui-text)',
                font: '12px/1.5 Arial,"Microsoft YaHei",sans-serif',
                maxWidth: 280,
              }}
            >
              {mediaUpload.phase !== 'failed' && (
                <Loader2 size={13} className="studio-spin" aria-hidden="true" />
              )}
              {uploadPhaseLabels[mediaUpload.phase]} · {mediaUpload.files[index]!.name}
              {mediaUpload.phase === 'failed' && index === 0 && (
                <OperationNotice
                  source="媒体上传"
                  message={mediaUpload.error || '媒体尚未加入白板。'}
                  fallbackStyle={{ pointerEvents: 'auto' }}
                  closeLabel="关闭媒体上传通知"
                  actions={
                    <>
                      <button type="button" disabled={!canEdit} onClick={handleRetryUpload}>
                        重试加入白板
                      </button>
                      <button type="button" onClick={handleDiscardUpload}>
                        移除上传草稿
                      </button>
                    </>
                  }
                />
              )}
            </div>
          </div>
        );
      })
    );
  }

  function renderPeerPreviews() {
    return peerPreviewFrames.map(({ peer, bounds }) => {
      const page = presence.find((page) => page.peerId === peer.peerId);
      const color = participantColor(peer.actor, page?.color);
      return (
        <div
          key={`${peer.peerId}:${peer.id}`}
          aria-label={`${peer.actor.name}${peer.kind === 'upload' ? '正在上传' : '正在调整对象'}`}
          style={{
            position: 'absolute',
            left: bounds.x,
            top: bounds.y,
            width: bounds.w,
            height: bounds.h,
            border: `${1 / viewport.zoom}px dashed ${color}`,
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              position: 'absolute',
              bottom: '100%',
              fontSize: 12 / viewport.zoom,
              whiteSpace: 'nowrap',
              color: readableText(color),
              background: color,
            }}
          >
            {peer.actor.name} · {peer.kind === 'upload' ? '正在上传…' : '正在调整'}
          </span>
        </div>
      );
    });
  }

  function renderDocumentPlacement() {
    if (reading || !canEdit || annotating) {
      return null;
    }

    const placingDocument = gesture?.kind === 'create' && gesture.element.type === 'document';
    const showingGhost = tool === 'document' && pointer && !gesture;
    let documentPlacement: BoardElement | null = null;
    if (placingDocument) {
      documentPlacement = gesture.element;
    } else if (showingGhost) {
      documentPlacement = makeElement('document', pointer, { id: 'document-placement-preview' });
    }
    return (
      documentPlacement && (
        <div
          className="studio-document-placement"
          data-document-placement="true"
          aria-hidden="true"
          style={{
            left: documentPlacement.x,
            top: documentPlacement.y,
            width: documentPlacement.w,
            height: documentPlacement.h,
          }}
        >
          <FileText size={18} />
          <span>文档</span>
        </div>
      )
    );
  }

  function renderPlacementGhost() {
    return (
      pointer &&
      !gesture &&
      !editing &&
      !annotating &&
      canEdit &&
      ['text', 'shape', 'note', 'container', 'table', 'sticker', 'todo'].includes(tool) && (
        <div className="studio-placement-ghost" aria-hidden="true">
          {renderElement(
            makeElement(tool as ElementType, pointer, {
              id: 'placement-ghost',
              text: tool === 'text' ? '文字' : '',
              ...(tool === 'shape' ? { kind: shapeKind } : {}),
              ...(tool === 'sticker'
                ? { text: getBoardSticker(sticker)?.label, data: { stickerIconId: sticker } }
                : {}),
            }),
          )}
        </div>
      )
    );
  }

  function renderSelectionChrome() {
    if (!selectionBounds || !selectionChromeVisible()) {
      return null;
    }

    function selectionChromeVisible() {
      if (reading || !selection.length) {
        return false;
      }
      if (selected?.type === 'arrow' && !annotating && !selected.locked) {
        return false;
      }

      const usingSelection = tool === 'select' && !spacePan && gesture?.kind !== 'pan';
      if (!annotating && !usingSelection) {
        return false;
      }

      return !editing || (selected?.id === editing.id && ['text', 'note'].includes(selected.type));
    }

    function resizeEdges(): ComponentProps<typeof SelectionChrome>['edges'] {
      if (selected?.type === 'text') {
        return ['w', 'e'];
      }

      const rotatedGroup =
        selection.length > 1 && selectedElements.some((element) => element.rotation);
      const hasImage = selectedElements.some((element) => element.type === 'image');
      return hasImage || selected?.type === 'sticker' || rotatedGroup ? [] : undefined;
    }

    const selectionElement =
      selected && renderedElements.find((element) => element.id === selected.id);

    return (
      <SelectionChrome
        bounds={
          selectionElement && selectionElement.rotation
            ? {
                x: selectionElement.x,
                y: selectionElement.y,
                w: selectionElement.w,
                h: selectionElement.h,
              }
            : selectionBounds
        }
        rotation={selectionElement?.rotation ?? 0}
        zoom={viewport.zoom}
        outsideResize={
          !!selected &&
          (selected.type === 'document' || selected.type === 'todo' || isHtmlEmbed(selected))
        }
        locked={annotating || !canEdit || selectedElements.some((element) => element.locked)}
        resizable={selectedElements.some((element) => !['arrow', 'link'].includes(element.type))}
        rotatable={selectedElements.every(
          (element) => element.type === 'arrow' || ROTATABLE_TYPES.has(element.type),
        )}
        edges={resizeEdges()}
        onResize={handleResizeStart}
        onRotate={handleRotateStart}
      />
    );
  }

  function renderConnectionPorts() {
    return (
      !reading &&
      selected &&
      canEdit &&
      !annotating &&
      tool === 'select' &&
      !spacePan &&
      !editing &&
      !gesture &&
      canShowConnectionPorts(selected, viewport.zoom) && (
        <ConnectionPorts element={selected} zoom={viewport.zoom} onBegin={handleConnectStart} />
      )
    );
  }

  function renderArrowHandles() {
    if (reading || editing || selected?.type !== 'arrow') {
      return null;
    }
    if (spacePan || annotating || tool !== 'select') {
      return null;
    }
    if (!canEdit || selected.locked) {
      return null;
    }

    const selectedArrow = selected;
    const arrowPoints = arrowGeometry(selectedArrow, arrowElementIndex).points;
    function handleEnd(index: number) {
      if (index === 0) {
        return 'from';
      }

      return index === arrowPoints.length - 1 ? 'to' : 'bends';
    }
    function handleLabel(index: number) {
      const end = handleEnd(index);
      switch (end) {
        case 'from':
          return '连接线起点位置';
        case 'to':
          return '连接线终点位置';
        case 'bends':
          return `连接线折点 ${index}`;
      }
    }
    const startArrowHandle = (
      event: ReactPointerEvent<HTMLButtonElement>,
      arrow: BoardElement,
      index: number,
    ) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      viewportElement.current?.setPointerCapture(event.pointerId);
      updateGesture({
        kind: 'arrow-point',
        start: boardPoint(event.clientX, event.clientY),
        element: arrow,
        end: handleEnd(index),
        bendIndex: index - 1,
        points: arrowPoints,
        operations: [],
      });
    };

    return (
      selectedArrow &&
      arrowPoints.map((point, index) => (
        <button
          type="button"
          key={`arrow-handle-${index}`}
          className="studio-arrow-handle"
          aria-label={handleLabel(index)}
          style={{
            left: point.x,
            top: point.y,
            width: 10 / viewport.zoom,
            height: 10 / viewport.zoom,
            borderWidth: 1.5 / viewport.zoom,
          }}
          onPointerDown={(event) => startArrowHandle(event, selectedArrow, index)}
        />
      ))
    );
  }

  function renderAnnotationHover() {
    const annotationHoverBounds =
      annotationHover &&
      annotationHover.type !== 'arrow' &&
      (annotationHover.type === 'stroke'
        ? geometryBounds(annotationHover, renderedElements)
        : annotationHover);

    return (
      annotationHoverBounds && (
        <div
          className="studio-annotation-hover"
          data-annotation-hover={annotationHover!.id}
          aria-hidden="true"
          style={{
            left: annotationHoverBounds.x,
            top: annotationHoverBounds.y,
            width: annotationHoverBounds.w,
            height: annotationHoverBounds.h,
            borderWidth: 2 / viewport.zoom,
            transform:
              annotationHover!.type !== 'stroke' && annotationHover!.rotation
                ? `rotate(${annotationHover!.rotation}deg)`
                : undefined,
          }}
        />
      )
    );
  }

  function renderCurrentCommentTarget() {
    const commentTarget = annotationTarget ?? localAnnotationTarget;
    const nativeCommentIds =
      commentTarget && !commentTarget.regionId && commentTarget.coordinateSpace !== 'html'
        ? (commentTarget.elementIds ?? [])
        : [];
    const nativeCommentElement =
      nativeCommentIds.length === 1
        ? renderedElements.find(
            (element) =>
              element.id === nativeCommentIds[0] &&
              element.type !== 'arrow' &&
              element.type !== 'stroke',
          )
        : undefined;

    const commentBounds =
      !commentTarget || commentTarget.regionId || commentTarget.coordinateSpace === 'html'
        ? null
        : (nativeCommentElement ??
          (nativeCommentIds.length
            ? nativeSelectionBounds(renderedElements, nativeCommentIds)
            : anchorBounds(commentTarget, renderedElements)));

    return (
      commentBounds && (
        <div
          className="studio-current-comment-target"
          data-comment-target="true"
          aria-hidden="true"
          style={{
            left: commentBounds.x,
            top: commentBounds.y,
            width: Math.max(commentBounds.w, 12 / viewport.zoom),
            height: Math.max(commentBounds.h, 12 / viewport.zoom),
            borderWidth: 2 / viewport.zoom,
            transform: nativeCommentElement?.rotation
              ? `rotate(${nativeCommentElement.rotation}deg)`
              : undefined,
          }}
        />
      )
    );
  }

  function renderSnapGuides() {
    return guides.map((guide, index) => (
      <div
        key={index}
        className="studio-snap-guide"
        style={
          guide.axis === 'x'
            ? {
                left: guide.at,
                top: guide.from,
                height: guide.to - guide.from,
                width: 1 / viewport.zoom,
              }
            : {
                top: guide.at,
                left: guide.from,
                width: guide.to - guide.from,
                height: 1 / viewport.zoom,
              }
        }
      />
    ));
  }

  function renderProcessingFeedback() {
    return activities
      .filter((activity) => activity.status === 'processing')
      .map((activity) => {
        const area = (activity.anchor as typeof activity.anchor & { area?: Rect }).area;
        const frame = area ?? anchorBounds(activity.anchor, renderedElements);
        if (!frame) {
          return null;
        }

        return (
          <div
            key={activity.id}
            className="studio-processing-frame"
            data-feedback-id={activity.id}
            role="status"
            aria-label={`${activity.processingBy?.name || 'Codex'} 正在处理此范围`}
            style={{
              left: frame.x - 8,
              top: frame.y - 8,
              width: frame.w + 16,
              height: frame.h + 16,
              borderWidth: 1.5 / viewport.zoom,
            }}
          >
            <span style={{ transform: `scale(${1 / viewport.zoom})` }}>
              {activity.processingBy?.name || 'Codex'} 正在处理
            </span>
          </div>
        );
      });
  }

  function renderCommentPins() {
    return activities.map((feedback) => {
      const tip = commentBoardTip(feedback.anchor, renderedElements);
      return (
        tip && (
          <CommentPin
            key={feedback.id}
            feedback={feedback}
            left={tip.x}
            top={tip.y}
            zoom={viewport.zoom}
            onSelect={onFeedbackSelect}
          />
        )
      );
    });
  }

  function renderMarquee() {
    return (
      (gesture?.kind === 'marquee' || gesture?.kind === 'annotate') && (
        <div
          className="studio-marquee"
          style={{
            left: Math.min(gesture.start.x, gesture.end.x),
            top: Math.min(gesture.start.y, gesture.end.y),
            width: Math.abs(gesture.end.x - gesture.start.x),
            height: Math.abs(gesture.end.y - gesture.start.y),
            borderWidth: 1 / viewport.zoom,
          }}
        />
      )
    );
  }

  function renderCommentClusters() {
    return (
      onFeedbackSelect &&
      activities.length > 1 && (
        <CommentClusters
          containerRef={viewportElement}
          activities={activities}
          activeFeedbackId={activeFeedbackId}
          onSelect={onFeedbackSelect}
        />
      )
    );
  }

  function renderEmptyCanvas() {
    return (
      !board.elements.length &&
      !gesture && (
        <div className="studio-canvas-empty">
          <div className="studio-empty-symbol">
            <Square size={27} />
            <Circle size={25} />
            <ArrowUpRight size={24} />
          </div>
          <strong>从一个想法开始</strong>
          <p>
            {canEdit
              ? '添加文档、文字、便签或图形，也可以导入 HTML 图解。'
              : '这块白板还没有内容。'}
          </p>
          {canEdit && (
            <>
              <button
                type="button"
                data-native-interactive="true"
                onClick={() => {
                  addDocument().catch(reportCanvasFailure);
                }}
              >
                <FileText size={16} />
                添加文档
              </button>
              <button
                type="button"
                data-native-interactive="true"
                onClick={() => void openHtmlEditor()}
              >
                <Braces size={16} />
                添加 HTML 图解
              </button>
            </>
          )}
        </div>
      )
    );
  }

  function renderToolBar() {
    function activeToolFor(choice: Tool): Tool {
      if (choice === 'stroke') {
        return lastDrawTool;
      }

      return choice === 'shape' ? lastShapeTool : choice;
    }

    function renderToolIcon(choice: Tool, Icon: typeof Square) {
      if (choice === 'stroke' && lastDrawTool === 'arrow') {
        return <ArrowUpRight size={20} />;
      }
      if (choice !== 'shape') {
        return <Icon size={20} />;
      }
      if (lastShapeTool === 'table') {
        return <Table2 size={20} />;
      }

      return (
        <span className="studio-tool-shape-glyph">
          <Shape
            element={makeElement(
              'shape',
              { x: 0, y: 0 },
              { w: 24, h: 20, kind: shapeKind, fill: 'transparent', stroke: viewStyle.ink },
            )}
          />
        </span>
      );
    }
    return (
      <div
        className="studio-canvas-toolbar"
        hidden={Boolean(reading)}
        role="toolbar"
        aria-label="白板工具"
        data-native-interactive="true"
      >
        {TOOL_OPTIONS.map(({ tool: choice, label, key, icon: Icon }) => {
          const representsArrow = choice === 'stroke' && tool === 'arrow';
          const representsTable = choice === 'shape' && tool === 'table';
          const isCurrentTool = choice === tool || representsArrow || representsTable;
          const active = !annotating && isCurrentTool;
          const handleToolClick: NonNullable<ComponentProps<'button'>['onClick']> = () => {
            chooseTool(
              activeToolFor(choice),
              ['shape', 'sticker'].includes(choice) && toolMenu !== choice
                ? (choice as 'shape' | 'sticker')
                : null,
            ).catch(reportCanvasFailure);
          };

          return (
            <button
              type="button"
              key={choice}
              aria-label={label}
              aria-keyshortcuts={key}
              title={`${label}（${key}）`}
              aria-pressed={active}
              className={active ? 'is-active' : ''}
              onClick={handleToolClick}
              disabled={!canEdit && !['select', 'pan'].includes(choice)}
            >
              {renderToolIcon(choice, Icon)}{' '}
              {['shape', 'stroke'].includes(choice) && (
                <ChevronDown size={9} className="studio-tool-caret" />
              )}
            </button>
          );
        })}
      </div>
    );
  }

  function renderInsertMenu() {
    const handleAddLink: NonNullable<ComponentProps<'button'>['onClick']> = () => {
      setDialog({ type: 'link' });
      setToolMenu(null);
    };
    const handleAddHtml: NonNullable<ComponentProps<'button'>['onClick']> = () => {
      openHtmlEditor().catch(reportCanvasFailure);
      setToolMenu(null);
    };

    return (
      toolMenu === 'shape' &&
      canEdit && (
        <div className="studio-shape-options studio-insert-menu" data-native-interactive="true">
          <div className="studio-shape-grid">
            {SHAPES.map(([kind, label]) => {
              const handlePickShape: NonNullable<ComponentProps<'button'>['onClick']> = () => {
                setShapeKind(kind);
                chooseTool('shape', 'shape').catch(reportCanvasFailure);
              };

              return (
                <button
                  type="button"
                  key={kind}
                  aria-label={`形状 ${label}`}
                  title={label}
                  aria-pressed={shapeKind === kind && tool === 'shape'}
                  onClick={handlePickShape}
                >
                  <Shape
                    element={makeElement(
                      'shape',
                      { x: 0, y: 0 },
                      { w: 64, h: 48, kind, fill: 'transparent', stroke: viewStyle.ink },
                    )}
                  />
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => {
              chooseTool('table').catch(reportCanvasFailure);
            }}
          >
            <Table2 size={17} />
            表格
          </button>
          <button type="button" onClick={handleAddLink}>
            <Link size={17} />
            链接
          </button>
          <button type="button" onClick={handleAddHtml}>
            <Braces size={17} />
            HTML 图解
          </button>
          <button
            type="button"
            aria-label="添加文档区域"
            onClick={() => {
              addDocument().catch(reportCanvasFailure);
            }}
          >
            <FileText size={17} />
            文档区域
          </button>
          <button
            type="button"
            aria-label="添加任务清单"
            onClick={() => {
              chooseTool('todo').catch(reportCanvasFailure);
            }}
          >
            <ListTodo size={17} />
            任务清单
          </button>
        </div>
      )
    );
  }

  function renderPenTools() {
    return (
      !annotating &&
      (tool === 'stroke' || tool === 'arrow') &&
      canEdit && (
        <div
          className="studio-shape-options studio-pen-menu"
          role="toolbar"
          aria-label="绘图选项"
          data-native-interactive="true"
        >
          <div className="studio-pen-choices">
            <button
              type="button"
              aria-label="画笔模式"
              title="画笔（6）"
              aria-pressed={tool === 'stroke'}
              onClick={() => {
                chooseTool('stroke').catch(reportCanvasFailure);
              }}
            >
              <PenLine size={18} />
            </button>
            <button
              type="button"
              aria-label="箭头模式"
              title="箭头"
              aria-pressed={tool === 'arrow'}
              onClick={() => {
                chooseTool('arrow').catch(reportCanvasFailure);
              }}
            >
              <ArrowUpRight size={18} />
            </button>
          </div>
          <span className="studio-tool-divider" />
          <ColorPalette presetOnly theme={viewTheme} value={penColor} onChange={setPenColor} />
        </div>
      )
    );
  }

  function renderStickerMenu() {
    const handleSelectSticker: NonNullable<ComponentProps<typeof StickerPalette>['onSelect']> = (
      choice,
    ) => {
      setSticker(choice.id);
      chooseTool('sticker').catch(reportCanvasFailure);
    };
    const handleUploadSticker: NonNullable<
      ComponentProps<typeof StickerPalette>['onUpload']
    > = () => {
      fileInput.current?.click();
      setToolMenu(null);
    };

    return (
      toolMenu === 'sticker' &&
      canEdit && (
        <StickerPalette
          selectedId={sticker}
          onSelect={handleSelectSticker}
          onUpload={handleUploadSticker}
        />
      )
    );
  }

  function renderFormatToolbar() {
    function activeInlineFormatting() {
      const editingTable = selected?.type === 'table' && propertyEditingIds.includes(selected.id);
      return editing || editingTable ? formatState : undefined;
    }

    const handleFormatEditText: NonNullable<
      ComponentProps<typeof CanvasFormatToolbar>['onEditText']
    > = () => {
      if (selected) {
        beginEditing(selected);
      }
    };

    return (
      !reading &&
      !zoomMenu &&
      selectedElements.length > 0 &&
      selectionBounds &&
      !annotating &&
      tool === 'select' &&
      !spacePan &&
      gesture?.kind !== 'pan' && (
        <CanvasFormatToolbar
          key={selection.join(',')}
          elements={selectedElements}
          selectionBounds={selectionBounds}
          viewport={viewport}
          titles={titleCandidates}
          editingTitle={editing?.id}
          formatState={activeInlineFormatting()}
          requestLink={linkRequest}
          customColors={customColors}
          onCustomColorsChange={handleCustomColorsChange}
          theme={viewTheme}
          canEdit={canEdit}
          canAnnotate={canAnnotate}
          saving={queue.tasks.some(
            (task) => task.state !== 'failed' && task.keys.some((id) => selection.includes(id)),
          )}
          onChange={(changes, colors) => {
            updateSelected(changes, '调整元素', colors).catch(reportCanvasFailure);
          }}
          onEditText={handleFormatEditText}
          onTextFormat={handleTextFormat}
          onAnnotate={() => {
            handleAnnotateSelection().catch(reportCanvasFailure);
          }}
          onReadSelection={() => {
            readSelection().catch(reportCanvasFailure);
          }}
          onEditHtml={
            selected && isHtmlEmbed(selected)
              ? () => {
                  openHtmlEditor(selected).catch(reportCanvasFailure);
                }
              : undefined
          }
          onCrop={
            selected?.type === 'image' && selected.src && !selected.video
              ? () => setCropDialog(selected)
              : undefined
          }
          onAlign={(edge) => {
            apply(
              alignSelection(boardRef.current.elements, selectionRef.current, edge),
              '对齐元素',
            ).catch(reportCanvasFailure);
          }}
          onMore={(point) => {
            handleOpenActionsMenu(point).catch(reportCanvasFailure);
          }}
        />
      )
    );
  }

  function renderActionsMenu() {
    const usingSelectionTool = !annotating && tool === 'select';
    const canRenameSection = selected?.type === 'container' && canEdit && usingSelectionTool;
    return (
      menu && (
        <CanvasActionsMenu
          point={menu}
          canEdit={canEdit}
          selected={selection.length}
          locked={selectedElements.some((element) => element.locked)}
          hasClipboard={Boolean(navigator.clipboard?.readText)}
          onCommand={(command) => {
            handleCanvasCommand(command).catch(reportCanvasFailure);
          }}
          onRenameSection={canRenameSection ? editSelected : undefined}
          onClose={() => setMenu(null)}
        />
      )
    );
  }

  function renderSaveNotices() {
    return (
      <div
        aria-label="草稿与保存提示"
        style={{
          position: 'absolute',
          bottom: 87,
          left: 18,
          maxWidth: 'min(620px, calc(100% - 36px))',
          maxHeight: '45%',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          zIndex: 60,
        }}
      >
        {(toolNotice || previewStatus) && (
          <div
            role="status"
            style={{
              padding: '8px 12px',
              border: '1px solid var(--canvas-ui-border)',
              borderRadius: 7,
              background: 'var(--canvas-ui)',
              color: 'var(--canvas-ui-text)',
            }}
          >
            {toolNotice || previewStatus}
          </div>
        )}
        {previewError && (
          <OperationNotice
            source="画布预览"
            message={previewError}
            fallbackClass="studio-canvas-error"
            fallbackStyle={inlineCanvasNotice}
          />
        )}
        {historyError && (
          <OperationNotice
            source="撤销与重做"
            message={historyError}
            closeLabel="关闭撤销或重做提示"
            onClose={() => setHistoryError('')}
            fallbackClass="studio-canvas-error"
            fallbackStyle={inlineCanvasNotice}
          />
        )}
        {unconfirmedHistory && (
          <OperationNotice
            key={unconfirmedHistory.id}
            source="撤销与重做"
            message={`「${unconfirmedHistory.summary}」的结果待确认。`}
            fallbackClass="studio-canvas-error"
            fallbackStyle={inlineCanvasNotice}
            actions={
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => void queue.retry(unconfirmedHistory.id)}
              >
                重试确认原结果
              </button>
            }
          />
        )}
        {error && (
          <OperationNotice
            source="画布操作"
            message={error}
            closeLabel="关闭错误提示"
            onClose={() => setError('')}
            fallbackClass="studio-canvas-error"
            fallbackStyle={inlineCanvasNotice}
            actions={
              emptyTextBlocked ? (
                <button type="button" aria-label="取消本次文字编辑" onClick={handleCancelEmptyText}>
                  取消本次文字编辑
                </button>
              ) : undefined
            }
          />
        )}
        {renderFailedDraftNotices()}
        {renderRecoveredDraftNotice()}
        {renderRemovedTextNotice()}
        {!preview && (
          <DetachedTableDrafts
            drafts={tableDrafts}
            elements={board.elements}
            onInspect={handleInspectDetachedDraft}
          />
        )}
      </div>
    );
  }

  function renderFailedDraftNotices() {
    return failedDraftNotices.map((task) => {
      const sourceChanged = embeddedSaveSourceChanged(task, board.elements);
      const handleCompareTask: NonNullable<ComponentProps<'button'>['onClick']> = () => {
        setComparisonBoard(boardRef.current);
        setComparison(task.id);
      };

      return (
        <OperationNotice
          key={task.id}
          source={`画布 · ${task.summary}`}
          message={
            sourceChanged
              ? 'HTML 源码已有变化，旧的交互草稿仍可查看。'
              : errorText(task.failure ?? task.error ?? '有尚未保存的草稿，请比较内容或重试。')
          }
          closeLabel="关闭画布保存通知"
          fallbackClass="studio-canvas-error"
          fallbackStyle={inlineCanvasNotice}
          actions={
            <>
              {failedEmptyTextDelete?.id === task.id && (
                <button type="button" aria-label="取消本次文字编辑" onClick={handleCancelEmptyText}>
                  取消本次文字编辑
                </button>
              )}
              <button type="button" onClick={handleCompareTask}>
                比较双方内容
              </button>
              {!sourceChanged && (
                <button type="button" disabled={!canEdit} onClick={() => void queue.retry(task.id)}>
                  重试原操作
                </button>
              )}
            </>
          }
        />
      );
    });
  }

  function renderRecoveredDraftNotice() {
    const retainedDrafts = draftRecovery.retainedDrafts ?? [];
    const visibleDraft = recovered || unreadableDraft !== undefined;
    if (preview || (!visibleDraft && !retainedDrafts.length)) {
      return null;
    }

    return (
      <div className="studio-canvas-error" style={inlineCanvasNotice} role="status">
        {visibleDraft && renderVisibleDraftRecovery()}
        {renderRetainedDrafts(retainedDrafts)}
      </div>
    );
  }

  function renderVisibleDraftRecovery() {
    const copiedDraft = unreadableDraft ?? JSON.stringify(recovered, null, 2);
    const handleRecoverLocalDraft = () => {
      if (!recovered) {
        return;
      }

      setEditing(recovered.text ?? null);
      setPropertyDrafts(recovered.properties ?? {});
      setTableDrafts(recovered.tables ?? {});
      queue.restore(recovered.tasks ?? []);
      setDraftGeneration((value) => value + 1);
      clearDraftRecovery({ ...draftRecovery, draft: null, error: '', discardEmpty: false });
    };
    const handleDiscardLocalDraft = () => {
      const next = {
        ...draftRecovery,
        draft: null,
        unreadableDraft: undefined,
        error: '',
        discardEmpty: false,
      };

      try {
        storeCanvasDraft(draftStorageKey, activeDraft, next);
        hadLocalDraft.current = Boolean(activeDraft);
        clearDraftRecovery(next);
      } catch (failure) {
        reportCanvasFailure(failure);
      }
    };

    return (
      <>
        <span>
          {unreadableDraft === undefined
            ? '此白板有上次未保存的本机草稿。'
            : '此白板有无法读取的本机草稿，原始内容仍可复制或下载。'}
        </span>
        {recovered && (
          <button type="button" onClick={handleRecoverLocalDraft} disabled={activeDraft !== null}>
            恢复上次草稿
          </button>
        )}
        <button
          type="button"
          onClick={() => void copyPlainText(copiedDraft).catch(reportCanvasFailure)}
        >
          复制草稿
        </button>
        <button
          type="button"
          onClick={() =>
            void downloadStudioBlob(
              client,
              new Blob([copiedDraft], { type: 'application/json' }),
              'whiteboard-draft.json',
            ).catch(reportCanvasFailure)
          }
        >
          下载草稿副本
        </button>
        <button type="button" onClick={handleDiscardLocalDraft}>
          放弃上次草稿
        </button>
      </>
    );
  }

  function renderRetainedDrafts(retained: string[]) {
    if (!retained.length) {
      return null;
    }

    const currentRecovery = recovered || unreadableDraft !== undefined;
    const canViewPrevious = !currentRecovery && !activeDraft;
    const serializedDrafts = JSON.stringify(retained, null, 2);

    return (
      <>
        <span>较早的本机草稿已保留。</span>
        {canViewPrevious && (
          <button
            type="button"
            onClick={() => clearDraftRecovery(promoteCanvasDraft(draftRecovery, board.artifact.id))}
          >
            查看较早草稿
          </button>
        )}
        <button
          type="button"
          onClick={() => void copyPlainText(serializedDrafts).catch(reportCanvasFailure)}
        >
          复制较早草稿
        </button>
      </>
    );
  }

  function renderRemovedTextNotice() {
    if (preview || !editing?.base) {
      return null;
    }

    const handleInspectRemovedText: NonNullable<ComponentProps<'button'>['onClick']> = () =>
      handleInspectDetachedDraft(editing.base!, {
        [editing.base!.type === 'arrow' ? 'label' : 'text']: editing.text,
      });

    return (
      !preview &&
      editing?.base &&
      !board.elements.some(
        (element) => element.id === editing.id && element.type === editing.base?.type,
      ) && (
        <OperationNotice
          key={editing.id}
          source="文字草稿"
          message="正在编辑的对象已被删除，文字草稿仍可恢复。"
          fallbackClass="studio-canvas-error"
          fallbackStyle={inlineCanvasNotice}
          actions={
            <button type="button" onClick={handleInspectRemovedText}>
              查看并恢复文字草稿
            </button>
          }
        />
      )
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

  function renderMediaInput() {
    const handleSelectMediaFiles: NonNullable<ComponentProps<'input'>['onChange']> = (event) => {
      uploadMedia(event.target.files).catch(reportCanvasFailure);
      event.currentTarget.value = '';
    };

    return (
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,video/mp4,video/webm,video/quicktime"
        multiple
        hidden
        onChange={handleSelectMediaFiles}
      />
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

  const handleCanvasCopy: NonNullable<ComponentProps<'div'>['onCopy']> = (event) => {
    if (
      (event.target as HTMLElement).closest(
        'input,textarea,[contenteditable="true"],[data-document-content]',
      ) ||
      !selectionRef.current.length
    ) {
      return;
    }

    const ids = expandMoveIds(boardRef.current.elements, selectionRef.current);
    const elements = structuredClone(
      boardRef.current.elements.filter((element) => ids.includes(element.id)),
    );
    clipboard.current = elements;
    event.clipboardData.setData('application/x-agentero-studio', JSON.stringify(elements));
    event.clipboardData.setData(
      'text/plain',
      elements
        .map((element) => element.text ?? element.label ?? '')
        .filter(Boolean)
        .join('\n'),
    );
    event.preventDefault();
  };
  const handleCanvasPaste: NonNullable<ComponentProps<'div'>['onPaste']> = (event) => {
    if (
      reading ||
      !canEdit ||
      (event.target as HTMLElement).closest(
        'input,textarea,[contenteditable="true"],[data-document-content]',
      )
    ) {
      return;
    }

    if (event.clipboardData.files.length) {
      event.preventDefault();
      uploadMedia(event.clipboardData.files).catch(reportCanvasFailure);
      return;
    }
    const plainPayload = event.clipboardData.getData('text/plain');
    const encoded =
      event.clipboardData.getData('application/x-agentero-studio') ||
      (plainPayload.startsWith(CLIPBOARD_PREFIX)
        ? plainPayload.slice(CLIPBOARD_PREFIX.length)
        : '');

    if (encoded && encoded.length < 8 * 1024 * 1024) {
      try {
        const elements: unknown = JSON.parse(encoded);
        if (
          Array.isArray(elements) &&
          elements.length <= 200 &&
          elements.every(
            (element) =>
              element &&
              typeof element.id === 'string' &&
              typeof element.type === 'string' &&
              [
                'shape',
                'container',
                'text',
                'stroke',
                'arrow',
                'image',
                'html',
                'document',
                'table',
                'link',
                'note',
                'sticker',
              ].includes(element.type),
          )
        ) {
          event.preventDefault();
          addElements(
            duplicateElements(
              elements,
              elements.map((element) => element.id),
            ),
            '粘贴元素',
          ).catch(reportCanvasFailure);

          return;
        }
      } catch (failure) {
        if (!(failure instanceof SyntaxError)) {
          reportCanvasFailure(failure);
        }
      }
    }
    const text = event.clipboardData.getData('text/plain');
    if (text.trim() && text.length <= 20000) {
      event.preventDefault();
      addElements(
        [
          makeElement('text', centerPoint(), {
            text,
            w: 380,
            h: Math.max(70, Math.min(600, text.split('\n').length * 30)),
          }),
        ],
        '粘贴文字',
      ).catch(reportCanvasFailure);
    }
  };

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
      onCopy={handleCanvasCopy}
      onPaste={handleCanvasPaste}
    >
      {renderReadingControls()}
      {renderTopTools()}
      <div
        ref={bindViewport}
        className="studio-canvas-viewport"
        tabIndex={canvasViewportTabIndex(readingDocument)}
        aria-label="白板画布"
        onPointerDownCapture={handleNavigationCapture}
        onClickCapture={handleViewportClickCapture}
        onDoubleClickCapture={handleViewportDoubleClickCapture}
        onAuxClick={handleViewportAuxClick}
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
        {renderReadingMarker()}
        <div
          className="studio-canvas-world"
          style={{
            transform: `translate(${viewport.x}px,${viewport.y}px) scale(${viewport.zoom})`,
          }}
        >
          {renderedElements.map(renderElement)}
          {renderMediaPlaceholders()}
          {renderPeerPreviews()}
          {renderDocumentPlacement()}
          {renderPlacementGhost()}
          {renderSelectionChrome()}
          {renderConnectionPorts()}
          {renderArrowHandles()}
          {renderAnnotationHover()}
          {renderCurrentCommentTarget()}
          {renderSnapGuides()}
          {renderProcessingFeedback()}
          {renderCommentPins()}
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
          {renderMarquee()}
        </div>
        {renderCommentClusters()}
        {renderEmptyCanvas()}
      </div>
      {renderToolBar()}
      {renderInsertMenu()}
      {renderPenTools()}
      {renderStickerMenu()}
      {renderFormatToolbar()}
      {renderActionsMenu()}
      {renderSaveNotices()}
      {renderConflictDialog()}
      {renderMediaInput()}
      {renderHtmlInput()}
      {renderCropDialog()}
      {renderElementDialog()}
    </div>
  );
}

function DetachedTableDrafts({
  drafts,
  elements,
  onInspect,
}: {
  drafts: Record<string, NativeTableDraft>;
  elements: readonly BoardElement[];
  onInspect: (base: BoardElement, changes: Partial<BoardElement>) => void;
}) {
  return Object.entries(drafts).map(([id, draft]) => {
    if (elements.some((element) => element.id === id && element.type === 'table')) {
      return null;
    }

    return (
      <OperationNotice
        key={id}
        source="表格草稿"
        message="正在编辑的表格已被删除，草稿仍可恢复。"
        fallbackClass="studio-canvas-error"
        fallbackStyle={inlineCanvasNotice}
        actions={
          <button type="button" onClick={() => onInspect(draft.base, draft.changes)}>
            查看并恢复表格草稿
          </button>
        }
      />
    );
  });
}
