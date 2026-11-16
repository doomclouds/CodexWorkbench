import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowUpRight, FileText, Braces, ChevronDown, Circle, Copy, ExternalLink, Frame, Group, Hand, Link, Loader2, Lock, Maximize, MessageSquare, Minus, MousePointer2, PenLine, Plus, Redo2, RotateCcw, Smile, Square, StickyNote, Table2, Trash2, Type, Ungroup, Unlock, X } from 'lucide-react';
import type { Actor, AgentTaskReleaseTarget, Anchor, Board, BoardElement, CollaborationRoom, ElementType, Feedback, HtmlSelection, Json, Operation, Presence, StudioClient } from '../../contracts/studio.js';
import { contrastRatio, readableText, semanticColor } from '../../core/theme.js';
import HtmlRegion from '../shared/html-region/HtmlRegion.js';
import type { HtmlNavigationEvent } from '../shared/html-region/runtime.js';
import { anchorBounds, arrowGeometry, arrowHeads, assetDisplayUrl, boundsOf, canvasStyle, clamp, duplicateElements, elementBounds, expandMoveIds, fitViewport, intersects, makeElement, moveOperations, newId, normalizedRect, relativeElementPoint, safeHttpLink, tableRows, wheelZoomFactor, zoomAt, type Point, type Rect, type Viewport } from './canvas-model.js';
import { shapePath, strokePath } from '../../core/products/whiteboard-geometry.js';
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
import CanvasActionsMenu, { type CanvasCommand } from './CanvasActionsMenu.js';
import ColorPalette from './ColorPalette.js';
import NativeTable from './NativeTable.js';
import DocumentRegion, { type DocumentActivity, type DocumentFocusSurface } from './DocumentRegion.js';
import { defaultDocument, documentOperations } from '../../contracts/document.js';
import SelectionChrome from './SelectionChrome.js';
import ConnectionPorts from './ConnectionPorts.js';
import { adjacentElement, canShowConnectionPorts, connectionAtPoint, connectionPoint, OPPOSITE_SIDE, ROTATABLE_TYPES, type ConnectionSide } from './selection-affordances.js';
import InlineTextEditor, { type InlineTextEditorHandle, type InlineTextFormatState } from './InlineTextEditor.js';
import { newClientId } from '../shared/client-id.js';
import { nativePaint, PEN_CURSOR } from './native-palette.js';
import { alignSelection, geometryBounds, selectionBounds as nativeSelectionBounds, resizeBox, resizeElement, resizeSelection, rotateSelection, snapMove, type ResizeHandle, type AlignmentGuide } from './native-geometry.js';
import { visibleCommentCorner } from '../shared/comments/comment-target.js';
import { copyPlainText } from '../clipboard.js';
import { studioRequest } from '../transport.js';
import { participantColor } from '../shared/presence-members.js';
import PeerPresenceOverlay from './PeerPresenceOverlay.js';
import { NativeContentQueue, overlayContent, type ContentTask, type ContentReceipt } from './content-queue.js';
import { downloadStudioBlob } from '../transport.js';
import type { NativeTableDraft } from './NativeTable.js';
import ContentConflictDialog from './ContentConflictDialog.js';
import SelectionLayoutDialog from './SelectionLayoutDialog.js';
import { encodeGestureFrame, useNativeGestureSync, type NativeGesture } from '../shared/useNativeGestureSync.js';
import { mergeJson } from '../../core/shared/safe-merge.js';
import './canvas.css';
import { isEscapeActive, registerEscapeLayer } from '../shared/escape.js';

export interface WhiteboardCanvasProps {
  board: Board;
  client: StudioClient;
  actor: Actor;
  onChanged: (board: Board) => void;
  onAnnotate: (selection: HtmlSelection) => void;
  readOnly?: boolean;
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
  onActivityChange?: (state: { editingIds: string[]; movingIds: string[]; savingIds?: string[]; dirty: boolean; saving?: boolean; saveError?: string; issues?: NativeIssue[] }) => void;
  activities?: Feedback[];
  annotationActive?: boolean;
  annotationTarget?: Anchor;
  onAnnotationModeChange?: (active: boolean) => void;
  onAnnotateNative?: (selection: NativeAnnotation) => void;
  onFeedbackSelect?: (feedback: Feedback, screenPoint: Point) => void;
  onReadingChange?: (active: boolean) => void;
  onEditHtml?: (element?: BoardElement) => void;
  documentControls?: ReactNode;
  preview?: boolean;
  contentQueue?: NativeContentQueue;
  clockOffsetMs?: number;
  insertedElementId?: string;
}

export interface NativeAnnotation { anchor: Anchor; label: string; versions: Record<string, number>; screenPoint?: Point }

type Tool = 'select' | 'pan' | 'annotate' | 'shape' | 'note' | 'text' | 'container' | 'stroke' | 'arrow' | 'sticker' | 'table';
type Gesture = { operationId?: string; baseRevision?: number } & (
  | { kind: 'pan'; start: Point; viewport: Viewport; pointerId?: number; frame?: { regionId: string; pointerId: number } }
  | { kind: 'marquee'; start: Point; end: Point; additive: boolean }
  | { kind: 'annotate'; start: Point; end: Point; element?: BoardElement }
  | { kind: 'move'; start: Point; screenStart: Point; current: Point; ids: string[]; elements: BoardElement[]; copies?: BoardElement[]; dragging?: boolean }
  | { kind: 'resize'; start: Point; elements: BoardElement[]; ids: string[]; box: Rect; handle: ResizeHandle; operations: Operation[] }
  | { kind: 'rotate'; start: Point; elements: BoardElement[]; ids: string[]; box: Rect; operations: Operation[] }
  | { kind: 'arrow-point'; start: Point; element: BoardElement; end: 'from'|'to'|'bends'; bendIndex?:number; points?:Point[]; operations: Operation[] }
  | { kind: 'draw'; start: Point; points: Point[]; element: BoardElement; from?: string; straightStart?:Point; straightPoints?:Point[] }
  | { kind: 'connect'; start: Point; current: Point; element: BoardElement; side: ConnectionSide }
  | { kind: 'create'; start: Point; element: BoardElement });
interface Dialog { type: 'html' | 'table' | 'link' | 'sticker'; element?: BoardElement }
interface ChangeRecord { before: BoardElement[]; after: BoardElement[]; ids: string[]; summary: string; historyId?: string; snapshot?: boolean; fields?: Record<string, string[]> }
interface MediaUploadBatch { id: string; scope: string; artifactId: string; baseRevision: number; intent: number; files: File[]; position: Point; placeholders: BoardElement[]; elements: BoardElement[]; phase: 'uploading' | 'queued' | 'failed'; referenceQueued: boolean; error?: string; frame: number; sequence: number; abort: AbortController }

const SHAPES = [['rounded', '圆角矩形'], ['rect', '矩形'], ['ellipse', '椭圆'], ['diamond', '菱形'], ['pill', '胶囊'], ['hexagon', '六边形'], ['parallelogram', '平行四边形'], ['database', '数据库'], ['queue', '队列'], ['document', '文档'], ['cloud', '云'], ['person', '人物']] as const;
const CLIPBOARD_PREFIX = 'AGENTERO_STUDIO_ELEMENTS_V1\n';
const TOOL_OPTIONS: { tool: Tool; label: string; key: string; icon: typeof Square }[] = [
  { tool: 'select', label: '选择', key: '1', icon: MousePointer2 }, { tool: 'pan', label: '平移', key: '2', icon: Hand },
  { tool: 'text', label: '文字', key: '3', icon: Type }, { tool: 'container', label: '分区', key: '4', icon: Frame },
  { tool: 'note', label: '便签', key: '5', icon: StickyNote }, { tool: 'stroke', label: '画笔', key: '6', icon: PenLine },
  { tool: 'shape', label: '形状', key: '7', icon: Square }, { tool: 'sticker', label: '贴纸', key: '8', icon: Smile },
];

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : String(error);
  return /CONFLICT|已被修改|版本/i.test(message) ? '对象已被其他人修改，本次更改未覆盖他人的内容。请比较双方内容后选择，或保留草稿。' : message;
}


function Shape({ element }: { element: BoardElement }) {
  const { w, h, kind = 'rounded' } = element;
  const common = { fill: element.hollow ? 'none' : element.fill ?? '#ffffff', stroke: element.stroke ?? '#4f5d75', strokeWidth: Number(element.strokeWidth ?? element.width ?? 1.4), strokeDasharray: element.dash ? '6 5' : undefined, vectorEffect: 'non-scaling-stroke' as const };
  const path = shapePath(element);
  if (!SHAPES.some(([value]) => value === kind)) return <div className="studio-media-missing">不支持的形状：{kind}</div>;
  return <svg className="studio-shape-svg" viewBox={`-2 -2 ${w + 4} ${h + 4}`} preserveAspectRatio="none" aria-hidden="true">
    {kind === 'ellipse' ? <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} {...common} /> : path ? <path d={path} {...common} /> : <rect width={w} height={h} rx={kind === 'pill' ? h / 2 : kind === 'rect' || kind === 'queue' ? 0 : 7} {...common} />}
    {kind === 'queue' && <path d={`M 14 0 V ${h} M ${w - 14} 0 V ${h}`} {...common} fill="none" />}
  </svg>;
}

function drawnElement(gesture: Extract<Gesture, { kind: 'draw' }>, points = gesture.points): BoardElement {
  const end = points.at(-1) ?? gesture.start;
  let x = points[0]?.x ?? gesture.start.x, y = points[0]?.y ?? gesture.start.y, right = x, bottom = y;
  for (const point of points) { x=Math.min(x,point.x); y=Math.min(y,point.y); right=Math.max(right,point.x); bottom=Math.max(bottom,point.y); }
  const box = { x, y, w:right-x, h:bottom-y };
  return gesture.element.type === 'arrow'
    ? { ...gesture.element, ...box, to: [end.x, end.y], w: Math.max(1, box.w), h: Math.max(1, box.h) }
    : { ...gesture.element, ...box, w: Math.max(1,box.w), h: Math.max(1,box.h), points: points.flatMap(point => [point.x - box.x, point.y - box.y]) };
}

