import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ArrowLeft, LocateFixed, MessageCircle } from 'lucide-react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import type { ReaderMark } from '../../contracts/reader';
import { messageOf } from '../model';
import { COLOR_HEX, fitPageScale, markPointRects, markVisualLayers, pageGeometry, rectsPath, rectsUnderlinePath, type PageGeometry } from './geometry';
import { layoutMarkPins, MARK_PIN_GUTTER } from './mark-pins';
import { abortable, canvasBudget, pdfRenderScheduler, releasePageResources } from './scheduling';
import './annotation-manager.css';

const MAX_PREVIEW_PIXELS = 2_000_000;
const MANAGER_PREVIEW_WIDTH = 900;

function useSurfaceWidth(ref: RefObject<HTMLElement | null>, active = true) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const target = ref.current; if (!active || !target) return;
    const measure = () => setWidth(Math.max(0, target.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure); observer.observe(target);
    return () => observer.disconnect();
  }, [ref, active]);
  return width;
}

export interface AnnotationManagerFrameProps {
  title: string;
  onBack(): void;
  children: ReactNode;
  preview?: ReactNode;
  previewOpen: boolean;
  onPreviewOpenChange(open: boolean): void;
}

/** The manager fills its existing App area; it never creates a host surface. */
export function AnnotationManagerFrame({ title, onBack, children, preview, previewOpen, onPreviewOpenChange }: AnnotationManagerFrameProps) {
  const root = useRef<HTMLElement>(null); const width = useSurfaceWidth(root);
  const previewAvailable = width === 0 || width >= MANAGER_PREVIEW_WIDTH;
  return <section ref={root} className="annotation-manager-frame" aria-label="批注管理">
    <header className="annotation-manager-header">
      <button type="button" className="annotation-manager-back" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />返回阅读</button>
      <strong title={title}>批注管理 · {title}</strong>
      {preview !== undefined && <button type="button" className="annotation-manager-preview-toggle" role="switch" aria-label="原文预览" aria-checked={previewOpen && previewAvailable} disabled={!previewAvailable} title={previewAvailable ? '显示或收起原文预览' : '放大当前视图后可查看原文预览'} onClick={() => onPreviewOpenChange(!previewOpen)}><span>原文预览</span><span className="annotation-manager-switch" aria-hidden="true" /></button>}
    </header>
    {!previewAvailable && preview !== undefined && <p className="annotation-manager-narrow-hint">放大当前视图可查看原文预览</p>}
    <div className="annotation-manager-body">
      <div className="annotation-manager-main">{children}</div>
      {previewOpen && previewAvailable && preview !== undefined && <aside className="annotation-manager-preview" aria-label="批注原文预览">{preview}</aside>}
    </div>
  </section>;
}

export interface AnnotationSourcePreviewProps {
  document: PDFDocumentProxy | null;
  mark: ReaderMark | null;
  active: boolean;
  onLocate?(mark: ReaderMark): void;
}
interface PreviewState { document: PDFDocumentProxy; page: number; status: 'loading' | 'ready' | 'error'; geometry?: PageGeometry; error?: string }

