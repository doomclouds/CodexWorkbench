import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, FileText, Folder, LoaderCircle, Plus, RefreshCw, Save, X } from 'lucide-react';
import type { NoteDocument, NoteInput, NoteList } from '../contracts/types';
import { callTool } from './api';
import { registerBeforeTeardown } from './bridge';
import { codeOf, messageOf, noteReference, safeNotePath } from './model';

export type NoteTarget = Omit<NoteInput, 'vaultId'>;
interface Props {
  active: boolean;
  vaultId: string;
  preview: boolean;
  requestedTarget: NoteTarget | null;
  onDirtyChange(dirty: boolean): void;
}
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

export function NotesView({ active, vaultId, preview, requestedTarget, onDirtyChange }: Props) {
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
  const docRef = useRef<NoteDocument | null>(null);
  const textRef = useRef('');
  const blocked = useRef(false);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const loadingTicket = useRef(0);
  const textarea = useRef<HTMLTextAreaElement>(null);
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
      if (!current || blocked.current || inFlight.current || textRef.current !== current.content || window.document.visibilityState === 'hidden') return;
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
      }
    };
    const timer = setInterval(() => { void inspect(); }, 4000);
    window.addEventListener('focus', inspect);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('focus', inspect); };
  }, [active, preview]);

  function change(value: string) {
    textRef.current = value; setText(value); setNotice('');
    const dirty = value !== docRef.current?.content;
    dirtyCallback.current(dirty);
    if (!blocked.current) setState(dirty ? 'dirty' : 'saved');
    clearTimeout(timer.current);
    if (dirty && !blocked.current && !preview) timer.current = setTimeout(() => { void flush(); }, 400);
  }

  function format(before: string, after = '') {
    const editor = textarea.current;
    if (!editor) return;
    const start = editor.selectionStart; const end = editor.selectionEnd;
    change(text.slice(0, start) + before + text.slice(start, end) + after + text.slice(end));
    requestAnimationFrame(() => { editor.focus(); editor.setSelectionRange(start + before.length, end + before.length); });
  }

  async function retry() { blocked.current = false; await flush(); }
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
    catch { textarea.current?.focus(); textarea.current?.select(); setNotice('请使用系统复制快捷键保存已选中的草稿。'); }
  }

  return <section className="notes-view view-fill" aria-label="笔记">
    <aside className="notes-list"><div className="notes-list-toolbar"><button disabled={preview} onClick={() => setNewOpen(true)}><Plus size={14} />新建笔记</button><button className="icon-button" aria-label="刷新笔记列表" onClick={() => setListRevision(value => value + 1)} disabled={preview}><RefreshCw size={14} /></button></div>
      {directory !== 'notes' && <button className="note-entry muted" onClick={() => setDirectory(directory.split('/').slice(0, -1).join('/') || 'notes')}>← 上一级</button>}
      {requestedTarget?.paperPath && <button className={`note-entry ${document?.paperPath === requestedTarget.paperPath ? 'selected' : ''}`} onClick={() => void open({ paperPath: requestedTarget.paperPath })}><FileText size={15} /><span>当前论文笔记</span></button>}
      {list?.items.map(item => <button key={item.path} className={`note-entry ${document?.path === item.path ? 'selected' : ''}`} title={item.path} onClick={() => { if (item.kind === 'directory') setDirectory(item.path); else void open({ path: item.path }); }}>{item.kind === 'directory' ? <Folder size={15} /> : <FileText size={15} />}<span>{item.name}</span></button>)}
      {list?.items.length === 0 && <p className="field-help notes-empty">没有笔记，可以新建或打开论文笔记。</p>}
      {list?.truncated && <p className="field-help warning-text notes-empty">目录结果已截断，请缩小目录范围。</p>}
    </aside>
    <div className="note-workspace">
      <div className="note-heading"><div><h2>{document ? document.path.split('/').at(-1) : '阅读笔记'}</h2>{document && <p className="path-text">{document.path}</p>}</div><span className={`save-state ${state === 'error' || state === 'conflict' ? 'warning-text' : 'muted'}`}>{state === 'saving' ? <LoaderCircle className="spin" size={14} /> : state === 'saved' ? <Check size={14} /> : null}{preview ? '预览 · 不保存' : state === 'saving' ? '保存中…' : state === 'saved' ? '已保存' : state === 'dirty' ? '待保存' : state === 'conflict' ? '草稿有冲突' : state === 'error' ? '保存失败' : ''}</span></div>
      {error && <div className="callout error" role="alert">{error}{state === 'conflict' ? <div className="button-row"><button onClick={() => void inspectRemote()}>查看磁盘版本</button><button onClick={() => void copyDraft()}><Copy size={13} />复制草稿</button></div> : state === 'error' ? <button onClick={() => void retry()}>重试保存</button> : null}</div>}
      {notice && <p className="inline-notice" role="status">{notice}</p>}
      {loading ? <div className="empty-state"><LoaderCircle className="spin" />正在读取笔记…</div> : document ? <>
        <div className="note-formatbar"><span className="muted">Markdown</span><button aria-label="加粗" onClick={() => format('**', '**')}><strong>B</strong></button><button aria-label="斜体" onClick={() => format('*', '*')}><em>I</em></button><button aria-label="二级标题" onClick={() => format('## ')}>H2</button><button aria-label="列表" onClick={() => format('- ')}>列表</button><button aria-label="引用" onClick={() => format('> ')}>引用</button><span className="toolbar-spacer" /><button disabled={preview || state === 'saving' || state === 'conflict' || text === document.content} onClick={() => void retry()}><Save size={14} />保存</button></div>
        <textarea ref={textarea} className="markdown-editor" aria-label="笔记 Markdown 内容" value={text} onChange={e => change(e.target.value)} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (state !== 'conflict') void retry(); } }} spellCheck={false} placeholder="# 阅读笔记" />
        <footer className="note-footer">{preview ? '演示草稿不会写入真实知识库。' : '停顿后自动保存 · 保存前检查文件变化'}</footer>
      </> : <div className="empty-state"><FileText size={30} /><strong>选择或新建一篇笔记</strong><span>也可以从阅读器打开当前论文的笔记。</span></div>}
    </div>
    {newOpen && <NewNoteDialog onClose={() => setNewOpen(false)} onCreate={path => { setNewOpen(false); void open({ path }); setListRevision(value => value + 1); }} />}
    {showRemote && remote && <div className="inline-comparison" role="dialog" aria-modal="true" aria-label="磁盘笔记版本"><header className="modal-heading"><h2>磁盘版本</h2><button className="icon-button" aria-label="关闭比较" onClick={() => { setShowRemote(false); setConfirmDiscard(false); }}><X size={17} /></button></header><p className="field-help">当前编辑器中的草稿保持不变，可先复制或手动合并。</p><pre>{remote.content || '（空笔记）'}</pre><footer className="modal-footer"><button onClick={() => void copyDraft()}>复制当前草稿</button>{confirmDiscard ? <button className="danger" onClick={useRemote}>确认放弃草稿并载入</button> : <button onClick={() => setConfirmDiscard(true)}>载入磁盘版本…</button>}</footer></div>}
  </section>;
}

