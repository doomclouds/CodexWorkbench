import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { flushSync } from 'react-dom';
import type { Viewport } from '../scene/canvas-model.js';

type ViewportUpdate = SetStateAction<Viewport>;

function applyViewportUpdate(viewport: Viewport, update: ViewportUpdate) {
  return typeof update === 'function' ? update(viewport) : update;
}

export function useCanvasCamera(initial: Viewport) {
  const [viewport, commitViewport] = useState(initial);
  const pending = useRef<ViewportUpdate[]>([]);
  const frame = useRef<number | null>(null);
  const takePending = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }

    const updates = pending.current;
    pending.current = [];
    return updates;
  }, []);
  const flushViewport = useCallback(() => {
    const updates = takePending();
    if (updates.length) {
      commitViewport((current) => updates.reduce(applyViewportUpdate, current));
    }
  }, [takePending]);
  const scheduleViewport = useCallback(
    (update: ViewportUpdate) => {
      pending.current.push(update);
      if (frame.current === null) {
        frame.current = requestAnimationFrame(() => flushSync(flushViewport));
      }
    },
    [flushViewport],
  );
  const setViewport = useCallback(
    (update: ViewportUpdate) => {
      const updates = takePending();
      commitViewport((current) =>
        applyViewportUpdate(updates.reduce(applyViewportUpdate, current), update),
      );
    },
    [takePending],
  );
  useEffect(
    () => () => {
      takePending();
    },
    [takePending],
  );

  return { viewport, setViewport, scheduleViewport, flushViewport };
}
