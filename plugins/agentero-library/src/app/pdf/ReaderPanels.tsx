import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Copy, Highlighter, Languages, LoaderCircle, MessageSquare, Pencil, Pin, Plus, Save, Send, Trash2, Underline, X } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { BookmarkNode, MarkColor } from '../../contracts/reader';
import { messageOf } from '../model';
import { COLORS, COLOR_HEX, COLOR_LABEL } from './geometry';

export interface SelectionPart { page: number; rects: { x: number; y: number; w: number; h: number }[]; pageSize: { width: number; height: number }; quote: string }
export interface ScreenBounds { left: number; top: number; right: number; bottom: number }
export interface ReaderSelection { text: string; parts: SelectionPart[]; x: number; y: number; bounds?: ScreenBounds; viewportBounds?: ScreenBounds; asset?: { mediaType: 'image/png'; data: string } }
export interface SelectionDraft { mode: 'actions' | 'comment'; text: string; color: MarkColor }
export interface MarkEditorDraft { text?: string; color?: MarkColor; reply?: string }

/** A floating editor must fit the reading viewport without covering its source. */
export function selectionMenuPlacement(source: ScreenBounds, viewport: ScreenBounds, width: number, height: number): { left: number; top: number } | null {
  const edge = 8; const gap = 10; const left = viewport.left + edge; const right = viewport.right - edge; const top = viewport.top + edge; const bottom = viewport.bottom - edge;
  if (width > right - left || height > bottom - top || source.right <= left || source.left >= right || source.bottom <= top || source.top >= bottom) return null;
  const x = Math.max(left, Math.min(right - width, source.left)); const y = Math.max(top, Math.min(bottom - height, source.top));
  if (source.top - gap - height >= top) return { left: x, top: source.top - gap - height };
  if (source.bottom + gap + height <= bottom) return { left: x, top: source.bottom + gap };
  if (source.right + gap + width <= right) return { left: source.right + gap, top: y };
  if (source.left - gap - width >= left) return { left: source.left - gap - width, top: y };
  return null;
}

export function ColorPicker({ value, disabled, onChange }: { value: MarkColor; disabled?: boolean; onChange(color: MarkColor): void }) {
  return <div className="pdf-colors" aria-label="批注颜色">{COLORS.map(color => <button key={color} type="button" className={`pdf-color ${value === color ? 'selected' : ''}`} title={`${COLOR_LABEL[color]} · 只选择颜色`} aria-label={`${COLOR_LABEL[color]}批注颜色`} aria-pressed={value === color} disabled={disabled} style={{ '--swatch': COLOR_HEX[color] } as React.CSSProperties} onClick={() => onChange(color)} />)}</div>;
}

