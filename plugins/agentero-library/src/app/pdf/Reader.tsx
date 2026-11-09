import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Crop, Download, FileText, Languages, List, LoaderCircle, MessageSquare, NotebookPen, Palette, RotateCw, Search, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { LibraryOperation, Paper, PdfChunk } from '../../contracts/types';
import type { BookmarkNode, ExportResult, MarkColor, MarkList, ReaderMark, TranslateResult, WriteBookmarksResult } from '../../contracts/reader';
import { callTool } from '../api';
import { openExternalLink, registerBeforeTeardown, sendSelection } from '../bridge';
import { formatBytes, messageOf, PDF_CHUNK_BYTES, readPdfChunks } from '../model';
import { NotesView } from '../NotesView';
import { pdfjs } from '../pdf-runtime';
import { PageView, type RegisteredPage, type VisualSelection } from './PageView';
import { MarksPanel, OutlinePanel, SelectionToolbar, TranslationCard, type FloatingTranslation, type ReaderSelection } from './ReaderPanels';
import { fitPageScale, screenRectToPoints, usefulRects } from './geometry';
import { textLayerMatches, textMatches } from './search';
import { useDocumentTranslation } from './translation/useDocumentTranslation';
import 'pdfjs-dist/web/pdf_viewer.css';
import './reader.css';

interface Props {
  active: boolean; vaultId: string; paper: Paper | null; preview: boolean; canSend: boolean; canParse: boolean;
  onNotes(paper: Paper): void; onOperation(operation: LibraryOperation): void; onBack(): void;
  onDirtyChange?(dirty: boolean): void;
}
interface ReaderState { pageNumber: number; zoom: number; fit: boolean; rotation: number; tone: 'white' | 'dark'; outlineOpen: boolean; marksOpen: boolean; notesOpen: boolean }
const initialView: ReaderState = { pageNumber: 1, zoom: 1, fit: true, rotation: 0, tone: 'white', outlineOpen: false, marksOpen: false, notesOpen: false };
interface SearchHit { page: number; index: number; ordinal: number; text: string; excerpt: string }
const editable = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]'));

