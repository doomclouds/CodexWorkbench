import { useEffect, useEffectEvent, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import type { FeedbackPoint } from '../../data/feedback/index.js';
import {
  commentPopupGutter,
  commentPopupWidth,
  commentsPanelWidth,
  placeComment,
  placeCommentsList,
} from './feedback-layer-position.js';

interface FeedbackPopupProps {
  readonly kind: 'list' | 'pin' | 'draft' | 'cluster';
  readonly label: string;
  readonly anchor?: HTMLElement | null;
  readonly canvas: RefObject<HTMLDivElement | null>;
  readonly point?: FeedbackPoint;
  readonly onClose: () => void;
  readonly onOutside?: () => void;
  readonly restoreFocus?: () => void;
  readonly children: ReactNode;
}

function addPixelPosition(
  layer: HTMLElement,
  position: { left: number; top: number; maxHeight: number },
) {
  layer.style.left = position.left + 'px';
  layer.style.top = position.top + 'px';
  layer.style.maxHeight = position.maxHeight + 'px';
}

function listAnchor(
  anchor: HTMLElement | null | undefined,
  canvas: DOMRect,
  viewportWidth: number,
) {
  if (anchor?.isConnected) {
    return anchor.getBoundingClientRect();
  }

  return new DOMRect(canvas.right || viewportWidth - 12, canvas.top + 2, 0, 0);
}

function visibleCanvas(bounds: DOMRectReadOnly, viewport: { width: number; height: number }) {
  if (!(bounds.width > 0 && bounds.height > 0)) {
    return { left: 0, top: 0, ...viewport };
  }

  const left = Math.max(0, bounds.left);
  const top = Math.max(0, bounds.top);

  return {
    left,
    top,
    width: Math.max(0, Math.min(viewport.width, bounds.right) - left),
    height: Math.max(0, Math.min(viewport.height, bounds.bottom) - top),
  };
}

function positionPopup(
  layer: HTMLElement,
  canvas: HTMLDivElement,
  kind: FeedbackPopupProps['kind'],
  anchor: HTMLElement | null | undefined,
  point: FeedbackPoint | undefined,
) {
  const view = layer.ownerDocument.defaultView;
  if (!view) {
    return;
  }

  const viewport = { width: view.innerWidth, height: view.innerHeight };
  const bounds = canvas.getBoundingClientRect();
  const canvasViewport = visibleCanvas(bounds, viewport);
  const anchored = kind === 'list' || kind === 'cluster';
  if (!anchored) {
    layer.style.maxWidth = Math.max(0, canvasViewport.width - commentPopupGutter * 2) + 'px';
  }
  const frame = layer.getBoundingClientRect();
  const contentHeight = layer.firstElementChild?.scrollHeight || frame.height;
  const kindWidth = anchored ? commentsPanelWidth : commentPopupWidth;
  const availableWidth = anchored
    ? viewport.width - 24
    : canvasViewport.width - commentPopupGutter * 2;
  const width = frame.width || Math.max(0, Math.min(kindWidth, availableWidth));
  const size = { width, height: contentHeight + 2 };
  if (anchored) {
    const position = placeCommentsList(listAnchor(anchor, bounds, viewport.width), size, viewport);
    addPixelPosition(layer, position);
    layer.dataset.above = String(position.above);
    layer.style.setProperty('--feedback-popup-arrow', position.arrow + 'px');
    return;
  }

  if (point) {
    const local = {
      x: Math.max(0, Math.min(canvasViewport.width, bounds.left + point.x - canvasViewport.left)),
      y: Math.max(0, Math.min(canvasViewport.height, bounds.top + point.y - canvasViewport.top)),
    };
    const position = placeComment(local, size, canvasViewport);
    addPixelPosition(layer, {
      left: position.left + canvasViewport.left,
      top: position.top + canvasViewport.top,
      maxHeight: position.maxHeight,
    });
  }
}

export function FeedbackPopup({
  kind,
  label,
  anchor,
  canvas,
  point,
  onClose,
  onOutside,
  restoreFocus,
  children,
}: FeedbackPopupProps) {
  const root = useRef<HTMLDivElement>(null);
  const place = useEffectEvent(() => {
    if (root.current && canvas.current) {
      positionPopup(root.current, canvas.current, kind, anchor, point);
    }
  });
  const closeFromOutside = useEffectEvent(() => onOutside?.());
  const restore = useEffectEvent(() => restoreFocus?.());

  useLayoutEffect(() => {
    place();
  });

  useLayoutEffect(() => {
    const layer = root.current;
    if (!layer) {
      return;
    }

    if (!layer.contains(layer.ownerDocument.activeElement)) {
      layer.focus({ preventScroll: true });
    }

    return () => {
      const { activeElement, body } = layer.ownerDocument;
      if (activeElement === body || layer.contains(activeElement)) {
        restore();
      }
    };
  }, []);

  useEffect(() => {
    const layer = root.current;
    const view = layer?.ownerDocument.defaultView;
    if (!layer || !view) {
      return;
    }

    const { ownerDocument } = layer;
    function handlePlacement() {
      place();
    }

    function handleOutside(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element) || layer?.contains(target) || anchor?.contains(target)) {
        return;
      }

      if (!target.closest('[role="menu"], dialog[open]')) {
        closeFromOutside();
      }
    }

    const observer =
      typeof view.ResizeObserver === 'function'
        ? new view.ResizeObserver(handlePlacement)
        : undefined;

    if (layer.firstElementChild) {
      observer?.observe(layer.firstElementChild);
    }
    if (anchor) {
      observer?.observe(anchor);
    }
    if (canvas.current && kind !== 'list') {
      observer?.observe(canvas.current);
    }

    view.addEventListener('resize', handlePlacement);
    ownerDocument.addEventListener('scroll', handlePlacement, true);
    if (kind !== 'list') {
      ownerDocument.addEventListener('pointerdown', handleOutside, true);
    }

    return () => {
      observer?.disconnect();
      view.removeEventListener('resize', handlePlacement);
      ownerDocument.removeEventListener('scroll', handlePlacement, true);
      ownerDocument.removeEventListener('pointerdown', handleOutside, true);
    };
  }, [anchor, canvas, kind]);

  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    const nested =
      event.target instanceof Element && event.target.closest('dialog[open], [role="menu"]');

    if (event.key === 'Escape' && !nested && !event.defaultPrevented) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }

  return (
    <div
      className={'whiteboard-feedback__popup whiteboard-feedback__popup--' + kind}
      role="dialog"
      aria-label={label}
      aria-modal="false"
      tabIndex={-1}
      ref={root}
      onKeyDown={handleKeys}
    >
      <div className="whiteboard-feedback__popup-content">{children}</div>
    </div>
  );
}
