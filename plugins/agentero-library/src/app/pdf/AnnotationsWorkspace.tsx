import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Ellipsis, ExternalLink, Filter, LocateFixed, Pencil, Save, Send, Trash2, X } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { MarkColor, MarkList, ReaderMark } from '../../contracts/reader';
import { callTool } from '../api';
import { messageOf } from '../model';
import { AnchoredMenu } from '../ui/AnchoredMenu';
import { COLORS, COLOR_HEX, COLOR_LABEL, KIND_LABEL, markText } from './geometry';
import { toggleMarkGroup } from './mark-selection';
import { MarkContextTarget, type MarkBatchAction, type MarkBatchTarget } from './MarkContextTarget';
import { ColorPicker, type MarkEditorDraft } from './ReaderPanels';
import { annotationDraftDirty, buildAnnotationWorkspace, createAnnotationWorkspaceState, type AnnotationWorkspaceState } from './annotation-workspace';
import { AnnotationManagerFrame, AnnotationSourcePreview } from './AnnotationManager';
import './annotations-workspace.css';

export interface AnnotationsWorkspaceProps {
  list: MarkList | null; selectedId: string | null; busy: boolean; error: string;
  onSelect(mark: ReaderMark): void; onSave(mark: ReaderMark, text: string, color: MarkColor): Promise<void>;
  onLocate?(mark: ReaderMark): void; drafts?: Map<string, MarkEditorDraft>; commentDrafts?: Map<string, string>;
  onDelete(mark: ReaderMark): Promise<void>; onReply(mark: ReaderMark, text: string): Promise<void>;
  onRefresh(): void; onExport(format: 'pdf' | 'markdown' | 'json'): void; onClose(): void;
  checkedIds: ReadonlySet<string>; onCheckedChange(ids: Set<string>): void; canAttach: boolean;
  onAttach(action: MarkBatchAction, ids: string[], target?: MarkBatchTarget): Promise<void>;
  mode?: 'sidebar' | 'manager'; onManage?(): void; onReturnToReader?(): void; onEndEdit?(): void;
  state?: AnnotationWorkspaceState; onStateChange?(state: AnnotationWorkspaceState): void; onDraftsChange?(): void;
  pdfDocument?: PDFDocumentProxy | null; currentPage?: number; onPreviewMark?(mark: ReaderMark): void;
  documentTitle?: string;
  active?: boolean;
}

interface PendingAttachment { action: MarkBatchAction; ids: string[]; target?: MarkBatchTarget }
const savedMarkText = (mark: ReaderMark) => mark.kind === 'translate' ? mark.result ?? mark.note : mark.comment ?? mark.note;

/** Commit each write in order so the reader can advance its revision between calls. */
export async function savePendingAnnotationDrafts(items: ReaderMark[], drafts: Map<string, MarkEditorDraft>, commentDrafts: Map<string, string> | undefined, onSave: AnnotationsWorkspaceProps['onSave'], onReply: AnnotationsWorkspaceProps['onReply'], changed?: () => void) {
  for (const mark of items) {
    const draft = { ...drafts.get(mark.id) }; const text = commentDrafts?.get(mark.id) ?? draft.text ?? savedMarkText(mark); const color = draft.color ?? mark.color ?? 'yellow';
    if (text !== savedMarkText(mark) || color !== (mark.color ?? 'yellow')) {
      await onSave(mark, text, color);
    }
    const remaining = { ...drafts.get(mark.id) };
    if (remaining.text === text) delete remaining.text;
    if (remaining.color === color) delete remaining.color;
    if (Object.keys(remaining).length) drafts.set(mark.id, remaining); else drafts.delete(mark.id);
    if (commentDrafts?.get(mark.id) === text) commentDrafts.delete(mark.id);
    changed?.();
    const reply = draft.reply;
    if (reply?.trim()) {
      await onReply(mark, reply);
      const current = { ...drafts.get(mark.id) }; if (current.reply === reply) delete current.reply;
      if (Object.keys(current).length) drafts.set(mark.id, current); else drafts.delete(mark.id); changed?.();
    }
    // Whitespace is still a draft, but it cannot form a valid saved reply.
    else if (reply) throw new Error('回复只有空白字符，请编辑或放弃后再附加。');
  }
  if (items.some(mark => drafts.has(mark.id) || commentDrafts?.has(mark.id))) throw new Error('保存期间草稿已更新，请再次保存后附加。');
}

