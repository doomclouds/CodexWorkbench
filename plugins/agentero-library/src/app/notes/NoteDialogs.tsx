import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, FileText, Folder, FolderPlus, Link, Search, X } from 'lucide-react';
import type { Paper, PaperPage } from '../../contracts/types';
import { callTool } from '../api';
import { messageOf } from '../model';
import { noteTitle, parentFolder, validEntryName, type NoteTreeItem } from './workspace-model';

export interface NoteLocation { title: string; folderPath?: string; paperPath?: string }
interface DialogProps { onClose(): void; children: ReactNode; title: string; busy: boolean }
function NoteDialog({ onClose, children, title, busy }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  return <dialog ref={ref} className="compact-modal note-location-dialog" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}><header className="modal-heading"><h2>{title}</h2><button type="button" className="icon-button" aria-label={`关闭${title}`} disabled={busy} onClick={onClose}><X size={17} /></button></header>{children}</dialog>;
}

export function FolderPicker({ items, value, onChange, disabled, automaticLabel, exclude }: {
  items: NoteTreeItem[]; value: string; onChange(path: string): void; disabled?: boolean; automaticLabel?: string; exclude?: string;
}) {
  const directoryMap = new Map(items.filter(item => item.kind === 'directory' && item.path !== exclude && !item.path.startsWith(`${exclude}/`)).map(item => [item.path, item]));
  for (const entry of [...directoryMap.values()]) {
    let path = entry.parentPath;
    while (path && path !== 'notes') {
      if (!directoryMap.has(path)) directoryMap.set(path, { path, parentPath: parentFolder(path), name: path.split('/').at(-1)!, kind: 'directory' });
      path = parentFolder(path);
    }
  }
  const directories = [...directoryMap.values()];
  const render = (path: string, depth: number): ReactNode => {
    const entry = directories.find(item => item.path === path);
    const children = directories.filter(item => item.parentPath === path).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    return <li key={path} role="none"><button type="button" role="treeitem" aria-selected={value === path} className={value === path ? 'selected' : ''} disabled={disabled} style={{ paddingLeft: 10 + depth * 18 }} onClick={() => onChange(path)}>{children.length ? <ChevronDown size={12} /> : <span className="note-tree-chevron" />}<Folder size={15} /><span>{path === 'notes' ? '全部笔记' : entry?.parentPath === 'notes/论文' && entry.paperPath ? entry.paperTitle || entry.name : entry?.name || path.split('/').at(-1)}</span></button>{children.length > 0 && <ul role="group">{children.map(item => render(item.path, depth + 1))}</ul>}</li>;
  };
  return <div className="note-folder-picker">{automaticLabel && <button type="button" className={`note-folder-automatic ${value === '' ? 'selected' : ''}`} disabled={disabled} onClick={() => onChange('')}><Folder size={15} />{automaticLabel}</button>}<ul role="tree" aria-label="目标文件夹">{render('notes', 0)}</ul></div>;
}

export function PaperPicker({ vaultId, value, title, onChange, disabled }: { vaultId: string; value: string; title?: string; onChange(path: string, title?: string): void; disabled: boolean }) {
  const [query, setQuery] = useState(''); const [papers, setPapers] = useState<Paper[]>([]); const [cursor, setCursor] = useState<string | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    let cancelled = false; generation.current += 1;
    const timer = setTimeout(() => {
      setLoading(true); setError('');
      void callTool<PaperPage>('paper_list', { vaultId, query: query || undefined, sortBy: 'title', sortDir: 'asc', limit: 40 }).then(result => { if (!cancelled) { setPapers(result.items); setCursor(result.nextCursor); } }).catch(reason => { if (!cancelled) setError(messageOf(reason)); }).finally(() => { if (!cancelled) setLoading(false); });
    }, 200);
    return () => { cancelled = true; generation.current += 1; clearTimeout(timer); };
  }, [vaultId, query]);
  return <div className="note-paper-picker"><div className="note-paper-search"><Search size={14} /><input aria-label="搜索所属论文" placeholder="搜索论文…" value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} /></div><select aria-label="所属论文" value={value} disabled={disabled} onChange={event => { const paper = papers.find(item => item.path === event.target.value); onChange(event.target.value, paper?.title); }}><option value="">主题笔记 · 不指定主关联论文</option>{value && !papers.some(paper => paper.path === value) && <option value={value}>{title || value.split('/').at(-1)}</option>}{papers.map(paper => <option key={paper.path} value={paper.path}>{paper.title}</option>)}</select>{loading && <span className="field-help">正在读取论文…</span>}{error && <p className="error-text" role="alert">{error}</p>}{cursor && <button type="button" className="note-load-papers" disabled={disabled || loading} onClick={() => {
    const next = cursor; const request = generation.current; setLoading(true); setError(''); void callTool<PaperPage>('paper_list', { vaultId, query: query || undefined, sortBy: 'title', sortDir: 'asc', limit: 40, cursor: next }).then(result => { if (generation.current !== request) return; setPapers(previous => [...previous, ...result.items.filter(paper => !previous.some(item => item.path === paper.path))]); setCursor(result.nextCursor); }).catch(reason => { if (generation.current === request) setError(messageOf(reason)); }).finally(() => { if (generation.current === request) setLoading(false); });
  }}>加载更多论文</button>}</div>;
}

