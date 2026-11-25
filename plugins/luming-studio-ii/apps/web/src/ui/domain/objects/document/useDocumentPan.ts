import { useEffect, useEffectEvent, useRef } from 'react';
import type { KeyboardEvent, PointerEvent, RefObject } from 'react';
import type { ScrollRegionHandle } from '../../../base/index.js';
import type { DocumentActivity } from './contracts.js';

interface PanPoint {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

const nativeInput = 'input,textarea,button,select,[contenteditable]';
const zoomKeys = new Set(['+', '=', '-', '0']);

export function useDocumentPan(
  mode: DocumentActivity['mode'],
  body: RefObject<HTMLElement | null>,
  scroll: RefObject<ScrollRegionHandle | null>,
) {
  const held = useRef(false);
  const drag = useRef<PanPoint | undefined>(undefined);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (mode === 'inline') {
      return;
    }

    const command = event.ctrlKey || event.metaKey;
    if (command && zoomKeys.has(event.key)) {
      event.preventDefault();
      event.stopPropagation();

      return;
    }

    const keyTarget = event.target;
    const isControl = keyTarget instanceof Element && keyTarget.closest(nativeInput);
    if (mode === 'read' && event.code === 'Space' && !isControl) {
      event.preventDefault();
      held.current = true;
    }
  }

  function handleKeyUp(event: KeyboardEvent<HTMLDivElement>) {
    if (event.code === 'Space') {
      held.current = false;
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    const plainPress = held.current && event.button === 0;
    const panRequested = plainPress || event.button === 1;
    const target = event.target;
    const scrollElement = body.current?.parentElement;
    const insidePaper = target instanceof Node && scrollElement?.contains(target);
    if (mode !== 'read' || !panRequested || !insidePaper) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const track = drag.current;
    if (!track || track.id !== event.pointerId) {
      return;
    }

    event.preventDefault();
    scroll.current?.scrollBy({ left: track.x - event.clientX, top: track.y - event.clientY });
    drag.current = { id: track.id, x: event.clientX, y: event.clientY };
  }

  function handlePointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id === event.pointerId) {
      drag.current = undefined;
    }
  }

  function resetDrag() {
    held.current = false;
    drag.current = undefined;
  }

  const stopModifiedWheel = useEffectEvent((event: WheelEvent) => {
    if (mode !== 'inline' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
    }
  });
  useEffect(() => {
    const element = body.current?.parentElement;
    if (element) {
      function handleWheel(event: WheelEvent) {
        stopModifiedWheel(event);
      }
      element.addEventListener('wheel', handleWheel, { passive: false });

      return () => element.removeEventListener('wheel', handleWheel);
    }
  }, [body, mode]);

  return {
    handleKeyDown,
    handleKeyUp,
    handlePointerDown,
    handlePointerMove,
    handlePointerEnd,
    resetDrag,
  };
}
