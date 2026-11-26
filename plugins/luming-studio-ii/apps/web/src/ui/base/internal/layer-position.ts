export interface OverlayPoint {
  x: number;
  y: number;
}

export type OverlayAnchor = Element | OverlayPoint;

export type OverlayPlacement = 'top' | 'bottom' | 'left' | 'right';
export type OverlayAlignment = 'end';

interface ViewportBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const gap = 8;
const margin = 8;
const arrowInset = 16;
const anchorOffsetProperty = '--studio-ui-anchor-offset';
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

function candidate(
  placement: OverlayPlacement,
  anchor: DOMRectReadOnly,
  panel: DOMRectReadOnly,
  align: OverlayAlignment | undefined,
) {
  const anchoredLeft =
    align === 'end' ? anchor.right - panel.width : anchor.left + (anchor.width - panel.width) / 2;
  const centeredTop = anchor.top + (anchor.height - panel.height) / 2;
  const positions = {
    top: { x: anchoredLeft, y: anchor.top - panel.height - gap },
    bottom: { x: anchoredLeft, y: anchor.bottom + gap },
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

function placePointLayer(root: HTMLDivElement, point: OverlayPoint, viewport: ViewportBounds) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return false;
  }

  const panel = root.getBoundingClientRect();
  const left = clamp(point.x, viewport.left + margin, viewport.right - panel.width - margin);
  const top = clamp(point.y, viewport.top + margin, viewport.bottom - panel.height - margin);
  root.style.left = left + 'px';
  root.style.top = top + 'px';
  root.removeAttribute('data-placement');
  root.style.removeProperty(anchorOffsetProperty);

  return true;
}

export function placeLayer(
  root: HTMLDivElement,
  anchor: OverlayAnchor,
  placement: OverlayPlacement,
  view: Window,
  align?: OverlayAlignment,
) {
  const viewport = viewportBounds(view);
  if (!('getBoundingClientRect' in anchor)) {
    return placePointLayer(root, anchor, viewport);
  }

  const reference = anchor.getBoundingClientRect();
  if (!fitsViewport(reference, viewport)) {
    return false;
  }

  const panel = root.getBoundingClientRect();
  const primary = candidate(placement, reference, panel, align);
  const fallback = opposite[placement];
  const secondary = candidate(fallback, reference, panel, align);
  const useFallback = overflow(secondary, panel, viewport) < overflow(primary, panel, viewport);
  const position = useFallback ? secondary : primary;
  const resolvedPlacement = useFallback ? fallback : placement;
  const left = clamp(position.x, viewport.left + margin, viewport.right - panel.width - margin);
  const top = clamp(position.y, viewport.top + margin, viewport.bottom - panel.height - margin);
  root.style.left = left + 'px';
  root.style.top = top + 'px';
  root.dataset.placement = resolvedPlacement;
  if (resolvedPlacement === 'top' || resolvedPlacement === 'bottom') {
    const inset = Math.min(arrowInset, panel.width / 2);
    const offset = clamp(reference.left + reference.width / 2 - left, inset, panel.width - inset);
    root.style.setProperty(anchorOffsetProperty, offset + 'px');
  } else {
    root.style.removeProperty(anchorOffsetProperty);
  }

  return true;
}