/** Read-only, single-page view of the reader's already loaded PDF document. */
export function AnnotationSourcePreview({ document, mark, active, onLocate }: AnnotationSourcePreviewProps) {
  const viewport = useRef<HTMLDivElement>(null); const canvas = useRef<HTMLCanvasElement>(null);
  const width = useSurfaceWidth(viewport, active);
  const chain = useRef<Promise<void>>(Promise.resolve()); const generation = useRef(0);
  const [state, setState] = useState<PreviewState | null>(null);
  const pageNumber = mark?.page ?? 0;
  const validPage = Boolean(document && Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= document.numPages);
  const renderActive = active && width > 0 && Boolean(document && mark) && validPage;
  const shown = state?.document === document && state.page === pageNumber ? state : null;

  useEffect(() => {
    const epoch = ++generation.current;
    if (!renderActive || !document || !canvas.current) return;
    // Capture the owned node before any RPC or scheduling; React can clear refs
    // during commit before this effect's cleanup is called.
    const target = canvas.current; const controller = new AbortController();
    let cancelled = false; let task: RenderTask | undefined;
    const ownsSurface = () => !cancelled && !controller.signal.aborted && generation.current === epoch && canvas.current === target && target.isConnected;
    setState({ document, page: pageNumber, status: 'loading' });
    const work = chain.current.catch(() => {}).then(async () => {
      if (!ownsSurface()) return;
      const page = await abortable(document.getPage(pageNumber), controller.signal);
      if (!ownsSurface()) return;
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(1, fitPageScale(base.width, Math.max(1, Math.min(600, width - 24 - MARK_PIN_GUTTER))));
      const geometry = pageGeometry(page, scale);
      await pdfRenderScheduler.run(async () => {
        if (!ownsSurface()) return;
        const budget = canvasBudget(geometry.viewport.width, geometry.viewport.height, window.devicePixelRatio || 1, MAX_PREVIEW_PIXELS);
        target.width = budget.width; target.height = budget.height;
        target.style.width = `${geometry.viewport.width}px`; target.style.height = `${geometry.viewport.height}px`;
        task = page.render({ canvas: target, viewport: geometry.viewport, transform: budget.ratio === 1 ? undefined : [budget.ratio, 0, 0, budget.ratio, 0, 0] });
        try { await abortable(task.promise, controller.signal); }
        finally { if (!ownsSurface()) task.cancel(); }
        if (ownsSurface()) setState({ document, page: pageNumber, status: 'ready', geometry });
      }, controller.signal);
    }).catch(cause => {
      if (ownsSurface()) { releasePageResources(target); setState({ document, page: pageNumber, status: 'error', error: messageOf(cause) }); }
    }).finally(() => {
      // Only this preview's canvas is released. The page/document cache belongs
      // to the reader and may still be in use there.
      if (!ownsSurface()) releasePageResources(target);
    });
    chain.current = work;
    return () => { cancelled = true; controller.abort(); task?.cancel(); void work.finally(() => releasePageResources(target)); };
  }, [document, pageNumber, renderActive, width]);

  const geometry = renderActive && shown?.status === 'ready' ? shown.geometry : undefined;
  const pin = geometry && mark ? layoutMarkPins([mark], geometry)[0] : undefined;
  return <section className="annotation-source-preview">
    <header className="annotation-source-preview-header">
      <strong>原文预览{mark ? ` · 物理第 ${mark.page} 页` : ''}</strong>
      {onLocate && <button type="button" disabled={!mark || !document || !validPage} onClick={() => { if (mark) onLocate(mark); }}><LocateFixed size={14} aria-hidden="true" />定位到阅读器</button>}
    </header>
    <div ref={viewport} className="annotation-source-preview-viewport" aria-busy={renderActive && (!shown || shown.status === 'loading')}>
      {!mark ? <p className="annotation-source-preview-message">选择一条批注查看原文</p>
        : !document ? <p className="annotation-source-preview-message">PDF 尚未就绪</p>
        : !validPage ? <p className="annotation-source-preview-message" role="alert">无法预览此批注的原文页</p>
        : shown?.status === 'error' ? <p className="annotation-source-preview-message" role="alert">原文预览失败：{shown.error}</p>
        : active && (!geometry) ? <p className="annotation-source-preview-message" role="status">正在加载原文页…</p> : null}
      {renderActive && <div className="annotation-source-preview-sheet" style={geometry ? { width: geometry.viewport.width + MARK_PIN_GUTTER, height: geometry.viewport.height } : undefined} hidden={!geometry}>
        <canvas ref={canvas} aria-label={`第 ${pageNumber} 页原文`} />
        {geometry && mark && <PreviewMark mark={mark} geometry={geometry} />}
        {geometry && pin && <span className="annotation-source-preview-pin" role="img" aria-label="批注所在位置" style={{ left: geometry.viewport.width + 4, top: pin.y, color: COLOR_HEX[mark?.color ?? 'yellow'] }}><MessageCircle size={22} aria-hidden="true" /></span>}
      </div>}
    </div>
  </section>;
}

function PreviewMark({ mark, geometry }: { mark: ReaderMark; geometry: PageGeometry }) {
  const layers = markVisualLayers([mark], geometry);
  const point = (x: number, y: number) => geometry.viewport.convertToViewportPoint(geometry.view[0] + x, geometry.view[3] - y);
  const origin = point(0, 0); const x = point(1, 0); const y = point(0, 1);
  const transform = `matrix(${x[0] - origin[0]},${x[1] - origin[1]},${y[0] - origin[0]},${y[1] - origin[1]},${origin[0]},${origin[1]})`;
  return <svg className="annotation-source-preview-overlay" width={geometry.viewport.width} height={geometry.viewport.height} aria-hidden="true"><g transform={transform}>
    {layers.fills.map(layer => <path key={`${layer.color}:${layer.opacity}`} d={rectsPath(layer.rects)} fill={layer.color} fillOpacity={layer.opacity} />)}
    {layers.underlines.map(layer => <path key={layer.color} d={rectsUnderlinePath(layer.rects)} fill="none" stroke={layer.color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />)}
    <path d={rectsUnderlinePath(markPointRects(mark, geometry))} fill="none" stroke="#2563eb" strokeWidth={2} vectorEffect="non-scaling-stroke" />
  </g></svg>;
}
