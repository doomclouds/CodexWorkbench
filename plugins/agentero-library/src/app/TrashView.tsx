import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, ExternalLink, FileText, Folder, FolderOpen, Info, LoaderCircle, RefreshCw, Search, Trash2, X } from 'lucide-react';
import type { TrashEntry, TrashList, TrashOpenResult, TrashOpenTarget } from '../contracts/trash';
import { callTool } from './api';
import { codeOf, messageOf } from './model';
import './trash-view.css';

interface Props { active: boolean; vaultId: string; preview: boolean }
type OpenTarget = TrashOpenTarget;
interface Paging { vaultId: string; cursor?: string; history: (string | undefined)[] }

function previewTrash(vaultId: string): TrashList {
  return {
    vaultId, total: 2, nextCursor: null, complete: true, truncated: false,
    restoreSupported: false, restoreReason: '当前版本仅支持查看和打开回收站内容，暂不支持恢复。',
    diagnostics: { scannedBatches: 2, skippedBatches: 0, skippedItems: 0, warnings: [] },
    items: [
      { id: 'preview-trash-1', batchId: 'preview-batch-1', storedId: 'preview-paper-1', title: '研究方法与证据整理（演示）', kind: 'paper', originalPath: 'papers/研究方法与证据整理', deletedAt: '2026-11-10T08:30:00Z', itemsCount: 1, pdfAvailable: true, sourceAvailable: true, folderAvailable: true },
      { id: 'preview-trash-2', batchId: 'preview-batch-2', storedId: 'preview-note-2.md', title: 'Reading notes（演示）.md', kind: 'note', originalPath: 'notes/reading-notes.md', deletedAt: '2026-11-09T03:15:00Z', itemsCount: 3, pdfAvailable: false, sourceAvailable: true, folderAvailable: true },
    ],
  };
}

export function filterTrashPage(items: TrashEntry[], query: string): TrashEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  return needle ? items.filter(item => `${item.title}\n${item.originalPath}`.toLocaleLowerCase().includes(needle)) : items;
}

function deletedTime(value: string): { label: string; dateTime?: string } {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return { label: '删除时间未知' };
  return { label: date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }), dateTime: date.toISOString() };
}

const kindLabels: Record<TrashEntry['kind'], string> = { paper: '论文', pdf: 'PDF 文件', note: 'Markdown 笔记', directory: '文件夹', file: '文件' };
function sourceLabel(item: TrashEntry): string { return item.kind === 'note' ? '打开笔记' : item.kind === 'paper' ? '文献目录' : '打开文件夹'; }
function canOpen(item: TrashEntry, target: OpenTarget): boolean {
  return target === 'pdf' ? (item.kind === 'paper' || item.kind === 'pdf') && item.pdfAvailable : target === 'source' ? Boolean(item.sourceAvailable) && ['paper', 'note', 'directory'].includes(item.kind) : item.folderAvailable;
}

