import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, FileText, FolderPlus, Link, LoaderCircle, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import type { NoteDocument, NoteInput } from '../contracts/types';
import type { NoteTree as NoteTreeResult } from '../contracts/notes';
import type { NoteLinks, NoteRenameResult } from '../contracts/reader';
import { callTool } from './api';
import { openLink, registerBeforeTeardown } from './bridge';
import { codeOf, messageOf, noteReference } from './model';
import { MarkdownEditor } from './notes/MarkdownEditor';
import { resolveNoteLink } from './notes/markdown-model';
import { startSequentialPoll } from './activity';
import { NoteTree } from './notes/NoteTree';
import { AnchoredMenu, type MenuAnchor } from './ui/AnchoredMenu';
import { NewNoteDialog, NoteActionDialog, type NoteAction, type NoteActionValues, type NoteLocation } from './notes/NoteDialogs';
import { buildWorkspaceTree, descendantNoteCount, movedPath, noteTitle, parentFolder, renamedPath, type NoteTreeItem, type WorkspaceNode } from './notes/workspace-model';
import './notes/workspace.css';

export type NoteTarget = Omit<NoteInput, 'vaultId'>;
export interface NotesController { flush(): Promise<boolean>; isDirty(): boolean }
export interface ActiveNote { path: string; title: string; paperPath?: string }
interface Props {
  active: boolean;
  vaultId: string;
  preview: boolean;
  requestedTarget: NoteTarget | null;
  onDirtyChange(dirty: boolean): void;
  onOpenPaper?(paperPath: string, page?: number, markId?: string): void;
  compact?: boolean;
  paperPath?: string;
  onOpenWorkspace?(note?: ActiveNote): void;
  onOpenPaperMarkdown?(): void;
  onOpenTrash?(): void;
  onActiveNoteChange?(note: ActiveNote | null): void;
  onControllerReady?(controller: NotesController | null): void;
  onCloseCompact?(): void;
}
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';
type NoteMenu = { kind: 'item'; item: NoteTreeItem; anchor: MenuAnchor } | { kind: 'paper'; paperPath: string; title: string; anchor: MenuAnchor } | { kind: 'workspace'; anchor: MenuAnchor };

