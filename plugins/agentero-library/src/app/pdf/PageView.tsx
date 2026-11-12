import { memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import type { MarkRect, ReaderMark } from '../../contracts/reader';
import { pdfjs } from '../pdf-runtime';
import { messageOf } from '../model';
import { COLOR_HEX, fitPageScale, markText, pageGeometry, pointsRectToViewport, rectEnvelope, safePdfUrl, screenRectToPoints, usefulRects, type PageGeometry } from './geometry';
import { NativeSelectionLayer } from './NativeSelectionLayer';
import { layoutMarkPins, MARK_PIN_GUTTER, type MarkPinGroup } from './mark-pins';
import { MarkPopover } from './MarkPopover';
import { TranslationOverlay } from './translation/TranslationOverlay';
import type { TranslatedPage } from './translation/useDocumentTranslation';
import { abortable, canvasBudget, pdfRenderScheduler, releasePageResources, yieldToHost } from './scheduling';
import { latestPageIntersection, PAGE_PREFETCH_MARGIN, pageIsNearViewport } from './page-visibility';

export interface RegisteredPage { element: HTMLDivElement; canvas: HTMLCanvasElement; geometry: PageGeometry; page: PDFPageProxy }
export interface VisualSelection { page: number; rects: MarkRect[]; pageSize: { width: number; height: number }; quote: string; x: number; y: number; asset: { mediaType: 'image/png'; data: string } }
interface Props {
  document: PDFDocumentProxy; number: number; active: boolean; scale: number; fitWidth?: number; rotation: number; tone: 'white' | 'dark';
  estimate: { width: number; height: number }; viewportRef: RefObject<HTMLDivElement | null>; marks: ReaderMark[];
  selectedMark: string | null; cards: boolean; crop: boolean; translated?: TranslatedPage;
  onReady(number: number, page: RegisteredPage | null): void; onMark(mark: ReaderMark): void;
  onDestination(destination: unknown, action?: string): void; onExternal(url: string): void;
  onVisual(selection: VisualSelection): void;
  onRendered(number: number): void;
  onFailure?(number: number, message: string): void;
  onSaveComment?(mark: ReaderMark, text: string): Promise<void>;
}
interface Link { id: string; rect: number[]; url?: string; dest?: unknown; action?: string }

function PageViewComponent(props: Props) {
  const { document, number, active, scale, fitWidth, rotation, tone, estimate, viewportRef, marks, selectedMark, cards, crop, translated, onReady, onMark, onDestination, onExternal, onVisual, onRendered, onFailure } = props;
  const sheet = useRef<HTMLDivElement>(null); const element = useRef<HTMLDivElement>(null); const canvas = useRef<HTMLCanvasElement>(null); const text = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(number === 1); const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [links, setLinks] = useState<Link[]>([]);
  const [rendering, setRendering] = useState(false); const [error, setError] = useState('');
  const [cropRect, setCropRect] = useState<MarkRect | null>(null); const drag = useRef<{ x: number; y: number } | null>(null);
  const [textRects, setTextRects] = useState<MarkRect[]>([]); const [openPin, setOpenPin] = useState<{ group: MarkPinGroup; anchor: HTMLElement } | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const failed = useRef(false);
  const renderEpoch = useRef(0); const pageRef = useRef(page); pageRef.current = page;
  const baseSize = page ? page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 }) : { width: rotation % 180 ? estimate.height : estimate.width, height: rotation % 180 ? estimate.width : estimate.height };
  const renderedScale = fitWidth === undefined ? scale : fitPageScale(baseSize.width, fitWidth);
  const geometry = useMemo(() => page ? pageGeometry(page, renderedScale, (page.rotate + rotation) % 360) : null, [page, renderedScale, rotation]);
  const placeholder = { width: baseSize.width * renderedScale, height: baseSize.height * renderedScale };

  useEffect(() => {
    if (!active || !sheet.current || !viewportRef.current) return;
    const target = sheet.current; const root = viewportRef.current; let stopped = false; let lastTime = -Infinity;
    const observer = new IntersectionObserver(entries => {
      if (stopped) return;
      const latest = latestPageIntersection(entries, target, lastTime); if (!latest) return;
      lastTime = latest.time;
      // Zoom/anchor restoration can move a page again before this callback runs.
      setNear(pageIsNearViewport(target.getBoundingClientRect(), root.getBoundingClientRect()));
    }, { root, rootMargin: PAGE_PREFETCH_MARGIN + 'px 0px' });
    observer.observe(target); return () => { stopped = true; observer.disconnect(); };
  }, [viewportRef, document, active, renderedScale, rotation]);
  useEffect(() => {
    if (!active || !near || page) return;
    let cancelled = false;
    void document.getPage(number).then(next => { if (!cancelled) setPage(next); }).catch(cause => { if (!cancelled) setError(messageOf(cause)); });
    return () => { cancelled = true; };
  }, [document, number, near, page, active]);
  useEffect(() => {
    if (!geometry || !page || !element.current || !canvas.current) return;
    onReady(number, { element: element.current, canvas: canvas.current, geometry, page });
    return () => { onReady(number, null); };
  }, [geometry, page, number, onReady]);
  useEffect(() => {
    if (!active || !page || !near) return;
    let cancelled = false;
    void page.getAnnotations({ intent: 'display' }).then(items => {
      if (!cancelled) setLinks(items.filter(item => Array.isArray(item.rect) && (item.url || item.dest || item.action)).map((item, index) => ({ id: String(item.id ?? index), rect: item.rect, url: safePdfUrl(item.url) ?? undefined, dest: item.dest, action: item.action })));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [page, near, active]);
  useEffect(() => {
    const epoch = ++renderEpoch.current;
    if (!page || !geometry || !active || !near || !canvas.current || !text.current || failed.current) {
      setRendering(false);
      const target = canvas.current; const content = text.current;
      if (!near || !active) void chain.current.finally(() => {
        if (renderEpoch.current !== epoch) return;
        const current = sheet.current; const root = viewportRef.current;
        // A stale "outside" observation must not erase a connected, visible canvas.
        if (active && current?.isConnected && root && pageIsNearViewport(current.getBoundingClientRect(), root.getBoundingClientRect())) { setNear(true); return; }
        releasePageResources(target, content, page);
      });
      return;
    }
    // Own these nodes before queueing. React can detach refs during commit,
    // before passive effect cleanup has cancelled this job.
    const target = canvas.current; const content = text.current;
    const controller = new AbortController();
    let cancelled = false; let task: RenderTask | undefined; let layer: InstanceType<typeof pdfjs.TextLayer> | undefined;
    const ownsSurface = () => !cancelled && !controller.signal.aborted && renderEpoch.current === epoch && canvas.current === target && text.current === content && target.isConnected && content.isConnected;
    const work = chain.current.catch(() => {}).then(() => pdfRenderScheduler.run(async () => {
      if (!ownsSurface()) return;
      setRendering(true); setError('');
      const budget = canvasBudget(geometry.viewport.width, geometry.viewport.height, window.devicePixelRatio || 1); const ratio = budget.ratio;
      target.width = budget.width; target.height = budget.height;
      target.style.width = `${geometry.viewport.width}px`; target.style.height = `${geometry.viewport.height}px`;
      content.replaceChildren();
      task = page.render({ canvas: target, viewport: geometry.viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      const rendered = task.promise; void rendered.catch(() => {});
      try {
        const source = await abortable(page.getTextContent(), controller.signal);
        if (!ownsSurface()) return;
        layer = new pdfjs.TextLayer({ textContentSource: source, container: content, viewport: geometry.viewport });
        await abortable(Promise.all([rendered, layer.render()]), controller.signal);
        if (ownsSurface()) {
          const bounds = target.getBoundingClientRect(); const sx = geometry.viewport.width / bounds.width; const sy = geometry.viewport.height / bounds.height;
          const spans = content.querySelectorAll('span:not(.markedContent)'); const occupied: MarkRect[] = [];
          // A pathological page uses the safe outer gutter instead of retaining an unbounded layout index.
          if (spans.length > 5000) occupied.push({ x: 0, y: 0, w: geometry.viewport.width, h: geometry.viewport.height });
          else for (let index = 0; index < spans.length; index++) {
            if (index > 0 && index % 128 === 0) { await yieldToHost(controller.signal); if (!ownsSurface()) return; }
            const rect = spans[index].getBoundingClientRect(); occupied.push({ x: (rect.left - bounds.left) * sx, y: (rect.top - bounds.top) * sy, w: rect.width * sx, h: rect.height * sy });
          }
          setTextRects(occupied);
          onRendered(number);
        }
      } finally { if (!ownsSurface()) { controller.abort(); task.cancel(); layer?.cancel(); } await abortable(rendered.catch(() => {}), controller.signal).catch(() => {}); }
    }, controller.signal)).catch(cause => { if (ownsSurface() && !/cancel|abort/i.test(String((cause as Error | null)?.name))) { failed.current = true; const message = `第 ${number} 页无法显示：${messageOf(cause)}`; setError(message); onFailure?.(number, message); } }).finally(() => { if (ownsSurface()) setRendering(false); });
    chain.current = work;
    return () => { cancelled = true; controller.abort(); task?.cancel(); layer?.cancel(); };
  }, [active, near, page, geometry, number, onRendered]);
  useEffect(() => {
    const target = canvas.current; const content = text.current;
    return () => { const previous = pageRef.current; void chain.current.finally(() => releasePageResources(target, content, previous)); };
  }, []);

  const pageMarks = useMemo(() => marks.filter(mark => mark.page === number), [marks, number]);
  const pins = useMemo(() => geometry ? layoutMarkPins(pageMarks, geometry, textRects) : [], [pageMarks, geometry, textRects]);
  const commentCards = useMemo(() => {
    if (!geometry || !cards) return [];
    let bottom = -8;
    return pageMarks.filter(mark => markText(mark) || mark.asset).map(mark => ({ mark, rect: mark.rects[0] ? pointsRectToViewport(mark.rects[0], geometry, mark.space === 'norm') : { x: 0, y: 0, w: 0, h: 0 } })).sort((a, b) => a.rect.y - b.rect.y).map(({ mark, rect }) => {
      const top = Math.max(rect.y, bottom + 8); bottom = top + 95;
      return { mark, top };
    });
  }, [geometry, cards, pageMarks]);

  function cropStart(event: React.PointerEvent<HTMLDivElement>) {
    if (!crop || event.button !== 0 || !element.current) return;
    event.preventDefault(); event.stopPropagation();
    const rect = element.current.getBoundingClientRect(); drag.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId); setCropRect({ x: drag.current.x, y: drag.current.y, w: 0, h: 0 });
  }
  function cropMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current || !element.current) return;
    const bounds = element.current.getBoundingClientRect(); const x = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)); const y = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
    setCropRect({ x: Math.min(x, drag.current.x), y: Math.min(y, drag.current.y), w: Math.abs(x - drag.current.x), h: Math.abs(y - drag.current.y) });
  }
  function cropEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current || !cropRect || !geometry || !canvas.current || !element.current) return;
    event.preventDefault(); event.stopPropagation(); drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const bounds = element.current.getBoundingClientRect(); const rect = cropRect; setCropRect(null);
    if (rect.w < 5 || rect.h < 5 || !canvas.current.width) return;
    const target = window.document.createElement('canvas'); const sx = canvas.current.width / bounds.width; const sy = canvas.current.height / bounds.height;
    target.width = Math.max(1, Math.ceil(rect.w * sx)); target.height = Math.max(1, Math.ceil(rect.h * sy));
    target.getContext('2d')?.drawImage(canvas.current, rect.x * sx, rect.y * sy, rect.w * sx, rect.h * sy, 0, 0, target.width, target.height);
    const points = screenRectToPoints({ left: bounds.left + rect.x, top: bounds.top + rect.y, width: rect.w, height: rect.h }, bounds, geometry);
    onVisual({ page: number, rects: [points], pageSize: { width: geometry.width, height: geometry.height }, quote: `第 ${number} 页区域截图`, x: event.clientX, y: event.clientY, asset: { mediaType: 'image/png', data: target.toDataURL('image/png').split(',')[1] } });
  }

  return <div ref={sheet} className={`pdf-sheet ${cards ? 'with-comment-cards' : ''}`} style={{ minHeight: geometry?.viewport.height ?? placeholder.height, width: (geometry?.viewport.width ?? placeholder.width) + (cards ? 226 : MARK_PIN_GUTTER) }}>
    <div ref={element} className={`pdf-page parity-pdf-page ${tone === 'dark' ? 'paper-dark' : ''} ${crop ? 'crop-mode' : ''}`} data-pdf-page={number} style={{ width: geometry?.viewport.width ?? placeholder.width, height: geometry?.viewport.height ?? placeholder.height, '--scale-factor': renderedScale, '--total-scale-factor': renderedScale * (page?.userUnit ?? 1) } as React.CSSProperties}>
      <canvas ref={canvas} />
      {geometry && <MarkOverlays marks={pageMarks} geometry={geometry} selected={selectedMark} />}
      <div className="textLayer" ref={text} />
      {geometry && active && near && <NativeSelectionLayer pageRef={element} width={geometry.viewport.width} height={geometry.viewport.height} />}
      {geometry && translated && <TranslationOverlay state={translated} geometry={geometry} dark={tone === 'dark'} />}
      {geometry && <div className="pdf-native-links">{links.map(link => {
        const a = geometry.viewport.convertToViewportPoint(link.rect[0], link.rect[1]); const b = geometry.viewport.convertToViewportPoint(link.rect[2], link.rect[3]);
        return <button key={link.id} className="pdf-native-link" tabIndex={-1} title={link.url || '跳转到 PDF 引用位置'} aria-label={link.url ? `打开链接 ${link.url}` : '跳转到 PDF 引用'} style={{ left: Math.min(a[0], b[0]), top: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]) }} onClick={event => { event.stopPropagation(); if (link.url) onExternal(link.url); else onDestination(link.dest, link.action); }} />;
      })}</div>}
      {geometry && <div className="pdf-mark-pins">{pins.map(group => {
        const mark = group.marks[0];
        return <button key={mark.id} className={`pdf-mark-pin ${group.marks.some(item => selectedMark === item.id) ? 'selected' : ''}`} style={{ left: group.x, top: group.y, '--mark-color': COLOR_HEX[mark.color ?? 'yellow'] } as React.CSSProperties} title={group.marks.length > 1 ? `${group.marks.length} 条批注` : markText(mark) || '查看批注'} aria-label={`查看第 ${number} 页${group.marks.length > 1 ? `${group.marks.length} 条批注` : mark.kind === 'translate' ? '翻译' : '批注'}`} aria-expanded={openPin?.group.marks[0].id === mark.id} onClick={event => { event.stopPropagation(); setOpenPin(value => value?.group.marks[0].id === mark.id ? null : { group, anchor: event.currentTarget }); }}>{group.marks.length > 1 ? group.marks.length : mark.kind === 'translate' ? '译' : mark.kind === 'ask' ? '?' : '•'}</button>;
      })}</div>}
      {openPin && active && near && <MarkPopover marks={openPin.group.marks.map(mark => pageMarks.find(current => current.id === mark.id) ?? mark)} anchor={openPin.anchor} viewport={viewportRef.current} sourceBounds={() => {
        if (!geometry || !element.current) return undefined;
        const envelope = rectEnvelope(openPin.group.marks.flatMap(mark => mark.rects.map(rect => pointsRectToViewport(rect, geometry, mark.space === 'norm'))));
        if (!envelope) return undefined;
        const bounds = element.current.getBoundingClientRect(); const sx = bounds.width / geometry.viewport.width; const sy = bounds.height / geometry.viewport.height;
        return { left: bounds.left + envelope.x * sx, top: bounds.top + envelope.y * sy, right: bounds.left + (envelope.x + envelope.w) * sx, bottom: bounds.top + (envelope.y + envelope.h) * sy };
      }} textBounds={() => {
        if (!geometry || !element.current) return [];
        const bounds = element.current.getBoundingClientRect(); const sx = bounds.width / geometry.viewport.width; const sy = bounds.height / geometry.viewport.height;
        return textRects.map(rect => ({ left: bounds.left + rect.x * sx, top: bounds.top + rect.y * sy, right: bounds.left + (rect.x + rect.w) * sx, bottom: bounds.top + (rect.y + rect.h) * sy }));
      }} onSelect={mark => { setOpenPin(null); onMark(mark); }} onSave={props.onSaveComment} onClose={() => setOpenPin(null)} />}
      {crop && <div className="pdf-crop-surface" onPointerDown={cropStart} onPointerMove={cropMove} onPointerUp={cropEnd} onPointerCancel={() => { drag.current = null; setCropRect(null); }}>{cropRect && <div className="pdf-crop-rect" style={{ left: cropRect.x, top: cropRect.y, width: cropRect.w, height: cropRect.h }} />}</div>}
      {!near && !geometry && <span className="pdf-placeholder">第 {number} 页</span>}
      {rendering && <span className="render-indicator">正在绘制第 {number} 页</span>}
      {error && <div className="pdf-page-error" role="alert">第 {number} 页：{error}</div>}
      {cards && <div className="pdf-comment-gutter">{commentCards.map(({ mark, top }) => <button key={mark.id} className={`pdf-comment-card ${selectedMark === mark.id ? 'selected' : ''}`} style={{ top }} onClick={() => onMark(mark)}><strong>第 {number} 页 · {mark.kind === 'translate' ? '译文' : mark.kind === 'ask' ? '提问' : '备注'}</strong><span>{markText(mark) || mark.quote}</span></button>)}</div>}
    </div>
  </div>;
}

