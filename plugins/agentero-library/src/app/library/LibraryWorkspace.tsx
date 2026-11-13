import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, ChevronLeft, ChevronRight, Circle, Download, FileInput, FileText, LoaderCircle, MoreHorizontal, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import type { LibraryOperation, Paper, PaperPage } from '../../contracts/types';
import type { FilePickerResult } from '../../contracts/picker';
import { callTool } from '../api';
import { codeOf, messageOf } from '../model';
import { previewPapers } from '../preview';
import { AnchoredMenu, type MenuAnchor } from '../ui/AnchoredMenu';
import { DeletePaperDialog, ImportPdfDialog, TagEditor, tagStyle } from './LibraryDialogs';
import './library.css';

interface Props {
  active: boolean; vaultId: string; vaultName: string; preview: boolean; refreshToken: number; pdfParseAvailable: boolean;
  onOpen(paper: Paper): void; onOpenNote(path: string): void; onOperation(operation: LibraryOperation): void;
}
type SortKey = 'title' | 'authors' | 'year' | 'tags';
interface SearchHit { path: string; title?: string; snippet: string; line?: number; paperPath?: string; page?: number }
interface SearchResults { hits: SearchHit[]; truncated: boolean; diagnostics?: { bodyExcluded?: boolean; scanMayBeIncomplete?: boolean; scopePostFiltered?: boolean } }
function valueOf(paper: Paper, key: SortKey) { return key === 'authors' || key === 'tags' ? paper[key].join(' ') : String(paper[key] ?? ''); }

