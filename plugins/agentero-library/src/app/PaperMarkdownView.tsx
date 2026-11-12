import { useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, FileText, History } from 'lucide-react';
import type { PaperMarkdownHistory, PaperMarkdownHistoryEntry, PaperMarkdownWriteResult } from '../contracts/documents';
import { callTool } from './api';
import { registerBeforeTeardown } from './bridge';
import { codeOf, messageOf } from './model';
import { MarkdownEditor } from './notes/MarkdownEditor';
import './paper-markdown.css';

export interface PaperMarkdownViewProps {
  active: boolean; vaultId: string; paperPath: string; preview: boolean;
  onDirtyChange(dirty: boolean): void; onBack(): void; onOpenPdf?(): void;
}
interface Document { path: string; content: string; revision: string | null; exists: boolean }
interface Draft { key: string; document: Document | null; content: string }
type HistoryDetail = NonNullable<PaperMarkdownHistory['entry']>;
const demo = '# 论文正文\n\n在这里查看与修订论文 Markdown。实际论文和修改记录来自已连接的知识库。\n';
const statusLabel = (status: PaperMarkdownHistoryEntry['status']) => status === 'saved' ? '已保存' : status === 'unconfirmed' ? '保存结果待核实' : '已备份／尚未确认写入';

export function PaperMarkdownComparison({ before, proposed, offset = 0, nextOffset, onNext }: { before: string; proposed: string; offset?: number; nextOffset?: number | null; onNext?(): void }) {
  let prefix = 0, suffix = 0;
  while (prefix < before.length && prefix < proposed.length && before[prefix] === proposed[prefix]) prefix++;
  while (suffix < before.length - prefix && suffix < proposed.length - prefix && before[before.length - 1 - suffix] === proposed[proposed.length - 1 - suffix]) suffix++;
  const oldEnd = before.length - suffix, newEnd = proposed.length - suffix;
  return <div className="paper-comparison" aria-label="论文 Markdown 修订差异">
    <div className="paper-comparison-columns"><section className="paper-before"><h3>修改前</h3><pre>{before ? <>{before.slice(0, prefix)}<del>{before.slice(prefix, oldEnd)}</del>{before.slice(oldEnd)}</> : '（此窗口没有内容）'}</pre></section><section className="paper-proposed"><h3>修订后</h3><pre>{proposed ? <>{proposed.slice(0, prefix)}<ins>{proposed.slice(prefix, newEnd)}</ins>{proposed.slice(newEnd)}</> : '（此窗口没有内容）'}</pre></section></div>
    {(offset > 0 || nextOffset !== null && nextOffset !== undefined) && <div className="paper-diff-window"><span>当前窗口从第 {offset + 1} 个字符开始</span>{nextOffset !== null && nextOffset !== undefined && onNext && <button onClick={onNext}>下一段差异</button>}</div>}
  </div>;
}

