import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, Download, Highlighter, Languages, LoaderCircle, MessageSquare, Pencil, Pin, Plus, Send, Trash2, Underline, X } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { BookmarkNode, MarkColor, MarkList, ReaderMark } from '../../contracts/reader';
import { callTool } from '../api';
import { messageOf } from '../model';
import { COLORS, COLOR_HEX, COLOR_LABEL, KIND_LABEL, markText } from './geometry';
import { filterMarks, markGroupState, marksByPage, selectedMarkSummary, toggleMarkGroup } from './mark-selection';
import { MarkContextTarget, type MarkBatchAction, type MarkBatchTarget } from './MarkContextTarget';

export interface SelectionPart { page: number; rects: { x: number; y: number; w: number; h: number }[]; pageSize: { width: number; height: number }; quote: string }
export interface ReaderSelection { text: string; parts: SelectionPart[]; x: number; y: number; asset?: { mediaType: 'image/png'; data: string } }

export function ColorPicker({ value, disabled, onChange }: { value: MarkColor; disabled?: boolean; onChange(color: MarkColor): void }) {
  return <div className="pdf-colors" aria-label="批注颜色">{COLORS.map(color => <button key={color} type="button" className={`pdf-color ${value === color ? 'selected' : ''}`} title={COLOR_LABEL[color]} aria-label={`${COLOR_LABEL[color]}高亮`} aria-pressed={value === color} disabled={disabled} style={{ '--swatch': COLOR_HEX[color] } as React.CSSProperties} onClick={() => onChange(color)}>{value === color && <Check size={12} />}</button>)}</div>;
}

export function SelectionToolbar({ selection, busy, canSend, onCopy, onMark, onTranslate, onAsk, onClose }: {
  selection: ReaderSelection; busy: boolean; canSend: boolean; onCopy(): void;
  onMark(color: MarkColor, comment: string, underline?: boolean): void; onTranslate(): void; onAsk(): void; onClose(): void;
}) {
  const [mode, setMode] = useState<'actions' | 'comment'>(selection.asset ? 'comment' : 'actions');
  const [draft, setDraft] = useState(''); const [color, setColor] = useState<MarkColor>('yellow'); const [underline, setUnderline] = useState(false);
  const width = Math.min(450, window.innerWidth - 16); const left = Math.max(8, Math.min(window.innerWidth - width - 8, selection.x)); const top = Math.max(8, Math.min(window.innerHeight - (mode === 'actions' ? 90 : 210), selection.y - 85));
  const submit = () => onMark(color, draft, underline);
  return <div className="pdf-selection-menu" role="dialog" aria-label="选区操作" style={{ left, top, width }} onPointerDown={event => { if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) event.preventDefault(); }}>
    <div className="pdf-selection-top"><span>{selection.parts.length > 1 ? `${selection.parts.length} 页选区` : `第 ${selection.parts[0]?.page} 页`} · {selection.text.length} 字符</span><button className="icon-button" aria-label="关闭选区操作" disabled={busy} onClick={onClose}><X size={14} /></button></div>
    {selection.asset && <img className="pdf-crop-preview" alt="选中的 PDF 区域" src={`data:image/png;base64,${selection.asset.data}`} />}
    <div className="pdf-selection-buttons">{!selection.asset && <button disabled={busy} onClick={onCopy}><Copy size={14} />复制</button>}{!selection.asset && <><ColorPicker value={color} disabled={busy} onChange={value => { setColor(value); if (mode === 'actions') onMark(value, '', underline); }} /><button className={underline ? 'selected' : ''} title="切换下划线标记" aria-pressed={underline} disabled={busy} onClick={() => setUnderline(value => !value)}><Underline size={15} /></button></>}
      <button disabled={busy} className={mode === 'comment' ? 'selected' : ''} onClick={() => setMode('comment')}><MessageSquare size={14} />备注</button>
      {!selection.asset && <button disabled={busy} onClick={onTranslate}><Languages size={14} />翻译</button>}
      {!selection.asset && <button disabled={busy || !canSend || selection.text.length > 20_000} onClick={onAsk}><Send size={14} />带到对话</button>}
    </div>
    {mode !== 'actions' && <><textarea autoFocus aria-label="选区备注" placeholder="输入这段选区的备注" maxLength={20_000} value={draft} onChange={event => setDraft(event.target.value)} disabled={busy} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submit(); } }} /><div className="pdf-selection-submit"><span>Ctrl / ⌘ + Enter</span><button className="primary" disabled={busy || (!draft.trim() && !selection.asset)} onClick={submit}>{busy ? <LoaderCircle size={14} className="spin" /> : <Highlighter size={14} />}{selection.asset ? '保存区域' : '保存备注'}</button></div></>}
  </div>;
}

