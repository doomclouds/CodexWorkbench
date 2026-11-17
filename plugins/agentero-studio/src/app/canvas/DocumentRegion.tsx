import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, BookOpen, Check, Download, FileText, GripVertical, Loader2, Maximize, MessageSquare, Pencil, Search, X } from 'lucide-react';
import type { Actor, Anchor, BoardElement, StudioClient, StyleProfile } from '../../contracts/studio.js';
import { documentSurface } from '../../core/products/document-surface.js';
import { applyDocumentOperations, defaultDocument, documentAnchorState, documentBlockText, documentOperations, documentPlainText, flattenDocumentBlocks, normalizeDocument, type DocumentContent } from '../../contracts/document.js';
import { assetDisplayUrl } from './canvas-model.js';
import { isEscapeActive, registerEscapeLayer } from '../shared/escape.js';
import { studioRequest, downloadStudioBlob, downloadStudioFile } from '../transport.js';
import { copyPlainText } from '../clipboard.js';
import DocumentReadView from './DocumentReadView.js';
import type { DocumentTextSelection } from './DocumentEditor.js';
import useDocumentFocusSurface, { type DocumentFocusSurface } from './useDocumentFocusSurface.js';
export type { DocumentFocusSurface } from './useDocumentFocusSurface.js';
import './document-region.css';

