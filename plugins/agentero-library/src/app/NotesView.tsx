import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, FileText, Folder, LoaderCircle, PanelLeftClose, PanelLeftOpen, Pencil, Plus, RefreshCw, X } from 'lucide-react';
import type { NoteDocument, NoteInput, NoteList } from '../contracts/types';
import type { NoteLinks, NoteRenameResult } from '../contracts/reader';
import { callTool } from './api';
import { openLink, registerBeforeTeardown } from './bridge';
import { codeOf, messageOf, noteReference, safeNotePath } from './model';
import { MarkdownEditor } from './notes/MarkdownEditor';
import { resolveNoteLink } from './notes/markdown-model';
import { startSequentialPoll } from './activity';

export type NoteTarget = Omit<NoteInput, 'vaultId'>;
interface Props {
  active: boolean;
  vaultId: string;
  preview: boolean;
  requestedTarget: NoteTarget | null;
  onDirtyChange(dirty: boolean): void;
  onOpenPaper?(paperPath: string): void;
}
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

export function NotesView({ active, vaultId, preview, requestedTarget, onDirtyChange, onOpenPaper }: Props) {
  const [list, setList] = useState<NoteList | null>(null);
  const [directory, setDirectory] = useState('notes');
  const [listRevision, setListRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [document, setDocument] = useState<NoteDocument | null>(null);
  const [text, setText] = useState('');
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [remote, setRemote] = useState<NoteDocument | null>(null);
  const [showRemote, setShowRemote] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [listOpen, setListOpen] = useState(true);
  const [listFilter, setListFilter] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [links, setLinks] = useState<NoteLinks | null>(null);
  const [linksOpen, setLinksOpen] = useState(false);
  const [linksError, setLinksError] = useState('');
  const [copyFallback, setCopyFallback] = useState(false);
  const docRef = useRef<NoteDocument | null>(null);
  const textRef = useRef('');
  const blocked = useRef(false);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const loadingTicket = useRef(0);
  const inspecting = useRef(false);
  const alive = useRef(true);
  const dirtyCallback = useRef(onDirtyChange); dirtyCallback.current = onDirtyChange;

  const flush = useCallback(async (): Promise<boolean> => {
    clearTimeout(timer.current);
    if (preview) return true;
    if (inFlight.current) return inFlight.current;
    if (blocked.current) return false;
    if (!docRef.current || textRef.current === docRef.current.content) return true;
    const write = async () => {
      while (docRef.current && textRef.current !== docRef.current.content && !blocked.current) {
        const current = docRef.current;
        const submitted = textRef.current;
        if (alive.current) { setState('saving'); setError(''); }
        try {
          const saved = await callTool<NoteDocument>('note_write', {
            vaultId: current.vaultId, ...noteReference(current.path), content: submitted,
            revision: current.revision, mode: 'replace',
          });
          docRef.current = saved;
          if (textRef.current === submitted) {
            textRef.current = saved.content;
            if (alive.current) setText(saved.content);
          }
          if (alive.current) { setDocument(saved); setState(textRef.current === saved.content ? 'saved' : 'dirty'); }
          if (!current.exists && alive.current) setListRevision(value => value + 1);
          dirtyCallback.current(textRef.current !== saved.content);
        } catch (reason) {
          blocked.current = true;
          if (alive.current) {
            setState(codeOf(reason) === 'NOTE_CONFLICT' || codeOf(reason) === 'VAULT_CHANGED' ? 'conflict' : 'error');
            setError(messageOf(reason));
          }
          dirtyCallback.current(true);
          return false;
        }
      }
      return !blocked.current;
    };
    const pending = write(); inFlight.current = pending;
    try { return await pending; }
    finally { if (inFlight.current === pending) inFlight.current = null; }
  }, [preview]);

  useEffect(() => {
    alive.current = true;
    const unregister = registerBeforeTeardown(async () => {
      if (!await flush()) throw new Error('笔记草稿尚未保存。请复制草稿或处理冲突后关闭。');
    });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (docRef.current && textRef.current !== docRef.current.content) event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { clearTimeout(timer.current); void flush(); alive.current = false; unregister(); window.removeEventListener('beforeunload', beforeUnload); };
  }, [flush]);

  const open = useCallback(async (target: NoteTarget) => {
    if (!await flush()) { setNotice('请先处理当前草稿，再切换笔记。'); return; }
    const ticket = ++loadingTicket.current;
    setLoading(true); setError(''); setNotice('');
    try {
      const next = preview
        ? { vaultId, path: 'notes/界面预览.md', content: '# 阅读笔记\n\n这是演示内容，不连接或保存到真实知识库。\n\n## 核心思路\n\n- 连接论文、讨论与笔记。\n- 引用真实资料，保留待验证的问题。\n', revision: 'preview', exists: true }
        : await callTool<NoteDocument>('note_read', { vaultId, ...target });
      if (!alive.current || ticket !== loadingTicket.current) return;
      docRef.current = next; textRef.current = next.content; blocked.current = false;
      setDocument(next); setText(next.content); setState('saved'); setRemote(null); dirtyCallback.current(false);
    } catch (reason) { if (ticket === loadingTicket.current) setError(messageOf(reason)); }
    finally { if (ticket === loadingTicket.current) setLoading(false); }
  }, [flush, preview, vaultId]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    if (preview) {
      setList({ vaultId, path: 'notes', items: [{ path: 'notes/界面预览.md', name: '界面预览.md', kind: 'file' }], truncated: false });
      if (!docRef.current) void open({ path: 'notes/界面预览.md' });
      return;
    }
    void callTool<NoteList>('note_list', { vaultId, path: directory, limit: 200 }).then(value => {
      if (cancelled) return;
      setList(value);
      if (!docRef.current && !requestedTarget) {
        const first = value.items.find(item => item.kind === 'file');
        if (first) void open({ path: first.path });
      }
    }).catch(reason => { if (!cancelled) setError(messageOf(reason)); });
    return () => { cancelled = true; };
  }, [active, vaultId, directory, listRevision, preview, open, requestedTarget]);

  useEffect(() => { if (requestedTarget) void open(requestedTarget); }, [requestedTarget, open]);

  useEffect(() => {
    if (!active || preview) return;
    let cancelled = false;
    const inspect = async () => {
      const current = docRef.current;
      if (!current || inspecting.current || blocked.current || inFlight.current || textRef.current !== current.content || window.document.visibilityState === 'hidden') return;
      inspecting.current = true;
      try {
        const next = await callTool<NoteDocument>('note_read', { vaultId: current.vaultId, ...noteReference(current.path) });
        if (cancelled || docRef.current !== current || inFlight.current || textRef.current !== current.content || blocked.current) return;
        if (next.revision !== current.revision) {
          docRef.current = next; textRef.current = next.content;
          setDocument(next); setText(next.content); setState('saved'); setNotice('笔记已从磁盘更新。');
          dirtyCallback.current(false);
        }
      } catch (reason) {
        if (!cancelled && codeOf(reason) === 'VAULT_CHANGED') setError(messageOf(reason));
      } finally { inspecting.current = false; }
    };
    const polling = startSequentialPoll(inspect, 4000);
    void polling.trigger().catch(() => {});
    const focus = () => { void polling.trigger().catch(() => {}); };
    window.addEventListener('focus', focus);
    return () => { cancelled = true; polling.stop(); window.removeEventListener('focus', focus); };
  }, [active, preview]);

  const change = useCallback((value: string) => {
    textRef.current = value; setText(value); setNotice('');
    const dirty = value !== docRef.current?.content;
    dirtyCallback.current(dirty);
    if (!blocked.current) setState(dirty ? 'dirty' : 'saved');
    clearTimeout(timer.current);
    if (dirty && !blocked.current && !preview) timer.current = setTimeout(() => { void flush(); }, 400);
  }, [flush, preview]);

  useEffect(() => {
    setLinks(null); setLinksError(''); if (!linksOpen || !active || preview || !document) return;
    let cancelled = false;
    void callTool<NoteLinks>('note_links', { vaultId: document.vaultId, ...noteReference(document.path) }).then(value => { if (!cancelled) setLinks(value); }).catch(reason => { if (!cancelled) setLinksError(messageOf(reason)); });
    return () => { cancelled = true; };
  }, [active, preview, linksOpen, document?.path, document?.revision]);

  const followLink = useCallback(async (url: string) => {
    const current = docRef.current; if (!current) return;
    const target = resolveNoteLink(url, current.path);
    if (!target) { setNotice('此链接不能作为安全的知识库路径或外部网址打开。'); return; }
    if (target.kind === 'note') { await open(noteReference(target.path)); return; }
    if (target.kind === 'paper') {
      if (!await flush()) { setNotice('请先处理当前草稿，再打开论文。'); return; }
      if (onOpenPaper) onOpenPaper(target.path); else setNotice(`论文：${target.path}`);
      return;
    }
    if (target.kind === 'external') {
      if (preview) { setNotice(`预览模式不打开外部链接，可复制：${target.url}`); return; }
      try { await openLink(target.url); } catch (reason) { setNotice(messageOf(reason)); }
      return;
    }
    if (target.kind === 'anchor') { const heading = window.document.getElementById(target.id); if (heading) heading.scrollIntoView({ block: 'nearest' }); }
  }, [open, flush, onOpenPaper, preview]);

  async function rename(newPath: string) {
    if (!await flush()) throw new Error('请先处理当前草稿或保存冲突。');
    const current = docRef.current;
    if (!current?.revision || !current.exists || !current.path.startsWith('notes/')) throw new Error('仅可重命名已保存的普通笔记。');
    const next = await callTool<NoteRenameResult>('note_rename', { vaultId: current.vaultId, path: current.path, newPath, revision: current.revision });
    docRef.current = next; textRef.current = next.content; blocked.current = false;
    setDocument(next); setText(next.content); setState('saved'); setRenameOpen(false); setListRevision(value => value + 1); setNotice('笔记已重命名。已有双链请在相关笔记中确认。'); dirtyCallback.current(false);
  }

  async function createNote(path: string) {
    if (!await flush()) throw new Error('请先处理当前草稿或保存冲突。');
    const existing = await callTool<NoteDocument>('note_read', { vaultId, path });
    if (!existing.exists) await callTool<NoteDocument>('note_write', { vaultId, path, revision: null, content: `# ${path.split('/').at(-1)!.replace(/\.md$/i, '')}\n\n`, mode: 'replace' });
    setNewOpen(false); await open({ path }); setListRevision(value => value + 1);
  }

  const retry = useCallback(async () => { blocked.current = false; await flush(); }, [flush]);
  const save = useCallback(() => { void retry(); }, [retry]);
  const environment = useMemo(() => ({ vaultId: document?.vaultId ?? '', notePath: document?.path ?? '', preview, onLink: (url: string) => { void followLink(url); } }), [document?.vaultId, document?.path, preview, followLink]);
  async function inspectRemote() {
    const current = docRef.current;
    if (!current) return;
    try { setRemote(await callTool<NoteDocument>('note_read', { vaultId: current.vaultId, ...noteReference(current.path) })); setShowRemote(true); }
    catch (reason) { setError(messageOf(reason)); }
  }
  function useRemote() {
    if (!remote) return;
    docRef.current = remote; textRef.current = remote.content; blocked.current = false;
    setDocument(remote); setText(remote.content); setState('saved'); setError(''); setNotice('已载入磁盘版本。');
    dirtyCallback.current(false); setShowRemote(false); setConfirmDiscard(false);
  }
  async function copyDraft() {
    try { await navigator.clipboard.writeText(textRef.current); setNotice('草稿已复制。'); }
    catch { setCopyFallback(true); }
  }

  return <section className={`notes-view view-fill ${listOpen ? '' : 'note-list-collapsed'}`} aria-label="笔记">
    {listOpen && <aside className="notes-list"><div className="notes-list-toolbar"><button disabled={preview} onClick={() => setNewOpen(true)}><Plus size={14} />新建笔记</button><button className="icon-button" aria-label="刷新笔记列表" onClick={() => setListRevision(value => value + 1)} disabled={preview}><RefreshCw size={14} /></button></div>
      <input className="note-list-filter" aria-label="筛选笔记" placeholder="筛选笔记" value={listFilter} onChange={event => setListFilter(event.target.value)} />
      {directory !== 'notes' && <button className="note-entry muted" onClick={() => setDirectory(directory.split('/').slice(0, -1).join('/') || 'notes')}>← 上一级</button>}
      {requestedTarget?.paperPath && <button className={`note-entry ${document?.paperPath === requestedTarget.paperPath ? 'selected' : ''}`} onClick={() => void open({ paperPath: requestedTarget.paperPath })}><FileText size={15} /><span>当前论文笔记</span></button>}
      {list?.items.filter(item => item.name.toLocaleLowerCase().includes(listFilter.toLocaleLowerCase())).map(item => <button key={item.path} className={`note-entry ${document?.path === item.path ? 'selected' : ''}`} title={item.path} onClick={() => { if (item.kind === 'directory') setDirectory(item.path); else void open({ path: item.path }); }}>{item.kind === 'directory' ? <Folder size={15} /> : <FileText size={15} />}<span>{item.name}</span></button>)}
      {list?.items.length === 0 && <p className="field-help notes-empty">没有笔记，可以新建或打开论文笔记。</p>}
      {list?.truncated && <p className="field-help warning-text notes-empty">目录结果已截断，请缩小目录范围。</p>}
    </aside>}
    <div className="note-workspace">
      <div className="note-heading"><button className="icon-button" aria-label={listOpen ? '收起笔记列表' : '展开笔记列表'} onClick={() => setListOpen(value => !value)}>{listOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}</button><div className="note-heading-title"><h2>{document ? document.path.split('/').at(-1) : '阅读笔记'}</h2>{document && <p className="path-text">{document.path}</p>}</div>{document?.path.startsWith('notes/') && <button className="icon-button" aria-label="重命名笔记" disabled={preview || !document.exists || state === 'conflict' || state === 'saving'} onClick={() => setRenameOpen(true)}><Pencil size={14} /></button>}<span className={`save-state ${state === 'error' || state === 'conflict' ? 'warning-text' : 'muted'}`}>{state === 'saving' ? <LoaderCircle className="spin" size={14} /> : state === 'saved' ? <Check size={14} /> : null}{preview ? '预览 · 不保存' : state === 'saving' ? '保存中…' : state === 'saved' ? '已保存' : state === 'dirty' ? '待保存' : state === 'conflict' ? '草稿有冲突' : state === 'error' ? '保存失败' : ''}</span></div>
      {error && <div className="callout error" role="alert">{error}{state === 'conflict' ? <div className="button-row"><button onClick={() => void inspectRemote()}>查看磁盘版本</button><button onClick={() => void copyDraft()}><Copy size={13} />复制草稿</button></div> : state === 'error' ? <button onClick={() => void retry()}>重试保存</button> : null}</div>}
      {notice && <p className="inline-notice" role="status">{notice}</p>}
      {loading ? <div className="empty-state"><LoaderCircle className="spin" />正在读取笔记…</div> : document ? <>
        {active && <MarkdownEditor key={`${document.vaultId}:${document.path}`} value={text} onChange={change} environment={environment} onSave={save} saveDisabled={preview || state === 'saving' || state === 'conflict' || text === document.content} />}
        {!preview && <details className="note-links-panel" open={linksOpen} onToggle={event => setLinksOpen(event.currentTarget.open)}><summary>引用与反向链接{links ? ` · ${links.outgoing.length} 个引用 · ${links.backlinks.length} 个反向链接${links.truncated ? '（结果截断）' : ''}` : ''}</summary>{linksError ? <p className="warning-text">{linksError}</p> : !links ? <p className="muted">正在读取链接…</p> : <>{links.outgoing.length > 0 && <div><span className="muted">引用</span>{links.outgoing.map(link => <button key={link.path} title={link.path} onClick={() => { void followLink(`workbench-wiki:${encodeURIComponent(link.path)}`); }}>{link.title}</button>)}</div>}{links.backlinks.length > 0 && <div><span className="muted">反向链接</span>{links.backlinks.map(link => <button key={link.path} title={link.path} onClick={() => { void open(noteReference(link.path)); }}>{link.title}</button>)}</div>}{!links.outgoing.length && !links.backlinks.length && <p className="muted">尚无文档链接。可以使用 [[notes/笔记.md]] 或 [[papers/论文]] 建立引用。</p>}</>}</details>}
        <footer className="note-footer">{preview ? '演示草稿不会写入真实知识库。' : '停顿后自动保存 · 保存前检查文件变化'}</footer>
      </> : <div className="empty-state"><FileText size={30} /><strong>选择或新建一篇笔记</strong><span>也可以从阅读器打开当前论文的笔记。</span></div>}
    </div>
    {newOpen && <NewNoteDialog onClose={() => setNewOpen(false)} onCreate={createNote} />}
    {renameOpen && document && <RenameNoteDialog path={document.path} onClose={() => setRenameOpen(false)} onRename={rename} />}
    {copyFallback && <CopyDraftDialog content={textRef.current} onClose={() => setCopyFallback(false)} />}
    {showRemote && remote && <div className="inline-comparison" role="dialog" aria-modal="true" aria-label="磁盘笔记版本"><header className="modal-heading"><h2>磁盘版本</h2><button className="icon-button" aria-label="关闭比较" onClick={() => { setShowRemote(false); setConfirmDiscard(false); }}><X size={17} /></button></header><p className="field-help">当前编辑器中的草稿保持不变，可先复制或手动合并。</p><pre>{remote.content || '（空笔记）'}</pre><footer className="modal-footer"><button onClick={() => void copyDraft()}>复制当前草稿</button>{confirmDiscard ? <button className="danger" onClick={useRemote}>确认放弃草稿并载入</button> : <button onClick={() => setConfirmDiscard(true)}>载入磁盘版本…</button>}</footer></div>}
  </section>;
}

