import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent, RefObject } from 'react';

import type { CanvasPoint, CanvasViewport } from '../../ui/domain/canvas/index.js';

interface Line {
  readonly points: CanvasPoint[];
  readonly width: number;
}

interface Draft extends Line {
  readonly pointerId: number;
}

interface Stroke extends Line {
  readonly id: number;
  readonly fading: boolean;
}

interface StrokeTimers {
  readonly fade: ReturnType<typeof setTimeout>;
  readonly remove: ReturnType<typeof setTimeout>;
}

interface PendingFrame {
  readonly id: number;
  readonly owner: Window;
}

const holdMs = 3000;
const fadeMs = 450;
const markerWidth = 14;
const minSampleDistance = 0.8;
const chrome = '[data-whiteboard-viewing-chrome], dialog[open]';

function isReadingChrome({ currentTarget, target }: PointerEvent<HTMLDivElement>) {
  const ElementType = currentTarget.ownerDocument.defaultView?.Element;

  return ElementType && target instanceof ElementType && Boolean(target.closest(chrome));
}

export function viewingLine(points: readonly CanvasPoint[]): string {
  const first = points[0];
  if (!first) {
    return '';
  }
  if (points.length === 1) {
    return `M${first.x} ${first.y} l.01 0`;
  }

  return points.map(({ x, y }, index) => `${index ? 'L' : 'M'}${x} ${y}`).join(' ');
}

export function useViewingInk(
  root: RefObject<HTMLDivElement | null>,
  viewport: CanvasViewport,
  active: boolean,
) {
  const [showing, setShowing] = useState(active);
  const [draft, setDraft] = useState<Line>();
  const [strokes, setStrokes] = useState<readonly Stroke[]>([]);
  const drawing = useRef<Draft | undefined>(undefined);
  const frame = useRef<PendingFrame | undefined>(undefined);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, StrokeTimers>());

  if (showing !== active) {
    setShowing(active);
    setDraft(undefined);
    setStrokes([]);
  }

  const detach = useCallback(() => {
    const current = drawing.current;
    drawing.current = undefined;
    const scheduled = frame.current;
    frame.current = undefined;
    if (scheduled) {
      scheduled.owner.cancelAnimationFrame(scheduled.id);
    }
    if (current && root.current?.hasPointerCapture?.(current.pointerId)) {
      root.current.releasePointerCapture(current.pointerId);
    }

    return current;
  }, [root]);

  const cancel = useCallback(() => {
    if (!detach()) {
      return false;
    }

    setDraft(undefined);

    return true;
  }, [detach]);

  const cancelTimers = useCallback(() => {
    for (const { fade, remove } of timers.current.values()) {
      clearTimeout(fade);
      clearTimeout(remove);
    }

    timers.current.clear();
  }, []);

  useLayoutEffect(() => {
    if (!active) {
      return;
    }

    const owner = root.current?.ownerDocument.defaultView;
    owner?.addEventListener('blur', cancel);

    return () => {
      owner?.removeEventListener('blur', cancel);
      detach();
      cancelTimers();
    };
  }, [active, cancel, cancelTimers, detach, root]);

  function clear() {
    cancel();
    cancelTimers();
    setStrokes([]);
  }

  function addPoint(current: Draft, next: CanvasPoint) {
    const previous = current.points.at(-1);
    if (
      previous &&
      Math.hypot(next.x - previous.x, next.y - previous.y) * viewport.zoom >= minSampleDistance
    ) {
      current.points.push(next);
    }
  }

  function toWorld(x: number, y: number, bounds: DOMRect): CanvasPoint {
    return {
      x: (x - bounds.left - viewport.x) / viewport.zoom,
      y: (y - bounds.top - viewport.y) / viewport.zoom,
    };
  }

  function begin(event: PointerEvent<HTMLDivElement>) {
    const available = active && drawing.current === undefined;
    const primary = event.button === 0 && event.isPrimary !== false;
    if (!available || !primary || event.defaultPrevented) {
      return false;
    }
    if (isReadingChrome(event)) {
      return false;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const current = {
      pointerId: event.pointerId,
      points: [toWorld(event.clientX, event.clientY, bounds)],
      width: markerWidth / viewport.zoom,
    };
    drawing.current = current;
    setDraft({ ...current, points: [...current.points] });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();

    return true;
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const current = drawing.current;
    if (current?.pointerId !== event.pointerId) {
      return;
    }

    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    for (const sample of event.nativeEvent.getCoalescedEvents?.() ?? []) {
      addPoint(current, toWorld(sample.clientX, sample.clientY, bounds));
    }

    addPoint(current, toWorld(event.clientX, event.clientY, bounds));
    const owner = event.currentTarget.ownerDocument.defaultView;
    if (!owner || frame.current) {
      return;
    }

    const id = owner.requestAnimationFrame(() => {
      frame.current = undefined;
      setDraft({ ...current, points: [...current.points] });
    });
    frame.current = { id, owner };
  }

  function finish(event: PointerEvent<HTMLDivElement>) {
    const current = drawing.current;
    if (current?.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    addPoint(current, toWorld(event.clientX, event.clientY, bounds));
    cancel();

    nextId.current += 1;
    const id = nextId.current;
    setStrokes((previous) => [...previous, { ...current, id, fading: false }]);
    const fade = setTimeout(
      () =>
        setStrokes((previous) =>
          previous.map((stroke) => (stroke.id === id ? { ...stroke, fading: true } : stroke)),
        ),
      holdMs,
    );
    const remove = setTimeout(() => {
      setStrokes((previous) => previous.filter((stroke) => stroke.id !== id));
      timers.current.delete(id);
    }, holdMs + fadeMs);
    timers.current.set(id, { fade, remove });
  }

  function losePointer(event: PointerEvent<HTMLDivElement>) {
    if (drawing.current?.pointerId === event.pointerId) {
      cancel();
    }
  }

  return { begin, cancel, clear, draft, finish, losePointer, move, strokes };
}
