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
  onAnnotationModeChange?: (active: boolean) => void;
  onAnnotateNative?: (selection: NativeAnnotation) => void;
  onFeedbackSelect?: (feedback: Feedback, screenPoint: Point) => void;
  onOpenHtml?: (element: BoardElement) => void;
  onEditHtml?: (element?: BoardElement) => void;
  documentControls?: ReactNode;
}

export interface NativeAnnotation { anchor: Anchor; label: string; versions: Record<string, number>; screenPoint?: Point }

type Tool = 'select' | 'pan' | 'annotate' | 'shape' | 'note' | 'text' | 'container' | 'stroke' | 'arrow' | 'sticker';
type Gesture =
  | { kind: 'pan'; start: Point; viewport: Viewport }
  | { kind: 'marquee'; start: Point; end: Point; additive: boolean }
  | { kind: 'annotate'; start: Point; end: Point; element?: BoardElement }
  | { kind: 'move'; start: Point; current: Point; ids: string[]; elements: BoardElement[] }
  | { kind: 'resize'; start: Point; element: BoardElement; current: Rect }
  | { kind: 'draw'; start: Point; points: Point[]; element: BoardElement; from?: string }
  | { kind: 'create'; start: Point; element: BoardElement };
interface Dialog { type: 'html' | 'table' | 'link' | 'sticker'; element?: BoardElement }
interface ChangeRecord { before: BoardElement[]; after: BoardElement[]; ids: string[]; summary: string }

