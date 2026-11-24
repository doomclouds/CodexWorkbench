import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { CanvasEditIntent, CanvasRect, CanvasViewport } from './contracts.js';
import { normalizeViewport } from './viewport/index.js';
import type { CanvasViewportSize } from './viewport/index.js';

type CanvasRoot = RefObject<HTMLDivElement | null>;

export interface CanvasFrame {
  viewport: CanvasViewport;
  preview?: CanvasEditIntent;
  marquee?: CanvasRect;
}

interface ScheduledFrame {
  view: Window;
  id: number;
}

export interface CanvasFrameController {
  read: () => CanvasFrame;
  update: (next: CanvasFrame, timing?: 'now' | 'frame') => void;
}

export function useCanvasFrame(root: CanvasRoot, initialViewport?: CanvasViewport) {
  const [frame, setFrame] = useState<CanvasFrame>(() => ({
    viewport: normalizeViewport(initialViewport),
  }));
  const current = useRef(frame);
  const scheduled = useRef<ScheduledFrame | null>(null);

  const clearSchedule = useCallback(() => {
    const pending = scheduled.current;
    if (pending) {
      pending.view.cancelAnimationFrame(pending.id);
      scheduled.current = null;
    }
  }, []);

  useEffect(() => clearSchedule, [clearSchedule]);

  const read = useCallback(() => current.current, []);
  const update = useCallback(
    (next: CanvasFrame, timing: 'now' | 'frame' = 'frame') => {
      current.current = next;
      const view = root.current?.ownerDocument.defaultView;
      if (timing === 'now' || !view?.requestAnimationFrame) {
        clearSchedule();
        setFrame(next);
        return;
      }
      if (scheduled.current) {
        return;
      }

      const id = view.requestAnimationFrame(() => {
        scheduled.current = null;
        setFrame(current.current);
      });
      scheduled.current = { view, id };
    },
    [clearSchedule, root],
  );

  return { frame, read, update };
}

export function useCanvasSize(root: CanvasRoot): CanvasViewportSize {
  const [size, setSize] = useState<CanvasViewportSize>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = root.current;
    const view = element?.ownerDocument.defaultView;
    if (!element || !view) {
      return;
    }

    const container = element;
    function measure() {
      const { width, height } = container.getBoundingClientRect();
      setSize((current) => {
        if (width === current.width && height === current.height) {
          return current;
        }

        return { width, height };
      });
    }

    measure();
    const observer =
      typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(measure) : undefined;
    observer?.observe(element);
    view.addEventListener('resize', measure);

    return () => {
      observer?.disconnect();
      view.removeEventListener('resize', measure);
    };
  }, [root]);

  return size;
}
