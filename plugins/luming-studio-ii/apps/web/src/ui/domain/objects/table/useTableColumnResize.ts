import { useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';

import { resizeColumn } from './table-model.js';
import type { TableModel } from './table-model.js';

interface ColumnGesture {
  readonly pointerId: number;
  readonly start: number;
  readonly scale: number;
  readonly column: number;
  readonly initial: TableModel;
  readonly version: number;
}

function resizePreview(gesture: ColumnGesture, position: number) {
  return resizeColumn(gesture.initial, gesture.column, (position - gesture.start) / gesture.scale);
}

export function useTableColumnResize(enabled: boolean, zoom: number, version: number) {
  const active = useRef<ColumnGesture | null>(null);
  const [preview, setPreview] = useState<TableModel | null>(null);
  const visible = enabled ? preview : null;

  function clear() {
    active.current = null;
    setPreview(null);
  }

  const clearUnavailable = useEffectEvent(() => {
    if (active.current && (!enabled || active.current.version !== version)) {
      clear();
    }
  });
  useLayoutEffect(() => {
    clearUnavailable();
  }, [enabled, version]);

  function start(
    event: PointerEvent<HTMLDivElement>,
    column: number,
    initial: TableModel,
    measuredWidth: number,
  ) {
    if (!enabled || event.button !== 0 || active.current) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    active.current = {
      pointerId: event.pointerId,
      start: event.clientX,
      scale: measuredWidth > 0 ? measuredWidth / initial.width : zoom,
      column,
      initial,
      version,
    };
    setPreview(initial);
  }

  function handleMove(event: PointerEvent<HTMLDivElement>) {
    const gesture = active.current;
    if (!enabled || gesture?.pointerId !== event.pointerId) {
      return;
    }

    event.stopPropagation();
    setPreview(resizePreview(gesture, event.clientX));
  }

  function end(event: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const gesture = active.current;
    if (gesture?.pointerId !== event.pointerId) {
      return undefined;
    }

    event.stopPropagation();
    clear();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    return !cancelled && enabled ? resizePreview(gesture, event.clientX) : undefined;
  }

  return { preview: visible, resizing: visible !== null, start, handleMove, end };
}
