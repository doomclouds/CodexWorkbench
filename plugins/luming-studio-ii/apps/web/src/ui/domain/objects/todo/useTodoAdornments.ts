import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { ScrollRegionPosition } from '../../../base/index.js';

interface AdornmentBox {
  id: string;
  top: number;
  left: number;
  width: number;
  height: number;
}

function sameBox(left: AdornmentBox, right: AdornmentBox) {
  return (
    left.id === right.id &&
    left.top === right.top &&
    left.left === right.left &&
    left.width === right.width &&
    left.height === right.height
  );
}

function readBoxes(
  list: HTMLUListElement,
  height: number,
  scroll: ScrollRegionPosition,
  adornments: ReadonlyMap<string, ReactNode>,
) {
  return Array.from(list.children).flatMap((node) => {
    if (!(node instanceof HTMLLIElement)) {
      return [];
    }

    const id = node.dataset.todoItemId;
    const top = node.offsetTop - scroll.top;
    const visible = top < height && top + node.offsetHeight > 0;
    if (!id || !adornments.has(id) || !visible) {
      return [];
    }

    return [
      {
        id,
        top,
        left: node.offsetLeft - scroll.left,
        width: node.offsetWidth,
        height: node.offsetHeight,
      },
    ];
  });
}

function sameBoxes(left: readonly AdornmentBox[], right: readonly AdornmentBox[]) {
  return (
    left.length === right.length &&
    left.every((box, index) => {
      const other = right[index];

      return other !== undefined && sameBox(box, other);
    })
  );
}

export function useTodoAdornments(
  wrapper: RefObject<HTMLDivElement | null>,
  list: RefObject<HTMLUListElement | null>,
  adornments: ReadonlyMap<string, ReactNode>,
) {
  const position = useRef<ScrollRegionPosition>({ top: 0, left: 0 });
  const [boxes, setBoxes] = useState<readonly AdornmentBox[]>([]);
  const measure = useCallback(() => {
    const rows = list.current;
    const height = wrapper.current?.clientHeight ?? 0;
    if (!rows || height === 0 || adornments.size === 0) {
      return;
    }

    const next = readBoxes(rows, height, position.current, adornments);
    setBoxes((previous) => (sameBoxes(previous, next) ? previous : next));
  }, [adornments, list, wrapper]);

  function onScroll(scroll: ScrollRegionPosition) {
    position.current = scroll;
    measure();
  }

  useLayoutEffect(() => {
    const host = wrapper.current;
    const view = host?.ownerDocument.defaultView;
    if (!view || !host || adornments.size === 0) {
      return;
    }

    const frame = view.requestAnimationFrame(measure);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : undefined;
    observer?.observe(host);
    if (list.current) {
      observer?.observe(list.current);
    }

    return () => {
      view.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [adornments, list, measure, wrapper]);

  return { onScroll, boxes };
}