export function AnnotationsWorkspace({ list, selectedId, busy, error, onSelect, onLocate, onSave, onDelete, onReply, onRefresh, onExport, onClose, checkedIds, onCheckedChange, canAttach, onAttach, drafts, commentDrafts, mode = 'sidebar', onManage, onReturnToReader, onEndEdit, state: controlledState, onStateChange, onDraftsChange, pdfDocument = null, currentPage = 1, onPreviewMark, documentTitle, active = true }: AnnotationsWorkspaceProps) {
  const [localState, setLocalState] = useState(createAnnotationWorkspaceState); const state = controlledState ?? localState; const stateRef = useRef(state); stateRef.current = state;
  const [editingId, setEditingId] = useState<string | null>(selectedId); const [menu, setMenu] = useState<'more' | 'attach' | null>(null);
  const [target, setTarget] = useState<{ action: 'create-note' | 'update-note'; ids: string[] } | null>(null);
  const [pending, setPending] = useState<PendingAttachment | null>(null); const [attachError, setAttachError] = useState(''); const [attaching, setAttaching] = useState(false);
  const attachLock = useRef(false); const draftDialog = useRef<HTMLDialogElement>(null); const menuAnchor = useRef<HTMLElement | null>(null); const listRoot = useRef<HTMLDivElement>(null); const editFocusId = useRef<string | null>(null); const localDrafts = useRef(new Map<string, MarkEditorDraft>()); const cache = drafts ?? localDrafts.current;
  const [, refreshDrafts] = useState(0); const changed = () => { refreshDrafts(value => value + 1); onDraftsChange?.(); };
  const selected = list?.items.find(mark => mark.id === editingId); const marks = list?.items ?? [];
  const pageCount = pdfDocument?.numPages ?? marks.reduce((count, mark) => Math.max(count, mark.page), Math.max(1, currentPage));
  const workspace = buildAnnotationWorkspace(marks, state, checkedIds, pageCount, currentPage);
  const { items, groups, selection: summary } = workspace; const scrollKey = mode === 'manager' ? 'managerScrollTop' : 'listScrollTop';
  const update = (patch: Partial<AnnotationWorkspaceState>) => { const next = { ...stateRef.current, ...patch }; stateRef.current = next; setLocalState(next); onStateChange?.(next); };
  const filter = (patch: Partial<AnnotationWorkspaceState>) => update({ ...patch, renderedLimit: 100, listScrollTop: 0, managerScrollTop: 0 });
  const endEdit = () => { setEditingId(null); onEndEdit?.(); };
  const close = () => { setEditingId(null); onClose(); };
  const preview = (mark: ReaderMark) => { update({ previewMarkId: mark.id, ...(mode === 'manager' ? { previewOpen: true } : {}) }); onPreviewMark?.(mark); };
  useEffect(() => { setEditingId(selectedId); }, [selectedId]);
  useEffect(() => { if (!active) setMenu(null); }, [active]);
  useLayoutEffect(() => { const dialog = draftDialog.current; if (!active || !pending || !dialog) return; dialog.showModal(); return () => dialog.close(); }, [Boolean(pending), active]);
  useLayoutEffect(() => {
    if (selected || !listRoot.current) return; listRoot.current.scrollTop = stateRef.current[scrollKey];
    if (editFocusId.current) [...listRoot.current.querySelectorAll<HTMLButtonElement>('[data-annotation-edit]')].find(button => button.dataset.annotationEdit === editFocusId.current)?.focus({ preventScroll: true });
  }, [Boolean(selected), mode, state.query, state.kind, state.color, state.commentsOnly, state.selectedOnly, state.pageRange, state.currentPageOnly]);
  async function attach(request: PendingAttachment, saveDrafts = false) {
    if (attachLock.current) return; attachLock.current = true; setAttaching(true); setAttachError('');
    try { if (saveDrafts) await savePendingAnnotationDrafts(marks.filter(mark => request.ids.includes(mark.id)), cache, commentDrafts, onSave, onReply, changed); await onAttach(request.action, request.ids, request.target); setPending(null); }
    catch (cause) { setAttachError(messageOf(cause)); throw cause; }
    finally { attachLock.current = false; setAttaching(false); }
  }
  async function requestAttach(request: PendingAttachment) {
    if (request.ids.length > 500) throw new Error('每次最多附加 500 条批注，请缩小勾选范围后再试。');
    if (marks.some(mark => request.ids.includes(mark.id) && annotationDraftDirty(mark, cache.get(mark.id), commentDrafts?.get(mark.id)))) { setPending(request); return; }
    await attach(request);
  }
  function chooseAction(action: MarkBatchAction) {
    setMenu(null); const ids = summary.items.map(mark => mark.id);
    if (action === 'create-note' || action === 'update-note') setTarget({ action, ids }); else void requestAttach({ action, ids }).catch(() => {});
  }
  let remaining = state.renderedLimit; const visibleGroups = groups.map(group => { const count = state.collapsedPages.includes(group.page) ? 0 : Math.min(remaining, group.marks.length); remaining -= count; return { ...group, visible: group.marks.slice(0, count) }; });
  const renderedCount = visibleGroups.reduce((count, group) => count + group.visible.length, 0); const expandedCount = groups.filter(group => !state.collapsedPages.includes(group.page)).reduce((count, group) => count + group.marks.length, 0);
  const browse = <>
    <div className="annotation-filter-bar"><input aria-label="搜索批注" placeholder="搜索摘录或备注" value={state.query} onChange={event => filter({ query: event.target.value })} /><button aria-label="筛选批注" aria-expanded={state.filtersOpen} onClick={() => update({ filtersOpen: !state.filtersOpen })}><Filter size={14} />筛选{[state.kind !== 'all', state.color !== 'all', state.commentsOnly, Boolean(state.pageRange), state.currentPageOnly].filter(Boolean).length || ''}</button></div>
    {state.filtersOpen && <div className="annotation-filter-options"><label>类型<select aria-label="批注类型" value={state.kind} onChange={event => filter({ kind: event.target.value })}><option value="all">全部类型</option>{Object.entries(KIND_LABEL).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label><label>颜色<select aria-label="筛选批注颜色" value={state.color} onChange={event => filter({ color: event.target.value as MarkColor | 'all' })}><option value="all">全部颜色</option>{COLORS.map(color => <option key={color} value={color}>{COLOR_LABEL[color]}</option>)}</select></label><label><input type="checkbox" checked={state.commentsOnly} onChange={event => filter({ commentsOnly: event.target.checked })} />含备注或回复</label><label><input type="checkbox" checked={state.currentPageOnly} onChange={event => filter({ currentPageOnly: event.target.checked })} />仅当前页</label><label>页码范围<input aria-label="批注页码范围" placeholder="例如 7–12,18" value={state.pageRange} onChange={event => filter({ pageRange: event.target.value })} /></label></div>}
    {(state.kind !== 'all' || state.color !== 'all' || state.commentsOnly || state.currentPageOnly || state.pageRange || state.selectedOnly) && <div className="annotation-filter-chips">{state.kind !== 'all' && <button onClick={() => filter({ kind: 'all' })}>{KIND_LABEL[state.kind as keyof typeof KIND_LABEL]} ×</button>}{state.color !== 'all' && <button onClick={() => filter({ color: 'all' })}>{COLOR_LABEL[state.color]} ×</button>}{state.commentsOnly && <button onClick={() => filter({ commentsOnly: false })}>含备注 ×</button>}{state.currentPageOnly && <button onClick={() => filter({ currentPageOnly: false })}>当前页 ×</button>}{state.pageRange && <button onClick={() => filter({ pageRange: '' })}>第 {state.pageRange} 页 ×</button>}{state.selectedOnly && <button onClick={() => filter({ selectedOnly: false })}>查看已选 ×</button>}<button onClick={() => filter({ query: '', kind: 'all', color: 'all', commentsOnly: false, pageRange: '', currentPageOnly: false, selectedOnly: false })}>清除筛选</button></div>}
    {error && <p className="callout error" role="alert">{error}</p>}{!workspace.pageRange.valid && <p className="error-text annotation-filter-error" role="alert">{workspace.pageRange.error}</p>}
    <div className="annotation-list-toolbar"><label><GroupCheckbox label="全选筛选结果" state={workspace.selectionState} onChange={() => onCheckedChange(toggleMarkGroup(checkedIds, items))} /><span>{items.length} 条批注</span></label>{summary.hiddenCount > 0 && <span role="status">{summary.hiddenCount} 条已选被筛选隐藏</span>}</div>
    {mode === 'manager' && <div className="annotation-manager-column-head"><span>摘录（原文）</span><span>备注</span><span>类型</span><span>来源页</span></div>}
    <div ref={listRoot} className="pdf-marks-list annotation-main-list" onScroll={event => update({ [scrollKey]: event.currentTarget.scrollTop })}>{visibleGroups.map(group => <section key={group.page} data-annotation-page={group.page} className="pdf-mark-page-group" aria-label={`物理第 ${group.page} 页批注`}><header><label className="pdf-mark-page-select"><GroupCheckbox label={`选择物理第 ${group.page} 页的筛选批注`} state={group.state} onChange={() => onCheckedChange(toggleMarkGroup(checkedIds, group.marks))} /><strong>物理第 {group.page} 页</strong><small>{group.marks.length} 条{group.state === 'some' ? ' · 部分已选' : group.state === 'all' ? ' · 全部已选' : ''}</small></label><button className="icon-button" aria-label={`${state.collapsedPages.includes(group.page) ? '展开' : '折叠'}第 ${group.page} 页批注`} aria-expanded={!state.collapsedPages.includes(group.page)} onClick={() => update({ collapsedPages: state.collapsedPages.includes(group.page) ? state.collapsedPages.filter(page => page !== group.page) : [...state.collapsedPages, group.page] })}>{state.collapsedPages.includes(group.page) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button></header>{!state.collapsedPages.includes(group.page) && <div className="pdf-mark-page-children">{group.visible.map(mark => <div key={mark.id} className={`pdf-mark-choice ${checkedIds.has(mark.id) ? 'checked' : ''} ${state.previewMarkId === mark.id ? 'previewing' : ''}`}><label className="pdf-mark-check" title="选择为对话来源"><input type="checkbox" aria-label={`选择第 ${mark.page} 页批注 ${mark.quote.slice(0, 30) || mark.id}`} checked={checkedIds.has(mark.id)} onChange={() => onCheckedChange(toggleMarkGroup(checkedIds, [mark]))} /></label><div className={`pdf-mark-entry ${mode === 'manager' ? 'annotation-table-entry' : ''}`}><div className="annotation-entry-heading"><small className="annotation-entry-kind"><i style={{ background: COLOR_HEX[mark.color ?? 'yellow'] }} />{KIND_LABEL[mark.kind]}{annotationDraftDirty(mark, cache.get(mark.id), commentDrafts?.get(mark.id)) && <span className="annotation-draft-badge"> · 草稿</span>}</small><div className="annotation-entry-actions">{mode === 'manager' && <button aria-label={`预览批注 ${mark.id} 原文`} onClick={() => preview(mark)}>预览</button>}{onLocate && <button aria-label={`定位批注 ${mark.id} 原文`} onClick={() => onLocate(mark)}><LocateFixed size={12} />定位</button>}<button aria-label={`编辑批注 ${mark.id}`} data-annotation-edit={mark.id} onClick={() => { editFocusId.current = mark.id; setEditingId(mark.id); onSelect(mark); }}><Pencil size={12} />编辑</button></div></div><blockquote>{mark.quote || '区域标注'}</blockquote>{(markText(mark) || mode === 'manager') && <span className={`annotation-entry-note ${!markText(mark) ? 'annotation-entry-note--empty' : ''}`}>{markText(mark) || '—'}</span>}{mode === 'manager' && <small className="annotation-entry-source">第 {mark.page} 页</small>}{Boolean(mark.messages?.length) && <small className="annotation-entry-reply-count">{mark.messages!.length} 条回复</small>}</div></div>)}</div>}</section>)}{renderedCount < expandedCount && <button className="annotation-load-more" onClick={() => update({ renderedLimit: state.renderedLimit + 100 })}>继续显示批注（已显示 {renderedCount} / {expandedCount}）</button>}{!items.length && <p className="field-help">{state.selectedOnly ? '没有符合筛选条件的已选批注。' : '没有匹配的批注。选中文字或框选区域后添加。'}</p>}</div>
    {summary.items.length ? <div className="pdf-mark-batch-bar"><div><strong>对话来源 · 已选 {summary.items.length} 条 / {summary.pages.length} 页</strong><button aria-pressed={state.selectedOnly} onClick={() => filter({ selectedOnly: !state.selectedOnly })}>{state.selectedOnly ? '返回全部' : '查看已选'}</button><button onClick={() => onCheckedChange(new Set())}>清空</button></div>{!canAttach && <span className="field-help">当前宿主不支持附加到对话输入框。</span>}{summary.items.length > 500 && <span className="field-help">每次最多附加 500 条批注，请缩小勾选范围。</span>}{attachError && !pending && <p className="error-text" role="alert">{attachError}</p>}<div className="pdf-mark-batch-actions"><button className="primary" disabled={!canAttach || busy || attaching || summary.items.length > 500} onClick={() => chooseAction('summarize')}><Send size={13} />{attaching ? '附加中…' : '带到对话'}</button><button aria-label="选择批注对话操作" aria-haspopup="menu" aria-expanded={menu === 'attach'} disabled={!canAttach || busy || attaching || summary.items.length > 500} onClick={event => { menuAnchor.current = event.currentTarget; setMenu(menu === 'attach' ? null : 'attach'); }}><ChevronDown size={15} /></button>{menu === 'attach' && <AnchoredMenu ariaLabel="批注对话操作" anchor={menuAnchor.current ? { element: menuAnchor.current } : { point: { x: 0, y: 0 } }} onClose={() => setMenu(null)}><button role="menuitem" onClick={() => chooseAction('summarize')}>在对话中总结</button><button role="menuitem" onClick={() => chooseAction('create-note')}>整理并保存为新笔记…</button><button role="menuitem" onClick={() => chooseAction('update-note')}>整理并更新已有笔记…</button><button role="menuitem" onClick={() => chooseAction('revise-paper')}>根据批注修订论文正文 Markdown</button></AnchoredMenu>}</div></div> : <footer className="annotation-empty-footer">勾选批注后可带到对话</footer>}
  </>;
  const editor = selected && list ? <MarkEditor key={selected.id} mark={selected} vaultId={list.vaultId} paperPath={list.paperPath} busy={busy} onSave={onSave} onDelete={onDelete} onReply={onReply} onLocate={onLocate ? () => onLocate(selected) : undefined} drafts={cache} commentDrafts={commentDrafts} onDraftsChange={changed} onReturn={endEdit} /> : null;
  const heading = <header className="pdf-panel-heading">{selected ? <button className="annotation-back" disabled={busy || attaching} onClick={endEdit}><ArrowLeft size={15} />返回批注</button> : <><strong>批注 <span className="count">{marks.length}</span></strong><span className="toolbar-spacer" />{mode === 'sidebar' && onManage && <button disabled={busy || attaching} onClick={onManage}><ExternalLink size={13} />批注管理</button>}<div className="annotation-more" data-annotation-menu><button className="icon-button" aria-label="更多批注操作" aria-haspopup="menu" aria-expanded={menu === 'more'} onClick={event => { menuAnchor.current = event.currentTarget; setMenu(menu === 'more' ? null : 'more'); }}><Ellipsis size={15} /></button>{menu === 'more' && <AnchoredMenu ariaLabel="更多批注操作" anchor={menuAnchor.current ? { element: menuAnchor.current } : { point: { x: 0, y: 0 } }} onClose={() => setMenu(null)}><button role="menuitem" disabled={busy} onClick={() => { setMenu(null); onRefresh(); }}>刷新批注</button>{(['markdown', 'json', 'pdf'] as const).map(format => <button key={format} role="menuitem" disabled={busy} onClick={() => { setMenu(null); onExport(format); }}>导出{format === 'markdown' ? ' Markdown' : format === 'json' ? ' JSON' : '带批注 PDF'}</button>)}</AnchoredMenu>}</div></>}<button className="icon-button" aria-label="关闭批注侧栏" disabled={busy || attaching} onClick={close}><X size={15} /></button></header>;
  const content = <section className={`annotation-workspace ${mode === 'manager' ? 'annotation-workspace--manager' : ''} ${selected ? 'annotation-workspace--editing' : ''}`} aria-label="论文批注" onKeyDown={event => { if (event.key === 'Escape' && selected) { event.preventDefault(); event.stopPropagation(); endEdit(); } }}>{heading}{editor ?? browse}{target && list && <MarkContextTarget action={target.action} vaultId={list.vaultId} paperPath={list.paperPath} onSubmit={async value => { const request = { action: target.action, ids: target.ids, target: value }; await requestAttach(request); setTarget(null); }} onClose={() => setTarget(null)} />}{pending && <dialog ref={draftDialog} className="annotation-draft-dialog" aria-label="附加前处理批注草稿" onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }} onCancel={event => { event.preventDefault(); if (!attaching) { setPending(null); setAttachError(''); } }}><strong>所选批注含未保存草稿</strong><p>保存后附加会依次写入备注、颜色和回复；也可只使用论文中已保存的版本。</p>{attachError && <p className="error-text" role="alert">{attachError}</p>}<button className="primary" disabled={busy || attaching} autoFocus onClick={() => void attach(pending, true).catch(() => {})}>保存后附加</button><button disabled={busy || attaching} onClick={() => void attach(pending).catch(() => {})}>使用已保存版本</button><button disabled={attaching} onClick={() => { setPending(null); setAttachError(''); }}>取消</button></dialog>}</section>;
  if (mode === 'manager') return <AnnotationManagerFrame title={documentTitle ?? list?.paperPath.split('/').at(-1) ?? '当前论文'} onBack={() => { if (!busy && !attaching) { endEdit(); onReturnToReader?.(); } }} previewOpen={state.previewOpen} onPreviewOpenChange={previewOpen => update({ previewOpen })} preview={<AnnotationSourcePreview document={pdfDocument} mark={marks.find(mark => mark.id === state.previewMarkId) ?? null} active={active && state.previewOpen} onLocate={onLocate} />}><div className="annotation-manager-content"><nav className="annotation-page-navigation" aria-label="批注页导航"><strong>页面</strong><label><GroupCheckbox label="页导航全选筛选结果" state={workspace.selectionState} onChange={() => onCheckedChange(toggleMarkGroup(checkedIds, items))} />全部批注 <small>{items.length}</small></label>{groups.map(group => <div key={group.page}><GroupCheckbox label={`页导航选择第 ${group.page} 页筛选批注`} state={group.state} onChange={() => onCheckedChange(toggleMarkGroup(checkedIds, group.marks))} /><button onClick={() => { update({ collapsedPages: state.collapsedPages.filter(page => page !== group.page), renderedLimit: Math.max(state.renderedLimit, groups.filter(item => item.page <= group.page && (item.page === group.page || !state.collapsedPages.includes(item.page))).reduce((count, item) => count + item.marks.length, 0)) }); requestAnimationFrame(() => listRoot.current?.querySelector(`[data-annotation-page="${group.page}"]`)?.scrollIntoView({ block: 'start' })); }}>第 {group.page} 页</button><small>{group.marks.length}</small></div>)}</nav>{content}</div></AnnotationManagerFrame>;
  return <aside className="pdf-marks-panel annotation-sidebar">{content}</aside>;
}

