import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowUpRight, Braces, ChevronDown, Circle, Copy, ExternalLink, Frame, Group, Hand, Link, Lock, Maximize, MessageSquare, Minus, MousePointer2, PenLine, Plus, Redo2, RotateCcw, Smile, Square, StickyNote, Table2, Trash2, Type, Ungroup, Unlock, X } from 'lucide-react';
import type { Actor, Anchor, Board, BoardElement, ElementType, Feedback, HtmlSelection, Json, Operation, Presence, StudioClient } from '../../contracts/studio.js';
import { contrastRatio, readableText, semanticColor } from '../../core/theme.js';
import HtmlRegion from '../shared/html-region/HtmlRegion.js';
import { anchorBounds, arrowGeometry, arrowHeads, assetDisplayUrl, boundsOf, canvasStyle, clamp, duplicateElements, elementBounds, expandMoveIds, fitViewport, intersects, makeElement, moveOperations, newId, normalizedRect, relativeElementPoint, safeHttpLink, tableRows, zoomAt, type Point, type Rect, type Viewport } from './canvas-model.js';
import { shapePath, strokePath } from '../../core/products/whiteboard-geometry.js';
import { CroppedImage, ImageCropDialog } from './NativeMedia.js';
import { measureNativeIssues, type NativeIssue } from './native-issues.js';
import RichText from './RichText.js';
import Sticker from './Sticker.js';
import StickerPalette from './StickerPalette.js';
import { getBoardSticker } from '../../core/products/whiteboard-stickers.js';
import { COMMENT_CURSOR } from '../shared/comments/cursor.js';
import CanvasFormatToolbar from './CanvasFormatToolbar.js';
import CanvasActionsMenu, { type CanvasCommand } from './CanvasActionsMenu.js';
import ColorPalette from './ColorPalette.js';
import NativeTable from './NativeTable.js';
import SelectionChrome from './SelectionChrome.js';
import ConnectionPorts from './ConnectionPorts.js';
import { adjacentElement, canShowConnectionPorts, connectionAtPoint, connectionPoint, OPPOSITE_SIDE, ROTATABLE_TYPES, type ConnectionSide } from './selection-affordances.js';
import InlineTextEditor, { type InlineTextEditorHandle, type InlineTextFormatState } from './InlineTextEditor.js';
import { newClientId } from '../shared/client-id.js';
import { nativePaint, PEN_CURSOR } from './native-palette.js';
import { alignSelection, tidySelection, selectionBounds as nativeSelectionBounds, resizeBox, resizeElement, resizeSelection, rotateSelection, snapMove, type ResizeHandle, type AlignmentGuide } from './native-geometry.js';
import { copyPlainText } from '../clipboard.js';
import { studioRequest } from '../transport.js';
import './canvas.css';

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
  onCursorMove?: (point: Point) => void;
  externalViewport?: Viewport;
  externalSelectedIds?: string[];
  onActivityChange?: (state: { editingIds: string[]; movingIds: string[]; dirty: boolean; issues?: NativeIssue[] }) => void;
  activities?: Feedback[];
  annotationActive?: boolean;
  annotationTarget?: Anchor;
  onAnnotationModeChange?: (active: boolean) => void;
  onAnnotateNative?: (selection: NativeAnnotation) => void;
  onFeedbackSelect?: (feedback: Feedback, screenPoint: Point) => void;
  onOpenHtml?: (element: BoardElement) => void;
  onEditHtml?: (element?: BoardElement) => void;
  documentControls?: ReactNode;
}

export interface NativeAnnotation { anchor: Anchor; label: string; versions: Record<string, number>; screenPoint?: Point }

type Tool = 'select' | 'pan' | 'annotate' | 'shape' | 'note' | 'text' | 'container' | 'stroke' | 'arrow' | 'sticker' | 'table';
type Gesture =
  | { kind: 'pan'; start: Point; viewport: Viewport }
  | { kind: 'marquee'; start: Point; end: Point; additive: boolean }
  | { kind: 'annotate'; start: Point; end: Point; element?: BoardElement }
  | { kind: 'move'; start: Point; current: Point; ids: string[]; elements: BoardElement[]; copies?: BoardElement[]; dragging?: boolean }
  | { kind: 'resize'; start: Point; elements: BoardElement[]; ids: string[]; box: Rect; handle: ResizeHandle; operations: Operation[] }
  | { kind: 'rotate'; start: Point; elements: BoardElement[]; ids: string[]; box: Rect; operations: Operation[] }
  | { kind: 'arrow-point'; start: Point; element: BoardElement; end: 'from'|'to'|'bends'; bendIndex?:number; points?:Point[]; operations: Operation[] }
  | { kind: 'draw'; start: Point; points: Point[]; element: BoardElement; from?: string; straightStart?:Point; straightPoints?:Point[] }
  | { kind: 'connect'; start: Point; current: Point; element: BoardElement; side: ConnectionSide }
  | { kind: 'create'; start: Point; element: BoardElement };
interface Dialog { type: 'html' | 'table' | 'link' | 'sticker'; element?: BoardElement }
interface ChangeRecord { before: BoardElement[]; after: BoardElement[]; ids: string[]; summary: string; historyId?: string; snapshot?: boolean }

const SHAPES = [['rounded', '圆角矩形'], ['rect', '矩形'], ['ellipse', '椭圆'], ['diamond', '菱形'], ['pill', '胶囊'], ['hexagon', '六边形'], ['parallelogram', '平行四边形'], ['database', '数据库'], ['queue', '队列'], ['document', '文档'], ['cloud', '云'], ['person', '人物']] as const;
const CLIPBOARD_PREFIX = 'AGENTERO_STUDIO_ELEMENTS_V1\n';
const TOOL_OPTIONS: { tool: Tool; label: string; key: string; icon: typeof Square }[] = [
  { tool: 'select', label: '选择', key: 'V', icon: MousePointer2 }, { tool: 'pan', label: '平移', key: 'H', icon: Hand },
  { tool: 'text', label: '文字', key: 'T', icon: Type }, { tool: 'container', label: '分区', key: 'A', icon: Frame },
  { tool: 'note', label: '便签', key: 'S', icon: StickyNote }, { tool: 'stroke', label: '画笔', key: 'P', icon: PenLine },
  { tool: 'shape', label: '形状', key: 'R', icon: Square }, { tool: 'sticker', label: '贴纸', key: 'E', icon: Smile },
];

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : String(error);
  return /CONFLICT|已被修改|版本/i.test(message) ? '对象已被其他人修改，本次更改未覆盖他人的内容。请基于最新内容重试。' : message;
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