export interface FloatingTranslation { selection: ReaderSelection; loading: boolean; text: string; error: string; markId?: string; pinned: boolean }
export function TranslationCard({ value, busy, onPin, onClose, onRetry, onCopy }: { value: FloatingTranslation; busy: boolean; onPin(): void; onClose(): void; onRetry(): void; onCopy(): void }) {
  const width = Math.min(380, window.innerWidth - 16); const left = Math.max(8, Math.min(window.innerWidth - width - 8, value.selection.x + 14)); const top = Math.max(8, Math.min(window.innerHeight - 230, value.selection.y - 20));
  return <section className="pdf-translation-card" role="dialog" aria-label="选区翻译" style={{ left, top, width }}><header><strong>选区翻译 · 第 {value.selection.parts[0]?.page} 页</strong><span className="toolbar-spacer" /><button className={`icon-button ${value.pinned ? 'selected' : ''}`} aria-label={value.pinned ? '翻译已固定' : '固定翻译'} disabled={busy || value.loading || !value.text || value.pinned} onClick={onPin}><Pin size={14} /></button><button className="icon-button" aria-label="关闭翻译卡" onClick={onClose}><X size={15} /></button></header>
    <blockquote>{value.selection.text}</blockquote><div className="pdf-translation-result">{value.loading ? <span><LoaderCircle className="spin" size={15} />正在翻译…</span> : value.error ? <p className="error-text" role="alert">{value.error}</p> : value.text}</div><footer><span>{value.pinned ? '已保存为页内翻译标记' : '固定后可从论文中再次打开'}</span>{value.error ? <button onClick={onRetry}>重试</button> : <button disabled={!value.text || value.loading} onClick={onCopy}><Copy size={13} />复制译文</button>}</footer>
  </section>;
}