export function SelectionToolbar({ selection, busy, canSend, onCopy, onMark, onTranslate, onAsk, onClose, initialDraft, onDraftChange, docked = false, onDock }: {
  selection: ReaderSelection; busy: boolean; canSend: boolean; onCopy(): void;
  onMark(color: MarkColor, comment: string, underline?: boolean): void; onTranslate(): void; onAsk(): void; onClose(): void;
  initialDraft?: SelectionDraft; onDraftChange?(draft: SelectionDraft): void; docked?: boolean; onDock?(): void;
}) {
  const [mode, setMode] = useState<'actions' | 'comment'>(initialDraft?.mode ?? (selection.asset ? 'comment' : 'actions'));
  const [draft, setDraft] = useState(initialDraft?.text ?? ''); const [color, setColor] = useState<MarkColor>(initialDraft?.color ?? 'yellow');
  const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null); const root = useRef<HTMLDivElement>(null);
  const bounds = selection.viewportBounds ?? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  const width = Math.max(0, Math.min(450, bounds.right - bounds.left - 16));
  const change = (next: Partial<SelectionDraft>) => { const value = { mode, text: draft, color, ...next }; setMode(value.mode); setDraft(value.text); setColor(value.color); onDraftChange?.(value); };
  useLayoutEffect(() => {
    if (docked || !root.current) return;
    const place = () => { const rect = root.current?.getBoundingClientRect(); if (!rect) return; const next = selectionMenuPlacement(selection.bounds ?? { left: selection.x, right: selection.x + 1, top: selection.y, bottom: selection.y + 1 }, bounds, rect.width, rect.height); setPlacement(next); if (!next) onDock?.(); };
    place(); const observer = new ResizeObserver(place); observer.observe(root.current); return () => observer.disconnect();
  }, [selection, mode, docked, width]);
  const submit = () => onMark(color, draft, false);
  return <div ref={root} className={`pdf-selection-menu ${docked ? 'pdf-selection-menu--docked' : ''}`} role="dialog" aria-label={docked ? '固定选区编辑区' : '选区操作'} style={docked ? undefined : { left: placement?.left, top: placement?.top, width, maxHeight: bounds.bottom - bounds.top - 16, visibility: placement ? 'visible' : 'hidden' }} onPointerDown={event => { if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof Element && event.target.closest('button'))) event.preventDefault(); }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <div className="pdf-selection-top"><span>{docked && '固定编辑区 · '}{selection.parts.length > 1 ? `${selection.parts.length} 页选区` : `第 ${selection.parts[0]?.page} 页`} · {selection.text.length} 字符</span><button className="icon-button" aria-label="收起选区操作并保留草稿" disabled={busy} onClick={onClose}><X size={14} /></button></div>
    {docked && selection.text && <blockquote className="pdf-selection-source">{selection.text}</blockquote>}
    {selection.asset && <img className="pdf-crop-preview" alt="选中的 PDF 区域" src={`data:image/png;base64,${selection.asset.data}`} />}
    <div className="pdf-selection-buttons">{!selection.asset && <button disabled={busy} onClick={onCopy}><Copy size={14} />复制</button>}{!selection.asset && <><ColorPicker value={color} disabled={busy} onChange={value => change({ color: value })} /><button disabled={busy || Boolean(draft.trim())} title={draft.trim() ? '请先保存备注或清空备注草稿' : '创建高亮'} onClick={() => onMark(color, '', false)}><Highlighter size={14} />高亮</button><button disabled={busy || Boolean(draft.trim())} title={draft.trim() ? '请先保存备注或清空备注草稿' : '创建下划线'} onClick={() => onMark(color, '', true)}><Underline size={15} />下划线</button></>}
      <button disabled={busy} className={mode === 'comment' ? 'selected' : ''} onClick={() => change({ mode: 'comment' })}><MessageSquare size={14} />备注</button>
      {!selection.asset && <button disabled={busy} onClick={onTranslate}><Languages size={14} />翻译</button>}
      {!selection.asset && <button disabled={busy || !canSend || selection.text.length > 20_000} onClick={onAsk}><Send size={14} />带到对话</button>}
    </div>
    {mode !== 'actions' && <><textarea autoFocus aria-label="选区备注" placeholder="输入这段选区的备注" maxLength={20_000} value={draft} onChange={event => change({ text: event.target.value })} disabled={busy} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submit(); } }} /><div className="pdf-selection-submit"><span>Ctrl / ⌘ + Enter</span><button className="primary" disabled={busy || (!draft.trim() && !selection.asset)} onClick={submit}>{busy ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}{selection.asset ? '保存区域' : '保存备注'}</button></div></>}
  </div>;
}

export interface FloatingTranslation { selection: ReaderSelection; loading: boolean; text: string; error: string; markId?: string; pinned: boolean }
export function TranslationCard({ value, busy, onPin, onClose, onRetry, onCopy }: { value: FloatingTranslation; busy: boolean; onPin(): void; onClose(): void; onRetry(): void; onCopy(): void }) {
  const width = Math.min(380, window.innerWidth - 16); const left = Math.max(8, Math.min(window.innerWidth - width - 8, value.selection.x + 14)); const top = Math.max(8, Math.min(window.innerHeight - 230, value.selection.y - 20));
  return <section className="pdf-translation-card" role="dialog" aria-label="选区翻译" style={{ left, top, width }}><header><strong>选区翻译 · 第 {value.selection.parts[0]?.page} 页</strong><span className="toolbar-spacer" /><button className={`icon-button ${value.pinned ? 'selected' : ''}`} aria-label={value.pinned ? '翻译已固定' : '固定翻译'} disabled={busy || value.loading || !value.text || value.pinned} onClick={onPin}><Pin size={14} /></button><button className="icon-button" aria-label="关闭翻译卡" onClick={onClose}><X size={15} /></button></header>
    <blockquote>{value.selection.text}</blockquote><div className="pdf-translation-result">{value.loading ? <span><LoaderCircle className="spin" size={15} />正在翻译…</span> : value.error ? <p className="error-text" role="alert">{value.error}</p> : value.text}</div><footer><span>{value.pinned ? '已保存为页内翻译标记' : '固定后可从论文中再次打开'}</span>{value.error ? <button onClick={onRetry}>重试</button> : <button disabled={!value.text || value.loading} onClick={onCopy}><Copy size={13} />复制译文</button>}</footer>
  </section>;
}

export { AnnotationsWorkspace as MarksPanel, MarkEditor } from './AnnotationsWorkspace';