export default function WhiteboardCanvas({ board, client, actor, onChanged, onAnnotate, readOnly, onSelectionChange, onViewportChange, presence = [], selfPeerId, onCursorMove, externalViewport, externalSelectedIds, onActivityChange, activities = [], annotationActive, annotationTarget, onAnnotationModeChange, onAnnotateNative, onFeedbackSelect, onOpenHtml, onEditHtml, documentControls }: WhiteboardCanvasProps) {
  const viewportElement = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const htmlInput = useRef<HTMLInputElement>(null);
  const boardRef = useRef(board);
  boardRef.current = board;
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
  const selectionRef = useRef(selection); selectionRef.current = selection;
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const lastAppliedHistoryId=useRef<string|undefined>(undefined);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string; base?: BoardElement; initialText?:string } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [cropDialog, setCropDialog] = useState<BoardElement | null>(null);
  const [dialogDirty, setDialogDirty] = useState(false);
  const [propertyDrafts, setPropertyDrafts] = useState<Record<string, { base: BoardElement; changes: Partial<BoardElement> }>>({});
  const draftsRef = useRef(propertyDrafts); draftsRef.current = propertyDrafts;
  const [propertyEditingIds, setPropertyEditingIds] = useState<string[]>([]);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [issues, setIssues] = useState<NativeIssue[]>([]);
  const activityCallback = useRef(onActivityChange); activityCallback.current = onActivityChange;
  const [interactiveId, setInteractiveId] = useState<string | null>(null);
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
  const [toolMenu, setToolMenu] = useState<'shape' | 'stroke' | 'sticker' | null>(null);
  const [penColor, setPenColor] = useState('#0B0B0B');
  const penWidth = 3;
  const [sticker, setSticker] = useState('smile');
  const [viewTheme, setViewTheme] = useState<'light' | 'dark'>('light');
  const viewStyle = canvasStyle(board.style, viewTheme);
  const [undo, setUndo] = useState<ChangeRecord[]>([]);
  const [redo, setRedo] = useState<ChangeRecord[]>([]);
  const lastKnownRevision = useRef(board.artifact.revision);
  const clipboard = useRef<BoardElement[]>([]);
  const spaceHeld = useRef(false);
  const [spacePan,setSpacePan]=useState(false);
  const canEdit = !readOnly && ['owner', 'editor'].includes(actor.role);
  const canAnnotate = actor.role !== 'viewer';
  const annotating = canAnnotate && (annotationActive ?? tool === 'annotate');
  const annotationMode = useRef({ annotating, onAnnotationModeChange }); annotationMode.current = { annotating, onAnnotationModeChange };
  const setAnnotation = (active: boolean) => { onAnnotationModeChange?.(active); setTool(active ? 'annotate' : 'select'); setInteractiveId(null); setToolMenu(null); updateGesture(null); };
  const selectedElements = board.elements.filter((element) => selection.includes(element.id)).map(element => ({ ...element, ...propertyDrafts[element.id]?.changes }));
  const selected = selectedElements.length === 1 ? selectedElements[0] : undefined;
  const updateGesture = (value: Gesture | null) => { gestureRef.current = value; setGesture(value); };
  const beginEditing = (element: BoardElement) => {let text=(element.type==='arrow'?element.label:element.text)??'';if(element.bold)text=`**${text}**`;if(element.italic)text=`_${text}_`;setEditing({id:element.id,text,base:element,initialText:text});};

  useEffect(() => {
    if (annotationActive === true) { setTool('annotate'); setInteractiveId(null); setToolMenu(null); updateGesture(null); }
    else if (annotationActive === false) {setTool(current => current === 'annotate' ? 'select' : current);setLocalAnnotationTarget(null);}
  }, [annotationActive]);

  useEffect(() => {
    const host = viewportElement.current;
    if (!host) return;
    const measure = () => { const next = measureNativeIssues(host); setIssues(current => JSON.stringify(current) === JSON.stringify(next) ? current : next); };
    const frame = requestAnimationFrame(measure);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : undefined;
    observer?.observe(host);
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); };
  }, [board.elements, viewport, editing?.id, gesture]);
  const movingIds = gesture?.kind === 'move' ? gesture.ids : gesture?.kind === 'resize' || gesture?.kind === 'rotate' ? gesture.ids : gesture?.kind === 'arrow-point' ? [gesture.element.id] : [];
  const editingIds = [...new Set([...(editing ? [editing.id] : []), ...(dialog?.element ? [dialog.element.id] : []), ...(cropDialog ? [cropDialog.id] : []), ...propertyEditingIds, ...Object.keys(propertyDrafts), ...pendingIds])];
  const editBase = editing?.base ?? board.elements.find(element => element.id === editing?.id);
  const textDirty = Boolean(editing && editing.text !== (editing.initialText ?? ((editBase?.type === 'arrow' ? editBase.label : editBase?.text) ?? '')));
  const gestureDirty = gesture?.kind === 'move' || gesture?.kind === 'connect' ? gesture.current.x !== gesture.start.x || gesture.current.y !== gesture.start.y : gesture?.kind === 'resize' || gesture?.kind === 'rotate' || gesture?.kind === 'arrow-point' ? gesture.operations.length > 0 : gesture?.kind === 'draw' || gesture?.kind === 'create';
  const activity = JSON.stringify({ editingIds, movingIds, dirty: saving || textDirty || dialogDirty || Object.keys(propertyDrafts).length > 0 || Boolean(gestureDirty), issues });
  useEffect(() => { activityCallback.current?.(JSON.parse(activity)); }, [activity]);
  useEffect(() => () => activityCallback.current?.({ editingIds: [], movingIds: [], dirty: false, issues: [] }), []);

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

  const selectIds = useCallback((ids: string[]) => { setSelection(ids); selectionRef.current = ids; }, []);
  useEffect(() => { selectionCallback.current?.(selection); }, [selection]);
  useEffect(() => { viewportCallback.current?.(viewport); }, [viewport]);
  useEffect(() => {
    if (externalViewport && Number.isFinite(externalViewport.x) && Number.isFinite(externalViewport.y) && externalViewport.zoom > 0) {
      setViewport((current) => current.x === externalViewport.x && current.y === externalViewport.y && current.zoom === externalViewport.zoom ? current : { ...externalViewport, zoom: clamp(externalViewport.zoom, .05, 8) });
    }
  }, [externalViewport]);
  useEffect(() => {
    if (!savingRef.current && board.artifact.revision !== lastKnownRevision.current) {
      setUndo([]); setRedo([]);
      lastKnownRevision.current = board.artifact.revision;
    }
    setSelection((ids) => { const next = ids.filter((id) => board.elements.some((element) => element.id === id)); return ids.length === next.length ? ids : next; });
  }, [board]);
  useEffect(() => {
    selectIds([]); setTool('select'); setEditing(null); setDialog(null); setCropDialog(null); setDialogDirty(false); setPropertyDrafts({}); setPropertyEditingIds([]); setUndo([]); setRedo([]);
    const frame = requestAnimationFrame(() => {
      const host = viewportElement.current;
      if (host && !externalViewportRef.current) setViewport(fitViewport(boardRef.current.elements, host.clientWidth, host.clientHeight));
    });
    return () => cancelAnimationFrame(frame);
  }, [board.artifact.id, selectIds]);
  useEffect(() => {
    if (externalSelectedIds) selectIds(externalSelectedIds.filter(id => boardRef.current.elements.some(element => element.id === id)));
  }, [externalSelectedIds, selectIds]);

  const apply = useCallback(async (operations: Operation[], summary: string, sourceElements?: BoardElement[], remember = true): Promise<Board | null> => {
    if (!canEdit || savingRef.current || !operations.length) return null;
    const before = boardRef.current;
    const touched = new Set(operations.flatMap((operation) => operation.ids ?? (operation.id ? [operation.id] : operation.element?.id ? [operation.element.id] : [])));
    const versions: Record<string, number> = {};
    for (const id of touched) versions[id] = id==='$order'?(before.orderVersion??0):(sourceElements ?? before.elements).find((element) => element.id === id)?.version ?? 0;
    if(operations.some(operation=>operation.op==='layout'&&['front','back','forward','backward'].includes(operation.preset??'')))versions['$order']=before.orderVersion??0;
    savingRef.current = true; setSaving(true); setPendingIds([...touched]); setError('');
    try {
      const response = await client.call<{ board: Board; historyEntry?: {id:string} }>('artifact_apply', { artifactId: before.artifact.id, operationId: newClientId(), ...(operations.some(operation=>operation.op==='layout'||operation.op==='restore'||operation.op==='style')?{expectedRevision:before.artifact.revision}:{}), expectedVersions: versions, operations, summary });
      if (!response?.board) throw new Error('白板服务没有返回保存结果。');
      lastAppliedHistoryId.current=response.historyEntry?.id;
      const currentResult = response.board.artifact.revision >= boardRef.current.artifact.revision;
      if (currentResult) {
        lastKnownRevision.current = response.board.artifact.revision;
        boardRef.current = response.board;
        onChangedRef.current(response.board);
        setEditing(current => {
          const next = current && response.board.elements.find(element => element.id === current.id);
          return current && next && touched.has(current.id) ? { ...current, base: next } : current;
        });
      } else { setUndo([]); setRedo([]); }
      if (remember && currentResult) {
        const changedIds = [...new Set([...touched, ...before.elements.filter((element) => !response.board.elements.some((next) => next.id === element.id)).map((element) => element.id)])];
        const record = { before: structuredClone(before.elements.filter((element) => changedIds.includes(element.id))), after: structuredClone(response.board.elements.filter((element) => changedIds.includes(element.id))), ids: changedIds, summary, historyId:response.historyEntry?.id, snapshot:operations.some(operation=>operation.op==='style'||operation.op==='layout'&&['front','back','forward','backward'].includes(operation.preset??'')) };
        setUndo((items) => [...items.slice(-49), record]); setRedo([]);
      }
      return response.board;
    } catch (failure) { setError(errorText(failure)); return null; }
    finally { savingRef.current = false; setSaving(false); setPendingIds([]); }
  }, [canEdit, client]);

  useEffect(()=>{const stored=board.style.nativeInks??'';const colors=stored?stored.split(',').map(value=>`#${value}`):[];if(colors.some(value=>!/^#[0-9a-f]{6}$/i.test(value))){setError('自定义色板数据无效，请重新选择颜色。');return;}setCustomColors(colors);},[board.style.nativeInks]);
  const saveCustomColors = (colors:string[]) => {const next=colors.slice(-64);pendingCustomColors.current=next;setCustomColors(next);};
  useEffect(()=>{if(saving||!pendingCustomColors.current)return;const colors=pendingCustomColors.current;pendingCustomColors.current=null;void apply([{op:'style',style:{nativeInks:colors.map(color=>color.slice(1)).join(',')}}],'修改自定义墨色');},[saving,customColors,apply]);
  const stageSelected = (changes: Partial<BoardElement>) => {
    const next = { ...draftsRef.current };
    for (const element of boardRef.current.elements.filter(element => selectionRef.current.includes(element.id))) {
      const draft = next[element.id] ?? { base: element, changes: {} };
      const patch = { ...draft.changes, ...changes };
      for (const key of Object.keys(patch)) if (JSON.stringify(patch[key]) === JSON.stringify(draft.base[key])) delete patch[key];
      if (Object.keys(patch).length) next[element.id] = { base: draft.base, changes: patch }; else delete next[element.id];
    }
    draftsRef.current = next; setPropertyDrafts(next);
    return next;
  };
  const savePropertyDrafts = async (ids = selectionRef.current, summary = '调整元素') => {
    const drafts = ids.flatMap(id => draftsRef.current[id] ? [{ id, ...draftsRef.current[id] }] : []);
    if (!drafts.length || savingRef.current) return;
    const saved = await apply(drafts.map(draft => ({ op: 'update', id: draft.id, changes: draft.changes })), summary, drafts.map(draft => draft.base));
    const next = { ...draftsRef.current };
    for (const draft of drafts) {
      if (!next[draft.id]) continue;
      if (saved && JSON.stringify(next[draft.id].changes) === JSON.stringify(draft.changes)) delete next[draft.id];
      else if (!saved) next[draft.id] = { ...next[draft.id], base: boardRef.current.elements.find(element => element.id === draft.id) ?? next[draft.id].base };
    }
    draftsRef.current = next; setPropertyDrafts(next);
    return saved;
  };
  const updateSelected = async (changes: Partial<BoardElement>, summary = '调整元素') => {
    stageSelected(changes);
    await savePropertyDrafts(selectionRef.current, summary);
  };
  const commitEditing = async (adjacent = false) => {
    if (!editing || savingRef.current) return;
    const current = boardRef.current.elements.find(element => element.id === editing.id);
    if (!current) { setError('此对象已被删除。文字草稿仍保留，可复制后使用。'); return; }
    const base = editing.base ?? current;
    const changed = editing.text !== (editing.initialText ?? ((base.type === 'arrow' ? base.label : base.text) ?? ''));
    const editor=viewportElement.current?.querySelector<HTMLElement>('[contenteditable="true"]');const fitted=editor&&!base.locked&&['text','note','shape'].includes(base.type)?Math.max(current.h,editor.scrollHeight+(['note','shape'].includes(base.type)?32:0)):current.h;
    const saved = changed ? await apply([{ op: 'update', id: editing.id, changes: { ...(base.type === 'arrow' ? { label: editing.text } : { text: editing.text }), ...(base.bold?{bold:false}:{}), ...(base.italic?{italic:false}:{}), ...(fitted>current.h?{h:fitted}:{}) } }], '编辑文字', [base]) : boardRef.current;
    if (saved) {
      setEditing(null);
      if (adjacent && ['text', 'note', 'shape', 'container'].includes(base.type)) {
        const next = makeElement(base.type, { x: current.x + (base.type === 'text' ? 0 : current.w + 24), y: current.y + (base.type === 'text' ? current.h + 24 : 0) }, { w: current.w, h: current.h, kind: current.kind, fill: current.fill, color: current.color, fontSize: current.fontSize, text: '' });
        await addElements([next], '添加相邻元素', { edit: true });
      }
    }
    else setEditing(value => value && { ...value, base: boardRef.current.elements.find(element => element.id === value.id) ?? value.base });
    return saved;
  };
  const addElements = async (elements: BoardElement[], summary: string, options: { continuous?: boolean; edit?: boolean } = {}) => {
    const saved = await apply(elements.map((element) => ({ op: 'add', id: element.id, element })), summary);
    if (saved) {
      selectIds(elements.map((element) => element.id));
      if (!options.continuous) { setTool('select'); setToolMenu(null); }
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
  const fit = (scope: 'all' | 'selection' | 'auto' = 'auto') => {
    const host = viewportElement.current;
    if (host) setViewport(fitViewport(scope !== 'all' && selectionRef.current.length ? boardRef.current.elements.filter((element) => selectionRef.current.includes(element.id)) : boardRef.current.elements, host.clientWidth, host.clientHeight));
  };
  const stepZoom = (factor: number) => { const host = viewportElement.current; setViewport((value) => zoomAt(value, { x: (host?.clientWidth ?? 900) / 2, y: (host?.clientHeight ?? 600) / 2 }, value.zoom * factor)); };

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
    if(action==='group'){void group();return;}
    if(action==='ungroup'){void updateSelected({groupId:''},'取消组合');return;}
    if(action==='lock'){void updateSelected({locked:!elements.filter(element=>ids.includes(element.id)).every(element=>element.locked)},'锁定位置');return;}
    if(action==='tidy'){void apply(tidySelection(elements,ids),'整理元素',elements);return;}
    if(['front','back','forward','backward'].includes(action))void apply([{op:'layout',preset:action,ids}],'调整层级',elements);
  };
  const openMenu = async (point: Point) => {if(editing&&!await commitEditing())return;if(selectionRef.current.some(id=>draftsRef.current[id])&&!await savePropertyDrafts())return;const rect=viewportElement.current?.getBoundingClientRect();setMenu({x:clamp(point.x-(rect?.left??0),8,Math.max(8,(rect?.width??900)-230)),y:clamp(point.y-(rect?.top??0),8,Math.max(8,(rect?.height??600)-440))});};
  const changeHistory = async (direction: 'undo' | 'redo') => {
    const records = direction === 'undo' ? undo : redo;
    const record = records.at(-1);
    if (!record || lastKnownRevision.current !== boardRef.current.artifact.revision) return;
    if(record.historyId){const saved=await apply([{op:'restore',versionId:record.historyId,data:{mode:'undo'}}],`${direction==='undo'?'撤销':'重做'}：${record.summary}`,undefined,false);if(saved){const next={...record,historyId:lastAppliedHistoryId.current};if(direction==='undo'){setUndo(items=>items.slice(0,-1));setRedo(items=>[...items,next]);}else{setRedo(items=>items.slice(0,-1));setUndo(items=>[...items,next]);}}return;}
    const target = direction === 'undo' ? record.before : record.after;
    const current = boardRef.current.elements;
    const operations: Operation[] = [];
    for (const id of record.ids) {
      const old = current.find((element) => element.id === id);
      const next = target.find((element) => element.id === id);
      if (!next && old) operations.push({ op: 'delete', id });
      else if (next && !old) operations.push({ op: 'add', id, element: next });
      else if (next && old) {
        const changes: Partial<BoardElement> = {};
        const defaults: Partial<BoardElement> = { groupId: '', parentId: '', fontFamily: '', bold: false, italic: false, locked: false, hollow: false, dash: false, text: '', label: '', fill: next.type === 'link' ? '#ffffff' : '', color: '', stroke: '', fontSize: 17, textAlign: next.type === 'shape' ? 'center' : 'left', strokeWidth: Number(next.width ?? (next.type === 'stroke' ? 3 : next.type === 'shape' ? 1.4 : 1.8)), heads: arrowHeads(next), crop: { zoom: 1, x: .5, y: .5 }, data: {} };
        for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
          if (key === 'id' || key === 'version' || JSON.stringify(old[key]) === JSON.stringify(next[key])) continue;
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

  const actionsRef = useRef({ remove, duplicate, changeHistory, fit, command, stepZoom, updateSelected });
  actionsRef.current = { remove, duplicate, changeHistory, fit, command, stepZoom, updateSelected };
  useEffect(() => {
    const host = viewportElement.current;
    if (!host) return;
    const wheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest('[data-native-interactive]')) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = host.getBoundingClientRect();
        setViewport((current) => zoomAt(current, { x: event.clientX - rect.left, y: event.clientY - rect.top }, current.zoom * Math.exp(-event.deltaY * .008)));
      } else setViewport((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
    };
    host.addEventListener('wheel', wheel, { passive: false });
    return () => host.removeEventListener('wheel', wheel);
  }, []);
  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target?.closest('input,textarea,select,[contenteditable="true"],iframe,[role="dialog"]')) return;
      if (event.code === 'Space') { spaceHeld.current = true; setSpacePan(true); event.preventDefault(); return; }
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
      else if (event.key === 'Escape') { setTool('select'); setInteractiveId(null); setToolMenu(null); setZoomMenu(false); updateGesture(null); selectIds([]); if (annotationMode.current.annotating) annotationMode.current.onAnnotationModeChange?.(false); }
      else if (command && ['+','='].includes(event.key)) {event.preventDefault();actionsRef.current.stepZoom(1.2);}
      else if(command && event.key==='-'){event.preventDefault();actionsRef.current.stepZoom(1/1.2);}
      else if(command && event.shiftKey && event.key.toLowerCase()==='l'){event.preventDefault();actionsRef.current.command('lock');}
      else if(command && event.key.toLowerCase()==='x'){event.preventDefault();actionsRef.current.command('cut');}
      else if(event.shiftKey && ['Digit0','Digit1','Digit2'].includes(event.code)){event.preventDefault();event.code==='Digit0'?actionsRef.current.stepZoom(1/viewportRef.current.zoom):actionsRef.current.fit(event.code==='Digit1'?'all':'selection');}
      else if(!command && event.key.startsWith('Arrow')){event.preventDefault();const d=event.shiftKey?10:1;const delta={x:event.key==='ArrowLeft'?-d:event.key==='ArrowRight'?d:0,y:event.key==='ArrowUp'?-d:event.key==='ArrowDown'?d:0};if(canEdit&&selectionRef.current.length)void apply(moveOperations(boardRef.current.elements,selectionRef.current,delta),'移动元素');else setViewport(value=>({...value,x:value.x-delta.x*24,y:value.y-delta.y*24}));}
      else if (!command && singleKeys) {
        const aliases:Record<string,{tool:Tool;shape?:string}>={n:{tool:'note'},f:{tool:'container'},l:{tool:'arrow'},x:{tool:'arrow'},m:{tool:'stroke'},o:{tool:'shape',shape:'ellipse'},d:{tool:'shape',shape:'diamond'}};
        const shifted:Record<string,{tool:Tool;shape?:string}>={t:{tool:'table'},s:{tool:'container'},l:{tool:'arrow'},p:{tool:'stroke'}};const alias=event.shiftKey?shifted[event.key.toLowerCase()]:aliases[event.key.toLowerCase()];if(alias&&canEdit){if(annotationMode.current.annotating)annotationMode.current.onAnnotationModeChange?.(false);setTool(alias.tool);if(alias.shape){setShapeKind(alias.shape);setLastShapeTool('shape');}if(alias.tool==='table')setLastShapeTool('table');if(alias.tool==='arrow'||alias.tool==='stroke')setLastDrawTool(alias.tool);setToolMenu(alias.tool==='shape'?'shape':alias.tool==='arrow'||alias.tool==='stroke'?'stroke':null);return;}
        const option = TOOL_OPTIONS.find((item) => item.key.toLowerCase() === event.key.toLowerCase());
        if (option && (canEdit || option.tool === 'select' || option.tool === 'pan')) { setTool(option.tool); setToolMenu(['shape', 'stroke', 'sticker'].includes(option.tool) ? option.tool as 'shape' | 'stroke' | 'sticker' : null); if (annotationMode.current.annotating) annotationMode.current.onAnnotationModeChange?.(false); }
      }
    };
    const keyUp = (event: KeyboardEvent) => { if (event.code === 'Space') {spaceHeld.current = false;setSpacePan(false);} };const resetSpace=()=>{spaceHeld.current=false;setSpacePan(false);};window.addEventListener('blur',resetSpace);
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp);
    return () => { window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur',resetSpace); };
  }, [canEdit, selectIds, singleKeys]);

  const begin = (event: ReactPointerEvent<HTMLDivElement>, element?: BoardElement) => {
    if (event.button !== 0 && event.button !== 1 || (event.target as HTMLElement).closest('[data-native-interactive]') && !annotating) return;
    setToolMenu(null);setZoomMenu(false);setMenu(null);
    if (editing || dialog || savingRef.current) return;
    const host = viewportElement.current;
    if (!host) return;
    host.focus({ preventScroll: true });
    if (event.button === 1 || tool === 'pan' && !annotating || spaceHeld.current) {
      event.preventDefault(); event.stopPropagation(); host.setPointerCapture(event.pointerId);
      updateGesture({ kind: 'pan', start: { x: event.clientX, y: event.clientY }, viewport: viewportRef.current }); return;
    }
    const point = boardPoint(event.clientX, event.clientY);
    if (annotating) {
      event.preventDefault(); event.stopPropagation(); host.setPointerCapture(event.pointerId);
      selectIds(element?[element.id]:[]);setLocalAnnotationTarget(null);
      updateGesture({ kind: 'annotate', start: point, end: point, element }); return;
    }
    if (tool === 'select' && element) {
      event.stopPropagation(); event.preventDefault();
      const groupIds = element.groupId ? boardRef.current.elements.filter((item) => item.groupId === element.groupId).map((item) => item.id) : [element.id];
      const current = selectionRef.current;
      const ids = event.shiftKey ? current.includes(element.id) ? current.filter((id) => !groupIds.includes(id)) : [...new Set([...current, ...groupIds])] : current.includes(element.id) ? current : groupIds;
      selectIds(ids);
      if (!canEdit || element.locked || event.shiftKey && current.includes(element.id)) return;
      const moveIds = expandMoveIds(boardRef.current.elements, ids.filter(id => !boardRef.current.elements.find(item => item.id === id)?.locked));
      const copies=event.altKey?duplicateElements(boardRef.current.elements,moveIds,{x:0,y:0}):undefined;
      updateGesture({ kind: 'move', start: point, current: point, ids: copies?copies.map(element=>element.id):moveIds, elements: copies??boardRef.current.elements.filter((item) => moveIds.includes(item.id)), copies });
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
    const ids = selectionRef.current, elements = boardRef.current.elements;
    const box = nativeSelectionBounds(elements, ids);
    if (!canEdit || savingRef.current || annotating || !box || elements.some(element => ids.includes(element.id) && element.locked)) return;
    event.stopPropagation(); event.preventDefault(); viewportElement.current?.setPointerCapture(event.pointerId);
    updateGesture({ kind: 'resize', start: boardPoint(event.clientX,event.clientY), elements, ids, box, handle, operations: [] });
  };
  const rotateBegin = (event: ReactPointerEvent) => {
    const ids = selectionRef.current, elements = boardRef.current.elements, box = nativeSelectionBounds(elements,ids);
    if (!canEdit || savingRef.current || annotating || !box || elements.some(element => ids.includes(element.id) && (element.locked || element.type!=='arrow' && !ROTATABLE_TYPES.has(element.type)))) return;
    event.stopPropagation(); event.preventDefault(); viewportElement.current?.setPointerCapture(event.pointerId);
    updateGesture({ kind:'rotate', start:boardPoint(event.clientX,event.clientY), elements, ids, box, operations:[] });
  };
  const connectBegin = (event: ReactPointerEvent, element: BoardElement, side: ConnectionSide) => {
    if (event.button!==0 || !canEdit || savingRef.current || annotating || editing || element.locked) return;
    event.stopPropagation(); event.preventDefault(); viewportElement.current?.setPointerCapture(event.pointerId);
    const point=boardPoint(event.clientX,event.clientY);
    updateGesture({kind:'connect',start:point,current:point,element,side});
  };
  const move = (event: ReactPointerEvent) => {
    const hovering=boardPoint(event.clientX,event.clientY);onCursorMove?.(hovering);if(canEdit&&!annotating&&['text','shape','note','container','table','sticker'].includes(tool))setPointer(hovering);
    const current = gestureRef.current;
    if (!current) return;
    let point = boardPoint(event.clientX, event.clientY);
    if (event.shiftKey && current.kind === 'draw' && current.element.type==='arrow') { const angle=Math.round(Math.atan2(point.y-current.start.y,point.x-current.start.x)/(Math.PI/4))*(Math.PI/4); const distance=Math.hypot(point.x-current.start.x,point.y-current.start.y); point={x:current.start.x+Math.cos(angle)*distance,y:current.start.y+Math.sin(angle)*distance}; }
    if (current.kind === 'pan') setViewport({ ...current.viewport, x: current.viewport.x + event.clientX - current.start.x, y: current.viewport.y + event.clientY - current.start.y });
    else if (current.kind === 'marquee' || current.kind === 'annotate') updateGesture({ ...current, end: point });
    else if (current.kind === 'move') { if(!current.dragging && Math.hypot(point.x-current.start.x,point.y-current.start.y)*viewportRef.current.zoom<5)return; if(!current.dragging)viewportElement.current?.setPointerCapture(event.pointerId); const snapped = snapMove(boardRef.current.elements,current.ids,{x:point.x-current.start.x,y:point.y-current.start.y},viewportRef.current.zoom); setGuides(snapped.guides); updateGesture({...current,dragging:true,current:{x:current.start.x+snapped.delta.x,y:current.start.y+snapped.delta.y}}); }
    else if (current.kind === 'connect') { updateGesture({...current,current:point}); }
    else if (current.kind === 'resize') { const delta={x:point.x-current.start.x,y:point.y-current.start.y}; const target=current.elements.filter(element=>current.ids.includes(element.id)); const operations=target.length===1?resizeElement(target[0],current.handle,delta,{aspect:event.shiftKey,center:event.altKey}):resizeSelection(current.elements,current.ids,current.box,resizeBox(current.box,current.handle,delta,{aspect:event.shiftKey || target.some(element=>Boolean(element.rotation)),center:event.altKey})); updateGesture({...current,operations}); }
    else if (current.kind === 'rotate') { const center={x:current.box.x+current.box.w/2,y:current.box.y+current.box.h/2}; let angle=(Math.atan2(point.y-center.y,point.x-center.x)-Math.atan2(current.start.y-center.y,current.start.x-center.x))*180/Math.PI; if(event.shiftKey)angle=Math.round(angle/15)*15; updateGesture({...current,operations:rotateSelection(current.elements,current.ids,angle)}); }
    else if (current.kind === 'arrow-point') {const changes=current.end==='bends'?{bends:current.points!.slice(1,-1).flatMap((value,index)=>index===current.bendIndex?[point.x,point.y]:[value.x,value.y])}:{[current.end]:[point.x,point.y]};updateGesture({...current,operations:[{op:'update',id:current.element.id,changes}]});}
    else if (current.kind === 'draw') {
      if(event.shiftKey&&current.element.type==='stroke'){const anchor=current.straightStart??current.points.at(-1)!;const prefix=current.straightPoints??current.points;const angle=Math.round(Math.atan2(point.y-anchor.y,point.x-anchor.x)/(Math.PI/4))*(Math.PI/4),distance=Math.hypot(point.x-anchor.x,point.y-anchor.y);updateGesture({...current,straightStart:anchor,straightPoints:prefix,points:[...prefix,{x:anchor.x+Math.cos(angle)*distance,y:anchor.y+Math.sin(angle)*distance}]});return;}
      const previous = current.points.at(-1)!;
      if (Math.hypot(point.x - previous.x, point.y - previous.y) > 2 / viewportRef.current.zoom) updateGesture({ ...current, straightStart:undefined,straightPoints:undefined,points: [...current.points.slice(-19999), point] });
    } else {
      if(event.shiftKey&&current.element.type==='shape'){const side=Math.max(Math.abs(point.x-current.start.x),Math.abs(point.y-current.start.y));point={x:current.start.x+Math.sign(point.x-current.start.x||1)*side,y:current.start.y+Math.sign(point.y-current.start.y||1)*side};}
      const box = normalizedRect(current.start, point);
      updateGesture({ ...current, element: { ...current.element, ...box, w: Math.max(32, box.w), h: Math.max(28, box.h) } });
    }
  };
  const finish = (event: ReactPointerEvent) => {
    const current = gestureRef.current;
    if (!current) return;
    updateGesture(null); setGuides([]);
    if (viewportElement.current?.hasPointerCapture(event.pointerId)) viewportElement.current.releasePointerCapture(event.pointerId);
    if (current.kind === 'pan') return;
    if (current.kind === 'annotate') {
      const area = normalizedRect(current.start, current.end);
      const dragged = Math.hypot(area.w, area.h) * viewportRef.current.zoom > 5;
      const targets = dragged ? boardRef.current.elements.filter(element => intersects(area, elementBounds(element, boardRef.current.elements))) : current.element ? [current.element] : [];
      const element = !dragged ? current.element : undefined;
      const relative = element ? relativeElementPoint(elementBounds(element, boardRef.current.elements) as BoardElement, current.start) : undefined;
      setLocalAnnotationTarget(element?{elementIds:[element.id],coordinateSpace:'element',...relative}:{coordinateSpace:'board',x:current.start.x,y:current.start.y,...dragged?area:{}});
      onAnnotateNative?.({ anchor: element ? { elementIds: [element.id], coordinateSpace: 'element', ...relative } : { coordinateSpace: 'board', elementIds: targets.map(item => item.id), x: current.start.x, y: current.start.y, ...(dragged ? area : {}) }, label: element ? `${element.type === 'note' ? '便签' : element.type === 'container' ? '分区' : '对象'} · ${(element.text || element.label || element.type).slice(0, 100)}` : dragged ? `画布范围${targets.length ? ` · ${targets.length} 个对象` : ''}` : '画布位置', versions: Object.fromEntries(targets.map(item => [item.id, item.version])), screenPoint: { x: event.clientX, y: event.clientY } });
      return;
    }
    if (current.kind === 'marquee') {
      const box = normalizedRect(current.start, current.end);
      const ids = boardRef.current.elements.filter((element) => element.type !== 'arrow' && intersects(box, element)).map((element) => element.id);
      selectIds(current.additive ? [...new Set([...selectionRef.current, ...ids])] : ids); return;
    }
    if (current.kind === 'move') {
      const delta = { x: current.current.x - current.start.x, y: current.current.y - current.start.y };
      if (Math.hypot(delta.x, delta.y) > .5) {if(current.copies)void addElements(current.copies.map(element=>({...element,...moveOperations(current.elements,current.ids,delta).find(operation=>operation.id===element.id)?.changes})),'拖动复制');else void apply(moveOperations(current.elements, current.ids, delta), '移动元素', current.elements);}
    } else if (current.kind === 'connect') {
      const end=boardPoint(event.clientX,event.clientY),source=current.element;
      const dragged=Math.hypot(end.x-current.start.x,end.y-current.start.y)*viewportRef.current.zoom>=5;
      if(!dragged && (source.type==='note'||source.type==='shape')) {
        const next=adjacentElement(source,current.side,makeElement(source.type,source,{w:source.w,h:source.h,kind:source.kind,fill:source.fill,color:source.color,stroke:source.stroke,strokeWidth:source.strokeWidth,fontSize:source.fontSize,text:''}),boardRef.current.elements);
        const arrow=source.type==='shape'?makeElement('arrow',connectionPoint(source,current.side),{from:source.id,fromSide:current.side,to:next.id,toSide:OPPOSITE_SIDE[current.side],color:penColor,stroke:penColor,strokeWidth:penWidth}):undefined;
        void (async()=>{const saved=await addElements(arrow?[next,arrow]:[next],'添加相邻元素',{edit:true});if(saved)selectIds([next.id]);})();
      } else if(dragged && source.type!=='note') {
        const target=connectionAtPoint(boardRef.current.elements,end,viewportRef.current.zoom,[source.id]);
        const start=connectionPoint(source,current.side),box=normalizedRect(start,end);
        void addElements([makeElement('arrow',start,{...box,from:source.id,fromSide:current.side,to:target?.element.id??[end.x,end.y],...(target?.side?{toSide:target.side}:{}),color:penColor,stroke:penColor,strokeWidth:penWidth})],'添加连接线');
      }
    } else if (current.kind === 'resize' || current.kind === 'rotate' || current.kind === 'arrow-point') {
      let operations=current.operations;if(current.kind==='arrow-point'&&current.end!=='bends'){const point=boardPoint(event.clientX,event.clientY);const target=[...boardRef.current.elements].reverse().find(element=>element.id!==current.element.id&&!['arrow','stroke'].includes(element.type)&&point.x>=element.x&&point.x<=element.x+element.w&&point.y>=element.y&&point.y<=element.y+element.h);if(target)operations=[{op:'update',id:current.element.id,changes:{[current.end]:target.id}}];}void apply(operations, current.kind==='rotate'?'旋转元素':'调整几何',current.kind==='arrow-point'?[current.element]:current.elements);
    } else if (current.kind === 'draw') {
      const end = current.points.at(-1) ?? boardPoint(event.clientX, event.clientY);
      if (current.element.type === 'arrow') {
        const target = [...boardRef.current.elements].reverse().find((element) => element.id !== current.from && !['arrow', 'stroke', 'container'].includes(element.type) && end.x >= element.x && end.x <= element.x + element.w && end.y >= element.y && end.y <= element.y + element.h);
        const to = target?.id ?? [end.x, end.y] as [number, number];
        const box = normalizedRect(current.start, end);
        void addElements([{ ...current.element, ...box, to, w: Math.max(1, box.w), h: Math.max(1, box.h) }], '添加连接线', { continuous: true });
      } else {
        const points = [...current.points, end];
        const bounds = boundsOf(points.map((point) => ({ ...point, w: 0, h: 0 })))!;
        void addElements([{ ...current.element, ...bounds, points: points.flatMap((point) => [point.x - bounds.x, point.y - bounds.y]) }], '添加笔迹', { continuous: true });
      }
    } else {
      const end = boardPoint(event.clientX, event.clientY);
      const element = Math.hypot(end.x - current.start.x, end.y - current.start.y) * viewportRef.current.zoom < 5 ? { ...current.element, x: current.start.x, y: current.start.y, w: makeElement(current.element.type, current.start).w, h: makeElement(current.element.type, current.start).h } : current.element;
      void addElements([element], '添加元素', { edit: ['text', 'note', 'shape', 'container'].includes(element.type), continuous: element.type === 'sticker' });
    }
  };

  const currentMoveElements = (moving:Extract<Gesture,{kind:'move'}>,elements:BoardElement[],patches:Operation[]) => moving.copies?[...elements,...moving.copies.map(element=>({...element,...patches.find(patch=>patch.id===element.id)?.changes}))]:elements.map(element=>({...element,...patches.find(patch=>patch.id===element.id)?.changes}));
  const renderedElements = useMemo(() => {
    if (!gesture) return board.elements;
    if (gesture.kind === 'move') {
      const patches = moveOperations(gesture.elements, gesture.ids, { x: gesture.current.x - gesture.start.x, y: gesture.current.y - gesture.start.y });
      return currentMoveElements(gesture,board.elements,patches);
    }
    if (gesture.kind === 'resize' || gesture.kind === 'rotate' || gesture.kind === 'arrow-point') return board.elements.map(element => ({...element,...gesture.operations.find(operation=>operation.id===element.id)?.changes}));
    if (gesture.kind === 'create') return [...board.elements, gesture.element];
    if (gesture.kind === 'connect' && gesture.element.type!=='note' && Math.hypot(gesture.current.x-gesture.start.x,gesture.current.y-gesture.start.y)*viewport.zoom>=5) {
      const target=connectionAtPoint(board.elements,gesture.current,viewport.zoom,[gesture.element.id]);
      return [...board.elements,makeElement('arrow',connectionPoint(gesture.element,gesture.side),{id:'connection-preview',from:gesture.element.id,fromSide:gesture.side,to:target?.element.id??[gesture.current.x,gesture.current.y],...(target?.side?{toSide:target.side}:{}),color:penColor,stroke:penColor,strokeWidth:penWidth})];
    }
    if (gesture.kind === 'draw') {
      const end = gesture.points.at(-1)!;
      const element = gesture.element.type === 'arrow' ? { ...gesture.element, to: [end.x, end.y] as [number, number] } : { ...gesture.element, points: gesture.points.flatMap((point) => [point.x - gesture.start.x, point.y - gesture.start.y]) };
      return [...board.elements, element];
    }
    return board.elements;
  }, [board.elements, gesture, viewport.zoom, penColor]);

  const uploadMedia = async (files: FileList | File[] | null, position = centerPoint()) => {
    if (!files?.length || !canEdit || savingRef.current) return;
    setError(''); setSaving(true); savingRef.current = true;
    try {
      const elements: BoardElement[] = [];
      for (const [index, file] of [...files].slice(0, 12).entries()) {
        if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type) && !/^video\/(mp4|webm|quicktime)$/.test(file.type)) throw new Error('支持 PNG、JPEG、WebP、GIF、SVG 图片，以及 MP4、WebM、MOV 视频。');
        if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} 超过 20 MB，请压缩后添加。`);
        let src: string;
        if (client.baseUrl && client.token) {
          const response = await studioRequest(client, new URL(`/api/assets?artifactId=${encodeURIComponent(boardRef.current.artifact.id)}`, client.baseUrl), { method: 'POST', headers: { Authorization: `Bearer ${client.token}`, 'Content-Type': file.type, 'X-Filename': encodeURIComponent(file.name), 'X-Studio-Name': encodeURIComponent(actor.name) }, body: file });
          const result = await response.json() as { src?: string; error?: { message?: string } };
          if (!response.ok || !result.src) throw new Error(result.error?.message ?? `资源上传失败（${response.status}）`);
          src = result.src;
        } else {
          if (file.type.startsWith('video/') || file.size > 1024 * 1024) throw new Error('大图片和视频需要连接本地 Studio 服务后添加。');
          src = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('无法读取图片。')); reader.readAsDataURL(file); });
        }
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
        elements.push(makeElement('image', { x: position.x + index * 32, y: position.y + index * 32 }, { w, h, text: file.name, data, ...(video ? { video: src } : { src }) }));
      }
      setSaving(false); savingRef.current = false;
      await addElements(elements, '添加媒体');
    } catch (failure) { setError(errorText(failure)); setSaving(false); savingRef.current = false; }
  };

  const renderElement = (element: BoardElement) => {
    const picked = selection.includes(element.id);
    const lineColor = semanticColor(nativePaint(element.stroke ?? element.color,viewTheme), viewStyle, viewStyle.muted);
    if (element.type === 'arrow') {
      const geometry = arrowGeometry(element, renderedElements);
      const marker = `studio-arrow-${element.id}`;
      const startMarker = `studio-arrow-start-${element.id}`;
      const [fromHead, toHead] = arrowHeads(element);
      const markerColor = picked ? viewStyle.accent : lineColor;
      const renderMarker = (id: string, head: string) => <marker id={id} viewBox="0 0 10 10" refX={head === 'circle' ? 5 : 8} refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">{head === 'circle' ? <circle cx="5" cy="5" r="3" fill={viewStyle.paper} stroke={markerColor} strokeWidth="1.5" /> : <path d="M 1 1 L 8 5 L 1 9" fill="none" stroke={markerColor} strokeWidth="1.5" />}</marker>;
      return <svg key={element.id} className={`studio-canvas-arrow${picked ? ' is-selected' : ''}`} data-element-id={element.id} aria-label={element.label || '连接线'} style={{ overflow: 'visible' }}>
        <defs>{renderMarker(startMarker, fromHead)}{renderMarker(marker, toHead)}</defs>
        <path d={geometry.path} fill="none" stroke="transparent" strokeWidth={16 / viewport.zoom} pointerEvents="stroke" onPointerDown={(event) => begin(event as unknown as ReactPointerEvent<HTMLDivElement>, element)} onDoubleClick={event => { event.stopPropagation(); if (canEdit && !annotating) beginEditing(element); }} />
        <path d={geometry.path} fill="none" stroke={markerColor} strokeWidth={Number(element.strokeWidth ?? element.width ?? 1.8)} strokeDasharray={element.dash ? '6 5' : undefined} markerStart={fromHead !== 'none' ? `url(#${startMarker})` : undefined} markerEnd={toHead !== 'none' ? `url(#${marker})` : undefined} pointerEvents="none" />
        {(element.label || editing?.id === element.id) && <foreignObject x={geometry.label.x - 100} y={geometry.label.y - 28} width={200} height={54} overflow="visible"><div className="studio-arrow-label">{editing?.id === element.id ? renderTextEditor(element) : <RichText text={element.label} />}</div></foreignObject>}
      </svg>;
    }
    const fill = element.hollow ? 'transparent' : semanticColor(nativePaint(element.fill,viewTheme), viewStyle, element.type === 'note' ? '#fff0b5' : element.type === 'shape' ? viewStyle['paper-2'] ?? viewStyle.paper : 'transparent');
    let ink = semanticColor(nativePaint(element.color,viewTheme), viewStyle, viewStyle.ink);
    try { if (element.type !== 'sticker' && contrastRatio(ink, fill, viewStyle.paper) < 4.5) ink = readableText(fill, viewStyle.paper); } catch { /* Unknown user paint is left for the renderer rather than rewritten. */ }
    const style: CSSProperties = { left: element.x, top: element.y, width: element.w, height: element.h, color: ink, fontSize: element.fontSize ?? 17, fontFamily: element.fontFamily || viewStyle.fontFamily, fontWeight: element.bold ? 600 : 400, fontStyle: element.italic ? 'italic' : 'normal', textAlign: element.textAlign ?? (element.type === 'shape' ? 'center' : 'left'), transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined, ...(element.type === 'container' ? { borderColor: lineColor, background: fill !== 'transparent' ? fill : undefined } : {}) };
    let content;
    if (element.type === 'html' || element.type === 'diagram' && typeof element.html === 'string') content = <HtmlRegion element={element} annotation={annotating} interactive={interactiveId === element.id} onAnnotate={selection=>{selectIds([element.id]);onAnnotate(selection);}} onStateChange={canEdit ? async (state: Json, expectedVersion: number) => {
      if (savingRef.current) throw new Error('白板正在保存，请稍后重试。');
      const current = boardRef.current.elements.find((item) => item.id === element.id);
      if (!current || current.version !== expectedVersion) throw new Error('嵌入内容已被其他人修改，请基于最新状态重试。');
      const saved = await apply([{ op: 'update', id: element.id, changes: { state } }], '更新嵌入交互状态', [current], false);
      const next = saved?.elements.find((item) => item.id === element.id);
      if (!next) throw new Error('交互状态未能保存。');
      return { state: next.state ?? null, version: next.version };
    } : undefined} />;
    else if (element.type === 'stroke') {
      content = <svg className="studio-stroke-svg" overflow="visible" aria-hidden="true"><path d={strokePath(element.points)} fill="none" stroke={lineColor} strokeWidth={Number(element.strokeWidth ?? element.width ?? 3)} strokeDasharray={element.dash ? '6 5' : undefined} strokeLinecap="round" strokeLinejoin="round" /></svg>;
    } else if (element.type === 'image') {
      const src = assetDisplayUrl(element.src, client), video = assetDisplayUrl(element.video, client), href = safeHttpLink(element.href);
      content = video ? <video src={video} controls preload="metadata" playsInline poster={src} data-native-interactive="true" /> : src ? <><CroppedImage element={element} src={src} />{href && <a className="studio-image-link" href={href} target="_blank" rel="noopener noreferrer" aria-label="打开图片链接" data-native-interactive="true"><ExternalLink size={16} /></a>}</> : <div className="studio-media-missing">无法读取媒体</div>;
    } else if (element.type === 'table') content = <NativeTable element={element} selected={picked} canEdit={canEdit && !annotating} onRequestLink={value=>setLinkRequest({key:newClientId(),value})} onFormatStateChange={setFormatState} onEditingChange={active=>setPropertyEditingIds(ids=>active?[...new Set([...ids,element.id])]:ids.filter(id=>id!==element.id))} onSave={async(changes,base)=>(await apply([{op:'update',id:element.id,changes}],'编辑表格',[base]))?.elements.find(item=>item.id===element.id)??false}/>;
    else if (element.type === 'link') content = <div className="studio-link-card" style={{ background: element.fill ?? '#ffffff' }}><Link size={22} /><div><strong>{element.text || '链接'}</strong><span>{element.href}</span></div><a href={safeHttpLink(element.href)} target="_blank" rel="noreferrer" aria-label="打开链接" data-native-interactive="true"><ExternalLink size={17} /></a></div>;
    else if (element.type === 'sticker' && getBoardSticker(element.data?.stickerIconId)) content = <Sticker id={element.data?.stickerIconId} />;
    else if (element.type === 'container') content = <div className="studio-section-title">{editing?.id === element.id ? renderTextEditor(element) : <RichText text={element.text} />}</div>;
    else content = <>{element.type === 'shape' && <Shape element={{ ...element, fill, stroke: lineColor }} />}{element.type === 'note' && <div className="studio-note-fill" style={{ background: fill }} />}<div className={`studio-element-text${element.type === 'sticker' ? ' studio-sticker-text' : ''}`} style={{ padding: element.type === 'text' || element.type === 'sticker' ? 2 : 16, ...(element.kind === 'person' ? { top: '39%', paddingTop: 4 } : {}) }}>{editing?.id === element.id ? renderTextEditor(element) : <RichText text={element.text} />}</div></>;
    return <div key={element.id} className={`studio-board-element studio-element-${element.type}${picked ? ' is-selected' : ''}${element.locked ? ' is-locked' : ''}`} data-element-id={element.id} style={style} onClickCapture={event=>{if(annotating){event.preventDefault();event.stopPropagation();}}} onPointerDown={(event) => begin(event, element)} onDoubleClick={(event) => {
      if (annotating || (event.target as HTMLElement).closest('[data-native-interactive]')) return;
      event.stopPropagation();
      if (element.type === 'html' || element.type === 'diagram' && typeof element.html === 'string') { setInteractiveId(element.id); return; }
      if (!canEdit) return;
      if (element.type === 'link') setDialog({ type: 'link', element });
      else if (element.type === 'image' && element.src && !element.video && !element.locked) setCropDialog(element);
      else if (!['html', 'image', 'stroke', 'diagram', 'chart'].includes(element.type) && !(element.type === 'sticker' && getBoardSticker(element.data?.stickerIconId))) beginEditing(element);
    }}>
      {content}
      {element.type === 'html' && <div className="studio-html-caption" style={{ bottom: 'calc(100% + 10px)', width: element.w }}><strong>{element.text || 'HTML 图解'}</strong><span>图解</span></div>}
    </div>;
  };

  function renderTextEditor(element: BoardElement) {
    return <InlineTextEditor key={element.id} ref={textEditor} className="studio-inline-editor" value={editing?.text??''} disabled={saving} style={{fontWeight:400,fontStyle:'normal'}} singleLine={['container','arrow'].includes(element.type)} ariaLabel={element.type==='arrow'?'连接线文字':'编辑文字'} onChange={text=>setEditing(current=>({id:element.id,text,base:current?.base??element,initialText:current?.initialText}))} onFormatStateChange={setFormatState} onRequestLink={value=>setLinkRequest({key:newClientId(),value})} onCommit={adjacent=>{void commitEditing(adjacent);}} />;
  }

  const selectionBounds = nativeSelectionBounds(renderedElements,selection);
  const selectionElement=selected&&renderedElements.find(element=>element.id===selected.id);
  const commentTarget=annotationTarget??localAnnotationTarget;
  const commentBounds=commentTarget?anchorBounds(commentTarget,renderedElements):null;
  const annotateSelected = async () => {
    const ids = [...selectionRef.current];
    const unchangedBase=editing&&editing.text===(editing.initialText??((editing.base?.type==='arrow'?editing.base.label:editing.base?.text)??''))?editing.base:undefined;
    if (!ids.length || savingRef.current) return;
    if (editing && ids.includes(editing.id) && !await commitEditing()) return;
    if (ids.some(id => draftsRef.current[id]) && !await savePropertyDrafts(ids)) return;
    const elements = boardRef.current.elements.filter(element => ids.includes(element.id)).map(element=>unchangedBase?.id===element.id?unchangedBase:element);
    const bounds = boundsOf(elements.map(element => elementBounds(element, boardRef.current.elements)));
    if (!elements.length || !bounds) return;
    const element = elements.length === 1 ? elements[0] : undefined;
    const host = viewportElement.current?.getBoundingClientRect();
    const view = viewportRef.current;
    const point = { x: (host?.left ?? 0) + (bounds.x + bounds.w) * view.zoom + view.x, y: (host?.top ?? 0) + (bounds.y + bounds.h / 2) * view.zoom + view.y };
    onAnnotateNative?.({ anchor: element ? { elementIds: ids, coordinateSpace: 'element', x: 1, y: .5 } : { elementIds: ids, coordinateSpace: 'board', ...bounds }, label: element ? `${element.type === 'note' ? '便签' : element.type === 'container' ? '分区' : '对象'} · ${(element.text || element.label || element.type).slice(0, 100)}` : `${elements.length} 个对象`, versions: Object.fromEntries(elements.map(element => [element.id, element.version])), screenPoint: point });
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

  return <div className={`studio-whiteboard${saving ? ' is-saving' : ''}`} data-tool={spacePan||gesture?.kind==='pan'?'pan':annotating ? 'annotate' : tool} style={{ '--studio-ink': viewStyle.ink, '--studio-accent': viewStyle.accent, '--studio-link': viewStyle.link, '--canvas-paper': viewStyle.paper, '--canvas-scale': viewport.zoom, '--canvas-comment-cursor': COMMENT_CURSOR, '--canvas-pen-cursor':PEN_CURSOR } as CSSProperties}
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
      if (!canEdit || (event.target as HTMLElement).closest('input,textarea,[contenteditable="true"]')) return;
      if (event.clipboardData.files.length) { event.preventDefault(); void uploadMedia(event.clipboardData.files); return; }
      const plainPayload=event.clipboardData.getData('text/plain');
      const encoded = event.clipboardData.getData('application/x-agentero-studio') || (plainPayload.startsWith(CLIPBOARD_PREFIX)?plainPayload.slice(CLIPBOARD_PREFIX.length):'');
      if (encoded && encoded.length < 8 * 1024 * 1024) {
        try {
          const elements: unknown = JSON.parse(encoded);
          if (Array.isArray(elements) && elements.length <= 200 && elements.every((element) => element && typeof element.id === 'string' && typeof element.type === 'string' && ['shape', 'container', 'text', 'stroke', 'arrow', 'image', 'html', 'table', 'link', 'note', 'sticker'].includes(element.type))) {
            event.preventDefault(); void addElements(duplicateElements(elements, elements.map((element) => element.id)), '粘贴元素'); return;
          }
        } catch { /* A non-Studio clipboard falls through to plain text. */ }
      }
      const text = event.clipboardData.getData('text/plain');
      if (text.trim() && text.length <= 20000) { event.preventDefault(); void addElements([makeElement('text', centerPoint(), { text, w: 380, h: Math.max(70, Math.min(600, text.split('\n').length * 30)) })], '粘贴文字'); }
    }}>
    <div className="studio-canvas-status" role="status">{saving ? '正在保存…' : textDirty || Object.keys(propertyDrafts).length ? '有尚未保存的草稿' : canEdit ? '所有更改自动保存' : actor.role === 'viewer' ? '只读 · 实时同步' : '可批注 · 实时同步'}</div>
    <div className="studio-canvas-top-tools" data-native-interactive="true">
      {documentControls}
      {documentControls && <span className="studio-tool-divider" />}
      <button type="button" className="studio-zoom-value" aria-label="缩放菜单" aria-expanded={zoomMenu} title="缩放与视图" onClick={() => setZoomMenu(value => !value)}>{Math.round(viewport.zoom * 100)}%<ChevronDown size={14} /></button>
      {zoomMenu && <div className="studio-zoom-menu" role="menu" aria-label="缩放与视图">
        <div className="studio-zoom-steps"><button type="button" aria-label="缩小" onClick={() => stepZoom(1 / 1.2)}><Minus size={16} /></button><span>{Math.round(viewport.zoom * 100)}%</span><button type="button" aria-label="放大" onClick={() => stepZoom(1.2)}><Plus size={16} /></button></div>
        {[25, 50, 75, 100, 150, 200].map(value => <button type="button" role="menuitem" key={value} onClick={() => { stepZoom(value / 100 / viewport.zoom); setZoomMenu(false); }}>{value}%</button>)}
        <button type="button" role="menuitem" onClick={() => { fit('all'); setZoomMenu(false); }}><Maximize size={15} />适应白板</button><button type="button" role="menuitem" disabled={!selection.length} onClick={() => { fit('selection'); setZoomMenu(false); }}><Maximize size={15} />适应选区</button>
        <hr /><button type="button" role="menuitem" aria-label="撤销" disabled={!canEdit || saving || !undo.length} onClick={() => void changeHistory('undo')}><RotateCcw size={15} />撤销<span>⌘/Ctrl Z</span></button><button type="button" role="menuitem" aria-label="重做" disabled={!canEdit || saving || !redo.length} onClick={() => void changeHistory('redo')}><Redo2 size={15} />重做</button>
        <details><summary>视图设置</summary><label><input type="checkbox" checked={showGrid} onChange={event => setShowGrid(event.target.checked)} />显示网格</label><label><input type="checkbox" checked={singleKeys} onChange={event=>setSingleKeys(event.target.checked)}/>单键工具快捷键</label></details>
      </div>}
    </div>
    <div ref={viewportElement} className="studio-canvas-viewport" tabIndex={0} aria-label="白板画布" onPointerDown={(event) => { if (!(event.target as HTMLElement).closest('[data-native-interactive]')) { setToolMenu(null); setZoomMenu(false); } begin(event); }} onDoubleClick={event => { if (!canEdit || annotating || tool !== 'select' || editing || dialog || savingRef.current || (event.target as HTMLElement).closest('[data-element-id],[data-native-interactive]')) return; updateGesture(null); void addElements([makeElement('text', boardPoint(event.clientX, event.clientY), { text: '' })], '添加文字', { edit: true }); }} onPointerMove={move} onPointerLeave={()=>setPointer(null)} onPointerUp={finish} onPointerCancel={() => updateGesture(null)} onContextMenu={event=>{if((event.target as HTMLElement).closest('[data-native-interactive]'))return;event.preventDefault();const id=(event.target as HTMLElement).closest('[data-element-id]')?.getAttribute('data-element-id');if(id&&!selectionRef.current.includes(id))selectIds([id]);openMenu({x:event.clientX,y:event.clientY});}} onDragOver={(event) => { if (canEdit && event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); void uploadMedia(event.dataTransfer.files, boardPoint(event.clientX, event.clientY)); }} style={{ backgroundPosition: `${viewport.x}px ${viewport.y}px`, backgroundSize: `${24 * viewport.zoom}px ${24 * viewport.zoom}px`, ...(!showGrid ? { backgroundImage: 'none' } : {}) }}>
      <div className="studio-canvas-world" style={{ transform: `translate(${viewport.x}px,${viewport.y}px) scale(${viewport.zoom})` }}>
        {renderedElements.map(renderElement)}
        {pointer && !gesture && !editing && !annotating && canEdit && ['text','shape','note','container','table','sticker'].includes(tool) && <div className="studio-placement-ghost" aria-hidden="true">{renderElement(makeElement(tool as ElementType,pointer,{id:'placement-ghost',text:tool==='text'?'文字':'',...(tool==='shape'?{kind:shapeKind}:{}),...(tool==='sticker'?{text:getBoardSticker(sticker)?.label,data:{stickerIconId:sticker}}:{})}))}</div>}
        {selectionBounds && selection.length>0 && (selected?.type!=='arrow'||annotating||selected.locked) && (annotating || tool==='select') && !editing && <SelectionChrome bounds={selectionElement&&selectionElement.rotation?{x:selectionElement.x,y:selectionElement.y,w:selectionElement.w,h:selectionElement.h}:selectionBounds} rotation={selectionElement?.rotation??0} zoom={viewport.zoom} locked={annotating || !canEdit || selectedElements.some(element=>element.locked)} resizable={selectedElements.some(element=>!['arrow','link'].includes(element.type))} rotatable={selectedElements.every(element=>element.type==='arrow'||ROTATABLE_TYPES.has(element.type))} edges={selected?.type==='text'?['w','e']:selectedElements.some(element=>element.type==='image')||selected?.type==='sticker'||selection.length>1&&selectedElements.some(element=>element.rotation)?[]:undefined} onResize={resizeBegin} onRotate={rotateBegin}/>}
        {selected && canEdit && !annotating && tool==='select' && !editing && !gesture && canShowConnectionPorts(selected,viewport.zoom) && <ConnectionPorts element={selected} zoom={viewport.zoom} onBegin={connectBegin}/>}
        {selected?.type==='arrow' && canEdit && !selected.locked && !annotating && tool==='select' && !editing && (()=>{const points=arrowGeometry(selected,renderedElements).points;return points.map((point,index)=><button type="button" key={`arrow-handle-${index}`} className="studio-arrow-handle" aria-label={index===0?'连接线起点位置':index===points.length-1?'连接线终点位置':`连接线折点 ${index}`} style={{left:point.x,top:point.y,width:10/viewport.zoom,height:10/viewport.zoom,borderWidth:1.5/viewport.zoom}} onPointerDown={event=>{event.preventDefault();event.stopPropagation();viewportElement.current?.setPointerCapture(event.pointerId);updateGesture({kind:'arrow-point',start:boardPoint(event.clientX,event.clientY),element:selected,end:index===0?'from':index===points.length-1?'to':'bends',bendIndex:index-1,points,operations:[]});}}/>);})()}
        {commentBounds && <div className="studio-current-comment-target" data-comment-target="true" aria-hidden="true" style={{left:commentBounds.x,top:commentBounds.y,width:Math.max(commentBounds.w,12/viewport.zoom),height:Math.max(commentBounds.h,12/viewport.zoom),borderWidth:2/viewport.zoom}}/>}
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
        {presence.filter((peer) => peer.peerId !== selfPeerId && peer.cursor && Date.now() - Date.parse(peer.updatedAt) < 45000).map((peer) => {
          const color = ['#b85c34', '#536a9e', '#53765a', '#86639f'][peer.peerId.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % 4]!;
          return <div key={peer.peerId} className="studio-remote-cursor" style={{ left: peer.cursor!.x, top: peer.cursor!.y, transform: `scale(${1 / viewport.zoom})` }}><svg width="18" height="23" viewBox="0 0 18 23" aria-hidden="true"><path d="M2 1 16 14 10 15 7 21 2 1Z" fill={color} stroke="#fff" strokeWidth="1.4" /></svg><span style={{ background: color }}>{peer.actor.name}</span>{peer.chat && <p>{peer.chat}</p>}</div>;
        })}
        {(gesture?.kind === 'marquee' || gesture?.kind === 'annotate') && <div className="studio-marquee" style={{ left: Math.min(gesture.start.x, gesture.end.x), top: Math.min(gesture.start.y, gesture.end.y), width: Math.abs(gesture.end.x - gesture.start.x), height: Math.abs(gesture.end.y - gesture.start.y), borderWidth: 1 / viewport.zoom }} />}
      </div>
      {!board.elements.length && !gesture && <div className="studio-canvas-empty"><div className="studio-empty-symbol"><Square size={27} /><Circle size={25} /><ArrowUpRight size={24} /></div><strong>从一个想法开始</strong><p>{canEdit ? '添加文字、便签或图形，也可以导入 HTML 图解。' : '这块白板还没有内容。'}</p>{canEdit && <button type="button" data-native-interactive="true" onClick={() => onEditHtml ? onEditHtml() : setDialog({ type: 'html' })}><Braces size={16} />添加 HTML 图解</button>}</div>}
    </div>
    <div className="studio-canvas-toolbar" role="toolbar" aria-label="白板工具" data-native-interactive="true">
      {TOOL_OPTIONS.map(({ tool: choice, label, key, icon: Icon }) => <button type="button" key={choice} aria-label={label} title={`${label}（${key}）`} aria-pressed={!annotating && (choice === tool || choice === 'stroke' && tool === 'arrow')} className={!annotating && (choice === tool || choice === 'stroke' && tool === 'arrow') ? 'is-active' : ''} onClick={() => { setTool(choice==='stroke'?lastDrawTool:choice==='shape'?lastShapeTool:choice); setInteractiveId(null); if (annotating) onAnnotationModeChange?.(false); setToolMenu(['shape', 'stroke', 'sticker'].includes(choice) ? toolMenu === choice ? null : choice as 'shape' | 'stroke' | 'sticker' : null); }} disabled={saving || !canEdit && !['select', 'pan'].includes(choice)}>{choice==='stroke'&&lastDrawTool==='arrow'?<ArrowUpRight size={20}/>:choice==='shape'&&lastShapeTool==='table'?<Table2 size={20}/>:choice==='shape'?<span className="studio-tool-shape-glyph"><Shape element={makeElement('shape',{x:0,y:0},{w:24,h:20,kind:shapeKind,fill:'transparent',stroke:viewStyle.ink})}/></span>:<Icon size={20}/>} {['shape', 'stroke'].includes(choice) && <ChevronDown size={9} className="studio-tool-caret" />}</button>)}
    </div>
    {toolMenu === 'shape' && canEdit && <div className="studio-shape-options studio-insert-menu" data-native-interactive="true"><div className="studio-shape-grid">{SHAPES.map(([kind,label])=><button type="button" key={kind} aria-label={`形状 ${label}`} title={label} aria-pressed={shapeKind===kind && tool==='shape'} onClick={()=>{setShapeKind(kind);setLastShapeTool('shape');setTool('shape');}}><Shape element={makeElement('shape',{x:0,y:0},{w:64,h:48,kind,fill:'transparent',stroke:viewStyle.ink})}/></button>)}</div><button type="button" onClick={()=>{setLastShapeTool('table');setTool('table');setToolMenu(null);}}><Table2 size={17}/>表格</button><button type="button" onClick={()=>{setDialog({type:'link'});setToolMenu(null);}}><Link size={17}/>链接</button><button type="button" onClick={()=>{onEditHtml?onEditHtml():setDialog({type:'html'});setToolMenu(null);}}><Braces size={17}/>HTML 图解</button></div>}
    {!annotating && (tool==='stroke'||tool==='arrow') && canEdit && <div className="studio-shape-options studio-pen-menu" aria-label="绘图选项" data-native-interactive="true"><div className="studio-pen-choices"><button type="button" aria-label="画笔模式" title="画笔（P）" aria-pressed={tool==='stroke'} onClick={()=>{setLastDrawTool('stroke');setTool('stroke');}}><PenLine size={18}/></button><button type="button" aria-label="箭头模式" title="箭头（L）" aria-pressed={tool==='arrow'} onClick={()=>{setLastDrawTool('arrow');setTool('arrow');}}><ArrowUpRight size={18}/></button></div><span className="studio-tool-divider"/><ColorPalette presetOnly theme={viewTheme} value={penColor} onChange={setPenColor}/></div>}
    {toolMenu === 'sticker' && canEdit && <StickerPalette selectedId={sticker} onSelect={choice => { setSticker(choice.id); setTool('sticker'); setToolMenu(null); }} onUpload={() => { fileInput.current?.click(); setToolMenu(null); }} />}
    {selectedElements.length > 0 && selectionBounds && !annotating && <CanvasFormatToolbar key={selection.join(',')} elements={selectedElements} style={{ left: viewport.x + (selectionBounds.x + selectionBounds.w / 2) * viewport.zoom, top: clamp(viewport.y + selectionBounds.y * viewport.zoom - (selected?.type === 'html' ? 82 : 58), 12, Math.max(12, (viewportElement.current?.clientHeight || 600) - 145)) }} formatState={editing||selected?.type==='table'&&propertyEditingIds.includes(selected.id)?formatState:undefined} requestLink={linkRequest} customColors={customColors} onCustomColorsChange={saveCustomColors} theme={viewTheme} canEdit={canEdit} canAnnotate={canAnnotate} saving={saving} interactive={interactiveId === selected?.id} onChange={changes => { void updateSelected(changes); }} onEditText={() => { if (selected) beginEditing(selected); }} onTextFormat={formatText} onAnnotate={annotateSelected} onToggleInteractive={() => { if (selected) { setTool('select'); setInteractiveId(value => value === selected.id ? null : selected.id); } }} onOpenHtml={selected && onOpenHtml ? () => onOpenHtml(selected) : undefined} onEditHtml={selected && onEditHtml ? ()=>onEditHtml(selected):undefined} onCrop={selected?.type==='image'&&selected.src&&!selected.video?()=>setCropDialog(selected):undefined} onAlign={edge=>{void apply(alignSelection(boardRef.current.elements,selectionRef.current,edge),'对齐元素');}} onMore={openMenu} />}
    {menu && <CanvasActionsMenu point={menu} canEdit={canEdit} selected={selection.length} locked={selectedElements.some(element=>element.locked)} hasClipboard={Boolean(navigator.clipboard?.readText)} onCommand={command} onClose={()=>setMenu(null)}/>}
    {error && <div className="studio-canvas-error" role="alert"><span>{error}</span>{editing && <button type="button" disabled={saving} onClick={() => void commitEditing()}>重试保存文字</button>}<button type="button" aria-label="关闭错误提示" onClick={() => setError('')}><X size={16} /></button></div>}
    <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,video/mp4,video/webm,video/quicktime" multiple hidden onChange={(event) => { void uploadMedia(event.target.files); event.currentTarget.value = ''; }} />
    <input ref={htmlInput} type="file" accept=".html,.htm,text/html" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then((html) => addElements([makeElement('html', centerPoint(), { html, text: file.name.replace(/\.html?$/i, '') })], '导入 HTML 图解')); event.currentTarget.value = ''; }} />
    {cropDialog && <ImageCropDialog element={cropDialog} src={assetDisplayUrl(cropDialog.src, client)!} onDirtyChange={setDialogDirty} onClose={() => { setCropDialog(null); setDialogDirty(false); }} onSave={async changes => {
      const saved = await apply([{ op: 'update', id: cropDialog.id, changes }], '裁剪图片', [cropDialog]);
      if (saved) { setCropDialog(null); setDialogDirty(false); } else setCropDialog(current => current && (boardRef.current.elements.find(element => element.id === current.id) ?? current));
    }} />}
    {dialog && <CanvasDialog dialog={dialog} onDirtyChange={setDialogDirty} onClose={() => { setDialog(null); setDialogDirty(false); }} onSave={async (data) => {
      const element = dialog.element;
      if (element) { const saved = await apply([{ op: 'update', id: element.id, changes: data }], '编辑元素', [element]); if (saved) { setDialog(null); setDialogDirty(false); } else setDialog(current => current && ({ ...current, element: boardRef.current.elements.find(item => item.id === element.id) ?? element })); }
      else { const saved = await addElements([makeElement(dialog.type === 'sticker' ? 'sticker' : dialog.type, centerPoint(), data)], dialog.type === 'html' ? '添加 HTML 图解' : '添加元素'); if (saved) { setDialog(null); setDialogDirty(false); } }
    }} />}
  </div>;
}

