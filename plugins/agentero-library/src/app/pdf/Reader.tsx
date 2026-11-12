import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, ChevronLeft, ChevronRight, Crop, FileText, Languages, LoaderCircle, MoreHorizontal, Upload, X } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { LibraryOperation, Paper, PdfChunk } from '../../contracts/types';
import type { BookmarkNode, ExportResult, MarkColor, MarkList, ReaderMark, TranslateResult, WriteBookmarksResult } from '../../contracts/reader';
import { callTool } from '../api';
import { attachReadingContext, openExternalLink, registerBeforeTeardown } from '../bridge';
import { formatBytes, messageOf, PDF_CHUNK_BYTES, readPdfChunks } from '../model';
import { NotesView } from '../NotesView';
import { createPdfWorker, pdfjs } from '../pdf-runtime';
import { PageView, type RegisteredPage, type VisualSelection } from './PageView';
import { MarksPanel, OutlinePanel, SelectionToolbar, TranslationCard, type FloatingTranslation, type ReaderSelection } from './ReaderPanels';
import { fitPageScale, screenRectToPoints, usefulRects } from './geometry';
import { textLayerMatches, textMatches } from './search';
import { useDocumentTranslation } from './translation/useDocumentTranslation';
import { abortable, MAX_CANVAS_PIXELS, MAX_IMAGE_PIXELS, timeBudget, yieldToHost } from './scheduling';
import { PageAnchorCoordinator, pageAtOffset, pageSlots, pageWindow, type PageSize } from './virtualization';
import { INITIAL_READER_VIEW, openReaderPanel, readingPreferences, restoreReadingPreferences, toggleReaderPanel, type ReaderViewState } from './reader-layout';
import { ReaderHud, ReaderLanguageSetting, ReaderTools, TranslationLanguage, type ReaderToolActions, type ReaderToolState } from './ReaderTools';
import { MARK_PIN_GUTTER } from './mark-pins';
import { NotesSplitter, useNotesPaneLayout } from './NotesSplitter';
import { textSelectionRects } from './NativeSelectionLayer';
import { selectedMarkSummary } from './mark-selection';
import type { MarkBatchAction, MarkBatchTarget } from './MarkContextTarget';
import 'pdfjs-dist/web/pdf_viewer.css';
import './reader.css';

interface Props {
  active: boolean; vaultId: string; paper: Paper | null; preview: boolean; canSend: boolean; canParse: boolean;
  onNotes(paper: Paper, notePath?: string): void; onOperation(operation: LibraryOperation): void; onBack(): void;
  onPaperMarkdown?(paper: Paper): void;
  onDirtyChange?(dirty: boolean): void;
  readerToolsHost?: HTMLElement | null;
  sidebarCollapsed?: boolean;
  requestedPage?: number; requestedMarkId?: string; requestKey?: number | string;
}
type ReaderState = ReaderViewState;
const initialView = INITIAL_READER_VIEW;
interface SearchHit { page: number; index: number; ordinal: number; text: string; excerpt: string }
const editable = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]'));
const EMPTY_MARKS: ReaderMark[] = [];
interface PdfSession { status: 'loading' | 'ready' | 'failed'; dispose(): void }

