import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { BoardElement } from '../../../../../contracts/studio.js';
import {
  boundsOf,
  intersects,
  placeFormatToolbar,
  type Rect,
  type Viewport,
} from '../scene/canvas-model.js';
import { overviewSectionTitle } from '../scene/canvas-presentation.js';

function visibleRect(bounds: DOMRect, canvas: DOMRect): Rect | undefined {
  const x = Math.max(bounds.left, canvas.left);
  const y = Math.max(bounds.top, canvas.top);
  const w = Math.min(bounds.right, canvas.right) - x;
  const h = Math.min(bounds.bottom, canvas.bottom) - y;

  return w > 0 && h > 0 ? { x: x - canvas.left, y: y - canvas.top, w, h } : undefined;
}

function titleRect(title: HTMLElement, canvas: DOMRect): Rect | undefined {
  const editor = title.querySelector<HTMLElement>('[contenteditable="true"]');
  if (editor) {
    return visibleRect(editor.getBoundingClientRect(), canvas);
  }
  if (!title.textContent?.trim()) {
    return;
  }
  if (title.dataset.canvasExternalTitle === 'overview') {
    return visibleRect(title.getBoundingClientRect(), canvas);
  }

  const range = document.createRange();
  range.selectNodeContents(title);
  const text = range.getBoundingClientRect?.() ?? title.getBoundingClientRect();
  const bounds = title.getBoundingClientRect();
  const left = Math.max(text.left, bounds.left);
  const top = Math.max(text.top, bounds.top);

  return visibleRect(
    new DOMRect(
      left,
      top,
      Math.max(0, Math.min(text.right, bounds.right) - left),
      Math.max(0, Math.min(text.bottom, bounds.bottom) - top),
    ),
    canvas,
  );
}

interface PlacementOptions {
  trigger: RefObject<HTMLButtonElement | null>;
  selectionBounds: Rect;
  viewport: Viewport;
  elements: BoardElement[];
  titles?: readonly BoardElement[];
  editingTitle?: string;
  popover: string | null;
  onHidePopover: (value: null) => void;
}