function CanvasDialog({ dialog, onClose, onSave, onDirtyChange }: { dialog: Dialog; onClose: () => void; onSave: (data: Partial<BoardElement>) => Promise<void>; onDirtyChange: (dirty: boolean) => void }) {
  const [title, setTitle] = useState(dialog.element?.text ?? (dialog.type === 'html' ? 'HTML 图解' : dialog.type === 'link' ? '链接' : ''));
  const [value, setValue] = useState(dialog.type === 'table' ? tableRows(dialog.element ?? makeElement('table', { x: 0, y: 0 })).map((row) => row.join('\t')).join('\n') : dialog.type === 'link' ? dialog.element?.href ?? '' : dialog.type === 'sticker' ? '★' : dialog.element?.html ?? '');
  const [busy, setBusy] = useState(false);
  const originalValue = dialog.type === 'table' ? tableRows(dialog.element ?? makeElement('table', { x: 0, y: 0 })).map(row => row.join('\t')).join('\n') : dialog.type === 'link' ? dialog.element?.href ?? '' : dialog.type === 'sticker' ? dialog.element?.text ?? '★' : dialog.element?.html ?? '';
  useEffect(() => { onDirtyChange(!dialog.element || value !== originalValue || (['html', 'link'].includes(dialog.type) && title !== (dialog.element.text ?? ''))); }, [dialog.element, dialog.type, value, title, originalValue, onDirtyChange]);
  const valid = dialog.type === 'link' ? Boolean(safeHttpLink(value)) : Boolean(value.trim());
  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try { await onSave(dialog.type === 'html' ? { html: value, text: title || 'HTML 图解' } : dialog.type === 'table' ? { data: { ...dialog.element?.data, rows: value.split('\n').map((row) => row.split('\t')) } } : dialog.type === 'link' ? { href: value, text: title || new URL(value).hostname } : { text: value.slice(0, 12) }); } finally { setBusy(false); }
  };
  return <div className="studio-canvas-modal-backdrop" data-native-interactive="true" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`studio-canvas-modal${dialog.type === 'html' ? ' is-wide' : ''}`} role="dialog" aria-modal="true" aria-label={dialog.type === 'html' ? '添加 HTML 图解' : dialog.type === 'table' ? '编辑表格' : dialog.type === 'link' ? '添加链接' : '添加贴纸'}>
    <header><h2>{dialog.type === 'html' ? '添加 HTML 图解' : dialog.type === 'table' ? '表格内容' : dialog.type === 'link' ? '链接' : '贴纸'}</h2><button type="button" aria-label="关闭" onClick={onClose}><X size={18} /></button></header>
    {(dialog.type === 'html' || dialog.type === 'link') && <label>名称<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>}
    <label>{dialog.type === 'html' ? '粘贴 HTML 源码' : dialog.type === 'table' ? '每行一条记录，列之间用 Tab 分隔（可从电子表格粘贴）' : dialog.type === 'link' ? '网页地址' : '符号或简短文字'}{dialog.type === 'link' || dialog.type === 'sticker' ? <input autoFocus value={value} placeholder={dialog.type === 'link' ? 'https://' : '★'} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void save(); }} /> : <textarea className={dialog.type === 'html' ? 'studio-html-source-input' : ''} autoFocus rows={dialog.type === 'html' ? 14 : 8} value={value} placeholder={dialog.type === 'html' ? '<!doctype html>\n<html>…</html>' : ''} onChange={(event) => setValue(event.target.value)} />}</label>
    {dialog.type === 'html' && <p>图解在独立区域显示；通过批注让 Codex 修改，原始源码会随白板保存。</p>}
    <footer><button type="button" onClick={onClose}>取消</button><button type="button" className="studio-primary" disabled={!valid || busy} onClick={() => void save()}>{busy ? '正在保存…' : '保存到白板'}</button></footer>
  </section></div>;
}