export function PaperMarkdownView({ active, vaultId, paperPath, preview, onDirtyChange, onBack, onOpenPdf }: PaperMarkdownViewProps) {
  const key = `${vaultId}:${paperPath}`, visible = useRef(key); visible.current = key;
  const cache = useRef(new Map<string, Draft>()), request = useRef(0), writing = useRef(false);
  const verificationRequired = useRef(false);
  const [draft, setDraft] = useState<Draft>({ key, document: null, content: '' });
  const draftRef = useRef(draft); draftRef.current = draft;
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false), [history, setHistory] = useState<PaperMarkdownHistoryEntry[]>([]), [detail, setDetail] = useState<HistoryDetail | null>(null);
  const [external, setExternal] = useState<Document | null>(null), [lastWrite, setLastWrite] = useState<PaperMarkdownWriteResult | null>(null);
  const [allowImageChanges, setAllowImageChanges] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const dirty = unconfirmed || draft.key === key && draft.document !== null && draft.content !== draft.document.content;
  const updateDraft = (value: Draft) => { cache.current.set(value.key, value); if (visible.current === value.key) { draftRef.current = value; setDraft(value); } };

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!active) return;
    const generation = ++request.current, controller = new AbortController();
    setError(''); setNotice(''); setExternal(null); setLastWrite(null); setHistoryOpen(false); setHistory([]); setDetail(null); setAllowImageChanges(false);
    const cached = cache.current.get(key);
    if (cached?.document) { updateDraft(cached); setLoading(false); return; }
    if (preview) { updateDraft({ key, document: { path: `${paperPath}/PAPER.md`, revision: 'preview', exists: true, content: demo }, content: demo }); setLoading(false); return; }
    updateDraft({ key, document: null, content: '' }); setLoading(true);
    void callTool<Document>('paper_markdown', { vaultId, paperPath }, { signal: controller.signal }).then(document => {
      if (generation !== request.current || controller.signal.aborted) return;
      updateDraft({ key, document, content: document.content });
    }).catch(reason => { if (!controller.signal.aborted && generation === request.current) setError(messageOf(reason)); }).finally(() => { if (!controller.signal.aborted && generation === request.current) setLoading(false); });
    return () => { controller.abort(); request.current++; };
  }, [active, key, preview]);
  useEffect(() => {
    const hasUnsaved = () => writing.current || verificationRequired.current || [draftRef.current, ...cache.current.values()].some(item => item.document && item.content !== item.document.content);
    const unregister = registerBeforeTeardown(async () => { if (hasUnsaved()) throw new Error('论文 Markdown 草稿或保存结果尚未确认；请明确保存、核实或复制草稿后关闭。'); });
    const beforeUnload = (event: BeforeUnloadEvent) => { if (hasUnsaved()) event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { unregister(); window.removeEventListener('beforeunload', beforeUnload); };
  }, []);

  async function loadHistory(historyId?: string, offset = 0) {
    if (preview || !active) return;
    const scope = key;
    try {
      const result = await callTool<PaperMarkdownHistory>('paper_markdown_history_view', { vaultId, paperPath, ...(historyId ? { historyId, offset, maxChars: 20_000 } : {}) });
      if (visible.current !== scope) return;
      setHistory(result.items); if (result.entry) setDetail(result.entry);
    } catch (reason) { if (visible.current === scope) setError(messageOf(reason)); }
  }

  async function verifyCurrent() {
    if (preview || saving || !active) return;
    const scope = key; setError('');
    try {
      const document = await callTool<Document>('paper_markdown', { vaultId, paperPath });
      if (visible.current !== scope) return;
      const current = draftRef.current;
      verificationRequired.current = false; setUnconfirmed(false);
      if (document.content === current.content) { updateDraft({ ...current, document }); setExternal(null); setNotice('回读确认库中内容与当前草稿一致。'); }
      else { setExternal(document); setHistoryOpen(false); setNotice('库中内容与草稿不同；草稿已保留，请比较后选择保存基线。'); }
    } catch (reason) { if (visible.current === scope) setError(messageOf(reason)); }
  }

  async function save() {
    const current = draftRef.current;
    if (!active || preview || writing.current || verificationRequired.current || current.key !== key || !current.document?.exists || !current.document.revision || !dirty || external) return;
    writing.current = true; setSaving(true); setError(''); setNotice('');
    const scope = key, proposed = current.content;
    try {
      const saved = await callTool<PaperMarkdownWriteResult>('paper_markdown_save', { vaultId, paperPath, revision: current.document.revision, content: proposed, ...(allowImageChanges ? { allowImageReferenceChanges: true } : {}) });
      const document = await callTool<Document>('paper_markdown', { vaultId, paperPath });
      if (!saved.saved || document.revision !== saved.revision || document.content !== proposed) throw new Error('保存后的回读与提议稿不一致；草稿已保留，请核实当前版本。');
      const pending = cache.current.get(scope) ?? current;
      updateDraft({ ...pending, document, content: pending.content === proposed ? document.content : pending.content });
      if (visible.current !== scope) return;
      setLastWrite(saved); setDetail(null); setNotice('已保存并回读确认。'); setHistoryOpen(true); setAllowImageChanges(false);
      await loadHistory();
    } catch (reason) {
      const code = codeOf(reason);
      if (!code || code === 'MARKDOWN_WRITE_UNCONFIRMED') { verificationRequired.current = true; setUnconfirmed(true); }
      if (visible.current === scope) setError(`${messageOf(reason)} 草稿已保留；请先“核实当前版本”，不要重复保存。`);
    }
    finally { writing.current = false; setSaving(false); }
  }

  const current = draft.key === key ? draft : { key, document: null, content: '' }, document = current.document;
  return <section className={`paper-markdown-page${historyOpen ? ' paper-history-mode' : ''}`} aria-label="论文 Markdown 正文" hidden={!active}>
    <header className="paper-markdown-header"><div><h2><FileText size={20} />论文正文 · PAPER.md</h2><p>{paperPath}</p></div>{onOpenPdf && <button onClick={onOpenPdf}><ExternalLink size={15} />查看 PDF</button>}</header>
    <nav className="paper-document-tabs" aria-label="论文文档"><button onClick={onBack}>阅读笔记</button><button aria-current="page">论文正文</button></nav>
    <div className="paper-markdown-status"><span><Check size={15} />原始 PDF 保持不变</span><span>{saving ? '正在保存…' : dirty ? '有未保存的修改' : notice || '编辑派生论文 Markdown'}</span><button disabled={preview || loading || saving} aria-expanded={historyOpen} onClick={() => { const open = !historyOpen; setHistoryOpen(open); if (open) void loadHistory(); }}><History size={15} />查看修改记录</button></div>
    {preview && <p className="callout">演示内容；保存与修改记录需要连接真实知识库。</p>}
    {error && <p className="callout error" role="alert">{error}</p>}
    {notice && <p className="inline-notice" role="status">{notice}</p>}
    {loading ? <p role="status">正在读取论文 Markdown…</p> : document && !document.exists ? <p className="callout">此论文尚无 PAPER.md。请先按明确处理任务生成正文；这里不会自动解析或创建。</p> : document && !historyOpen && <>
      <div className="paper-editor-actions"><span>元数据与已有图片引用在保存时受保护；暂不支持向论文正文导入图片。</span><label><input type="checkbox" checked={allowImageChanges} disabled={saving || preview} onChange={event => setAllowImageChanges(event.target.checked)} />本次允许修改已有图片引用</label><button disabled={preview || saving} onClick={() => void verifyCurrent()}>核实当前版本</button></div>
      {external && <div className="paper-external-review"><PaperMarkdownComparison before={external.content} proposed={current.content} /><button onClick={() => { updateDraft({ ...draftRef.current, document: external }); setExternal(null); setNotice('已保留草稿并采用库中版本为基线；请核对后明确保存。'); }}>保留草稿并采用库中版本基线</button></div>}
      {active && <MarkdownEditor value={current.content} onChange={content => updateDraft({ ...draftRef.current, content })} environment={{ vaultId, notePath: document.path, preview, onLink() {} }} onSave={() => void save()} saveDisabled={!dirty || saving || preview || unconfirmed || external !== null} imageInsertionDisabled />}
    </>}
    {historyOpen && <section className="paper-history" aria-label="论文 Markdown 修改记录">
      <div className="paper-history-heading"><h3>修改记录与恢复快照</h3><button onClick={() => setHistoryOpen(false)}>返回编辑</button></div>
      {detail && <PaperMarkdownComparison before={detail.before} proposed={detail.proposed} offset={detail.offset} nextOffset={detail.nextOffset} onNext={() => void loadHistory(detail.historyId, detail.nextOffset!)} />}
      {!detail && lastWrite && <>{lastWrite.changesTruncated && <p className="inline-notice">当前显示有界修订上下文；选择记录可分段查看完整原文与提议稿。</p>}<PaperMarkdownComparison before={lastWrite.changes.filter(change => change.kind !== 'added').map(change => change.text).join('')} proposed={lastWrite.changes.filter(change => change.kind !== 'removed').map(change => change.text).join('')} /></>}
      <div className="paper-history-records" aria-label="修改记录"><div className="paper-history-list">{history.length ? history.map(entry => <button key={entry.historyId} className={detail?.historyId === entry.historyId ? 'selected' : ''} onClick={() => void loadHistory(entry.historyId)}><span>{new Date(entry.createdAt).toLocaleString()}</span><span>{statusLabel(entry.status)}</span></button>) : <p>尚无可用修改记录。</p>}</div></div>
      <details className="paper-history-policy"><summary>关于恢复快照</summary><p>每次修订分别保留原文与提议稿，不提供自动恢复。插件最多保留100条恢复记录；满额时停止新保存，不自动删除旧证据。</p></details>
    </section>}
  </section>;
}