function NewNoteDialog({ onClose, onCreate }: { onClose(): void; onCreate(path: string): Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [path, setPath] = useState(`notes/阅读笔记-${Date.now().toString(36)}.md`); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { ref.current?.showModal(); return () => { ref.current?.close(); }; }, []);
  return <dialog ref={ref} className="compact-modal" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}><header className="modal-heading"><h2>新建笔记</h2><button className="icon-button" aria-label="关闭新建笔记" disabled={busy} onClick={onClose}><X size={17} /></button></header><form onSubmit={e => { e.preventDefault(); const valid = safeNotePath(path); if (!valid) { setError('请输入 notes/ 下的 Markdown 相对路径，不能包含越级路径。'); return; } setBusy(true); setError(''); void onCreate(valid).catch(reason => setError(messageOf(reason))).finally(() => setBusy(false)); }}><div className="modal-content"><label htmlFor="new-note-path">笔记路径</label><input autoFocus id="new-note-path" value={path} onChange={e => setPath(e.target.value)} spellCheck={false} disabled={busy} /><p className="field-help">新建 Markdown 笔记并自动保存；如果路径已存在，先读取原内容。</p>{error && <p className="error-text" role="alert">{error}</p>}</div><footer className="modal-footer"><button type="button" onClick={onClose} disabled={busy}>取消</button><button className="primary" disabled={busy}>{busy ? '正在新建…' : '创建或打开'}</button></footer></form></dialog>;
}

