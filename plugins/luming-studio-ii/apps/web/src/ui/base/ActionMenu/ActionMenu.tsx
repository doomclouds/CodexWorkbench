import { useEffectEvent, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';

import { useAnchoredLayer } from '../internal/anchored-layer.js';
import type { OverlayAnchor, OverlayCloseReason } from '../internal/anchored-layer.js';
import './ActionMenu.css';

export type ActionMenuAnchor = OverlayAnchor;
export type ActionMenuCloseReason = OverlayCloseReason | 'tab';

export interface ActionMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface ActionMenuProps {
  open: boolean;
  anchor: ActionMenuAnchor | null;
  label: string;
  items: readonly ActionMenuItem[];
  returnFocus?: () => void;
  onAction: (id: string) => void;
  onRequestClose: (reason: ActionMenuCloseReason) => void;
}

function getMenuItems(menu: HTMLElement) {
  return Array.from(menu.querySelectorAll<HTMLButtonElement>(':scope > [role="menuitem"]'));
}

function getNextIndex(key: string, current: number, count: number) {
  switch (key) {
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowUp':
      return (current > 0 ? current : count) - 1;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}

function focusFirstItem(menu: HTMLElement) {
  const firstItem = getMenuItems(menu)[0];
  (firstItem ?? menu).focus();
}

function canRestoreFocus(menu: HTMLElement) {
  const { activeElement, body } = menu.ownerDocument;

  return activeElement === null || activeElement === body || menu.contains(activeElement);
}

function focusOrigin(origin: Element | null) {
  if (origin?.isConnected && 'focus' in origin && typeof origin.focus === 'function') {
    origin.focus();
  }
}

export function ActionMenu({
  open,
  anchor,
  label,
  items,
  returnFocus,
  onAction,
  onRequestClose,
}: ActionMenuProps) {
  const allowReturnFocus = useRef(true);
  const tabTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const visible = open && anchor !== null;
  const menu = useAnchoredLayer({
    open,
    anchor,
    onRequestClose: handleOverlayClose,
  });
  const restoreOpeningFocus = useEffectEvent((origin: Element | null) => {
    if (returnFocus) {
      returnFocus();
      return;
    }

    focusOrigin(origin);
  });

  useLayoutEffect(() => {
    const element = menu.current;
    if (!visible || !element) {
      return;
    }

    const origin = element.ownerDocument.activeElement;
    allowReturnFocus.current = true;
    focusFirstItem(element);

    return () => {
      clearTimeout(tabTimer.current);
      tabTimer.current = undefined;
      if (allowReturnFocus.current && canRestoreFocus(element)) {
        restoreOpeningFocus(origin);
      }
    };
  }, [menu, visible]);

  function handleOverlayClose(reason: OverlayCloseReason) {
    allowReturnFocus.current = reason !== 'outside-press';
    onRequestClose(reason);
  }

  function handleMenuFocus() {
    allowReturnFocus.current = true;
  }

  function handleTab() {
    allowReturnFocus.current = false;
    if (tabTimer.current !== undefined) {
      return;
    }

    tabTimer.current = setTimeout(() => {
      tabTimer.current = undefined;
      onRequestClose('tab');
    }, 0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Tab') {
      handleTab();
      return;
    }

    const buttons = getMenuItems(event.currentTarget);
    if (buttons.length === 0) {
      return;
    }

    const current = buttons.findIndex((button) => button === event.target);
    const next = getNextIndex(event.key, current, buttons.length);
    if (next === undefined) {
      return;
    }

    event.preventDefault();
    buttons[next]?.focus();
  }

  function handleAction(item: ActionMenuItem) {
    if (!item.disabled) {
      onAction(item.id);
    }
  }

  if (!visible) {
    return null;
  }

  return (
    <div
      ref={menu}
      className="studio-ui-action-menu"
      role="menu"
      aria-label={label}
      tabIndex={-1}
      onFocus={handleMenuFocus}
      onKeyDown={handleKeyDown}
    >
      {items.map((item) => (
        <button
          key={item.id}
          className="studio-ui-action-menu__item"
          type="button"
          role="menuitem"
          tabIndex={-1}
          aria-disabled={item.disabled || undefined}
          onClick={() => handleAction(item)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
