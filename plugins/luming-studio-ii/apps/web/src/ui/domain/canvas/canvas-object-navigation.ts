import { useRef } from 'react';
import type { RefObject } from 'react';
import { containerOrigin, wheelDelta, wheelZoomFactor } from './canvas-events.js';
import type { CanvasFrameController } from './canvas-frame.js';
import type { CanvasObjectNavigation, CanvasPoint, CanvasViewport } from './contracts.js';
import { panViewport, zoomViewport } from './viewport/index.js';
import type { CanvasViewportSize } from './viewport/index.js';

interface EmbeddedPan {
  id: string;
  pointerId: number;
  start: CanvasPoint;
  viewport: CanvasViewport;
}

export function useObjectNavigation(
  root: RefObject<HTMLDivElement | null>,
  frame: CanvasFrameController,
  size: CanvasViewportSize,
  setSpace: (held: boolean) => void,
) {
  const pan = useRef<EmbeddedPan | undefined>(undefined);

  function stop() {
    pan.current = undefined;
  }

  function applyPan(id: string, event: Extract<CanvasObjectNavigation, { kind: 'pan' }>) {
    const current = pan.current;
    if (event.phase === 'start') {
      pan.current = {
        id,
        pointerId: event.pointerId,
        start: { x: event.screenX, y: event.screenY },
        viewport: frame.read().viewport,
      };

      return;
    }
    if (current?.id !== id || current.pointerId !== event.pointerId) {
      return;
    }

    if (event.phase !== 'cancel') {
      const delta = { x: event.screenX - current.start.x, y: event.screenY - current.start.y };
      frame.update({ viewport: panViewport(current.viewport, delta) });
    }
    if (event.phase !== 'move') {
      stop();
    }
  }

  function applyZoom(event: Extract<CanvasObjectNavigation, { kind: 'zoom' }>) {
    const element = root.current;
    if (!element || pan.current) {
      return;
    }

    const origin = containerOrigin(element);
    const anchor = { x: event.x - origin.x, y: event.y - origin.y };
    const delta = wheelDelta({ deltaX: 0, deltaY: event.deltaY, deltaMode: event.deltaMode }, size);
    const factor = wheelZoomFactor(delta.y);
    frame.update({ viewport: zoomViewport(frame.read().viewport, anchor, factor) });
  }

  function navigate(id: string, event: CanvasObjectNavigation) {
    switch (event.kind) {
      case 'space':
        setSpace(event.held);
        break;
      case 'pan':
        applyPan(id, event);
        break;
      case 'zoom':
        applyZoom(event);
        break;
    }
  }

  return { navigate, stop };
}