export function NotesView({ active, vaultId, preview, requestedTarget, onDirtyChange, onOpenPaper, compact = false, paperPath, onOpenWorkspace, onOpenPaperMarkdown, onOpenTrash, onActiveNoteChange, onControllerReady, onCloseCompact }: Props) {
  const [list, setList] = useState<NoteTreeResult | null>(null);
  const [directory, setDirectory] = useState('notes');
  const [folderPaper, setFolderPaper] = useState<string | null | undefined>(undefined);
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
  const [menu, setMenu] = useState<NoteMenu | null>(null);
  const [action, setAction] = useState<{ kind: NoteAction; item: NoteTreeItem } | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
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
  const handledPaperRequest = useRef<NoteTarget | null>(null);
  const handledPathRequest = useRef<NoteTarget | null>(null);
  const inspecting = useRef(false);
  const alive = useRef(true);
  const workspace = useRef<HTMLElement>(null);
  const dirtyCallback = useRef(onDirtyChange); dirtyCallback.current = onDirtyChange;
  const scopePaper = paperPath || requestedTarget?.paperPath;
  const treeNodes = useMemo(() => buildWorkspaceTree(list?.items || [], listFilter), [list, listFilter]);
  const paperNotes = useMemo(() => (list?.items || []).filter(item => item.kind === 'file' && (!scopePaper || item.paperPath === scopePaper)), [list, scopePaper]);
  const activeCallback = useRef(onActiveNoteChange); activeCallback.current = onActiveNoteChange;

  useEffect(() => { activeCallback.current?.(document ? { path: document.path, title: noteTitle(document.path), paperPath: document.paperPath } : null); }, [document?.path, document?.paperPath]);
  useEffect(() => { if (!active) setMenu(null); }, [active]);
  useEffect(() => { if (notice !== '笔记已从磁盘更新。') return; const timeout = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(timeout); }, [notice]);

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
    const controller = { flush, isDirty: () => !!docRef.current && (textRef.current !== docRef.current.content || blocked.current) };
    onControllerReady?.(controller); return () => onControllerReady?.(null);
  }, [flush, onControllerReady]);

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
    if (!await flush()) { setNotice('请先处理当前草稿，再切换笔记。'); return false; }
    const ticket = ++loadingTicket.current;
    setLoading(true); setError(''); setNotice('');
    try {
      const next = preview
        ? { vaultId, path: 'notes/界面预览.md', content: '# 阅读笔记\n\n这是演示内容，不连接或保存到真实知识库。\n\n## 核心思路\n\n- 连接论文、讨论与笔记。\n- 引用真实资料，保留待验证的问题。\n', revision: 'preview', exists: true }
        : await callTool<NoteDocument>('note_read', { vaultId, ...target });
      if (!alive.current || ticket !== loadingTicket.current) return false;
      docRef.current = next; textRef.current = next.content; blocked.current = false;
      setDocument(next); setText(next.content); setState('saved'); setRemote(null); dirtyCallback.current(false);
      return true;
    } catch (reason) { if (ticket === loadingTicket.current) setError(messageOf(reason)); return false; }
    finally { if (ticket === loadingTicket.current) setLoading(false); }
  }, [flush, preview, vaultId]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    if (preview) {
      setList({ vaultId, items: [{ path: 'notes/界面预览.md', parentPath: 'notes', name: '界面预览.md', kind: 'file', revision: 'preview' }], truncated: false });
      if (!docRef.current) void open({ path: 'notes/界面预览.md' });
      return;
    }
    void callTool<NoteTreeResult>('note_tree', { vaultId, ...(compact && scopePaper ? { paperPath: scopePaper } : {}), limit: 1000 }).then(value => {
      if (cancelled) return;
      setList(value);
      const requestedPaper = requestedTarget?.paperPath && !requestedTarget.path && handledPaperRequest.current !== requestedTarget ? requestedTarget.paperPath : undefined;
      if (requestedPaper) handledPaperRequest.current = requestedTarget;
      const preferredPaper = compact ? scopePaper : requestedPaper || (!docRef.current ? scopePaper : undefined);
      if ((!docRef.current || (preferredPaper && docRef.current.paperPath !== preferredPaper)) && !requestedTarget?.path) {
        const first = value.items.find(item => item.kind === 'file' && (!preferredPaper || item.paperPath === preferredPaper));
        if (first) void open({ path: first.path });
        else if (preferredPaper && docRef.current && docRef.current.paperPath !== preferredPaper) {
          void flush().then(saved => {
            if (cancelled) return;
            if (saved) clearNote(); else setNotice('上一篇论文的草稿尚未保存，请先处理草稿。');
          });
        }
      }
    }).catch(reason => { if (!cancelled) setError(messageOf(reason)); });
    return () => { cancelled = true; };
  }, [active, vaultId, listRevision, preview, open, flush, compact, scopePaper, requestedTarget]);

  useEffect(() => {
    if (active && requestedTarget?.path && handledPathRequest.current !== requestedTarget) {
      handledPathRequest.current = requestedTarget; void open({ path: requestedTarget.path });
    }
  }, [active, requestedTarget, open]);

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
      if (onOpenPaper) onOpenPaper(target.path, target.page, target.markId); else setNotice(`论文：${target.path}${target.page ? ` · PDF 第 ${target.page} 页` : ''}`);
      return;
    }
    if (target.kind === 'external') {
      if (preview) { setNotice(`预览模式不打开外部链接，可复制：${target.url}`); return; }
      try { await openLink(target.url); } catch (reason) { setNotice(messageOf(reason)); }
      return;
    }
    if (target.kind === 'anchor') { const heading = window.document.getElementById(target.id); if (heading) heading.scrollIntoView({ block: 'nearest' }); }
  }, [open, flush, onOpenPaper, preview]);

  function adopt(next: NoteDocument) {
    docRef.current = next; textRef.current = next.content; blocked.current = false;
    setDocument(next); setText(next.content); setState('saved'); setRemote(null); dirtyCallback.current(false);
  }
  function clearNote() {
    docRef.current = null; textRef.current = ''; blocked.current = false; setDocument(null); setText(''); setState('idle'); setRemote(null); dirtyCallback.current(false);
  }

  async function createNote(location: NoteLocation) {
    if (!await flush()) throw new Error('请先处理当前草稿或保存冲突。');
    const next = await callTool<NoteDocument>('note_create', { vaultId, ...location });
    adopt(next); setNewOpen(false); setDirectory(parentFolder(next.path)); setListRevision(value => value + 1); setNotice('笔记已创建。');
  }
  async function createFolder(parentPath: string, name: string) {
    if (!await flush()) throw new Error('请先处理当前草稿或保存冲突。');
    const created = await callTool<NoteTreeItem>('note_folder_create', { vaultId, parentPath, name });
    setListRevision(value => value + 1); return created;
  }

  async function performAction(values: NoteActionValues) {
    if (!action) return;
    if (!await flush()) throw new Error('请先处理当前草稿或保存冲突。');
    const { item, kind } = action;
    setMutationBusy(true);
    try {
      if (kind === 'folder') {
        const created = await callTool<NoteTreeItem>('note_folder_create', { vaultId, parentPath: values.folderPath, name: values.name.trim() });
        setDirectory(created.path); setAction(null); setListRevision(value => value + 1); setNotice('文件夹已创建。'); return;
      }
      const current = docRef.current;
      const source = item.kind === 'file' ? current?.path === item.path ? current : await callTool<NoteDocument>('note_read', { vaultId, path: item.path }) : item;
      if (!source.revision) throw new Error('此项目缺少当前版本，请刷新笔记树后重试。');
      if (kind === 'associate') {
        const next = await callTool<NoteDocument>('note_associate', { vaultId, path: item.path, paperPath: values.paperPath, revision: source.revision });
        if (current?.path === item.path) adopt(next);
        setAction(null); setListRevision(value => value + 1); setNotice('主关联论文已更新，原有引用保留。'); return;
      }
      if (kind === 'trash') {
        await callTool('note_trash', { vaultId, path: item.path, revision: source.revision });
        if (current && (current.path === item.path || current.path.startsWith(`${item.path}/`))) {
          clearNote();
        }
        setDirectory('notes'); setAction(null); setListRevision(value => value + 1); setNotice('已移入知识库回收站。'); return;
      }
      const newPath = kind === 'rename' ? renamedPath(item.path, values.name, item.kind) : movedPath(item.path, values.folderPath);
      if (!newPath || newPath === item.path) throw new Error('请选择不同的名称或目标文件夹，文件夹不能移入自身。');
      if (item.kind === 'file') {
        const next = await callTool<NoteRenameResult>('note_move', { vaultId, path: item.path, newPath, revision: source.revision });
        if (current?.path === item.path) adopt(next);
      } else {
        await callTool('note_folder_move', { vaultId, path: item.path, newPath, revision: source.revision });
        setAction(null);
        if (current?.path.startsWith(`${item.path}/`)) await open({ path: newPath + current.path.slice(item.path.length) });
      }
      setDirectory(item.kind === 'file' ? parentFolder(newPath) : newPath); setAction(null); setListRevision(value => value + 1); setNotice(kind === 'rename' ? '已重命名。' : '已移动，关联论文保留。');
    } finally { setMutationBusy(false); }
  }

  async function navigate(callback?: () => void) {
    if (!callback) return;
    if (!await flush()) { setNotice('请先处理当前草稿，再离开笔记。'); return; }
    callback();
  }
  function openWorkspace() {
    return navigate(() => {
      const current = docRef.current;
      onOpenWorkspace?.(current ? { path: current.path, title: noteTitle(current.path), paperPath: current.paperPath } : undefined);
    });
  }
  function showMenu(node: WorkspaceNode, anchor: MenuAnchor) {
    if (node.kind === 'group') {
      if (node.paperPath) setMenu({ kind: 'paper', paperPath: node.paperPath, title: node.name, anchor });
      return;
    }
    const item = list?.items.find(entry => entry.path === node.path);
    if (item) setMenu({ kind: 'item', item, anchor });
  }
  async function chooseNote(path: string) {
    const item = list?.items.find(entry => entry.path === path);
    if (!await open({ path })) return;
    setDirectory(parentFolder(path)); setFolderPaper(item?.paperPath || null);
    if (workspace.current && workspace.current.getBoundingClientRect().width <= 650) {
      setListOpen(false);
      requestAnimationFrame(() => workspace.current?.querySelector<HTMLElement>('[contenteditable="true"], textarea')?.focus());
    }
  }
  async function beginAction(kind: NoteAction, item: NoteTreeItem) {
    setMenu(null);
    if (!await flush()) { setNotice('请先处理当前草稿，再整理笔记。'); return; }
    if (item.kind === 'directory' && kind !== 'folder') {
      setMutationBusy(true);
      try {
        // Saving a child changes its folder revision. Establish the dialog's baseline after that save.
        const snapshot = await callTool<NoteTreeResult>('note_tree', { vaultId, ...(compact && scopePaper ? { paperPath: scopePaper } : {}), limit: 1000 });
        const refreshed = snapshot.items.find(entry => entry.path === item.path);
        if (!refreshed?.revision) throw new Error('此文件夹已变化或不在当前结果中，请刷新笔记树。');
        setList(snapshot); setAction({ kind, item: refreshed });
      } catch (reason) { setError(messageOf(reason)); }
      finally { setMutationBusy(false); }
      return;
    }
    setAction({ kind, item });
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

  const creationPaper = compact ? scopePaper : folderPaper === undefined ? document?.paperPath || scopePaper : folderPaper || undefined;
  const creationPaperTitle = list?.items.find(item => item.paperPath === creationPaper)?.paperTitle || (document?.paperPath === creationPaper ? document?.paperTitle : undefined);
  const currentItem: NoteTreeItem | null = document?.path.startsWith('notes/') ? { path: document.path, parentPath: parentFolder(document.path), name: document.path.split('/').at(-1)!, kind: 'file', revision: document.revision || undefined, paperPath: document.paperPath, paperTitle: document.paperTitle, paperId: document.paperId } : null;
  const folderItem: NoteTreeItem = list?.items.find(item => item.path === directory && item.kind === 'directory') || { path: directory, parentPath: parentFolder(directory), name: directory === 'notes' ? '全部笔记' : directory.split('/').at(-1)!, kind: 'directory' };
  const menuItem = menu?.kind === 'item' ? menu.item : null;
  const menuActions: { kind: NoteAction; label: string; Icon: typeof Pencil }[] = [{ kind: 'rename', label: '重命名', Icon: Pencil }, { kind: 'move', label: '移动到…', Icon: FolderPlus }, ...(menuItem?.kind === 'file' ? [{ kind: 'associate' as const, label: '修改关联论文', Icon: Link }] : []), { kind: 'trash', label: '移入回收站', Icon: Trash2 }];
  const saveStatus = <span className={`save-state ${state === 'error' || state === 'conflict' ? 'warning-text' : 'muted'}`}>{state === 'saving' ? <LoaderCircle className="spin" size={14} /> : state === 'saved' ? <Check size={14} /> : null}{preview ? '预览 · 不保存' : state === 'saving' ? '保存中…' : state === 'saved' ? '已保存' : state === 'dirty' ? '待保存' : state === 'conflict' ? '草稿有冲突' : state === 'error' ? '保存失败' : ''}</span>;
  const currentMenuButton = (currentItem || compact && (onOpenWorkspace || onOpenPaperMarkdown)) && <button className="icon-button" aria-label={currentItem ? '当前笔记的操作' : '笔记工作区操作'} aria-haspopup="menu" disabled={mutationBusy || !!currentItem && (preview || !document?.exists)} onClick={event => { const anchor = { element: event.currentTarget }; setMenu(previous => currentItem ? previous?.kind === 'item' && previous.item.path === currentItem.path ? null : { kind: 'item', item: currentItem, anchor } : previous?.kind === 'workspace' ? null : { kind: 'workspace', anchor }); }}><MoreHorizontal size={17} /></button>;
  return <section ref={workspace} className={`notes-view notes-workspace-view view-fill ${compact ? 'notes-compact' : ''} ${listOpen ? '' : 'note-list-collapsed'}`} aria-label={compact ? '当前论文笔记' : '笔记工作区'}>
    {!compact && listOpen && <button className="note-tree-backdrop" aria-label="关闭笔记目录" onClick={() => setListOpen(false)} />}
    {!compact && listOpen && <aside className="notes-list"><div className="notes-list-toolbar"><h2>笔记</h2><button className="icon-button" aria-label="新建笔记" title="新建笔记" disabled={preview || mutationBusy} onClick={() => setNewOpen(true)}><Plus size={17} /></button><button className="icon-button" aria-label="新建文件夹" title="新建文件夹" disabled={preview || mutationBusy} onClick={() => setAction({ kind: 'folder', item: folderItem })}><FolderPlus size={17} /></button><button className="icon-button" aria-label="刷新笔记列表" onClick={() => setListRevision(value => value + 1)} disabled={preview}><RefreshCw size={14} /></button><button className="icon-button note-tree-close" aria-label="收起文件夹树" onClick={() => setListOpen(false)}><PanelLeftClose size={15} /></button></div>
      <input className="note-list-filter" aria-label="筛选笔记" placeholder="搜索笔记…" value={listFilter} onChange={event => setListFilter(event.target.value)} />
      <div className="note-tree-scroll"><NoteTree nodes={treeNodes} selectedPath={document?.path} folderPath={directory} filter={listFilter} onOpen={path => { void chooseNote(path); }} onFolder={(path, association) => { setDirectory(path); setFolderPaper(association || null); }} onMenu={showMenu} />
      {list?.items.length === 0 && <p className="field-help notes-empty">还没有笔记。新建一篇，记录阅读中的想法。</p>}{listFilter && !treeNodes.length && <p className="field-help notes-empty">没有匹配的笔记。</p>}
      {list?.truncated && <p className="field-help warning-text notes-empty">笔记树仅显示部分结果，请在论文阅读页查看其关联笔记。</p>}</div>
      {onOpenTrash && <button className="note-trash-link" onClick={() => void navigate(onOpenTrash)}><Trash2 size={15} />回收站</button>}
    </aside>}
    <div className="note-workspace">
      {compact && <div className="note-compact-picker"><select aria-label="当前论文的笔记" value={document && paperNotes.some(item => item.path === document.path) ? document.path : ''} disabled={loading || mutationBusy} onChange={event => { if (event.target.value) void open({ path: event.target.value }); }}><option value="" disabled>{paperNotes.length ? '选择阅读笔记' : '还没有关联笔记'}</option>{paperNotes.map(item => <option key={item.path} value={item.path}>{noteTitle(item.path)}</option>)}</select>{saveStatus}<button className="icon-button" aria-label="新建当前论文笔记" title="新建当前论文笔记" disabled={preview || mutationBusy} onClick={() => setNewOpen(true)}><Plus size={16} /></button>{currentMenuButton}{onCloseCompact && <button className="icon-button" aria-label="关闭论文笔记" onClick={() => void navigate(onCloseCompact)}><X size={16} /></button>}</div>}
      {!compact && onOpenPaperMarkdown && <div className="note-document-tabs" role="group" aria-label="论文文档"><button className="selected" aria-pressed="true">阅读笔记</button><button aria-pressed="false" onClick={() => void navigate(onOpenPaperMarkdown)}>论文正文</button></div>}
      {!compact && <div className="note-heading"><button className="icon-button" aria-label={listOpen ? '收起笔记列表' : '展开笔记列表'} onClick={() => setListOpen(value => !value)}>{listOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}</button><div className="note-heading-title"><h2>{document ? noteTitle(document.path) : '阅读笔记'}</h2>{document && <p className="note-breadcrumb">{document.path.split('/').slice(1, -1).join(' / ') || '主题笔记'}</p>}</div>{saveStatus}{currentMenuButton}</div>}
      {!compact && document?.paperPath && <div className="note-association"><button className="note-paper-chip" title="打开关联论文 PDF" disabled={!onOpenPaper} onClick={() => void navigate(() => onOpenPaper?.(document.paperPath!))}><Link size={14} />关联论文：<span>{document.paperTitle || document.paperPath.split('/').at(-1)}</span></button></div>}
      {error && <div className="callout error" role="alert">{error}{state === 'conflict' ? <div className="button-row"><button onClick={() => void inspectRemote()}>查看磁盘版本</button><button onClick={() => void copyDraft()}><Copy size={13} />复制草稿</button></div> : state === 'error' ? <button onClick={() => void retry()}>重试保存</button> : null}</div>}
      {notice && <p className="inline-notice" role="status">{notice}</p>}
      {loading ? <div className="empty-state"><LoaderCircle className="spin" />正在读取笔记…</div> : document ? <>
        {active && <MarkdownEditor key={`${document.vaultId}:${document.path}`} compact={compact} value={text} onChange={change} environment={environment} onSave={save} saveDisabled={preview || state === 'saving' || state === 'conflict' || text === document.content} />}
        {!preview && <details className="note-links-panel" open={linksOpen} onToggle={event => setLinksOpen(event.currentTarget.open)}><summary>引用与反向链接{links ? ` · ${links.outgoing.length} 个引用 · ${links.backlinks.length} 个反向链接${links.truncated ? '（结果截断）' : ''}` : ''}</summary>{linksError ? <p className="warning-text">{linksError}</p> : !links ? <p className="muted">正在读取链接…</p> : <>{links.outgoing.length > 0 && <div><span className="muted">引用</span>{links.outgoing.map(link => <button key={link.path} title={link.path} onClick={() => { void followLink(`workbench-wiki:${encodeURIComponent(link.path)}`); }}>{link.title}</button>)}</div>}{links.backlinks.length > 0 && <div><span className="muted">反向链接</span>{links.backlinks.map(link => <button key={link.path} title={link.path} onClick={() => { void open(noteReference(link.path)); }}>{link.title}</button>)}</div>}{!links.outgoing.length && !links.backlinks.length && <p className="muted">尚无文档链接。可以使用 [[notes/笔记.md]] 或 [[papers/论文]] 建立引用。</p>}</>}</details>}
        {!compact && <footer className="note-footer">{preview ? '演示草稿不会写入真实知识库。' : '停顿后自动保存 · 保存前检查文件变化'}</footer>}
      </> : <div className="empty-state"><FileText size={30} /><strong>{compact ? '为这篇论文创建第一篇笔记' : '选择或新建一篇笔记'}</strong><span>每篇笔记独立保存，可保留 PDF 页码与批注引用。</span><button disabled={preview || mutationBusy} onClick={() => setNewOpen(true)}><Plus size={14} />新建笔记</button></div>}
    </div>
    {active && menu && <AnchoredMenu anchor={menu.anchor} onClose={() => setMenu(null)} className="note-context-menu" ariaLabel={menu.kind === 'paper' ? '论文关联笔记操作' : '笔记操作'}><span className="note-menu-title">{menu.kind === 'paper' ? menu.title : menu.kind === 'workspace' ? '笔记工作区' : menu.item.kind === 'directory' ? `文件夹：${menu.item.name}` : noteTitle(menu.item.path)}</span>{menu.kind === 'paper' ? <><button role="menuitem" disabled={preview || mutationBusy} onClick={() => { setDirectory('notes'); setFolderPaper(menu.paperPath); setMenu(null); setNewOpen(true); }}><Plus size={15} />新建关联笔记</button>{onOpenPaper && <button role="menuitem" onClick={() => { setMenu(null); void navigate(() => onOpenPaper(menu.paperPath)); }}><FileText size={15} />打开关联论文</button>}</> : <>{compact && <>{onOpenWorkspace && <button role="menuitem" title="打开完整笔记工作区" onClick={() => { setMenu(null); void openWorkspace(); }}><PanelLeftOpen size={15} />全部笔记</button>}{onOpenPaperMarkdown && <button role="menuitem" onClick={() => { setMenu(null); void navigate(onOpenPaperMarkdown); }}><FileText size={15} />论文正文</button>}{document?.paperPath && onOpenPaper && <button role="menuitem" onClick={() => { setMenu(null); void navigate(() => onOpenPaper(document.paperPath!)); }}><Link size={15} />打开关联论文</button>}</>}{menu.kind === 'item' && menuActions.map(({ kind, label, Icon }) => <button key={kind} role="menuitem" className={kind === 'trash' ? 'danger-text' : ''} onClick={() => void beginAction(kind, menu.item)}><Icon size={15} />{label}</button>)}</>}</AnchoredMenu>}
    {newOpen && <NewNoteDialog vaultId={vaultId} items={list?.items || []} folderPath={compact ? list?.paperFolderPath || 'notes' : directory} paperPath={creationPaper} paperTitle={creationPaperTitle} onClose={() => setNewOpen(false)} onCreate={createNote} onCreateFolder={createFolder} />}
    {action && <NoteActionDialog action={action.kind} item={action.item} items={list?.items || []} vaultId={vaultId} affectedCount={action.item.noteCount ?? descendantNoteCount(list?.items || [], action.item.path)} onClose={() => setAction(null)} onSubmit={performAction} />}
    {copyFallback && <CopyDraftDialog content={textRef.current} onClose={() => setCopyFallback(false)} />}
    {showRemote && remote && <div className="inline-comparison" role="dialog" aria-modal="true" aria-label="磁盘笔记版本"><header className="modal-heading"><h2>磁盘版本</h2><button className="icon-button" aria-label="关闭比较" onClick={() => { setShowRemote(false); setConfirmDiscard(false); }}><X size={17} /></button></header><p className="field-help">当前编辑器中的草稿保持不变，可先复制或手动合并。</p><pre>{remote.content || '（空笔记）'}</pre><footer className="modal-footer"><button onClick={() => void copyDraft()}>复制当前草稿</button>{confirmDiscard ? <button className="danger" onClick={useRemote}>确认放弃草稿并载入</button> : <button onClick={() => setConfirmDiscard(true)}>载入磁盘版本…</button>}</footer></div>}
  </section>;
}

function CopyDraftDialog({ content, onClose }: { content: string; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null); const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { dialog.current?.showModal(); textarea.current?.focus(); textarea.current?.select(); return () => dialog.current?.close(); }, []);
  return <dialog ref={dialog} className="compact-modal note-copy-dialog" onCancel={event => { event.preventDefault(); onClose(); }}><header className="modal-heading"><h2>复制草稿</h2><button className="icon-button" aria-label="关闭复制草稿" onClick={onClose}><X size={16} /></button></header><div className="modal-content"><p className="field-help">剪贴板不可用，请使用系统复制快捷键保存以下完整 Markdown 草稿。</p><textarea ref={textarea} readOnly aria-label="完整笔记草稿" value={content} /></div><footer className="modal-footer"><button onClick={onClose}>完成</button></footer></dialog>;
}
