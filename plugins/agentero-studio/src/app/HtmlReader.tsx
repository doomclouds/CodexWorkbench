import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, MessageSquare, RefreshCw, ZoomIn, ZoomOut } from 'lucide-react';
import type { HtmlRegionContent, ToolResponse } from '../contracts/studio';
import HtmlRegion from './shared/html-region/HtmlRegion';
import './html-reader.css';

export interface ReaderBoot { artifactId: string; regionId: string }
interface ReaderContent {
  artifactId: string; regionId: string; artifactTitle: string; title: string;
  sourceRevision: number; version: number; width: number; height: number; canAnnotate: boolean;
  element: HtmlRegionContent;
}
declare global { interface Window { __STUDIO_READER_BOOT__?: ReaderBoot } }
type Theme = 'system' | 'light' | 'dark';
function readTheme(): Theme { try { const value = localStorage.getItem('agentero-studio-reader-theme'); return value === 'light' || value === 'dark' ? value : 'system'; } catch { return 'system'; } }

export default function HtmlReader({ artifactId, regionId }: ReaderBoot) {
  const capability = useRef(new URLSearchParams(location.hash.slice(1)).get('cap') || '');
  const [content, setContent] = useState<ReaderContent>();
  const current = useRef(content); current.current = content;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [availableWidth, setAvailableWidth] = useState(1200);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const viewport = useRef<HTMLDivElement>(null);
  const path = `/api/region-reader/${encodeURIComponent(artifactId)}/${encodeURIComponent(regionId)}`;
  const request = useCallback(async <T,>(suffix = '', init?: RequestInit): Promise<T> => {
    if (!capability.current) throw new Error('阅读链接缺少访问凭据，请从原白板重新打开。');
    const response = await fetch(path + suffix, { ...init, headers: { Authorization: `Bearer ${capability.current}`, ...init?.headers }, cache: 'no-store' });
    const result = await response.json() as ToolResponse<T>;
    if (!response.ok || !result.ok) throw Object.assign(new Error(result.error?.message || '阅读内容未能加载，请重试。'), { status: response.status });
    return result.data as T;
  }, [path]);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setBusy(true);
    try {
      const value = await request<ReaderContent>('', { signal });
      if (signal?.aborted) return;
      setContent(value); setUpdated(false); setError('');
    } catch (reason) {
      if (!signal?.aborted) {
        if (reason instanceof Error && 'status' in reason && [401, 403, 404, 410].includes(Number(reason.status))) { setContent(undefined); setUpdated(false); }
        setError(reason instanceof Error ? reason.message : '阅读内容未能加载。');
      }
    }
    finally { if (!signal?.aborted) setBusy(false); }
  }, [request]);
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort(); }, [refresh]);
  useEffect(() => {
    let pending = false; const controller = new AbortController();
    const check = async () => {
      if (document.hidden || pending || !current.current) return;
      pending = true;
      try {
        const metadata = await request<Omit<ReaderContent, 'element'>>('?metadata=1', { signal: controller.signal });
        if (!controller.signal.aborted && metadata.sourceRevision !== current.current?.sourceRevision) setUpdated(true);
      } catch (reason) {
        if (!controller.signal.aborted) {
          if (reason instanceof Error && 'status' in reason && [401, 403, 404, 410].includes(Number(reason.status))) { setContent(undefined); setUpdated(false); }
          setError(reason instanceof Error ? reason.message : '无法检查内容更新。');
        }
      }
      finally { pending = false; }
    };
    const timer = setInterval(() => { void check(); }, 5000);
    const visible = () => { if (!document.hidden) void check(); };
    document.addEventListener('visibilitychange', visible);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [request]);
  useEffect(() => {
    const measure = () => setAvailableWidth(Math.max(240, (viewport.current?.clientWidth || window.innerWidth) - 48));
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : undefined;
    if (viewport.current) observer?.observe(viewport.current);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [Boolean(content)]);
  useEffect(() => { try { localStorage.setItem('agentero-studio-reader-theme', theme); } catch { /* Theme does not require storage. */ } }, [theme]);
  const returnToBoard = async (annotate: boolean) => {
    setBusy(true); setNotice('');
    try {
      await request('/return', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ annotate }) });
      setNotice(annotate ? '已请求在原区域备注，请切回原白板。' : '已请求定位原区域，请切回原白板。');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '无法返回白板。'); }
    finally { setBusy(false); }
  };
  const width = Math.max(320, content?.width || 1440), height = Math.max(240, content?.height || 1120);
  const scale = zoom === 'fit' ? Math.min(2, availableWidth / width) : zoom;
  const changeZoom = (factor: number) => setZoom(Math.min(3, Math.max(0.1, scale * factor)));
  return <main className="studio-reader" data-reader-theme={theme}>
    <header className="studio-reader-toolbar">
      <button type="button" onClick={() => { void returnToBoard(false); }} disabled={busy || !content}><ArrowLeft size={16} />返回白板</button>
      <div className="studio-reader-title"><strong>{content?.title || 'HTML 阅读'}</strong><span>{content?.artifactTitle || 'Agentero 创作'}</span></div>
      <div className="studio-reader-controls">
        <button type="button" aria-label="缩小" onClick={() => changeZoom(1 / 1.2)}><ZoomOut size={16} /></button>
        <button type="button" className={zoom === 'fit' ? 'is-active' : ''} onClick={() => setZoom('fit')}>适应宽度</button>
        <span className="studio-reader-percent">{Math.round(scale * 100)}%</span>
        <button type="button" aria-label="放大" onClick={() => changeZoom(1.2)}><ZoomIn size={16} /></button>
        <button type="button" onClick={() => { void refresh(); }} disabled={busy}><RefreshCw size={16} />刷新</button>
        <select aria-label="阅读页主题" value={theme} onChange={event => setTheme(event.target.value as Theme)}><option value="system">跟随系统</option><option value="light">明亮</option><option value="dark">暗色</option></select>
        <button type="button" className="studio-reader-annotate" onClick={() => { void returnToBoard(true); }} disabled={busy || !content?.canAnnotate} title={content && !content.canAnnotate ? '当前为只读查看权限' : undefined}><MessageSquare size={16} />在白板中备注</button>
      </div>
    </header>
    {error && <div className="studio-reader-message is-error" role="alert">{error}</div>}
    {notice && <div className="studio-reader-message" role="status">{notice}</div>}
    {updated && <div className="studio-reader-message" role="status">原 HTML 已更新。<button type="button" disabled={busy} onClick={() => { void refresh(); }}>刷新到新版本</button></div>}
    <div className="studio-reader-viewport" ref={viewport} aria-busy={busy}>
      {content ? <div className="studio-reader-page" style={{ width: width * scale, height: height * scale }}>
        <div className="studio-reader-renderer" style={{ width, height, transform: `scale(${scale})` }}>
          <HtmlRegion element={content.element} annotation={false} interactive onAnnotate={() => {}} preserveScroll />
        </div>
      </div> : <p className="studio-reader-loading">{busy ? '正在读取原 HTML 区域…' : '请从白板重新打开阅读页。'}</p>}
    </div>
  </main>;
}
