import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { CanvasRect } from '../contracts.js';
import { mergeRects, rectsIntersect, type CanvasViewportSize } from '../viewport/index.js';

const margin = 12;
const gap = 8;
const tightGap = 4;
const titleSelector = '[data-canvas-external-title], [data-canvas-section-title]';
const handleSelector = '[data-canvas-handle], [data-canvas-port], [data-canvas-connector-handle]';

function wider(first?: CanvasRect, second?: CanvasRect) {
  return second && (!first || second.width > first.width) ? second : first;
}

function placeToolbar(
  anchor: CanvasRect,
  size: CanvasViewportSize,
  viewport: CanvasViewportSize,
  obstacles: readonly CanvasRect[],
  spacing = gap,
) {
  const right = viewport.width - margin;
  const bottom = viewport.height - margin - size.height;
  const width = Math.min(size.width, right - margin);
  if (size.height <= 0 || width <= 0 || bottom < margin) {
    return;
  }

  const center = anchor.x + anchor.width / 2;
  const above = anchor.y - spacing - size.height;
  const below = anchor.y + anchor.height + spacing;
  const fallbackRows = [
    margin,
    bottom,
    ...obstacles.flatMap((rect) => [
      rect.y - spacing - size.height,
      rect.y + rect.height + spacing,
    ]),
  ].sort((a, b) => Math.abs(a - above) - Math.abs(b - above));
  const rows = new Set([above, below, ...fallbackRows]);
  const sortedObstacles = [...obstacles].sort((a, b) => a.x - b.x);
  let compact: CanvasRect | undefined;
  for (const y of rows) {
    if (y < margin || y > bottom) {
      continue;
    }

    const slots: Array<{ left: number; right: number }> = [];
    let left = margin;
    for (const obstacle of sortedObstacles) {
      if (y + size.height + spacing <= obstacle.y || y >= obstacle.y + obstacle.height + spacing) {
        continue;
      }

      const end = Math.min(right, obstacle.x - spacing);
      if (end > left) {
        slots.push({ left, right: end });
      }
      left = Math.max(left, obstacle.x + obstacle.width + spacing);
    }
    if (left < right) {
      slots.push({ left, right });
    }
    const candidates = slots
      .map((slot) => {
        const available = Math.min(width, slot.right - slot.left);
        const x = Math.max(slot.left, Math.min(center - available / 2, slot.right - available));

        return { x, y, width: available, height: size.height };
      })
      .sort((a, b) => Math.abs(a.x + a.width / 2 - center) - Math.abs(b.x + b.width / 2 - center));
    const full = candidates.find((candidate) => candidate.width === width);
    if (full) {
      return full;
    }

    compact = candidates.reduce(
      (best, candidate) =>
        candidate.width >= Math.min(144, width) ? wider(best, candidate) : best,
      compact,
    );
  }

  return compact;
}

function chooseToolbar(
  target: CanvasRect,
  size: CanvasViewportSize,
  viewport: CanvasViewportSize,
  anchor: CanvasRect,
  obstacles: readonly CanvasRect[],
) {
  const requiredWidth = Math.min(size.width, viewport.width - margin * 2);
  const preferred = placeToolbar(target, size, viewport, [anchor, ...obstacles]);
  if (preferred?.width === requiredWidth) {
    return preferred;
  }

  const withoutFrame = wider(preferred, placeToolbar(target, size, viewport, obstacles));
  if (withoutFrame?.width === requiredWidth) {
    return withoutFrame;
  }

  return wider(withoutFrame, placeToolbar(target, size, viewport, obstacles, tightGap));
}

function visibleRect(bounds: DOMRect, canvas: DOMRect, clip = canvas): CanvasRect | undefined {
  const left = Math.max(bounds.left, canvas.left, clip.left);
  const top = Math.max(bounds.top, canvas.top, clip.top);
  const width = Math.min(bounds.right, canvas.right, clip.right) - left;
  const height = Math.min(bounds.bottom, canvas.bottom, clip.bottom) - top;

  return width > 0 && height > 0
    ? { x: left - canvas.left, y: top - canvas.top, width, height }
    : undefined;
}

function titleRect(title: Element, canvas: DOMRect, row?: CanvasRect) {
  const bounds = title.getBoundingClientRect();
  const grip = title.querySelector('[data-canvas-drag-surface="title"]');
  const gripRect = grip ? visibleRect(grip.getBoundingClientRect(), canvas) : undefined;
  const outer = visibleRect(bounds, canvas);
  if (!outer || (row && !rectsIntersect(row, outer))) {
    return gripRect;
  }
  if (!title.textContent?.trim()) {
    return gripRect;
  }

  const range = title.ownerDocument.createRange();
  range.selectNodeContents(title);

  const text = visibleRect(range.getBoundingClientRect?.() ?? bounds, canvas, bounds);
  return gripRect && text ? mergeRects([gripRect, text]) : (gripRect ?? text);
}

