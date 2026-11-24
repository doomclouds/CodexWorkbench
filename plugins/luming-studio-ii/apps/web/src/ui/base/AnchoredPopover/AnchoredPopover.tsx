import { useEffectEvent, useLayoutEffect } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useAnchoredLayer } from '../internal/anchored-layer.js';
import type { OverlayCloseReason, OverlayPlacement } from '../internal/anchored-layer.js';
import './AnchoredPopover.css';

export type AnchoredPopoverCloseReason = OverlayCloseReason;
export type AnchoredPopoverPlacement = OverlayPlacement;

export interface AnchoredPopoverProps {
  open: boolean;
  anchor: Element | null;
  children: ReactNode;
  label?: string;
  placement?: AnchoredPopoverPlacement;
  persistent?: boolean;
  portalRoot?: HTMLElement | null;
  initialFocus?: () => void;
  restoreFocus?: () => void;
  onRequestClose: (reason: AnchoredPopoverCloseReason) => void;
}

function findPortalTarget(anchor: Element | null, portalRoot: HTMLElement | null | undefined) {
  if (!anchor || !portalRoot) {
    return null;
  }

  const dialog = anchor.closest('dialog');
  return dialog && !dialog.contains(portalRoot) ? dialog : portalRoot;
}

type AnchoredPopoverLayerProps = Omit<
  AnchoredPopoverProps,
  'portalRoot' | 'initialFocus' | 'restoreFocus'
>;

function AnchoredPopoverLayer({
  open,
  anchor,
  children,
  label,
  placement,
  persistent,
  onRequestClose,
}: AnchoredPopoverLayerProps) {
  const layer = useAnchoredLayer({ open, anchor, placement, persistent, onRequestClose });

  if (!open || !anchor) {
    return null;
  }

  return (
    <div
      ref={layer}
      className="studio-ui-anchored-popover"
      role={label ? 'dialog' : undefined}
      aria-label={label}
    >
      {children}
    </div>
  );
}

export function AnchoredPopover({
  open,
  anchor,
  portalRoot,
  initialFocus,
  restoreFocus,
  ...layerProps
}: AnchoredPopoverProps) {
  const focusOnOpen = useEffectEvent(() => {
    if (anchor?.isConnected) {
      initialFocus?.();
    }
  });
  const focusOnClose = useEffectEvent(() => restoreFocus?.());

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    focusOnOpen();
    return () => focusOnClose();
  }, [open]);

  const content = <AnchoredPopoverLayer open={open} anchor={anchor} {...layerProps} />;
  const target = findPortalTarget(anchor, portalRoot);
  return target ? createPortal(content, target) : content;
}