export function NewNoteDialog({ vaultId, items, folderPath, paperPath, paperTitle, onClose, onCreate, onCreateFolder }: {
  vaultId: string; items: NoteTreeItem[]; folderPath: string; paperPath?: string; paperTitle?: string;
  onClose(): void; onCreate(location: NoteLocation): Promise<void>;
  onCreateFolder?(parentPath: string, name: string): Promise<NoteTreeItem>;
}) {
  const [title, setTitle] = useState(''); const [paper, setPaper] = useState(paperPath || ''); const [paperName, setPaperName] = useState(paperTitle); const [folder, setFolder] = useState(paperPath && (folderPath === 'notes' || !items.some(item => item.kind === 'directory' && item.path === folderPath)) ? '' : folderPath);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [folderName, setFolderName] = useState<string | null>(null); const [extraFolders, setExtraFolders] = useState<NoteTreeItem[]>([]);
  async function createFolder() {
    const valid = validEntryName(folderName || '');
    if (!valid) { setError('请输入有效的文件夹名称。'); return; }
    if (!onCreateFolder) return;
    setBusy(true); setError('');
    try {
      let parent = folder;
      if (!parent && paper) {
        const snapshot = await callTool<{ paperFolderPath?: string }>('note_tree', { vaultId, paperPath: paper, limit: 1 });
        parent = snapshot.paperFolderPath || '';
        if (!parent) throw new Error('无法确定当前论文的默认文件夹，请先选择现有文件夹。');
      }
      parent ||= 'notes';
      const created = await onCreateFolder(parent, valid);
      setExtraFolders(previous => [...previous.filter(item => item.path !== parent && item.path !== created.path), ...(parent !== 'notes' && !items.some(item => item.path === parent) ? [{ path: parent, parentPath: parentFolder(parent), name: parent.split('/').at(-1)!, kind: 'directory' as const, ...(paper ? { paperPath: paper, paperTitle: paperName } : {}) }] : []), created]);
      setFolder(created.path); setFolderName(null);
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }
  return <NoteDialog title="新建笔记" busy={busy} onClose={onClose}><form onSubmit={event => {
    event.preventDefault(); const valid = validEntryName(title.replace(/\.md$/i, ''));
    if (!valid) { setError('请输入有效的笔记名称，不能包含路径或文件名保留字符。'); return; }
    setBusy(true); setError(''); void onCreate({ title: valid, folderPath: folder || undefined, paperPath: paper || undefined }).catch(reason => setError(messageOf(reason))).finally(() => setBusy(false));
  }}><div className="modal-content"><p className="field-help">为当前论文做笔记，或选择主题笔记整理多篇资料。</p><label htmlFor="new-note-title">笔记名称</label><input id="new-note-title" autoFocus required placeholder="例如：架构原则的理解" value={title} disabled={busy} onChange={event => setTitle(event.target.value)} /><label>所属论文</label><PaperPicker vaultId={vaultId} value={paper} title={paperName} disabled={busy} onChange={(path, name) => { setPaper(path); setPaperName(name); setFolder(''); }} /><label>目标文件夹</label><FolderPicker items={[...items, ...extraFolders]} value={folder} onChange={setFolder} disabled={busy} automaticLabel={paper ? '当前论文的默认文件夹' : '主题笔记根目录'} />{onCreateFolder && (folderName === null ? <button type="button" className="note-new-subfolder" disabled={busy} onClick={() => setFolderName('')}><FolderPlus size={14} />新建子文件夹</button> : <div className="note-new-folder-row"><input autoFocus aria-label="子文件夹名称" placeholder="文件夹名称" value={folderName} disabled={busy} onChange={event => setFolderName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void createFolder(); } }} /><button type="button" disabled={busy} onClick={() => void createFolder()}>创建</button><button type="button" disabled={busy} onClick={() => setFolderName(null)}>取消</button></div>)}<div className="note-location-summary"><span><Link size={14} />{paper ? `关联论文：${paperName || paper.split('/').at(-1)}` : '主题笔记可引用多篇论文'}</span><span><FileText size={14} />{title || '未命名笔记'}.md</span></div>{error && <p className="error-text" role="alert">{error}</p>}</div><footer className="modal-footer"><button type="button" disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy}>{busy ? '正在创建…' : '创建笔记'}</button></footer></form></NoteDialog>;
}