export function MarksPanel({ list, selectedId, busy, error, onSelect, onSave, onDelete, onReply, onRefresh, onExport, onClose, checkedIds, onCheckedChange, canAttach, onAttach }: {
  list: MarkList | null; selectedId: string | null; busy: boolean; error: string;
  onSelect(mark: ReaderMark): void; onSave(mark: ReaderMark, text: string, color: MarkColor): Promise<void>;
  onDelete(mark: ReaderMark): Promise<void>; onReply(mark: ReaderMark, text: string): Promise<void>;
  onRefresh(): void; onExport(format: 'pdf' | 'markdown' | 'json'): void; onClose(): void;
  checkedIds: ReadonlySet<string>; onCheckedChange(ids: Set<string>): void; canAttach: boolean;
  onAttach(action: MarkBatchAction, ids: string[], target?: MarkBatchTarget): Promise<void>;
}) {
  const [filter, setFilter] = useState(''); const [kind, setKind] = useState('all'); const [commentsOnly, setCommentsOnly] = useState(false);
  const [selectedOnly, setSelectedOnly] = useState(false); const [page, setPage] = useState(0); const [menu, setMenu] = useState(false);
  const [target, setTarget] = useState<{ action: 'create-note' | 'update-note'; ids: string[] } | null>(null); const [attachError, setAttachError] = useState(''); const [attaching, setAttaching] = useState(false); const attachLock = useRef(false); const menuRoot = useRef<HTMLDivElement>(null);
  const selected = list?.items.find(mark => mark.id === selectedId);
  const items = filterMarks(list?.items ?? [], selectedOnly ? { query: '', kind: 'all', commentsOnly: false, selectedOnly: true } : { query: filter, kind, commentsOnly }, checkedIds);
  const groups = marksByPage(items); const summary = selectedMarkSummary(list?.items ?? [], checkedIds); const totalPages = Math.max(1, Math.ceil(groups.length / 6)); const currentPage = Math.min(page, totalPages - 1);
  useEffect(() => { if (!menu) return; const outside = (event: PointerEvent) => { if (event.target instanceof Node && !menuRoot.current?.contains(event.target)) setMenu(false); }; const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(false); }; document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape); return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); }; }, [menu]);
  async function attach(action: MarkBatchAction, ids: string[], target?: MarkBatchTarget) { if (attachLock.current) return; attachLock.current = true; setAttaching(true); setAttachError(''); try { await onAttach(action, ids, target); } catch (cause) { setAttachError(messageOf(cause)); throw cause; } finally { attachLock.current = false; setAttaching(false); } }
  function chooseAction(action: MarkBatchAction) { setMenu(false); const ids = summary.items.map(mark => mark.id); if (action === 'create-note' || action === 'update-note') setTarget({ action, ids }); else void attach(action, ids).catch(() => {}); }
  return <aside className="pdf-marks-panel" aria-label="论文批注"><header className="pdf-panel-heading"><strong>批注 <span className="count">{list?.items.length ?? 0}</span></strong><button className="icon-button" aria-label="关闭批注列表" onClick={onClose}><X size={15} /></button></header><div className="pdf-mark-filters"><input aria-label="搜索批注" placeholder="查找引用或备注" value={filter} onChange={event => setFilter(event.target.value)} /><select aria-label="批注类型" value={kind} onChange={event => setKind(event.target.value)}><option value="all">全部类型</option>{Object.entries(KIND_LABEL).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select><button disabled={busy} onClick={onRefresh}>刷新</button></div>
    <div className="pdf-mark-select-tools"><label><input type="checkbox" checked={commentsOnly} onChange={event => { setCommentsOnly(event.target.checked); setPage(0); }} />含备注或回复</label><button disabled={!items.length || busy} onClick={() => onCheckedChange(toggleMarkGroup(checkedIds, items))}>{markGroupState(items, checkedIds) === 'all' ? '取消筛选结果' : '选择筛选结果'}</button></div>
    {groups.length > 0 && <div className="pdf-mark-pages" aria-label="按物理页多选">{groups.map(group => <button key={group.page} aria-label={`选择物理第 ${group.page} 页的筛选批注`} aria-pressed={markGroupState(group.marks, checkedIds) === 'some' ? 'mixed' : markGroupState(group.marks, checkedIds) === 'all'} className={markGroupState(group.marks, checkedIds) !== 'none' ? 'selected' : ''} onClick={() => onCheckedChange(toggleMarkGroup(checkedIds, group.marks))}>第 {group.page} 页{markGroupState(group.marks, checkedIds) === 'some' && ' · 部分'}</button>)}</div>}
    {error && <p className="callout error" role="alert">{error}</p>}
    <div className="pdf-marks-list">{groups.slice(currentPage * 6, currentPage * 6 + 6).map(group => <section key={group.page} className="pdf-mark-page-group" aria-label={`物理第 ${group.page} 页批注`}><header><GroupCheckbox label={`选择物理第 ${group.page} 页批注`} state={markGroupState(group.marks, checkedIds)} onChange={() => onCheckedChange(toggleMarkGroup(checkedIds, group.marks))} /><strong>物理第 {group.page} 页</strong><small>{group.marks.length} 条</small></header>{group.marks.map(mark => <div key={mark.id} className="pdf-mark-choice"><input type="checkbox" aria-label={`选择第 ${mark.page} 页批注 ${mark.quote.slice(0, 30) || mark.id}`} checked={checkedIds.has(mark.id)} onChange={() => onCheckedChange(toggleMarkGroup(checkedIds, [mark]))} /><button className={`pdf-mark-entry ${selectedId === mark.id ? 'selected' : ''}`} onClick={() => onSelect(mark)}><small>{KIND_LABEL[mark.kind]}</small><blockquote>{mark.quote || '区域标注'}</blockquote>{markText(mark) && <span>{markText(mark)}</span>}{Boolean(mark.messages?.length) && <small>{mark.messages!.length} 条回复</small>}</button></div>)}</section>)}{!items.length && <p className="field-help">{selectedOnly ? '尚未选择批注。' : '没有匹配的批注。选中文字或框选区域后添加。'}</p>}</div>
    {totalPages > 1 && <nav className="pdf-marks-pagination" aria-label="批注列表分页"><button aria-label="上一组批注页" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一组</button><span>{currentPage + 1} / {totalPages}</span><button aria-label="下一组批注页" disabled={currentPage + 1 === totalPages} onClick={() => setPage(currentPage + 1)}>下一组</button></nav>}
    {selected && list && <MarkEditor key={selected.id} mark={selected} vaultId={list.vaultId} paperPath={list.paperPath} busy={busy} onSave={onSave} onDelete={onDelete} onReply={onReply} />}
    <div className="pdf-mark-batch-bar"><div><strong>已选 {summary.items.length} 条 / {summary.pages.length} 页</strong><button aria-pressed={selectedOnly} disabled={!summary.items.length && !selectedOnly} onClick={() => { setSelectedOnly(value => !value); setPage(0); }}>{selectedOnly ? '返回全部' : '查看已选'}</button><button disabled={!checkedIds.size} onClick={() => onCheckedChange(new Set())}>清空</button></div>{!canAttach && <span className="field-help">当前宿主不支持附加到对话输入框。</span>}{attachError && <p className="error-text" role="alert">{attachError}</p>}<div ref={menuRoot} className="pdf-mark-batch-actions"><button className="primary" disabled={!canAttach || !summary.items.length || busy || attaching} onClick={() => chooseAction('summarize')}><Send size={13} />{attaching ? '附加中…' : '带到对话'}</button><button aria-label="选择批注对话操作" aria-haspopup="menu" aria-expanded={menu} disabled={!canAttach || !summary.items.length || busy || attaching} onClick={() => setMenu(value => !value)}><ChevronDown size={15} /></button>{menu && <div role="menu" aria-label="批注对话操作"><button role="menuitem" onClick={() => chooseAction('summarize')}>在对话中总结</button><button role="menuitem" onClick={() => chooseAction('create-note')}>整理并保存为新笔记…</button><button role="menuitem" onClick={() => chooseAction('update-note')}>整理并更新已有笔记…</button><button role="menuitem" onClick={() => chooseAction('revise-paper')}>根据批注修订论文正文 Markdown</button></div>}</div></div>
    <details className="pdf-export-actions"><summary>导出批注</summary><div><button disabled={busy} onClick={() => onExport('markdown')}><Download size={13} />Markdown</button><button disabled={busy} onClick={() => onExport('json')}>JSON</button><button disabled={busy} onClick={() => onExport('pdf')}>带批注 PDF</button></div></details>
    {target && list && <MarkContextTarget action={target.action} vaultId={list.vaultId} paperPath={list.paperPath} onSubmit={value => attach(target.action, target.ids, value)} onClose={() => setTarget(null)} />}
  </aside>;
}
function GroupCheckbox({ label, state, onChange }: { label: string; state: 'none' | 'some' | 'all'; onChange(): void }) {
  const ref = useRef<HTMLInputElement>(null); useEffect(() => { if (ref.current) ref.current.indeterminate = state === 'some'; }, [state]);
  return <input ref={ref} type="checkbox" aria-label={label} aria-checked={state === 'some' ? 'mixed' : state === 'all'} checked={state === 'all'} onChange={onChange} />;
}

