import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import type { Point, Rect, Viewport } from './canvas-model.js';
import { registerEscapeLayer } from '../shared/escape.js';
import './reading-marker.css';

interface Stroke { id: number; points: Point[]; width: number; fading: boolean }
interface Draft { pointerId: number; points: Point[]; width: number }
export interface ReadingMarkerProps {
  viewport: Viewport;
  active: boolean;
  scopeKey: string;
  clearRevision?: number;
  navigationActive?: boolean;
  clip?: Rect;
  onDrawingChange?: (drawing: boolean) => void;
}
const HOLD_MS = 3000, FADE_MS = 450;
const path = (points: Point[]) => points.length === 1
  ? `M${points[0]!.x} ${points[0]!.y} l.01 0`
  : points.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${point.y}`).join(' ');

/** Session-only marks: coordinates follow the board, but nothing enters its content or history. */
export default function ReadingMarker({ viewport, active, scopeKey, clearRevision = 0, navigationActive = false, clip, onDrawingChange }: ReadingMarkerProps) {
  const root = useRef<HTMLDivElement>(null), currentViewport = useRef(viewport); currentViewport.current = viewport;
  const reportDrawing = useRef(onDrawingChange); reportDrawing.current = onDrawingChange;
  const drawing = useRef<Draft | null>(null), frame = useRef<number | undefined>(undefined), nextId = useRef(0);
  const timers = useRef(new Map<number, { fade: number; remove: number }>());
  const [draft, setDraft] = useState<Draft | null>(null), [strokes, setStrokes] = useState<Stroke[]>([]);
  function cancelFrame() { if (frame.current !== undefined) window.cancelAnimationFrame(frame.current); frame.current = undefined; }
  function release(pointerId: number) { if (root.current?.hasPointerCapture(pointerId)) root.current.releasePointerCapture(pointerId); }
  function cancelDraft() {
    const current = drawing.current; if (!current) return;
    drawing.current = null; cancelFrame(); release(current.pointerId); setDraft(null); reportDrawing.current?.(false);
  }
  function clearTimers() { for (const timer of timers.current.values()) { window.clearTimeout(timer.fade); window.clearTimeout(timer.remove); } timers.current.clear(); }
  useLayoutEffect(() => { cancelDraft(); clearTimers(); setStrokes([]); }, [scopeKey, clearRevision]);
  useLayoutEffect(() => { if (!active || navigationActive) cancelDraft(); }, [active, navigationActive]);
  useEffect(() => {
    const blur = () => cancelDraft();
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('blur', blur); clearTimers(); cancelFrame();
      const current = drawing.current;
      if (current) { drawing.current = null; release(current.pointerId); reportDrawing.current?.(false); }
    };
  }, []);
  useEffect(() => {
    if (!draft || !root.current) return;
    return registerEscapeLayer(root.current, () => {
      if (!drawing.current) return false;
      cancelDraft(); return true;
    }, 30);
  }, [!!draft]);
  function point(event: { clientX: number; clientY: number }): Point {
    const bounds = root.current!.getBoundingClientRect(), view = currentViewport.current;
    return { x: (event.clientX - bounds.left - view.x) / view.zoom, y: (event.clientY - bounds.top - view.y) / view.zoom };
  }
  function addPoint(event: { clientX: number; clientY: number }) {
    const current = drawing.current; if (!current) return;
    const next = point(event), previous = current.points.at(-1)!;
    if (Math.hypot(next.x - previous.x, next.y - previous.y) * currentViewport.current.zoom >= .8) current.points.push(next);
  }
  function down(event: PointerEvent<HTMLDivElement>) {
    if (!active || navigationActive || event.button !== 0 || drawing.current) return;
    event.preventDefault(); event.stopPropagation();
    const next = { pointerId: event.pointerId, points: [point(event)], width: 14 / currentViewport.current.zoom };
    drawing.current = next; setDraft({ ...next, points: [...next.points] });
    event.currentTarget.setPointerCapture(event.pointerId); reportDrawing.current?.(true);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!drawing.current || event.pointerId !== drawing.current.pointerId) return;
    for (const sample of event.nativeEvent.getCoalescedEvents?.() ?? []) addPoint(sample);
    addPoint(event);
    if (frame.current !== undefined) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = undefined;
      if (drawing.current) setDraft({ ...drawing.current, points: [...drawing.current.points] });
    });
  }
  function up(event: PointerEvent<HTMLDivElement>) {
    const current = drawing.current;
    if (!current || event.pointerId !== current.pointerId) return;
    event.preventDefault(); event.stopPropagation(); addPoint(event);
    drawing.current = null; cancelFrame(); release(current.pointerId); setDraft(null); reportDrawing.current?.(false);
    const id = ++nextId.current;
    setStrokes(previous => [...previous, { id, points: current.points, width: current.width, fading: false }]);
    const fade = window.setTimeout(() => setStrokes(previous => previous.map(stroke => stroke.id === id ? { ...stroke, fading: true } : stroke)), HOLD_MS);
    const remove = window.setTimeout(() => { setStrokes(previous => previous.filter(stroke => stroke.id !== id)); timers.current.delete(id); }, HOLD_MS + FADE_MS);
    timers.current.set(id, { fade, remove });
  }
  function cancel(event: PointerEvent<HTMLDivElement>) { if (event.pointerId === drawing.current?.pointerId) cancelDraft(); }
  return <div ref={root} className={`studio-reading-marker${active ? ' is-active' : ''}${navigationActive ? ' is-navigating' : ''}`} style={{ pointerEvents: active ? 'auto' : 'none', clipPath: clip ? `polygon(${clip.x}px ${clip.y}px, ${clip.x + clip.w}px ${clip.y}px, ${clip.x + clip.w}px ${clip.y + clip.h}px, ${clip.x}px ${clip.y + clip.h}px)` : undefined }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onLostPointerCapture={cancel}>
    <svg width="100%" height="100%" aria-hidden="true"><g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
      {strokes.map(stroke => <path key={stroke.id} className={stroke.fading ? 'is-fading' : ''} d={path(stroke.points)} strokeWidth={stroke.width} />)}
      {draft && <path className="is-drawing" d={path(draft.points)} strokeWidth={draft.width} />}
    </g></svg>
  </div>;
}