interface EditableBookmark extends BookmarkNode { id: string; destination?: unknown; children: EditableBookmark[] }
export function outlineToEditable(items: { title: string; dest?: unknown; items?: unknown[] }[], prefix = ''): EditableBookmark[] {
  return items.map((item, index) => ({ id: `${prefix}${index}`, origin: `${prefix}${index}`, originalTitle: item.title, title: item.title, destination: item.dest, children: outlineToEditable((item.items ?? []) as typeof items, `${prefix}${index}.`) }));
}
function updateNode(nodes: EditableBookmark[], id: string, change: (node: EditableBookmark) => EditableBookmark | null): EditableBookmark[] {
  return nodes.flatMap(node => { if (node.id !== id) return [{ ...node, children: updateNode(node.children, id, change) }]; const next = change(node); return next ? [next] : node.children; });
}
export function OutlinePanel({ document, currentPage, busy, onNavigate, onSave, onClose }: { document: PDFDocumentProxy; currentPage: number; busy: boolean; onNavigate(destination: unknown, pageIndex?: number): void; onSave(nodes: BookmarkNode[]): Promise<void>; onClose(): void }) {
  const [nodes, setNodes] = useState<EditableBookmark[]>([]); const [editing, setEditing] = useState<string | null>(null); const [draft, setDraft] = useState(''); const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const failed = useRef<EditableBookmark[] | null>(null); const lock = useRef(false);
  useEffect(() => { let cancelled = false; void document.getOutline().then(items => { if (!cancelled) { setNodes(outlineToEditable(items ?? [])); setError(''); } }).catch(cause => { if (!cancelled) setError(messageOf(cause)); }); return () => { cancelled = true; }; }, [document]);
  async function commit(next: EditableBookmark[]) {
    if (lock.current) return;
    lock.current = true; setNodes(next); setEditing(null); setError(''); setSaving(true);
    const serialize = (items: EditableBookmark[]): BookmarkNode[] => items.map(node => ({ title: node.title, origin: node.origin, originalTitle: node.originalTitle, pageIndex: node.pageIndex, children: serialize(node.children) }));
    try { await onSave(serialize(next)); failed.current = null; }
    catch (cause) { failed.current = next; setError(messageOf(cause)); }
    finally { lock.current = false; setSaving(false); }
  }
  const newNode = (): EditableBookmark => ({ id: crypto.randomUUID(), origin: null, title: `第 ${currentPage} 页`, pageIndex: currentPage - 1, children: [] });
  const tree = (items: EditableBookmark[], depth = 0) => <ul className="pdf-edit-outline">{items.map(node => <li key={node.id}><div style={{ paddingLeft: depth * 12 }}>
    {editing === node.id ? <input autoFocus aria-label="书签标题" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && draft.trim()) void commit(updateNode(nodes, node.id, item => ({ ...item, title: draft.trim() }))); if (event.key === 'Escape') setEditing(null); }} onBlur={() => { if (draft.trim()) void commit(updateNode(nodes, node.id, item => ({ ...item, title: draft.trim() }))); else setEditing(null); }} /> : <button className="pdf-bookmark-title" onClick={() => onNavigate(node.destination, node.pageIndex)}>{node.title || '未命名书签'}</button>}
    <button className="icon-button" aria-label={`重命名书签 ${node.title}`} disabled={busy || saving} onClick={() => { setDraft(node.title); setEditing(node.id); }}><Pencil size={12} /></button><button className="icon-button" aria-label={`添加子书签到 ${node.title}`} disabled={busy || saving} onClick={() => void commit(updateNode(nodes, node.id, item => ({ ...item, children: [...item.children, newNode()] })))}><Plus size={12} /></button><button className="icon-button" aria-label={`删除书签 ${node.title}`} disabled={busy || saving} onClick={() => void commit(updateNode(nodes, node.id, () => null))}><Trash2 size={12} /></button></div>{node.children.length > 0 && tree(node.children, depth + 1)}</li>)}</ul>;
  return <aside className="pdf-outline-panel" aria-label="PDF 目录"><header className="pdf-panel-heading"><strong>目录与书签</strong><button className="icon-button" aria-label="关闭目录" onClick={onClose}><X size={15} /></button></header><div className="pdf-outline-actions"><button disabled={busy || saving} onClick={() => void commit([...nodes, newNode()])}><Plus size={13} />当前页书签</button>{saving && <LoaderCircle size={14} className="spin" />}</div>{error && <div className="callout error" role="alert">{error}<button disabled={saving || busy} onClick={() => { if (failed.current) void commit(failed.current); }}>重试保存</button></div>}<div className="pdf-outline-scroll">{nodes.length ? tree(nodes) : <p className="field-help">该 PDF 没有目录，可为当前页添加书签。</p>}</div><p className="field-help pdf-outline-help">新增、改名和删除会写回当前 PDF；引用目标保持原样。</p></aside>;
}