export function useCanvasFormatToolbarPosition({
  trigger,
  selectionBounds,
  viewport,
  elements,
  titles,
  editingTitle,
  popover,
  onHidePopover,
}: PlacementOptions) {
  const toolbar = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = toolbar.current;
    const host = node?.parentElement;
    if (!node || !host) {
      return;
    }

    const controls = [
      ...host.querySelectorAll<HTMLElement>('.studio-canvas-top-tools, .studio-canvas-toolbar'),
    ];
    const scroller = node.querySelector<HTMLElement>('.studio-selection-toolbar-scroll')!;
    const selectedIds = new Set(elements.map((element) => element.id));
    const selectedHeaders = (titles ?? []).filter(
      (element) => selectedIds.has(element.id) || element.id === editingTitle,
    );
    const neighboringHeaders = (titles ?? [])
      .filter((element) => !selectedIds.has(element.id) && element.id !== editingTitle)
      .map((element) => {
        const bottom = viewport.y + element.y * viewport.zoom;
        const height =
          element.type === 'html'
            ? 48
            : Math.max(
                overviewSectionTitle.height + overviewSectionTitle.gap + 2,
                ((element.text?.length ?? 0) + 1) *
                  Math.max(32, (element.fontSize ?? 16) * 2 + 10) *
                  viewport.zoom,
              );

        return {
          id: element.id,
          bounds: {
            x: viewport.x + element.x * viewport.zoom,
            y: bottom - height,
            w: element.w * viewport.zoom,
            h: height,
          },
        };
      });
    const observedTitles = new Set<Element>();
    const place = () => {
      const measured = node.getBoundingClientRect();
      const canvas = host.getBoundingClientRect();
      if (!canvas.width || !canvas.height || !measured.width) {
        return;
      }

      const size = {
        w: measured.width + Math.max(0, scroller.scrollWidth - scroller.clientWidth),
        h: measured.height,
      };
      const area = { w: canvas.width, h: canvas.height };
      const selectedBox = {
        x: viewport.x + selectionBounds.x * viewport.zoom,
        y: viewport.y + selectionBounds.y * viewport.zoom,
        w: selectionBounds.w * viewport.zoom,
        h: selectionBounds.h * viewport.zoom,
      };
      const rectangles = (nodes: Iterable<Element>) =>
        [...nodes].flatMap((element) => visibleRect(element.getBoundingClientRect(), canvas) ?? []);
      const reserved = rectangles(controls);
      const chrome = rectangles(
        host.querySelectorAll(
          '.studio-selection-frame > button, .studio-connection-port, .studio-arrow-handle',
        ),
      );
      const nearbyNodes = new Set<Element>();
      const measuredTitles = new Set<string>();
      const measureTitle = (id: string) => {
        measuredTitles.add(id);
        const title = host.querySelector<HTMLElement>(
          `[data-element-id="${CSS.escape(id)}"] [data-canvas-external-title]`,
        );

        if (!title) {
          return;
        }

        nearbyNodes.add(title);

        return titleRect(title, canvas);
      };

      const selectedTitles = selectedHeaders.flatMap((element) => measureTitle(element.id) ?? []);
      const neighboringTitles: Rect[] = [];

      const measureNearby = (rect: Rect) => {
        const boxes = neighboringHeaders.flatMap((title) =>
          !measuredTitles.has(title.id) && intersects(title.bounds, rect)
            ? (measureTitle(title.id) ?? [])
            : [],
        );
        neighboringTitles.push(...boxes);

        return boxes;
      };

      const observeTitles = () => {
        for (const title of observedTitles) {
          if (!nearbyNodes.has(title)) {
            observer?.unobserve(title);
            observedTitles.delete(title);
          }
        }

        for (const title of nearbyNodes) {
          if (!observedTitles.has(title)) {
            observer?.observe(title);
            observedTitles.add(title);
          }
        }
      };

      const anchor = boundsOf([selectedBox, ...chrome, ...selectedTitles])!;
      const essential = [...reserved, ...chrome, ...selectedTitles];
      const solve = () => {
        const protectedArea = [...essential, ...neighboringTitles];

        return (
          placeFormatToolbar(anchor, size, area, [selectedBox, ...protectedArea]) ??
          placeFormatToolbar(anchor, size, area, protectedArea) ??
          placeFormatToolbar(anchor, size, area, essential)
        );
      };

      let next = solve();
      while (next) {
        const slot = { x: next.x - next.w / 2 - 8, y: next.y - 8, w: next.w + 16, h: size.h + 16 };
        if (!measureNearby(slot).some((rect) => intersects(rect, slot))) {
          break;
        }

        next = solve();
      }

      node.style.visibility = next ? 'visible' : 'hidden';
      if (!next) {
        observeTitles();

        return;
      }

      node.style.left = `${next.x}px`;
      node.style.top = `${next.y}px`;
      node.style.maxWidth = `${next.w}px`;
      const dialog = node.querySelector<HTMLElement>('.studio-format-popover');
      if (dialog) {
        const button = trigger.current;
        if (!button?.isConnected) {
          onHidePopover(null);

          return;
        }

        const bounds = node.getBoundingClientRect();
        const triggerBounds = button.getBoundingClientRect();
        const scrollBounds = scroller.getBoundingClientRect();
        if (
          scrollBounds.width &&
          (triggerBounds.right <= scrollBounds.left || triggerBounds.left >= scrollBounds.right)
        ) {
          onHidePopover(null);

          return;
        }

        const leftEdge = Math.max(canvas.left, 0) + 12;
        const rightEdge = Math.min(canvas.right, window.innerWidth) - 12;
        const topEdge = Math.max(canvas.top, 0) + 12;
        const bottomEdge = Math.min(canvas.bottom, window.innerHeight) - 12;
        const maxWidth = Math.max(0, rightEdge - leftEdge);
        dialog.style.maxWidth = `${maxWidth}px`;
        dialog.style.minWidth = `${Math.min(220, maxWidth)}px`;
        const panelBounds = dialog.getBoundingClientRect();
        const height = dialog.scrollHeight + panelBounds.height - dialog.clientHeight;
        const left = Math.max(
          leftEdge,
          Math.min(triggerBounds.left, rightEdge - panelBounds.width),
        );
        measureNearby({
          x: left - canvas.left,
          y: Math.max(topEdge, bounds.top - 7 - height) - canvas.top,
          w: panelBounds.width,
          h:
            Math.min(bottomEdge, bounds.bottom + 7 + height) -
            Math.max(topEdge, bounds.top - 7 - height),
        });
        const blockers = [...reserved, ...selectedTitles, ...neighboringTitles].filter(
          (rect) =>
            canvas.left + rect.x < left + panelBounds.width && canvas.left + rect.x + rect.w > left,
        );
        const belowTop = bounds.bottom + 7;
        const aboveBottom = bounds.top - 7;
        const belowLimit = Math.min(
          bottomEdge,
          ...blockers
            .filter((rect) => canvas.top + rect.y + rect.h > belowTop)
            .map((rect) => canvas.top + rect.y - 7),
        );
        const aboveLimit = Math.max(
          topEdge,
          ...blockers
            .filter((rect) => canvas.top + rect.y < aboveBottom)
            .map((rect) => canvas.top + rect.y + rect.h + 7),
        );
        const below = Math.max(0, belowLimit - belowTop);
        const above = Math.max(0, aboveBottom - aboveLimit);
        const useAbove = height > below && above > below;
        const maxHeight = useAbove ? above : below;
        const top = useAbove ? aboveBottom - Math.min(height, maxHeight) : belowTop;
        dialog.style.left = `${left - bounds.left - node.clientLeft}px`;
        dialog.style.top = `${top - bounds.top - node.clientTop}px`;
        dialog.style.maxHeight = `${maxHeight}px`;
        dialog.dataset.placement = useAbove ? 'above' : 'below';
        dialog.style.visibility = 'visible';
      }

      observeTitles();
    };

    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : undefined;
    observer?.observe(node);
    observer?.observe(host);
    for (const control of controls) {
      observer?.observe(control);
    }

    const dialog = node.querySelector<HTMLElement>('.studio-format-popover');
    if (dialog) {
      observer?.observe(dialog);
    }

    place();
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || !dialog?.contains(event.target)) {
        place();
      }
    };

    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', place);

    return () => {
      observer?.disconnect();
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', place);
    };
  }, [
    selectionBounds.x,
    selectionBounds.y,
    selectionBounds.w,
    selectionBounds.h,
    viewport,
    elements,
    titles,
    editingTitle,
    popover,
    trigger,
    onHidePopover,
  ]);

  return toolbar;
}