function positionAgainstTitles(
  anchor: CanvasRect,
  target: CanvasRect,
  size: CanvasViewportSize,
  viewport: CanvasViewportSize,
  canvas: DOMRect,
  controls: readonly CanvasRect[],
  titles: readonly Element[],
) {
  const y = target.y - gap - size.height;
  const row = { x: 0, y: y - gap, width: viewport.width, height: size.height + 2 * gap };
  const obstacles = (band?: CanvasRect) => [
    ...controls,
    ...titles.flatMap((title) => titleRect(title, canvas, band) ?? []),
  ];

  if (y >= margin && y + size.height <= viewport.height - margin) {
    const top = placeToolbar(target, size, viewport, [anchor, ...obstacles(row)]);
    if (top?.y === y && top.width === Math.min(size.width, viewport.width - 2 * margin)) {
      return top;
    }
  }

  return chooseToolbar(target, size, viewport, anchor, obstacles());
}

interface SelectionToolbarProps {
  readonly anchor: CanvasRect;
  readonly selectionIds: readonly string[];
  readonly viewportSize: CanvasViewportSize;
  readonly children: ReactNode;
}

export function SelectionToolbar({
  anchor,
  selectionIds,
  viewportSize,
  children,
}: SelectionToolbarProps) {
  const toolbar = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = toolbar.current;
    const canvas = node?.closest('[data-canvas-root]');
    if (!node || !canvas) {
      return;
    }

    const host = canvas.closest('[data-canvas-toolbar-scope]');
    const fixed = [...(host?.querySelectorAll('[data-canvas-toolbar-obstacle]') ?? [])];
    const handles = [...(node.parentElement?.querySelectorAll(handleSelector) ?? [])];
    const titles = [...canvas.querySelectorAll(titleSelector)];
    const selected = new Set(selectionIds);

    const place = () => {
      const canvasBounds = canvas.getBoundingClientRect();
      node.style.removeProperty('max-inline-size');
      node.removeAttribute('data-canvas-toolbar-compact');
      node.removeAttribute('data-canvas-toolbar-wrapped');
      const bounds = node.getBoundingClientRect();
      const size = {
        width: bounds.width + Math.max(0, node.scrollWidth - node.clientWidth),
        height: bounds.height,
      };
      const absolute = (elements: readonly Element[]) =>
        elements.flatMap(
          (element) => visibleRect(element.getBoundingClientRect(), canvasBounds) ?? [],
        );
      const controlBounds = absolute(fixed);
      const handleBounds = absolute(handles);
      const selectedTitles: CanvasRect[] = [];
      const nearbyTitles: Element[] = [];
      for (const title of titles) {
        const id = title.closest('[data-canvas-object]')?.getAttribute('data-canvas-object');
        if (id && selected.has(id)) {
          const rect = titleRect(title, canvasBounds);
          if (rect) {
            selectedTitles.push(rect);
          }
        } else {
          nearbyTitles.push(title);
        }
      }

      const target = mergeRects([anchor, ...handleBounds, ...selectedTitles]) ?? anchor;
      const controls = [...controlBounds, ...handleBounds, ...selectedTitles];
      const visible = rectsIntersect(target, { x: 0, y: 0, ...viewportSize });
      let position =
        visible &&
        positionAgainstTitles(
          anchor,
          target,
          size,
          viewportSize,
          canvasBounds,
          controls,
          nearbyTitles,
        );
      node.style.visibility = position ? 'visible' : 'hidden';
      if (position) {
        node.toggleAttribute('data-canvas-toolbar-compact', position.width < size.width);
        node.style.maxInlineSize = position.width + 'px';

        if (node.scrollWidth > node.clientWidth) {
          node.setAttribute('data-canvas-toolbar-wrapped', '');
          const wrapped = { width: position.width, height: node.getBoundingClientRect().height };
          const preferred = positionAgainstTitles(
            anchor,
            target,
            wrapped,
            viewportSize,
            canvasBounds,
            controls,
            nearbyTitles,
          );
          const fit =
            preferred?.width === wrapped.width
              ? preferred
              : placeToolbar(target, wrapped, viewportSize, controlBounds);
          position =
            fit?.width === wrapped.width
              ? fit
              : {
                  ...position,
                  y: Math.max(
                    margin,
                    Math.min(position.y, viewportSize.height - wrapped.height - margin),
                  ),
                };
        }

        node.style.left = position.x + 'px';
        node.style.top = position.y + 'px';
      }
    };

    place();
    const Observer = node.ownerDocument.defaultView?.ResizeObserver;
    const observer = Observer ? new Observer(place) : undefined;
    for (const element of [node, canvas, ...fixed, ...titles]) {
      observer?.observe(element);
    }

    return () => observer?.disconnect();
  }, [anchor, selectionIds, viewportSize]);

  return (
    <div
      ref={toolbar}
      className="studio-ui-canvas-selection-actions"
      data-canvas-controls=""
      data-canvas-selection-actions=""
      role="toolbar"
      aria-label="选区格式"
    >
      {children}
    </div>
  );
}
