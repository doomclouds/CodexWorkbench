import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { FileText, FolderOpen, LoaderCircle, Trash2, X } from 'lucide-react';
import type { LibraryOperation, Paper } from '../../contracts/types';
import type { FilePickerResult } from '../../contracts/picker';
import { callTool } from '../api';
import { messageOf } from '../model';

export const tagColors: Record<string, string> = { red: '#df5863', orange: '#d98837', yellow: '#b99c29', green: '#3caa66', teal: '#2aaba7', blue: '#598ff1', indigo: '#9682f5', purple: '#b975e2' };
export function tagStyle(paper: Paper, name: string): CSSProperties | undefined {
  const id = paper.tagDetails?.find(item => item.name === name)?.color;
  const color = id ? tagColors[id] : undefined;
  return color ? { background: `color-mix(in srgb, ${color} 17%, var(--app-bg))`, color: `color-mix(in srgb, ${color} 80%, var(--text))` } : undefined;
}
function useModal() { const ref = useRef<HTMLDialogElement>(null); useEffect(() => { ref.current?.showModal(); return () => { ref.current?.close(); }; }, []); return ref; }

export function TagEditor({ vaultId, paper, onClose, onChanged }: { vaultId: string; paper: Paper; onClose(): void; onChanged(): void }) {
  const dialog = useModal(); const [current, setCurrent] = useState(paper); const [text, setText] = useState(''); const [color, setColor] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function change(op: 'add' | 'rm', tag: string) {
    if (busy || !tag.trim()) return; setBusy(true); setError('');
    try {
      await callTool('paper_tag', { vaultId, paperPath: current.path, op, tag });
      setCurrent(await callTool<Paper>('paper_get', { vaultId, paperPath: current.path }));
      if (op === 'add') setText(''); onChanged();
    } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="compact-modal tag-editor" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <header className="modal-heading"><div><h2>编辑标签</h2><p>{paper.title}</p></div><button className="icon-button" aria-label="关闭标签编辑" disabled={busy} onClick={onClose}><X size={17} /></button></header>
    <div className="modal-content"><div className="tag-editor-list">{current.tags.map(tag => <div key={tag}><span className="tag" style={tagStyle(current, tag)}>{tag}</span><button className="icon-button" aria-label={`删除标签 ${tag}`} disabled={busy} onClick={() => void change('rm', tag)}><X size={14} /></button></div>)}{current.tags.length === 0 && <p className="field-help">尚无标签</p>}</div>
      <form className="tag-editor-form" onSubmit={e => { e.preventDefault(); void change('add', `${text.trim()}${color ? `:${color}` : ''}`); }}><label htmlFor="new-paper-tag">新增标签</label><input autoFocus id="new-paper-tag" value={text} maxLength={900} disabled={busy} onChange={e => setText(e.target.value)} /><label htmlFor="new-tag-color">颜色</label><select id="new-tag-color" value={color} disabled={busy} onChange={e => setColor(e.target.value)}><option value="">默认</option>{Object.keys(tagColors).map(id => <option value={id} key={id}>{({ red: '红色', orange: '橙色', yellow: '黄色', green: '绿色', teal: '青色', blue: '蓝色', indigo: '靛色', purple: '紫色' } as Record<string, string>)[id]}</option>)}</select><button className="primary" disabled={busy || !text.trim()}>{busy && <LoaderCircle size={14} className="spin" />}添加标签</button></form>
      {error && <p className="callout error" role="alert">{error}</p>}
    </div><footer className="modal-footer"><button disabled={busy} onClick={onClose}>完成</button></footer>
  </dialog>;
}

export function DeletePaperDialog({ vaultId, paper, onClose, onDeleted }: { vaultId: string; paper: Paper; onClose(): void; onDeleted(): void }) {
  const dialog = useModal(); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function remove() { setBusy(true); setError(''); try { await callTool('paper_delete', { vaultId, paperPath: paper.path }); onDeleted(); onClose(); } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); } }
  return <dialog ref={dialog} className="compact-modal" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}><header className="modal-heading"><h2>移入回收站？</h2><button className="icon-button" aria-label="关闭删除确认" disabled={busy} onClick={onClose}><X size={17} /></button></header><div className="modal-content"><strong>{paper.title}</strong><p>论文文件与对应文献记录会移入当前知识库回收站，可通过 Agentero 恢复。</p>{error && <p className="callout error" role="alert">{error}</p>}</div><footer className="modal-footer"><button disabled={busy} onClick={onClose}>取消</button><button className="danger" disabled={busy} onClick={() => void remove()}><Trash2 size={15} />移入回收站</button></footer></dialog>;
}

