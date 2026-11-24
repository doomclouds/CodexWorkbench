export interface OverlayPoint {
  x: number;
  y: number;
}

export type OverlayAnchor = Element | OverlayPoint;

export type OverlayPlacement = 'top' | 'bottom' | 'left' | 'right';

interface ViewportBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const gap = 8;
const margin = 8;
const opposite: Record<OverlayPlacement, OverlayPlacement> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

export function anchorElement(anchor: OverlayAnchor | null): Element | null {
  if (anchor && 'getBoundingClientRect' in anchor) {
    return anchor;
  }

  return null;
}

function anchorBounds(anchor: OverlayAnchor): DOMRectReadOnly {
  if ('getBoundingClientRect' in anchor) {
    return anchor.getBoundingClientRect();
  }

  return new DOMRectReadOnly(anchor.x, anchor.y, 0, 0);
}

function viewportBounds(view: Window): ViewportBounds {
  const visible = view.visualViewport;
  const left = visible?.offsetLeft ?? 0;
  const top = visible?.offsetTop ?? 0;

  return {
    left,
    top,
    right: left + (visible?.width ?? view.innerWidth),
    bottom: top + (visible?.height ?? view.innerHeight),
  };
}

function fitsViewport(anchor: DOMRectReadOnly, viewport: ViewportBounds) {
  const horizontal = anchor.right >= viewport.left && anchor.left <= viewport.right;
  const vertical = anchor.bottom >= viewport.top && anchor.top <= viewport.bottom;

  return horizontal && vertical;
}

function candidate(placement: OverlayPlacement, anchor: DOMRectReadOnly, panel: DOMRectReadOnly) {
  const centeredLeft = anchor.left + (anchor.width - panel.width) / 2;
  const centeredTop = anchor.top + (anchor.height - panel.height) / 2;
  const positions = {
    top: { x: centeredLeft, y: anchor.top - panel.height - gap },
    bottom: { x: centeredLeft, y: anchor.bottom + gap },
    left: { x: anchor.left - panel.width - gap, y: centeredTop },
    right: { x: anchor.right + gap, y: centeredTop },
  };

  return positions[placement];
}

function overflow(point: OverlayPoint, panel: DOMRectReadOnly, viewport: ViewportBounds) {
  return (
    Math.max(0, viewport.left + margin - point.x) +
    Math.max(0, viewport.top + margin - point.y) +
    Math.max(0, point.x + panel.width + margin - viewport.right) +
    Math.max(0, point.y + panel.height + margin - viewport.bottom)
  );
}

function clamp(value: number, lower: number, upper: number) {
  return Math.max(lower, Math.min(value, upper));
}

export function placeLayer(
  root: HTMLDivElement,
  anchor: OverlayAnchor,
  placement: OverlayPlacement,
  view: Window,
) {
  const reference = anchorBounds(anchor);
  const viewport = viewportBounds(view);
  if (!fitsViewport(reference, viewport)) {
    return false;
  }

  const panel = root.getBoundingClientRect();
  const primary = candidate(placement, reference, panel);
  const fallback = opposite[placement];
  const secondary = candidate(fallback, reference, panel);
  const useFallback = overflow(secondary, panel, viewport) < overflow(primary, panel, viewport);
  const position = useFallback ? secondary : primary;
  const left = clamp(position.x, viewport.left + margin, viewport.right - panel.width - margin);
  const top = clamp(position.y, viewport.top + margin, viewport.bottom - panel.height - margin);
  root.style.left = left + 'px';
  root.style.top = top + 'px';
  root.dataset.placement = useFallback ? fallback : placement;

  return true;
}
