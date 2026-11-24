import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type {
  CanvasCreateIntent,
  CanvasDuplicateIntent,
  CanvasEditIntent,
  CanvasPoint,
  CanvasRect,
  CanvasViewport,
} from './contracts.js';
import type { AlignmentGuide } from './gestures/index.js';
import { normalizeViewport } from './viewport/index.js';
import type { CanvasViewportSize } from './viewport/index.js';

type CanvasRoot = RefObject<HTMLDivElement | null>;

export interface CanvasFrame {
  viewport: CanvasViewport;
  preview?: Extract<CanvasEditIntent, { changes: readonly unknown[] }>;
  draft?: CanvasCreateIntent | CanvasDuplicateIntent;
  marquee?: CanvasRect;
  guides?: readonly AlignmentGuide[];
  ports?: readonly CanvasPoint[];
  activePort?: CanvasPoint;
}

interface ScheduledFrame {
  view: Window;
  id: number;
}

export interface CanvasFrameController {
  read: () => CanvasFrame;
  update: (next: CanvasFrame, timing?: 'now' | 'frame') => void;
  draw: (resolve: () => CanvasFrame) => void;
}

export function useCanvasFrame(root: CanvasRoot, initialViewport?: CanvasViewport) {
  const [frame, setFrame] = useState<CanvasFrame>(() => ({
    viewport: normalizeViewport(initialViewport),
  }));
  const current = useRef(frame);
  const scheduled = useRef<ScheduledFrame | null>(null);
  const drawing = useRef<(() => CanvasFrame) | undefined>(undefined);

  const clearSchedule = useCallback(() => {
    const pending = scheduled.current;
    if (pending) {
      pending.view.cancelAnimationFrame(pending.id);
      scheduled.current = null;
    }
  }, []);

  useEffect(() => clearSchedule, [clearSchedule]);

  const commit = useCallback(() => {
    scheduled.current = null;
    const resolve = drawing.current;
    drawing.current = undefined;
    if (resolve) {
      current.current = resolve();
    }

    setFrame(current.current);
  }, []);

  const schedule = useCallback(() => {
    const view = root.current?.ownerDocument.defaultView;
    if (!view?.requestAnimationFrame) {
      commit();
    } else if (!scheduled.current) {
      scheduled.current = { view, id: view.requestAnimationFrame(commit) };
    }
  }, [root, commit]);

  const read = useCallback(() => current.current, []);
  const update = useCallback(
    (next: CanvasFrame, timing: 'now' | 'frame' = 'frame') => {
      drawing.current = undefined;
      current.current = next;
      if (timing === 'now') {
        clearSchedule();
        commit();
        return;
      }

      schedule();
    },
    [clearSchedule, commit, schedule],
  );
  const draw = useCallback(
    (resolve: () => CanvasFrame) => {
      drawing.current = resolve;
      schedule();
    },
    [schedule],
  );

  return { frame, read, update, draw };
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