export function PdfReader({ active, vaultId, paper, preview, canSend, canParse, onNotes, onOperation, onBack, onDirtyChange, onPaperMarkdown, readerToolsHost = null, sidebarCollapsed = false, requestedPage, requestedMarkId, requestKey }: Props) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null); const [loadRevision, setLoadRevision] = useState(0);
  const [loading, setLoading] = useState(false); const [progress, setProgress] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [view, setView] = useState<ReaderState>(initialView); const [viewReady, setViewReady] = useState(false);
  const viewRef = useRef(view); viewRef.current = view;
  const [pageInput, setPageInput] = useState('1'); const [estimate, setEstimate] = useState({ width: 612, height: 792 }); const [containerWidth, setContainerWidth] = useState(700);
  const estimateRef = useRef(estimate); estimateRef.current = estimate;
  const [fitPageWidth, setFitPageWidth] = useState(612);
  const [sizeRevision, setSizeRevision] = useState(0); const knownSizes = useRef(new Map<number, PageSize>());
  const [windowRange, setWindowRange] = useState({ start: 0, end: 3 });
  const [failedPages, setFailedPages] = useState<ReadonlyMap<number, string>>(new Map());
  const [marks, setMarks] = useState<MarkList | null>(null); const marksRef = useRef(marks); marksRef.current = marks;
  const [markError, setMarkError] = useState(''); const [selectedMark, setSelectedMark] = useState<string | null>(null); const [busy, setBusy] = useState(false); const busyRef = useRef(false);
  const [checkedMarks, setCheckedMarks] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<ReaderSelection | null>(null); const [translationCard, setTranslationCard] = useState<FloatingTranslation | null>(null);
  const [translationOpen, setTranslationOpen] = useState(false); const [targetLanguage, setTargetLanguage] = useState(''); const translationRun = useRef(0);
  const selectionTranslationAbort = useRef<AbortController | null>(null); const reloadNotice = useRef<string | null>(null);
  const [cards, setCards] = useState(false); const [crop, setCrop] = useState(false); const [noteDirty, setNoteDirty] = useState(false); const [space, setSpace] = useState(false);
  const [notesMounted, setNotesMounted] = useState(false); const [moreOpen, setMoreOpen] = useState(false); const moreRoot = useRef<HTMLDivElement>(null);
  const [searchOpen, setSearchOpen] = useState(false); const [query, setQuery] = useState(''); const [searchBusy, setSearchBusy] = useState(false); const [hits, setHits] = useState<SearchHit[]>([]); const [hitIndex, setHitIndex] = useState(-1);
  const [renderRevision, setRenderRevision] = useState(0); const locatedHit = useRef('');
  const onPageRendered = useCallback(() => setRenderRevision(value => value + 1), []);
  const [passwordRequired, setPasswordRequired] = useState(false); const [passwordWrong, setPasswordWrong] = useState(false); const [password, setPassword] = useState('');
  const passwordUpdate = useRef<((password: string) => void) | null>(null); const searchInput = useRef<HTMLInputElement>(null);
  const host = useRef<HTMLElement>(null); const viewport = useRef<HTMLDivElement>(null); const pages = useRef(new Map<number, RegisteredPage>());
  const body = useRef<HTMLDivElement>(null); const notesLayout = useNotesPaneLayout(body, Boolean(paper && !preview));
  const generation = useRef(0); const pdfRevision = useRef(''); const searchRun = useRef(0); const stateSave = useRef<Promise<unknown>>(Promise.resolve());
  const stateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeRef = useRef(active); activeRef.current = active;
  const session = useRef<PdfSession | null>(null); const startDocument = useRef<(() => void) | null>(null);
  const scrollFrame = useRef(0); const sizeFrame = useRef(0); const searchAbort = useRef<AbortController | null>(null);
  const resizeFrame = useRef(0); const measuredWidth = useRef(0);
  const panning = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null); const justPanned = useRef(0);
  const restore = useRef(new PageAnchorCoordinator()); const [navigationRevision, setNavigationRevision] = useState(0); const pendingAnchor = useRef<{ page: number; point: number[] } | null>(null);
  const showCards = cards && containerWidth >= 680;
  const markGutter = showCards ? 226 : MARK_PIN_GUTTER;
  const availablePageWidth = Math.max(1, containerWidth - markGutter);
  const scale = view.fit ? fitPageScale(fitPageWidth, availablePageWidth) : view.zoom;
  const slots = useMemo(() => pageSlots(document?.numPages ?? 0, knownSizes.current, estimate, view.rotation, view.zoom, view.fit ? availablePageWidth : undefined, markGutter), [document, estimate, view.rotation, view.zoom, view.fit, availablePageWidth, markGutter, sizeRevision]);
  const slotsRef = useRef(slots); slotsRef.current = slots;
  const paperPath = paper?.path ?? '';
  useEffect(() => { setCheckedMarks(new Set()); }, [vaultId, paperPath]);
  const translated = useDocumentTranslation({ document, vaultId, paperPath, open: translationOpen && active, currentPage: view.pageNumber, targetLanguage });

  const refreshMarks = useCallback(async () => {
    if (!paperPath || preview) return;
    const ticket = generation.current;
    try { const next = await callTool<MarkList>('mark_list', { vaultId, paperPath }); if (ticket === generation.current) { marksRef.current = next; setMarks(next); setMarkError(''); } }
    catch (cause) { if (ticket === generation.current) setMarkError(messageOf(cause)); }
  }, [vaultId, paperPath, preview]);

  useEffect(() => {
    let closed = false;
    session.current?.dispose(); session.current = null;
    setLoading(false); setViewReady(false); setError(''); setNotice(reloadNotice.current ?? ''); reloadNotice.current = null; setDocument(null); setMarks(null); marksRef.current = null;
    knownSizes.current.clear(); restore.current.clear(); pendingAnchor.current = null; setFailedPages(new Map()); setSizeRevision(value => value + 1);
    setSelection(null); setTranslationCard(null); setTranslationOpen(false); setHits([]); setHitIndex(-1); setSelectedMark(null); setPasswordRequired(false); pages.current.clear();
    translationRun.current += 1; searchRun.current += 1; selectionTranslationAbort.current?.abort(); searchAbort.current?.abort();
    const start = () => {
      if (closed || !activeRef.current || !paperPath || preview || session.current) return;
      const controller = new AbortController(); const ticket = ++generation.current; const path = paperPath;
      let task: ReturnType<typeof pdfjs.getDocument> | undefined; let worker: Awaited<ReturnType<typeof createPdfWorker>> | undefined;
      let disposed = false;
      const current: PdfSession = { status: 'loading', dispose: () => {
        if (disposed) return; disposed = true; controller.abort(); worker?.dispose(); worker = undefined;
        const previous = task; task = undefined; void previous?.destroy().catch(() => {});
        if (session.current === current) session.current = null;
      } };
      session.current = current; setLoading(true); setError('');
      const fail = (cause: unknown) => {
        if (closed || ticket !== generation.current || controller.signal.aborted) return;
        current.status = 'failed'; setError(messageOf(cause)); setDocument(null); setViewReady(false); setLoading(false);
        current.dispose(); session.current = current; // A failed resource is retried only by an explicit reload.
      };
      const savedState = callTool<{ state?: Partial<ReaderState> }>('reader_state_get', { vaultId, paperPath: path }, { signal: controller.signal }).catch(() => ({ state: {} }));
      void refreshMarks();
      void (async () => {
        worker = await createPdfWorker({ signal: controller.signal, onFailure: fail });
        const bytes = await readPdfChunks(async (offset, revision) => {
          const result = await callTool<PdfChunk>('pdf_read_chunk', { vaultId, paperPath: path, offset, length: PDF_CHUNK_BYTES, revision }, { signal: controller.signal });
          if (offset === 0 && ticket === generation.current) pdfRevision.current = result.revision;
          return result;
        }, { signal: controller.signal, onProgress: (loaded, total) => { if (!controller.signal.aborted) setProgress(`${formatBytes(loaded)} / ${formatBytes(total)}`); } });
        controller.signal.throwIfAborted();
        task = pdfjs.getDocument({ data: bytes, worker: worker.worker, useWorkerFetch: false, useSystemFonts: true, stopAtErrors: true, maxImageSize: MAX_IMAGE_PIXELS, canvasMaxAreaInBytes: MAX_CANVAS_PIXELS * 4 });
        task.onPassword = (update: (value: string) => void, reason: number) => { if (!controller.signal.aborted) { passwordUpdate.current = update; setPasswordWrong(reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD); setPasswordRequired(true); } };
        const pdf = await abortable(task.promise, controller.signal); const state = ((await savedState).state ?? {}) as Partial<ReaderState>;
        controller.signal.throwIfAborted();
        const first = await abortable(pdf.getPage(1), controller.signal); const base = first.getViewport({ scale: 1 });
        controller.signal.throwIfAborted();
        const next = restoreReadingPreferences(state, viewRef.current, pdf.numPages);
        knownSizes.current.set(1, { width: base.width, height: base.height }); setSizeRevision(value => value + 1);
        setEstimate({ width: base.width, height: base.height }); setFitPageWidth(next.rotation % 180 ? base.height : base.width); setView(next); viewRef.current = next; setPageInput(String(next.pageNumber)); restore.current.navigate(next.pageNumber);
        setWindowRange({ start: Math.max(0, next.pageNumber - 3), end: Math.min(pdf.numPages - 1, next.pageNumber + 2) });
        current.status = 'ready'; setDocument(pdf); setViewReady(true); setPasswordRequired(false); setLoading(false);
      })().catch(cause => { if (!controller.signal.aborted) fail(cause); });
    };
    startDocument.current = start; start();
    return () => { closed = true; startDocument.current = null; session.current?.dispose(); session.current = null; generation.current += 1; searchRun.current += 1; translationRun.current += 1; selectionTranslationAbort.current?.abort(); searchAbort.current?.abort(); passwordUpdate.current = null; };
  }, [vaultId, paperPath, preview, loadRevision, refreshMarks]);

  useEffect(() => {
    if (active) startDocument.current?.();
    else {
      searchAbort.current?.abort(); searchRun.current += 1; setSearchBusy(false); selectionTranslationAbort.current?.abort(); translationRun.current += 1;
      if (session.current?.status === 'loading') { session.current.dispose(); setLoading(false); setViewReady(false); setDocument(null); }
    }
  }, [active]);
  useEffect(() => registerBeforeTeardown(async () => { searchAbort.current?.abort(); session.current?.dispose(); session.current = null; }), []);

  useEffect(() => {
    if (!active || !document || !view.fit) return;
    let cancelled = false;
    // Only current-page metadata is requested; PDF.js caches already visited pages.
    void document.getPage(view.pageNumber).then(page => {
      if (!cancelled) setFitPageWidth(page.getViewport({ scale: 1, rotation: (page.rotate + view.rotation) % 360 }).width);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [document, view.fit, view.pageNumber, view.rotation, active]);

  useEffect(() => {
    if (!active || !viewport.current) return;
    let pendingWidth = measuredWidth.current;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width <= 0) return;
      const pixelRatio = window.devicePixelRatio || 1; pendingWidth = Math.round(entry.contentRect.width * pixelRatio) / pixelRatio;
      if (Math.abs(pendingWidth - measuredWidth.current) < .5 || resizeFrame.current) return;
      resizeFrame.current = requestAnimationFrame(() => { resizeFrame.current = 0; if (!activeRef.current || Math.abs(pendingWidth - measuredWidth.current) < .5) return; if (viewRef.current.fit) rememberPosition(); measuredWidth.current = pendingWidth; setContainerWidth(pendingWidth); });
    });
    observer.observe(viewport.current); return () => { observer.disconnect(); cancelAnimationFrame(resizeFrame.current); resizeFrame.current = 0; };
  }, [document, active]);

  const applyPageAnchor = useCallback((number: number, ratio = 0) => {
    if (!document || !viewport.current) return;
    const next = Math.min(document.numPages, Math.max(1, number)); const slot = slotsRef.current[next - 1];
    if (slot) {
      const contentTop = viewport.current.querySelector<HTMLElement>('.pdf-continuous-pages')?.offsetTop ?? 0;
      const top = Math.max(0, contentTop + slot.top + slot.height * ratio - 16);
      setWindowRange(pageWindow(slotsRef.current, Math.max(0, top - contentTop), viewport.current.clientHeight));
      viewRef.current = { ...viewRef.current, pageNumber: next };
      viewport.current.scrollTo({ top, behavior: 'auto' }); setView(value => value.pageNumber === next ? value : { ...value, pageNumber: next });
    }
  }, [document]);
  const goToPage = useCallback((number: number, ratio = 0) => {
    if (!document) return;
    const next = Math.min(document.numPages, Math.max(1, number));
    cancelAnimationFrame(scrollFrame.current); scrollFrame.current = 0;
    pendingAnchor.current = null;
    restore.current.navigate(next, ratio); viewRef.current = { ...viewRef.current, pageNumber: next };
    applyPageAnchor(next, ratio); setNavigationRevision(value => value + 1);
  }, [document, applyPageAnchor]);
  useEffect(() => {
    if (!document || !active || (!requestedPage && !requestedMarkId)) return;
    const mark = requestedMarkId ? marksRef.current?.items.find(item => item.id === requestedMarkId) : undefined;
    if (requestedPage || mark) goToPage(requestedPage ?? mark!.page);
    if (requestedMarkId) { setSelectedMark(requestedMarkId); setView(value => openReaderPanel(value, 'marksOpen')); }
  }, [document, active, requestedPage, requestedMarkId, requestKey, goToPage]);
  const layoutScale = view.fit ? availablePageWidth : view.zoom;
  useEffect(() => {
    if (!document || !active) return;
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => { const pending = restore.current.pending; const target = pending ?? { page: viewRef.current.pageNumber, ratio: 0 }; applyPageAnchor(target.page, target.ratio); if (pending) restore.current.settle(pending.sequence); }); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [document, layoutScale, view.fit, view.rotation, active, applyPageAnchor, sizeRevision, navigationRevision]);
  useEffect(() => { setPageInput(String(view.pageNumber)); }, [view.pageNumber]);

  const registerPage = useCallback((number: number, entry: RegisteredPage | null) => {
    if (entry) {
      pages.current.set(number, entry);
      const base = entry.page.getViewport({ scale: 1, rotation: entry.page.rotate }); const before = knownSizes.current.get(number) ?? estimateRef.current;
      knownSizes.current.set(number, { width: base.width, height: base.height });
      if (Math.abs(before.width - base.width) > .01 || Math.abs(before.height - base.height) > .01) {
        rememberPosition();
        if (!sizeFrame.current) sizeFrame.current = requestAnimationFrame(() => { sizeFrame.current = 0; setSizeRevision(value => value + 1); });
      }
      const pending = pendingAnchor.current;
      if (pending?.page === number && viewport.current) {
        const point = entry.geometry.viewport.convertToViewportPoint(pending.point[0], pending.point[1]); const sheet = entry.element.closest<HTMLElement>('[data-sheet-page]');
        if (sheet) { restore.current.navigate(number, Math.max(0, point[1] / entry.geometry.viewport.height)); setNavigationRevision(value => value + 1); pendingAnchor.current = null; }
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
      goToPage(target);
      if (value[1]?.name === 'XYZ' && typeof value[3] === 'number') pendingAnchor.current = { page: target, point: [typeof value[2] === 'number' ? value[2] : 0, value[3]] };
      const existing = pages.current.get(target); if (existing && pendingAnchor.current) registerPage(target, existing);
    } catch (cause) { setNotice(messageOf(cause)); }
  }

  function scroll() {
    if (scrollFrame.current) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = 0;
      const target = viewport.current; const positions = slotsRef.current; if (!target || !activeRef.current || panning.current || restore.current.pending || !positions.length) return;
      const contentTop = target.querySelector<HTMLElement>('.pdf-continuous-pages')?.offsetTop ?? 0;
      const top = Math.max(0, target.scrollTop - contentTop); const number = pageAtOffset(positions, top + Math.min(target.clientHeight * .25, 150)) + 1;
      const next = pageWindow(positions, top, target.clientHeight);
      setWindowRange(value => value.start === next.start && value.end === next.end ? value : next);
      viewRef.current = { ...viewRef.current, pageNumber: number }; setView(value => value.pageNumber === number ? value : { ...value, pageNumber: number });
    });
  }
  function zoom(value: number, fit = false) {
    const next = Math.max(.35, Math.min(3, value)); const current = viewRef.current;
    if (current.fit !== fit || (!fit && current.zoom !== next)) rememberPosition();
    setView(existing => existing.fit === fit && existing.zoom === next ? existing : { ...existing, fit, zoom: next });
  }
  function rememberPosition() {
    if (restore.current.pending) return;
    const parent = viewport.current; const number = viewRef.current.pageNumber; const slot = slotsRef.current[number - 1];
    const contentTop = parent?.querySelector<HTMLElement>('.pdf-continuous-pages')?.offsetTop ?? 0;
    if (parent && slot?.height) restore.current.remember(number, (parent.scrollTop + 16 - contentTop - slot.top) / slot.height);
  }
  useEffect(() => {
    const target = viewport.current; if (!target || !active) return;
    const wheel = (event: WheelEvent) => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); zoom(scale * Math.exp(-event.deltaY * .003)); } };
    target.addEventListener('wheel', wheel, { passive: false }); return () => target.removeEventListener('wheel', wheel);
  }, [active, scale, view.pageNumber]);

  const persistView = useCallback(() => {
    if (!viewReady || !paperPath || preview) return Promise.resolve();
    const state = readingPreferences(viewRef.current); const path = paperPath; const id = vaultId;
    const task = stateSave.current.catch(() => {}).then(() => callTool('reader_state_set', { vaultId: id, paperPath: path, state })); stateSave.current = task;
    return task.catch(() => {});
  }, [viewReady, vaultId, paperPath, preview]);
  useEffect(() => { clearTimeout(stateTimer.current); if (viewReady) stateTimer.current = setTimeout(() => { void persistView(); }, 500); return () => clearTimeout(stateTimer.current); }, [view.pageNumber, view.zoom, view.fit, view.rotation, view.tone, viewReady, persistView]);
  useEffect(() => registerBeforeTeardown(async () => { clearTimeout(stateTimer.current); await persistView(); }), [persistView]);
  useEffect(() => registerBeforeTeardown(async () => { selectionTranslationAbort.current?.abort(); }), []);
  useEffect(() => () => { cancelAnimationFrame(scrollFrame.current); cancelAnimationFrame(sizeFrame.current); cancelAnimationFrame(resizeFrame.current); }, []);
  useEffect(() => { onDirtyChange?.(noteDirty); return () => onDirtyChange?.(false); }, [noteDirty, onDirtyChange]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 6000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    if (!moreOpen) return;
    const close = (event: PointerEvent) => { if (event.target instanceof Node && !moreRoot.current?.contains(event.target)) setMoreOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMoreOpen(false); };
    window.document.addEventListener('pointerdown', close); window.addEventListener('keydown', escape);
    return () => { window.document.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape); };
  }, [moreOpen]);

  function captureSelection() {
    if (crop || panning.current || Date.now() < justPanned.current) return;
    const selected = window.getSelection(); if (!selected || !selected.rangeCount || selected.isCollapsed || !viewport.current) { setSelection(null); return; }
    const range = selected.getRangeAt(0); const quote = selected.toString().trim();
    if (!quote || !viewport.current.contains(range.startContainer) || !viewport.current.contains(range.endContainer)) return;
    const parts: ReaderSelection['parts'] = [];
    for (const [number, entry] of [...pages.current].sort((a, b) => a[0] - b[0])) {
      const layer = entry.element.querySelector('.textLayer'); if (!layer || !range.intersectsNode(layer)) continue;
      const bounds = entry.element.getBoundingClientRect();
      const rects = usefulRects(textSelectionRects(range, layer).filter(rect => rect.width > .2 && rect.height > .2 && rect.right > bounds.left && rect.left < bounds.right && rect.bottom > bounds.top && rect.top < bounds.bottom).map(rect => {
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
  async function ask() {
    if (!selection || !paper || !canSend) return;
    const selected = selection; const ticket = generation.current;
    try { await action(async () => {
      await attachReadingContext({ vaultId, paperPath: paper.path, title: paper.title, pages: selected.parts.map(part => part.page), markIds: [], selection: { text: selected.text, parts: selected.parts, ...(selected.asset ? { asset: selected.asset } : {}) }, action: 'summarize' });
      if (ticket === generation.current) { setSelection(null); window.getSelection()?.removeAllRanges(); setNotice('已附加到输入框，补充要求后发送。'); }
    }); } catch (cause) { setNotice(messageOf(cause)); }
  }
  async function attachMarks(task: MarkBatchAction, ids: string[], target?: MarkBatchTarget) {
    if (!paper || !canSend || !marksRef.current) throw new Error('当前无法附加批注，请刷新后重试。');
    const selected = selectedMarkSummary(marksRef.current.items, new Set(ids));
    if (!selected.items.length || selected.items.length !== new Set(ids).size) throw new Error('部分所选批注已变化，请刷新并检查已选来源。');
    const revision = marksRef.current.revision; const ticket = generation.current;
    await action(async () => { await attachReadingContext({ vaultId, paperPath: paper.path, title: paper.title, pages: selected.pages, markIds: selected.items.map(mark => mark.id), marksRevision: revision, action: task, ...target }); if (ticket === generation.current) setNotice('已附加到输入框，补充要求后发送。'); });
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
    setSelectedMark(mark.id); setView(value => openReaderPanel(value, 'marksOpen')); goToPage(mark.page);
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
    if (!activeRef.current || !document || !query.trim()) return;
    searchAbort.current?.abort(); const controller = new AbortController(); searchAbort.current = controller;
    const { signal } = controller; const checkpoint = timeBudget(signal);
    const ticket = ++searchRun.current; const needle = query.trim(); setSearchBusy(true); setHits([]); setHitIndex(-1);
    const found: SearchHit[] = [];
    try {
      for (let number = 1; number <= document.numPages; number++) {
        await yieldToHost(signal);
        if (ticket !== searchRun.current || !activeRef.current) return;
        const page = await abortable(document.getPage(number), signal); const content = await abortable(page.getTextContent(), signal); signal.throwIfAborted();
        const parts: string[] = [];
        for (let index = 0; index < content.items.length; index++) { const item = content.items[index]; if ('str' in item) parts.push(item.str); if (index % 256 === 0) await checkpoint(); }
        const text = parts.join(' ');
        for (const [ordinal, index] of textMatches(text, needle, 2000 - found.length).entries()) found.push({ page: number, index, ordinal, text: needle, excerpt: text.slice(Math.max(0, index - 32), index + needle.length + 60) });
        if (!pages.current.has(number)) page.cleanup();
        if (found.length >= 2000) break;
      }
      if (ticket !== searchRun.current) return;
      locatedHit.current = ''; setHits(found); if (found.length) { setHitIndex(0); goToPage(found[0].page); } else setNotice('没有找到匹配文字；扫描 PDF 可能没有文字层。');
    } catch (cause) { if (!signal.aborted && ticket === searchRun.current) setNotice(messageOf(cause)); }
    finally { if (searchAbort.current === controller) { searchAbort.current = null; setSearchBusy(false); } }
  }
  function cancelSearch() { searchAbort.current?.abort(); searchAbort.current = null; searchRun.current += 1; setSearchBusy(false); }
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
      if (event.key === 'Escape') { setSelection(null); setTranslationCard(null); selectionTranslationAbort.current?.abort(); setCrop(false); setSearchOpen(false); cancelSearch(); translationRun.current += 1; return; }
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
  function panEnd(event: React.PointerEvent<HTMLDivElement>) { if (panning.current) { if (panning.current.moved) justPanned.current = Date.now() + 250; panning.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); scroll(); } else if (!(event.target instanceof Element && event.target.closest('button,input,textarea,select'))) captureSelection(); }
  const inlineNotesTarget = useRef<{ paperPath: string }>({ paperPath });
  if (inlineNotesTarget.current.paperPath !== paperPath) inlineNotesTarget.current = { paperPath };
  const pageActions = useRef({ selectMark, navigate, updateMark }); pageActions.current = { selectMark, navigate, updateMark };
  const onPageMark = useCallback((mark: ReaderMark) => pageActions.current.selectMark(mark), []);
  const onPageSaveComment = useCallback((mark: ReaderMark, text: string) => pageActions.current.updateMark(mark, text, mark.color ?? 'yellow'), []);
  const onPageDestination = useCallback((destination: unknown, action?: string) => { void pageActions.current.navigate(destination, action); }, []);
  const onPageExternal = useCallback((url: string) => { void openExternalLink(url).catch(cause => setNotice(messageOf(cause))); }, []);
  const onPageVisual = useCallback((value: VisualSelection) => { setCrop(false); setSelection({ text: value.quote, parts: [{ page: value.page, quote: value.quote, rects: value.rects, pageSize: value.pageSize }], x: value.x, y: value.y, asset: value.asset }); }, []);
  const onPageFailure = useCallback((number: number, message: string) => { setFailedPages(value => new Map(value).set(number, message)); setError(message); }, []);
  async function openSystemViewer() { try { await callTool('paper_open_external', { vaultId, paperPath }); setNotice('已向系统默认查看器发送打开请求。'); } catch (cause) { setNotice(messageOf(cause)); } }

  function toggleNotes() { setNotesMounted(true); setView(value => toggleReaderPanel(value, 'notesOpen')); }
  function toggleSearch() { if (searchOpen) cancelSearch(); setSearchOpen(value => !value); requestAnimationFrame(() => searchInput.current?.focus()); }
  const toolState: ReaderToolState = {
    ready: Boolean(document), hasPaper: Boolean(paper), page: view.pageNumber, total: document?.numPages ?? 0, pageInput, scale, fit: view.fit, tone: view.tone,
    outlineOpen: view.outlineOpen, searchOpen, marksOpen: view.marksOpen, notesOpen: view.notesOpen, notesDirty: noteDirty,
    translationOpen, translating: translationOpen && translated.running, cards, targetLanguage,
  };
  const toolActions: ReaderToolActions = {
    toggleOutline: () => setView(value => toggleReaderPanel(value, 'outlineOpen')), toggleSearch,
    toggleMarks: () => setView(value => toggleReaderPanel(value, 'marksOpen')), toggleNotes,
    toggleTranslation: () => { setSelection(null); setTranslationOpen(value => !value); },
    toggleCards: () => { if (viewRef.current.fit) rememberPosition(); setCards(value => !value); },
    pageInput: setPageInput, goToPage: () => goToPage(Number.parseInt(pageInput, 10) || viewRef.current.pageNumber),
    previous: () => goToPage(view.pageNumber - 1), next: () => goToPage(view.pageNumber + 1), zoom: value => zoom(value), fit: () => zoom(1, true),
    rotate: () => { rememberPosition(); setView(value => ({ ...value, rotation: (value.rotation + 90) % 360 })); },
    tone: () => setView(value => ({ ...value, tone: value.tone === 'white' ? 'dark' : 'white' })), targetLanguage: setTargetLanguage,
  };
  const toolsPortal = readerToolsHost ? createPortal(<ReaderTools state={toolState} actions={toolActions} collapsed={sidebarCollapsed} />, readerToolsHost, 'reader-tools') : null;
  if (!paper) return <>{toolsPortal}<div className="empty-state reader-empty"><BookOpen size={34} /><strong>打开一篇文献开始阅读</strong><span>选择文字以高亮、备注、翻译或向所属对话提问。</span><button onClick={onBack}>返回文献库</button></div></>;
  if (preview) return <>{toolsPortal}<div className="empty-state reader-empty"><FileText size={30} /><strong>{paper.title}</strong><span>这是界面预览，不连接真实 PDF 或标注数据。</span><button onClick={onBack}>返回演示列表</button></div></>;
  const leaf = paper.path.split('/').at(-1) || paper.title; const documentName = leaf.toLowerCase().endsWith('.pdf') ? leaf : leaf + '.pdf';
  const showHud = sidebarCollapsed || !readerToolsHost;
  return <section ref={host} className="reader-view view-fill parity-reader reader-sidebar-layout" aria-label="PDF 阅读器">
    {toolsPortal}
    <header className="reader-document-header" data-reader-header="true"><strong title={paper.title}>{documentName}</strong><div className="reader-document-header__actions"><button aria-label="导出 PDF" disabled={busy} onClick={() => void exportPaper('pdf')}><Upload size={14} aria-hidden="true" /><span>导出</span></button><div ref={moreRoot} className="reader-more"><button className="icon-button" aria-label="更多阅读操作" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen(value => !value)}><MoreHorizontal size={18} /></button>{moreOpen && <div className="reader-more__menu" role="menu" aria-label="更多阅读操作">
      <button role="menuitem" disabled={!canParse || busy} title={canParse ? '写入派生正文，作为独立任务执行' : '原生解析需要 PDFium'} onClick={() => { setMoreOpen(false); void callTool<LibraryOperation>('paper_parse', { vaultId, paperPath }).then(onOperation).catch(cause => setNotice(messageOf(cause))); }}>解析正文</button>
      <button role="menuitemcheckbox" aria-checked={crop} disabled={!document} onClick={() => { setMoreOpen(false); setCrop(value => !value); setSelection(null); }}><Crop size={14} />截取区域</button>
      <ReaderLanguageSetting value={targetLanguage} onChange={setTargetLanguage} />
      <button role="menuitem" disabled={busy} onClick={() => { setMoreOpen(false); void exportPaper('markdown'); }}>导出 Markdown 批注</button>
      <button role="menuitem" disabled={busy} onClick={() => { setMoreOpen(false); void exportPaper('json'); }}>导出 JSON 批注</button>
      <button role="menuitem" onClick={() => { setMoreOpen(false); void openSystemViewer(); }}>用系统查看器打开</button>
      <button role="menuitem" disabled={!active || loading} onClick={() => { setMoreOpen(false); setLoadRevision(value => value + 1); }}>重新加载 PDF</button>
    </div>}</div></div></header>
    <div ref={body} className={`reader-body pdf-parity-body ${notesLayout.overlay ? 'reader-notes-overlay-layout' : ''}`}>
      {view.outlineOpen && document && <OutlinePanel document={document} currentPage={view.pageNumber} busy={busy} onNavigate={(dest, page) => { void navigate(dest, undefined, page); }} onSave={saveBookmarks} onClose={() => setView(value => ({ ...value, outlineOpen: false }))} />}
      <div className="reader-stage">
        <div ref={viewport} className={'pdf-viewport parity-viewport ' + (space ? 'pan-armed' : '')} onScroll={scroll} onPointerDownCapture={panStart} onPointerMove={panMove} onPointerUp={panEnd} onPointerCancel={() => { panning.current = null; }} onKeyUp={captureSelection} onClickCapture={event => { if (Date.now() < justPanned.current) { event.preventDefault(); event.stopPropagation(); } }}>
          {loading && <div className="empty-state"><LoaderCircle className="spin" /><strong>正在读取 PDF…</strong><span>{progress}</span></div>}
          {document && <div className="pdf-continuous-pages">{slots.map((slot,index) => <div key={loadRevision+':'+index} className="pdf-page-slot" data-sheet-page={index+1} style={{height:slot.height}}>
            {active && index >= windowRange.start && index <= windowRange.end && !failedPages.has(index+1) ? <PageView document={document} number={index+1} active={active} scale={scale} fitWidth={view.fit ? availablePageWidth : undefined} rotation={view.rotation} tone={view.tone} estimate={estimate} viewportRef={viewport} marks={marks?.items ?? EMPTY_MARKS} selectedMark={selectedMark} cards={showCards} crop={crop} translated={translationOpen ? translated.pages.get(index+1) : undefined} onReady={registerPage} onRendered={onPageRendered} onMark={onPageMark} onSaveComment={onPageSaveComment} onDestination={onPageDestination} onExternal={onPageExternal} onVisual={onPageVisual} onFailure={onPageFailure} /> : <div className="pdf-page-placeholder" style={{width:slot.width,height:slot.height}}>{failedPages.get(index+1) || '第 '+(index+1)+' 页'}</div>}
          </div>)}</div>}
        </div>
        {searchOpen && <form className="reader-search-overlay" role="search" aria-label="PDF 查找" onSubmit={event => { event.preventDefault(); void search(); }}><input ref={searchInput} aria-label="PDF 查找文字" placeholder="查找 PDF 文字" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && hits.length && query === hits[0]?.text) { event.preventDefault(); moveHit(event.shiftKey ? -1 : 1); } }} /><button disabled={searchBusy || !query.trim()}>{searchBusy ? <LoaderCircle size={14} className="spin" /> : '查找'}</button><button type="button" aria-label="上一个匹配" disabled={!hits.length} onClick={() => moveHit(-1)}><ChevronLeft size={14} /></button><span>{hits.length ? (hitIndex + 1) + '/' + hits.length + (hits.length >= 2000 ? '+' : '') : ''}</span><button type="button" aria-label="下一个匹配" disabled={!hits.length} onClick={() => moveHit(1)}><ChevronRight size={14} /></button><button type="button" className="icon-button" aria-label="关闭查找" onClick={() => { setSearchOpen(false); cancelSearch(); }}><X size={15} /></button></form>}
        {translationOpen && <div className={'reader-translation-overlay ' + (searchOpen ? 'below-search' : '')} role="status"><Languages size={14} /><span>{translated.running ? translated.progress || '准备全文翻译…' : translated.error || translated.progress || '逐页翻译当前文档'}</span>{translated.running && <LoaderCircle size={14} className="spin" />}{sidebarCollapsed && <TranslationLanguage value={targetLanguage} onChange={setTargetLanguage} />}{translated.error && <button onClick={translated.retry}>重试</button>}<button onClick={() => setTranslationOpen(false)}>{translated.running ? '停止' : '原文'}</button></div>}
        {(notice || crop) && <div className={'reader-toast ' + (searchOpen || translationOpen ? 'reader-toast--lower' : '')} role="status"><span>{notice || '拖动框选区域，Esc 退出'}</span><button className="icon-button" aria-label="关闭阅读提示" onClick={() => { setNotice(''); if (crop) setCrop(false); }}><X size={13} /></button></div>}
        {error && <div className="reader-error-overlay" role="alert"><p>{error}</p><div className="button-row"><button onClick={() => void openSystemViewer()}>用系统查看器打开</button><button disabled={!active || loading} onClick={() => setLoadRevision(value => value + 1)}>重新加载 PDF</button></div></div>}
        {passwordRequired && <form className="reader-password-overlay" onSubmit={event => { event.preventDefault(); passwordUpdate.current?.(password); setPassword(''); }}><label>PDF 密码<input type="password" autoFocus autoComplete="off" value={password} onChange={event => setPassword(event.target.value)} /></label><button className="primary">解锁</button>{passwordWrong && <span className="error-text">密码不正确，请重试。</span>}</form>}
        {showHud && document && <ReaderHud state={toolState} actions={toolActions} />}
      </div>
      {view.marksOpen && <MarksPanel list={marks} selectedId={selectedMark} busy={busy} error={markError} onSelect={selectMark} onSave={updateMark} onDelete={deleteMark} onReply={replyMark} onRefresh={() => { void refreshMarks(); }} onExport={format => { void exportPaper(format); }} onClose={() => setView(value => ({ ...value, marksOpen: false }))} checkedIds={checkedMarks} onCheckedChange={setCheckedMarks} canAttach={canSend} onAttach={attachMarks} />}
      {view.notesOpen && !notesLayout.overlay && <NotesSplitter width={notesLayout.width} min={notesLayout.min} max={notesLayout.max} onChange={width => { if (viewRef.current.fit) rememberPosition(); notesLayout.setWidth(width); }} />}
      {notesMounted && <aside id="reader-notes-pane" className="pdf-notes-sidebar" aria-label="论文笔记侧栏" hidden={!view.notesOpen} style={{ width: notesLayout.width }}><header className="pdf-panel-heading"><strong>当前论文笔记</strong>{noteDirty && <span className="reader-note-dirty" role="status">未保存</span>}<button className="icon-button" aria-label="关闭论文笔记" onClick={() => setView(value => ({ ...value, notesOpen: false }))}><X size={14} /></button></header><NotesView key={vaultId} compact paperPath={paperPath} active={active && view.notesOpen} vaultId={vaultId} preview={preview} requestedTarget={view.notesOpen ? inlineNotesTarget.current : null} onDirtyChange={setNoteDirty} onOpenWorkspace={note => onNotes(paper, note?.path)} onOpenPaperMarkdown={onPaperMarkdown ? () => onPaperMarkdown(paper) : undefined} /></aside>}
    </div>
    {selection && createPortal(<SelectionToolbar key={selection.parts[0]?.page + ':' + selection.x + ':' + selection.y + ':' + selection.text} selection={selection} busy={busy} canSend={canSend} onCopy={() => { void copy(selection.text, '选区'); }} onMark={(color, comment, underline) => { void highlight(color, comment, underline); }} onTranslate={() => { void translateSelection(); }} onAsk={() => { void ask(); }} onClose={() => setSelection(null)} />, window.document.body)}
    {translationCard && createPortal(<TranslationCard value={translationCard} busy={busy} onPin={() => { void pinTranslation(); }} onClose={() => { setTranslationCard(null); selectionTranslationAbort.current?.abort(); translationRun.current += 1; }} onRetry={() => { void translateSelection(translationCard.selection); }} onCopy={() => { void copy(translationCard.text, '译文'); }} />, window.document.body)}
  </section>;
}