export const PageView = memo(PageViewComponent);

function MarkOverlays({ marks, geometry, selected }: { marks: ReaderMark[]; geometry: PageGeometry; selected: string | null }) {
  const point = (x: number, y: number) => geometry.viewport.convertToViewportPoint(geometry.view[0] + x, geometry.view[3] - y);
  const o = point(0, 0); const a = point(1, 0); const b = point(0, 1);
  const transform = `matrix(${a[0] - o[0]},${a[1] - o[1]},${b[0] - o[0]},${b[1] - o[1]},${o[0]},${o[1]})`;
  return <svg className="pdf-mark-overlay" width={geometry.viewport.width} height={geometry.viewport.height} aria-hidden><g transform={transform}>{marks.map(mark => {
    const rects = usefulRects(mark.rects.map(raw => mark.space === 'norm' ? { x: raw.x * geometry.width, y: raw.y * geometry.height, w: raw.w * geometry.width, h: raw.h * geometry.height } : raw));
    const color = mark.kind === 'translate' ? '#60a5fa' : mark.kind === 'ask' ? '#4ade80' : COLOR_HEX[mark.color ?? 'yellow'];
    return mark.kind === 'underline' ? <path key={mark.id} d={rects.map(r => `M${r.x} ${r.y + r.h}h${r.w}`).join(' ')} fill="none" stroke={color} strokeWidth={selected === mark.id ? 3 : 1.5} vectorEffect="non-scaling-stroke" /> : <path key={mark.id} d={rects.map(r => `M${r.x} ${r.y}h${r.w}v${r.h}h${-r.w}Z`).join(' ')} fill={color} fillOpacity={mark.kind === 'visual' ? .12 : .35} stroke={selected === mark.id ? color : 'none'} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />;
  })}</g></svg>;
}