export function TrashView({ active, vaultId, preview }: Props) {
  const [page, setPage] = useState<TrashList | null>(() => preview ? previewTrash(vaultId) : null);
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [paging, setPaging] = useState<Paging>({ vaultId, history: [] });
  const [revision, setRevision] = useState(0); const refresh = useRef(false);
  const [opening, setOpening] = useState(''); const openController = useRef<AbortController | null>(null);
  const currentPaging: Paging = paging.vaultId === vaultId ? paging : { vaultId, history: [] };
  const currentPage = page?.vaultId === vaultId ? page : null;

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setLoading(true); setError(''); setNotice(''); setPage(null);
    const forceRefresh = refresh.current; refresh.current = false;
    const request = preview ? Promise.resolve(previewTrash(vaultId)) : callTool<TrashList>('trash_list', { vaultId, limit: 50, cursor: currentPaging.cursor, refresh: forceRefresh }, { signal: controller.signal });
    void request.then(value => {
      if (controller.signal.aborted) return;
      if (value.vaultId !== vaultId) throw new Error('回收站返回了其他知识库的内容，请重新载入当前知识库。');
      setPage(value);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(codeOf(reason) === 'CURSOR_EXPIRED' ? '回收站列表已更新，请刷新后继续浏览。' : messageOf(reason));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); };
  }, [active, vaultId, preview, currentPaging.cursor, revision]);

  useEffect(() => {
    setOpening('');
    return () => { openController.current?.abort(); openController.current = null; };
  }, [active, vaultId, preview]);

  function reload() {
    if (loading) return;
    refresh.current = true; setPaging({ vaultId, history: [] }); setRevision(value => value + 1);
  }

  async function open(item: TrashEntry, target: OpenTarget) {
    if (!active || preview || loading || openController.current || !currentPage || !canOpen(item, target)) return;
    const controller = new AbortController(); openController.current = controller;
    setOpening(`${item.id}:${target}`); setError(''); setNotice('');
    try {
      const result = await callTool<TrashOpenResult>('trash_open', { vaultId, batchId: item.batchId, storedId: item.storedId, target }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (result.requested !== true || result.target !== target) throw new Error('系统未确认收到打开请求，请重试。');
      setNotice(target === 'pdf' ? '已请求系统打开所选 PDF。' : target === 'source' ? item.kind === 'note' ? '已请求系统应用打开所选笔记。' : '已请求系统打开所选项目的文件夹。' : '已请求系统打开该删除批次的目录。');
    } catch (reason) { if (!controller.signal.aborted) setError(messageOf(reason)); }
    finally {
      if (openController.current === controller) { openController.current = null; setOpening(''); }
    }
  }

  if (!active) return null;
  const matches = filterTrashPage(currentPage?.items ?? [], query);
  return <section className="trash-view view-fill" aria-label="回收站">
    <header className="view-heading"><div><h2>回收站 {currentPage && <span className="count">已读取 {currentPage.total} 项</span>}</h2><p>查看已删除项目与所属批次</p></div><button className="icon-button" aria-label="刷新回收站" disabled={loading || preview || Boolean(opening)} onClick={reload}><RefreshCw size={16} className={loading ? 'spin' : ''} /></button></header>
    <p className="trash-readonly-note"><Info size={14} /><span>{currentPage?.restoreReason || '当前版本仅支持查看和打开回收站内容，暂不支持恢复。'}</span></p>
    <div className="trash-search"><div className="search-field"><Search size={16} /><input aria-label="搜索本页回收站" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索本页标题或原位置" />{query && <button className="icon-button" aria-label="清除回收站搜索" onClick={() => setQuery('')}><X size={14} /></button>}</div><span className="field-help">仅筛选当前页</span></div>
    {error && <div className="callout error" role="alert"><span>{error}</span><button disabled={loading || Boolean(opening)} onClick={reload}>重新加载</button></div>}
    {notice && <p className="inline-notice" role="status">{notice}</p>}
    <TrashPageContents page={currentPage} items={matches} loading={loading} query={query} preview={preview} opening={opening} onOpen={(item, target) => void open(item, target)} />
    <footer className="list-footer trash-footer"><span>{loading ? '正在读取…' : preview ? '演示数据 · 不打开真实文件' : currentPage ? `本页 ${currentPage.items.length} 项${query ? ` · 匹配 ${matches.length} 项` : ''}${currentPage.complete ? '' : ' · 仍可能有未扫描项目'}` : '尚未读取回收站'}</span><div className="button-row"><button className="icon-button" aria-label="回收站上一页" disabled={loading || Boolean(opening) || !currentPaging.history.length} onClick={() => setPaging({ vaultId, cursor: currentPaging.history.at(-1), history: currentPaging.history.slice(0, -1) })}><ChevronLeft size={17} /></button><span>第 {currentPaging.history.length + 1} 页</span><button className="icon-button" aria-label="回收站下一页" disabled={loading || Boolean(opening) || !currentPage?.nextCursor} onClick={() => { if (currentPage?.nextCursor) setPaging({ vaultId, cursor: currentPage.nextCursor, history: [...currentPaging.history, currentPaging.cursor] }); }}><ChevronRight size={17} /></button></div></footer>
  </section>;
}

interface ContentsProps {
  page: TrashList | null; items: TrashEntry[]; loading: boolean; query: string; preview: boolean; opening: string;
  onOpen(item: TrashEntry, target: OpenTarget): void;
}

