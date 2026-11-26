import { useEffect, useEffectEvent, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import type { FeedbackPoint } from '../../data/feedback/index.js';
import {
  commentPopupWidth,
  commentsPanelWidth,
  placeComment,
  placeCommentsList,
} from './feedback-layer-position.js';

interface FeedbackPopupProps {
  readonly kind: 'list' | 'pin' | 'draft';
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
  const frame = layer.getBoundingClientRect();
  const contentHeight = layer.firstElementChild?.scrollHeight || frame.height;
  const kindWidth = kind === 'list' ? commentsPanelWidth : commentPopupWidth;
  const width = frame.width || Math.min(kindWidth, viewport.width - 24);
  const size = { width, height: contentHeight + 2 };
  if (kind === 'list') {
    const position = placeCommentsList(listAnchor(anchor, bounds, viewport.width), size, viewport);
    addPixelPosition(layer, position);
    layer.dataset.above = String(position.above);
    layer.style.setProperty('--feedback-popup-arrow', position.arrow + 'px');
    return;
  }

  if (point) {
    const screen = { x: bounds.left + point.x, y: bounds.top + point.y };
    addPixelPosition(layer, placeComment(screen, size, viewport));
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
      if (!(target instanceof Element) || layer?.contains(target)) {
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
  }, [anchor, kind]);

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
