import { useEffectEvent, useLayoutEffect, useRef } from 'react';
import { nextLayerOrder, registerDismissableLayer } from './layer-dismiss.js';
import type { LayerDismissReason } from './layer-dismiss.js';
import { anchorElement, placeLayer } from './layer-position.js';
import type { OverlayAlignment, OverlayAnchor, OverlayPlacement } from './layer-position.js';

export type {
  OverlayAlignment,
  OverlayAnchor,
  OverlayPlacement,
  OverlayPoint,
} from './layer-position.js';

export type OverlayCloseReason = LayerDismissReason | 'anchor-hidden';

interface AnchoredLayerOptions {
  open: boolean;
  anchor: OverlayAnchor | null;
  placement?: OverlayPlacement;
  align?: OverlayAlignment;
  persistent?: boolean;
  priority?: number;
  onRequestClose: (reason: OverlayCloseReason) => void;
}

function trackAnchor(
  root: HTMLDivElement,
  anchor: OverlayAnchor,
  { placement, align }: { placement: OverlayPlacement; align?: OverlayAlignment },
  view: Window & typeof globalThis,
  onHidden: () => void,
) {
  const element = anchorElement(anchor);
  let intersecting = true;
  let hidden = false;
  let frame: number | undefined;

  function renderPosition() {
    const present = !element || element.isConnected;
    const placed = present && intersecting && placeLayer(root, anchor, placement, view, align);
    root.style.visibility = placed ? 'visible' : 'hidden';
    if (!placed && !hidden) {
      onHidden();
    }
    hidden = !placed;
  }

  function renderFrame() {
    frame = undefined;
    renderPosition();
  }

  function schedule() {
    if (typeof view.requestAnimationFrame !== 'function') {
      renderPosition();
      return;
    }
    frame ??= view.requestAnimationFrame(renderFrame);
  }

  const resize =
    typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(schedule) : null;
  const mutations = new view.MutationObserver(schedule);
  const intersection =
    typeof view.IntersectionObserver === 'function'
      ? new view.IntersectionObserver((entries) => {
          intersecting = entries[0]?.isIntersecting ?? true;
          schedule();
        })
      : null;

  resize?.observe(root);
  if (element) {
    resize?.observe(element);
    intersection?.observe(element);
    mutations.observe(element.ownerDocument.documentElement, { childList: true, subtree: true });
  }
  view.addEventListener('resize', schedule);
  view.addEventListener('scroll', schedule, true);
  view.visualViewport?.addEventListener('resize', schedule);
  view.visualViewport?.addEventListener('scroll', schedule);
  renderPosition();

  return () => {
    resize?.disconnect();
    mutations.disconnect();
    intersection?.disconnect();
    view.removeEventListener('resize', schedule);
    view.removeEventListener('scroll', schedule, true);
    view.visualViewport?.removeEventListener('resize', schedule);
    view.visualViewport?.removeEventListener('scroll', schedule);
    if (frame !== undefined) {
      view.cancelAnimationFrame(frame);
    }
  };
}

export function useAnchoredLayer({
  open,
  anchor,
  placement = 'bottom',
  align,
  persistent = false,
  priority = 0,
  onRequestClose,
}: AnchoredLayerOptions) {
  const root = useRef<HTMLDivElement>(null);
  const currentOpening = useRef<number | undefined>(undefined);
  const requestClose = useEffectEvent(onRequestClose);

  useLayoutEffect(() => {
    const element = root.current;
    if (!open) {
      currentOpening.current = undefined;
      return;
    }

    const openingOrder = (currentOpening.current ??= nextLayerOrder());

    if (!anchor) {
      if (element) {
        element.style.visibility = 'hidden';
      }
      requestClose('anchor-hidden');
      return;
    }
    if (!element) {
      return;
    }

    const view = element.ownerDocument.defaultView;
    if (!view) {
      element.style.visibility = 'hidden';
      requestClose('anchor-hidden');
      return;
    }

    const disposePosition = trackAnchor(element, anchor, { placement, align }, view, () =>
      requestClose('anchor-hidden'),
    );
    const disposeDismiss = registerDismissableLayer({
      root: element,
      anchor: anchorElement(anchor),
      priority,
      openingOrder,
      persistent,
      dismiss: (reason) => requestClose(reason),
    });

    return () => {
      disposeDismiss();
      disposePosition();
    };
  }, [open, anchor, placement, align, persistent, priority]);

  return root;
}
