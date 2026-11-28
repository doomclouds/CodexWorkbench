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
  continuousZoom?: boolean;
  preview?: Extract<CanvasEditIntent, { changes: readonly unknown[] }>;
  draft?: CanvasCreateIntent | CanvasDuplicateIntent;
  placementHover?: { requestId: string; point: CanvasPoint };
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

function sameBareViewport(previous: CanvasFrame, next: CanvasFrame) {
  const bare = Object.keys(previous).length === 1 && Object.keys(next).length === 1;

  return bare && previous.viewport === next.viewport;
}

export function useCanvasFrame(
  root: CanvasRoot,
  initialViewport: CanvasViewport | undefined,
  present: (viewport: CanvasViewport) => void,
) {
  const [snapshot, setSnapshot] = useState<{ frame: CanvasFrame; viewportRequestId?: string }>(
    () => ({
      frame: { viewport: normalizeViewport(initialViewport) },
    }),
  );
  const { frame, viewportRequestId } = snapshot;
  const current = useRef(frame);
  const appliedRequest = useRef<string | undefined>(undefined);
  const committed = useRef(frame);
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
      if (sameBareViewport(committed.current, current.current)) {
        return;
      }
    }

    present(current.current.viewport);
    committed.current = current.current;
    const frame = current.current;
    const viewportRequestId = appliedRequest.current;
    setSnapshot((previous) =>
      previous.frame === frame && previous.viewportRequestId === viewportRequestId
        ? previous
        : { frame, viewportRequestId },
    );
  }, [present]);

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

  function applyViewportRequest(id: string, viewport: CanvasViewport) {
    appliedRequest.current = id;
    update({ viewport }, 'now');
  }

  return { frame, viewportRequestId, applyViewportRequest, read, update, draw };
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