export type NoteAction = 'rename' | 'move' | 'trash' | 'associate' | 'folder';
export interface NoteActionValues { name: string; folderPath: string; paperPath: string | null }
export function NoteActionDialog({ action, item, items, vaultId, affectedCount, onClose, onSubmit }: {
  action: NoteAction; item: NoteTreeItem; items: NoteTreeItem[]; vaultId: string; affectedCount: number;
  onClose(): void; onSubmit(values: NoteActionValues): Promise<void>;
}) {
  const [name, setName] = useState(action === 'folder' ? '' : item.kind === 'file' ? noteTitle(item.path) : item.name); const [folder, setFolder] = useState(action === 'folder' ? item.path : parentFolder(item.path)); const [paper, setPaper] = useState(item.paperPath || ''); const [paperTitle, setPaperTitle] = useState(item.paperTitle);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const title = { rename: '重命名', move: '移动到文件夹', trash: '移入回收站', associate: '修改关联论文', folder: '新建文件夹' }[action];
  return <NoteDialog title={title} busy={busy} onClose={onClose}><form onSubmit={event => {
    event.preventDefault(); if ((action === 'rename' || action === 'folder') && !validEntryName(name)) { setError('请输入有效名称，不能包含路径或文件名保留字符。'); return; }
    setBusy(true); setError(''); void onSubmit({ name, folderPath: folder, paperPath: paper || null }).catch(reason => setError(messageOf(reason))).finally(() => setBusy(false));
  }}><div className="modal-content"><p className="note-action-source"><FileText size={16} />{item.kind === 'file' ? noteTitle(item.path) : item.paperTitle || item.name}</p>{(action === 'rename' || action === 'folder') && <><label htmlFor="note-action-name">{action === 'folder' ? '文件夹名称' : '新名称'}</label><input autoFocus required id="note-action-name" value={name} disabled={busy} onChange={event => setName(event.target.value)} /></>}{(action === 'move' || action === 'folder') && <><label>目标文件夹</label><FolderPicker items={items} value={folder} onChange={setFolder} disabled={busy} exclude={action === 'move' && item.kind === 'directory' ? item.path : undefined} /></>}{action === 'associate' && <><label>所属论文</label><PaperPicker vaultId={vaultId} value={paper} title={paperTitle} disabled={busy} onChange={(path, name) => { setPaper(path); setPaperTitle(name); }} /><p className="field-help">只改变这篇笔记的主关联；原有引用和文件位置保留。</p></>}{action === 'move' && <p className="field-help">移动后保留笔记的关联论文和原有引用。需要改变归属时，使用“修改关联论文”。</p>}{item.kind === 'directory' && action !== 'folder' && <p className="field-help">此文件夹包含 {affectedCount} 篇笔记，操作会影响其中的文件。</p>}{action === 'trash' && <p className="field-help">{item.kind === 'file' ? '此笔记' : '此文件夹及其中的笔记'}将移入知识库回收站，不会删除关联论文或 PDF。</p>}{error && <p className="error-text" role="alert">{error}</p>}</div><footer className="modal-footer"><button type="button" disabled={busy} onClick={onClose}>取消</button><button className={action === 'trash' ? 'danger' : 'primary'} disabled={busy}>{busy ? '正在处理…' : title}</button></footer></form></NoteDialog>;
}
