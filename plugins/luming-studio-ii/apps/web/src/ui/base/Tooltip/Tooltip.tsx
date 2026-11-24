import { useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useAnchoredLayer } from '../internal/anchored-layer.js';
import type { OverlayPlacement } from '../internal/anchored-layer.js';
import './Tooltip.css';

export type TooltipPlacement = OverlayPlacement;

export interface TooltipProps {
  anchor: Element | null;
  text: string;
  delay?: number;
  placement?: TooltipPlacement;
}

const defaultDelay = 400;

function describedBy(element: Element) {
  return (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
}

function describeAnchor(anchor: Element, id: string) {
  function addDescription() {
    const ids = describedBy(anchor);
    if (!ids.includes(id)) {
      anchor.setAttribute('aria-describedby', [...ids, id].join(' '));
    }
  }

  addDescription();

  const view = anchor.ownerDocument.defaultView;
  const observer = view ? new view.MutationObserver(addDescription) : null;
  observer?.observe(anchor, { attributes: true, attributeFilter: ['aria-describedby'] });

  return () => {
    observer?.disconnect();
    const ids = describedBy(anchor).filter((existing) => existing !== id);
    if (ids.length > 0) {
      anchor.setAttribute('aria-describedby', ids.join(' '));
      return;
    }

    anchor.removeAttribute('aria-describedby');
  };
}

function containsPointerDestination(element: Element, event: Event) {
  const view = element.ownerDocument.defaultView;
  if (!view || !('relatedTarget' in event)) {
    return false;
  }

  return event.relatedTarget instanceof view.Node && element.contains(event.relatedTarget);
}

function isTouchPointer(event: Event) {
  return 'pointerType' in event && event.pointerType === 'touch';
}

function bindTooltipTrigger(
  anchor: Element,
  tooltip: HTMLDivElement,
  getDelay: () => number,
  onOpen: () => void,
  onClose: () => void,
) {
  const view = anchor.ownerDocument.defaultView;
  if (!view) {
    return;
  }

  const events = new view.AbortController();
  const options = { signal: events.signal };
  let hoveringAnchor = false;
  let hoveringTooltip = false;
  let keyboardFocus = false;
  let visible = false;
  let timer: number | undefined;

  function clearDelay() {
    if (timer !== undefined) {
      view?.clearTimeout(timer);
      timer = undefined;
    }
  }

  function dismiss() {
    clearDelay();
    hoveringTooltip = false;
    visible = false;
    onClose();
  }

  function dismissWhenIdle() {
    if (!hoveringAnchor && !hoveringTooltip && !keyboardFocus) {
      dismiss();
    }
  }

  function showAfterDelay() {
    if (visible || timer !== undefined) {
      return;
    }

    timer = view?.setTimeout(() => {
      timer = undefined;
      if (anchor.isConnected) {
        visible = true;
        onOpen();
      }
    }, getDelay());
  }

  function handleAnchorEnter(event: Event) {
    if (isTouchPointer(event)) {
      return;
    }

    hoveringAnchor = true;
    showAfterDelay();
  }

  function handleAnchorLeave(event: Event) {
    if (isTouchPointer(event)) {
      return;
    }

    hoveringAnchor = false;
    hoveringTooltip = visible && containsPointerDestination(tooltip, event);
    dismissWhenIdle();
  }

  function handleTooltipEnter(event: Event) {
    if (!isTouchPointer(event)) {
      hoveringTooltip = true;
    }
  }

  function handleTooltipLeave(event: Event) {
    if (isTouchPointer(event)) {
      return;
    }

    hoveringTooltip = false;
    hoveringAnchor = containsPointerDestination(anchor, event);
    dismissWhenIdle();
  }

  function handleAnchorFocus() {
    keyboardFocus = anchor.matches(':focus-visible');
    if (keyboardFocus) {
      showAfterDelay();
    }
  }

  function handleAnchorBlur() {
    keyboardFocus = false;
    dismissWhenIdle();
  }

  anchor.addEventListener('pointerenter', handleAnchorEnter, options);
  anchor.addEventListener('pointerleave', handleAnchorLeave, options);
  anchor.addEventListener('focus', handleAnchorFocus, options);
  anchor.addEventListener('blur', handleAnchorBlur, options);
  tooltip.addEventListener('pointerenter', handleTooltipEnter, options);
  tooltip.addEventListener('pointerleave', handleTooltipLeave, options);
  handleAnchorFocus();

  return {
    dismiss,
    dispose() {
      events.abort();
      clearDelay();
    },
  };
}

export function Tooltip({ anchor, text, delay = defaultDelay, placement = 'top' }: TooltipProps) {
  const tooltipId = useId();
  const binding = useMemo(() => ({ anchor }), [anchor]);
  const [visibleBinding, setVisibleBinding] = useState<typeof binding | null>(null);
  const dismiss = useRef<(() => void) | undefined>(undefined);
  const readDelay = useEffectEvent(() =>
    Number.isFinite(delay) ? Math.max(0, delay) : defaultDelay,
  );
  const open = visibleBinding === binding;
  const layer = useAnchoredLayer({
    open,
    anchor,
    placement,
    persistent: true,
    priority: -1,
    onRequestClose: () => dismiss.current?.(),
  });

  useLayoutEffect(() => {
    const element = binding.anchor;
    const tooltip = layer.current;
    if (!element || !tooltip) {
      return;
    }

    const removeDescription = describeAnchor(element, tooltipId);
    const trigger = bindTooltipTrigger(
      element,
      tooltip,
      () => readDelay(),
      () => setVisibleBinding(binding),
      () => setVisibleBinding(null),
    );
    dismiss.current = trigger?.dismiss;

    return () => {
      dismiss.current = undefined;
      trigger?.dispose();
      removeDescription();
    };
  }, [binding, layer, tooltipId]);

  if (!anchor) {
    return null;
  }

  return createPortal(
    <div id={tooltipId} ref={layer} role="tooltip" className="studio-ui-tooltip" hidden={!open}>
      {text}
    </div>,
    anchor.closest('dialog') ?? anchor.ownerDocument.body,
  );
}
