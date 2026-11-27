import { useEffectEvent, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface WorkbenchMenuProps {
  readonly id?: string;
  readonly anchor: HTMLButtonElement;
  readonly label: string;
  readonly initialFocus?: 'first' | 'last' | 'selected';
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly toolbar?: boolean;
}

const menuInset = 8;
const menuGap = 6;
const menuKeys = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

function menuButtons(menu: HTMLDivElement) {
  return [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
}

function focusMenu(menu: HTMLDivElement, policy: WorkbenchMenuProps['initialFocus']) {
  const buttons = menuButtons(menu);
  const selected = menu.querySelector<HTMLButtonElement>(
    'button[aria-checked="true"]:not(:disabled)',
  );
  const target = policy === 'last' ? buttons.at(-1) : buttons[0];

  ((policy === 'selected' ? selected : undefined) ?? target ?? menu).focus();
}

function positionMenu(menu: HTMLDivElement, anchor: DOMRect, host: HTMLElement, view: Window) {
  const bounds = host.getBoundingClientRect();
  const left = Math.max(0, bounds.width ? bounds.left : 0);
  const right = Math.min(view.innerWidth, bounds.width ? bounds.right : view.innerWidth);
  const top = Math.max(0, bounds.height ? bounds.top : 0);
  const bottom = Math.min(view.innerHeight, bounds.height ? bounds.bottom : view.innerHeight);
  const maxWidth = Math.max(0, right - left - 2 * menuInset);

  menu.style.maxWidth = maxWidth + 'px';
  menu.style.maxHeight = '';
  const rect = menu.getBoundingClientRect();
  const width = Math.min(rect.width, maxWidth);
  const height = menu.scrollHeight || rect.height;
  const below = Math.max(0, bottom - menuInset - anchor.bottom - menuGap);
  const above = Math.max(0, anchor.top - menuGap - top - menuInset);
  const fitsBelow = height <= below || below >= above;
  const placement = fitsBelow
    ? anchor.bottom + menuGap
    : anchor.top - menuGap - Math.min(height, above);

  menu.style.left =
    Math.max(left + menuInset, Math.min(anchor.right - width, right - menuInset - width)) + 'px';
  menu.style.top = placement + 'px';
  menu.style.maxHeight = (fitsBelow ? below : above) + 'px';
  menu.style.visibility = 'visible';
}

function isOutsideList(anchor: HTMLButtonElement, rect: DOMRect) {
  const list = anchor.closest('.studio-workbench-main')?.getBoundingClientRect();
  if (!list || list.height <= 0) {
    return false;
  }

  const outsideVertical = rect.bottom <= list.top || rect.top >= list.bottom;
  const outsideHorizontal = rect.right <= list.left || rect.left >= list.right;

  return outsideVertical || outsideHorizontal;
}

function nextMenuItem(key: string, index: number, count: number) {
  if (key === 'Home') {
    return 0;
  }
  if (key === 'End') {
    return count - 1;
  }

  return (index + (key === 'ArrowDown' ? 1 : -1) + count) % count;
}

export function WorkbenchMenu({
  id,
  anchor,
  label,
  initialFocus = 'selected',
  onClose,
  children,
  toolbar = false,
}: WorkbenchMenuProps) {
  const host = anchor.closest<HTMLElement>('.studio-workbench') ?? anchor.ownerDocument.body;
  const menuRef = useRef<HTMLDivElement>(null);
  const requestClose = useEffectEvent(onClose);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const doc = anchor.ownerDocument;
    const view = doc.defaultView;
    if (!menu || !view) {
      return;
    }

    const reposition = (event: Event) => {
      if (event.target instanceof Node && menu.contains(event.target)) {
        return;
      }

      const rect = anchor.getBoundingClientRect();
      if (isOutsideList(anchor, rect)) {
        requestClose();
        return;
      }

      positionMenu(menu, rect, host, view);
    };

    const dismissOutside = (event: Event) => {
      if (!(event.target instanceof Node)) {
        return;
      }

      if (!menu.contains(event.target) && !anchor.contains(event.target)) {
        requestClose();
      }
    };

    positionMenu(menu, anchor.getBoundingClientRect(), host, view);
    focusMenu(menu, initialFocus);
    doc.addEventListener('pointerdown', dismissOutside, true);
    doc.addEventListener('focusin', dismissOutside, true);
    doc.addEventListener('scroll', reposition, true);
    view.addEventListener('resize', reposition);

    return () => {
      doc.removeEventListener('pointerdown', dismissOutside, true);
      doc.removeEventListener('focusin', dismissOutside, true);
      doc.removeEventListener('scroll', reposition, true);
      view.removeEventListener('resize', reposition);
    };
  }, [anchor, host, initialFocus]);

  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      anchor.focus();
      return;
    }
    if (event.key === 'Tab') {
      onClose();
      return;
    }
    if (!menuKeys.has(event.key)) {
      return;
    }

    const items = menuButtons(event.currentTarget);
    if (items.length === 0) {
      return;
    }

    const active = items.findIndex((item) => item === anchor.ownerDocument.activeElement);
    event.preventDefault();
    items[nextMenuItem(event.key, active, items.length)]?.focus();
  }

  return createPortal(
    <div
      id={id}
      ref={menuRef}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      className={
        toolbar ? 'studio-workbench-menu studio-workbench-toolbar-menu' : 'studio-workbench-menu'
      }
      onKeyDown={handleKeys}
    >
      {children}
    </div>,
    host,
  );
}