function NewNoteDialog({ onClose, onCreate }: { onClose(): void; onCreate(path: string): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [path, setPath] = useState(`notes/阅读笔记-${Date.now().toString(36)}.md`); const [error, setError] = useState('');
  useEffect(() => { ref.current?.showModal(); return () => { ref.current?.close(); }; }, []);
  return <dialog ref={ref} className="compact-modal" onCancel={e => { e.preventDefault(); onClose(); }}><header className="modal-heading"><h2>新建笔记</h2><button className="icon-button" aria-label="关闭新建笔记" onClick={onClose}><X size={17} /></button></header><form onSubmit={e => { e.preventDefault(); const valid = safeNotePath(path); if (valid) onCreate(valid); else setError('请输入 notes/ 下的 Markdown 相对路径，不能包含越级路径。'); }}><div className="modal-content"><label htmlFor="new-note-path">笔记路径</label><input autoFocus id="new-note-path" value={path} onChange={e => setPath(e.target.value)} spellCheck={false} /><p className="field-help">打开后编辑即可自动保存。如果该路径已存在，会先读取原内容。</p>{error && <p className="error-text" role="alert">{error}</p>}</div><footer className="modal-footer"><button type="button" onClick={onClose}>取消</button><button className="primary">打开编辑器</button></footer></form></dialog>;
}