const DocumentEditor = lazy(() => import('./DocumentEditor.js'));
export interface DocumentActivity { editing: boolean; dirty: boolean; saving: boolean; error: string }
interface Props {
  element: BoardElement; artifactId: string; actor: Actor; client: StudioClient; canEdit: boolean; canAnnotate: boolean;
  interactive: boolean; expanded: boolean; focusHost: HTMLElement | null; theme: 'light' | 'dark'; readingZoom?: number; editRequest?: number; target?: Anchor;
  annotationActive?: boolean; annotationMode?: boolean; styleProfile?: StyleProfile;
  onMoveStart?(event: React.PointerEvent): void;
  onInteract(active: boolean): void; onExpand(): void; onExit(): void;
  onSave(document: DocumentContent, title: string, base: BoardElement, overwrite: boolean): Promise<BoardElement | false>;
  onActivity(activity: DocumentActivity): void;
  onFocusSurface?(surface: DocumentFocusSurface | null): void;
  onAnnotate(anchor: Anchor, version: number, point?: { x: number; y: number }): void;
}
interface SavedDraft { base: BoardElement; document: DocumentContent; title: string }
export default function DocumentRegion({ element, artifactId, actor, client, canEdit, canAnnotate, interactive, expanded, focusHost, readingZoom = 1, editRequest, target, annotationActive = false, annotationMode = false, styleProfile, onMoveStart, onInteract, onExpand, onExit, onSave, onActivity, onAnnotate, onFocusSurface }: Props) {
  const [document, setDocument] = useState<DocumentContent>(() => element.document ?? defaultDocument());
  const [title, setTitle] = useState(element.text || '文档');
  const [editing, setEditing] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState(''), [comparing, setComparing] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);
  const [composing, setComposing] = useState(false);
  const [draftWarning, setDraftWarning] = useState('');
  const [recovered, setRecovered] = useState<SavedDraft | null>(null), [selection, setSelection] = useState<DocumentTextSelection | null>(null), [find, setFind] = useState('');
  const [findIndex, setFindIndex] = useState(0);
  const shell = useRef<HTMLDivElement>(null), focusShell = useRef<HTMLElement>(null), scroll = useRef<HTMLDivElement>(null), scrollPosition = useRef({ inline: 0, focus: 0 }), previousExpanded = useRef(false);
  const content = useRef<HTMLDivElement>(null);
  const baseline = useRef(element), current = useRef(element); current.current = element;
  const draft = useRef({ document, title }); draft.current = { document, title };
  const mounted = useRef(true), inFlight = useRef<Promise<boolean> | null>(null);
  const pendingAssets = useRef(new Set<() => void>());
  const recoveryPresent = useRef(false);
  const annotationRequest = useRef(0), annotationScope = useRef('');
  const scope = `${artifactId}:${element.id}:${interactive}:${annotationMode}:${expanded}`;
  if (annotationScope.current !== scope) { annotationScope.current = scope; annotationRequest.current++; }
  const selectSelection = useCallback((value: DocumentTextSelection | null) => { annotationRequest.current++; setSelection(value); }, []);
  const callbacks = useRef({ onSave, onActivity, onAnnotate, onInteract }); callbacks.current = { onSave, onActivity, onAnnotate, onInteract };
  const dirty = JSON.stringify(document) !== JSON.stringify(baseline.current.document ?? defaultDocument()) || title !== (baseline.current.text || '文档');
  const surface = documentSurface(element, styleProfile);
  const surfaceStyle = { '--document-backdrop': surface.backdrop, '--document-paper': surface.paper, '--document-ink': surface.ink, '--document-muted': surface.muted, '--document-rule': surface.rule, '--document-code': surface.code, '--document-link': surface.link, '--document-handle-scale': Math.max(1, 1 / readingZoom), colorScheme: surface.scheme } as CSSProperties;
  const draftKey = `studio-document-draft:${actor.id}:${artifactId}:${element.id}`;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => () => { for (const cancel of pendingAssets.current) cancel(); }, []);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey); recoveryPresent.current = Boolean(raw);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved?.base || saved.base.id !== element.id || saved.base.type !== 'document' || !Number.isSafeInteger(saved.base.version) || typeof saved.title !== 'string' || saved.title.length > 200) throw new Error('草稿信息无效。');
      setRecovered({ base: { ...saved.base, document: normalizeDocument(saved.base.document) }, document: normalizeDocument(saved.document), title: saved.title });
    } catch { setDraftWarning('未能读取上次的文档草稿，请先复制本机草稿，避免丢失。'); }
  }, [draftKey, element.id]);
  useEffect(() => {
    try { if (dirty) { localStorage.setItem(draftKey, JSON.stringify({ base: baseline.current, document, title })); setDraftWarning(''); } else if (!recovered && !recoveryPresent.current) { localStorage.removeItem(draftKey); setDraftWarning(''); } }
    catch { setDraftWarning('无法保存本机草稿，仍会尝试保存到白板；未确认前请复制文档草稿。'); }
  }, [document, title, dirty, draftKey, recovered]);
  useEffect(() => {
    if (composing || saving || inFlight.current || element.version < baseline.current.version) return;
    if (!dirty) { baseline.current = element; setDocument(element.document ?? defaultDocument()); setTitle(element.text || '文档'); }
    // A confirmed move/fill change can advance CAS only while the saved text is exactly unchanged.
    else if (element.version > baseline.current.version && element.text === baseline.current.text && JSON.stringify(element.document) === JSON.stringify(baseline.current.document)) baseline.current = element;
  }, [element.version, dirty, saving, composing]);
  const save = useCallback(async (overwrite = false): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    if (!canEdit) { setError('当前为只读，文档草稿已保留。'); return false; }
    const submitted = draft.current, origin = baseline.current, source = overwrite ? current.current : origin;
    if (!submitted.title.trim()) { setError('请填写文档标题后保存。'); return false; }
    if (!overwrite && JSON.stringify(submitted.document) === JSON.stringify(source.document) && submitted.title === source.text) return true;
    setSaving(true); setError('');
    const work = (async () => {
      try {
        const intent = overwrite ? documentOperations(origin.document ?? defaultDocument(), submitted.document) : [];
        const documentToSave = overwrite ? intent.length ? applyDocumentOperations(source.document ?? defaultDocument(), intent) : source.document ?? defaultDocument() : submitted.document;
        const titleToSave = overwrite && submitted.title === (origin.text || '文档') ? source.text ?? '文档' : submitted.title;
        const result = await callbacks.current.onSave(documentToSave, titleToSave, source, overwrite);
        if (!result) throw new Error('文档尚未保存，请比较最新内容或重试。');
        const newerDraft = JSON.stringify(draft.current) !== JSON.stringify(submitted);
        const foreignBody = JSON.stringify(normalizeDocument(result.document ?? defaultDocument())) !== JSON.stringify(normalizeDocument(submitted.document));
        if (newerDraft && foreignBody) {
          baseline.current = origin;
          if (mounted.current) setError('保存回执含有新的正文，新输入已保留，请比较最新内容后保存。');
          return false;
        }
        baseline.current = result;
        recoveryPresent.current = false;
        if (mounted.current) {
          if (!newerDraft) { setDocument(result.document ?? submitted.document); setTitle(result.text || submitted.title); }
          setComparing(false); setRecovered(null);
        }
        return true;
      } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); return false; }
      finally { inFlight.current = null; if (mounted.current) setSaving(false); }
    })();
    inFlight.current = work; return work;
  }, [canEdit]);
  useEffect(() => { if (composing || !dirty || saving || error || !canEdit) return; const timer = setTimeout(() => void save(), 650); return () => clearTimeout(timer); }, [document, title, dirty, saving, error, canEdit, save, composing]);
  useEffect(() => { if (!canEdit && dirty) setError('当前为只读，文档草稿已保留。'); }, [canEdit, dirty]);
  useEffect(() => { callbacks.current.onActivity({ editing: editing && interactive || composing, dirty, saving, error: error || (dirty ? draftWarning : '') }); }, [editing, interactive, composing, dirty, saving, error, draftWarning]);
  useEffect(() => () => callbacks.current.onActivity({ editing: false, dirty: false, saving: false, error: '' }), []);
  useEffect(() => { if (editRequest && canEdit) { setEditing(true); onInteract(true); } }, [editRequest, canEdit]);
  useEffect(() => { if ((!interactive || annotationMode) && !composing) setEditing(false); }, [interactive, annotationMode, composing]);
  useEffect(() => { if (interactive && !expanded && !editing) scroll.current?.focus({ preventScroll: true }); }, [interactive, expanded, editing]);
  useEffect(() => {
    const root = expanded ? focusShell.current : shell.current;
    if (!root) return;
    return registerEscapeLayer(root, target => {
      if (target instanceof Node && !root.contains(target)) return false;
      if (composing) return;
      if (exportMenu) { setExportMenu(false); return; }
      if (comparing) { setComparing(false); return; }
      if (annotationMode) return false;
      if (editing) { setEditing(false); if (!expanded) callbacks.current.onInteract(false); return; }
      if (interactive && !expanded) { callbacks.current.onInteract(false); return; }
      return false;
    }, 30);
  }, [expanded, editing, interactive, annotationMode, comparing, exportMenu, composing]);
  useLayoutEffect(() => { if (expanded && !previousExpanded.current) scrollPosition.current.focus = scrollPosition.current.inline; previousExpanded.current = expanded; if (scroll.current) scroll.current.scrollTop = expanded ? scrollPosition.current.focus : scrollPosition.current.inline; }, [expanded, editing]);
  const baseWidth = useDocumentFocusSurface({ expanded, id: element.id, version: element.version, zoom: readingZoom, host: focusHost, scroll, content, onChange: onFocusSurface });
  useEffect(() => { if (expanded) focusShell.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }); }, [expanded]);
  useEffect(() => { setFindIndex(0); }, [find]);
  useEffect(() => {
    if (!exportMenu) return;
    const outside = (event: PointerEvent) => { const root = expanded ? focusShell.current : shell.current; if (event.target instanceof Node && !root?.querySelector('.studio-document-export')?.contains(event.target)) setExportMenu(false); };
    window.document.addEventListener('pointerdown', outside, true);
    return () => window.document.removeEventListener('pointerdown', outside, true);
  }, [exportMenu, expanded]);
  const targetIds = target?.coordinateSpace === 'document' && target.elementIds?.includes(element.id) ? target.blockIds ?? [] : [];
  const anchorState = targetIds.length ? documentAnchorState(target!, element) : null;
  useEffect(() => {
    if (!targetIds.length) return;
    const node = scroll.current?.querySelector<HTMLElement>(`[data-document-block-id="${CSS.escape(targetIds[0])}"]`);
    if (node && scroll.current) scroll.current.scrollTop += node.getBoundingClientRect().top - scroll.current.getBoundingClientRect().top - 24;
  }, [targetIds.join(','), element.version]);
  const selectText = (event: React.MouseEvent) => {
    if (!interactive || event.button !== 0) return;
    const selected = window.getSelection();
    let picked: DocumentTextSelection | null = null;
    if (selected?.rangeCount && !selected.isCollapsed && scroll.current?.contains(selected.anchorNode) && scroll.current.contains(selected.focusNode)) {
      const range = selected.getRangeAt(0), quote = selected.toString().trim();
      const blockIds = [...scroll.current.querySelectorAll<HTMLElement>('[data-document-block-id]')].filter(node => range.intersectsNode(node)).map(node => node.dataset.documentBlockId!);
      if (quote && blockIds.length) picked = { quote, blockIds };
    } else if (annotationMode) {
      const id = (event.target as HTMLElement).closest<HTMLElement>('[data-document-block-id]')?.dataset.documentBlockId;
      const block = id && flattenDocumentBlocks(document.blocks).find(item => item.id === id);
      if (block) picked = { blockIds: [block.id], quote: documentBlockText(block).trim() };
    }
    selectSelection(picked);
    if (picked && annotationMode && canAnnotate) void annotate(picked);
  };
  const annotate = async (selected = selection) => {
    if (!selected || !canAnnotate || composing) return;
    const request = ++annotationRequest.current;
    const expected = JSON.stringify(draft.current);
    if (dirty && !await save()) return;
    if (!mounted.current || request !== annotationRequest.current) return;
    if (expected !== JSON.stringify(draft.current)) { setError('选中文字已变化，请重新选择后添加备注。'); return; }
    const source = baseline.current, rect = scroll.current?.getBoundingClientRect();
    callbacks.current.onAnnotate({ coordinateSpace: 'document', elementIds: [element.id], blockIds: selected.blockIds, sourceVersion: source.version, quote: selected.quote }, source.version, rect ? { x: rect.right - 12, y: rect.top + 70 } : undefined);
    if (!annotationMode) setSelection(null);
  };
  const uploadFile = async (file: File) => {
    if (!canEdit || !client.baseUrl) throw new Error('请连接可编辑的 Studio 服务后上传图片。');
    if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(file.type) || file.size > 20 * 1024 * 1024) throw new Error('请选择不超过 20 MB 的图片。');
    const response = await studioRequest(client, new URL(`/api/assets?artifactId=${encodeURIComponent(artifactId)}`, client.baseUrl), { method: 'POST', headers: { ...(client.token ? { Authorization: `Bearer ${client.token}` } : {}), 'Content-Type': file.type, 'X-Filename': encodeURIComponent(file.name) }, body: file });
    const result = await response.json() as { src?: string; error?: { message?: string } };
    if (!response.ok || !result.src) throw new Error(result.error?.message || '文档图片上传失败。');
    return result.src;
  };
  const resolveFileUrl = async (source: string): Promise<string> => {
    const ready = assetDisplayUrl(source, client); if (ready) return ready;
    const failed = client.assetState?.(source); if (failed?.status === 'error') throw new Error(failed.message || '文档图片读取失败。');
    if (!client.subscribeAssets) throw new Error('文档图片尚不可用，请重新打开文档。');
    return new Promise((resolve, reject) => {
      let unsubscribe: (() => void) | undefined;
      const finish = (url?: string, cause?: Error) => { clearTimeout(timer); unsubscribe?.(); pendingAssets.current.delete(cancel); if (url) resolve(url); else reject(cause); };
      const cancel = () => finish(undefined, new Error('文档已关闭，图片读取已取消。'));
      const timer = setTimeout(() => finish(undefined, new Error('文档图片读取超时，请重试。')), 15_000);
      pendingAssets.current.add(cancel);
      unsubscribe = client.subscribeAssets!(() => { const url = assetDisplayUrl(source, client), state = client.assetState?.(source); if (url) finish(url); else if (state?.status === 'error') finish(undefined, new Error(state.message || '文档图片读取失败。')); });
    });
  };
  const exportDocument = async (format: 'json' | 'html') => {
    setExportMenu(false);
    if (dirty && !await save()) return;
    try {
      if (format === 'json') await downloadStudioBlob(client, new Blob([JSON.stringify({ title, document }, null, 2)], { type: 'application/json' }), `${title.replace(/[<>:"/\\|?*]/g, '-') || '文档'}.json`);
      else { const result = await client.call<{ filename: string; downloadPath: string }>('artifact_export', { artifactId, format: 'html', regionId: element.id }); await downloadStudioFile(client, result.downloadPath, result.filename); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const copyDraft = async () => {
    let value = JSON.stringify(draft.current);
    try { value = localStorage.getItem(draftKey) || value; } catch { /* The current in-memory draft remains available when local storage is blocked. */ }
    try { await copyPlainText(value); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const headings = flattenDocumentBlocks(document.blocks).filter(block => block.type === 'heading');
  const matches = find.trim() ? flattenDocumentBlocks(document.blocks).filter(block => documentBlockText(block).toLocaleLowerCase().includes(find.trim().toLocaleLowerCase())) : [];
  function jump(id: string) { const block = scroll.current?.querySelector<HTMLElement>(`[data-document-block-id="${CSS.escape(id)}"]`); if (block && scroll.current) scroll.current.scrollTop += block.getBoundingClientRect().top - scroll.current.getBoundingClientRect().top - 24; }
  function nextMatch(delta: number) { if (!matches.length) return; const index = (findIndex + delta + matches.length) % matches.length; setFindIndex(index); jump(matches[index].id); }
  const body = <>
    <header className="studio-document-heading" data-document-controls="true">
      {expanded && <button type="button" className="studio-button" onClick={onExit}><ArrowLeft size={16} />返回画板</button>}
      {!expanded && onMoveStart && <button type="button" className="studio-document-move" aria-label="移动文档" title={element.locked ? '文档位置已锁定' : '拖动把手移动文档'} disabled={!canEdit || element.locked} data-document-move-handle="true" onPointerDown={event => { event.preventDefault(); event.stopPropagation(); if (event.button === 0 && canEdit && !element.locked) onMoveStart(event); }} onClick={event => event.stopPropagation()}><GripVertical size={16} /></button>}
      <FileText size={18} /><input aria-label="文档标题" value={title} readOnly={!canEdit || !editing || !interactive || annotationMode} onChange={event => setTitle(event.target.value)} maxLength={200} />
      <span className={`studio-document-save${error ? ' has-error' : ''}`} role="status">{saving ? <><Loader2 size={13} className="studio-spin" />保存中</> : error ? '未保存' : dirty ? '待保存' : <><Check size={13} />已保存</>}</span>
      <button type="button" className="studio-icon-button" aria-label={editing ? '阅读文档' : canEdit ? '编辑文档' : '阅读文档'} title={editing ? '阅读文档' : canEdit ? '编辑文档' : '阅读文档'} onClick={() => { onInteract(true); setEditing(value => canEdit && !value); }}>{editing ? <BookOpen size={17} /> : <Pencil size={17} />}</button>
      {!expanded && <button type="button" className="studio-icon-button" aria-label="展开文档" title="展开阅读与编辑" onClick={onExpand}><Maximize size={17} /></button>}
      <div className="studio-document-export"><button type="button" className="studio-icon-button" aria-label="导出文档" title="导出全文" aria-expanded={exportMenu} onClick={() => setExportMenu(value => !value)}><Download size={16} /></button>{exportMenu && <div role="menu" aria-label="文档导出格式"><button type="button" role="menuitem" onClick={() => void exportDocument('html')}>全文 HTML</button><button type="button" role="menuitem" onClick={() => void exportDocument('json')}>块 JSON</button></div>}</div>
    </header>
    {expanded && <div className="studio-document-find"><Search size={15} /><input aria-label="文档内查找" placeholder="查找文档…" value={find} onChange={event => setFind(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); nextMatch(event.shiftKey ? -1 : 1); } }} /><span>{find.trim() ? `${matches.length ? Math.min(findIndex + 1, matches.length) + ' / ' : ''}${matches.length} 处` : ''}</span>{matches.length > 0 && <><button type="button" className="studio-link-button" onClick={() => jump(matches[Math.min(findIndex, matches.length - 1)].id)}>定位</button><button type="button" className="studio-icon-button" aria-label="上一个匹配" onClick={() => nextMatch(-1)}>‹</button><button type="button" className="studio-icon-button" aria-label="下一个匹配" onClick={() => nextMatch(1)}>›</button></>}{find && <button type="button" className="studio-icon-button" aria-label="清除文档查找" onClick={() => setFind('')}><X size={14} /></button>}</div>}
    {expanded && headings.length > 0 && <select className="studio-document-mobile-toc" aria-label="跳转文档标题" value="" onChange={event => jump(event.target.value)}><option value="" disabled>文档目录</option>{headings.map(block => <option key={block.id} value={block.id}>{documentBlockText(block) || '未命名标题'}</option>)}</select>}
    {annotationMode && <div className="studio-document-annotation-hint" role="status"><MessageSquare size={14} />选择段落或文字 · Esc 退出聚焦备注</div>}
    {interactive && selection && canAnnotate && !annotationMode && <div className="studio-document-selection"><span>{selection.quote.slice(0, 60)}</span><button type="button" className="studio-button" onPointerDown={event => event.preventDefault()} onClick={() => void annotate()} disabled={saving || composing}><MessageSquare size={14} />备注所选文字</button></div>}
    {anchorState && anchorState !== 'current' && <div className="studio-document-message" role="status">{anchorState === 'missing' ? '备注对应的段落已删除，原选区仍保留在备注来源中。' : '备注对应的原文已有变化，请核对冻结来源。'}</div>}
    {recovered && <div className="studio-document-message" role="status">有上次未保存的文档草稿。<button type="button" onClick={() => { recoveryPresent.current = false; baseline.current = recovered.base; setDocument(recovered.document); setTitle(recovered.title); setRecovered(null); setEditing(true); onInteract(true); }}>恢复草稿</button><button type="button" onClick={() => { recoveryPresent.current = false; localStorage.removeItem(draftKey); setRecovered(null); }}>放弃草稿</button></div>}
    {draftWarning && <div className="studio-document-message has-error" role="alert"><span>{draftWarning}</span><button type="button" onClick={() => void copyDraft()}>复制本机草稿</button></div>}
    <div className="studio-document-body">
      {expanded && <nav className="studio-document-toc" aria-label="文档目录"><strong>目录</strong>{headings.length ? headings.map(block => <button type="button" key={block.id} onClick={() => jump(block.id)} style={{ paddingLeft: 10 + (Number(block.props.level) || 1) * 8 }}>{documentBlockText(block) || '未命名标题'}</button>) : <small>添加标题后显示目录</small>}</nav>}
      <div ref={scroll} className="studio-document-scroll" tabIndex={interactive || expanded ? 0 : -1} aria-label={`文档正文：${title}`} onCopy={event => event.stopPropagation()} onCut={event => event.stopPropagation()} onPaste={event => event.stopPropagation()} onScroll={event => { scrollPosition.current[expanded ? 'focus' : 'inline'] = event.currentTarget.scrollTop; }} onMouseUp={editing ? undefined : selectText}>
        <div ref={content} className="studio-document-content" style={{ zoom: expanded ? readingZoom : 1, width: baseWidth }}>{editing && (canEdit && interactive && !annotationMode || composing) ? <Suspense fallback={<div className="studio-document-message"><Loader2 size={16} className="studio-spin" />正在打开编辑器…</div>}><DocumentEditor value={document} editable={canEdit && (interactive && !annotationMode || composing)} theme={surface.scheme} onChange={setDocument} onSelection={selectSelection} onCompositionChange={setComposing} uploadFile={uploadFile} resolveFileUrl={resolveFileUrl} /></Suspense> : <DocumentReadView document={document} client={client} scheme={surface.scheme} highlightedIds={annotationMode && selection ? selection.blockIds : targetIds} find={find} />}</div>
      </div>
    </div>
    {error && <div className="studio-document-message has-error" role="alert"><span>{error}</span><button type="button" onClick={() => void save()} disabled={saving || !canEdit}>重试保存</button><button type="button" onClick={() => setComparing(true)}>比较最新内容</button><button type="button" onClick={() => void copyPlainText(JSON.stringify(draft.current)).catch(cause => setError(String(cause)))}>复制草稿</button></div>}
    {comparing && <div className="studio-document-comparison" role="dialog" aria-label="比较文档草稿"><h3>比较最新内容后再保存</h3><div><section><strong>当前已保存内容 · {current.current.text || '文档'}</strong><pre>{documentPlainText(current.current.document ?? defaultDocument())}</pre></section><section><strong>你的文档草稿 · {title}</strong><pre>{documentPlainText(document)}</pre></section></div><footer><button type="button" onClick={() => setComparing(false)}>保留草稿</button><button type="button" onClick={() => { baseline.current = current.current; setDocument(current.current.document ?? defaultDocument()); setTitle(current.current.text || '文档'); setError(''); setComparing(false); }}>采用当前内容</button><button type="button" disabled={saving || !canEdit} onClick={() => void save(true)}>保存已比较的草稿</button></footer></div>}
  </>;
  const captureEscape = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape' || event.repeat || composing || event.nativeEvent.isComposing || event.keyCode === 229 || !editing || comparing || exportMenu) return;
    const root = expanded ? focusShell.current : shell.current;
    if (!root || [...root.querySelectorAll<HTMLElement>('.bn-suggestion-menu,[role="menu"],[role="listbox"],[role="dialog"]')].some(isEscapeActive)) return;
    event.preventDefault(); event.stopPropagation(); setEditing(false);
    if (!expanded) callbacks.current.onInteract(false);
  };
  const documentPointerDown = (event: React.PointerEvent) => {
    const target = event.target as HTMLElement;
    if (event.button !== 0 || !interactive && !target.closest('button,input')) return;
    if (interactive && target.closest('.studio-document-scroll') && !target.closest('button,a[href],input:not([disabled]),textarea,select,[contenteditable="true"]')) scroll.current?.focus({ preventScroll: true });
    event.stopPropagation();
  };
  const documentKeyDown = (event: React.KeyboardEvent) => {
    if (expanded && !event.nativeEvent.isComposing && event.keyCode !== 229 && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); event.stopPropagation(); focusShell.current?.querySelector<HTMLInputElement>('[aria-label="文档内查找"]')?.focus(); return; }
    const navigation = event.code === 'Space' || event.key === 'Escape' || (event.ctrlKey || event.metaKey) && ['+', '=', '-', '0'].includes(event.key) || event.shiftKey && ['Digit0', 'Digit1', 'Digit2'].includes(event.code);
    if (interactive && !(editing && canEdit) && (event.target as HTMLElement).closest('.studio-document-scroll') && !navigation) event.stopPropagation();
  };
  const interactiveEvents = { onKeyDownCapture: captureEscape, onPointerDown: documentPointerDown, onClickCapture: (event: React.MouseEvent) => { if (annotationMode && (event.target as HTMLElement).closest('.studio-document-scroll')) event.preventDefault(); }, onDoubleClick: (event: React.MouseEvent) => { if (annotationActive || annotationMode || (event.target as HTMLElement).closest('button,input')) return; event.stopPropagation(); onInteract(true); if (canEdit) setEditing(true); }, onKeyDown: documentKeyDown };
  return <><div ref={shell} className={`studio-document-region${interactive ? ' is-interactive' : ''}${annotationMode ? ' is-annotating' : ''}`} style={surfaceStyle} data-document-id={element.id} data-native-interactive={interactive ? 'true' : undefined} {...interactiveEvents}>{expanded ? <div className="studio-document-expanded-placeholder">正在展开文档</div> : body}</div>{expanded && focusHost && createPortal(<section ref={focusShell} className="studio-document-focus" style={surfaceStyle} data-document-id={element.id} aria-label={`文档：${title}`} data-native-interactive="true" {...interactiveEvents}>{body}</section>, focusHost)}</>;
}
