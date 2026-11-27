import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { CanvasRect } from '../contracts.js';
import { mergeRects, rectsIntersect, type CanvasViewportSize } from '../viewport/index.js';

const margin = 12;
const gap = 8;
const titleSelector = '[data-canvas-external-title], [data-canvas-section-title]';
const handleSelector = '[data-canvas-handle], [data-canvas-port], [data-canvas-connector-handle]';

function placeToolbar(
  anchor: CanvasRect,
  size: CanvasViewportSize,
  viewport: CanvasViewportSize,
  obstacles: readonly CanvasRect[],
) {
  const right = viewport.width - margin;
  const bottom = viewport.height - margin - size.height;
  const width = Math.min(size.width, right - margin);
  if (size.height <= 0 || width <= 0 || bottom < margin) {
    return;
  }

  const center = anchor.x + anchor.width / 2;
  const above = anchor.y - gap - size.height;
  const below = anchor.y + anchor.height + gap;
  const fallbackRows = [
    margin,
    bottom,
    ...obstacles.flatMap((rect) => [rect.y - gap - size.height, rect.y + rect.height + gap]),
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
      if (y + size.height + gap <= obstacle.y || y >= obstacle.y + obstacle.height + gap) {
        continue;
      }

      const end = Math.min(right, obstacle.x - gap);
      if (end > left) {
        slots.push({ left, right: end });
      }
      left = Math.max(left, obstacle.x + obstacle.width + gap);
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

    compact ??= candidates.find((candidate) => candidate.width >= Math.min(144, width));
  }

  return compact;
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

function titleRect(title: Element, canvas: DOMRect) {
  const bounds = title.getBoundingClientRect();
  if (!title.textContent?.trim() || !visibleRect(bounds, canvas)) {
    return undefined;
  }

  const range = title.ownerDocument.createRange();
  range.selectNodeContents(title);

  return visibleRect(range.getBoundingClientRect?.() ?? bounds, canvas, bounds);
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
      const nearbyTitles: CanvasRect[] = [];
      for (const title of titles) {
        const rect = titleRect(title, canvasBounds);
        if (!rect) {
          continue;
        }

        const id = title.closest('[data-canvas-object]')?.getAttribute('data-canvas-object');
        const bucket = id && selected.has(id) ? selectedTitles : nearbyTitles;
        bucket.push(rect);
      }

      const target = mergeRects([anchor, ...handleBounds, ...selectedTitles]) ?? anchor;
      const obstacles = [...controlBounds, ...handleBounds, ...selectedTitles, ...nearbyTitles];
      const visible = rectsIntersect(target, { x: 0, y: 0, ...viewportSize });
      const position =
        visible &&
        (placeToolbar(target, size, viewportSize, [anchor, ...obstacles]) ??
          placeToolbar(target, size, viewportSize, obstacles));
      node.style.visibility = position ? 'visible' : 'hidden';
      if (position) {
        node.style.left = position.x + 'px';
        node.style.top = position.y + 'px';
        node.style.maxInlineSize = position.width + 'px';
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
