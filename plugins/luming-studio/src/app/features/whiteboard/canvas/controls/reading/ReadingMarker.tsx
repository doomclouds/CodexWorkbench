import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from 'react';
import type { Point, Rect, Viewport } from '../../scene/canvas-model.js';
import { registerEscapeLayer } from '../../../../../shared/escape.js';
import './reading-marker.css';

interface Stroke {
  id: number;
  points: Point[];
  width: number;
  fading: boolean;
}
interface Draft {
  pointerId: number;
  points: Point[];
  width: number;
}
export interface ReadingMarkerProps {
  viewport: Viewport;
  active: boolean;
  scopeKey: string;
  clearRevision?: number;
  navigationActive?: boolean;
  clip?: Rect;
  onDrawingChange?: (drawing: boolean) => void;
}

const HOLD_MS = 3000;
const FADE_MS = 450;
const path = (points: Point[]) =>
  points.length === 1
    ? `M${points[0]!.x} ${points[0]!.y} l.01 0`
    : points.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${point.y}`).join(' ');

export default function ReadingMarker({
  scopeKey,
  clearRevision = 0,
  ...props
}: ReadingMarkerProps) {
  return <ReadingMarkerSurface key={`${scopeKey}:${clearRevision}`} {...props} />;
}

function ReadingMarkerSurface({
  viewport,
  active,
  navigationActive = false,
  clip,
  onDrawingChange,
}: Omit<ReadingMarkerProps, 'scopeKey' | 'clearRevision'>) {
  const root = useRef<HTMLDivElement>(null);
  const reportDrawing = useRef(onDrawingChange);
  const drawing = useRef<Draft | null>(null);
  const frame = useRef<number | undefined>(undefined);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, { fade: number; remove: number }>());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const drawingEnabled = active && !navigationActive;
  const [previousDrawingEnabled, setPreviousDrawingEnabled] = useState(drawingEnabled);
  if (drawingEnabled !== previousDrawingEnabled) {
    setPreviousDrawingEnabled(drawingEnabled);
    if (!drawingEnabled) {
      setDraft(null);
    }
  }

  useLayoutEffect(() => {
    reportDrawing.current = onDrawingChange;
  }, [onDrawingChange]);
  const cancelFrame = useCallback(() => {
    if (frame.current !== undefined) {
      window.cancelAnimationFrame(frame.current);
    }

    frame.current = undefined;
  }, []);
  const release = useCallback((pointerId: number) => {
    if (root.current?.hasPointerCapture(pointerId)) {
      root.current.releasePointerCapture(pointerId);
    }
  }, []);
  const endDrawing = useCallback(() => {
    const current = drawing.current;
    if (!current) {
      return false;
    }

    drawing.current = null;
    cancelFrame();
    release(current.pointerId);
    reportDrawing.current?.(false);

    return true;
  }, [cancelFrame, release]);
  const cancelDraft = useCallback(() => {
    if (!endDrawing()) {
      return false;
    }

    setDraft(null);

    return true;
  }, [endDrawing]);
  useLayoutEffect(() => {
    if (!drawingEnabled) {
      endDrawing();
    }
  }, [drawingEnabled, endDrawing]);
  useLayoutEffect(() => {
    const handles = timers.current;
    window.addEventListener('blur', cancelDraft);

    return () => {
      window.removeEventListener('blur', cancelDraft);
      for (const timer of handles.values()) {
        window.clearTimeout(timer.fade);
        window.clearTimeout(timer.remove);
      }

      handles.clear();
      endDrawing();
    };
  }, [cancelDraft, endDrawing]);
  const hasDraft = draft !== null;
  useEffect(() => {
    if (hasDraft && root.current) {
      return registerEscapeLayer(root.current, cancelDraft, 30);
    }
  }, [hasDraft, cancelDraft]);
  function point(event: { clientX: number; clientY: number }): Point {
    const bounds = root.current!.getBoundingClientRect();

    return {
      x: (event.clientX - bounds.left - viewport.x) / viewport.zoom,
      y: (event.clientY - bounds.top - viewport.y) / viewport.zoom,
    };
  }

  function addPoint(event: { clientX: number; clientY: number }) {
    const current = drawing.current;
    if (!current) {
      return;
    }

    const next = point(event);
    const previous = current.points.at(-1)!;
    if (Math.hypot(next.x - previous.x, next.y - previous.y) * viewport.zoom >= 0.8) {
      current.points.push(next);
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!drawingEnabled || event.button !== 0 || drawing.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const next = { pointerId: event.pointerId, points: [point(event)], width: 14 / viewport.zoom };
    drawing.current = next;
    setDraft({ ...next, points: [...next.points] });
    event.currentTarget.setPointerCapture(event.pointerId);
    reportDrawing.current?.(true);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drawing.current || event.pointerId !== drawing.current.pointerId) {
      return;
    }

    for (const sample of event.nativeEvent.getCoalescedEvents?.() ?? []) {
      addPoint(sample);
    }

    addPoint(event);
    if (frame.current !== undefined) {
      return;
    }

    frame.current = window.requestAnimationFrame(() => {
      frame.current = undefined;
      if (drawing.current) {
        setDraft({ ...drawing.current, points: [...drawing.current.points] });
      }
    });
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    const current = drawing.current;
    if (!current || event.pointerId !== current.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    addPoint(event);
    cancelDraft();
    const id = ++nextId.current;
    setStrokes((previous) => [
      ...previous,
      { id, points: current.points, width: current.width, fading: false },
    ]);
    const fade = window.setTimeout(
      () =>
        setStrokes((previous) =>
          previous.map((stroke) => (stroke.id === id ? { ...stroke, fading: true } : stroke)),
        ),
      HOLD_MS,
    );
    const remove = window.setTimeout(() => {
      setStrokes((previous) => previous.filter((stroke) => stroke.id !== id));
      timers.current.delete(id);
    }, HOLD_MS + FADE_MS);
    timers.current.set(id, { fade, remove });
  }

  function handlePointerCancel(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerId === drawing.current?.pointerId) {
      cancelDraft();
    }
  }

  return (
    <div
      ref={root}
      className={`studio-reading-marker${active ? ' is-active' : ''}${navigationActive ? ' is-navigating' : ''}`}
      style={{
        pointerEvents: active ? 'auto' : 'none',
        clipPath: clip
          ? `polygon(${clip.x}px ${clip.y}px, ${clip.x + clip.w}px ${clip.y}px, ${clip.x + clip.w}px ${clip.y + clip.h}px, ${clip.x}px ${clip.y + clip.h}px)`
          : undefined,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
    >
      <svg width="100%" height="100%" aria-hidden="true">
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
          {strokes.map((stroke) => (
            <path
              key={stroke.id}
              className={stroke.fading ? 'is-fading' : ''}
              d={path(stroke.points)}
              strokeWidth={stroke.width}
            />
          ))}
          {draft && (
            <path className="is-drawing" d={path(draft.points)} strokeWidth={draft.width} />
          )}
        </g>
      </svg>
    </div>
  );
}