function GroupCheckbox({ label, state, onChange }: { label: string; state: 'none' | 'some' | 'all'; onChange(): void }) {
  const ref = useRef<HTMLInputElement>(null); useEffect(() => { if (ref.current) ref.current.indeterminate = state === 'some'; }, [state]);
  return <input ref={ref} type="checkbox" aria-label={label} aria-checked={state === 'some' ? 'mixed' : state === 'all'} checked={state === 'all'} onChange={onChange} />;
}

export function MarkEditor({ mark, vaultId, paperPath, busy, onSave, onDelete, onReply, onLocate, drafts, commentDrafts, onReturn, onDraftsChange }: {
  mark: ReaderMark; vaultId: string; paperPath: string; busy: boolean;
  onSave(mark: ReaderMark, text: string, color: MarkColor): Promise<void>; onDelete(mark: ReaderMark): Promise<void>; onReply(mark: ReaderMark, text: string): Promise<void>;
  onLocate?(): void; drafts: Map<string, MarkEditorDraft>; commentDrafts?: Map<string, string>; onReturn?(): void; onDraftsChange?(): void;
}) {
  const savedText = savedMarkText(mark); const cached = drafts.get(mark.id);
  const [text, setText] = useState(commentDrafts?.get(mark.id) ?? cached?.text ?? savedText); const [color, setColor] = useState<MarkColor>(cached?.color ?? mark.color ?? 'yellow');
  const [reply, setReply] = useState(cached?.reply ?? ''); const [error, setError] = useState(''); const [confirmDelete, setConfirmDelete] = useState(false); const [asset, setAsset] = useState<string | null>(null);
  const [replyOpen, setReplyOpen] = useState(Boolean(cached?.reply)); const [saving, setSaving] = useState(false); const lock = useRef(false); const mounted = useRef(true);
  const baseline = useRef({ text: savedText, color: mark.color ?? 'yellow' }); const value = useRef({ text, color, reply }); value.current = { text, color, reply };
  const dirty = text !== baseline.current.text || color !== baseline.current.color || Boolean(reply); const disabled = busy || saving;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function cacheDraft(next: { text: string; color: MarkColor; reply: string }) {
    const pending: MarkEditorDraft = { ...(next.text !== baseline.current.text ? { text: next.text } : {}), ...(next.color !== baseline.current.color ? { color: next.color } : {}), ...(next.reply ? { reply: next.reply } : {}) };
    if (Object.keys(pending).length) drafts.set(mark.id, pending); else drafts.delete(mark.id);
    if (pending.text !== undefined) commentDrafts?.set(mark.id, pending.text); else commentDrafts?.delete(mark.id);
    onDraftsChange?.();
  }
  function changeDraft(change: Partial<{ text: string; color: MarkColor; reply: string }>) {
    const next = { ...value.current, ...change }; value.current = next; cacheDraft(next); setText(next.text); setColor(next.color); setReply(next.reply);
  }
  useEffect(() => {
    baseline.current = { text: savedText, color: mark.color ?? 'yellow' }; const pending = drafts.get(mark.id);
    const next = { text: commentDrafts?.get(mark.id) ?? pending?.text ?? savedText, color: pending?.color ?? mark.color ?? 'yellow', reply: pending?.reply ?? '' };
    value.current = next; setText(next.text); setColor(next.color); setReply(next.reply); if (next.reply) setReplyOpen(true);
  }, [mark.id, savedText, mark.color]);
  useEffect(() => {
    setAsset(null); if (!mark.asset) return; let cancelled = false;
    void callTool<{ base64: string; mediaType?: string; mimeType?: string }>('mark_asset_read', { vaultId, paperPath, id: mark.id }).then(result => { if (!cancelled) setAsset(`data:${result.mediaType ?? result.mimeType ?? 'image/png'};base64,${result.base64}`); }).catch(cause => { if (!cancelled) setError(messageOf(cause)); });
    return () => { cancelled = true; };
  }, [mark.id, mark.asset, vaultId, paperPath]);
  async function run(action: () => Promise<void>) { if (lock.current) return; lock.current = true; setSaving(true); setError(''); try { await action(); } catch (cause) { setError(messageOf(cause)); } finally { lock.current = false; setSaving(false); } }
  async function saveAndReturn() {
    const next = { ...value.current };
    if (next.text !== baseline.current.text || next.color !== baseline.current.color) {
      await onSave(mark, next.text, next.color); baseline.current = { text: next.text, color: next.color };
    }
    const acknowledged = { ...drafts.get(mark.id) }; if (acknowledged.text === next.text) delete acknowledged.text; if (acknowledged.color === next.color) delete acknowledged.color;
    if (Object.keys(acknowledged).length) drafts.set(mark.id, acknowledged); else drafts.delete(mark.id);
    if (commentDrafts?.get(mark.id) === next.text) commentDrafts.delete(mark.id); onDraftsChange?.();
    if (next.reply.trim()) {
      await onReply(mark, next.reply); const remaining = { ...drafts.get(mark.id) }; if (remaining.reply === next.reply) delete remaining.reply;
      if (Object.keys(remaining).length) drafts.set(mark.id, remaining); else drafts.delete(mark.id);
      next.reply = ''; if (mounted.current) { value.current = next; setReply(''); } onDraftsChange?.();
    }
    else if (next.reply) throw new Error('回复只有空白字符，请编辑或放弃后再保存。');
    if (mounted.current && !drafts.has(mark.id) && !commentDrafts?.has(mark.id)) onReturn?.();
  }
  function discard() { const next = { ...baseline.current, reply: '' }; value.current = next; drafts.delete(mark.id); commentDrafts?.delete(mark.id); setText(next.text); setColor(next.color); setReply(''); setError(''); onDraftsChange?.(); onReturn?.(); }
  return <section className="pdf-mark-editor annotation-single-editor" aria-label="编辑批注" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!disabled) onReturn?.(); } }}>
    <div className="annotation-editor-scroll"><div className="section-heading"><strong>物理第 {mark.page} 页 · {KIND_LABEL[mark.kind]}</strong>{onLocate && <button disabled={disabled} onClick={onLocate}><LocateFixed size={13} />定位原文</button>}</div>
      {mark.quote && <blockquote className="annotation-editor-source">{mark.quote}</blockquote>}{asset && <img src={asset} alt="区域批注截图" />}{mark.question && <p className="field-help">问题：{mark.question}</p>}
      <label>{mark.kind === 'translate' ? '译文' : '我的备注'}<textarea autoFocus aria-label="批注内容" value={text} maxLength={20_000} onChange={event => changeDraft({ text: event.target.value })} disabled={disabled} /></label><ColorPicker value={color} disabled={disabled} onChange={next => changeDraft({ color: next })} />
      <div className="annotation-replies-heading"><details><summary>回复 {mark.messages?.length ?? 0}</summary>{Boolean(mark.messages?.length) ? <ol className="pdf-mark-thread">{mark.messages!.map(message => <li key={message.id}><small>{message.role === 'assistant' ? '模型' : '用户'} · {new Date(message.createdAt).toLocaleString()}</small><p>{message.content}</p></li>)}</ol> : <p className="field-help">暂无回复</p>}</details><button disabled={disabled} aria-expanded={replyOpen} onClick={() => setReplyOpen(!replyOpen)}>{replyOpen ? '收起回复草稿' : '添加回复'}</button></div>
      {replyOpen && <label>追加回复<textarea aria-label="批注回复" placeholder="保存时一并写入回复" value={reply} maxLength={10_000} onChange={event => changeDraft({ reply: event.target.value })} disabled={disabled} /></label>}
      {error && <p className="error-text" role="alert">{error}</p>}
    </div><footer className="annotation-editor-footer"><span className="field-help" role="status">{dirty ? '修改未保存 · 返回后保留草稿' : '已保存'}</span><div><button className="primary" disabled={disabled || (!dirty && !onReturn)} onClick={() => void run(saveAndReturn)}><Save size={13} />{onReturn ? '保存并返回' : '保存修改'}</button><button disabled={disabled} onClick={discard}>放弃修改</button><details className="annotation-editor-more"><summary aria-label="更多批注编辑操作"><Ellipsis size={15} /></summary><button className="danger" disabled={disabled} onClick={() => setConfirmDelete(!confirmDelete)}><Trash2 size={13} />删除批注</button></details></div>{confirmDelete && <div className="pdf-delete-confirm"><span>删除此批注及其回复？</span><button className="danger" disabled={disabled} onClick={() => void run(async () => { await onDelete(mark); drafts.delete(mark.id); commentDrafts?.delete(mark.id); onDraftsChange?.(); onReturn?.(); })}>确认删除</button><button disabled={disabled} onClick={() => setConfirmDelete(false)}>取消</button></div>}<small className="field-help">草稿未保存到论文</small></footer>
  </section>;
}