export function PdfReader({ active, vaultId, paper, preview, canSend, canParse, onNotes, onOperation, onBack, onDirtyChange }: Props) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null); const [loadRevision, setLoadRevision] = useState(0);
  const [loading, setLoading] = useState(false); const [progress, setProgress] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [view, setView] = useState<ReaderState>(initialView); const [viewReady, setViewReady] = useState(false);
  const viewRef = useRef(view); viewRef.current = view;
  const [pageInput, setPageInput] = useState('1'); const [estimate, setEstimate] = useState({ width: 612, height: 792 }); const [containerWidth, setContainerWidth] = useState(700);
  const [fitPageWidth, setFitPageWidth] = useState(612);
  const [marks, setMarks] = useState<MarkList | null>(null); const marksRef = useRef(marks); marksRef.current = marks;
  const [markError, setMarkError] = useState(''); const [selectedMark, setSelectedMark] = useState<string | null>(null); const [busy, setBusy] = useState(false); const busyRef = useRef(false);
  const [selection, setSelection] = useState<ReaderSelection | null>(null); const [translationCard, setTranslationCard] = useState<FloatingTranslation | null>(null);
  const [translationOpen, setTranslationOpen] = useState(false); const [targetLanguage, setTargetLanguage] = useState(''); const translationRun = useRef(0);
  const selectionTranslationAbort = useRef<AbortController | null>(null); const reloadNotice = useRef<string | null>(null);
  const [cards, setCards] = useState(true); const [crop, setCrop] = useState(false); const [noteDirty, setNoteDirty] = useState(false); const [space, setSpace] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false); const [query, setQuery] = useState(''); const [searchBusy, setSearchBusy] = useState(false); const [hits, setHits] = useState<SearchHit[]>([]); const [hitIndex, setHitIndex] = useState(-1);
  const [renderRevision, setRenderRevision] = useState(0); const locatedHit = useRef('');
  const onPageRendered = useCallback(() => setRenderRevision(value => value + 1), []);
  const [passwordRequired, setPasswordRequired] = useState(false); const [passwordWrong, setPasswordWrong] = useState(false); const [password, setPassword] = useState('');
  const passwordUpdate = useRef<((password: string) => void) | null>(null); const searchInput = useRef<HTMLInputElement>(null);
  const host = useRef<HTMLElement>(null); const viewport = useRef<HTMLDivElement>(null); const pages = useRef(new Map<number, RegisteredPage>());
  const generation = useRef(0); const pdfRevision = useRef(''); const searchRun = useRef(0); const stateSave = useRef<Promise<unknown>>(Promise.resolve());
  const stateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const panning = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null); const justPanned = useRef(0);
  const restore = useRef<{ page: number; ratio: number } | null>(null); const pendingAnchor = useRef<{ page: number; point: number[] } | null>(null);
  const showCards = cards && containerWidth >= 680;
  const availablePageWidth = Math.max(1, containerWidth - (showCards ? 226 : 0));
  const scale = view.fit ? fitPageScale(fitPageWidth, availablePageWidth) : view.zoom;
  const paperPath = paper?.path ?? '';
  const translated = useDocumentTranslation({ document, vaultId, paperPath, open: translationOpen && active, currentPage: view.pageNumber, targetLanguage });

  const refreshMarks = useCallback(async () => {
    if (!paperPath || preview) return;
    const ticket = generation.current;
    try { const next = await callTool<MarkList>('mark_list', { vaultId, paperPath }); if (ticket === generation.current) { marksRef.current = next; setMarks(next); setMarkError(''); } }
    catch (cause) { if (ticket === generation.current) setMarkError(messageOf(cause)); }
  }, [vaultId, paperPath, preview]);

  useEffect(() => {
    if (!paper || preview) { setDocument(null); return; }
    const controller = new AbortController(); const ticket = ++generation.current; const path = paper.path;
    let task: ReturnType<typeof pdfjs.getDocument> | undefined;
    setLoading(true); setViewReady(false); setError(''); setNotice(reloadNotice.current ?? ''); reloadNotice.current = null; setDocument(null); setMarks(null); marksRef.current = null;
    setSelection(null); setTranslationCard(null); setTranslationOpen(false); setHits([]); setHitIndex(-1); setSelectedMark(null); setPasswordRequired(false); pages.current.clear();
    translationRun.current += 1; searchRun.current += 1; selectionTranslationAbort.current?.abort();
    const savedState = callTool<{ state?: Partial<ReaderState> }>('reader_state_get', { vaultId, paperPath: path }).catch(() => ({ state: {} }));
    void refreshMarks();
    void readPdfChunks(async (offset, revision) => {
      const result = await callTool<PdfChunk>('pdf_read_chunk', { vaultId, paperPath: path, offset, length: PDF_CHUNK_BYTES, revision });
      if (offset === 0 && ticket === generation.current) pdfRevision.current = result.revision;
      return result;
    }, { signal: controller.signal, onProgress: (loaded, total) => { if (!controller.signal.aborted) setProgress(`${formatBytes(loaded)} / ${formatBytes(total)}`); } }).then(async bytes => {
      controller.signal.throwIfAborted();
      task = pdfjs.getDocument({ data: bytes, useWorkerFetch: false, useSystemFonts: true, stopAtErrors: true });
      task.onPassword = (update: (value: string) => void, reason: number) => { if (!controller.signal.aborted) { passwordUpdate.current = update; setPasswordWrong(reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD); setPasswordRequired(true); } };
      const pdf = await task.promise; const state = ((await savedState).state ?? {}) as Partial<ReaderState>;
      controller.signal.throwIfAborted();
      const first = await pdf.getPage(1); const base = first.getViewport({ scale: 1 });
      controller.signal.throwIfAborted();
      const next: ReaderState = { ...initialView, ...state, pageNumber: Math.min(pdf.numPages, Math.max(1, Number(state.pageNumber) || 1)), zoom: Math.max(.35, Math.min(3, Number(state.zoom) || 1)), rotation: [0, 90, 180, 270].includes(Number(state.rotation)) ? Number(state.rotation) : 0, tone: state.tone === 'dark' ? 'dark' : 'white' };
      setEstimate({ width: base.width, height: base.height }); setFitPageWidth(next.rotation % 180 ? base.height : base.width); setView(next); viewRef.current = next; setPageInput(String(next.pageNumber)); restore.current = { page: next.pageNumber, ratio: 0 };
      setDocument(pdf); setViewReady(true); setPasswordRequired(false);
    }).catch(cause => { if (!controller.signal.aborted) setError(messageOf(cause)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); generation.current += 1; searchRun.current += 1; translationRun.current += 1; selectionTranslationAbort.current?.abort(); passwordUpdate.current = null; void task?.destroy().catch(() => {}); };
  }, [vaultId, paperPath, preview, loadRevision, refreshMarks]);

  useEffect(() => {
    if (!document || !view.fit) return;
    let cancelled = false;
    // Only current-page metadata is requested; PDF.js caches already visited pages.
    void document.getPage(view.pageNumber).then(page => {
      if (!cancelled) setFitPageWidth(page.getViewport({ scale: 1, rotation: (page.rotate + view.rotation) % 360 }).width);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [document, view.fit, view.pageNumber, view.rotation]);

  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.width > 0) { rememberPosition(); setContainerWidth(entry.contentRect.width); } });
    observer.observe(viewport.current); return () => observer.disconnect();
  }, [document, active]);

  const goToPage = useCallback((number: number, ratio = 0) => {
    if (!document || !viewport.current) return;
    const next = Math.min(document.numPages, Math.max(1, number)); const target = viewport.current.querySelector<HTMLElement>(`[data-sheet-page="${next}"]`);
    if (target) { viewport.current.scrollTo({ top: Math.max(0, target.offsetTop + target.offsetHeight * ratio - 16), behavior: 'auto' }); setView(value => value.pageNumber === next ? value : { ...value, pageNumber: next }); }
  }, [document]);
  const layoutScale = view.fit ? availablePageWidth : view.zoom;
  useEffect(() => {
    if (!document || !active) return;
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => { const target = restore.current ?? { page: viewRef.current.pageNumber, ratio: 0 }; restore.current = null; goToPage(target.page, target.ratio); }); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [document, layoutScale, view.fit, view.rotation, active, goToPage]);
  useEffect(() => { setPageInput(String(view.pageNumber)); }, [view.pageNumber]);

  const registerPage = useCallback((number: number, entry: RegisteredPage | null) => {
    if (entry) {
      pages.current.set(number, entry);
      const pending = pendingAnchor.current;
      if (pending?.page === number && viewport.current) {
        const point = entry.geometry.viewport.convertToViewportPoint(pending.point[0], pending.point[1]); const sheet = entry.element.closest<HTMLElement>('[data-sheet-page]');
        if (sheet) { const top = sheet.offsetTop + point[1] - 20; requestAnimationFrame(() => viewport.current?.scrollTo({ top: Math.max(0, top), behavior: 'auto' })); pendingAnchor.current = null; }
      }
    } else pages.current.delete(number);
  }, []);

  async function navigate(destination: unknown, action?: string, pageIndex?: number) {
    if (!document) return;
    if (pageIndex !== undefined) { goToPage(pageIndex + 1); return; }
    if (action) { const target = action === 'NextPage' ? view.pageNumber + 1 : action === 'PrevPage' ? view.pageNumber - 1 : action === 'LastPage' ? document.numPages : 1; goToPage(target); return; }
    try {
      const value = typeof destination === 'string' ? await document.getDestination(destination) : destination;
      if (!Array.isArray(value)) return;
      const ref: unknown = value[0]; let target: number;
      if (typeof ref === 'number') target = ref + 1;
      else if (ref && typeof ref === 'object' && 'num' in ref && 'gen' in ref) target = await document.getPageIndex({ num: Number(ref.num), gen: Number(ref.gen) }) + 1;
      else return;
      if (value[1]?.name === 'XYZ' && typeof value[3] === 'number') pendingAnchor.current = { page: target, point: [typeof value[2] === 'number' ? value[2] : 0, value[3]] };
      goToPage(target);
      const existing = pages.current.get(target); if (existing && pendingAnchor.current) registerPage(target, existing);
    } catch (cause) { setNotice(messageOf(cause)); }
  }

  function scroll() {
    const target = viewport.current; if (!target || panning.current) return;
    const pivot = target.scrollTop + Math.min(target.clientHeight * .25, 150);
    for (const sheet of target.querySelectorAll<HTMLElement>('[data-sheet-page]')) if (sheet.offsetTop + sheet.offsetHeight >= pivot) { const number = Number(sheet.dataset.sheetPage); setView(value => value.pageNumber === number ? value : { ...value, pageNumber: number }); break; }
  }
  function zoom(value: number, fit = false) {
    rememberPosition();
    setView(current => ({ ...current, fit, zoom: Math.max(.35, Math.min(3, value)) }));
  }
  function rememberPosition() {
    if (restore.current) return;
    const parent = viewport.current; const number = viewRef.current.pageNumber; const sheet = parent?.querySelector<HTMLElement>(`[data-sheet-page="${number}"]`);
    if (parent && sheet?.offsetHeight) restore.current = { page: number, ratio: (parent.scrollTop + 16 - sheet.offsetTop) / sheet.offsetHeight };
  }
  useEffect(() => {
    const target = viewport.current; if (!target || !active) return;
    const wheel = (event: WheelEvent) => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); zoom(scale * Math.exp(-event.deltaY * .003)); } };
    target.addEventListener('wheel', wheel, { passive: false }); return () => target.removeEventListener('wheel', wheel);
  }, [active, scale, view.pageNumber]);

  const persistView = useCallback(() => {
    if (!viewReady || !paperPath || preview) return Promise.resolve();
    const state = { ...viewRef.current }; const path = paperPath; const id = vaultId;
    const task = stateSave.current.catch(() => {}).then(() => callTool('reader_state_set', { vaultId: id, paperPath: path, state })); stateSave.current = task;
    return task.catch(() => {});
  }, [viewReady, vaultId, paperPath, preview]);
  useEffect(() => { clearTimeout(stateTimer.current); if (viewReady) stateTimer.current = setTimeout(() => { void persistView(); }, 500); return () => clearTimeout(stateTimer.current); }, [view, viewReady, persistView]);
  useEffect(() => registerBeforeTeardown(async () => { clearTimeout(stateTimer.current); await persistView(); }), [persistView]);
  useEffect(() => registerBeforeTeardown(async () => { selectionTranslationAbort.current?.abort(); }), []);
  useEffect(() => { onDirtyChange?.(noteDirty); return () => onDirtyChange?.(false); }, [noteDirty, onDirtyChange]);

  function captureSelection() {
    if (crop || panning.current || Date.now() < justPanned.current) return;
    const selected = window.getSelection(); if (!selected || !selected.rangeCount || selected.isCollapsed || !viewport.current) { setSelection(null); return; }
    const range = selected.getRangeAt(0); const quote = selected.toString().trim();
    if (!quote || !viewport.current.contains(range.startContainer) || !viewport.current.contains(range.endContainer)) return;
    const parts: ReaderSelection['parts'] = [];
    for (const [number, entry] of [...pages.current].sort((a, b) => a[0] - b[0])) {
      const layer = entry.element.querySelector('.textLayer'); if (!layer || !range.intersectsNode(layer)) continue;
      const bounds = entry.element.getBoundingClientRect();
      const rects = usefulRects([...range.getClientRects()].filter(rect => rect.width > .2 && rect.height > .2 && rect.right > bounds.left && rect.left < bounds.right && rect.bottom > bounds.top && rect.top < bounds.bottom).map(rect => {
        const clip = { left: Math.max(bounds.left, rect.left), top: Math.max(bounds.top, rect.top), width: Math.min(bounds.right, rect.right) - Math.max(bounds.left, rect.left), height: Math.min(bounds.bottom, rect.bottom) - Math.max(bounds.top, rect.top) };
        return screenRectToPoints(clip, bounds, entry.geometry);
      }));
      if (!rects.length) continue;
      const walker = window.document.createTreeWalker(layer, NodeFilter.SHOW_TEXT); let node: Node | null; let text = '';
      while ((node = walker.nextNode())) if (range.intersectsNode(node)) { const value = node.textContent ?? ''; text += value.slice(node === range.startContainer ? range.startOffset : 0, node === range.endContainer ? range.endOffset : value.length) + ' '; }
      parts.push({ page: number, rects, pageSize: { width: entry.geometry.width, height: entry.geometry.height }, quote: text.trim() || quote });
    }
    if (parts.length) { const rect = range.getBoundingClientRect(); setSelection({ text: quote, parts, x: rect.left, y: rect.top }); }
  }

  async function action(work: () => Promise<void>) {
    if (busyRef.current) throw new Error('请等待当前保存完成。');
    busyRef.current = true; setBusy(true); setMarkError('');
    try { await work(); } catch (cause) { setMarkError(messageOf(cause)); throw cause; } finally { busyRef.current = false; setBusy(false); }
  }
  async function addSelection(value: ReaderSelection, kind: 'highlight' | 'underline' | 'ask' | 'translate' | 'visual', options: { color?: MarkColor; comment?: string; question?: string; result?: string } = {}) {
    if (!paper || !marksRef.current) throw new Error('批注尚未加载，请刷新批注后重试。');
    const ticket = generation.current; let current = marksRef.current;
    for (const part of value.parts) {
      current = await callTool<MarkList>('mark_add', { vaultId, paperPath: paper.path, revision: current.revision, kind, page: part.page, rects: part.rects, pageSize: part.pageSize, quote: part.quote, ...options, ...(value.asset ? { asset: value.asset } : {}) });
      if (ticket !== generation.current) return;
      marksRef.current = current; setMarks(current);
    }
  }
  async function highlight(color: MarkColor, comment: string, underline?: boolean) {
    if (!selection) return; const selected = selection; const ticket = generation.current;
    try { await action(() => addSelection(selected, selected.asset ? 'visual' : underline ? 'underline' : 'highlight', { color, ...(comment ? { comment } : {}) })); if (ticket === generation.current) { setSelection(null); window.getSelection()?.removeAllRanges(); setNotice('批注已保存。'); } }
    catch (cause) { if (ticket === generation.current) setNotice(`保存失败，选区仍保留：${messageOf(cause)}`); }
  }
  async function ask(question: string) {
    if (!selection || !paper || !question.trim() || !canSend) return;
    const selected = selection; const ticket = generation.current;
    try { await action(async () => {
      await sendSelection({ text: selected.text, paperPath: paper.path, vaultId, page: selected.parts[0].page, title: paper.title, question: question.trim() });
      if (ticket === generation.current) { setSelection(null); window.getSelection()?.removeAllRanges(); setNotice('问题已发送到所属对话。'); }
      try { await addSelection(selected, 'ask', { question: question.trim() }); } catch { if (ticket === generation.current) setNotice('问题已发送，但提问标记未保存。无需重复发送。'); }
    }); } catch (cause) { setNotice(messageOf(cause)); }
  }
  async function copy(text: string, label = '内容') { try { await navigator.clipboard.writeText(text); setNotice(`${label}已复制。`); } catch { setNotice(`无法访问剪贴板，请使用系统快捷键复制${label}。`); } }
  async function translateSelection(value = selection) {
    if (!value) return; const ticket = ++translationRun.current; const documentTicket = generation.current;
    selectionTranslationAbort.current?.abort(); const controller = new AbortController(); selectionTranslationAbort.current = controller;
    setSelection(null); setTranslationCard({ selection: value, loading: true, text: '', error: '', pinned: false });
    try { const result = await callTool<TranslateResult>('translate_text', { vaultId, text: value.text, to: targetLanguage || undefined }, { signal: controller.signal }); if (!controller.signal.aborted && ticket === translationRun.current && documentTicket === generation.current) setTranslationCard({ selection: value, loading: false, text: result.text, error: '', pinned: false }); }
    catch (cause) { if (!controller.signal.aborted && ticket === translationRun.current && documentTicket === generation.current) setTranslationCard({ selection: value, loading: false, text: '', error: messageOf(cause), pinned: false }); }
    finally { if (selectionTranslationAbort.current === controller) selectionTranslationAbort.current = null; }
  }
  async function pinTranslation() {
    if (!translationCard?.text) return; const card = translationCard; const ticket = generation.current;
    try { await action(() => addSelection(card.selection, 'translate', { result: card.text })); if (ticket === generation.current) setTranslationCard({ ...card, pinned: true }); }
    catch (cause) { setNotice(messageOf(cause)); }
  }
  function selectMark(mark: ReaderMark) {
    setSelectedMark(mark.id); setView(value => ({ ...value, marksOpen: true })); goToPage(mark.page);
    if (mark.kind === 'translate' && (mark.result || mark.note)) {
      selectionTranslationAbort.current?.abort(); translationRun.current += 1;
      const entry = pages.current.get(mark.page); const bounds = entry?.element.getBoundingClientRect();
      setTranslationCard({ selection: { text: mark.quote, parts: [{ page: mark.page, quote: mark.quote, rects: mark.rects, pageSize: { width: entry?.geometry.width ?? 612, height: entry?.geometry.height ?? 792 } }], x: bounds?.left ?? 30, y: bounds?.top ?? 160 }, loading: false, text: mark.result || mark.note, error: '', pinned: true, markId: mark.id });
    }
  }
  async function updateMark(mark: ReaderMark, text: string, color: MarkColor) { const ticket = generation.current; await action(async () => { const next = await callTool<MarkList>('mark_update', { vaultId, paperPath, revision: marksRef.current!.revision, id: mark.id, color, ...(mark.kind === 'translate' ? { result: text } : { comment: text }) }); if (ticket === generation.current) { marksRef.current = next; setMarks(next); setNotice('批注已更新。'); } }); }
  async function deleteMark(mark: ReaderMark) { const ticket = generation.current; await action(async () => { const next = await callTool<MarkList>('mark_delete', { vaultId, paperPath, revision: marksRef.current!.revision, id: mark.id }); if (ticket === generation.current) { marksRef.current = next; setMarks(next); setSelectedMark(null); if (translationCard?.markId === mark.id) setTranslationCard(null); } }); }
  async function replyMark(mark: ReaderMark, text: string) { const ticket = generation.current; await action(async () => { const next = await callTool<MarkList>('mark_update', { vaultId, paperPath, revision: marksRef.current!.revision, id: mark.id, reply: { role: 'user', content: text } }); if (ticket === generation.current) { marksRef.current = next; setMarks(next); } }); }

  async function saveBookmarks(nodes: BookmarkNode[]) {
    const ticket = generation.current;
    await action(async () => { await persistView(); const result = await callTool<WriteBookmarksResult>('pdf_bookmarks_write', { vaultId, paperPath, revision: pdfRevision.current, nodes }); if (ticket === generation.current) { pdfRevision.current = result.revision; reloadNotice.current = 'PDF 目录已写回。'; setLoadRevision(value => value + 1); setNotice(reloadNotice.current); } });
  }
  async function exportPaper(format: 'pdf' | 'markdown' | 'json') {
    if (!paper) return;
    try {
      const filename = `${paper.path.split('/').at(-1) || 'paper'}-annotations.${format === 'markdown' ? 'md' : format}`;
      const picker = await callTool<{ cancelled: boolean; paths: string[] }>('file_picker', { mode: 'save-file', title: '导出论文与批注', defaultPath: filename, filters: [{ name: format === 'pdf' ? 'PDF' : format === 'markdown' ? 'Markdown' : 'JSON', extensions: [format === 'markdown' ? 'md' : format] }] });
      if (picker.cancelled || !picker.paths[0]) return;
      await action(async () => { const result = await callTool<ExportResult>('paper_export', { vaultId, paperPath, format, includeMarks: true, filePath: picker.paths[0], revision: pdfRevision.current }); setNotice(`已导出到 ${result.savedPath ?? picker.paths[0]}`); });
    } catch (cause) { setNotice(messageOf(cause)); }
  }

  async function search() {
    if (!document || !query.trim()) return;
    const ticket = ++searchRun.current; const needle = query.trim(); setSearchBusy(true); setHits([]); setHitIndex(-1);
    const found: SearchHit[] = [];
    try {
      for (let number = 1; number <= document.numPages; number++) {
        if (ticket !== searchRun.current) return;
        const content = await (await document.getPage(number)).getTextContent();
        const text = content.items.filter((item): item is typeof item & { str: string } => 'str' in item).map(item => item.str).join(' ');
        for (const [ordinal, index] of textMatches(text, needle, 2000 - found.length).entries()) found.push({ page: number, index, ordinal, text: needle, excerpt: text.slice(Math.max(0, index - 32), index + needle.length + 60) });
        if (found.length >= 2000) break;
      }
      if (ticket !== searchRun.current) return;
      locatedHit.current = ''; setHits(found); if (found.length) { setHitIndex(0); goToPage(found[0].page); } else setNotice('没有找到匹配文字；扫描 PDF 可能没有文字层。');
    } catch (cause) { if (ticket === searchRun.current) setNotice(messageOf(cause)); }
    finally { if (ticket === searchRun.current) setSearchBusy(false); }
  }
  function moveHit(delta: number) { if (!hits.length) return; const next = (hitIndex + delta + hits.length) % hits.length; setHitIndex(next); goToPage(hits[next].page); }
  useEffect(() => {
    const target = hits[hitIndex];
    viewport.current?.querySelectorAll('.pdf-search-match,.pdf-current-search-match').forEach(element => element.classList.remove('pdf-search-match', 'pdf-current-search-match'));
    if ('highlights' in CSS) { CSS.highlights.delete('pdf-search-hits'); CSS.highlights.delete('pdf-current-hit'); }
    if (!target || !active) return;
    const ranges: Range[] = []; let current: Range | undefined;
    for (const [number, entry] of pages.current) {
      const layer = entry.element.querySelector('.textLayer'); if (!layer) continue;
      const matches = textLayerMatches(layer, target.text); ranges.push(...matches);
      if (number === target.page) current = matches[target.ordinal];
      if (!('highlights' in CSS)) for (const span of layer.querySelectorAll('span[role="presentation"]')) if (span.textContent?.toLocaleLowerCase().includes(target.text.toLocaleLowerCase())) span.classList.add('pdf-search-match');
    }
    if ('highlights' in CSS && typeof Highlight !== 'undefined') { CSS.highlights.set('pdf-search-hits', new Highlight(...ranges)); if (current) CSS.highlights.set('pdf-current-hit', new Highlight(current)); }
    const key = `${generation.current}:${target.page}:${target.index}`;
    if (current && viewport.current && locatedHit.current !== key) { const rect = current.getBoundingClientRect(); const bounds = viewport.current.getBoundingClientRect(); viewport.current.scrollTop += rect.top - bounds.top - viewport.current.clientHeight / 3; locatedHit.current = key; }
  }, [hits, hitIndex, scale, active, renderRevision]);

  useEffect(() => {
    if (!active) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('.pdf-notes-sidebar')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); setSearchOpen(true); requestAnimationFrame(() => searchInput.current?.focus()); return; }
      if (event.key === 'Escape') { setSelection(null); setTranslationCard(null); selectionTranslationAbort.current?.abort(); setCrop(false); setSearchOpen(false); translationRun.current += 1; return; }
      if (editable(event.target)) return;
      if ((event.ctrlKey || event.metaKey) && ['+', '=', '-', '0'].includes(event.key)) { event.preventDefault(); zoom(event.key === '0' ? 1 : scale + (event.key === '-' ? -.1 : .1), event.key === '0'); return; }
      if ((event.key === ' ' || event.code === 'Space') && !(event.target instanceof Element && event.target.closest('button,a,[role="button"]'))) { event.preventDefault(); setSpace(true); }
      if (event.key === 'PageDown') { event.preventDefault(); goToPage(viewRef.current.pageNumber + 1); }
      if (event.key === 'PageUp') { event.preventDefault(); goToPage(viewRef.current.pageNumber - 1); }
    };
    const disarm = () => { setSpace(false); panning.current = null; }; const keyup = (event: KeyboardEvent) => { if (event.code === 'Space' || event.key === ' ') disarm(); };
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', disarm);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', disarm); };
  }, [active, scale, goToPage]);
  function panStart(event: React.PointerEvent<HTMLDivElement>) { if (!viewport.current || editable(event.target) || (event.button !== 1 && !(space && event.button === 0))) return; event.preventDefault(); event.stopPropagation(); panning.current = { x: event.clientX, y: event.clientY, left: viewport.current.scrollLeft, top: viewport.current.scrollTop, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); }
  function panMove(event: React.PointerEvent<HTMLDivElement>) { if (!panning.current || !viewport.current) return; event.preventDefault(); const value = panning.current; value.moved ||= Math.abs(event.clientX - value.x) + Math.abs(event.clientY - value.y) > 3; viewport.current.scrollLeft = value.left - (event.clientX - value.x); viewport.current.scrollTop = value.top - (event.clientY - value.y); }
  function panEnd(event: React.PointerEvent<HTMLDivElement>) { if (panning.current) { if (panning.current.moved) justPanned.current = Date.now() + 250; panning.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } else captureSelection(); }
  const inlineNotesTarget = useRef<{ paperPath: string }>({ paperPath });
  if (inlineNotesTarget.current.paperPath !== paperPath) inlineNotesTarget.current = { paperPath };

  if (!paper) return <div className="empty-state reader-empty"><BookOpen size={34} /><strong>打开一篇文献开始阅读</strong><span>选择文字以高亮、备注、翻译或向所属对话提问。</span><button onClick={onBack}>返回文献库</button></div>;
  if (preview) return <div className="empty-state reader-empty"><FileText size={30} /><strong>{paper.title}</strong><span>这是界面预览，不连接真实 PDF 或标注数据。</span><button onClick={onBack}>返回演示列表</button></div>;

  return <section ref={host} className="reader-view view-fill parity-reader" aria-label="PDF 阅读器">
    <header className="reader-heading"><strong title={paper.title}>{paper.title}</strong><div className="button-row"><button className={view.notesOpen ? 'selected' : ''} disabled={noteDirty} onClick={() => setView(value => ({ ...value, notesOpen: !value.notesOpen }))}><NotebookPen size={14} />论文笔记</button><button disabled={!canParse || busy} title={canParse ? '写入派生正文，作为独立后台任务执行' : '原生解析需要 PDFium'} onClick={() => { void callTool<LibraryOperation>('paper_parse', { vaultId, paperPath }).then(onOperation).catch(cause => setNotice(messageOf(cause))); }}>解析正文</button><button disabled={!document || busy} onClick={() => void exportPaper('pdf')}><Download size={14} />导出</button></div></header>
    <div className="reader-toolbar pdf-parity-toolbar"><button className={`icon-button ${view.outlineOpen ? 'selected' : ''}`} aria-label="显示目录" aria-pressed={view.outlineOpen} disabled={!document} onClick={() => setView(value => ({ ...value, outlineOpen: !value.outlineOpen }))}><List size={17} /></button><button className={`icon-button ${view.marksOpen ? 'selected' : ''}`} aria-label="显示批注" aria-pressed={view.marksOpen} disabled={!document} onClick={() => setView(value => ({ ...value, marksOpen: !value.marksOpen }))}><MessageSquare size={16} /></button><button className="icon-button" aria-label="查找 PDF 文字" disabled={!document} onClick={() => { setSearchOpen(value => !value); requestAnimationFrame(() => searchInput.current?.focus()); }}><Search size={17} /></button><button className={`icon-button ${crop ? 'selected' : ''}`} aria-label="截取 PDF 区域" aria-pressed={crop} disabled={!document} onClick={() => { setCrop(value => !value); setSelection(null); }}><Crop size={17} /></button><button className={`icon-button ${translationOpen ? 'selected' : ''}`} aria-label={translationOpen ? '显示原文' : '全文翻译'} aria-pressed={translationOpen} disabled={!document} onClick={() => { setSelection(null); setTranslationOpen(value => !value); }}><Languages size={17} /></button><select aria-label="翻译目标语言" value={targetLanguage} onChange={event => setTargetLanguage(event.target.value)}><option value="">按插件设置</option><option value="zh-CN">简体中文</option><option value="en">English</option><option value="ja">日本語</option><option value="de">Deutsch</option><option value="fr">Français</option></select><span className="toolbar-spacer" /><button className="icon-button" aria-label="旋转 PDF" disabled={!document} onClick={() => { rememberPosition(); setView(value => ({ ...value, rotation: (value.rotation + 90) % 360 })); }}><RotateCw size={16} /></button><button className="icon-button" aria-label="切换黑白纸色" title={view.tone === 'white' ? '切换黑色纸张' : '切换白色纸张'} onClick={() => setView(value => ({ ...value, tone: value.tone === 'white' ? 'dark' : 'white' }))}><Palette size={16} /></button><button className="icon-button" aria-label="缩小" disabled={!document || scale <= .35} onClick={() => zoom(scale - .15)}><ZoomOut size={17} /></button><span className="zoom-label">{Math.round(scale * 100)}%</span><button className="icon-button" aria-label="放大" disabled={!document || scale >= 3} onClick={() => zoom(scale + .15)}><ZoomIn size={17} /></button><button disabled={!document} className={view.fit ? 'selected' : ''} onClick={() => zoom(1, true)}>适合宽度</button></div>
    {searchOpen && <form className="pdf-find" onSubmit={event => { event.preventDefault(); void search(); }}><input ref={searchInput} aria-label="PDF 查找文字" placeholder="查找 PDF 文字" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && hits.length && query === hits[0]?.text) { event.preventDefault(); moveHit(event.shiftKey ? -1 : 1); } }} /><button disabled={searchBusy || !query.trim()}>{searchBusy ? <LoaderCircle size={14} className="spin" /> : '查找'}</button><button type="button" aria-label="上一个匹配" disabled={!hits.length} onClick={() => moveHit(-1)}><ChevronLeft size={14} /></button><span>{hits.length ? `${hitIndex + 1}/${hits.length}${hits.length >= 2000 ? '+' : ''}` : ''}</span><button type="button" aria-label="下一个匹配" disabled={!hits.length} onClick={() => moveHit(1)}><ChevronRight size={14} /></button><button type="button" className="icon-button" aria-label="关闭查找" onClick={() => { setSearchOpen(false); searchRun.current += 1; }}><X size={15} /></button></form>}
    {translationOpen && <div className="pdf-translation-status" role="status"><Languages size={14} /><span>{translated.running ? translated.progress || '准备全文翻译…' : translated.error || translated.progress || '逐页翻译当前文档'}</span>{translated.running && <LoaderCircle size={14} className="spin" />}{translated.error && <button onClick={translated.retry}>重试未完成段落</button>}<button onClick={() => setTranslationOpen(false)}>{translated.running ? '停止并显示原文' : '显示原文'}</button></div>}
    {crop && <p className="inline-notice">在页面上拖出区域，添加截图备注。按 Esc 退出。</p>}{notice && <p className="inline-notice" role="status">{notice}</p>}{error && <p className="callout error" role="alert">{error}</p>}
    {passwordRequired && <form className="pdf-password" onSubmit={event => { event.preventDefault(); passwordUpdate.current?.(password); setPassword(''); }}><label>PDF 密码<input type="password" autoFocus autoComplete="off" value={password} onChange={event => setPassword(event.target.value)} /></label><button className="primary">解锁</button>{passwordWrong && <span className="error-text">密码不正确，请重试。</span>}</form>}
    <div className="reader-body pdf-parity-body">
      {view.outlineOpen && document && <OutlinePanel document={document} currentPage={view.pageNumber} busy={busy} onNavigate={(dest, page) => { void navigate(dest, undefined, page); }} onSave={saveBookmarks} onClose={() => setView(value => ({ ...value, outlineOpen: false }))} />}
      <div ref={viewport} className={`pdf-viewport parity-viewport ${space ? 'pan-armed' : ''}`} onScroll={scroll} onPointerDownCapture={panStart} onPointerMove={panMove} onPointerUp={panEnd} onPointerCancel={() => { panning.current = null; }} onKeyUp={captureSelection} onClickCapture={event => { if (Date.now() < justPanned.current) { event.preventDefault(); event.stopPropagation(); } }}>
        {loading && <div className="empty-state"><LoaderCircle className="spin" /><strong>正在读取 PDF…</strong><span>{progress}</span></div>}
        {document && <div className="pdf-continuous-pages">{Array.from({ length: document.numPages }, (_, index) => <PageView key={`${loadRevision}:${index}`} document={document} number={index + 1} active={active} scale={scale} fitWidth={view.fit ? availablePageWidth : undefined} rotation={view.rotation} tone={view.tone} estimate={estimate} viewportRef={viewport} marks={marks?.items ?? []} selectedMark={selectedMark} cards={showCards} crop={crop} translated={translationOpen ? translated.pages.get(index + 1) : undefined} onReady={registerPage} onRendered={onPageRendered} onMark={selectMark} onDestination={(destination, action) => { void navigate(destination, action); }} onExternal={url => { void openExternalLink(url).catch(cause => setNotice(messageOf(cause))); }} onVisual={(value: VisualSelection) => { setCrop(false); setSelection({ text: value.quote, parts: [{ page: value.page, quote: value.quote, rects: value.rects, pageSize: value.pageSize }], x: value.x, y: value.y, asset: value.asset }); }} />)}</div>}
      </div>
      {view.marksOpen && <MarksPanel list={marks} selectedId={selectedMark} busy={busy} error={markError} onSelect={selectMark} onSave={updateMark} onDelete={deleteMark} onReply={replyMark} onRefresh={() => { void refreshMarks(); }} onExport={format => { void exportPaper(format); }} onClose={() => setView(value => ({ ...value, marksOpen: false }))} />}
      {view.notesOpen && <aside className="pdf-notes-sidebar" aria-label="论文笔记侧栏"><header className="pdf-panel-heading"><strong>论文笔记</strong><button disabled={noteDirty} title={noteDirty ? '请先保存或处理当前草稿' : '单独打开笔记页'} onClick={() => onNotes(paper)}>单独打开</button><button className="icon-button" disabled={noteDirty} aria-label="关闭论文笔记" onClick={() => setView(value => ({ ...value, notesOpen: false }))}><X size={14} /></button></header><NotesView active={active && view.notesOpen} vaultId={vaultId} preview={preview} requestedTarget={inlineNotesTarget.current} onDirtyChange={setNoteDirty} /></aside>}
    </div>
    <footer className="reader-footer pdf-parity-footer"><button className="icon-button" aria-label="上一页" disabled={!document || view.pageNumber <= 1} onClick={() => goToPage(view.pageNumber - 1)}><ChevronLeft size={18} /></button><form onSubmit={event => { event.preventDefault(); goToPage(Number.parseInt(pageInput, 10) || 1); }}><input aria-label="PDF 物理页码" inputMode="numeric" value={pageInput} onChange={event => setPageInput(event.target.value.replace(/\D/g, ''))} disabled={!document} /><span>/ {document?.numPages ?? '—'}</span></form><button className="icon-button" aria-label="下一页" disabled={!document || view.pageNumber >= document.numPages} onClick={() => goToPage(view.pageNumber + 1)}><ChevronRight size={18} /></button><span className="muted">物理页</span><input type="range" aria-label="PDF 缩放" min={35} max={300} step={1} value={Math.round(scale * 100)} onChange={event => zoom(Number(event.target.value) / 100)} disabled={!document} /><button className={cards ? 'selected' : ''} onClick={() => { rememberPosition(); setCards(value => !value); }} aria-pressed={showCards} title={cards && !showCards ? "面板较窄，页边备注会在放宽后显示" : "显示或隐藏页边备注"}>页边备注</button></footer>
    {selection && <SelectionToolbar key={`${selection.parts[0]?.page}:${selection.x}:${selection.y}:${selection.text}`} selection={selection} busy={busy} canSend={canSend} onCopy={() => { void copy(selection.text, '选区'); }} onMark={(color, comment, underline) => { void highlight(color, comment, underline); }} onTranslate={() => { void translateSelection(); }} onAsk={question => { void ask(question); }} onClose={() => setSelection(null)} />}
    {translationCard && <TranslationCard value={translationCard} busy={busy} onPin={() => { void pinTranslation(); }} onClose={() => { setTranslationCard(null); selectionTranslationAbort.current?.abort(); translationRun.current += 1; }} onRetry={() => { void translateSelection(translationCard.selection); }} onCopy={() => { void copy(translationCard.text, '译文'); }} />}
  </section>;
}