function RenameNoteDialog({ path, onClose, onRename }: { path: string; onClose(): void; onRename(path: string): Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null); const [next, setNext] = useState(path); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  return <dialog ref={dialog} className="compact-modal" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}><form onSubmit={event => {
    event.preventDefault(); const valid = safeNotePath(next);
    if (!valid || valid === path) { setError('请输入不同的 notes/ 下 Markdown 相对路径。'); return; }
    setBusy(true); setError(''); void onRename(valid).catch(reason => setError(messageOf(reason))).finally(() => setBusy(false));
  }}><header className="modal-heading"><h2>重命名笔记</h2><button type="button" className="icon-button" aria-label="关闭重命名" disabled={busy} onClick={onClose}><X size={16} /></button></header><div className="modal-content"><label>新路径<input autoFocus value={next} onChange={event => setNext(event.target.value)} disabled={busy} /></label><p className="field-help">保存草稿后检查当前版本，不覆盖已存在的文件。可解析的库内双链会随重命名更新。</p>{error && <p className="error-text" role="alert">{error}</p>}</div><footer className="modal-footer"><button type="button" onClick={onClose} disabled={busy}>取消</button><button className="primary" disabled={busy}>{busy ? '正在重命名…' : '重命名'}</button></footer></form></dialog>;
}

function CopyDraftDialog({ content, onClose }: { content: string; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null); const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { dialog.current?.showModal(); textarea.current?.focus(); textarea.current?.select(); return () => dialog.current?.close(); }, []);
  return <dialog ref={dialog} className="compact-modal note-copy-dialog" onCancel={event => { event.preventDefault(); onClose(); }}><header className="modal-heading"><h2>复制草稿</h2><button className="icon-button" aria-label="关闭复制草稿" onClick={onClose}><X size={16} /></button></header><div className="modal-content"><p className="field-help">剪贴板不可用，请使用系统复制快捷键保存以下完整 Markdown 草稿。</p><textarea ref={textarea} readOnly aria-label="完整笔记草稿" value={content} /></div><footer className="modal-footer"><button onClick={onClose}>完成</button></footer></dialog>;
}