export default function WhiteboardCanvas({ board, client, actor, onChanged, onAnnotate, readOnly, onSelectionChange, onViewportChange, presence = [], selfPeerId, onCursorMove, externalViewport, externalSelectedIds, onActivityChange, activities = [], annotationActive, annotationTarget, onAnnotationModeChange, onAnnotateNative, onFeedbackSelect, onReadingChange, onEditHtml, documentControls, preview, contentQueue, room, onViewportInteract, onReleaseAgentTask, clockOffsetMs, insertedElementId }: WhiteboardCanvasProps) {
  const viewportElement = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const htmlInput = useRef<HTMLInputElement>(null);
  const boardRef = useRef(board);
  if (board.artifact.id !== boardRef.current.artifact.id || board.artifact.revision >= boardRef.current.artifact.revision) boardRef.current = board;
  const onChangedRef = useRef(onChanged); onChangedRef.current = onChanged;
  const selectionCallback = useRef(onSelectionChange); selectionCallback.current = onSelectionChange;
  const viewportCallback = useRef(onViewportChange); viewportCallback.current = onViewportChange;
  const [viewport, setViewport] = useState<Viewport>({ x: 100, y: 80, zoom: 1 });
  const viewportRef = useRef(viewport); viewportRef.current = viewport;
  const externalViewportRef = useRef(externalViewport); externalViewportRef.current = externalViewport;
  const [tool, setTool] = useState<Tool>('select');
  const [shapeKind, setShapeKind] = useState('rounded');
  const [lastShapeTool,setLastShapeTool]=useState<'shape'|'table'>('shape');
  const [lastDrawTool,setLastDrawTool]=useState<'stroke'|'arrow'>('stroke');
  const [selection, setSelection] = useState<string[]>([]);
  const [annotationHoverId, setAnnotationHoverId] = useState<string | null>(null);
  const selectionRef = useRef(selection); selectionRef.current = selection;
  const interactionIntent = useRef(0);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [queueSaving, setQueueSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [documentActivities, setDocumentActivities] = useState<Record<string, DocumentActivity>>({});
  const [documentEditRequest, setDocumentEditRequest] = useState<{ id: string; sequence: number }>();
  const documentFocusSurface = useRef<DocumentFocusSurface | null>(null);
  const documentDirty = Object.values(documentActivities).some(state => state.dirty);
  const saving = queueSaving || uploading || Object.values(documentActivities).some(state => state.saving);
  const [mediaUpload, setMediaUpload] = useState<MediaUploadBatch | null>(null);
  const mediaUploadRef = useRef<MediaUploadBatch | null>(null), uploadBusyRef = useRef(false), uploadAlive = useRef(true);
  const [uploadError, setUploadError] = useState('');
  const [error, setError] = useState('');
  const [toolNotice, setToolNotice] = useState('');
  const [queueSaveError, setQueueSaveError] = useState('');
  const saveError = uploadError || queueSaveError || Object.values(documentActivities).find(state => state.error)?.error || '';
  const [editing, setEditing] = useState<{ id: string; text: string; base?: BoardElement; initialText?:string } | null>(null);
  const newTextIds = useRef(new Set<string>());
  const emptyTextDelete = useRef<{ elementId: string; operationId: string } | undefined>(undefined);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [layoutMode, setLayoutMode] = useState<'geometry' | 'flow' | null>(null);
  const [cropDialog, setCropDialog] = useState<BoardElement | null>(null);
  const [dialogDirty, setDialogDirty] = useState(false);
  const [propertyDrafts, setPropertyDrafts] = useState<Record<string, { base: BoardElement; changes: Partial<BoardElement> }>>({});
  const draftsRef = useRef(propertyDrafts); draftsRef.current = propertyDrafts;
  const [propertyEditingIds, setPropertyEditingIds] = useState<string[]>([]);
  const [queueRevision, renderQueue] = useState(0);
  const [comparison, setComparison] = useState<string | null>(null);
  const [comparisonBoard, setComparisonBoard] = useState<Board | null>(null);
  const [detachedTask, setDetachedTask] = useState<ContentTask | null>(null);
  const [draftGeneration, setDraftGeneration] = useState(0);
  const [tableDrafts, setTableDrafts] = useState<Record<string, NativeTableDraft>>({});
  const [draftOwner, setDraftOwner] = useState(`${board.artifact.id}:${actor.id}`);
  const [recovered, setRecovered] = useState<{ text?: { id: string; text: string; base?: BoardElement; initialText?: string }; properties?: typeof propertyDrafts; tables?: Record<string, NativeTableDraft>; tasks?: ContentTask[] } | null>(null);
  const [issues, setIssues] = useState<NativeIssue[]>([]);
  const activityCallback = useRef(onActivityChange); activityCallback.current = onActivityChange;
  const [interactiveId, setInteractiveId] = useState<string | null>(null);
  const [reading, setReading] = useState<{ ids: string[]; viewport: Viewport; interactiveId: string | null; tool: Tool } | null>(null);
  const readingRef = useRef(reading); readingRef.current = reading;
  const readingCallback = useRef(onReadingChange); readingCallback.current = onReadingChange;
  const [readingHint, setReadingHint] = useState(false);
  const readingExit = useRef<HTMLButtonElement>(null);
  const [readingMarker, setReadingMarker] = useState(false);
  const [readingClearRevision, setReadingClearRevision] = useState(0);
  const [menu, setMenu] = useState<{x:number;y:number} | null>(null);
  const [singleKeys, setSingleKeys] = useState(true);
  const [customColors, setCustomColors] = useState<string[]>([]);
  const pendingCustomColors = useRef<string[] | null>(null);
  const [guides, setGuides] = useState<AlignmentGuide[]>([]);
  const [pointer,setPointer]=useState<Point|null>(null);
  const [localAnnotationTarget,setLocalAnnotationTarget]=useState<Anchor|null>(null);
  const textEditor = useRef<InlineTextEditorHandle>(null);
  const [formatState,setFormatState]=useState<InlineTextFormatState>();
  const [linkRequest,setLinkRequest]=useState<{key:string;value:string}>();
  const [zoomMenu, setZoomMenu] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [toolMenu, setToolMenu] = useState<'shape' | 'sticker' | null>(null);
  const [penColor, setPenColor] = useState('#0B0B0B');
  const penWidth = 3;
  const [sticker, setSticker] = useState('smile');
  const [viewTheme, setViewTheme] = useState<'light' | 'dark'>('light');
  const viewStyle = canvasStyle(board.style, viewTheme);
  const [undo, setUndo] = useState<ChangeRecord[]>([]);
  const [redo, setRedo] = useState<ChangeRecord[]>([]);
  const clipboard = useRef<BoardElement[]>([]);
  const spaceHeld = useRef(false);
  const navigationClick = useRef(false);
  const [spacePan,setSpacePan]=useState(false);
  const [tableEditRequest, setTableEditRequest] = useState<{ id: string; sequence: number }>();
  const canEdit = !readOnly && !preview && ['owner', 'editor'].includes(actor.role);
  const canEditRef = useRef(canEdit); canEditRef.current = canEdit;
  const { gestures: peerGestures, publish: publishGesture, confirm: confirmGesture, fail: failGesture, previewStatus, previewError } = useNativeGestureSync({ room, document: board, selfPeerId, readOnly: !canEdit, preview });
  const publishedGesture = useRef<NativeGesture | undefined>(undefined);
  const viewportInteract = useRef(onViewportInteract); viewportInteract.current = onViewportInteract;
  const clientRef = useRef(client); clientRef.current = client;
  const [, renderAssets] = useState(0);
  useEffect(() => client.subscribeAssets?.(() => renderAssets(value => value + 1)), [client.subscribeAssets]);
  const queueCallbacks = useRef({ accepted: (_task: ContentTask, _receipt: ContentReceipt) => {}, changed: () => {} });
  const lastQueueError = useRef('');
  const queueScope = `${board.artifact.id}:${actor.id}`;
  const currentScope = useRef(queueScope); currentScope.current = queueScope;
  const uploadRoom = useRef(room); uploadRoom.current = room;
  const publishUpload = (batch: MediaUploadBatch, end = false, cancelled = false) => {
    if (!canEditRef.current || batch.scope !== currentScope.current || !uploadRoom.current) return;
    const gesture: NativeGesture = { id: batch.id, operationId: batch.id, origin: 'create', baseRevision: batch.baseRevision, kind: 'upload', elements: batch.placeholders.map((placeholder, index) => batch.elements[index] ?? placeholder), ...(end && !cancelled ? { storedIds: batch.elements.map(element => element.id) } : {}) };
    const messages = cancelled ? [] : encodeGestureFrame(gesture, ++batch.frame, () => ++batch.sequence);
    if (end || cancelled) messages.push({ id: batch.id, operationId: batch.id, origin: 'create', baseRevision: batch.baseRevision, seq: ++batch.sequence, phase: 'end', frame: batch.frame, kind: 'upload', cancelled, storedIds: gesture.storedIds ?? [] });
    for (const message of messages) void uploadRoom.current.send('upload', message).then(accepted => { if (!accepted && batch.scope === currentScope.current) setToolNotice('上传预览暂不可用，媒体保存后会同步。'); }).catch(() => { if(batch.scope === currentScope.current) setToolNotice('上传预览暂不可用，媒体保存后会同步。'); });
  };
  const finishUpload = (batch: MediaUploadBatch, accepted = false, receipt?: Board) => {
    if (mediaUploadRef.current !== batch) return;
    publishUpload(batch, accepted, !accepted); mediaUploadRef.current = null; uploadBusyRef.current = false;
    setMediaUpload(null); setUploading(false); setUploadError('');
    if (accepted && receipt && batch.scope === currentScope.current && batch.intent === interactionIntent.current) {
      const current = boardRef.current.artifact.revision > receipt.artifact.revision ? boardRef.current : receipt;
      const ids = batch.elements.map(element => element.id).filter(id => current.elements.some(element => element.id === id));
      if (ids.length) { selectIds(ids); setTool('select'); setToolMenu(null); setMenu(null); setInteractiveId(null); }
    }
  };
  const queue = useMemo(() => contentQueue ?? new NativeContentQueue({ send: args => clientRef.current.call<ContentReceipt>('artifact_apply', args), accepted: (task, receipt) => { if (currentScope.current === queueScope) queueCallbacks.current.accepted(task, receipt); }, changed: () => { if (currentScope.current === queueScope) queueCallbacks.current.changed(); } }), [queueScope, contentQueue]);
  queue.observe(board);
  queueCallbacks.current.changed = () => { setQueueSaving(queue.tasks.some(task => task.state !== 'failed')); const failed = queue.tasks.find(task => task.state === 'failed'); setQueueSaveError(failed ? errorText(failed.failure ?? failed.error) : ''); if (failed) { lastQueueError.current = errorText(failed.failure ?? failed.error); setError(lastQueueError.current); } else if (lastQueueError.current) { const previous = lastQueueError.current; setError(current => current === previous ? '' : current); lastQueueError.current = ''; } const batch = mediaUploadRef.current; if(batch?.referenceQueued && !queue.tasks.some(task => task.keys.some(id => batch.placeholders.some(element => element.id === id)))) finishUpload(batch); renderQueue(value => value + 1); };
  queueCallbacks.current.accepted = (task, response) => {
    const batch = mediaUploadRef.current;
    if (batch?.referenceQueued && task.operations.some(operation => operation.op === 'add' && batch.elements.some(element => element.id === (operation.id ?? operation.element?.id))) && batch.elements.every(element => response.board.elements.some(saved => saved.id === element.id))) finishUpload(batch, true, response.board);
    if (response.board.artifact.revision >= boardRef.current.artifact.revision) { boardRef.current = response.board; if (!contentQueue) onChangedRef.current(response.board); }
    setEditing(current => {
      const op = ((task.args?.operations as Operation[] | undefined) ?? task.operations).find(operation => operation.op === 'update' && operation.id === current?.id && (typeof operation.changes?.text === 'string' || typeof operation.changes?.label === 'string'));
      const next = response.board.elements.find(element => element.id === current?.id);
      if (!current || !op || !next) return current;
      const acceptedText = String(next.type === 'arrow' ? next.label ?? '' : next.text ?? '');
      const merged = mergeJson(String(op.changes?.[next.type === 'arrow' ? 'label' : 'text'] ?? ''), current.text, acceptedText);
      return merged.conflicts.length ? current : { ...current, base: next, text: String(merged.result), initialText: acceptedText };
    });
    if (task.remember) {
      const ids = task.keys.filter(key => key !== '$board'), operations = task.args?.operations as Operation[] | undefined ?? task.operations;
      const knownFields: Record<string, string[]> = {};
      for (const operation of operations) if (operation.id && (operation.op === 'update' || operation.op === 'document')) knownFields[operation.id] = [...new Set([...(knownFields[operation.id] ?? []), ...(operation.op === 'document' ? ['document'] : Object.keys(operation.changes ?? {}))])];
      const mergedWithoutHistory = !response.historyEntry && operations.some(operation => operation.op === 'update' && Object.entries(operation.changes ?? {}).some(([field, value]) => JSON.stringify(response.board.elements.find(element => element.id === operation.id)?.[field]) !== JSON.stringify(value)));
      if (!mergedWithoutHistory) setUndo(items => [...items.slice(-49), { before: task.appliedSources ?? task.sources, after: response.board.elements.filter(element => ids.includes(element.id)), ids, summary: task.summary, historyId: response.historyEntry?.id, snapshot: task.keys.includes('$board'), fields: knownFields }]);
      setRedo([]);
    }
  };
  useEffect(() => { queue.setEnabled(canEdit && !preview); }, [queue, canEdit, preview]);
  useEffect(() => { uploadAlive.current = true; if(mediaUploadRef.current?.scope !== queueScope) { mediaUploadRef.current=null; uploadBusyRef.current=false; setMediaUpload(null); setUploading(false); setUploadError(''); } return () => { uploadAlive.current = false; const batch = mediaUploadRef.current; if(batch) { batch.abort.abort(); publishUpload(batch, false, true); } }; }, [queueScope]);
  const activeUploadId = mediaUpload?.phase !== 'failed' ? mediaUpload?.id : undefined;
  useEffect(() => { if(!activeUploadId || !canEdit || !room) return; const timer = setInterval(() => { const batch = mediaUploadRef.current; if(batch && batch.phase !== 'failed') publishUpload(batch); },1000); return () => clearInterval(timer); }, [activeUploadId, canEdit, room]);
  useEffect(() => { if (!contentQueue) return () => queue.setEnabled(false); return queue.subscribe({ changed: () => queueCallbacks.current.changed(), accepted: (task, receipt) => queueCallbacks.current.accepted(task, receipt) }); }, [queue, contentQueue]);
  const canAnnotate = actor.role !== 'viewer';
  const annotating = !reading && canAnnotate && (annotationActive ?? tool === 'annotate');
  const annotationMode = useRef({ annotating, onAnnotationModeChange }); annotationMode.current = { annotating, onAnnotationModeChange };
  const setAnnotation = (active: boolean) => { onAnnotationModeChange?.(active); setTool(active ? 'annotate' : 'select'); setInteractiveId(null); setToolMenu(null); updateGesture(null); };
  const contentElements = preview ? board.elements : overlayContent(board.elements, queue.tasks).map(element => ({ ...element, ...propertyDrafts[element.id]?.changes }));
  const selectedElements = contentElements.filter((element) => selection.includes(element.id));
  const selected = selectedElements.length === 1 ? selectedElements[0] : undefined;
  const updateGesture = (value: Gesture | null) => {
    if (value && !['pan', 'marquee', 'annotate'].includes(value.kind)) value = { ...value, operationId: value.operationId ?? gestureRef.current?.operationId ?? newClientId('op'), baseRevision: value.baseRevision ?? gestureRef.current?.baseRevision ?? boardRef.current.artifact.revision };
    gestureRef.current = value; setGesture(value);
  };
  const cancelGesture = () => { setAnnotationHoverId(null); if (publishedGesture.current) publishGesture({ ...publishedGesture.current, cancelled: true }); publishedGesture.current = undefined; updateGesture(null); };
  const beginEditing = (element: BoardElement) => {if(readingRef.current)return;interactionIntent.current++;let text=(element.type==='arrow'?element.label:element.text)??'';if(element.bold)text=`**${text}**`;if(element.italic)text=`_${text}_`;setEditing({id:element.id,text,base:element,initialText:text});};

  useEffect(() => {
    setAnnotationHoverId(null);
    if (annotationActive === true && viewportElement.current && isEscapeActive(viewportElement.current)) { void actionsRef.current.chooseTool('annotate',null,false).then(accepted => { if (!accepted) annotationMode.current.onAnnotationModeChange?.(false); }); }
    else if (annotationActive === false) {setTool(current => current === 'annotate' ? 'select' : current);setLocalAnnotationTarget(null);}
  }, [annotationActive]);

  useEffect(() => {
    setAnnotationHoverId(null);
    if (!annotating) return;
    const host = viewportElement.current!;
    const clearHidden = () => { if (document.hidden || !isEscapeActive(host)) setAnnotationHoverId(null); };
    const clear = () => setAnnotationHoverId(null);
    const observer = new MutationObserver(clearHidden);
    for (let ancestor: HTMLElement | null = host; ancestor; ancestor = ancestor.parentElement) observer.observe(ancestor, { attributes: true, attributeFilter: ['hidden', 'inert', 'aria-hidden', 'style', 'class'] });
    document.addEventListener('visibilitychange', clearHidden); window.addEventListener('blur', clear);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', clearHidden); window.removeEventListener('blur', clear); };
  }, [annotating]);

  useEffect(() => {
    const host = viewportElement.current;
    if (!host) return;
    const measure = () => { const next = measureNativeIssues(host); setIssues(current => JSON.stringify(current) === JSON.stringify(next) ? current : next); };
    const frame = requestAnimationFrame(measure);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : undefined;
    observer?.observe(host);
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); };
  }, [board.elements, viewport, editing?.id, gesture]);
  const movingIds = gesture?.kind === 'move' ? gesture.dragging ? gesture.ids : [] : gesture?.kind === 'resize' || gesture?.kind === 'rotate' ? gesture.operations.length ? gesture.ids : [] : gesture?.kind === 'arrow-point' && gesture.operations.length ? [gesture.element.id] : [];
  const editingIds = [...new Set([...(editing ? [editing.id] : []), ...(dialog?.element ? [dialog.element.id] : []), ...(cropDialog ? [cropDialog.id] : []), ...propertyEditingIds, ...Object.entries(documentActivities).filter(([, state]) => state.editing || state.dirty).map(([id]) => id), ...Object.keys(propertyDrafts)])].filter(id => !movingIds.includes(id));
  const savingIds = [...new Set(queue.tasks.filter(task => task.state !== 'failed').flatMap(task => task.keys.filter(key => key !== '$board' && key !== '$order')))];
  const editBase = editing?.base ?? board.elements.find(element => element.id === editing?.id);
  const emptyTextBlocked = Boolean(editing && editBase?.type === 'text' && !editing.text.trim() && (contentElements.some(element => element.id === editing.id && element.locked) || contentElements.some(element => element.type === 'arrow' && element.locked && (element.from === editing.id || element.to === editing.id))));
  const failedEmptyTextDelete = editing && emptyTextDelete.current?.elementId === editing.id ? queue.tasks.find(task => task.id === emptyTextDelete.current?.operationId && task.state === 'failed') : undefined;
  const pendingTextDiffers = Boolean(editing && queue.tasks.some(task => task.keys.includes(editing.id) && task.operations.some(operation => operation.op === 'update' && (typeof operation.changes?.text === 'string' && operation.changes.text !== editing.text || typeof operation.changes?.label === 'string' && operation.changes.label !== editing.text))));
  const textDirty = Boolean(editing && (pendingTextDiffers || editing.text !== (editing.initialText ?? ((editBase?.type === 'arrow' ? editBase.label : editBase?.text) ?? ''))));
  const gestureDirty = gesture?.kind === 'move' || gesture?.kind === 'connect' ? gesture.current.x !== gesture.start.x || gesture.current.y !== gesture.start.y : gesture?.kind === 'resize' || gesture?.kind === 'rotate' || gesture?.kind === 'arrow-point' ? gesture.operations.length > 0 : gesture?.kind === 'draw' || gesture?.kind === 'create';
  const activity = JSON.stringify({ editingIds, movingIds, savingIds, dirty: documentDirty || !!mediaUpload || queue.tasks.length > 0 || Object.keys(tableDrafts).length > 0 || saving || textDirty || dialogDirty || Object.keys(propertyDrafts).length > 0 || Boolean(gestureDirty), saving, saveError, issues });
  useEffect(() => { activityCallback.current?.(JSON.parse(activity)); }, [activity]);
  useEffect(() => () => activityCallback.current?.({ editingIds: [], movingIds: [], dirty: false, issues: [] }), []);
  const draftStorageKey = `studio-draft:${client.baseUrl ?? 'embedded'}:${actor.id}:${board.artifact.id}`;
  const hadLocalDraft = useRef(false), storageFailed = useRef(false);
  useEffect(() => {
    if (preview) return;
    setRecovered(null); hadLocalDraft.current = false;
    try { const stored = localStorage.getItem(draftStorageKey); if (stored) setRecovered(JSON.parse(stored)); }
    catch { setError('无法读取本机草稿，请在关闭前复制重要内容。'); }
  }, [draftStorageKey, preview]);
  useEffect(() => {
    if (preview || draftOwner !== queueScope) return;
    const dirty = textDirty || Object.keys(propertyDrafts).length > 0 || Object.keys(tableDrafts).length > 0 || queue.tasks.length > 0;
    try {
      if (dirty) { localStorage.setItem(draftStorageKey, JSON.stringify({ text: textDirty ? editing : undefined, properties: propertyDrafts, tables: tableDrafts, tasks: queue.tasks })); hadLocalDraft.current = true; }
      else if (hadLocalDraft.current) { localStorage.removeItem(draftStorageKey); hadLocalDraft.current = false; }
    } catch { if (!storageFailed.current) { storageFailed.current = true; setError('本机草稿保存失败，请复制草稿或下载副本后再关闭。'); } }
  }, [draftStorageKey, draftOwner, queueScope, editing, textDirty, propertyDrafts, tableDrafts, queueRevision, preview]);

  useEffect(() => {
    const ancestor = viewportElement.current?.closest('[data-studio-theme]') ?? document.documentElement;
    const update = () => {
      const value = ancestor.getAttribute('data-studio-theme') ?? document.documentElement.getAttribute('data-theme');
      setViewTheme(value === 'dark' || value !== 'light' && globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(ancestor, { attributes: true, attributeFilter: ['data-studio-theme', 'data-theme'] });
    if (ancestor !== document.documentElement) observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const selectIds = useCallback((ids: string[], recordIntent = true) => { if (recordIntent && JSON.stringify(ids) !== JSON.stringify(selectionRef.current)) interactionIntent.current++; setSelection(ids); selectionRef.current = ids; }, []);
  useEffect(() => { selectionCallback.current?.(selection); }, [selection]);
  useEffect(() => { viewportCallback.current?.(viewport); }, [viewport]);
  useEffect(() => {
    if (!readingRef.current && externalViewport && Number.isFinite(externalViewport.x) && Number.isFinite(externalViewport.y) && externalViewport.zoom > 0) {
      setViewport((current) => current.x === externalViewport.x && current.y === externalViewport.y && current.zoom === externalViewport.zoom ? current : { ...externalViewport, zoom: clamp(externalViewport.zoom, .05, 8) });
    }
  }, [externalViewport]);
  useEffect(() => {
    setSelection((ids) => { const next = ids.filter((id) => board.elements.some((element) => element.id === id)); return ids.length === next.length ? ids : next; });
    setEditing(current => {
      if (!current || queue.tasks.some(task => task.keys.includes(current.id)) || current.text !== current.initialText) return current;
      const remote = board.elements.find(element => element.id === current.id && element.type === current.base?.type);
      if (!remote || remote.version === current.base?.version) return current;
      let text = String(remote.type === 'arrow' ? remote.label ?? '' : remote.text ?? ''); if (remote.bold) text = `**${text}**`; if (remote.italic) text = `_${text}_`;
      return { ...current, base: remote, text, initialText: text };
    });
  }, [board]);
  useEffect(() => {
    if (readingRef.current) exitReading();
    selectIds([]); setTool('select'); setEditing(null); setDialog(null); setLayoutMode(null); setCropDialog(null); setDialogDirty(false); setPropertyDrafts({}); setTableDrafts({}); setPropertyEditingIds([]); setUndo([]); setRedo([]);
    setDraftOwner(`${board.artifact.id}:${actor.id}`);
    const frame = requestAnimationFrame(() => {
      const host = viewportElement.current;
      if (host && !externalViewportRef.current) setViewport(fitViewport(boardRef.current.elements, host.clientWidth, host.clientHeight));
    });
    return () => cancelAnimationFrame(frame);
  }, [board.artifact.id, actor.id, selectIds]);
  useEffect(() => {
    if (!readingRef.current && externalSelectedIds) selectIds(externalSelectedIds.filter(id => boardRef.current.elements.some(element => element.id === id)));
  }, [externalSelectedIds, selectIds]);
  useEffect(() => {
    if (!insertedElementId) return;
    const element = boardRef.current.elements.find(item => item.id === insertedElementId), host = viewportElement.current;
    if (!element || !host) return;
    cancelGesture(); setTool('select'); setToolMenu(null); setMenu(null); setInteractiveId(null); selectIds([element.id]);
    viewportInteract.current?.();
    setViewport(fitViewport([element], host.clientWidth || 900, host.clientHeight || 600));
  }, [insertedElementId, selectIds]);

  const apply = useCallback(async (operations: Operation[], summary: string, sourceElements?: BoardElement[], remember = true, operationId?: string): Promise<Board | null> => {
    if (!canEditRef.current || preview || !operations.length) return null;
    return (await queue.enqueue(boardRef.current, operations, summary, sourceElements, remember, summary, operationId))?.board ?? null;
  }, [queue, preview]);

  useEffect(()=>{const stored=board.style.nativeInks??'';const colors=stored?stored.split(',').map(value=>`#${value}`):[];if(colors.some(value=>!/^#[0-9a-f]{6}$/i.test(value))){setError('自定义色板数据无效，请重新选择颜色。');return;}setCustomColors(colors);},[board.style.nativeInks]);
  const saveCustomColors = (colors:string[]) => {const next=colors.slice(-64);pendingCustomColors.current=next;setCustomColors(next);};
  useEffect(()=>{if(queueSaving||!pendingCustomColors.current)return;const colors=pendingCustomColors.current;pendingCustomColors.current=null;void apply([{op:'style',style:{nativeInks:colors.map(color=>color.slice(1)).join(',')}}],'修改自定义墨色');},[queueSaving,customColors,apply]);
  const stageSelected = (changes: Partial<BoardElement>) => {
    const next = { ...draftsRef.current };
    for (const element of boardRef.current.elements.filter(element => selectionRef.current.includes(element.id))) {
      const draft = next[element.id] ?? { base: element, changes: {} };
      const patch = { ...draft.changes, ...changes };
      for (const key of Object.keys(patch)) if (JSON.stringify(patch[key]) === JSON.stringify(draft.base[key]) && !queue.tasks.some(task => task.keys.includes(element.id))) delete patch[key];
      if (Object.keys(patch).length) next[element.id] = { base: draft.base, changes: patch }; else delete next[element.id];
    }
    draftsRef.current = next; setPropertyDrafts(next);
    return next;
  };
  const savePropertyDrafts = async (ids = selectionRef.current, summary = '调整元素') => {
    const drafts = ids.flatMap(id => draftsRef.current[id] ? [{ id, ...draftsRef.current[id] }] : []);
    if (!drafts.length) return;
    const saved = await apply(drafts.map(draft => ({ op: 'update', id: draft.id, changes: draft.changes })), summary, drafts.map(draft => draft.base));
    const next = { ...draftsRef.current };
    for (const draft of drafts) {
      if (!next[draft.id]) continue;
      if (saved && JSON.stringify(next[draft.id].changes) === JSON.stringify(draft.changes)) delete next[draft.id];
    }
    draftsRef.current = next; setPropertyDrafts(next);
    return saved;
  };
  const updateSelected = async (changes: Partial<BoardElement>, summary = '调整元素') => {
    stageSelected(changes);
    await savePropertyDrafts(selectionRef.current, summary);
  };
  const commitEditing = async (adjacent = false, close = true) => {
    if (!canEdit || !editing) return;
    const current = boardRef.current.elements.find(element => element.id === editing.id);
    if (!current) { setError('此对象已被删除。文字草稿仍保留，可复制后使用。'); return; }
    const base = editing.base ?? current;
    if (current.type === 'text' && base.type === 'text' && !editing.text.trim()) {
      if (!close) return boardRef.current;
      const cleanup = newTextIds.current.has(current.id) || !!(editing.initialText ?? base.text ?? '').trim();
      if (!cleanup) { setEditing(null); return boardRef.current; }
      const linked = boardRef.current.elements.filter(element => element.type === 'arrow' && (element.from === current.id || element.to === current.id));
      const intended = overlayContent(boardRef.current.elements, queue.tasks).map(element => ({...element,...draftsRef.current[element.id]?.changes}));
      if ((intended.find(element => element.id === current.id) ?? current).locked || linked.some(element => (intended.find(value => value.id === element.id) ?? element).locked)) { setError('此文字或关联连线已锁定，不能通过清空删除。请先解锁；原内容和本地草稿已保留。'); return null; }
      const previous = emptyTextDelete.current;
      const operationId = previous?.elementId === current.id && queue.tasks.some(task => task.id === previous.operationId) ? previous.operationId : newClientId('op');
      emptyTextDelete.current = {elementId:current.id,operationId};
      const saved = await apply([{ op: 'delete', id: current.id }], '删除空文字', [base, ...linked], true, operationId);
      if (saved) { emptyTextDelete.current = undefined; newTextIds.current.delete(current.id); setEditing(null); selectIds(selectionRef.current.filter(id => id !== current.id), false); }
      return saved;
    }
    const changed = pendingTextDiffers || editing.text !== (editing.initialText ?? ((base.type === 'arrow' ? base.label : base.text) ?? ''));
    const editor=viewportElement.current?.querySelector<HTMLElement>('[contenteditable="true"]');const fitted=editor&&!base.locked&&['text','note','shape'].includes(base.type)?Math.max(current.h,editor.scrollHeight+(['note','shape'].includes(base.type)?32:0)):current.h;
    const saved = changed ? await apply([{ op: 'update', id: editing.id, changes: { ...(base.type === 'arrow' ? { label: editing.text } : { text: editing.text }), ...(base.bold?{bold:false}:{}), ...(base.italic?{italic:false}:{}), ...(fitted>current.h?{h:fitted}:{}) } }], '编辑文字', [base]) : boardRef.current;
    if (saved) {
      if (close) setEditing(value => value?.id === editing.id && value.text === editing.text ? null : value);
      if (adjacent && ['text', 'note', 'shape', 'container'].includes(base.type)) {
        const next = makeElement(base.type, { x: current.x + (base.type === 'text' ? 0 : current.w + 24), y: current.y + (base.type === 'text' ? current.h + 24 : 0) }, { w: current.w, h: current.h, kind: current.kind, fill: current.fill, color: current.color, fontSize: current.fontSize, text: '' });
        await addElements([next], '添加相邻元素', { edit: true });
      }
    }
    return saved;
  };
  const cancelEmptyTextEdit = () => {
    if (editing && emptyTextDelete.current?.elementId === editing.id) {
      const task = queue.tasks.find(task => task.id === emptyTextDelete.current?.operationId && task.state === 'failed');
      if (task) queue.discard(task.id);
      emptyTextDelete.current = undefined;
    }
    setEditing(null);
    const remaining = queue.tasks.find(task => task.state === 'failed');
    setError(remaining ? errorText(remaining.failure ?? remaining.error) : '');
    requestAnimationFrame(() => viewportElement.current?.focus({preventScroll:true}));
  };
  const liveCommit = useRef(() => {}); liveCommit.current = () => { void commitEditing(false, false); };
  const textWaitStarted = useRef<number | null>(null);
  useEffect(() => {
    if (!canEdit || preview || !textDirty || queue.tasks.some(task => task.state === 'failed' && task.keys.includes(editing?.id ?? ''))) { textWaitStarted.current = null; return; }
    textWaitStarted.current ??= Date.now();
    const timeout = setTimeout(() => { textWaitStarted.current = null; liveCommit.current(); }, Math.max(0, Math.min(250, 1000 - (Date.now() - textWaitStarted.current))));
    return () => clearTimeout(timeout);
  }, [editing?.text, editing?.id, textDirty, canEdit, preview]);
  const addElements = async (elements: BoardElement[], summary: string, options: { edit?: boolean; operationId?: string } = {}) => {
    const saved = await apply(elements.map((element) => ({ op: 'add', id: element.id, element })), summary, undefined, true, options.operationId);
    if (saved) {
      selectIds(elements.map((element) => element.id));
      setTool('select'); setToolMenu(null); setInteractiveId(null); setMenu(null);
      for (const element of elements) if (element.type === 'text') newTextIds.current.add(element.id);
      if (options.edit) { const next = saved.elements.find(element => element.id === elements[0]?.id); if (next) beginEditing(next); }
    }
    return saved;
  };
  const boardPoint = (clientX: number, clientY: number): Point => {
    const rect = viewportElement.current?.getBoundingClientRect();
    const current = viewportRef.current;
    return { x: (clientX - (rect?.left ?? 0) - current.x) / current.zoom, y: (clientY - (rect?.top ?? 0) - current.y) / current.zoom };
  };
  const centerPoint = (): Point => {
    const host = viewportElement.current;
    return { x: ((host?.clientWidth ?? 900) / 2 - viewportRef.current.x) / viewportRef.current.zoom - 150, y: ((host?.clientHeight ?? 600) / 2 - viewportRef.current.y) / viewportRef.current.zoom - 100 };
  };
  const htmlNavigation = (element: BoardElement, input: HtmlNavigationEvent) => {
    if (input.kind === 'space') { spaceHeld.current = input.held; setSpacePan(input.held); return; }
    if (input.kind === 'zoom') {
      viewportInteract.current?.();
      const point = anchorBounds({ coordinateSpace: 'element', elementIds: [element.id], x: input.x, y: input.y }, [element]);
      if (point) setViewport(current => zoomAt(current, { x: current.x + point.x * current.zoom, y: current.y + point.y * current.zoom }, current.zoom * wheelZoomFactor(input.deltaY, input.deltaMode)));
      return;
    }
    if (input.phase === 'start') {
      viewportInteract.current?.(); cancelGesture();
      updateGesture({ kind: 'pan', start: { x: input.screenX, y: input.screenY }, viewport: viewportRef.current, frame: { regionId: element.id, pointerId: input.pointerId } });
      return;
    }
    const current = gestureRef.current;
    if (current?.kind !== 'pan' || current.frame?.regionId !== element.id || current.frame.pointerId !== input.pointerId) return;
    if (input.phase !== 'cancel') setViewport({ ...current.viewport, x: current.viewport.x + input.screenX - current.start.x, y: current.viewport.y + input.screenY - current.start.y });
    if (input.phase === 'end' || input.phase === 'cancel') updateGesture(null);
  };
  const fit = (scope: 'all' | 'selection' | 'auto' = 'auto') => {
    viewportInteract.current?.();
    const host = viewportElement.current;
    const bounds = nativeSelectionBounds(boardRef.current.elements, scope !== 'all' && selectionRef.current.length ? selectionRef.current : boardRef.current.elements.map(element => element.id));
    if (host && bounds) setViewport(fitViewport([bounds], host.clientWidth, host.clientHeight, 72, scope === 'selection' ? 8 : 1));
  };
  const exitReading = () => {
    const previous = readingRef.current;
    if (!previous) return;
    cancelGesture(); setPointer(null);
    readingRef.current = null; setReading(null); setReadingHint(false); setReadingMarker(false);
    setViewport(previous.viewport); setInteractiveId(previous.interactiveId); setTool(previous.tool);
    readingCallback.current?.(false);
    requestAnimationFrame(() => {
      const button = viewportElement.current?.parentElement?.querySelector<HTMLElement>('[aria-label="全屏观看选区"]');
      (button ?? viewportElement.current)?.focus({ preventScroll: true });
    });
  };
  const readSelection = async () => {
    if (readingRef.current || !selectionRef.current.length) return;
    const selectedIds = [...selectionRef.current], scope = currentScope.current;
    if (editing && !await commitEditing()) return;
    if (selectedIds.some(id => draftsRef.current[id]) && !await savePropertyDrafts()) return;
    if (!viewportElement.current || scope !== currentScope.current || JSON.stringify(selectedIds) !== JSON.stringify(selectionRef.current)) return;
    // Viewing a container includes its locked children too; movement locks do not hide content.
    const ids = expandMoveIds(boardRef.current.elements.map(element => element.locked ? { ...element, locked: false } : element), selectedIds);
    const next = { ids, viewport: { ...viewportRef.current }, interactiveId, tool };
    readingRef.current = next; setReading(next); setReadingHint(true); setReadingMarker(false);
    cancelGesture(); setPointer(null); setMenu(null); setZoomMenu(false); setToolMenu(null); setTool('select');
    viewportInteract.current?.(); readingCallback.current?.(true);
  };
  const fitReadingContent = () => {
    const current = readingRef.current, host = viewportElement.current;
    if (!current || !host) return;
    const bounds = nativeSelectionBounds(boardRef.current.elements, current.ids);
    if (!bounds) { exitReading(); return; }
    viewportInteract.current?.();
    setViewport(fitViewport([bounds], host.clientWidth, host.clientHeight, 48, 8));
  };
  const setReadingZoom = (zoom: number) => {
    const host = viewportElement.current; if (!host) return;
    viewportInteract.current?.();
    setViewport(value => zoomAt(value, { x: host.clientWidth / 2, y: host.clientHeight / 2 }, zoom));
  };
  const readingBoundsKey = reading ? JSON.stringify(nativeSelectionBounds(board.elements, reading.ids)) : '';
  useEffect(() => {
    if (!reading) return;
    const host = viewportElement.current!;
    const fitReading = fitReadingContent;
    fitReading();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fitReading) : undefined;
    observer?.observe(host); window.addEventListener('resize', fitReading);
    return () => { observer?.disconnect(); window.removeEventListener('resize', fitReading); };
  }, [reading, readingBoundsKey]);
  useEffect(() => {
    if (!reading) return;
    readingExit.current?.focus({ preventScroll: true });
    const timer = setTimeout(() => setReadingHint(false), 3500);
    return () => clearTimeout(timer);
  }, [Boolean(reading)]);
  useEffect(() => {
    if (readingRef.current && !board.elements.some(element => readingRef.current!.ids.includes(element.id))) exitReading();
  }, [board.elements]);
  useEffect(() => () => { if (readingRef.current) readingCallback.current?.(false); }, []);
  const stepZoom = (factor: number) => { viewportInteract.current?.(); const host = viewportElement.current; setViewport((value) => zoomAt(value, { x: (host?.clientWidth ?? 900) / 2, y: (host?.clientHeight ?? 600) / 2 }, value.zoom * factor)); };

  const remove = () => {
    const elements = boardRef.current.elements.filter((element) => selectionRef.current.includes(element.id));
    if (!elements.length) return;
    if (elements.some(element => element.locked)) { setError('请先解锁位置，再删除所选元素。'); return; }
    void apply(elements.map((element) => ({ op: 'delete', id: element.id })), '删除元素', elements).then((saved) => { if (saved) selectIds([]); });
  };
  const duplicate = (fromClipboard = false) => {
    const source = fromClipboard && clipboard.current.length ? clipboard.current : boardRef.current.elements;
    const ids = fromClipboard && clipboard.current.length ? source.map((element) => element.id) : selectionRef.current;
    const copies = duplicateElements(source, ids);
    if (copies.length) void addElements(copies, '复制元素');
  };
  const group = async () => {
    if (selectionRef.current.length < 2) return;
    const groupId = newId();
    await updateSelected({ groupId }, '组合元素');
  };
  const copiedElements = () => {const ids=expandMoveIds(boardRef.current.elements,selectionRef.current);return structuredClone(boardRef.current.elements.filter(element=>ids.includes(element.id)));};
  const copySelection = async () => {const elements=copiedElements();await copyPlainText(CLIPBOARD_PREFIX+JSON.stringify(elements));clipboard.current=elements;};
  const command = async (action: CanvasCommand) => {
    const elements=boardRef.current.elements,ids=selectionRef.current;
    if(action==='copy'){try{await copySelection();}catch(error){setError(errorText(error));}return;}
    if(action==='cut'){try{await copySelection();remove();}catch(error){setError(errorText(error));}return;}
    if(action==='paste'){try{if(!navigator.clipboard?.readText)throw new Error('此浏览器无法直接读取剪贴板，请按 Ctrl/⌘ V 粘贴。');const value=await navigator.clipboard.readText();if(value.length>8*1024*1024)throw new Error('剪贴板内容超过8 MB，请分批粘贴。');if(value.startsWith(CLIPBOARD_PREFIX)){const elements=JSON.parse(value.slice(CLIPBOARD_PREFIX.length)) as BoardElement[];if(!Array.isArray(elements)||elements.length>200||elements.some(element=>!element||typeof element.id!=='string'||typeof element.type!=='string'))throw new Error('剪贴板中的白板内容无效。');await addElements(duplicateElements(elements,elements.map(element=>element.id)),'粘贴元素');}else if(value.trim())await addElements([makeElement('text',centerPoint(),{text:value.slice(0,20000)})],'粘贴文字');}catch(error){setError(errorText(error));}return;}
    if(action==='duplicate'){duplicate();return;}
    if(action==='delete'){remove();return;}
    if(action==='select-all'){selectIds(elements.map(element=>element.id));return;}
    if(action==='fit'){fit('all');return;}
    if(action==='fit-selection'){fit('selection');return;}
    if(action==='group'){void group();return;}
    if(action==='ungroup'){void updateSelected({groupId:''},'取消组合');return;}
    if(action==='lock'){void updateSelected({locked:!elements.filter(element=>ids.includes(element.id)).every(element=>element.locked)},'锁定位置与尺寸');return;}
    if(action==='tidy'||action==='flow-layout'){void openSelectionLayout(action==='tidy'?'geometry':'flow');return;}
    if(['front','back','forward','backward'].includes(action))void apply([{op:'layout',preset:action,ids}],'调整层级',elements);
  };
  const openMenu = async (point: Point) => {if(editing&&!await commitEditing())return;if(selectionRef.current.some(id=>draftsRef.current[id])&&!await savePropertyDrafts())return;const rect=viewportElement.current?.getBoundingClientRect();setMenu({x:point.x-(rect?.left??0),y:point.y-(rect?.top??0)});};
  const chooseTool = async (choice: Tool, nextMenu: 'shape' | 'sticker' | null = null, notifyAnnotation = true) => {
    interactionIntent.current++;
    if (choice === 'annotate' && (!canAnnotate || preview)) return false;
    if (editing && !await commitEditing()) return false;
    if (selectionRef.current.some(id => draftsRef.current[id]) && !await savePropertyDrafts()) return false;
    cancelGesture(); setMenu(null); setZoomMenu(false); setInteractiveId(null); setTool(choice); setToolMenu(nextMenu); setToolNotice('');
    if (choice === 'arrow' || choice === 'stroke') setLastDrawTool(choice);
    if (choice === 'shape' || choice === 'table') setLastShapeTool(choice);
    if (notifyAnnotation) {
      if (choice === 'annotate') annotationMode.current.onAnnotationModeChange?.(true);
      else if (annotationMode.current.annotating) annotationMode.current.onAnnotationModeChange?.(false);
    }
    return true;
  };
  const openHtmlEditor = async (element?: BoardElement) => {
    if (!await chooseTool('select')) return;
    if (onEditHtml) onEditHtml(element); else setDialog({ type: 'html', element });
  };
  const openSelectionLayout = async (mode: 'geometry' | 'flow') => {
    if (!canEditRef.current || readingRef.current || selectionRef.current.length < 2) return;
    if (!await chooseTool('select')) return;
    if (queue.tasks.length) { setError('请先完成当前保存或处理未保存的草稿，再整理选区。'); return; }
    setLayoutMode(mode);
  };
  const measureLayoutLabels = () => Object.fromEntries([...viewportElement.current!.querySelectorAll<HTMLElement>('[data-element-id] .studio-arrow-label')].flatMap(node => {
    const id = node.closest('[data-element-id]')!.getAttribute('data-element-id')!, rect = node.getBoundingClientRect();
    const edge = boardRef.current.elements.find(element => element.id === id);
    const internal = edge && typeof edge.from === 'string' && typeof edge.to === 'string' && selectionRef.current.includes(edge.from) && selectionRef.current.includes(edge.to);
    return internal && rect.width > 0 && rect.height > 0 ? [[id, { w: rect.width / viewportRef.current.zoom, h: rect.height / viewportRef.current.zoom }]] : [];
  }));
  const applyCalculatedLayout = async (operations: Operation[], summary: string, source: Board, versions: Record<string, number>, operationId: string) => {
    if (!canEditRef.current || preview || source.artifact.id !== boardRef.current.artifact.id) throw new Error('当前视图无法应用排布。');
    const failed = queue.tasks.find(task => task.id === operationId && task.state === 'failed');
    if (!failed && Object.entries(versions).some(([id, version]) => (id === '$order' ? boardRef.current.orderVersion ?? 0 : boardRef.current.elements.find(item => item.id === id)?.version ?? 0) !== version)) throw new Error('布局依据已更新，请重新预览后再应用。');
    const receipt = failed ? await queue.retry(operationId) : await queue.enqueue(source, operations, summary, source.elements, true, undefined, operationId, versions);
    if (!receipt) throw new Error(queue.tasks.find(task => task.id === operationId)?.error || '排布尚未确认保存，请重试或核对最新内容。');
  };
  const editSelected = () => {
    const selected = selectionRef.current.length === 1 && boardRef.current.elements.find(element => element.id === selectionRef.current[0]);
    if (!selected || !canEdit || annotating || tool !== 'select') return false;
    if (selected.type === 'html' || selected.type === 'diagram' && typeof selected.html === 'string') {
      void openHtmlEditor(selected);
    } else if (selected.type === 'link') setDialog({ type: 'link', element: selected });
    else if (selected.type === 'image') {
      if (!selected.src || selected.video || selected.locked) return false;
      setCropDialog(selected);
    } else if (selected.type === 'table') setTableEditRequest(current => ({ id: selected.id, sequence: (current?.sequence ?? 0) + 1 }));
    else if (!['stroke', 'diagram', 'chart'].includes(selected.type) && !(selected.type === 'sticker' && getBoardSticker(selected.data?.stickerIconId))) beginEditing(selected);
    else return false;
    updateGesture(null); return true;
  };
  const changeHistory = async (direction: 'undo' | 'redo') => {
    const records = direction === 'undo' ? undo : redo;
    const record = records.at(-1);
    if (!record) return;
    if(record.historyId){const saved=await apply([{op:'restore',versionId:record.historyId,data:{mode:'undo'}}],`${direction==='undo'?'撤销':'重做'}：${record.summary}`,undefined,false);if(saved){const next={...record,historyId:queue.historyId(saved.artifact.revision)};if(direction==='undo'){setUndo(items=>items.slice(0,-1));setRedo(items=>[...items,next]);}else{setRedo(items=>items.slice(0,-1));setUndo(items=>[...items,next]);}}return;}
    const target = direction === 'undo' ? record.before : record.after;
    const current = boardRef.current.elements;
    const operations: Operation[] = [];
    for (const id of record.ids) {
      const old = current.find((element) => element.id === id);
      const next = target.find((element) => element.id === id);
      const expected = (direction === 'undo' ? record.after : record.before).find(element => element.id === id);
      const sameContent = (a: BoardElement | undefined, b: BoardElement | undefined) => JSON.stringify(a && Object.fromEntries(Object.entries(a).filter(([key]) => key !== 'version'))) === JSON.stringify(b && Object.fromEntries(Object.entries(b).filter(([key]) => key !== 'version')));
      if (!next && old) { if (!sameContent(old, expected)) { setError('此对象后来已被修改，无法安全撤销。'); return; } operations.push({ op: 'delete', id }); }
      else if (next && !old) { if (expected) { setError('此对象后来已被删除，无法安全撤销。'); return; } operations.push({ op: 'add', id, element: next }); }
      else if (next && old) {
        const changes: Partial<BoardElement> = {};
        const defaults: Partial<BoardElement> = { groupId: '', parentId: '', fontFamily: '', bold: false, italic: false, locked: false, hollow: false, dash: false, text: '', label: '', fill: next.type === 'link' ? '#ffffff' : '', color: '', stroke: '', fontSize: 17, textAlign: next.type === 'shape' ? 'center' : 'left', strokeWidth: Number(next.width ?? (next.type === 'stroke' ? 3 : next.type === 'shape' ? 1.4 : 1.8)), heads: arrowHeads(next), crop: { zoom: 1, x: .5, y: .5 }, data: {} };
        for (const key of record.fields?.[id] ?? new Set([...Object.keys(expected ?? {}), ...Object.keys(next)])) {
          if (key === 'id' || key === 'version' || JSON.stringify(expected?.[key]) === JSON.stringify(next[key])) continue;
          if (JSON.stringify(old[key] ?? defaults[key]) !== JSON.stringify(expected?.[key] ?? defaults[key])) { setError('这项内容后来已被修改，无法安全撤销。'); return; }
          changes[key] = next[key] ?? defaults[key];
        }
        if (Object.keys(changes).length) operations.push({ op: 'update', id, changes });
      }
    }
    const saved = await apply(operations, `${direction === 'undo' ? '撤销' : '重做'}：${record.summary}`, current, false);
    if (saved) {
      if (direction === 'undo') { setUndo((items) => items.slice(0, -1)); setRedo((items) => [...items, record]); }
      else { setRedo((items) => items.slice(0, -1)); setUndo((items) => [...items, record]); }
    }
  };

  const actionsRef = useRef({ remove, duplicate, changeHistory, fit, command, stepZoom, updateSelected, chooseTool, editSelected });
  actionsRef.current = { remove, duplicate, changeHistory, fit, command, stepZoom, updateSelected, chooseTool, editSelected };
  const shortcutState = useRef({ blocked: false });
  shortcutState.current.blocked = Boolean(menu || zoomMenu || toolMenu || dialog || cropDialog || layoutMode || comparison || detachedTask);
  const activateNumericTool = (key: string) => {
    const canvas = viewportElement.current?.closest('.studio-whiteboard');
    if (readingRef.current || !singleKeys || document.visibilityState === 'hidden' || !canvas || !isEscapeActive(canvas as HTMLElement) || shortcutState.current.blocked || canvas.querySelector('.studio-format-popover,[role="menu"],[role="dialog"]')) return false;
    const choice = key === '9' ? 'annotate' : TOOL_OPTIONS.find(item => item.key === key)?.tool;
    if (!choice || choice === 'annotate' && (!canAnnotate || preview) || !canEdit && !['select','pan','annotate'].includes(choice)) return false;
    void chooseTool(choice); return true;
  };
  const numericTool = useRef(activateNumericTool); numericTool.current = activateNumericTool;
  const escapeAction = useRef<(target: EventTarget | null) => boolean>(() => false);
  escapeAction.current = target => {
    if (readingRef.current) { exitReading(); return true; }
    if (target instanceof Element && target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')) return false;
    if (menu) setMenu(null);
    else if (zoomMenu) setZoomMenu(false);
    else if (toolMenu) setToolMenu(null);
    else if (gestureRef.current) cancelGesture();
    else if (interactiveId) setInteractiveId(null);
    else if (annotationMode.current.annotating) { setAnnotationHoverId(null); setTool('select'); annotationMode.current.onAnnotationModeChange?.(false); }
    else if (tool !== 'select') setTool('select');
    else selectIds([]);
    return true;
  };
  useEffect(() => registerEscapeLayer(viewportElement.current!.closest<HTMLElement>('.studio-whiteboard')!, target => escapeAction.current(target), 0), []);
  useEffect(() => {
    const host = viewportElement.current;
    if (!host) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey && (event.target as HTMLElement).closest('[data-native-interactive]')) return;
      event.preventDefault();
      viewportInteract.current?.();
      if (event.ctrlKey || event.metaKey) {
        const rect = host.getBoundingClientRect();
        setViewport((current) => zoomAt(current, { x: event.clientX - rect.left, y: event.clientY - rect.top }, current.zoom * wheelZoomFactor(event.deltaY, event.deltaMode)));
      } else setViewport((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
    };
    host.addEventListener('wheel', wheel, { passive: false, capture: true });
    return () => host.removeEventListener('wheel', wheel, true);
  }, []);
  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || !isEscapeActive(viewportElement.current!)) return;
      const target = event.target as HTMLElement;
      if (target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),iframe,[role="dialog"],[role="menu"],[role="listbox"],[role="combobox"]')) return;
      if (target?.closest('button,a[href]') && (event.key === 'Enter' || event.key === ' ' || event.code === 'Space')) return;
      if (event.code === 'Space') { spaceHeld.current = true; setSpacePan(true); event.preventDefault(); return; }
      if (readingRef.current) { if (['Delete', 'Backspace'].includes(event.key)) event.preventDefault(); return; }
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === 'a') { event.preventDefault(); selectIds(boardRef.current.elements.map((element) => element.id)); }
      else if(canEdit && command && event.key.toLowerCase()==='g'){event.preventDefault();actionsRef.current.command(event.shiftKey?'ungroup':'group');}
      else if(canEdit && command && ['[',']'].includes(event.key)){event.preventDefault();actionsRef.current.command(event.key===']'?(event.shiftKey?'front':'forward'):(event.shiftKey?'back':'backward'));}
      else if(canEdit && event.altKey && !command && !event.shiftKey && ['a','h','d','w','v','s'].includes(event.key.toLowerCase())){event.preventDefault();const edges={a:'left',h:'hcenter',d:'right',w:'top',v:'vcenter',s:'bottom'} as const;void apply(alignSelection(boardRef.current.elements,selectionRef.current,edges[event.key.toLowerCase() as keyof typeof edges]),'对齐元素');}
      else if (command && event.key === '0') { event.preventDefault(); actionsRef.current.fit(); }
      else if (command && event.key.toLowerCase() === 'c') { if (selectionRef.current.length) clipboard.current = structuredClone(boardRef.current.elements.filter((element) => expandMoveIds(boardRef.current.elements, selectionRef.current).includes(element.id))); }
      else if (canEdit && command && event.key.toLowerCase() === 'd') { event.preventDefault(); actionsRef.current.duplicate(); }
      else if (canEdit && command && event.key.toLowerCase() === 'z') { event.preventDefault(); void actionsRef.current.changeHistory(event.shiftKey ? 'redo' : 'undo'); }
      else if (canEdit && command && event.key.toLowerCase() === 'y') { event.preventDefault(); void actionsRef.current.changeHistory('redo'); }
      else if (canEdit && ['Delete', 'Backspace'].includes(event.key) && selectionRef.current.length) { event.preventDefault(); actionsRef.current.remove(); }
      else if (command && ['+','='].includes(event.key)) {event.preventDefault();actionsRef.current.stepZoom(1.2);}
      else if(command && event.key==='-'){event.preventDefault();actionsRef.current.stepZoom(1/1.2);}
      else if(command && event.shiftKey && event.key.toLowerCase()==='l'){event.preventDefault();actionsRef.current.command('lock');}
      else if(command && event.key.toLowerCase()==='x'){event.preventDefault();actionsRef.current.command('cut');}
      else if(event.shiftKey && ['Digit0','Digit1','Digit2'].includes(event.code)){event.preventDefault();event.code==='Digit0'?actionsRef.current.stepZoom(1/viewportRef.current.zoom):actionsRef.current.fit(event.code==='Digit1'?'all':'selection');}
      else if(!command && event.key.startsWith('Arrow')){event.preventDefault();const d=event.shiftKey?10:1;const delta={x:event.key==='ArrowLeft'?-d:event.key==='ArrowRight'?d:0,y:event.key==='ArrowUp'?-d:event.key==='ArrowDown'?d:0};if(canEdit&&selectionRef.current.length)void apply(moveOperations(boardRef.current.elements,selectionRef.current,delta),'移动元素');else setViewport(value=>({...value,x:value.x-delta.x*24,y:value.y-delta.y*24}));}
      else if (!command && !event.altKey && !event.shiftKey && !event.repeat) {
        const host = viewportElement.current?.closest('.studio-whiteboard');
        if (document.visibilityState === 'hidden' || !host?.contains(target) || shortcutState.current.blocked || host.querySelector('.studio-format-popover,[role="menu"],[role="dialog"]')) return;
        if ((event.key === 'Enter' || event.key === 'F2') && actionsRef.current.editSelected()) { event.preventDefault(); return; }
        if (numericTool.current(event.key)) event.preventDefault();
      }
    };
    const keyUp = (event: KeyboardEvent) => { if (event.code === 'Space') {spaceHeld.current = false;setSpacePan(false);} };const resetSpace=()=>{spaceHeld.current=false;setSpacePan(false);if(gestureRef.current?.kind==='pan')updateGesture(null);};window.addEventListener('blur',resetSpace);
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp);
    return () => { window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur',resetSpace); };
  }, [canEdit, selectIds, singleKeys]);

  const captureNavigation = (event: ReactPointerEvent<HTMLDivElement>) => {
    navigationClick.current = false;
    if (event.button !== 1 && !(event.button === 0 && (spaceHeld.current || tool === 'pan' && !annotating))) return;
    navigationClick.current = event.button === 0;
    viewportInteract.current?.(); event.preventDefault(); event.stopPropagation();
    cancelGesture(); viewportElement.current?.setPointerCapture(event.pointerId);
    updateGesture({ kind: 'pan', start: { x: event.clientX, y: event.clientY }, viewport: viewportRef.current, pointerId: event.pointerId });
  };
  const begin = (event: ReactPointerEvent<HTMLDivElement>, element?: BoardElement) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('[data-native-interactive]') && !annotating) return;
    if (readingRef.current) {
      navigationClick.current = true;
      event.preventDefault(); event.stopPropagation();
      viewportElement.current?.setPointerCapture(event.pointerId);
      updateGesture({ kind: 'pan', start: { x: event.clientX, y: event.clientY }, viewport: viewportRef.current });
      return;
    }
    interactionIntent.current++;
    setToolMenu(null);setZoomMenu(false);setMenu(null);
    if (dialog) return;
    if (editing) {
      event.preventDefault(); event.stopPropagation();
      if (element?.id === editing.id) { textEditor.current?.focus(); return; }
      const intent = interactionIntent.current, scope = currentScope.current;
      void commitEditing().then(saved => {
        if (!saved || !viewportElement.current || scope !== currentScope.current || intent !== interactionIntent.current) return;
        selectIds(element && saved.elements.some(value => value.id === element.id) ? [element.id] : []);
        viewportElement.current.focus({ preventScroll: true });
      });
      return;
    }
    const host = viewportElement.current;
    if (!host) return;
    host.focus({ preventScroll: true });
    if (tool === 'pan' && !annotating || spaceHeld.current) {
      viewportInteract.current?.();
      event.preventDefault(); event.stopPropagation(); host.setPointerCapture(event.pointerId);
      updateGesture({ kind: 'pan', start: { x: event.clientX, y: event.clientY }, viewport: viewportRef.current }); return;
    }
    const point = boardPoint(event.clientX, event.clientY);
    if (annotating) {
      setAnnotationHoverId(null);
      event.preventDefault(); event.stopPropagation(); host.setPointerCapture(event.pointerId);
      selectIds(element?[element.id]:[]);setLocalAnnotationTarget(null);
      updateGesture({ kind: 'annotate', start: point, end: point, element }); return;
    }
    if (tool === 'select' && element) {
      event.stopPropagation(); event.preventDefault();
      const groupIds = element.groupId ? contentElements.filter((item) => item.groupId === element.groupId).map((item) => item.id) : [element.id];
      const current = selectionRef.current;
      const ids = event.shiftKey ? current.includes(element.id) ? current.filter((id) => !groupIds.includes(id)) : [...new Set([...current, ...groupIds])] : current.includes(element.id) ? current : groupIds;
      selectIds(ids);
      if (!canEdit || element.locked || event.shiftKey && current.includes(element.id)) return;
      const moveIds = expandMoveIds(contentElements, ids.filter(id => !contentElements.find(item => item.id === id)?.locked));
      const copies=event.altKey?duplicateElements(contentElements,moveIds,{x:0,y:0}):undefined;
      updateGesture({ kind: 'move', start: point, screenStart: { x:event.clientX,y:event.clientY }, current: point, ids: copies?copies.map(element=>element.id):moveIds, elements: copies??contentElements.filter((item) => moveIds.includes(item.id)), copies });
      return;
    }
    if (tool === 'select') {
      event.preventDefault(); host.setPointerCapture(event.pointerId);
      updateGesture({ kind: 'marquee', start: point, end: point, additive: event.shiftKey });
      if (!event.shiftKey) selectIds([]);
      return;
    }
    if (!canEdit) return;
    if (tool === 'sticker' && !getBoardSticker(sticker)) return;
    event.preventDefault(); event.stopPropagation(); host.setPointerCapture(event.pointerId);
    const created = makeElement(tool as ElementType, point, { ...(tool === 'shape' ? { kind: shapeKind } : {}), ...(['text', 'shape', 'note'].includes(tool) ? { text: '' } : {}), ...(tool === 'stroke' || tool === 'arrow' ? { stroke: penColor, color: penColor, strokeWidth: penWidth } : {}), ...(tool === 'sticker' ? { text: getBoardSticker(sticker)!.label, data: { stickerIconId: sticker } } : {}) });
    if (tool === 'stroke' || tool === 'arrow') {
      if (tool === 'arrow') { created.from = element?.id ?? [point.x, point.y]; created.to = [point.x, point.y]; }
      updateGesture({ kind: 'draw', start: point, points: [point], element: created, ...(element ? { from: element.id } : {}) });
    } else updateGesture({ kind: 'create', start: point, element: created });
  };
  const resizeBegin = (event: ReactPointerEvent, handle: ResizeHandle) => {
    const ids = selectionRef.current, elements = contentElements;
    const box = nativeSelectionBounds(elements, ids);
    if (event.button !== 0 || !canEdit || annotating || !box || elements.some(element => ids.includes(element.id) && element.locked)) return;
    event.stopPropagation(); event.preventDefault(); viewportElement.current?.setPointerCapture(event.pointerId);
    updateGesture({ kind: 'resize', start: boardPoint(event.clientX,event.clientY), elements, ids, box, handle, operations: [] });
  };
  const rotateBegin = (event: ReactPointerEvent) => {
    const ids = selectionRef.current, elements = contentElements, box = nativeSelectionBounds(elements,ids);
    if (event.button !== 0 || !canEdit || annotating || !box || elements.some(element => ids.includes(element.id) && (element.locked || element.type!=='arrow' && !ROTATABLE_TYPES.has(element.type)))) return;
    event.stopPropagation(); event.preventDefault(); viewportElement.current?.setPointerCapture(event.pointerId);
    updateGesture({ kind:'rotate', start:boardPoint(event.clientX,event.clientY), elements, ids, box, operations:[] });
  };
  const connectBegin = (event: ReactPointerEvent, element: BoardElement, side: ConnectionSide) => {
    if (event.button!==0 || !canEdit || annotating || editing || element.locked) return;
    event.stopPropagation(); event.preventDefault(); viewportElement.current?.setPointerCapture(event.pointerId);
    const point=boardPoint(event.clientX,event.clientY);
    updateGesture({kind:'connect',start:point,current:point,element,side});
  };
  const move = (event: ReactPointerEvent) => {
    const hovering=boardPoint(event.clientX,event.clientY);onCursorMove?.(hovering);if(canEdit&&!annotating&&['text','shape','note','container','table','sticker'].includes(tool))setPointer(hovering);
    const current = gestureRef.current;
    if (current?.kind === 'pan' && current.frame) return;
    if (annotating && !current && isEscapeActive(viewportElement.current!)) {
      const id = (event.target as Element).closest('[data-element-id]')?.getAttribute('data-element-id');
      const target = contentElements.find(element => element.id === id);
      setAnnotationHoverId(target && target.type !== 'html' && !(target.type === 'diagram' && target.html) ? target.id : null);
    }
    if (!current) return;
    let point = boardPoint(event.clientX, event.clientY);
    if (event.shiftKey && current.kind === 'draw' && current.element.type==='arrow') { const angle=Math.round(Math.atan2(point.y-current.start.y,point.x-current.start.x)/(Math.PI/4))*(Math.PI/4); const distance=Math.hypot(point.x-current.start.x,point.y-current.start.y); point={x:current.start.x+Math.cos(angle)*distance,y:current.start.y+Math.sin(angle)*distance}; }
    if (current.kind === 'pan') setViewport({ ...current.viewport, x: current.viewport.x + event.clientX - current.start.x, y: current.viewport.y + event.clientY - current.start.y });
    else if (current.kind === 'marquee' || current.kind === 'annotate') updateGesture({ ...current, end: point });
    else if (current.kind === 'move') { if(!current.dragging && Math.hypot(event.clientX-current.screenStart.x,event.clientY-current.screenStart.y)<5)return; if(!current.dragging)viewportElement.current?.setPointerCapture(event.pointerId); const snapped = snapMove(boardRef.current.elements,current.ids,{x:point.x-current.start.x,y:point.y-current.start.y},viewportRef.current.zoom); setGuides(snapped.guides); updateGesture({...current,dragging:true,current:{x:current.start.x+snapped.delta.x,y:current.start.y+snapped.delta.y}}); }
    else if (current.kind === 'connect') { updateGesture({...current,current:point}); }
    else if (current.kind === 'resize') { const delta={x:point.x-current.start.x,y:point.y-current.start.y}; const target=current.elements.filter(element=>current.ids.includes(element.id)); const operations=target.length===1?resizeElement(target[0],current.handle,delta,{aspect:event.shiftKey,center:event.altKey}):resizeSelection(current.elements,current.ids,current.box,resizeBox(current.box,current.handle,delta,{aspect:event.shiftKey || target.some(element=>Boolean(element.rotation)),center:event.altKey})); updateGesture({...current,operations}); }
    else if (current.kind === 'rotate') { const center={x:current.box.x+current.box.w/2,y:current.box.y+current.box.h/2}; let angle=(Math.atan2(point.y-center.y,point.x-center.x)-Math.atan2(current.start.y-center.y,current.start.x-center.x))*180/Math.PI; if(event.shiftKey)angle=Math.round(angle/15)*15; updateGesture({...current,operations:rotateSelection(current.elements,current.ids,angle)}); }
    else if (current.kind === 'arrow-point') {const changes=current.end==='bends'?{bends:current.points!.slice(1,-1).flatMap((value,index)=>index===current.bendIndex?[point.x,point.y]:[value.x,value.y])}:{[current.end]:[point.x,point.y]};updateGesture({...current,operations:[{op:'update',id:current.element.id,changes}]});}
    else if (current.kind === 'draw') {
      if (current.points.length >= 20000) { setToolNotice('本笔已达到长度上限，正在保存当前笔迹，请另起一笔。'); finish(event); return; }
      if(event.shiftKey&&current.element.type==='stroke'){const anchor=current.straightStart??current.points.at(-1)!;const prefix=current.straightPoints??current.points;const angle=Math.round(Math.atan2(point.y-anchor.y,point.x-anchor.x)/(Math.PI/4))*(Math.PI/4),distance=Math.hypot(point.x-anchor.x,point.y-anchor.y);updateGesture({...current,straightStart:anchor,straightPoints:prefix,points:[...prefix,{x:anchor.x+Math.cos(angle)*distance,y:anchor.y+Math.sin(angle)*distance}]});return;}
      const previous = current.points.at(-1)!;
      if (Math.hypot(point.x - previous.x, point.y - previous.y) > 2 / viewportRef.current.zoom) updateGesture({ ...current, straightStart:undefined,straightPoints:undefined,points: [...current.points, point] });
    } else {
      if(event.shiftKey&&current.element.type==='shape'){const side=Math.max(Math.abs(point.x-current.start.x),Math.abs(point.y-current.start.y));point={x:current.start.x+Math.sign(point.x-current.start.x||1)*side,y:current.start.y+Math.sign(point.y-current.start.y||1)*side};}
      if (Math.hypot(point.x-current.start.x,point.y-current.start.y)*viewportRef.current.zoom < 5) return;
      const box = normalizedRect(current.start, point);
      updateGesture({ ...current, element: { ...current.element, ...box, w: Math.max(32, box.w), h: Math.max(28, box.h) } });
    }
  };
  const finish = (event: ReactPointerEvent) => {
    let current = gestureRef.current;
    if (!current) return;
    if (current.kind === 'pan' && current.frame) return;
    let point = boardPoint(event.clientX, event.clientY);
    if (current.kind === 'move') {
      const snapped = snapMove(boardRef.current.elements, current.ids, { x: point.x-current.start.x, y: point.y-current.start.y }, viewportRef.current.zoom);
      current = { ...current, current: { x: current.start.x+snapped.delta.x, y: current.start.y+snapped.delta.y }, dragging: current.dragging || Math.hypot(event.clientX-current.screenStart.x,event.clientY-current.screenStart.y)>=5 };
    } else if (current.kind === 'resize') {
      const resizing = current, target = current.elements.filter(element => resizing.ids.includes(element.id));
      const delta = { x:point.x-current.start.x, y:point.y-current.start.y };
      current = { ...current, operations: target.length===1 ? resizeElement(target[0],current.handle,delta,{aspect:event.shiftKey,center:event.altKey}) : resizeSelection(current.elements,current.ids,current.box,resizeBox(current.box,current.handle,delta,{aspect:event.shiftKey||target.some(element=>Boolean(element.rotation)),center:event.altKey})) };
    } else if (current.kind === 'rotate') {
      const center = { x:current.box.x+current.box.w/2, y:current.box.y+current.box.h/2 };
      let angle = (Math.atan2(point.y-center.y,point.x-center.x)-Math.atan2(current.start.y-center.y,current.start.x-center.x))*180/Math.PI;
      if(event.shiftKey)angle=Math.round(angle/15)*15;
      current = { ...current, operations:rotateSelection(current.elements,current.ids,angle) };
    } else if (current.kind === 'create') {
      if(event.shiftKey&&current.element.type==='shape'){const side=Math.max(Math.abs(point.x-current.start.x),Math.abs(point.y-current.start.y));point={x:current.start.x+Math.sign(point.x-current.start.x||1)*side,y:current.start.y+Math.sign(point.y-current.start.y||1)*side};}
      const box = normalizedRect(current.start,point), defaults = makeElement(current.element.type,current.start);
      current = { ...current, element: Math.hypot(point.x-current.start.x,point.y-current.start.y)*viewportRef.current.zoom<5 ? { ...current.element,x:current.start.x,y:current.start.y,w:defaults.w,h:defaults.h } : { ...current.element,...box,w:Math.max(32,box.w),h:Math.max(28,box.h) } };
    }
    let finalPresence = publishedGesture.current;
    const operationId = current.operationId;
    const previewFinal = (elements: BoardElement[], origin: 'create'|'existing', kind: NativeGesture['kind']) => {
      if(!operationId)return;
      finalPresence={id:operationId,operationId,baseRevision:current!.baseRevision,origin,kind,elements, ...(origin==='create'?{storedIds:elements.map(element=>element.id)}:{})};
      publishedGesture.current=finalPresence;publishGesture(finalPresence);
    };
    const settledGesture = (saved: Board | null | undefined) => {
      if(!operationId)return;
      if(saved) confirmGesture({ id:operationId,operationId,revision:saved.artifact.revision,versions:Object.fromEntries((finalPresence?.elements??[]).flatMap(element=>{const actual=saved.elements.find(value=>value.id===element.id);return actual?[[actual.id,actual.version]]:[];})) });
      else failGesture({id:operationId,operationId});
    };
    updateGesture(null); setGuides([]);
    if (viewportElement.current?.hasPointerCapture(event.pointerId)) viewportElement.current.releasePointerCapture(event.pointerId);
    if (current.kind === 'pan') return;
    if (current.kind === 'annotate') {
      const area = normalizedRect(current.start,current.end), dragged = Math.hypot(area.w,area.h)*viewportRef.current.zoom>5;
      const targets = dragged ? boardRef.current.elements.filter(element=>intersects(area,elementBounds(element,boardRef.current.elements))) : current.element ? [current.element] : [];
      const element = !dragged ? current.element : undefined, relative = element ? relativeElementPoint(elementBounds(element,boardRef.current.elements) as BoardElement,current.start) : undefined;
      setLocalAnnotationTarget(element?{elementIds:[element.id],coordinateSpace:'element',...relative}:{coordinateSpace:'board',x:current.start.x,y:current.start.y,...dragged?area:{}});
      onAnnotateNative?.({anchor:element?{elementIds:[element.id],coordinateSpace:'element',...relative}:{coordinateSpace:'board',elementIds:targets.map(item=>item.id),x:current.start.x,y:current.start.y,...(dragged?area:{})},label:element?`${element.type==='note'?'便签':element.type==='container'?'分区':'对象'} · ${(element.text||element.label||element.type).slice(0,100)}`:dragged?`画布范围${targets.length?` · ${targets.length} 个对象`:''}`:'画布位置',versions:Object.fromEntries(targets.map(item=>[item.id,item.version])),screenPoint:{x:event.clientX,y:event.clientY}});
      return;
    }
    if (current.kind === 'marquee') {
      const box = normalizedRect(current.start,current.end), ids = boardRef.current.elements.filter(element=>element.type!=='arrow'&&intersects(box,element)).map(element=>element.id);
      selectIds(current.additive?[...new Set([...selectionRef.current,...ids])]:ids);return;
    }
    if (current.kind === 'move') {
      if(!current.dragging){if(finalPresence)publishGesture({...finalPresence,cancelled:true});return;}
      const delta = { x:current.current.x-current.start.x,y:current.current.y-current.start.y }, operations = moveOperations(current.elements,current.ids,delta);
      const next = current.elements.map(element=>({...element,...operations.find(operation=>operation.id===element.id)?.changes}));
      previewFinal(next,current.copies?'create':'existing','move');
      if(current.copies)void addElements(next,'拖动复制',{operationId}).then(settledGesture);
      else void apply(operations,'移动元素',current.elements,true,operationId).then(settledGesture);
    } else if (current.kind === 'connect') {
      const source=current.element,dragged=Math.hypot(point.x-current.start.x,point.y-current.start.y)*viewportRef.current.zoom>=5;
      if(!dragged&&(source.type==='note'||source.type==='shape')){
        const next=adjacentElement(source,current.side,makeElement(source.type,source,{w:source.w,h:source.h,kind:source.kind,fill:source.fill,color:source.color,stroke:source.stroke,strokeWidth:source.strokeWidth,fontSize:source.fontSize,text:''}),boardRef.current.elements);
        const arrow=source.type==='shape'?makeElement('arrow',connectionPoint(source,current.side),{from:source.id,fromSide:current.side,to:next.id,toSide:OPPOSITE_SIDE[current.side],color:penColor,stroke:penColor,strokeWidth:penWidth}):undefined;
        const elements=arrow?[next,arrow]:[next];previewFinal(elements,'create','arrow');
        void(async()=>{const saved=await addElements(elements,'添加相邻元素',{edit:source.type==='note',operationId});settledGesture(saved);if(saved)selectIds([next.id]);})();
      }else if(dragged&&source.type!=='note'){
        const target=connectionAtPoint(boardRef.current.elements,point,viewportRef.current.zoom,[source.id]),start=connectionPoint(source,current.side),box=normalizedRect(start,point);
        const arrow=makeElement('arrow',start,{...box,from:source.id,fromSide:current.side,to:target?.element.id??[point.x,point.y],...(target?.side?{toSide:target.side}:{}),color:penColor,stroke:penColor,strokeWidth:penWidth});
        previewFinal([arrow],'create','arrow');void addElements([arrow],'添加连接线',{operationId}).then(settledGesture);
      }else if(finalPresence)publishGesture({...finalPresence,cancelled:true});
    } else if (current.kind === 'resize' || current.kind === 'rotate' || current.kind === 'arrow-point') {
      let operations=current.operations;
      const elements=current.kind==='arrow-point'?[current.element]:current.elements;
      if(current.kind==='arrow-point'){
        const changes=current.end==='bends'?{bends:current.points!.slice(1,-1).flatMap((value,index)=>index===current.bendIndex?[point.x,point.y]:[value.x,value.y])}:{[current.end]:[point.x,point.y]};
        operations=[{op:'update',id:current.element.id,changes}];
        if(current.end!=='bends'){const target=[...boardRef.current.elements].reverse().find(element=>element.id!==current!.element.id&&!['arrow','stroke'].includes(element.type)&&point.x>=element.x&&point.x<=element.x+element.w&&point.y>=element.y&&point.y<=element.y+element.h);if(target)operations=[{op:'update',id:current.element.id,changes:{[current.end]:target.id}}];}
      }
      if(!operations.length){if(finalPresence)publishGesture({...finalPresence,cancelled:true});return;}
      const affectedIds=new Set(operations.flatMap(operation=>operation.id?[operation.id]:[]));
      const next=elements.filter(element=>affectedIds.has(element.id)).map(element=>({...element,...operations.find(operation=>operation.id===element.id)?.changes}));
      previewFinal(next,'existing',current.kind==='rotate'?'turn':current.kind==='arrow-point'?'arrow':'resize');
      void apply(operations,current.kind==='rotate'?'旋转元素':'调整几何',elements,true,operationId).then(settledGesture);
    } else if (current.kind === 'draw') {
      if(event.shiftKey&&current.element.type==='arrow'){const angle=Math.round(Math.atan2(point.y-current.start.y,point.x-current.start.x)/(Math.PI/4))*(Math.PI/4),distance=Math.hypot(point.x-current.start.x,point.y-current.start.y);point={x:current.start.x+Math.cos(angle)*distance,y:current.start.y+Math.sin(angle)*distance};}
      let points=current.points;
      if (current.element.type === 'stroke' && points.length >= 20000) setToolNotice('本笔已达到长度上限，正在保存当前笔迹，请另起一笔。');
      const last=points.at(-1)!;
      if((point.x!==last.x||point.y!==last.y)&&points.length<20000)points=[...points,point];
      const drawn=drawnElement(current,points);
      if(current.element.type==='arrow'){
        const target=[...boardRef.current.elements].reverse().find(element=>element.id!==current!.from&&!['arrow','stroke','container'].includes(element.type)&&point.x>=element.x&&point.x<=element.x+element.w&&point.y>=element.y&&point.y<=element.y+element.h);
        drawn.to=target?.id??[point.x,point.y];
      }
      previewFinal([drawn],'create',current.element.type==='stroke'?'ink':'arrow');
      void addElements([drawn],current.element.type==='stroke'?'添加笔迹':'添加连接线',{operationId}).then(settledGesture);
    } else {
      previewFinal([current.element],'create','shape');
      void addElements([current.element],'添加元素',{edit:['text','note'].includes(current.element.type),operationId}).then(settledGesture);
    }
  };

  const currentMoveElements = (moving:Extract<Gesture,{kind:'move'}>,elements:BoardElement[],patches:Operation[]) => moving.copies?[...elements,...moving.copies.map(element=>({...element,...patches.find(patch=>patch.id===element.id)?.changes}))]:elements.map(element=>({...element,...patches.find(patch=>patch.id===element.id)?.changes}));
  const remoteElements = contentElements.slice();
  const localIntentIds = new Set([...movingIds, ...editingIds, ...queue.tasks.flatMap(task => task.keys)]);
  for (const peer of peerGestures) for (const element of peer.elements) {
    if (localIntentIds.has(element.id)) continue;
    const index = remoteElements.findIndex(item => item.id === element.id);
    if (index < 0) { if (peer.kind !== 'upload') remoteElements.push(element); }
    else { const geometry = Object.fromEntries(['x', 'y', 'w', 'h', 'rotation', 'points', 'from', 'to', 'bends', 'fromSide', 'toSide', 'labelOffset', 'labelSize'].filter(key => element[key] !== undefined).map(key => [key, element[key]])); remoteElements[index] = { ...remoteElements[index]!, ...geometry }; }
  }
  const renderedElements = useMemo(() => {
    if (!gesture) return remoteElements;
    if (gesture.kind === 'move') {
      const patches = moveOperations(gesture.elements, gesture.ids, { x: gesture.current.x - gesture.start.x, y: gesture.current.y - gesture.start.y });
      return currentMoveElements(gesture,remoteElements,patches);
    }
    if (gesture.kind === 'resize' || gesture.kind === 'rotate' || gesture.kind === 'arrow-point') return remoteElements.map(element => ({...element,...gesture.operations.find(operation=>operation.id===element.id)?.changes}));
    if (gesture.kind === 'create') return [...remoteElements, gesture.element];
    if (gesture.kind === 'connect' && gesture.element.type!=='note' && Math.hypot(gesture.current.x-gesture.start.x,gesture.current.y-gesture.start.y)*viewport.zoom>=5) {
      const target=connectionAtPoint(contentElements,gesture.current,viewport.zoom,[gesture.element.id]);
      return [...remoteElements,makeElement('arrow',connectionPoint(gesture.element,gesture.side),{id:'connection-preview',from:gesture.element.id,fromSide:gesture.side,to:target?.element.id??[gesture.current.x,gesture.current.y],...(target?.side?{toSide:target.side}:{}),color:penColor,stroke:penColor,strokeWidth:penWidth})];
    }
    if (gesture.kind === 'draw') {
      return [...remoteElements, drawnElement(gesture)];
    }
    return remoteElements;
  }, [board.elements, queueRevision, propertyDrafts, peerGestures, gesture, viewport.zoom, penColor, preview]);
  const peerPreviewFrames = peerGestures.flatMap(peer => {
    const page = presence.find(page => page.peerId === peer.peerId), busyIds = [...(page?.context?.editingIds ?? []), ...(Array.isArray(page?.context?.movingIds) ? page.context.movingIds as string[] : [])];
    if (peer.kind === 'upload' && peer.elements.length && peer.elements.every(element => busyIds.includes(element.id))) return [];
    const bounds = boundsOf(peer.elements.map(element => elementBounds(element, remoteElements)));
    return bounds ? [{peer,bounds}] : [];
  });
  useEffect(() => {
    if (!gesture || ['pan', 'marquee', 'annotate'].includes(gesture.kind) || gesture.kind === 'move' && !gesture.dragging || ['resize','rotate','arrow-point'].includes(gesture.kind) && !(gesture as Extract<Gesture,{operations:Operation[]}>).operations.length || !canEdit || preview) { if (publishedGesture.current) publishGesture(undefined); publishedGesture.current = undefined; return; }
    const ids = gesture.kind === 'move' || gesture.kind === 'resize' || gesture.kind === 'rotate' ? gesture.ids : gesture.kind === 'arrow-point' || gesture.kind === 'draw' || gesture.kind === 'create' ? [gesture.element.id] : ['connection-preview'];
    const kind: NativeGesture['kind'] = gesture.kind === 'rotate' ? 'turn' : gesture.kind === 'draw' ? gesture.element.type === 'stroke' ? 'ink' : 'arrow' : gesture.kind === 'create' ? 'shape' : gesture.kind === 'connect' || gesture.kind === 'arrow-point' ? 'arrow' : gesture.kind as 'move' | 'resize';
    const next: NativeGesture = { id: gesture.operationId!, operationId: gesture.operationId, origin: gesture.kind === 'create' || gesture.kind === 'draw' || gesture.kind === 'connect' || gesture.kind === 'move' && !!gesture.copies ? 'create' : 'existing', baseRevision: gesture.baseRevision, kind, elements: renderedElements.filter(element => ids.includes(element.id)) };
    publishedGesture.current = next; publishGesture(next);
  }, [gesture, canEdit, preview, publishGesture]);

  const runMediaUpload = async (batch: MediaUploadBatch) => {
    if (uploadBusyRef.current || !canEditRef.current || batch.scope !== currentScope.current) return;
    uploadBusyRef.current = true; setUploadError(''); setError('');
    const live = () => uploadAlive.current && mediaUploadRef.current === batch && batch.scope === currentScope.current;
    batch.phase = batch.elements.length < batch.files.length ? 'uploading' : 'queued'; batch.error = undefined;
    setUploading(batch.phase === 'uploading'); setMediaUpload({ ...batch }); publishUpload(batch);
    try {
      for (let index = batch.elements.length; index < batch.files.length; index++) {
        const file = batch.files[index]!;
        if (!live()) return;
        if (!canEditRef.current) throw new Error('当前为只读，媒体草稿已保留。恢复编辑权限后可重试。');
        if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type) && !/^video\/(mp4|webm|quicktime)$/.test(file.type)) throw new Error('支持 PNG、JPEG、WebP、GIF、SVG 图片，以及 MP4、WebM、MOV 视频。');
        if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} 超过 20 MB，请压缩后添加。`);
        let src: string;
        if (client.baseUrl) {
          const response = await studioRequest(client, new URL(`/api/assets?artifactId=${encodeURIComponent(batch.artifactId)}`, client.baseUrl), { method: 'POST', headers: { ...(client.token ? { Authorization: `Bearer ${client.token}` } : {}), 'Content-Type': file.type, 'X-Filename': encodeURIComponent(file.name), 'X-Studio-Name': encodeURIComponent(actor.name) }, body: file, signal: batch.abort.signal });
          const result = await response.json() as { src?: string; error?: { message?: string } };
          if (!response.ok || !result.src) throw new Error(result.error?.message ?? `资源上传失败（${response.status}）。`);
          src = result.src;
        } else {
          if (file.type.startsWith('video/') || file.size > 1024 * 1024) throw new Error('大图片和视频需要连接本地 Studio 服务后添加。');
          src = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('无法读取图片。')); reader.readAsDataURL(file); });
        }
        if (!live()) return;
        const video = file.type.startsWith('video/');
        let w = video ? 480 : 360, h = video ? 270 : 240;
        let data: BoardElement['data'];
        if (!video) {
          try {
            const image = new Image(); image.src = assetDisplayUrl(src, client)!; await image.decode();
            const ratio = Math.min(1, 480 / image.naturalWidth, 360 / image.naturalHeight); w = image.naturalWidth * ratio; h = image.naturalHeight * ratio;
            data = { naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight };
          } catch { /* The object remains usable when dimension probing is unavailable. */ }
        }
        if (!live()) return;
        batch.elements.push(makeElement('image', { x: batch.position.x + index * 32, y: batch.position.y + index * 32 }, { id: batch.placeholders[index]!.id, w, h, text: file.name, data, ...(video ? { video: src } : { src }) }));
        setMediaUpload({ ...batch }); publishUpload(batch);
      }
      if (!live()) return;
      if (!canEditRef.current) throw new Error('当前为只读，已上传的媒体仍未加入白板。恢复编辑权限后可重试。');
      batch.phase = 'queued'; batch.referenceQueued = true; setMediaUpload({ ...batch });
      const failed = queue.tasks.find(task => task.state === 'failed' && task.operations.some(operation => operation.op === 'add' && batch.elements.some(element => element.id === (operation.id ?? operation.element?.id))));
      const pending = failed ? queue.retry(failed.id) : queue.enqueue(boardRef.current, batch.elements.map(element => ({ op: 'add', id: element.id, element })), '添加媒体', undefined, true, undefined, batch.id);
      setUploading(false);
      const receipt = await pending;
      if (!live()) return;
      if (!receipt) throw queue.tasks.find(task => task.state === 'failed' && task.keys.some(id => batch.elements.some(element => element.id === id)))?.failure ?? new Error('媒体尚未加入白板，草稿已保留。');
      finishUpload(batch, true, receipt.board);
    } catch (failure) {
      if (!live()) return;
      batch.phase = 'failed'; batch.error = errorText(failure); setMediaUpload({ ...batch }); setUploadError(batch.error); setError(batch.error); publishUpload(batch, false, true);
    } finally { if (live()) { uploadBusyRef.current = false; setUploading(false); } }
  };
  const uploadMedia = async (files: FileList | File[] | null, position = centerPoint()) => {
    if (!files?.length || !canEditRef.current) return;
    const selected = [...files].slice(0, 12);
    if (mediaUploadRef.current) { setError('当前媒体尚未加入白板，请先完成重试或移除这份上传草稿。'); return; }
    if (!await chooseTool('select')) return;
    const batch: MediaUploadBatch = { id: newClientId('upload'), scope: queueScope, artifactId: boardRef.current.artifact.id, baseRevision: boardRef.current.artifact.revision, intent: interactionIntent.current, files: selected, position: { ...position }, placeholders: selected.map((file, index) => makeElement('image', { x: position.x + index * 32, y: position.y + index * 32 }, { w: 360, h: 240, text: file.name })), elements: [], phase: 'uploading', referenceQueued: false, frame: 0, sequence: 0, abort: new AbortController() };
    mediaUploadRef.current = batch;
    await runMediaUpload(batch);
  };

  const renderElement = (element: BoardElement) => {
    const picked = !reading && selection.includes(element.id);
    const hidden = Boolean(reading && !reading.ids.includes(element.id));
    const lineColor = semanticColor(nativePaint(element.stroke ?? element.color,viewTheme), viewStyle, viewStyle.muted);
    if (element.type === 'arrow') {
      const geometry = arrowGeometry(element, renderedElements);
      const marker = `studio-arrow-${element.id}`;
      const startMarker = `studio-arrow-start-${element.id}`;
      const [fromHead, toHead] = arrowHeads(element);
      const markerColor = picked ? viewStyle.accent : lineColor;
      const renderMarker = (id: string, head: string) => <marker id={id} viewBox="0 0 10 10" refX={head === 'circle' ? 5 : 8} refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">{head === 'circle' ? <circle cx="5" cy="5" r="3" fill={viewStyle.paper} stroke={markerColor} strokeWidth="1.5" /> : <path d="M 1 1 L 8 5 L 1 9" fill="none" stroke={markerColor} strokeWidth="1.5" />}</marker>;
      return <svg key={element.id} className={`studio-canvas-arrow${picked ? ' is-selected' : ''}`} data-element-id={element.id} aria-label={element.label || '连接线'} style={{ overflow: 'visible', display: hidden ? 'none' : undefined }}>
        <defs>{renderMarker(startMarker, fromHead)}{renderMarker(marker, toHead)}</defs>
        <path d={geometry.path} fill="none" stroke="transparent" strokeWidth={16 / viewport.zoom} pointerEvents="stroke" onPointerDown={(event) => begin(event as unknown as ReactPointerEvent<HTMLDivElement>, element)} onDoubleClick={event => { event.stopPropagation(); if (canEdit && !annotating) beginEditing(element); }} />
        <path d={geometry.path} fill="none" stroke={markerColor} strokeWidth={Number(element.strokeWidth ?? element.width ?? 1.8)} strokeDasharray={element.dash ? '6 5' : undefined} markerStart={fromHead !== 'none' ? `url(#${startMarker})` : undefined} markerEnd={toHead !== 'none' ? `url(#${marker})` : undefined} pointerEvents="none" />
        {(element.label || editing?.id === element.id) && <foreignObject x={geometry.label.x - (element.labelSize?.w ?? 200) / 2} y={geometry.label.y - (element.labelSize ? element.labelSize.h / 2 : 28)} width={element.labelSize?.w ?? 200} height={element.labelSize?.h ?? 54} overflow="visible"><div className="studio-arrow-label" style={element.labelSize ? { maxWidth: element.labelSize.w } : undefined}>{editing?.id === element.id ? renderTextEditor(element) : <RichText text={element.label} />}</div></foreignObject>}
      </svg>;
    }
    const fill = element.hollow ? 'transparent' : semanticColor(nativePaint(element.fill,viewTheme), viewStyle, element.type === 'note' ? '#fff0b5' : element.type === 'shape' || element.type === 'table' ? viewStyle['paper-2'] ?? viewStyle.paper : 'transparent');
    const textFill = element.type === 'table' ? viewStyle.paper : element.type === 'container' ? 'transparent' : fill;
    const preferredInk = semanticColor(nativePaint(element.color,viewTheme), viewStyle, viewStyle.ink);
    let ink = preferredInk, headerInk = preferredInk;
    try { if (element.type !== 'sticker' && contrastRatio(ink, textFill, viewStyle.paper) < 4.5) ink = readableText(textFill, viewStyle.paper); } catch { /* Unknown user paint is left for the renderer rather than rewritten. */ }
    try { if (element.type === 'table' && contrastRatio(headerInk, fill, viewStyle.paper) < 4.5) headerInk = readableText(fill, viewStyle.paper); } catch { /* Keep the same handling for unsupported header paint. */ }
    const style: CSSProperties = { display: hidden ? 'none' : undefined, left: element.x, top: element.y, width: element.w, height: element.h, color: ink, fontSize: element.fontSize ?? 17, fontFamily: element.fontFamily || viewStyle.fontFamily, fontWeight: element.bold ? 600 : 400, fontStyle: element.italic ? 'italic' : 'normal', textAlign: element.textAlign ?? (element.type === 'shape' ? 'center' : 'left'), transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined, ...(element.type === 'container' ? { borderColor: lineColor, borderStyle: element.dash ? 'dashed' : 'solid', borderWidth: element.strokeWidth ?? 1, background: fill !== 'transparent' ? fill : undefined } : {}) };
    let content;
    if (element.type === 'html' || element.type === 'diagram' && typeof element.html === 'string') content = <HtmlRegion element={element} annotation={annotating} interactive={reading ? reading.ids.includes(element.id) : interactiveId === element.id} preserveScroll panMode={spacePan || tool === 'pan' && !annotating} onNavigation={input => htmlNavigation(element, input)} onPointerPosition={point => { const position = point && anchorBounds({ coordinateSpace: 'element', elementIds: [element.id], x: point.x, y: point.y }, [element]); onCursorMove?.(position ? { x: position.x, y: position.y } : null); }} onAnnotate={selection=>{selectIds([element.id]);onAnnotate(selection);}} onToolShortcut={key=>{numericTool.current(key);}} onStateChange={canEdit ? async (state: Json, expectedVersion: number) => {
      const current = boardRef.current.elements.find((item) => item.id === element.id);
      if (!current) throw new Error('此嵌入区域已被删除，交互草稿仍保留。');
      const source = queue.source(element.id, expectedVersion);
      if (!source) throw new Error('嵌入内容的编辑基准已过期，请保留草稿后重新打开。');
      const failed = queue.tasks.find(task => task.state === 'failed' && task.keys.includes(element.id));
      if (failed && !await queue.retry(failed.id)) throw failed.failure ?? new Error(failed.error);
      const saved = await apply([{ op: 'update', id: element.id, changes: { state } }], '更新嵌入交互状态', [source], false);
      const next = saved?.elements.find((item) => item.id === element.id);
      if (!next) throw queue.tasks.find(task => task.state === 'failed' && task.keys.includes(element.id))?.failure ?? new Error('交互状态未能保存。');
      return { state: next.state ?? null, version: next.version };
    } : undefined} />;
    else if (element.type === 'document') content = <DocumentRegion element={element} artifactId={board.artifact.id} actor={actor} client={client} canEdit={canEdit && !preview} canAnnotate={canAnnotate && !preview} interactive={reading ? reading.ids.includes(element.id) : interactiveId === element.id} expanded={!!reading && reading.ids.length === 1 && reading.ids[0] === element.id} focusHost={viewportElement.current} theme={viewTheme} readingZoom={viewport.zoom} editRequest={documentEditRequest?.id === element.id ? documentEditRequest.sequence : undefined} target={annotationTarget} onInteract={active => { setInteractiveId(active ? element.id : null); if (active) setTool('select'); }} onExpand={() => { selectIds([element.id]); void readSelection(); }} onExit={exitReading} onFocusSurface={surface => { if (surface || documentFocusSurface.current?.id === element.id) documentFocusSurface.current = surface; }} onActivity={state => setDocumentActivities(previous => { if (JSON.stringify(previous[element.id]) === JSON.stringify(state)) return previous; return { ...previous, [element.id]: state }; })} onSave={async (document, title, base, overwrite) => {
      if (overwrite) queue.discardFor([element.id]);
      const operations: Operation[] = [];
      const blocks = documentOperations(base.document ?? defaultDocument(), document);
      if (blocks.length) operations.push({ op: 'document', id: element.id, data: { operations: blocks } });
      if (title !== base.text) operations.push({ op: 'update', id: element.id, changes: { text: title } });
      if (!operations.length) return base;
      const failed = queue.tasks.find(task => task.state === 'failed' && task.keys.includes(element.id));
      if (failed && JSON.stringify(failed.operations) !== JSON.stringify(operations)) throw new Error('前次文档草稿尚未保存，请先比较最新内容后保存。');
      const saved = failed ? (await queue.retry(failed.id))?.board : await apply(operations, '编辑文档', [base]);
      return saved?.elements.find(item => item.id === element.id) ?? false;
    }} onAnnotate={(anchor, version, screenPoint) => { selectIds([element.id]); onAnnotateNative?.({ anchor, label: '文档选区 · ' + (element.text || '文档'), versions: { [element.id]: version }, screenPoint }); }} />;
    else if (element.type === 'stroke') {
      content = <svg className="studio-stroke-svg" overflow="visible" aria-hidden="true"><path d={strokePath(element.points)} fill="none" stroke={lineColor} strokeWidth={Number(element.strokeWidth ?? element.width ?? 3)} strokeDasharray={element.dash ? '6 5' : undefined} strokeLinecap="round" strokeLinejoin="round" /></svg>;
    } else if (element.type === 'image') {
      const src = assetDisplayUrl(element.src, client), video = assetDisplayUrl(element.video, client), href = safeHttpLink(element.href);
      const mediaState = client.assetState?.(element.video || element.src || '');
      const unavailable = Boolean(element.video && !video || !element.video && !src);
      content = <>{video ? <video src={video} controls preload="metadata" playsInline poster={src} data-native-interactive="true" /> : src ? <><CroppedImage element={element} src={src} />{href && <a className="studio-image-link" href={href} target="_blank" rel="noopener noreferrer" aria-label="打开图片链接" data-native-interactive="true"><ExternalLink size={16} /></a>}</> : null}
        {unavailable && <div className="studio-media-missing studio-media-state" role={mediaState?.status === 'error' ? 'alert' : 'status'}>{mediaState?.status === 'loading' ? '正在加载媒体…' : mediaState?.status === 'error' ? mediaState.message || '媒体加载失败。' : '无法读取媒体'}</div>}</>;
    } else if (element.type === 'table') content = <NativeTable bodyPaint={{background:viewStyle.paper,color:ink}} headerPaint={{background:fill,color:headerInk}} key={queueScope+':'+element.id+':'+draftGeneration} initialDraft={preview?undefined:tableDrafts[element.id]} onDraftChange={draft=>setTableDrafts(current=>{const next={...current};if(draft)next[element.id]=draft;else delete next[element.id];return next;})} element={element} selected={picked && !reading && tool==='select' && !spacePan && gesture?.kind!=='pan'} viewport={viewport} editRequest={tableEditRequest?.id===element.id?tableEditRequest.sequence:undefined} canEdit={canEdit && !reading && !annotating && tool==='select' && !spacePan} onRequestLink={value=>setLinkRequest({key:newClientId(),value})} onFormatStateChange={setFormatState} onEditingChange={active=>setPropertyEditingIds(ids=>active?[...new Set([...ids,element.id])]:ids.filter(id=>id!==element.id))} onSave={async(changes,base)=>{const failed=queue.tasks.find(task=>task.state==='failed'&&JSON.stringify(task.operations)===JSON.stringify([{op:'update',id:element.id,changes}]));const saved=failed?(await queue.retry(failed.id))?.board:await apply([{op:'update',id:element.id,changes}],'编辑表格',[base]);return saved?.elements.find(item=>item.id===element.id)??false;}}/>;
    else if (element.type === 'link') content = <div className="studio-link-card" style={{ background: element.fill ?? '#ffffff' }}><Link size={22} /><div><strong>{element.text || '链接'}</strong><span>{element.href}</span></div><a href={safeHttpLink(element.href)} target="_blank" rel="noreferrer" aria-label="打开链接" data-native-interactive="true"><ExternalLink size={17} /></a></div>;
    else if (element.type === 'sticker' && getBoardSticker(element.data?.stickerIconId)) content = <Sticker id={element.data?.stickerIconId} />;
    else if (element.type === 'container') content = <div className="studio-section-title">{editing?.id === element.id ? renderTextEditor(element) : <RichText text={element.text} />}</div>;
    else content = <>{element.type === 'shape' && <Shape element={{ ...element, fill, stroke: lineColor }} />}{element.type === 'note' && <div className="studio-note-fill" style={{ background: fill }} />}<div className={`studio-element-text${element.type === 'sticker' ? ' studio-sticker-text' : ''}`} style={{ padding: element.type === 'text' || element.type === 'sticker' ? 2 : 16, ...(element.kind === 'person' ? { top: '39%', paddingTop: 4 } : {}) }}>{editing?.id === element.id ? renderTextEditor(element) : <RichText text={element.text} />}</div></>;
    return <div key={element.id} className={`studio-board-element studio-element-${element.type}${picked ? ' is-selected' : ''}${element.locked ? ' is-locked' : ''}${editing?.id === element.id ? ' is-editing' : ''}`} data-element-id={element.id} style={style} onClickCapture={event=>{if(annotating){event.preventDefault();event.stopPropagation();}}} onPointerDown={(event) => begin(event, element)} onDoubleClick={(event) => {
      if (reading || annotating || (event.target as HTMLElement).closest('[data-native-interactive]')) return;
      event.stopPropagation();
      if (element.type === 'html' || element.type === 'diagram' && typeof element.html === 'string') { setInteractiveId(element.id); return; }
      if (element.type === 'document') { setInteractiveId(element.id); if (canEdit) setDocumentEditRequest(value => ({ id: element.id, sequence: (value?.sequence ?? 0) + 1 })); return; }
      if (!canEdit) return;
      if (element.type === 'link') setDialog({ type: 'link', element });
      else if (element.type === 'image' && element.src && !element.video && !element.locked) setCropDialog(element);
      else if (element.type === 'table') setTableEditRequest(current => ({ id: element.id, sequence: (current?.sequence ?? 0) + 1 }));
      else if (!['html', 'document', 'image', 'stroke', 'diagram', 'chart'].includes(element.type) && !(element.type === 'sticker' && getBoardSticker(element.data?.stickerIconId))) beginEditing(element);
    }}>
      {content}
      {element.type === 'html' && <div className="studio-html-caption" style={{ bottom: 'calc(100% + 10px)', width: element.w }}><strong>{element.text || 'HTML 图解'}</strong><span>图解</span></div>}
    </div>;
  };

  function renderTextEditor(element: BoardElement) {
    return <InlineTextEditor key={element.id} ref={textEditor} className="studio-inline-editor" value={editing?.text??''} disabled={!canEdit} style={{fontWeight:400,fontStyle:'normal'}} singleLine={['container','arrow'].includes(element.type)} ariaLabel={element.type==='arrow'?'连接线文字':'编辑文字'} onChange={text=>setEditing(current=>({id:element.id,text,base:current?.base??element,initialText:current?.initialText}))} onFormatStateChange={setFormatState} onRequestLink={value=>setLinkRequest({key:newClientId(),value})} onCommit={adjacent=>{void commitEditing(adjacent);}} />;
  }
  const comparingTask = queue.tasks.find(task => task.id === comparison) ?? detachedTask;
  const dialogPortalRoot = viewportElement.current?.closest<HTMLElement>('.studio-session-content') ?? viewportElement.current?.closest<HTMLElement>('.studio') ?? null;
  const forgetDraft = (task: ContentTask) => {
    if (task.strictVersions) {
      queue.discard(task.id); setComparison(null); setDetachedTask(null); setError(''); return;
    }
    queue.discardFor(task.keys);
    setEditing(value => value && task.keys.includes(value.id) ? null : value);
    setPropertyDrafts(value => Object.fromEntries(Object.entries(value).filter(([id]) => !task.keys.includes(id))));
    setTableDrafts(value => Object.fromEntries(Object.entries(value).filter(([id]) => !task.keys.includes(id))));
    setDraftGeneration(value => value + 1); setComparison(null); setDetachedTask(null); setError('');
  };
  const inspectDetached = (base: BoardElement, changes: Partial<BoardElement>) => {
    setComparisonBoard(boardRef.current);
    setDetachedTask({ id: newClientId('draft'), keys: [base.id], before: boardRef.current, sources: [base], operations: [{ op: 'update', id: base.id, changes }], summary: '未保存的草稿', remember: true, state: 'failed' });
  };
  const overwriteDraft = async (task: ContentTask) => {
    if (!canEditRef.current) return;
    if (task.strictVersions) { setError('整理结果需要重新核对依据，请重新选择目标并整理；流程排布请先重新预览。'); return; }
    const current = comparisonBoard ?? boardRef.current;
    const operations = task.operations.map(operation => {
      const base = task.sources.find(element => element.id === operation.id);
      if (operation.op !== 'update' || !base || current.elements.some(element => element.id === operation.id)) return operation;
      const element = { ...base, ...operation.changes, id: newId() }; delete (element as Partial<BoardElement>).version;
      return { op: 'add' as const, id: element.id, element };
    });
    queue.discard(task.id); setComparison(null); setDetachedTask(null);
    const saved = await apply(operations, '应用已比较的草稿', current.elements);
    if (saved) forgetDraft(task);
  };

  const selectionBounds = nativeSelectionBounds(renderedElements,selection);
  const selectionElement=selected&&renderedElements.find(element=>element.id===selected.id);
  const commentTarget=annotationTarget??localAnnotationTarget;
  const nativeCommentIds = commentTarget && !commentTarget.regionId && commentTarget.coordinateSpace !== 'html' ? commentTarget.elementIds ?? [] : [];
  const nativeCommentElement = nativeCommentIds.length === 1 ? renderedElements.find(element => element.id === nativeCommentIds[0] && element.type !== 'arrow' && element.type !== 'stroke') : undefined;
  // Highlight the subject independently of the point anchor used by the pin and composer.
  const commentBounds = !commentTarget || commentTarget.regionId || commentTarget.coordinateSpace === 'html' ? null : nativeCommentElement ?? (nativeCommentIds.length ? nativeSelectionBounds(renderedElements, nativeCommentIds) : anchorBounds(commentTarget, renderedElements));
  const annotationHover = annotating && !gesture ? renderedElements.find(element => element.id === annotationHoverId) : undefined;
  const annotationHoverBounds = annotationHover && (annotationHover.type === 'arrow' || annotationHover.type === 'stroke' ? geometryBounds(annotationHover, renderedElements) : annotationHover);
  const annotateSelected = async () => {
    const ids = [...selectionRef.current];
    const unchangedBase=editing&&editing.text===(editing.initialText??((editing.base?.type==='arrow'?editing.base.label:editing.base?.text)??''))?editing.base:undefined;
    if (!ids.length) return;
    if (editing && ids.includes(editing.id) && !await commitEditing()) return;
    if (ids.some(id => draftsRef.current[id]) && !await savePropertyDrafts(ids)) return;
    const elements = boardRef.current.elements.filter(element => ids.includes(element.id)).map(element=>unchangedBase?.id===element.id?unchangedBase:element);
    const bounds = nativeSelectionBounds(boardRef.current.elements, ids);
    if (!elements.length || !bounds) return;
    const element = elements.length === 1 ? elements[0] : undefined;
    const host = viewportElement.current?.getBoundingClientRect();
    const view = viewportRef.current;
    const corner = visibleCommentCorner(bounds, view, host ?? { width: window.innerWidth, height: window.innerHeight });
    const relative = element && relativeElementPoint(elementBounds(element, boardRef.current.elements) as BoardElement, corner);
    const anchor: Anchor = relative ? { elementIds: ids, coordinateSpace: 'element', ...relative } : { elementIds: ids, coordinateSpace: 'board', ...corner };
    const attached = anchorBounds(anchor, boardRef.current.elements)!;
    const point = { x: (host?.left ?? 0) + attached.x * view.zoom + view.x, y: (host?.top ?? 0) + attached.y * view.zoom + view.y };
    onAnnotateNative?.({ anchor, label: element ? `${element.type === 'note' ? '便签' : element.type === 'container' ? '分区' : '对象'} · ${(element.text || element.label || element.type).slice(0, 100)}` : `${elements.length} 个对象`, versions: Object.fromEntries(elements.map(element => [element.id, element.version])), screenPoint: point });
  };
  const formatText = (format: 'bold' | 'italic' | 'list' | 'link' | 'numbered', value?: string) => {
    const cell=viewportElement.current?.querySelector('.studio-native-table [contenteditable="true"]');if(cell){cell.closest('.studio-native-table')?.dispatchEvent(new CustomEvent('studio-table-format',{detail:{format:format==='list'?'bullets':format,url:value}}));return;}
    if(editing){textEditor.current?.format(format==='list'?'bullets':format,value);return;}
    if(format==='bold'||format==='italic'){void updateSelected({[format]:!selectedElements.every(element=>element[format])});return;}
    if (!selected) return;
    const text = (selected.type === 'arrow' ? selected.label : selected.text) ?? '';
    const next = format === 'link' ? `[${text || '链接'}](${value})` : text.split('\n').every(line => /^- /.test(line)) ? text.replace(/^- /gm, '') : text.replace(/^(?!- )/gm, '- ');
    void updateSelected(selected.type === 'arrow' ? { label: next } : { text: next }, '设置文字格式');
  };

  return <div className={`studio-whiteboard${saving ? ' is-saving' : ''}${reading ? ' is-reading' : ''}`} data-tool={spacePan||gesture?.kind==='pan'?'pan':annotating ? 'annotate' : tool} style={{ '--studio-ink': viewStyle.ink, '--studio-accent': viewStyle.accent, '--studio-link': viewStyle.link, '--canvas-paper': viewStyle.paper, '--canvas-scale': viewport.zoom, '--canvas-comment-cursor': COMMENT_CURSOR, '--canvas-pen-cursor':PEN_CURSOR } as CSSProperties}
    onCopy={(event) => {
      if ((event.target as HTMLElement).closest('input,textarea,[contenteditable="true"]') || !selectionRef.current.length) return;
      const ids = expandMoveIds(boardRef.current.elements, selectionRef.current);
      const elements = structuredClone(boardRef.current.elements.filter((element) => ids.includes(element.id)));
      clipboard.current = elements;
      event.clipboardData.setData('application/x-agentero-studio', JSON.stringify(elements));
      event.clipboardData.setData('text/plain', elements.map((element) => element.text ?? element.label ?? '').filter(Boolean).join('\n'));
      event.preventDefault();
    }}
    onPaste={(event) => {
      if (reading || !canEdit || (event.target as HTMLElement).closest('input,textarea,[contenteditable="true"]')) return;
      if (event.clipboardData.files.length) { event.preventDefault(); void uploadMedia(event.clipboardData.files); return; }
      const plainPayload=event.clipboardData.getData('text/plain');
      const encoded = event.clipboardData.getData('application/x-agentero-studio') || (plainPayload.startsWith(CLIPBOARD_PREFIX)?plainPayload.slice(CLIPBOARD_PREFIX.length):'');
      if (encoded && encoded.length < 8 * 1024 * 1024) {
        try {
          const elements: unknown = JSON.parse(encoded);
          if (Array.isArray(elements) && elements.length <= 200 && elements.every((element) => element && typeof element.id === 'string' && typeof element.type === 'string' && ['shape', 'container', 'text', 'stroke', 'arrow', 'image', 'html', 'document', 'table', 'link', 'note', 'sticker'].includes(element.type))) {
            event.preventDefault(); void addElements(duplicateElements(elements, elements.map((element) => element.id)), '粘贴元素'); return;
          }
        } catch { /* A non-Studio clipboard falls through to plain text. */ }
      }
      const text = event.clipboardData.getData('text/plain');
      if (text.trim() && text.length <= 20000) { event.preventDefault(); void addElements([makeElement('text', centerPoint(), { text, w: 380, h: Math.max(70, Math.min(600, text.split('\n').length * 30)) })], '粘贴文字'); }
    }}>
    {reading && <><div className={`studio-reading-hint${readingHint && !readingMarker ? ' is-visible' : ''}`} role="status">全屏观看 · 按 <kbd>Esc</kbd> 退出</div><button ref={readingExit} type="button" className="studio-reading-exit" aria-label="退出全屏观看" title="退出全屏观看（Esc）" onClick={exitReading}><X size={18}/><span>退出全屏</span><kbd>Esc</kbd></button><ReadingControls zoom={viewport.zoom} onZoom={setReadingZoom} onFit={fitReadingContent} markerMode={readingMarker} onMarkerModeChange={setReadingMarker} onClear={() => setReadingClearRevision(value => value + 1)} onCanvasFocus={() => viewportElement.current?.focus({ preventScroll: true })} onInteract={() => setReadingHint(false)} /></>}
    <div className="studio-canvas-top-tools" hidden={Boolean(reading)} data-native-interactive="true">
      {documentControls}
      {documentControls && <span className="studio-tool-divider" />}
      <button type="button" className="studio-zoom-value" aria-label="缩放菜单" aria-expanded={zoomMenu} title="缩放与视图" onClick={() => setZoomMenu(value => !value)}>{Math.round(viewport.zoom * 100)}%<ChevronDown size={14} /></button>
      {zoomMenu && <div className="studio-zoom-menu" role="menu" aria-label="缩放与视图">
        <div className="studio-zoom-steps"><button type="button" aria-label="缩小" onClick={() => stepZoom(1 / 1.2)}><Minus size={16} /></button><span>{Math.round(viewport.zoom * 100)}%</span><button type="button" aria-label="放大" onClick={() => stepZoom(1.2)}><Plus size={16} /></button></div>
        {[25, 50, 75, 100, 150, 200].map(value => <button type="button" role="menuitem" key={value} onClick={() => { stepZoom(value / 100 / viewport.zoom); setZoomMenu(false); }}>{value}%</button>)}
        <button type="button" role="menuitem" onClick={() => { fit('all'); setZoomMenu(false); }}><Maximize size={15} />适应白板</button><button type="button" role="menuitem" disabled={!selection.length} onClick={() => { fit('selection'); setZoomMenu(false); }}><Maximize size={15} />适应选区</button>
        <hr /><button type="button" role="menuitem" aria-label="撤销" disabled={!canEdit || queueSaving || !undo.length} onClick={() => void changeHistory('undo')}><RotateCcw size={15} />撤销<span>⌘/Ctrl Z</span></button><button type="button" role="menuitem" aria-label="重做" disabled={!canEdit || queueSaving || !redo.length} onClick={() => void changeHistory('redo')}><Redo2 size={15} />重做</button>
        <details><summary>视图设置</summary><label><input type="checkbox" checked={showGrid} onChange={event => setShowGrid(event.target.checked)} />显示网格</label><label><input type="checkbox" checked={singleKeys} onChange={event=>setSingleKeys(event.target.checked)}/>数字工具快捷键</label></details>
      </div>}
    </div>
    <div ref={viewportElement} className="studio-canvas-viewport" tabIndex={0} aria-label="白板画布" onPointerDownCapture={captureNavigation} onClickCapture={event => { const blocked = navigationClick.current; navigationClick.current = false; if (blocked && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); } }} onAuxClick={event => { if (event.button === 1) event.preventDefault(); }} onPointerDown={(event) => { if (!(event.target as HTMLElement).closest('[data-native-interactive]')) { setToolMenu(null); setZoomMenu(false); } begin(event); }} onDoubleClick={event => { if (reading || !canEdit || annotating || tool !== 'select' || editing || dialog || (event.target as HTMLElement).closest('[data-element-id],[data-native-interactive]')) return; updateGesture(null); void addElements([makeElement('text', boardPoint(event.clientX, event.clientY), { text: '' })], '添加文字', { edit: true }); }} onPointerMove={move} onPointerLeave={()=>{setPointer(null);setAnnotationHoverId(null);onCursorMove?.(null);}} onPointerUp={finish} onPointerCancel={cancelGesture} onLostPointerCapture={()=>{if(gestureRef.current)cancelGesture();}} onContextMenu={event=>{if(reading){event.preventDefault();return;}if((event.target as HTMLElement).closest('[data-native-interactive]'))return;event.preventDefault();const id=(event.target as HTMLElement).closest('[data-element-id]')?.getAttribute('data-element-id');if(id&&!selectionRef.current.includes(id))selectIds([id]);openMenu({x:event.clientX,y:event.clientY});}} onDragOver={(event) => { if (!reading && canEdit && event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); if(reading)return; void uploadMedia(event.dataTransfer.files, boardPoint(event.clientX, event.clientY)); }} style={{ cursor: gesture?.kind === 'pan' ? 'grabbing' : undefined, backgroundPosition: `${viewport.x}px ${viewport.y}px`, backgroundSize: `${24 * viewport.zoom}px ${24 * viewport.zoom}px`, ...(!showGrid || reading ? { backgroundImage: 'none' } : {}) }}>
      {reading && <ReadingMarker viewport={viewport} active={readingMarker} scopeKey={`${queueScope}:${reading.ids.join(',')}:${readingBoundsKey}`} clearRevision={readingClearRevision} navigationActive={spacePan || gesture?.kind === 'pan'} />}
      <div className="studio-canvas-world" style={{ transform: `translate(${viewport.x}px,${viewport.y}px) scale(${viewport.zoom})` }}>
        {renderedElements.map(renderElement)}
        {!preview && mediaUpload && mediaUpload.placeholders.map((placeholder,index)=>{const element=mediaUpload.elements[index]??placeholder;return <div key={`upload-${placeholder.id}`} data-upload-placeholder={placeholder.id} data-upload-phase={mediaUpload.phase} style={{position:'absolute',left:element.x,top:element.y,width:element.w,height:element.h,border:`${1/viewport.zoom}px dashed var(--studio-accent)`,background:mediaUpload.phase==='uploading'?'color-mix(in srgb, var(--canvas-ui) 85%, transparent)':undefined,pointerEvents:'none',zIndex:73}}><div style={{position:'absolute',left:8/viewport.zoom,top:8/viewport.zoom,transform:`scale(${1/viewport.zoom})`,transformOrigin:'left top',padding:'6px 8px',borderRadius:5,background:'var(--canvas-ui)',color:'var(--canvas-ui-text)',font:'12px/1.5 Arial,"Microsoft YaHei",sans-serif',maxWidth:280}}>{mediaUpload.phase!=='failed'&&<Loader2 size={13} className="studio-spin" aria-hidden="true"/>} {mediaUpload.phase==='uploading'?'正在上传':mediaUpload.phase==='queued'?'正在加入白板':'尚未加入白板'} · {mediaUpload.files[index]!.name}{mediaUpload.phase==='failed'&&index===0&&<div data-native-interactive="true" style={{pointerEvents:'auto'}} onPointerDown={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()}><p role="alert">{mediaUpload.error}</p><button type="button" className="studio-button" disabled={!canEdit} onClick={()=>{const batch=mediaUploadRef.current;if(batch)void runMediaUpload(batch);}}>重试加入白板</button><button type="button" className="studio-button" onClick={()=>{const batch=mediaUploadRef.current;if(batch){batch.abort.abort();queue.discardFor(batch.placeholders.map(element=>element.id));finishUpload(batch);setError('');}}}>移除上传草稿</button></div>}</div></div>;})}
        {peerPreviewFrames.map(({peer,bounds}) => { const page = presence.find(page => page.peerId === peer.peerId), color = participantColor(peer.actor, page?.color); return <div key={`${peer.peerId}:${peer.id}`} aria-label={`${peer.actor.name}${peer.kind === 'upload' ? '正在上传' : '正在调整对象'}`} style={{ position: 'absolute', left: bounds.x, top: bounds.y, width: bounds.w, height: bounds.h, border: `${1 / viewport.zoom}px dashed ${color}`, pointerEvents: 'none' }}><span style={{ position: 'absolute', bottom: '100%', fontSize: 12 / viewport.zoom, whiteSpace: 'nowrap', color: readableText(color), background: color }}>{peer.actor.name} · {peer.kind === 'upload' ? '正在上传…' : '正在调整'}</span></div>; })}
        {pointer && !gesture && !editing && !annotating && canEdit && ['text','shape','note','container','table','sticker'].includes(tool) && <div className="studio-placement-ghost" aria-hidden="true">{renderElement(makeElement(tool as ElementType,pointer,{id:'placement-ghost',text:tool==='text'?'文字':'',...(tool==='shape'?{kind:shapeKind}:{}),...(tool==='sticker'?{text:getBoardSticker(sticker)?.label,data:{stickerIconId:sticker}}:{})}))}</div>}
        {!reading && selectionBounds && selection.length>0 && (selected?.type!=='arrow'||annotating||selected.locked) && (annotating || tool==='select' && !spacePan && gesture?.kind!=='pan') && (!editing || selected?.id===editing.id && ['text','note'].includes(selected.type)) && <SelectionChrome bounds={selectionElement&&selectionElement.rotation?{x:selectionElement.x,y:selectionElement.y,w:selectionElement.w,h:selectionElement.h}:selectionBounds} rotation={selectionElement?.rotation??0} zoom={viewport.zoom} locked={annotating || !canEdit || selectedElements.some(element=>element.locked)} resizable={selectedElements.some(element=>!['arrow','link'].includes(element.type))} rotatable={selectedElements.every(element=>element.type==='arrow'||ROTATABLE_TYPES.has(element.type))} edges={selected?.type==='text'?['w','e']:selectedElements.some(element=>element.type==='image')||selected?.type==='sticker'||selection.length>1&&selectedElements.some(element=>element.rotation)?[]:undefined} onResize={resizeBegin} onRotate={rotateBegin}/>}
        {!reading && selected && canEdit && !annotating && tool==='select' && !spacePan && !editing && !gesture && canShowConnectionPorts(selected,viewport.zoom) && <ConnectionPorts element={selected} zoom={viewport.zoom} onBegin={connectBegin}/>}
        {!reading && selected?.type==='arrow' && canEdit && !selected.locked && !annotating && tool==='select' && !spacePan && !editing && (()=>{const points=arrowGeometry(selected,renderedElements).points;return points.map((point,index)=><button type="button" key={`arrow-handle-${index}`} className="studio-arrow-handle" aria-label={index===0?'连接线起点位置':index===points.length-1?'连接线终点位置':`连接线折点 ${index}`} style={{left:point.x,top:point.y,width:10/viewport.zoom,height:10/viewport.zoom,borderWidth:1.5/viewport.zoom}} onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();viewportElement.current?.setPointerCapture(event.pointerId);updateGesture({kind:'arrow-point',start:boardPoint(event.clientX,event.clientY),element:selected,end:index===0?'from':index===points.length-1?'to':'bends',bendIndex:index-1,points,operations:[]});}}/>);})()}
        {annotationHoverBounds && <div className="studio-annotation-hover" data-annotation-hover={annotationHover!.id} aria-hidden="true" style={{ left: annotationHoverBounds.x, top: annotationHoverBounds.y, width: annotationHoverBounds.w, height: annotationHoverBounds.h, borderWidth: 2 / viewport.zoom, transform: annotationHover!.type !== 'stroke' && annotationHover!.rotation ? `rotate(${annotationHover!.rotation}deg)` : undefined }} />}
        {commentBounds && <div className="studio-current-comment-target" data-comment-target="true" aria-hidden="true" style={{left:commentBounds.x,top:commentBounds.y,width:Math.max(commentBounds.w,12/viewport.zoom),height:Math.max(commentBounds.h,12/viewport.zoom),borderWidth:2/viewport.zoom,transform:nativeCommentElement?.rotation?`rotate(${nativeCommentElement.rotation}deg)`:undefined}}/>}
        {guides.map((guide,index)=><div key={index} className="studio-snap-guide" style={guide.axis==='x'?{left:guide.at,top:guide.from,height:guide.to-guide.from,width:1/viewport.zoom}:{top:guide.at,left:guide.from,width:guide.to-guide.from,height:1/viewport.zoom}}/>)}
        {activities.filter(activity => activity.status === 'processing').map(activity => {
          const area = (activity.anchor as typeof activity.anchor & { area?: Rect }).area;
          const frame = area ?? anchorBounds(activity.anchor, renderedElements);
          if (!frame) return null;
          return <div key={activity.id} className="studio-processing-frame" data-feedback-id={activity.id} role="status" aria-label={`${activity.processingBy?.name || 'Codex'} 正在处理此范围`} style={{ left: frame.x - 8, top: frame.y - 8, width: frame.w + 16, height: frame.h + 16, borderWidth: 1.5 / viewport.zoom }}><span style={{ transform: `scale(${1 / viewport.zoom})` }}>{activity.processingBy?.name || 'Codex'} 正在处理</span></div>;
        })}
        {activities.map((feedback, index) => {
          const area = anchorBounds(feedback.anchor, renderedElements);
          if (!area) return null;
          const positioned = Number.isFinite(feedback.anchor.x) && Number.isFinite(feedback.anchor.y);
          return <button type="button" key={`pin-${feedback.id}`} className={`studio-feedback-pin${feedback.status === 'resolved' ? ' is-resolved' : ''}`} data-feedback-pin={feedback.id} data-native-interactive="true" aria-label={`备注 ${index + 1}：${feedback.text.slice(0, 80)}`} title={feedback.text} style={{ left: area.x + (positioned ? 0 : area.w), top: area.y, transform: `translate(-50%,-50%) scale(${1 / viewport.zoom})` }} onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); onFeedbackSelect?.(feedback, { x: rect.right + 8, y: rect.top }); }}>{index + 1}</button>;
        })}
        <PeerPresenceOverlay peers={presence} geometryTargets={peerPreviewFrames.filter(({peer})=>peer.kind!=='upload').map(({peer})=>({peerId:peer.peerId,elementIds:peer.elements.map(element=>element.id)}))} elements={renderedElements} artifactId={board.artifact.id} selfActorId={actor.id} zoom={viewport.zoom} clockOffsetMs={clockOffsetMs} preview={preview} onReleaseAgentTask={onReleaseAgentTask} />
        {(gesture?.kind === 'marquee' || gesture?.kind === 'annotate') && <div className="studio-marquee" style={{ left: Math.min(gesture.start.x, gesture.end.x), top: Math.min(gesture.start.y, gesture.end.y), width: Math.abs(gesture.end.x - gesture.start.x), height: Math.abs(gesture.end.y - gesture.start.y), borderWidth: 1 / viewport.zoom }} />}
      </div>
      {!board.elements.length && !gesture && <div className="studio-canvas-empty"><div className="studio-empty-symbol"><Square size={27} /><Circle size={25} /><ArrowUpRight size={24} /></div><strong>从一个想法开始</strong><p>{canEdit ? '添加文字、便签或图形，也可以导入 HTML 图解。' : '这块白板还没有内容。'}</p>{canEdit && <button type="button" data-native-interactive="true" onClick={() => void openHtmlEditor()}><Braces size={16} />添加 HTML 图解</button>}</div>}
    </div>
    <div className="studio-canvas-toolbar" hidden={Boolean(reading)} role="toolbar" aria-label="白板工具" data-native-interactive="true">
      {TOOL_OPTIONS.map(({ tool: choice, label, key, icon: Icon }) => <button type="button" key={choice} aria-label={label} aria-keyshortcuts={key} title={`${label}（${key}）`} aria-pressed={!annotating && (choice === tool || choice === 'stroke' && tool === 'arrow' || choice === 'shape' && tool === 'table')} className={!annotating && (choice === tool || choice === 'stroke' && tool === 'arrow' || choice === 'shape' && tool === 'table') ? 'is-active' : ''} onClick={() => { void chooseTool(choice==='stroke'?lastDrawTool:choice==='shape'?lastShapeTool:choice, ['shape', 'sticker'].includes(choice) && toolMenu!==choice ? choice as 'shape' | 'sticker' : null); }} disabled={!canEdit && !['select', 'pan'].includes(choice)}>{choice==='stroke'&&lastDrawTool==='arrow'?<ArrowUpRight size={20}/>:choice==='shape'&&lastShapeTool==='table'?<Table2 size={20}/>:choice==='shape'?<span className="studio-tool-shape-glyph"><Shape element={makeElement('shape',{x:0,y:0},{w:24,h:20,kind:shapeKind,fill:'transparent',stroke:viewStyle.ink})}/></span>:<Icon size={20}/>} {['shape', 'stroke'].includes(choice) && <ChevronDown size={9} className="studio-tool-caret" />}</button>)}
    </div>
    {toolMenu === 'shape' && canEdit && <div className="studio-shape-options studio-insert-menu" data-native-interactive="true"><div className="studio-shape-grid">{SHAPES.map(([kind,label])=><button type="button" key={kind} aria-label={`形状 ${label}`} title={label} aria-pressed={shapeKind===kind && tool==='shape'} onClick={()=>{setShapeKind(kind);void chooseTool('shape','shape');}}><Shape element={makeElement('shape',{x:0,y:0},{w:64,h:48,kind,fill:'transparent',stroke:viewStyle.ink})}/></button>)}</div><button type="button" onClick={()=>{void chooseTool('table');}}><Table2 size={17}/>表格</button><button type="button" onClick={()=>{setDialog({type:'link'});setToolMenu(null);}}><Link size={17}/>链接</button><button type="button" onClick={()=>{void openHtmlEditor();setToolMenu(null);}}><Braces size={17}/>HTML 图解</button><button type="button" aria-label="添加文档区域" onClick={() => { setToolMenu(null); const element = makeElement('document', centerPoint(), { document: defaultDocument(newClientId('block')) }); void addElements([element], '添加文档区域').then(saved => { if (saved) { selectIds([element.id]); setInteractiveId(element.id); setDocumentEditRequest(value => ({ id: element.id, sequence: (value?.sequence ?? 0) + 1 })); } }); }}><FileText size={17}/>文档</button></div>}
    {!annotating && (tool==='stroke'||tool==='arrow') && canEdit && <div className="studio-shape-options studio-pen-menu" role="toolbar" aria-label="绘图选项" data-native-interactive="true"><div className="studio-pen-choices"><button type="button" aria-label="画笔模式" title="画笔（6）" aria-pressed={tool==='stroke'} onClick={()=>{void chooseTool('stroke');}}><PenLine size={18}/></button><button type="button" aria-label="箭头模式" title="箭头" aria-pressed={tool==='arrow'} onClick={()=>{void chooseTool('arrow');}}><ArrowUpRight size={18}/></button></div><span className="studio-tool-divider"/><ColorPalette presetOnly theme={viewTheme} value={penColor} onChange={setPenColor}/></div>}
    {toolMenu === 'sticker' && canEdit && <StickerPalette selectedId={sticker} onSelect={choice => { setSticker(choice.id); void chooseTool('sticker'); }} onUpload={() => { fileInput.current?.click(); setToolMenu(null); }} />}
    {!reading && selectedElements.length > 0 && selectionBounds && !annotating && tool==='select' && !spacePan && gesture?.kind!=='pan' && <CanvasFormatToolbar key={selection.join(',')} elements={selectedElements} style={{ left: viewport.x + (selectionBounds.x + selectionBounds.w / 2) * viewport.zoom, top: clamp(viewport.y + selectionBounds.y * viewport.zoom - (selected?.type === 'html' ? 82 : 58), 12, Math.max(12, (viewportElement.current?.clientHeight || 600) - 145)) }} formatState={editing||selected?.type==='table'&&propertyEditingIds.includes(selected.id)?formatState:undefined} requestLink={linkRequest} customColors={customColors} onCustomColorsChange={saveCustomColors} theme={viewTheme} canEdit={canEdit} canAnnotate={canAnnotate} saving={queue.tasks.some(task=>task.state!=='failed'&&task.keys.some(id=>selection.includes(id)))} interactive={interactiveId === selected?.id} onChange={changes => { void updateSelected(changes); }} onEditText={() => { if (selected) beginEditing(selected); }} onTextFormat={formatText} onAnnotate={annotateSelected} onToggleInteractive={() => { if (selected) { setTool('select'); setInteractiveId(value => value === selected.id ? null : selected.id); } }} onReadSelection={() => { void readSelection(); }} onEditHtml={selected ? ()=>{void openHtmlEditor(selected);}:undefined} onEditDocument={selected?.type === 'document' ? () => { setInteractiveId(selected.id); setDocumentEditRequest(value => ({ id: selected.id, sequence: (value?.sequence ?? 0) + 1 })); } : undefined} onCrop={selected?.type==='image'&&selected.src&&!selected.video?()=>setCropDialog(selected):undefined} onAlign={edge=>{void apply(alignSelection(boardRef.current.elements,selectionRef.current,edge),'对齐元素');}} onArrange={() => { void openSelectionLayout('geometry'); }} onMore={openMenu} />}
    {menu && <CanvasActionsMenu point={menu} canEdit={canEdit} selected={selection.length} locked={selectedElements.some(element=>element.locked)} hasClipboard={Boolean(navigator.clipboard?.readText)} onCommand={command} onClose={()=>setMenu(null)}/>}
    <div aria-label="草稿与保存提示" style={{position:'absolute',bottom:87,left:18,maxWidth:'min(620px, calc(100% - 36px))',maxHeight:'45%',overflowY:'auto',display:'flex',flexDirection:'column',gap:8,zIndex:60}}>
    {(toolNotice || previewStatus) && <div role="status" style={{padding:'8px 12px',border:'1px solid var(--canvas-ui-border)',borderRadius:7,background:'var(--canvas-ui)',color:'var(--canvas-ui-text)'}}>{toolNotice || previewStatus}</div>}
    {previewError && <div role="alert" className="studio-canvas-error" style={{position:'relative',bottom:'auto',left:'auto'}}>{previewError}</div>}
    {(error || queue.tasks.some(task => task.state === 'failed')) && <div className="studio-canvas-error" style={{position:'relative',bottom:'auto',left:'auto',maxWidth:'none',flexWrap:'wrap'}} role="alert"><span>{error || '有尚未保存的草稿，请比较内容或重试。'}</span>{(emptyTextBlocked || failedEmptyTextDelete) && <button type="button" aria-label="取消本次文字编辑" onClick={cancelEmptyTextEdit}>取消本次文字编辑</button>}{queue.tasks.filter(task => task.state === 'failed').map(task => <span key={task.id}><button type="button" onClick={() => {setComparisonBoard(boardRef.current);setComparison(task.id);}}>比较双方内容</button><button type="button" disabled={!canEdit} onClick={() => queue.retry(task.id)}>重试原操作</button></span>)}<button type="button" aria-label="关闭错误提示" onClick={() => setError('')}><X size={16} /></button></div>}
    {!preview && recovered && <div className="studio-canvas-error" style={{position:'relative',bottom:'auto',left:'auto',maxWidth:'none',flexWrap:'wrap'}} role="status"><span>此白板有上次未保存的本机草稿。</span><button type="button" onClick={() => { setEditing(recovered.text ?? null); setPropertyDrafts(recovered.properties ?? {}); setTableDrafts(recovered.tables ?? {}); queue.restore(recovered.tasks ?? []); setDraftGeneration(value => value + 1); setRecovered(null); }}>恢复上次草稿</button><button type="button" onClick={() => void copyPlainText(JSON.stringify(recovered, null, 2)).catch(failure => setError(errorText(failure)))}>复制草稿</button><button type="button" onClick={() => void downloadStudioBlob(client, new Blob([JSON.stringify(recovered, null, 2)], { type: 'application/json' }), 'whiteboard-draft.json').catch(failure => setError(errorText(failure)))}>下载草稿副本</button><button type="button" onClick={() => { localStorage.removeItem(draftStorageKey); setRecovered(null); }}>放弃上次草稿</button></div>}
    {!preview && editing?.base && !board.elements.some(element => element.id === editing.id && element.type === editing.base?.type) && <div className="studio-canvas-error" style={{position:'relative',bottom:'auto',left:'auto',maxWidth:'none',flexWrap:'wrap'}} role="alert"><span>正在编辑的对象已被删除，文字草稿仍可恢复。</span><button type="button" onClick={() => inspectDetached(editing.base!, { [editing.base!.type === 'arrow' ? 'label' : 'text']: editing.text })}>查看并恢复文字草稿</button></div>}
    {!preview && Object.entries(tableDrafts).filter(([id]) => !board.elements.some(element => element.id === id && element.type === 'table')).map(([id, draft]) => <div className="studio-canvas-error" style={{position:'relative',bottom:'auto',left:'auto',maxWidth:'none',flexWrap:'wrap'}} role="alert" key={id}><span>正在编辑的表格已被删除，草稿仍可恢复。</span><button type="button" onClick={() => inspectDetached(draft.base, draft.changes)}>查看并恢复表格草稿</button></div>)}
    </div>
    {comparingTask && <ContentConflictDialog portalRoot={dialogPortalRoot} task={comparingTask} current={comparisonBoard ?? board} disabled={!canEdit} onKeep={() => { setComparison(null); setDetachedTask(null); }} onRemote={() => forgetDraft(comparingTask)} onOverwrite={() => void overwriteDraft(comparingTask)} onCopy={() => void copyPlainText(JSON.stringify(comparingTask.operations, null, 2)).catch(failure => setError(errorText(failure)))} />}
    {layoutMode && <SelectionLayoutDialog portalRoot={dialogPortalRoot} key={board.artifact.id} board={boardRef.current} ids={selection} client={client} initialMode={layoutMode} labelSizes={measureLayoutLabels} canEdit={canEdit} onApply={applyCalculatedLayout} onViewLayout={result => { const host = viewportElement.current, bounds = nativeSelectionBounds(boardRef.current.elements, [...result.affectedIds, ...selectionRef.current]); if (host && bounds) { viewportInteract.current?.(); setViewport(fitViewport([bounds], host.clientWidth, host.clientHeight, 72)); } }} onDiscardPreview={requestId => { const task = queue.tasks.find(item => item.id === requestId && item.state === 'failed'); if ((task?.failure as { code?: string } | undefined)?.code === 'CONFLICT') queue.discard(requestId); }} onError={message => { if (boardRef.current.artifact.id === board.artifact.id) setError(message); }} onClose={() => setLayoutMode(null)} />}
    <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,video/mp4,video/webm,video/quicktime" multiple hidden onChange={(event) => { void uploadMedia(event.target.files); event.currentTarget.value = ''; }} />
    <input ref={htmlInput} type="file" accept=".html,.htm,text/html" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then((html) => addElements([makeElement('html', centerPoint(), { html, text: file.name.replace(/\.html?$/i, '') })], '导入 HTML 图解')); event.currentTarget.value = ''; }} />
    {cropDialog && <ImageCropDialog element={cropDialog} src={assetDisplayUrl(cropDialog.src, client)!} onDirtyChange={setDialogDirty} onClose={() => { setCropDialog(null); setDialogDirty(false); }} onSave={async changes => {
      const saved = await apply([{ op: 'update', id: cropDialog.id, changes }], '裁剪图片', [cropDialog]);
      if (saved) { setCropDialog(null); setDialogDirty(false); }
    }} />}
    {dialog && <CanvasDialog dialog={dialog} onDirtyChange={setDialogDirty} onClose={() => { setDialog(null); setDialogDirty(false); }} onSave={async (data) => {
      const element = dialog.element;
      if (element) { const saved = await apply([{ op: 'update', id: element.id, changes: data }], '编辑元素', [element]); if (saved) { setDialog(null); setDialogDirty(false); } }
      else { const saved = await addElements([makeElement(dialog.type === 'sticker' ? 'sticker' : dialog.type, centerPoint(), data)], dialog.type === 'html' ? '添加 HTML 图解' : '添加元素'); if (saved) { setDialog(null); setDialogDirty(false); } }
    }} />}
  </div>;
}

