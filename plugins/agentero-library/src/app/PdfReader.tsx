import { useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, FileText, List, LoaderCircle, Search, Send, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import type { LibraryOperation, Paper, PdfChunk } from '../contracts/types';
import { callTool } from './api';
import { sendSelection } from './bridge';
import { formatBytes, messageOf, PDF_CHUNK_BYTES, readPdfChunks } from './model';
import { pdfjs } from './pdf-runtime';
import 'pdfjs-dist/web/pdf_viewer.css';

interface Props {
  active: boolean;
  vaultId: string;
  paper: Paper | null;
  preview: boolean;
  canSend: boolean;
  canParse: boolean;
  onNotes(paper: Paper): void;
  onOperation(operation: LibraryOperation): void;
  onBack(): void;
}
interface OutlineNode { title: string; dest: unknown; items?: OutlineNode[] }
interface SearchPage { page: number; excerpt: string }

export function PdfReader({ active, vaultId, paper, preview, canSend, canParse, onNotes, onOperation, onBack }: Props) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(false); const [progress, setProgress] = useState('');
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [pageNumber, setPageNumber] = useState(1); const [pageInput, setPageInput] = useState('1');
  const [zoom, setZoom] = useState(1); const [fit, setFit] = useState(true);
  const [containerWidth, setContainerWidth] = useState(700); const [pageWidth, setPageWidth] = useState(612);
  const [outline, setOutline] = useState<OutlineNode[]>([]); const [outlineOpen, setOutlineOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false); const [query, setQuery] = useState('');
  const [executedQuery, setExecutedQuery] = useState('');
  const [searchBusy, setSearchBusy] = useState(false); const [searchPages, setSearchPages] = useState<SearchPage[]>([]);
  const [selection, setSelection] = useState<{ text: string; page: number; x: number; y: number } | null>(null);
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false); const [rendering, setRendering] = useState(false);
  const [passwordRequired, setPasswordRequired] = useState(false); const [password, setPassword] = useState('');
  const [passwordWrong, setPasswordWrong] = useState(false);
  const updatePassword = useRef<((password: string) => void) | null>(null);
  const viewport = useRef<HTMLDivElement>(null); const pageElement = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null); const textLayer = useRef<HTMLDivElement>(null);
  const renderChain = useRef<Promise<void>>(Promise.resolve());
  const searchTicket = useRef(0);
  const scale = fit ? Math.max(0.35, Math.min(2, (containerWidth - 40) / pageWidth)) : zoom;

  useEffect(() => {
    if (!paper || preview) { setDocument(null); return; }
    const controller = new AbortController(); let loadingTask: ReturnType<typeof pdfjs.getDocument> | undefined;
    setLoading(true); setError(''); setNotice(''); setDocument(null); setOutline([]); setSelection(null);
    setPageNumber(1); setPageInput('1'); setSearchPages([]); setExecutedQuery(''); setPasswordRequired(false); searchTicket.current += 1;
    void readPdfChunks((offset, revision) => callTool<PdfChunk>('pdf_read_chunk', { vaultId, paperPath: paper.path, offset, length: PDF_CHUNK_BYTES, revision }), {
      signal: controller.signal,
      onProgress: (loaded, total) => setProgress(`${formatBytes(loaded)} / ${formatBytes(total)}`),
    }).then(async bytes => {
      controller.signal.throwIfAborted();
      loadingTask = pdfjs.getDocument({ data: bytes, useWorkerFetch: false, useSystemFonts: true, stopAtErrors: true });
      loadingTask.onPassword = (update: (password: string) => void, reason: number) => {
        if (controller.signal.aborted) return;
        updatePassword.current = update; setPasswordWrong(reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD); setPasswordRequired(true);
      };
      const pdf = await loadingTask.promise;
      if (controller.signal.aborted) { await loadingTask.destroy().catch(() => {}); return; }
      setPasswordRequired(false); setDocument(pdf);
      const items = await pdf.getOutline();
      if (!controller.signal.aborted) setOutline(items ?? []);
    }).catch(reason => { if (!controller.signal.aborted) setError(messageOf(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); searchTicket.current += 1; updatePassword.current = null; void loadingTask?.destroy().catch(() => {}); };
  }, [vaultId, paper?.path, preview]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.width > 0) setContainerWidth(entry.contentRect.width); });
    observer.observe(element); return () => observer.disconnect();
  }, [document, active, outlineOpen]);

  useEffect(() => {
    if (!active || !document || !canvas.current || !textLayer.current || !pageElement.current) return;
    let cancelled = false; let task: RenderTask | undefined; let layer: InstanceType<typeof pdfjs.TextLayer> | undefined;
    const work = renderChain.current.catch(() => {}).then(async () => {
      if (cancelled) return;
      setRendering(true); setSelection(null); setError('');
      const pdfPage = await document.getPage(pageNumber);
      if (cancelled) return;
      setPageWidth(pdfPage.getViewport({ scale: 1 }).width);
      const view = pdfPage.getViewport({ scale });
      const target = canvas.current!; const content = textLayer.current!; const page = pageElement.current!;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      target.width = Math.ceil(view.width * ratio); target.height = Math.ceil(view.height * ratio);
      target.style.width = `${view.width}px`; target.style.height = `${view.height}px`;
      page.style.width = `${view.width}px`; page.style.height = `${view.height}px`;
      page.style.setProperty('--scale-factor', String(scale)); page.style.setProperty('--total-scale-factor', String(scale));
      content.replaceChildren();
      task = pdfPage.render({ canvas: target, viewport: view, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      const renderPromise = task.promise;
      // Cleanup can cancel the canvas task while text extraction is awaiting.
      // Observe rejection immediately; the original promise is still awaited below.
      void renderPromise.catch(() => {});
      let completed = false;
      try {
        const text = await pdfPage.getTextContent();
        if (cancelled) return;
        layer = new pdfjs.TextLayer({ textContentSource: text, container: content, viewport: view });
        await Promise.all([renderPromise, layer.render()]);
        completed = true;
        if (!cancelled && executedQuery) for (const span of content.querySelectorAll('span')) {
          if (span.textContent?.toLocaleLowerCase().includes(executedQuery.toLocaleLowerCase())) span.classList.add('pdf-search-match');
        }
      } finally {
        if (!completed) { task.cancel(); layer?.cancel(); }
        // Do not let a following render reuse this canvas before cancellation settles.
        await renderPromise.catch(() => {});
      }
    }).catch(reason => {
      if (!cancelled && !(reason instanceof Error && /cancel/i.test(reason.name))) setError(`这一页无法完整显示：${messageOf(reason)}`);
    }).finally(() => { if (!cancelled) setRendering(false); });
    renderChain.current = work;
    return () => { cancelled = true; task?.cancel(); layer?.cancel(); };
  }, [active, document, pageNumber, scale, executedQuery]);

  useEffect(() => { setPageInput(String(pageNumber)); viewport.current?.scrollTo({ top: 0, left: 0 }); }, [pageNumber]);

  async function navigate(item: OutlineNode) {
    if (!document) return;
    try {
      const destination = typeof item.dest === 'string' ? await document.getDestination(item.dest) : item.dest;
      const reference: unknown = Array.isArray(destination) ? destination[0] : null;
      if (typeof reference === 'number') setPageNumber(reference + 1);
      else if (reference && typeof reference === 'object' && 'num' in reference && 'gen' in reference) {
        setPageNumber(await document.getPageIndex({ num: Number(reference.num), gen: Number(reference.gen) }) + 1);
      }
    } catch (reason) { setNotice(messageOf(reason)); }
  }

  async function search() {
    if (!document || !query.trim()) return;
    const ticket = ++searchTicket.current; setSearchBusy(true); setSearchPages([]); setNotice('');
    const found: SearchPage[] = []; const needle = query.trim().toLocaleLowerCase();
    try {
      for (let number = 1; number <= document.numPages; number += 1) {
        if (ticket !== searchTicket.current) return;
        const text = await (await document.getPage(number)).getTextContent();
        const full = text.items.filter((item): item is typeof item & { str: string } => 'str' in item).map(item => item.str).join(' ');
        const index = full.toLocaleLowerCase().indexOf(needle);
        if (index >= 0) found.push({ page: number, excerpt: full.slice(Math.max(0, index - 35), index + needle.length + 65) });
      }
      if (ticket !== searchTicket.current) return;
      setExecutedQuery(query.trim());
      setSearchPages(found);
      if (found[0]) setPageNumber(found[0].page);
      else setNotice('当前 PDF 中没有找到该文字。扫描图片可能没有可搜索的文字层。');
    } catch (reason) { if (ticket === searchTicket.current) setNotice(messageOf(reason)); }
    finally { if (ticket === searchTicket.current) setSearchBusy(false); }
  }

  function captureSelection() {
    const selected = window.getSelection(); const element = pageElement.current;
    if (!selected || selected.rangeCount === 0 || !element) { setSelection(null); return; }
    const range = selected.getRangeAt(0); const text = selected.toString().trim();
    if (!text || !element.contains(range.startContainer) || !element.contains(range.endContainer)) { setSelection(null); return; }
    const rect = range.getBoundingClientRect();
    setQuestion('');
    const width = Math.min(420, window.innerWidth - 16);
    setSelection({ text, page: pageNumber, x: Math.max(8, Math.min(window.innerWidth - width - 8, rect.left)), y: Math.max(8, rect.top - 92) });
  }

  async function ask() {
    if (!selection || !paper || sending || !canSend || selection.text.length > 20_000) return;
    setSending(true); setNotice('');
    try { await sendSelection({ text: selection.text, paperPath: paper.path, vaultId, page: selection.page, title: paper.title, question: question.trim() || undefined }); setNotice('选区已交给当前对话。'); setSelection(null); window.getSelection()?.removeAllRanges(); }
    catch (reason) { setNotice(messageOf(reason)); }
    finally { setSending(false); }
  }

  if (!paper) return <div className="empty-state reader-empty"><BookOpen size={34} /><strong>打开一篇文献开始阅读</strong><span>选中文字后，可以带上论文与物理页码交给当前对话。</span><button onClick={onBack}>返回文献库</button></div>;
  if (preview) return <div className="empty-state reader-empty"><FileText size={30} /><strong>{paper.title}</strong><span>这是界面预览，未连接真实 PDF 或知识库。</span><button onClick={onBack}>返回演示列表</button></div>;

  return <section className="reader-view view-fill" aria-label="PDF 阅读器">
    <header className="reader-heading"><strong title={paper.title}>{paper.title}</strong><div className="button-row"><button onClick={() => onNotes(paper)}>论文笔记</button><button disabled={!canParse} title={canParse ? '解析会写入论文正文，作为独立后台任务执行' : '正文解析需要可用的原生 PDFium'} onClick={() => { void callTool<LibraryOperation>('paper_parse', { vaultId, paperPath: paper.path }).then(onOperation).catch(reason => setNotice(messageOf(reason))); }}>解析正文</button></div></header>
    <div className="reader-toolbar"><button className={`icon-button ${outlineOpen ? 'active-button' : ''}`} aria-label="显示目录" aria-pressed={outlineOpen} onClick={() => setOutlineOpen(value => !value)} disabled={!document}><List size={17} /></button><button className="icon-button" aria-label="查找 PDF 文字" onClick={() => setSearchOpen(value => !value)} disabled={!document}><Search size={17} /></button><span className="toolbar-spacer" /><button className="icon-button" aria-label="缩小" disabled={!document || scale <= 0.35} onClick={() => { setFit(false); setZoom(Math.max(0.35, scale - 0.15)); }}><ZoomOut size={17} /></button><span className="zoom-label">{Math.round(scale * 100)}%</span><button className="icon-button" aria-label="放大" disabled={!document || scale >= 3} onClick={() => { setFit(false); setZoom(Math.min(3, scale + 0.15)); }}><ZoomIn size={17} /></button><button className={fit ? 'active-button' : ''} disabled={!document} onClick={() => setFit(true)}>适合宽度</button></div>
    {searchOpen && <form className="pdf-find" onSubmit={e => { e.preventDefault(); void search(); }}><input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="查找 PDF 文字" aria-label="PDF 查找文字" /><button disabled={searchBusy || !query.trim()}>{searchBusy ? <LoaderCircle size={15} className="spin" /> : '查找'}</button><span>{searchPages.length ? `${searchPages.length} 页命中` : ''}</span><button type="button" className="icon-button" aria-label="关闭查找" onClick={() => { setSearchOpen(false); searchTicket.current += 1; setSearchBusy(false); }}><X size={16} /></button></form>}
    {notice && <p className="inline-notice" role="status">{notice}</p>}
    {error && <p className="callout error" role="alert">{error}</p>}
    {passwordRequired && <form className="pdf-password" onSubmit={e => { e.preventDefault(); updatePassword.current?.(password); setPassword(''); }}><label>此 PDF 已加密<input autoFocus type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="off" placeholder="PDF 密码" /></label><button className="primary">解锁</button>{passwordWrong && <span className="error-text">密码不正确，请重试。</span>}</form>}
    <div className="reader-body">
      {outlineOpen && <aside className="pdf-outline"><h3>目录</h3>{outline.length ? <Outline items={outline} onOpen={item => void navigate(item)} /> : <p className="field-help">该 PDF 没有内嵌目录。</p>}{searchOpen && searchPages.map(hit => <button className="outline-hit" key={hit.page} onClick={() => setPageNumber(hit.page)}><strong>第 {hit.page} 页</strong><span>{hit.excerpt}</span></button>)}</aside>}
      <div className="pdf-viewport" ref={viewport} onMouseUp={() => captureSelection()} onKeyUp={() => captureSelection()}>{loading && <div className="empty-state"><LoaderCircle className="spin" /><strong>正在读取 PDF…</strong><span>{progress}</span></div>}<div className={`pdf-page ${document ? '' : 'is-hidden'}`} ref={pageElement}><canvas ref={canvas} /><div className="textLayer" ref={textLayer} /></div>{rendering && document && <span className="render-indicator" role="status"><LoaderCircle size={14} className="spin" />正在绘制</span>}</div>
    </div>
    {searchOpen && searchPages.length > 0 && !outlineOpen && <div className="pdf-search-pages">{searchPages.map(hit => <button key={hit.page} className={hit.page === pageNumber ? 'selected' : ''} title={hit.excerpt} onClick={() => setPageNumber(hit.page)}>第 {hit.page} 页</button>)}</div>}
    <footer className="reader-footer"><button className="icon-button" aria-label="上一页" disabled={!document || pageNumber <= 1} onClick={() => setPageNumber(number => number - 1)}><ChevronLeft size={18} /></button><form onSubmit={e => { e.preventDefault(); if (document) setPageNumber(Math.min(document.numPages, Math.max(1, Number.parseInt(pageInput, 10) || 1))); }}><input aria-label="PDF 物理页码" inputMode="numeric" value={pageInput} onChange={e => setPageInput(e.target.value)} disabled={!document} /><span>/ {document?.numPages ?? '—'}</span></form><button className="icon-button" aria-label="下一页" disabled={!document || pageNumber >= document.numPages} onClick={() => setPageNumber(number => number + 1)}><ChevronRight size={18} /></button><span className="muted">PDF 物理页</span></footer>
    {selection && <div className="selection-actions" style={{ left: selection.x, top: selection.y, width: Math.min(420, window.innerWidth - 16), flexWrap: 'wrap' }} onMouseDown={e => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); }}><input style={{ width: '100%', fontSize: 12 }} aria-label="针对选区的问题" placeholder="输入问题；留空则解释这段论文" maxLength={1000} value={question} disabled={sending} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void ask(); } }} /><span>第 {selection.page} 页 · {selection.text.length} 字符</span><span className="toolbar-spacer" /><button disabled={!canSend || sending || selection.text.length > 20_000} title={!canSend ? '当前宿主没有发送能力，可复制选区' : selection.text.length > 20_000 ? '请将选区缩小到 20000 字符以内' : '发送当前选区和来源到所属对话'} onClick={() => void ask()}>{sending ? <LoaderCircle size={14} className="spin" /> : <Send size={14} />}提问</button><button className="icon-button" aria-label="关闭选区操作" onClick={() => setSelection(null)}><X size={14} /></button></div>}
  </section>;
}

function Outline({ items, onOpen, depth = 0 }: { items: OutlineNode[]; onOpen(item: OutlineNode): void; depth?: number }) {
  return <ul className="outline-tree">{items.map((item, index) => <li key={`${index}:${item.title}`}><button style={{ paddingInlineStart: 10 + depth * 12 }} onClick={() => onOpen(item)}>{item.title || '未命名章节'}</button>{item.items && item.items.length > 0 && <Outline items={item.items} onOpen={onOpen} depth={depth + 1} />}</li>)}</ul>;
}