export function LibraryView({ active, vaultId, vaultName, preview, refreshToken, onOpen, onOpenNote, onOperation }: Props) {
  const [page, setPage] = useState<PaperPage | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [queryDraft, setQueryDraft] = useState(''); const [query, setQuery] = useState(''); const [tag, setTag] = useState(''); const [unread, setUnread] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('title'); const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [cursor, setCursor] = useState<string | undefined>(); const [history, setHistory] = useState<(string | undefined)[]>([]); const [revision, setRevision] = useState(0);
  const forceRefresh = useRef(false); const [busyRow, setBusyRow] = useState(''); const [importOpen, setImportOpen] = useState(false);
  const [editTags, setEditTags] = useState<Paper | null>(null); const [deleting, setDeleting] = useState<Paper | null>(null);
  const [searchOpen, setSearchOpen] = useState(false); const [searchResults, setSearchResults] = useState<SearchResults | null>(null); const [searchBusy, setSearchBusy] = useState(false);
  const [bibBusy, setBibBusy] = useState(false); const pickerController = useRef<AbortController | null>(null);
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; paper?: Paper } | null>(null);
  useEffect(() => () => pickerController.current?.abort(), []);
  useEffect(() => { setMenu(null); }, [active, page]);
  function toggleMenu(element: HTMLElement, paper?: Paper) { setMenu(current => current && current.paper?.path === paper?.path ? null : { anchor: { element }, paper }); }
  function menuAction(action: () => void) { setMenu(null); action(); }
  function resetPaging() { setCursor(undefined); setHistory([]); }
  function reload() { forceRefresh.current = true; resetPaging(); setRevision(value => value + 1); }
  useEffect(() => { const timer = setTimeout(() => { setQuery(queryDraft.trim()); resetPaging(); }, 250); return () => clearTimeout(timer); }, [queryDraft]);
  useEffect(() => {
    if (!active) return; let cancelled = false; setLoading(true); setError('');
    if (preview) {
      const items = previewPapers.filter(item => (!unread || !item.isRead) && (!tag || item.tags.includes(tag)) && (!query || `${item.title} ${item.authors.join(' ')} ${item.year ?? ''} ${item.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())));
      items.sort((a, b) => valueOf(a, sortBy).localeCompare(valueOf(b, sortBy), undefined, { numeric: true, sensitivity: 'base' }) * (sortDir === 'asc' ? 1 : -1));
      setPage({ vaultId, snapshotId: 'preview', items, total: items.length, nextCursor: null, complete: true }); setLoading(false); return;
    }
    const refresh = forceRefresh.current; forceRefresh.current = false;
    void callTool<PaperPage>('paper_list', { vaultId, query: query || undefined, tag: tag ? [tag] : undefined, unread, sortBy, sortDir, limit: 50, cursor, refresh })
      .then(value => { if (!cancelled) setPage(value); }).catch(reason => { if (cancelled) return; if (codeOf(reason) === 'CURSOR_EXPIRED' && cursor) { resetPaging(); setRevision(value => value + 1); } else setError(messageOf(reason)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [active, vaultId, preview, query, tag, unread, sortBy, sortDir, cursor, revision, refreshToken]);

  async function toggleRead(paper: Paper) { if (preview || busyRow) return; setBusyRow(paper.path); setError(''); try { await callTool('paper_update', { vaultId, paperPath: paper.path, isRead: !paper.isRead }); reload(); } catch (reason) { setError(messageOf(reason)); } finally { setBusyRow(''); } }
  async function download(paper: Paper) { setBusyRow(paper.path); setError(''); try { onOperation(await callTool<LibraryOperation>('paper_download', { vaultId, paperPath: paper.path })); } catch (reason) { setError(messageOf(reason)); } finally { setBusyRow(''); } }
  async function fullSearch() { if (!queryDraft.trim() || searchBusy || preview) return; setSearchBusy(true); setError(''); try { setSearchResults(await callTool<SearchResults>('library_search', { vaultId, query: queryDraft.trim(), scope: 'all', limit: 60 })); } catch (reason) { setError(messageOf(reason)); } finally { setSearchBusy(false); } }
  async function bibliography(mode: 'import' | 'export') {
    if (bibBusy || preview) return; setBibBusy(true); setError(''); setNotice(''); pickerController.current = new AbortController();
    try {
      const result = await callTool<FilePickerResult>('file_picker', { mode: mode === 'import' ? 'open-file' : 'save-file', title: mode === 'import' ? '选择 BibTeX 文件' : '保存文献库 BibTeX', ...(mode === 'export' ? { defaultPath: 'library.bib' } : {}), filters: [{ name: 'BibTeX', extensions: ['bib', 'bibtex'] }] }, { signal: pickerController.current.signal });
      if (result.cancelled || !result.paths[0]) return;
      if (mode === 'import') onOperation(await callTool<LibraryOperation>('bibliography_import', { vaultId, filePath: result.paths[0] }));
      else { await callTool('bibliography_export', { vaultId, filePath: result.paths[0] }); setNotice(`BibTeX 已保存：${result.paths[0]}`); }
    } catch (reason) { if (!pickerController.current.signal.aborted) setError(messageOf(reason)); } finally { setBibBusy(false); pickerController.current = null; }
  }
  function changeSort(value: SortKey) { setSortDir(value === sortBy ? sortDir === 'asc' ? 'desc' : 'asc' : value === 'year' ? 'desc' : 'asc'); setSortBy(value); resetPaging(); }
  const columns: { key: SortKey; label: string }[] = [{ key: 'title', label: '标题' }, { key: 'authors', label: '作者' }, { key: 'year', label: '年份' }, { key: 'tags', label: '标签' }];
  return <section className="library-view view-fill" aria-label="文献列表">
    <div className="view-heading"><div><h2>我的文献 <span className="count">{page?.total ?? '—'} 篇</span></h2><p>{vaultName || '本地 PDF 文献库'}</p></div><div className="button-row"><button className="icon-button" aria-label="刷新列表" disabled={loading || preview} onClick={reload}><RefreshCw size={16} className={loading ? 'spin' : ''} /></button><button className="icon-button library-menu-trigger" aria-label="文献库更多操作" aria-haspopup="menu" aria-expanded={Boolean(menu && !menu.paper)} onClick={event => toggleMenu(event.currentTarget)}><MoreHorizontal size={18} /></button><button className="primary" disabled={preview} onClick={() => setImportOpen(true)}><Plus size={15} />导入 PDF</button></div></div>
    <div className="library-filters"><div className="search-field"><Search size={16} /><input value={queryDraft} onChange={e => setQueryDraft(e.target.value)} placeholder="搜索标题、作者、年份或标签" aria-label="搜索文献" />{queryDraft && <button className="icon-button" aria-label="清除搜索" onClick={() => { setQueryDraft(''); setSearchResults(null); }}><X size={14} /></button>}</div><label className="checkbox-row"><input type="checkbox" checked={unread} onChange={e => { setUnread(e.target.checked); resetPaging(); }} />仅未阅读</label><button disabled={preview} className={searchOpen ? 'active-button' : ''} onClick={() => setSearchOpen(value => !value)}>库内检索</button></div>
    {tag && <div className="filter-chip">标签：{tag}<button className="icon-button" aria-label="清除标签筛选" onClick={() => { setTag(''); resetPaging(); }}><X size={13} /></button></div>}
    {searchOpen && <div className="search-results-panel"><div className="button-row"><span className="field-help">仅检索本机笔记与已允许访问的正文。</span><button disabled={!queryDraft.trim() || searchBusy} onClick={() => void fullSearch()}>{searchBusy && <LoaderCircle size={14} className="spin" />}执行检索</button></div>{searchResults && <><p className="field-help">{searchResults.hits.length} 条命中{searchResults.truncated ? '；结果已截断，请收窄条件' : ''}{searchResults.diagnostics?.bodyExcluded ? '；正文访问未开启' : ''}{searchResults.diagnostics?.scanMayBeIncomplete ? '；受上游扫描范围限制' : ''}</p>{searchResults.hits.map(hit => <button className="search-hit" key={hit.path} onClick={() => hit.paperPath && !hit.path.endsWith('/NOTES.md') ? onOpen({ id: hit.paperPath, path: hit.paperPath, title: hit.title || hit.paperPath, authors: [], tags: [], isRead: false }) : onOpenNote(hit.path)}><strong>{hit.title || hit.path}</strong><span>{hit.snippet}</span><small>{hit.path}{hit.page ? ` · PDF 第 ${hit.page} 页` : hit.line ? ` · 第 ${hit.line} 行` : ''}</small></button>)}</>}</div>}
    {error && <div className="callout error" role="alert">{error}<button onClick={reload}>重新加载</button></div>}{notice && <p className="inline-notice" role="status">{notice}</p>}
    <div className="table-scroll" aria-busy={loading}><table className="paper-table"><thead><tr>{columns.map(column => <th key={column.key} aria-sort={sortBy === column.key ? sortDir === 'asc' ? 'ascending' : 'descending' : 'none'}><button onClick={() => changeSort(column.key)}>{column.label}{sortBy === column.key && (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</button></th>)}<th className="read-column">阅读状态</th></tr></thead><tbody>{page?.items.map(paper => <tr className="interactive-paper-row" key={paper.path} tabIndex={0} onClick={e => { if (!(e.target as Element).closest('button,input,a')) onOpen(paper); }} onKeyDown={e => { if (e.target === e.currentTarget && ['Enter', ' '].includes(e.key)) { e.preventDefault(); onOpen(paper); } }}>
      <td><button className="paper-title" onClick={() => onOpen(paper)} title={paper.title}><FileText size={16} /><span>{paper.title}</span></button><div className="paper-compact-metadata"><span>{[paper.authors.join(', '), paper.year ?? paper.date?.slice(0, 4)].filter(Boolean).join(' · ') || '暂无作者或年份'}</span>{paper.tags.length > 0 && <span>{paper.tags.join(' · ')}</span>}</div></td><td className="authors" title={paper.authors.join(', ')}>{paper.authors.join(', ') || '—'}</td><td>{paper.year ?? paper.date?.slice(0, 4) ?? '—'}</td>
      <td><div className="tags"><button className="library-tag-trigger" aria-label={`编辑标签：${paper.title}`} disabled={preview || Boolean(busyRow)} onClick={() => setEditTags(paper)}>{paper.tags.length ? <><span className="tag" style={tagStyle(paper, paper.tags[0])}>{paper.tags[0]}</span>{paper.tags.length > 1 && <span className="muted">+{paper.tags.length - 1}</span>}</> : <span className="muted">＋ 标签</span>}</button>{paper.tags.length > 0 && <button className="icon-button tag-filter-button" title="按此标签筛选" aria-label={`筛选标签 ${paper.tags[0]}`} onClick={() => { setTag(paper.tags[0]); resetPaging(); }}><Search size={12} /></button>}</div></td>
      <td><div className="row-actions"><button className="read-state-button" aria-label={`${paper.title}：${paper.isRead ? '已读，标为未读' : '未读，标为已读'}`} title={paper.isRead ? '已读；点击标为未读' : '未读；点击标为已读'} disabled={preview || Boolean(busyRow)} onClick={() => void toggleRead(paper)}>{busyRow === paper.path ? <LoaderCircle className="spin" size={16} /> : paper.isRead ? <CheckCircle2 className="success-text" size={16} /> : <Circle size={16} />}<span>{paper.isRead ? '已读' : '未读'}</span></button><button className="icon-button library-menu-trigger" aria-label={`更多操作：${paper.title}`} aria-haspopup="menu" aria-expanded={menu?.paper?.path === paper.path} onClick={event => toggleMenu(event.currentTarget, paper)}><MoreHorizontal size={16} /></button></div></td>
    </tr>)}</tbody></table>{loading && !page && <div className="empty-state"><LoaderCircle className="spin" />正在读取文献库…</div>}{!loading && page?.items.length === 0 && <div className="empty-state"><FileText size={28} /><strong>{query || unread || tag ? '没有匹配的文献' : '知识库还没有 PDF'}</strong><span>{query || unread || tag ? '调整搜索或筛选条件。' : '点击“导入 PDF”选择本机文件。'}</span></div>}</div>
    <footer className="list-footer"><span>{loading ? '正在更新…' : preview ? '演示数据' : `${page?.total ?? 0} 篇匹配文献 · 本地知识库`}</span><div className="button-row"><button className="icon-button" aria-label="上一页" disabled={loading || !history.length} onClick={() => { setCursor(history.at(-1)); setHistory(values => values.slice(0, -1)); }}><ChevronLeft size={17} /></button><span>第 {history.length + 1} 页</span><button className="icon-button" aria-label="下一页" disabled={loading || !page?.nextCursor} onClick={() => { setHistory(values => [...values, cursor]); setCursor(page!.nextCursor!); }}><ChevronRight size={17} /></button></div></footer>
    {menu && <AnchoredMenu anchor={menu.anchor} onClose={() => setMenu(null)} ariaLabel={menu.paper ? `${menu.paper.title}的操作` : '文献库操作'}>{menu.paper ? <>
      <button role="menuitem" onClick={() => menuAction(() => onOpen(menu.paper!))}><FileText size={14} />打开 PDF</button>
      <button role="menuitem" onClick={() => menuAction(() => onOpenNote(`${menu.paper!.path}/NOTES.md`))}>论文笔记</button>
      <button role="menuitem" disabled={preview || Boolean(busyRow)} onClick={() => menuAction(() => setEditTags(menu.paper!))}>编辑标签</button>
      <button role="menuitem" disabled={preview || Boolean(busyRow)} onClick={() => menuAction(() => void download(menu.paper!))}><Download size={14} />补下载资源</button>
      <button role="menuitem" className="danger" disabled={preview || Boolean(busyRow)} onClick={() => menuAction(() => setDeleting(menu.paper!))}><Trash2 size={14} />移入回收站</button>
    </> : <><button role="menuitem" disabled={bibBusy || preview} onClick={() => menuAction(() => void bibliography('import'))}><FileInput size={15} />导入 BibTeX…</button><button role="menuitem" disabled={bibBusy || preview} onClick={() => menuAction(() => void bibliography('export'))}><Download size={15} />导出 BibTeX…</button></>}</AnchoredMenu>}
    {importOpen && <ImportPdfDialog vaultId={vaultId} onClose={() => setImportOpen(false)} onOperation={onOperation} />}
    {editTags && <TagEditor vaultId={vaultId} paper={editTags} onClose={() => setEditTags(null)} onChanged={reload} />}
    {deleting && <DeletePaperDialog vaultId={vaultId} paper={deleting} onClose={() => setDeleting(null)} onDeleted={reload} />}
  </section>;
}