function MarkEditor({ mark, vaultId, paperPath, busy, onSave, onDelete, onReply }: { mark: ReaderMark; vaultId: string; paperPath: string; busy: boolean; onSave(mark: ReaderMark, text: string, color: MarkColor): Promise<void>; onDelete(mark: ReaderMark): Promise<void>; onReply(mark: ReaderMark, text: string): Promise<void> }) {
  const [text, setText] = useState(mark.kind === 'translate' ? mark.result ?? mark.note : mark.comment ?? mark.note); const [color, setColor] = useState<MarkColor>(mark.color ?? 'yellow');
  const [reply, setReply] = useState(''); const [error, setError] = useState(''); const [confirmDelete, setConfirmDelete] = useState(false);
  const [asset, setAsset] = useState<string | null>(null);
  useEffect(() => {
    if (!mark.asset) return;
    let cancelled = false;
    // The backend resolves the asset by mark id and bounds it to this paper.
    void callTool<{ base64: string; mediaType?: string; mimeType?: string }>('mark_asset_read', { vaultId, paperPath, id: mark.id }).then(value => { if (!cancelled) setAsset(`data:${value.mediaType ?? value.mimeType ?? 'image/png'};base64,${value.base64}`); }).catch(() => {});
    return () => { cancelled = true; };
  }, [mark]);
  async function run(action: () => Promise<void>) { setError(''); try { await action(); } catch (cause) { setError(messageOf(cause)); } }
  return <section className="pdf-mark-editor" aria-label="编辑批注"><div className="section-heading"><strong>编辑{KIND_LABEL[mark.kind]}</strong><span>第 {mark.page} 页</span></div>{asset && <img src={asset} alt="区域批注截图" />}
    {mark.question && <p className="field-help">问题：{mark.question}</p>}<label>{mark.kind === 'translate' ? '译文' : '备注'}<textarea aria-label="批注内容" value={text} maxLength={20_000} onChange={event => setText(event.target.value)} disabled={busy} /></label><ColorPicker value={color} disabled={busy} onChange={setColor} />
    <div className="button-row"><button disabled={busy} onClick={() => void run(() => onSave(mark, text, color))}><Pencil size={13} />保存修改</button><button className="danger" disabled={busy} onClick={() => setConfirmDelete(value => !value)}><Trash2 size={13} />删除</button></div>
    {confirmDelete && <div className="pdf-delete-confirm"><span>删除此批注及其备注？</span><button className="danger" disabled={busy} onClick={() => void run(() => onDelete(mark))}>确认删除</button><button onClick={() => setConfirmDelete(false)}>取消</button></div>}
    {Boolean(mark.messages?.length) && <ol className="pdf-mark-thread">{mark.messages!.map(message => <li key={message.id}><small>{message.role === 'assistant' ? '模型' : '用户'} · {new Date(message.createdAt).toLocaleString()}</small><p>{message.content}</p></li>)}</ol>}
    <label>追加回复<textarea aria-label="批注回复" value={reply} maxLength={10_000} onChange={event => setReply(event.target.value)} disabled={busy} /></label><button disabled={busy || !reply.trim()} onClick={() => void run(async () => { await onReply(mark, reply); setReply(''); })}>保存回复</button>{error && <p className="error-text" role="alert">{error}</p>}
  </section>;
}

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