export function ImportPdfDialog({ vaultId, onClose, onOperation }: { vaultId: string; onClose(): void; onOperation(operation: LibraryOperation): void }) {
  const dialog = useModal(); const [paths, setPaths] = useState<string[]>([]); const [manual, setManual] = useState('');
  const [noRecognize, setNoRecognize] = useState(true); const [busy, setBusy] = useState(false); const [picking, setPicking] = useState(false); const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  async function choose() {
    if (picking) return; setPicking(true); setError(''); controller.current = new AbortController();
    try {
      const result = await callTool<FilePickerResult>('file_picker', { mode: 'open-file', title: '选择要导入的 PDF', multiple: true, filters: [{ name: 'PDF 文档', extensions: ['pdf'] }], ...(paths[0] ? { defaultPath: paths[0] } : {}) }, { signal: controller.current.signal });
      if (!result.cancelled) setPaths(result.paths);
    } catch (reason) { if (!controller.current.signal.aborted) setError(messageOf(reason)); }
    finally { setPicking(false); controller.current = null; }
  }
  async function submit() {
    const selected = [...new Set([...paths, ...manual.split(/\r?\n/).map(value => value.trim().replace(/^"|"$/g, '')).filter(Boolean)])];
    if (!selected.length) return;
    if (selected.some(value => !value.toLowerCase().endsWith('.pdf'))) { setError('请选择 PDF 文件。'); return; }
    if (selected.length > 100) { setError('每次最多导入100个PDF。'); return; }
    setBusy(true); setError('');
    try { const operation = await callTool<LibraryOperation>('paper_import', { vaultId, filePaths: selected, noRecognize }); onOperation(operation); onClose(); }
    catch (reason) { setError(messageOf(reason)); setBusy(false); }
  }
  return <dialog ref={dialog} className="compact-modal pdf-import-dialog" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <header className="modal-heading"><div><h2>导入本地 PDF</h2><p>可一次选择多个文件</p></div><button className="icon-button" aria-label="关闭导入" disabled={busy} onClick={onClose}><X size={17} /></button></header>
    <div className="modal-content"><button className="primary picker-primary" disabled={busy || picking} onClick={() => void choose()}>{picking ? <LoaderCircle className="spin" size={17} /> : <FolderOpen size={17} />}{picking ? '等待系统选择器…' : paths.length ? '重新选择 PDF 文件…' : '选择 PDF 文件…'}</button>
      {paths.length > 0 && <ul className="import-file-list" aria-label="待导入的PDF">{paths.map(path => <li key={path}><FileText size={15} /><span title={path}>{path.split(/[\\/]/).at(-1)}</span><button className="icon-button" aria-label={`移除 ${path.split(/[\\/]/).at(-1)}`} disabled={busy || picking} onClick={() => setPaths(values => values.filter(item => item !== path))}><X size={13} /></button></li>)}</ul>}
      <details><summary>手动填写路径（备用）</summary><label htmlFor="manual-pdf-paths">每行一个 PDF 完整路径</label><textarea id="manual-pdf-paths" value={manual} rows={3} disabled={busy || picking} onChange={e => setManual(e.target.value)} spellCheck={false} /></details>
      <label className="checkbox-row"><input type="checkbox" checked={noRecognize} disabled={busy || picking} onChange={e => setNoRecognize(e.target.checked)} />跳过元数据识别，直接按文件名导入</label><p className="field-help">关闭此选项时，Agentero 可能联网识别标题、作者等信息。PDF 导入与后台正文解析分别报告。</p>
      {error && <p className="callout error" role="alert">{error}</p>}
    </div><footer className="modal-footer"><button disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy || picking || (!paths.length && !manual.trim())} onClick={() => void submit()}>{busy && <LoaderCircle size={14} className="spin" />}导入{paths.length > 1 ? ` ${paths.length} 个PDF` : ''}</button></footer>
  </dialog>;
}