function CanvasDialog({ dialog, onClose, onSave, onDirtyChange }: { dialog: Dialog; onClose: () => void; onSave: (data: Partial<BoardElement>) => Promise<void>; onDirtyChange: (dirty: boolean) => void }) {
  const modal = useRef<HTMLElement>(null);
  const [title, setTitle] = useState(dialog.element?.text ?? (dialog.type === 'html' ? 'HTML 图解' : dialog.type === 'link' ? '链接' : ''));
  const [value, setValue] = useState(dialog.type === 'table' ? tableRows(dialog.element ?? makeElement('table', { x: 0, y: 0 })).map((row) => row.join('\t')).join('\n') : dialog.type === 'link' ? dialog.element?.href ?? '' : dialog.type === 'sticker' ? '★' : dialog.element?.html ?? '');
  const [busy, setBusy] = useState(false);
  const close = useRef(() => {}); close.current = () => { if (!busy) onClose(); };
  useEffect(() => registerEscapeLayer(modal.current!, () => close.current(), 20), []);
  const originalValue = dialog.type === 'table' ? tableRows(dialog.element ?? makeElement('table', { x: 0, y: 0 })).map(row => row.join('\t')).join('\n') : dialog.type === 'link' ? dialog.element?.href ?? '' : dialog.type === 'sticker' ? dialog.element?.text ?? '★' : dialog.element?.html ?? '';
  useEffect(() => { onDirtyChange(!dialog.element || value !== originalValue || (['html', 'link'].includes(dialog.type) && title !== (dialog.element.text ?? ''))); }, [dialog.element, dialog.type, value, title, originalValue, onDirtyChange]);
  const valid = dialog.type === 'link' ? Boolean(safeHttpLink(value)) : Boolean(value.trim());
  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try { await onSave(dialog.type === 'html' ? { html: value, text: title || 'HTML 图解' } : dialog.type === 'table' ? { data: { ...dialog.element?.data, rows: value.split('\n').map((row) => row.split('\t')) } } : dialog.type === 'link' ? { href: value, text: title || new URL(value).hostname } : { text: value.slice(0, 12) }); } finally { setBusy(false); }
  };
  return <div className="studio-canvas-modal-backdrop" data-native-interactive="true" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={modal} className={`studio-canvas-modal${dialog.type === 'html' ? ' is-wide' : ''}`} role="dialog" aria-modal="true" aria-label={dialog.type === 'html' ? '添加 HTML 图解' : dialog.type === 'table' ? '编辑表格' : dialog.type === 'link' ? '添加链接' : '添加贴纸'}>
    <header><h2>{dialog.type === 'html' ? '添加 HTML 图解' : dialog.type === 'table' ? '表格内容' : dialog.type === 'link' ? '链接' : '贴纸'}</h2><button type="button" aria-label="关闭" onClick={onClose}><X size={18} /></button></header>
    {(dialog.type === 'html' || dialog.type === 'link') && <label>名称<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>}
    <label>{dialog.type === 'html' ? '粘贴 HTML 源码' : dialog.type === 'table' ? '每行一条记录，列之间用 Tab 分隔（可从电子表格粘贴）' : dialog.type === 'link' ? '网页地址' : '符号或简短文字'}{dialog.type === 'link' || dialog.type === 'sticker' ? <input autoFocus value={value} placeholder={dialog.type === 'link' ? 'https://' : '★'} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void save(); }} /> : <textarea className={dialog.type === 'html' ? 'studio-html-source-input' : ''} autoFocus rows={dialog.type === 'html' ? 14 : 8} value={value} placeholder={dialog.type === 'html' ? '<!doctype html>\n<html>…</html>' : ''} onChange={(event) => setValue(event.target.value)} />}</label>
    {dialog.type === 'html' && <p>图解在独立区域显示；通过批注让 Codex 修改，原始源码会随白板保存。</p>}
    <footer><button type="button" onClick={onClose}>取消</button><button type="button" className="studio-primary" disabled={!valid || busy} onClick={() => void save()}>{busy ? '正在保存…' : '保存到白板'}</button></footer>
  </section></div>;
}
