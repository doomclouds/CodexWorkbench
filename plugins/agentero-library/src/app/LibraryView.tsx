import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, ChevronLeft, ChevronRight, Circle, FileText, LoaderCircle, Plus, RefreshCw, Search, X } from 'lucide-react';
import type { LibraryOperation, Paper, PaperPage } from '../contracts/types';
import { callTool } from './api';
import { codeOf, messageOf } from './model';
import { previewPapers } from './preview';

interface Props {
  active: boolean;
  vaultId: string;
  vaultName: string;
  preview: boolean;
  refreshToken: number;
  pdfParseAvailable: boolean;
  onOpen(paper: Paper): void;
  onOpenNote(path: string): void;
  onOperation(operation: LibraryOperation): void;
}
interface SearchHit { path: string; title?: string; snippet: string; line?: number; paperPath?: string; page?: number }
interface SearchResults { hits: SearchHit[]; truncated: boolean }
interface Discovery { items: { arxivId: string; title: string; authors?: string[]; year?: number }[] }

export function LibraryView({ active, vaultId, vaultName, preview, refreshToken, pdfParseAvailable, onOpen, onOpenNote, onOperation }: Props) {
  const [page, setPage] = useState<PaperPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [queryDraft, setQueryDraft] = useState('');
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [unread, setUnread] = useState(false);
  const [sortBy, setSortBy] = useState<'title' | 'year'>('title');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [cursor, setCursor] = useState<string | undefined>();
  const [history, setHistory] = useState<(string | undefined)[]>([]);
  const [revision, setRevision] = useState(0);
  const refresh = useRef(false);
  const [busyRow, setBusyRow] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [fullSearchOpen, setFullSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);

  function resetPaging() { setCursor(undefined); setHistory([]); }
  function reload() { refresh.current = true; resetPaging(); setRevision(value => value + 1); }
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(queryDraft.trim()); setCursor(undefined); setHistory([]); }, 250);
    return () => clearTimeout(timer);
  }, [queryDraft]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true); setError('');
    if (preview) {
      const items = previewPapers.filter(item => (!unread || !item.isRead)
        && (!tag || item.tags.includes(tag))
        && (!query || `${item.title} ${item.authors.join(' ')} ${item.tags.join(' ')}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
      items.sort((a, b) => (sortBy === 'year' ? (a.year ?? 0) - (b.year ?? 0) : a.title.localeCompare(b.title)) * (sortDir === 'asc' ? 1 : -1));
      setPage({ vaultId, snapshotId: 'preview', items, total: items.length, nextCursor: null, complete: true }); setLoading(false);
      return;
    }
    const forceRefresh = refresh.current; refresh.current = false;
    void callTool<PaperPage>('paper_list', { vaultId, query: query || undefined, tag: tag ? [tag] : undefined, unread, sortBy, sortDir, limit: 50, cursor, refresh: forceRefresh })
      .then(value => { if (!cancelled) setPage(value); })
      .catch(reason => {
        if (cancelled) return;
        if (codeOf(reason) === 'CURSOR_EXPIRED' && cursor) { setCursor(undefined); setHistory([]); setRevision(value => value + 1); }
        else setError(messageOf(reason));
      }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [active, vaultId, preview, query, tag, unread, sortBy, sortDir, cursor, revision, refreshToken]);

  async function toggleRead(paper: Paper) {
    if (preview || busyRow) return;
    setBusyRow(paper.path); setError('');
    try { await callTool('paper_update', { vaultId, paperPath: paper.path, isRead: !paper.isRead }); reload(); }
    catch (reason) { setError(messageOf(reason)); }
    finally { setBusyRow(''); }
  }

  async function fullSearch() {
    if (!queryDraft.trim() || searchBusy || preview) return;
    setSearchBusy(true); setError('');
    try { setSearchResults(await callTool<SearchResults>('library_search', { vaultId, query: queryDraft.trim(), scope: 'all', limit: 60 })); }
    catch (reason) { setError(messageOf(reason)); }
    finally { setSearchBusy(false); }
  }

  function changeSort(value: 'title' | 'year') {
    setSortDir(value === sortBy ? (sortDir === 'asc' ? 'desc' : 'asc') : value === 'year' ? 'desc' : 'asc');
    setSortBy(value); resetPaging();
  }

  return <section className="library-view view-fill" aria-label="文献列表">
    <div className="view-heading"><div><h2>我的文献 <span className="count">{page?.total ?? '—'} 篇</span></h2><p>{vaultName || '本地知识库'}</p></div><div className="button-row"><button className="icon-button" title="刷新列表" aria-label="刷新列表" disabled={loading || preview} onClick={reload}><RefreshCw size={16} className={loading ? 'spin' : ''} /></button><button onClick={() => setDiscoveryOpen(true)} disabled={preview}>发现文献</button><button className="primary" onClick={() => setImportOpen(true)} disabled={preview}><Plus size={15} />导入</button></div></div>
    <div className="library-filters"><div className="search-field"><Search size={16} /><input value={queryDraft} onChange={e => setQueryDraft(e.target.value)} placeholder="搜索标题、作者或标签" aria-label="搜索文献" />{queryDraft && <button className="icon-button" onClick={() => { setQueryDraft(''); setSearchResults(null); }} aria-label="清除搜索"><X size={14} /></button>}</div><label className="checkbox-row"><input type="checkbox" checked={unread} onChange={e => { setUnread(e.target.checked); resetPaging(); }} />仅未阅读</label><button className={fullSearchOpen ? 'active-button' : ''} onClick={() => setFullSearchOpen(value => !value)} disabled={preview} title="搜索笔记和允许读取的正文">库内全文检索</button></div>
    {tag && <div className="filter-chip">标签：{tag}<button className="icon-button" aria-label="清除标签筛选" onClick={() => { setTag(''); resetPaging(); }}><X size={13} /></button></div>}
    {fullSearchOpen && <div className="search-results-panel"><div className="button-row"><span className="field-help">按当前正文访问设置检索笔记和论文内容。</span><button disabled={!queryDraft.trim() || searchBusy} onClick={() => void fullSearch()}>{searchBusy && <LoaderCircle className="spin" size={14} />}执行检索</button></div>{searchResults && <><p className="field-help">{searchResults.hits.length} 条命中{searchResults.truncated ? '，结果已截断，请收窄关键词' : ''}</p>{searchResults.hits.map(hit => <button className="search-hit" key={hit.path} onClick={() => {
      if (hit.paperPath && !hit.path.endsWith('/NOTES.md')) onOpen({ id: hit.paperPath, path: hit.paperPath, title: hit.title || hit.paperPath, authors: [], tags: [], isRead: false });
      else onOpenNote(hit.path);
    }}><strong>{hit.title || hit.path}</strong><span>{hit.snippet}</span><small>{hit.path}{hit.page ? ` · PDF 第 ${hit.page} 页` : hit.line ? ` · 第 ${hit.line} 行` : ''}</small></button>)}</>}</div>}
    {error && <div className="callout error" role="alert">{error}<button onClick={reload}>重新加载</button></div>}
    <div className="table-scroll" aria-busy={loading}>
      <table className="paper-table"><thead><tr><th><button onClick={() => changeSort('title')}>标题 {sortBy === 'title' && (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</button></th><th>作者</th><th className="year-column"><button onClick={() => changeSort('year')}>年份 {sortBy === 'year' && (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</button></th><th>标签</th><th className="read-column"><span className="sr-only">阅读状态</span></th></tr></thead><tbody>{page?.items.map(paper => <tr key={paper.path}>
        <td><button className="paper-title" onClick={() => onOpen(paper)} title={paper.title}><FileText size={16} /><span>{paper.title}</span></button></td>
        <td className="authors" title={paper.authors.join(', ')}>{paper.authors.join(', ') || '—'}</td><td>{paper.year ?? paper.date?.slice(0, 4) ?? '—'}</td>
        <td><div className="tags">{paper.tags.slice(0, 3).map(value => <button className="tag" key={value} onClick={() => { setTag(value); resetPaging(); }}>{value}</button>)}{paper.tags.length > 3 && <span className="muted">+{paper.tags.length - 3}</span>}</div></td>
        <td><button className="icon-button" disabled={preview || Boolean(busyRow)} onClick={() => void toggleRead(paper)} title={paper.isRead ? '标为未读' : '标为已读'} aria-label={`${paper.title}：${paper.isRead ? '标为未读' : '标为已读'}`}>{busyRow === paper.path ? <LoaderCircle size={17} className="spin" /> : paper.isRead ? <CheckCircle2 size={17} className="success-text" /> : <Circle size={17} />}</button></td>
      </tr>)}</tbody></table>
      {loading && !page && <div className="empty-state"><LoaderCircle className="spin" />正在读取文献库…</div>}
      {!loading && page?.items.length === 0 && <div className="empty-state"><FileText size={28} /><strong>{query || unread || tag ? '没有匹配的文献' : '知识库还没有文献'}</strong><span>{query || unread || tag ? '试试调整关键词或筛选条件。' : '导入论文标识符或本机 PDF 开始阅读。'}</span></div>}
    </div>
    <footer className="list-footer"><span>{loading ? '正在更新…' : preview ? '演示数据 · 不连接真实文献库' : `${page?.total ?? 0} 篇匹配文献 · 本地知识库`}</span><div className="button-row"><button className="icon-button" aria-label="上一页" disabled={loading || history.length === 0} onClick={() => { const previous = history.at(-1); setHistory(value => value.slice(0, -1)); setCursor(previous); }}><ChevronLeft size={17} /></button><span>第 {history.length + 1} 页</span><button className="icon-button" aria-label="下一页" disabled={loading || !page?.nextCursor} onClick={() => { setHistory(value => [...value, cursor]); setCursor(page!.nextCursor!); }}><ChevronRight size={17} /></button></div></footer>
    {importOpen && <ImportDialog vaultId={vaultId} pdfParseAvailable={pdfParseAvailable} onClose={() => setImportOpen(false)} onOperation={operation => { onOperation(operation); setImportOpen(false); }} />}
    {discoveryOpen && <DiscoverDialog vaultId={vaultId} onClose={() => setDiscoveryOpen(false)} onOperation={onOperation} />}
  </section>;
}

function ImportDialog({ vaultId, pdfParseAvailable, onClose, onOperation }: { vaultId: string; pdfParseAvailable: boolean; onClose(): void; onOperation(op: LibraryOperation): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<'identifier' | 'pdf'>('identifier');
  const [value, setValue] = useState(''); const [noRecognize, setNoRecognize] = useState(!pdfParseAvailable);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); return () => { dialog.current?.close(); }; }, []);
  async function submit() {
    if (!value.trim() || busy) return;
    setBusy(true); setError('');
    try { onOperation(await callTool<LibraryOperation>('paper_import', { vaultId, ...(kind === 'pdf' ? { filePath: value.trim(), noRecognize } : { text: value.trim() }) })); }
    catch (reason) { setError(messageOf(reason)); setBusy(false); }
  }
  return <dialog ref={dialog} className="compact-modal" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}><header className="modal-heading"><h2>导入文献</h2><button className="icon-button" aria-label="关闭导入" disabled={busy} onClick={onClose}><X size={17} /></button></header><div className="modal-content"><div className="segmented"><button className={kind === 'identifier' ? 'selected' : ''} disabled={busy} onClick={() => { setKind('identifier'); setValue(''); }}>标识符或链接</button><button className={kind === 'pdf' ? 'selected' : ''} disabled={busy} onClick={() => { setKind('pdf'); setValue(''); }}>本机 PDF</button></div><label htmlFor="import-value">{kind === 'pdf' ? '当前电脑上的 PDF 完整路径' : 'arXiv、DOI 或论文链接'}</label><input autoFocus id="import-value" value={value} disabled={busy} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void submit(); }} placeholder={kind === 'pdf' ? '本机 PDF 的完整路径' : '例如 1706.03762'} />{kind === 'pdf' && <><p className="field-help">浏览器文件选择器不提供可靠的本机路径，请填写 CLI 所在电脑上的完整路径。</p><label className="checkbox-row"><input type="checkbox" checked={noRecognize} disabled={busy} onChange={e => setNoRecognize(e.target.checked)} />跳过元数据识别</label><p className="field-help">跳过时先以文件名入库，后续再完善资料；导入与正文解析是独立步骤。</p></>}{error && <p className="callout error" role="alert">{error}</p>}</div><footer className="modal-footer"><button onClick={onClose} disabled={busy}>取消</button><button className="primary" onClick={() => void submit()} disabled={!value.trim() || busy}>{busy && <LoaderCircle size={14} className="spin" />}导入</button></footer></dialog>;
}

function DiscoverDialog({ vaultId, onClose, onOperation }: { vaultId: string; onClose(): void; onOperation(op: LibraryOperation): void }) {
  const dialog = useRef<HTMLDialogElement>(null); const [query, setQuery] = useState('');
  const [results, setResults] = useState<Discovery | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState<string[]>([]);
  useEffect(() => { dialog.current?.showModal(); return () => { dialog.current?.close(); }; }, []);
  async function discover() {
    if (busy || !query.trim()) return;
    setBusy(true); setError('');
    try { setResults(await callTool<Discovery>('paper_discover', { vaultId, keywords: query.split(/[,，]/).map(value => value.trim()).filter(Boolean), top: 10 })); }
    catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }
  async function importPaper(id: string) {
    setError(''); setSubmitted(values => [...values, id]);
    try { onOperation(await callTool<LibraryOperation>('paper_import', { vaultId, text: id })); }
    catch (reason) { setError(messageOf(reason)); setSubmitted(values => values.filter(value => value !== id)); }
  }
  return <dialog ref={dialog} className="compact-modal discover-modal" onCancel={e => { e.preventDefault(); onClose(); }}><header className="modal-heading"><div><h2>发现文献</h2><p>在线查询 arXiv，结果不会自动入库</p></div><button className="icon-button" aria-label="关闭发现" onClick={onClose}><X size={17} /></button></header><div className="modal-content"><form className="search-form" onSubmit={e => { e.preventDefault(); void discover(); }}><input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="关键词，用逗号分隔" aria-label="发现关键词" /><button className="primary" disabled={busy || !query.trim()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Search size={15} />}查找</button></form>{error && <p className="callout error" role="alert">{error}</p>}<div className="discovery-list">{results?.items.map(item => <article key={item.arxivId}><div><h3>{item.title}</h3><p>arXiv:{item.arxivId}</p></div><button disabled={submitted.includes(item.arxivId)} onClick={() => void importPaper(item.arxivId)}>{submitted.includes(item.arxivId) ? '已提交导入' : '导入'}</button></article>)}{results?.items.length === 0 && <p className="empty-state">没有找到结果，请调整关键词。</p>}</div></div></dialog>;
}