/** Shared presentation for live data and synthetic state checks. */
export function TrashPageContents({ page, items, loading, query, preview, opening, onOpen }: ContentsProps) {
  const diagnostics = page?.diagnostics;
  const hasWarnings = diagnostics && (diagnostics.skippedBatches > 0 || diagnostics.skippedItems > 0 || diagnostics.warnings.length > 0);
  return <div className="trash-contents" aria-busy={loading}>
    {page && (!page.complete || page.truncated) && <div className="callout warning" role="status"><strong>仅显示本次扫描到的项目</strong><p>本次读取有范围限制，回收站中可能还有未扫描的批次；以上数量不是回收站完整总数。</p></div>}
    {hasWarnings && <div className="callout warning" role="status"><strong><AlertTriangle size={14} />部分回收站记录未能读取</strong><p>已扫描 {diagnostics.scannedBatches} 个批次；跳过 {diagnostics.skippedBatches} 个批次、{diagnostics.skippedItems} 个项目。未知或损坏的清单不会被当作空记录。</p>{diagnostics.warnings.length > 0 && <ul>{diagnostics.warnings.slice(0, 5).map((warning, index) => <li key={index}>{warning}</li>)}</ul>}{diagnostics.warnings.length > 5 && <p>另有 {diagnostics.warnings.length - 5} 条提示；请在所属批次目录中核对原始清单。</p>}</div>}
    {loading ? <div className="empty-state" role="status"><LoaderCircle className="spin" size={24} /><span>正在读取回收站…</span></div> : !page ? <div className="empty-state"><Trash2 size={28} /><span>回收站尚未读取，请刷新重试。</span></div> : !items.length ? <div className="empty-state"><Trash2 size={28} /><strong>{query ? '本页没有匹配的项目' : hasWarnings || !page.complete || page.truncated ? '本次没有可展示的项目' : '回收站为空'}</strong><span>{query ? '调整搜索文字，或翻到其他页继续查找。' : hasWarnings || !page.complete || page.truncated ? '请查看上方扫描提示；不能据此判断整个回收站为空。' : '移入回收站的文献会显示在这里。'}</span></div> : <ul className="trash-list">{items.map(item => {
      const time = deletedTime(item.deletedAt);
      return <li className="trash-row" key={item.id}>
        <div className="trash-row-main"><strong className="trash-item-title">{item.kind === 'directory' || item.kind === 'paper' ? <Folder size={16} /> : <FileText size={16} />}<span>{item.title || '未命名项目'}</span></strong><time className="trash-item-time" dateTime={time.dateTime}>{time.label}</time><p className="trash-item-kind">{kindLabels[item.kind]}</p><p className="trash-item-origin"><span>原位置</span><span>{item.originalPath || '未知'}</span></p>{item.itemsCount > 1 && <p className="trash-batch-size">同一删除批次含 {item.itemsCount} 个项目</p>}</div>
        <div className="trash-row-actions">{(item.kind === 'paper' || item.kind === 'pdf') && <button aria-label={`打开 PDF：${item.title || '未命名项目'}`} title={item.pdfAvailable ? '在系统查看器中打开 PDF' : '未找到可打开的 PDF'} disabled={preview || Boolean(opening) || !item.pdfAvailable} onClick={() => onOpen(item, 'pdf')}>{opening === `${item.id}:pdf` ? <LoaderCircle className="spin" size={14} /> : <ExternalLink size={14} />}打开 PDF</button>}{canOpen(item, 'source') && <button aria-label={`${sourceLabel(item)}：${item.title || '未命名项目'}`} title={item.kind === 'note' ? '在系统关联的应用中查看 Markdown 笔记' : '打开回收站内所选项目的文件夹'} disabled={preview || Boolean(opening)} onClick={() => onOpen(item, 'source')}>{opening === `${item.id}:source` ? <LoaderCircle className="spin" size={14} /> : item.kind === 'note' ? <ExternalLink size={14} /> : <FolderOpen size={14} />}{sourceLabel(item)}</button>}<button aria-label={`打开批次目录：${item.title || '未命名项目'}`} title={item.folderAvailable ? '打开本项目所属的删除批次目录，可查看批次清单与全部项目' : '批次目录不可用'} disabled={preview || Boolean(opening) || !item.folderAvailable} onClick={() => onOpen(item, 'folder')}>{opening === `${item.id}:folder` ? <LoaderCircle className="spin" size={14} /> : <FolderOpen size={14} />}批次目录</button></div>
      </li>;
    })}</ul>}
  </div>;
}
