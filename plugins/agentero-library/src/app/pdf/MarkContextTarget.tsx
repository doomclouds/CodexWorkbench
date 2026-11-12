import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NoteTree } from '../../contracts/notes';
import { callTool } from '../api';
import { messageOf } from '../model';
import { FolderPicker } from '../notes/NoteDialogs';

export type MarkBatchAction = 'summarize' | 'create-note' | 'update-note' | 'revise-paper';
export interface MarkBatchTarget { targetNotePath?: string; targetFolderPath?: string }

export function MarkContextTarget({ action, vaultId, paperPath, onSubmit, onClose }: { action: 'create-note' | 'update-note'; vaultId: string; paperPath: string; onSubmit(target: MarkBatchTarget): Promise<void>; onClose(): void }) {
  const [tree, setTree] = useState<NoteTree | null>(null); const [path, setPath] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  useEffect(() => { let cancelled = false; void callTool<NoteTree>('note_tree', { vaultId, paperPath, limit: 1000 }).then(value => { if (!cancelled) { setTree(value); setPath(action === 'create-note' ? value.paperFolderPath ?? 'notes' : ''); } }).catch(cause => { if (!cancelled) setError(messageOf(cause)); }); return () => { cancelled = true; }; }, [action, vaultId, paperPath]);
  const entries = tree?.items.filter(item => item.kind === (action === 'create-note' ? 'directory' : 'file')) ?? [];
  async function submit() { if (!path || busy) return; setBusy(true); setError(''); try { await onSubmit(action === 'create-note' ? { targetFolderPath: path } : { targetNotePath: path }); onClose(); } catch (cause) { setError(messageOf(cause)); } finally { setBusy(false); } }
  return createPortal(<dialog ref={dialog} className="compact-modal pdf-context-target" aria-label={action === 'create-note' ? '选择新笔记位置' : '选择要更新的笔记'} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}><form onSubmit={event => { event.preventDefault(); void submit(); }}><strong>{action === 'create-note' ? '保存为新笔记' : '更新已有笔记'}</strong><p className="field-help">来源将带入 Codex 输入框，发送后按所选目标整理并保存。</p>{action === 'create-note' ? <><label>目标文件夹</label><FolderPicker items={tree?.items ?? []} value={path} disabled={busy || !tree} onChange={setPath} />{tree?.paperFolderPath && !entries.some(item => item.path === tree.paperFolderPath) && <button type="button" className={path === tree.paperFolderPath ? 'selected' : ''} disabled={busy} onClick={() => setPath(tree.paperFolderPath!)}>当前论文的默认文件夹</button>}</> : <label>目标笔记<select aria-label="目标笔记" value={path} disabled={busy || !tree} onChange={event => setPath(event.target.value)}><option value="">请选择</option>{entries.map(item => <option key={item.path} value={item.path}>{item.path.replace(/^notes\//, '')}</option>)}</select></label>}{tree?.truncated && <p className="field-help">仅显示已加载的目标；可先在笔记工作区打开目标笔记。</p>}{tree && action === 'update-note' && !entries.length && <p className="field-help">当前论文还没有关联笔记，请先新建。</p>}{error && <p className="error-text" role="alert">{error}</p>}<div className="button-row"><button type="button" disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy || !path}>{busy ? '附加中…' : '带到对话'}</button></div></form></dialog>, document.body);
}
