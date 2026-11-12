import { useEffect, useRef, useState, type RefObject } from 'react';

export const DEFAULT_NOTES_WIDTH = 360;
export const MIN_NOTES_WIDTH = 300;
export const MIN_PDF_WIDTH = 360;
export const NOTES_SPLITTER_WIDTH = 8;
const STORAGE_KEY = 'agentero-library.reader-notes-width';
export function notesPaneLayout(containerWidth: number, preferredWidth: number) {
  const overlay = containerWidth < MIN_PDF_WIDTH + MIN_NOTES_WIDTH + NOTES_SPLITTER_WIDTH;
  const max = overlay ? Math.max(0, Math.min(480, containerWidth - 16)) : Math.min(720, containerWidth - MIN_PDF_WIDTH - NOTES_SPLITTER_WIDTH);
  const min = Math.min(MIN_NOTES_WIDTH, max);
  return { overlay, min, max, width: Math.max(min, Math.min(max, preferredWidth)) };
}
export function useNotesPaneLayout(body: RefObject<HTMLDivElement | null>, mounted = true) {
  const [containerWidth, setContainerWidth] = useState(1000);
  const [preferredWidth, setPreferredWidth] = useState(() => { try { const saved = Number(localStorage.getItem(STORAGE_KEY)); return Number.isFinite(saved) && saved >= MIN_NOTES_WIDTH ? Math.min(720, saved) : DEFAULT_NOTES_WIDTH; } catch { return DEFAULT_NOTES_WIDTH; } });
  useEffect(() => { if (!mounted || !body.current) return; const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.width > 0) setContainerWidth(entry.contentRect.width); }); observer.observe(body.current); return () => observer.disconnect(); }, [body, mounted]);
  useEffect(() => { const timer = setTimeout(() => { try { localStorage.setItem(STORAGE_KEY, String(preferredWidth)); } catch {} }, 150); return () => clearTimeout(timer); }, [preferredWidth]);
  function setWidth(width: number) { setPreferredWidth(Math.max(MIN_NOTES_WIDTH, Math.min(720, width))); }
  return { ...notesPaneLayout(containerWidth, preferredWidth), setWidth };
}
export function NotesSplitter({ width, min, max, onChange }: { width: number; min: number; max: number; onChange(width: number): void }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  return <div className="pdf-notes-splitter" role="separator" aria-label="调整 PDF 与笔记分栏" aria-orientation="vertical" aria-controls="reader-notes-pane" aria-valuemin={Math.round(min)} aria-valuemax={Math.round(max)} aria-valuenow={Math.round(width)} aria-valuetext={`笔记宽度 ${Math.round(width)} 像素`} tabIndex={0} title="拖动调整；方向键调整；双击复位" onDoubleClick={() => onChange(DEFAULT_NOTES_WIDTH)} onKeyDown={event => {
    const step = event.shiftKey ? 60 : 20;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) return;
    event.preventDefault(); onChange(event.key === 'Home' ? min : event.key === 'End' ? max : event.key === 'Enter' ? DEFAULT_NOTES_WIDTH : Math.max(min, Math.min(max, width + (event.key === 'ArrowLeft' ? step : -step))));
  }} onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); drag.current = { x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (drag.current) onChange(Math.max(min, Math.min(max, drag.current.width + drag.current.x - event.clientX))); }} onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { drag.current = null; }} />;
}