const COLORS = ['#ffffff', '#fff0b5', '#f8d6c6', '#f1d0dc', '#d6e6d3', '#cddfee', '#ded5ed'];
const STROKES = ['#2d3142', '#4f5d75', '#eb6c36', '#2e5aa8', '#56815b', '#7c6192'];
const SHAPES = [['rounded', '圆角矩形'], ['rect', '矩形'], ['ellipse', '椭圆'], ['diamond', '菱形'], ['pill', '胶囊'], ['hexagon', '六边形'], ['parallelogram', '平行四边形'], ['database', '数据库'], ['queue', '队列'], ['document', '文档'], ['cloud', '云'], ['person', '人物']] as const;
const TOOL_OPTIONS: { tool: Tool; label: string; key: string; icon: typeof Square }[] = [
  { tool: 'select', label: '选择', key: 'V', icon: MousePointer2 }, { tool: 'pan', label: '平移', key: 'H', icon: Hand },
  { tool: 'text', label: '文字', key: 'T', icon: Type }, { tool: 'container', label: '分区', key: 'F', icon: Frame },
  { tool: 'note', label: '便签', key: 'N', icon: StickyNote }, { tool: 'stroke', label: '画笔', key: 'P', icon: PenLine },
  { tool: 'shape', label: '形状', key: 'R', icon: Square }, { tool: 'sticker', label: '贴纸', key: 'S', icon: Smile },
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

export default function WhiteboardCanvas({ board, client, actor, onChanged, onAnnotate, readOnly, onSelectionChange, onViewportChange, presence = [], selfPeerId, onCursorMove, externalViewport, externalSelectedIds, onActivityChange, activities = [], annotationActive, onAnnotationModeChange, onAnnotateNative, onFeedbackSelect, onOpenHtml, onEditHtml, documentControls }: WhiteboardCanvasProps) {
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
  const [selection, setSelection] = useState<string[]>([]);
  const selectionRef = useRef(selection); selectionRef.current = selection;
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string; base?: BoardElement } | null>(null);
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
  const [properties, setProperties] = useState(false);
  const [zoomMenu, setZoomMenu] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [toolMenu, setToolMenu] = useState<'shape' | 'stroke' | 'sticker' | null>(null);
  const [penColor, setPenColor] = useState('#4f5d75');
  const [penWidth, setPenWidth] = useState(3);
  const [sticker, setSticker] = useState('smile');
  const [viewTheme, setViewTheme] = useState<'light' | 'dark'>('light');
  const viewStyle = canvasStyle(board.style, viewTheme);
  const [undo, setUndo] = useState<ChangeRecord[]>([]);
  const [redo, setRedo] = useState<ChangeRecord[]>([]);
  const lastKnownRevision = useRef(board.artifact.revision);
  const clipboard = useRef<BoardElement[]>([]);
  const spaceHeld = useRef(false);
  const canEdit = !readOnly && ['owner', 'editor'].includes(actor.role);
  const canAnnotate = actor.role !== 'viewer';
  const annotating = canAnnotate && (annotationActive ?? tool === 'annotate');
  const annotationMode = useRef({ annotating, onAnnotationModeChange }); annotationMode.current = { annotating, onAnnotationModeChange };
  const setAnnotation = (active: boolean) => { onAnnotationModeChange?.(active); setTool(active ? 'annotate' : 'select'); setInteractiveId(null); setToolMenu(null); updateGesture(null); };
  const selectedElements = board.elements.filter((element) => selection.includes(element.id)).map(element => ({ ...element, ...propertyDrafts[element.id]?.changes }));
  const selected = selectedElements.length === 1 ? selectedElements[0] : undefined;
  const updateGesture = (value: Gesture | null) => { gestureRef.current = value; setGesture(value); };
  const beginEditing = (element: BoardElement) => setEditing({ id: element.id, text: (element.type === 'arrow' ? element.label : element.text) ?? '', base: element });

  useEffect(() => {
    if (annotationActive === true) { setTool('annotate'); setInteractiveId(null); setToolMenu(null); updateGesture(null); }
    else if (annotationActive === false) setTool(current => current === 'annotate' ? 'select' : current);
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
  const movingIds = gesture?.kind === 'move' ? gesture.ids : gesture?.kind === 'resize' ? [gesture.element.id] : [];
  const editingIds = [...new Set([...(editing ? [editing.id] : []), ...(dialog?.element ? [dialog.element.id] : []), ...(cropDialog ? [cropDialog.id] : []), ...propertyEditingIds, ...Object.keys(propertyDrafts), ...pendingIds])];
  const editBase = editing?.base ?? board.elements.find(element => element.id === editing?.id);
  const textDirty = Boolean(editing && editing.text !== ((editBase?.type === 'arrow' ? editBase.label : editBase?.text) ?? ''));
  const gestureDirty = gesture?.kind === 'move' ? gesture.current.x !== gesture.start.x || gesture.current.y !== gesture.start.y : gesture?.kind === 'resize' ? gesture.current.w !== gesture.element.w || gesture.current.h !== gesture.element.h : gesture?.kind === 'draw' || gesture?.kind === 'create';
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
      setViewport((current) => current.x === externalViewport.x && current.y === externalViewport.y && current.zoom === externalViewport.zoom ? current : { ...externalViewport, zoom: clamp(externalViewport.zoom, .12, 3) });
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
    for (const id of touched) versions[id] = (sourceElements ?? before.elements).find((element) => element.id === id)?.version ?? 0;
    savingRef.current = true; setSaving(true); setPendingIds([...touched]); setError('');
    try {
      const response = await client.call<{ board: Board }>('artifact_apply', { artifactId: before.artifact.id, operationId: crypto.randomUUID(), expectedVersions: versions, operations, summary });
      if (!response?.board) throw new Error('白板服务没有返回保存结果。');
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
        const record = { before: structuredClone(before.elements.filter((element) => changedIds.includes(element.id))), after: structuredClone(response.board.elements.filter((element) => changedIds.includes(element.id))), ids: changedIds, summary };
        setUndo((items) => [...items.slice(-49), record]); setRedo([]);
      }
      return response.board;
    } catch (failure) { setError(errorText(failure)); return null; }
    finally { savingRef.current = false; setSaving(false); setPendingIds([]); }
  }, [canEdit, client]);

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
    const changed = editing.text !== ((base.type === 'arrow' ? base.label : base.text) ?? '');
    const saved = changed ? await apply([{ op: 'update', id: editing.id, changes: base.type === 'arrow' ? { label: editing.text } : { text: editing.text } }], '编辑文字', [base]) : boardRef.current;
    if (saved) {
      setEditing(null);
      if (adjacent && ['text', 'note', 'shape', 'container'].includes(base.type)) {
        const next = makeElement(base.type, { x: current.x, y: current.y + current.h + 24 }, { w: current.w, h: current.h, kind: current.kind, fill: current.fill, color: current.color, fontSize: current.fontSize, text: '' });
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
  const changeHistory = async (direction: 'undo' | 'redo') => {
    const records = direction === 'undo' ? undo : redo;
    const record = records.at(-1);
    if (!record || lastKnownRevision.current !== boardRef.current.artifact.revision) return;
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

  const actionsRef = useRef({ remove, duplicate, changeHistory, fit });
  actionsRef.current = { remove, duplicate, changeHistory, fit };
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
      if (event.code === 'Space') { spaceHeld.current = true; event.preventDefault(); return; }
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === 'a') { event.preventDefault(); selectIds(boardRef.current.elements.map((element) => element.id)); }
      else if (command && event.key === '0') { event.preventDefault(); actionsRef.current.fit(); }
      else if (command && event.key.toLowerCase() === 'c') { if (selectionRef.current.length) clipboard.current = structuredClone(boardRef.current.elements.filter((element) => expandMoveIds(boardRef.current.elements, selectionRef.current).includes(element.id))); }
      else if (canEdit && command && event.key.toLowerCase() === 'd') { event.preventDefault(); actionsRef.current.duplicate(); }
      else if (canEdit && command && event.key.toLowerCase() === 'z') { event.preventDefault(); void actionsRef.current.changeHistory(event.shiftKey ? 'redo' : 'undo'); }
      else if (canEdit && command && event.key.toLowerCase() === 'y') { event.preventDefault(); void actionsRef.current.changeHistory('redo'); }
      else if (canEdit && ['Delete', 'Backspace'].includes(event.key) && selectionRef.current.length) { event.preventDefault(); actionsRef.current.remove(); }
      else if (event.key === 'Escape') { setTool('select'); setInteractiveId(null); setToolMenu(null); setZoomMenu(false); updateGesture(null); selectIds([]); if (annotationMode.current.annotating) annotationMode.current.onAnnotationModeChange?.(false); }
      else if (!command) {
        if (canEdit && event.key.toLowerCase() === 'a') { setTool('arrow'); setToolMenu('stroke'); if (annotationMode.current.annotating) annotationMode.current.onAnnotationModeChange?.(false); return; }
        const option = TOOL_OPTIONS.find((item) => item.key.toLowerCase() === event.key.toLowerCase());
        if (option && (canEdit || option.tool === 'select' || option.tool === 'pan')) { setTool(option.tool); setToolMenu(['shape', 'stroke', 'sticker'].includes(option.tool) ? option.tool as 'shape' | 'stroke' | 'sticker' : null); if (annotationMode.current.annotating) annotationMode.current.onAnnotationModeChange?.(false); }
      }
    };
    const keyUp = (event: KeyboardEvent) => { if (event.code === 'Space') spaceHeld.current = false; };
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp);
    return () => { window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); };
  }, [canEdit, selectIds]);

  const begin = (event: ReactPointerEvent<HTMLDivElement>, element?: BoardElement) => {
    if (event.button !== 0 && event.button !== 1 || (event.target as HTMLElement).closest('[data-native-interactive]')) return;
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
      if (element) selectIds([element.id]);
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
      host.setPointerCapture(event.pointerId);
      updateGesture({ kind: 'move', start: point, current: point, ids: moveIds, elements: boardRef.current.elements.filter((item) => moveIds.includes(item.id)) });
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
  const resizeBegin = (event: ReactPointerEvent, element: BoardElement) => {
    if (!canEdit || savingRef.current || element.locked) return;
    event.stopPropagation(); event.preventDefault(); viewportElement.current?.setPointerCapture(event.pointerId);
    updateGesture({ kind: 'resize', start: boardPoint(event.clientX, event.clientY), element, current: { x: element.x, y: element.y, w: element.w, h: element.h } });
  };
  const move = (event: ReactPointerEvent) => {
    onCursorMove?.(boardPoint(event.clientX, event.clientY));
    const current = gestureRef.current;
    if (!current) return;
    const point = boardPoint(event.clientX, event.clientY);
    if (current.kind === 'pan') setViewport({ ...current.viewport, x: current.viewport.x + event.clientX - current.start.x, y: current.viewport.y + event.clientY - current.start.y });
    else if (current.kind === 'marquee' || current.kind === 'annotate') updateGesture({ ...current, end: point });
    else if (current.kind === 'move') updateGesture({ ...current, current: point });
    else if (current.kind === 'resize') updateGesture({ ...current, current: { ...current.current, w: Math.max(32, current.element.w + point.x - current.start.x), h: Math.max(28, current.element.h + point.y - current.start.y) } });
    else if (current.kind === 'draw') {
      const previous = current.points.at(-1)!;
      if (Math.hypot(point.x - previous.x, point.y - previous.y) > 2 / viewportRef.current.zoom) updateGesture({ ...current, points: [...current.points.slice(-19999), point] });
    } else {
      const box = normalizedRect(current.start, point);
      updateGesture({ ...current, element: { ...current.element, ...box, w: Math.max(32, box.w), h: Math.max(28, box.h) } });
    }
  };
  const finish = (event: ReactPointerEvent) => {
    const current = gestureRef.current;
    if (!current) return;
    updateGesture(null);
    if (viewportElement.current?.hasPointerCapture(event.pointerId)) viewportElement.current.releasePointerCapture(event.pointerId);
    if (current.kind === 'pan') return;
    if (current.kind === 'annotate') {
      const area = normalizedRect(current.start, current.end);
      const dragged = Math.hypot(area.w, area.h) * viewportRef.current.zoom > 5;
      const targets = dragged ? boardRef.current.elements.filter(element => intersects(area, elementBounds(element, boardRef.current.elements))) : current.element ? [current.element] : [];
      const element = !dragged ? current.element : undefined;
      const relative = element ? relativeElementPoint(elementBounds(element, boardRef.current.elements) as BoardElement, current.start) : undefined;
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
      if (Math.hypot(delta.x, delta.y) > .5) void apply(moveOperations(current.elements, current.ids, delta), '移动元素', current.elements);
    } else if (current.kind === 'resize') {
      if (current.current.w !== current.element.w || current.current.h !== current.element.h) void apply([{ op: 'update', id: current.element.id, changes: { w: current.current.w, h: current.current.h } }], '调整尺寸', [current.element]);
    } else if (current.kind === 'draw') {
      const end = boardPoint(event.clientX, event.clientY);
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

  const renderedElements = useMemo(() => {
    if (!gesture) return board.elements;
    if (gesture.kind === 'move') {
      const patches = moveOperations(gesture.elements, gesture.ids, { x: gesture.current.x - gesture.start.x, y: gesture.current.y - gesture.start.y });
      return board.elements.map((element) => ({ ...element, ...patches.find((patch) => patch.id === element.id)?.changes }));
    }
    if (gesture.kind === 'resize') return board.elements.map((element) => element.id === gesture.element.id ? { ...element, ...gesture.current } : element);
    if (gesture.kind === 'create') return [...board.elements, gesture.element];
    if (gesture.kind === 'draw') {
      const end = gesture.points.at(-1)!;
      const element = gesture.element.type === 'arrow' ? { ...gesture.element, to: [end.x, end.y] as [number, number] } : { ...gesture.element, points: gesture.points.flatMap((point) => [point.x - gesture.start.x, point.y - gesture.start.y]) };
      return [...board.elements, element];
    }
    return board.elements;
  }, [board.elements, gesture]);

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
    const lineColor = semanticColor(element.stroke ?? element.color, viewStyle, viewStyle.muted);
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
    const fill = element.hollow ? 'transparent' : semanticColor(element.fill, viewStyle, element.type === 'note' ? '#fff0b5' : element.type === 'shape' ? viewStyle['paper-2'] ?? viewStyle.paper : 'transparent');
    let ink = semanticColor(element.color, viewStyle, viewStyle.ink);
    try { if (element.type !== 'sticker' && contrastRatio(ink, fill, viewStyle.paper) < 4.5) ink = readableText(fill, viewStyle.paper); } catch { /* Unknown user paint is left for the renderer rather than rewritten. */ }
    const style: CSSProperties = { left: element.x, top: element.y, width: element.w, height: element.h, color: ink, fontSize: element.fontSize ?? 17, fontFamily: element.fontFamily || viewStyle.fontFamily, fontWeight: element.bold ? 600 : 400, fontStyle: element.italic ? 'italic' : 'normal', textAlign: element.textAlign ?? (element.type === 'shape' ? 'center' : 'left'), transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined, ...(element.type === 'container' ? { borderColor: lineColor, background: fill !== 'transparent' ? fill : undefined } : {}) };
    let content;
    if (element.type === 'html' || element.type === 'diagram' && typeof element.html === 'string') content = <HtmlRegion element={element} annotation={annotating} interactive={interactiveId === element.id} onAnnotate={onAnnotate} onStateChange={canEdit ? async (state: Json, expectedVersion: number) => {
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
    } else if (element.type === 'table') content = <table className="studio-board-table"><tbody>{tableRows(element).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, colIndex) => rowIndex === 0 ? <th key={colIndex}>{cell}</th> : <td key={colIndex}>{cell}</td>)}</tr>)}</tbody></table>;
    else if (element.type === 'link') content = <div className="studio-link-card" style={{ background: element.fill ?? '#ffffff' }}><Link size={22} /><div><strong>{element.text || '链接'}</strong><span>{element.href}</span></div><a href={safeHttpLink(element.href)} target="_blank" rel="noreferrer" aria-label="打开链接" data-native-interactive="true"><ExternalLink size={17} /></a></div>;
    else if (element.type === 'sticker' && getBoardSticker(element.data?.stickerIconId)) content = <Sticker id={element.data?.stickerIconId} />;
    else if (element.type === 'container') content = <div className="studio-section-title">{editing?.id === element.id ? renderTextEditor(element) : <RichText text={element.text} />}</div>;
    else content = <>{element.type === 'shape' && <Shape element={{ ...element, fill, stroke: lineColor }} />}{element.type === 'note' && <div className="studio-note-fill" style={{ background: fill }} />}<div className={`studio-element-text${element.type === 'sticker' ? ' studio-sticker-text' : ''}`} style={{ padding: element.type === 'text' || element.type === 'sticker' ? 2 : 16, ...(element.kind === 'person' ? { top: '39%', paddingTop: 4 } : {}) }}>{editing?.id === element.id ? renderTextEditor(element) : <RichText text={element.text} />}</div></>;
    return <div key={element.id} className={`studio-board-element studio-element-${element.type}${picked ? ' is-selected' : ''}${element.locked ? ' is-locked' : ''}`} data-element-id={element.id} style={style} onPointerDown={(event) => begin(event, element)} onDoubleClick={(event) => {
      if (annotating || (event.target as HTMLElement).closest('[data-native-interactive]')) return;
      event.stopPropagation();
      if (element.type === 'html' || element.type === 'diagram' && typeof element.html === 'string') { setInteractiveId(element.id); return; }
      if (!canEdit) return;
      if (element.type === 'table') setDialog({ type: 'table', element });
      else if (element.type === 'link') setDialog({ type: 'link', element });
      else if (element.type === 'image' && element.src && !element.video && !element.locked) setCropDialog(element);
      else if (!['html', 'image', 'stroke', 'diagram', 'chart'].includes(element.type) && !(element.type === 'sticker' && getBoardSticker(element.data?.stickerIconId))) beginEditing(element);
    }}>
      {content}
      {picked && canEdit && !element.locked && element.type !== 'stroke' && <button type="button" className="studio-resize-handle" aria-label="调整元素大小" onPointerDown={(event) => resizeBegin(event, element)} />}
      {picked && element.locked && <span className="studio-lock-indicator"><Lock size={12} /></span>}
      {element.type === 'html' && <div className="studio-html-caption" style={{ bottom: `calc(100% + ${10 / viewport.zoom}px)`, width: element.w * viewport.zoom, transform: `scale(${1 / viewport.zoom})` }}><strong>{element.text || 'HTML 图解'}</strong><span>图解</span></div>}
    </div>;
  };

  function renderTextEditor(element: BoardElement) {
    return <textarea className="studio-inline-editor" data-native-interactive="true" autoFocus disabled={saving} value={editing?.text ?? ''} aria-label={element.type === 'arrow' ? '连接线文字' : '编辑文字'} onFocus={event => { if (element.type === 'container' && editing?.text === '分区') event.currentTarget.select(); }} onChange={(event) => setEditing(current => ({ id: element.id, text: event.target.value, base: current?.base ?? element }))} onPointerDown={(event) => event.stopPropagation()} onBlur={() => { void commitEditing(); }} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) { event.stopPropagation(); return; }
      if (event.key === 'Escape' || event.key === 'Enter' && (event.ctrlKey || event.metaKey || ['container', 'arrow'].includes(element.type))) { event.preventDefault(); void commitEditing(event.key === 'Enter' && (event.ctrlKey || event.metaKey)); }
      event.stopPropagation();
    }} />;
  }

  const selectionBounds = boundsOf(renderedElements.filter(element => selection.includes(element.id)).map(element => elementBounds(element, renderedElements)));
  const annotateSelected = async () => {
    const ids = [...selectionRef.current];
    if (!ids.length || savingRef.current) return;
    if (editing && ids.includes(editing.id) && !await commitEditing()) return;
    if (ids.some(id => draftsRef.current[id]) && !await savePropertyDrafts(ids)) return;
    const elements = boardRef.current.elements.filter(element => ids.includes(element.id));
    const bounds = boundsOf(elements.map(element => elementBounds(element, boardRef.current.elements)));
    if (!elements.length || !bounds) return;
    const element = elements.length === 1 ? elements[0] : undefined;
    const host = viewportElement.current?.getBoundingClientRect();
    const view = viewportRef.current;
    const point = { x: (host?.left ?? 0) + (bounds.x + bounds.w) * view.zoom + view.x, y: (host?.top ?? 0) + (bounds.y + bounds.h / 2) * view.zoom + view.y };
    onAnnotateNative?.({ anchor: element ? { elementIds: ids, coordinateSpace: 'element', x: 1, y: .5 } : { elementIds: ids, coordinateSpace: 'board', ...bounds }, label: element ? `${element.type === 'note' ? '便签' : element.type === 'container' ? '分区' : '对象'} · ${(element.text || element.label || element.type).slice(0, 100)}` : `${elements.length} 个对象`, versions: Object.fromEntries(elements.map(element => [element.id, element.version])), screenPoint: point });
  };
  const formatText = (format: 'list' | 'link', value?: string) => {
    if (!selected) return;
    const text = editing?.id === selected.id ? editing.text : (selected.type === 'arrow' ? selected.label : selected.text) ?? '';
    const next = format === 'link' ? `[${text || '链接'}](${value})` : text.split('\n').every(line => /^- /.test(line)) ? text.replace(/^- /gm, '') : text.replace(/^(?!- )/gm, '- ');
    if (editing?.id === selected.id) setEditing({ ...editing, text: next });
    else void updateSelected(selected.type === 'arrow' ? { label: next } : { text: next }, '设置文字格式');
  };

  return <div className={`studio-whiteboard${saving ? ' is-saving' : ''}`} data-tool={annotating ? 'annotate' : tool} style={{ '--studio-ink': viewStyle.ink, '--studio-accent': viewStyle.accent, '--studio-link': viewStyle.link, '--canvas-paper': viewStyle.paper, '--canvas-scale': viewport.zoom, '--canvas-comment-cursor': COMMENT_CURSOR } as CSSProperties}
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
      const encoded = event.clipboardData.getData('application/x-agentero-studio');
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
        <details><summary>视图设置</summary><label><input type="checkbox" checked={showGrid} onChange={event => setShowGrid(event.target.checked)} />显示网格</label></details>
      </div>}
    </div>
    <div ref={viewportElement} className="studio-canvas-viewport" tabIndex={0} aria-label="白板画布" onPointerDown={(event) => { if (!(event.target as HTMLElement).closest('[data-native-interactive]')) { setToolMenu(null); setZoomMenu(false); } begin(event); }} onDoubleClick={event => { if (!canEdit || annotating || tool !== 'select' || editing || dialog || savingRef.current || (event.target as HTMLElement).closest('[data-element-id],[data-native-interactive]')) return; updateGesture(null); void addElements([makeElement('text', boardPoint(event.clientX, event.clientY), { text: '' })], '添加文字', { edit: true }); }} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => updateGesture(null)} onDragOver={(event) => { if (canEdit && event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); void uploadMedia(event.dataTransfer.files, boardPoint(event.clientX, event.clientY)); }} style={{ backgroundPosition: `${viewport.x}px ${viewport.y}px`, backgroundSize: `${24 * viewport.zoom}px ${24 * viewport.zoom}px`, ...(!showGrid ? { backgroundImage: 'none' } : {}) }}>
      <div className="studio-canvas-world" style={{ transform: `translate(${viewport.x}px,${viewport.y}px) scale(${viewport.zoom})` }}>
        {[...renderedElements.filter((element) => element.type === 'container'), ...renderedElements.filter((element) => element.type === 'arrow'), ...renderedElements.filter((element) => element.type !== 'container' && element.type !== 'arrow')].map(renderElement)}
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
    {annotating && <div className="studio-annotation-hint">点击对象或画布添加备注，拖动框选范围；HTML 内可选择文字，Shift 拖动框选。<button type="button" onClick={() => setAnnotation(false)}>结束备注</button></div>}
    <div className="studio-canvas-toolbar" role="toolbar" aria-label="白板工具" data-native-interactive="true">
      {TOOL_OPTIONS.map(({ tool: choice, label, key, icon: Icon }) => <button type="button" key={choice} aria-label={label} title={`${label}（${key}）`} aria-pressed={!annotating && (choice === tool || choice === 'stroke' && tool === 'arrow')} className={!annotating && (choice === tool || choice === 'stroke' && tool === 'arrow') ? 'is-active' : ''} onClick={() => { setTool(choice === 'stroke' && tool === 'arrow' ? 'arrow' : choice); setInteractiveId(null); if (annotating) onAnnotationModeChange?.(false); setToolMenu(['shape', 'stroke', 'sticker'].includes(choice) ? toolMenu === choice ? null : choice as 'shape' | 'stroke' | 'sticker' : null); }} disabled={saving || !canEdit && !['select', 'pan'].includes(choice)}><Icon size={20} />{['shape', 'stroke'].includes(choice) && <ChevronDown size={9} className="studio-tool-caret" />}</button>)}
    </div>
    {toolMenu === 'shape' && canEdit && <div className="studio-shape-options studio-insert-menu" data-native-interactive="true"><label>形状<select aria-label="形状类型" value={shapeKind} onChange={(event) => { setShapeKind(event.target.value); setTool('shape'); }}>{SHAPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><span>在画布上点击或拖动创建</span><hr /><button type="button" onClick={() => { setDialog({ type: 'table' }); setToolMenu(null); }}><Table2 size={17} />表格</button><button type="button" onClick={() => { setDialog({ type: 'link' }); setToolMenu(null); }}><Link size={17} />链接</button><button type="button" onClick={() => { onEditHtml ? onEditHtml() : setDialog({ type: 'html' }); setToolMenu(null); }}><Braces size={17} />HTML 图解</button></div>}
    {toolMenu === 'stroke' && canEdit && <div className="studio-shape-options studio-pen-menu" data-native-interactive="true"><div className="studio-pen-choices"><button type="button" aria-label="画笔模式" aria-pressed={tool === 'stroke'} onClick={() => setTool('stroke')}><PenLine size={17} />画笔</button><button type="button" aria-label="箭头模式" aria-pressed={tool === 'arrow'} onClick={() => setTool('arrow')}><ArrowUpRight size={17} />箭头</button></div><label>颜色<input aria-label="画笔颜色" type="color" value={penColor} onChange={event => setPenColor(event.target.value)} /></label><label>线宽<select aria-label="画笔线宽" value={penWidth} onChange={event => setPenWidth(Number(event.target.value))}>{[1, 2, 3, 4, 6, 8, 12].map(value => <option key={value} value={value}>{value}</option>)}</select></label></div>}
    {toolMenu === 'sticker' && canEdit && <StickerPalette selectedId={sticker} onSelect={choice => { setSticker(choice.id); setTool('sticker'); setToolMenu(null); }} onUpload={() => { fileInput.current?.click(); setToolMenu(null); }} />}
    {selectedElements.length > 0 && selectionBounds && !annotating && <CanvasFormatToolbar key={selection.join(',')} elements={selectedElements} style={{ left: clamp(viewport.x + (selectionBounds.x + selectionBounds.w / 2) * viewport.zoom, Math.min(280, (viewportElement.current?.clientWidth || 900) / 2), Math.max((viewportElement.current?.clientWidth || 900) / 2, (viewportElement.current?.clientWidth || 900) - 280)), top: clamp(viewport.y + selectionBounds.y * viewport.zoom - (selected?.type === 'html' ? 82 : 58), 12, Math.max(12, (viewportElement.current?.clientHeight || 600) - 145)) }} canEdit={canEdit} canAnnotate={canAnnotate} saving={saving} interactive={interactiveId === selected?.id} onChange={changes => { void updateSelected(changes); }} onEditText={() => { if (selected) beginEditing(selected); }} onTextFormat={formatText} onAnnotate={annotateSelected} onToggleInteractive={() => { if (selected) { setTool('select'); setInteractiveId(value => value === selected.id ? null : selected.id); } }} onOpenHtml={selected && onOpenHtml ? () => onOpenHtml(selected) : undefined} onMore={() => { if (selected?.type === 'html' && canEdit && onEditHtml) onEditHtml(selected); else setProperties(value => !value); }} />}
    {properties && selectedElements.length > 0 && <aside className="studio-canvas-properties" data-native-interactive="true" aria-label="元素属性" onFocusCapture={event => { if ((event.target as HTMLElement).matches('input,textarea,select')) setPropertyEditingIds(selectionRef.current); }} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPropertyEditingIds([]); }}>
      <div className="studio-properties-heading"><strong>{selectedElements.length > 1 ? `已选择 ${selectedElements.length} 项` : selected?.type === 'html' ? 'HTML 图解' : '元素属性'}</strong><button type="button" aria-label="关闭属性面板" onClick={() => setProperties(false)}><X size={15} /></button></div>
      {selected?.type === 'html' && <div className="studio-html-actions"><p>图解源码独立保存。选中其中的内容后，可带着批注让 Codex 修改。</p>{canAnnotate && <button type="button" onClick={() => { setAnnotation(true); }}><MessageSquare size={15} />标注图解内容</button>}<button type="button" onClick={() => { setTool('select'); setInteractiveId((value) => value === selected.id ? null : selected.id); }}>{interactiveId === selected.id ? '返回白板操作' : '播放动画 / 与内容交互'}</button><button type="button" onClick={() => htmlInput.current?.click()} disabled={!canEdit}>从 HTML 文件添加新图解</button>{canEdit && <button type="button" onClick={() => onEditHtml ? onEditHtml(selected) : setDialog({ type: 'html', element: selected })}><Braces size={15} />编辑 HTML 源码</button>}</div>}
      {canEdit && <fieldset className="studio-property-fields" disabled={saving}>
        {selected && !['image', 'html', 'stroke', 'table', 'diagram', 'chart'].includes(selected.type) && !(selected.type === 'sticker' && getBoardSticker(selected.data?.stickerIconId)) && <label>文字<textarea aria-label="属性文字" value={(selected.type === 'arrow' ? selected.label : selected.text) ?? ''} rows={3} onChange={event => stageSelected(selected.type === 'arrow' ? { label: event.target.value } : { text: event.target.value })} onBlur={() => { void savePropertyDrafts(selectionRef.current, '编辑文字'); }} /></label>}
        {selected?.type === 'shape' && <label>形状<select value={selected.kind ?? 'rounded'} onChange={(event) => void updateSelected({ kind: event.target.value })}>{SHAPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
        {selected && !['arrow', 'stroke'].includes(selected.type) && <div className="studio-property-pair"><label>宽<input aria-label="元素宽度" disabled={Boolean(selected.locked)} type="number" min={32} value={selected.w} onChange={event => { const w = Number(event.target.value); if (Number.isFinite(w)) stageSelected({ w }); }} onBlur={event => { if (Number(event.target.value) >= 32) void savePropertyDrafts(); }} /></label><label>高<input aria-label="元素高度" disabled={Boolean(selected.locked)} type="number" min={28} value={selected.h} onChange={event => { const h = Number(event.target.value); if (Number.isFinite(h)) stageSelected({ h }); }} onBlur={event => { if (Number(event.target.value) >= 28) void savePropertyDrafts(); }} /></label></div>}
        {selectedElements.every((element) => !['html', 'image', 'stroke', 'arrow', 'container'].includes(element.type) && !(element.type === 'sticker' && getBoardSticker(element.data?.stickerIconId))) && <><label>填充<div className="studio-color-swatches">{COLORS.map((color) => <button type="button" key={color} style={{ background: color }} title={color} aria-label={`填充 ${color}`} className={selected?.fill === color ? 'is-active' : ''} onClick={() => void updateSelected({ fill: color })} />)}<input aria-label="自定义填充颜色" type="color" value={/^#[0-9a-f]{6}$/i.test(selected?.fill ?? '') ? selected!.fill : '#ffffff'} onChange={(event) => void updateSelected({ fill: event.target.value })} /></div></label><label>文字大小<input aria-label="文字大小" type="number" min={8} max={160} value={selected?.fontSize ?? 17} onChange={event => stageSelected({ fontSize: Number(event.target.value) })} onBlur={(event) => { const value = Number(event.target.value); if (value >= 8 && value <= 160) void savePropertyDrafts(); }} /></label></>}
        {selected?.type === 'shape' && <label className="studio-property-check"><input aria-label="空心形状" type="checkbox" checked={Boolean(selected.hollow)} onChange={event => void updateSelected({ hollow: event.target.checked })} />空心（仅保留轮廓）</label>}
        {selectedElements.every(element => ['shape', 'arrow', 'stroke'].includes(element.type)) && <><label>线条宽度<input aria-label="线条宽度" type="number" min={.1} max={100} step={.5} value={Number(selected?.strokeWidth ?? selected?.width ?? (selected?.type === 'stroke' ? 3 : 1.8))} onChange={event => stageSelected({ strokeWidth: Number(event.target.value) })} onBlur={event => { if (Number(event.target.value) > 0 && Number(event.target.value) <= 100) void savePropertyDrafts(); }} /></label><label className="studio-property-check"><input aria-label="虚线" type="checkbox" checked={Boolean(selected?.dash)} onChange={event => void updateSelected({ dash: event.target.checked })} />虚线</label></>}
        {selected?.type === 'arrow' && <><div className="studio-property-pair">{(['起点', '终点'] as const).map((label, index) => <label key={label}>{label}<select aria-label={`连接线${label}`} value={arrowHeads(selected)[index]} onChange={event => { const heads = arrowHeads(selected); heads[index] = event.target.value as typeof heads[number]; void updateSelected({ heads }); }}><option value="none">无</option><option value="arrow">箭头</option><option value="circle">圆点</option></select></label>)}</div><p className="studio-property-muted">起点与终点分别设置；不改变连接方向或已有路线。</p></>}
        {selectedElements.every((element) => element.type !== 'html' && element.type !== 'image' && !(element.type === 'sticker' && getBoardSticker(element.data?.stickerIconId))) && <label>线条 / 文字<div className="studio-color-swatches">{STROKES.map((color) => <button type="button" key={color} style={{ background: color }} title={color} aria-label={`颜色 ${color}`} onClick={() => void updateSelected({ color, stroke: color })} />)}</div></label>}
        {selected?.type === 'table' && <button type="button" className="studio-property-action" onClick={() => setDialog({ type: 'table', element: selected })}>编辑表格内容</button>}
        {selected?.type === 'image' && selected.src && !selected.video && <button disabled={Boolean(selected.locked)} type="button" className="studio-property-action" onClick={() => setCropDialog(selected)}>裁剪图片</button>}
        {selectedElements.some(element => propertyDrafts[element.id]) && <button type="button" className="studio-property-action" onClick={() => void savePropertyDrafts()}>保存属性草稿</button>}
        <div className="studio-property-actions"><button type="button" title="复制" aria-label="复制所选元素" onClick={() => duplicate()} disabled={saving}><Copy size={17} /></button>{selectedElements.length > 1 && <button type="button" title="组合" aria-label="组合所选元素" onClick={() => void group()} disabled={saving}><Group size={17} /></button>}{selectedElements.some((element) => element.groupId) && <button type="button" title="取消组合" aria-label="取消组合" onClick={() => void updateSelected({ groupId: '' }, '取消组合')} disabled={saving}><Ungroup size={17} /></button>}<button type="button" title={selectedElements.every(element => element.locked) ? '解锁位置' : '锁定位置与尺寸'} aria-label={selectedElements.every(element => element.locked) ? '解锁元素' : '锁定元素'} onClick={() => void updateSelected({ locked: !selectedElements.every(element => element.locked) })} disabled={saving}>{selected?.locked ? <Unlock size={17} /> : <Lock size={17} />}</button><button type="button" className="studio-danger" title="删除" aria-label="删除所选元素" onClick={remove} disabled={saving || selectedElements.some(element => element.locked)}><Trash2 size={17} /></button></div>
      </fieldset>}
      {!canEdit && <p className="studio-property-muted">当前身份可以查看{canAnnotate ? '和批注' : ''}内容。</p>}
    </aside>}
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
