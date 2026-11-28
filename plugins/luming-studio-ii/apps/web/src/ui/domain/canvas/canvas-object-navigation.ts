import { useRef, useState } from 'react';
import type { RefObject } from 'react';
import { containerOrigin, wheelZoomFactor } from './canvas-events.js';
import type { CanvasFrameController } from './canvas-frame.js';
import type {
  CanvasObjectNavigation,
  CanvasPoint,
  CanvasViewport,
  CanvasViewportNavigation,
} from './contracts.js';
import { panViewport, zoomViewport } from './viewport/index.js';

interface EmbeddedPan {
  id: string;
  pointerId: number;
  start: CanvasPoint;
  viewport: CanvasViewport;
  reported?: boolean;
}

export function useObjectNavigation(
  root: RefObject<HTMLDivElement | null>,
  frame: CanvasFrameController,
  setSpace: (held: boolean) => void,
  onViewportNavigation?: (navigation: CanvasViewportNavigation) => void,
) {
  const pan = useRef<EmbeddedPan | undefined>(undefined);
  const [panning, setPanning] = useState(false);

  function stop() {
    if (pan.current) {
      pan.current = undefined;
      setPanning(false);
    }
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
      setPanning(true);

      return;
    }
    if (current?.id !== id || current.pointerId !== event.pointerId) {
      return;
    }

    if (event.phase !== 'cancel') {
      const delta = { x: event.screenX - current.start.x, y: event.screenY - current.start.y };
      const moved = delta.x !== 0 || delta.y !== 0;
      if (moved && !current.reported) {
        current.reported = true;
        onViewportNavigation?.('pan');
      }
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
    const factor = wheelZoomFactor(event.deltaY, event.deltaMode);
    if (factor !== 1) {
      onViewportNavigation?.('zoom');
    }
    frame.update({
      viewport: zoomViewport(frame.read().viewport, anchor, factor),
      continuousZoom: true,
    });
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

  return { navigate, panning, stop };
}
