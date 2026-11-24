import { useLayoutEffect, useRef } from 'react';
import type { FocusEvent, KeyboardEvent, ReactNode } from 'react';

import './Toolbar.css';

export interface ToolbarProps {
  label: string;
  orientation?: 'horizontal' | 'vertical';
  children: ReactNode;
}

interface ActionTabIndex {
  original: string | null;
  assigned: string | null;
}

const actionSelector =
  'button:not([role]), button[role="button"], a[href]:not([role]), a[href][role="link"], input[type="button"], input[type="submit"], input[type="reset"]';
const focusScopeSelector =
  '[role="toolbar"], [role="menu"], [role="listbox"], [role="tablist"], [role="radiogroup"], dialog, [contenteditable]:not([contenteditable="false"])';
const blockedSelector =
  ':disabled, [aria-disabled="true"], [hidden], [inert], [aria-hidden="true"]';

function findActions(root: HTMLDivElement) {
  return [...root.querySelectorAll<HTMLElement>(actionSelector)].filter(
    (element) => element.closest(focusScopeSelector) === root,
  );
}

function setTabIndex(element: HTMLElement, value: string | null) {
  if (value === null) {
    element.removeAttribute('tabindex');
    return;
  }

  element.setAttribute('tabindex', value);
}

function restoreTabIndex(element: HTMLElement, record: ActionTabIndex) {
  if (element.getAttribute('tabindex') === record.assigned) {
    setTabIndex(element, record.original);
  }
}

function updateRecords(actions: HTMLElement[], records: Map<HTMLElement, ActionTabIndex>) {
  const retained = new Set(actions);
  for (const [element, record] of records) {
    if (!retained.has(element)) {
      restoreTabIndex(element, record);
      records.delete(element);
    }
  }

  for (const action of actions) {
    const value = action.getAttribute('tabindex');
    const record = records.get(action);
    if (!record || value !== record.assigned) {
      records.set(action, { original: value, assigned: value });
    }
  }
}

function isRendered(action: HTMLElement) {
  const view = action.ownerDocument.defaultView;
  if (!view) {
    return false;
  }

  const { display, visibility } = view.getComputedStyle(action);
  if (display === 'contents' || visibility === 'hidden' || visibility === 'collapse') {
    return false;
  }

  for (let current: HTMLElement | null = action; current; current = current.parentElement) {
    const style = view.getComputedStyle(current);
    if (style.display === 'none' || style.contentVisibility === 'hidden') {
      return false;
    }
  }

  return true;
}

function isAvailable(action: HTMLElement, records: Map<HTMLElement, ActionTabIndex>) {
  const original = records.get(action)?.original ?? '0';

  return !(Number(original) < 0) && !action.closest(blockedSelector) && isRendered(action);
}

function getNextIndex(
  key: string,
  orientation: ToolbarProps['orientation'],
  current: number,
  count: number,
) {
  if (key === 'Home') {
    return 0;
  }
  if (key === 'End') {
    return count - 1;
  }

  const backward = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
  const forward = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
  if (key === backward) {
    return (current + count - 1) % count;
  }
  if (key === forward) {
    return (current + 1) % count;
  }

  return undefined;
}

function connectNavigation(root: HTMLDivElement) {
  const records = new Map<HTMLElement, ActionTabIndex>();
  const document = root.ownerDocument;
  let actions: HTMLElement[] = [];
  let available: HTMLElement[] = [];
  let stop: HTMLElement | undefined;
  let focused: HTMLElement | undefined;

  function sync() {
    const previous = stop;
    const previousIndex = previous ? actions.indexOf(previous) : 0;
    actions = findActions(root);
    updateRecords(actions, records);
    available = actions.filter((action) => isAvailable(action, records));
    const active = document.activeElement;
    const current = available.find((action) => action === active);
    const previousStillAvailable = previous && available.includes(previous);
    const slot = previous ? actions.indexOf(previous) : 0;
    const next = Math.max(0, slot === -1 ? previousIndex : slot);
    const fallback = actions.slice(next).find((action) => available.includes(action));
    stop = current ?? (previousStillAvailable ? previous : (fallback ?? available.at(-1)));

    for (const [element, record] of records) {
      const value = element === stop ? '0' : '-1';
      if (value !== record.assigned) {
        record.assigned = value;
        setTabIndex(element, value);
      }
    }

    if (current) {
      focused = current;
    }

    const orphaned = active === previous || active === document.body || active === null;
    const wasFocused = previous && previous === focused;
    if (wasFocused && orphaned && stop !== previous) {
      focused = stop;
      (stop ?? root).focus();
    }
  }

  function focus(target: EventTarget) {
    focused = actions.find((action) => action === target);
    if (focused) {
      sync();
    }
  }

  function blur(event: FocusEvent<HTMLDivElement>) {
    if (!focused || event.target !== focused) {
      return;
    }

    const lost = event.relatedTarget === null || event.relatedTarget === document.body;
    const stillAvailable = focused.isConnected && isAvailable(focused, records);
    if (!lost || stillAvailable) {
      focused = undefined;
    }
  }

  function move(target: EventTarget, key: string, orientation: ToolbarProps['orientation']) {
    const current = available.findIndex((action) => action === target);
    if (current < 0) {
      return false;
    }

    const next = getNextIndex(key, orientation, current, available.length);
    if (next === undefined) {
      return false;
    }

    available[next]?.focus();

    return true;
  }

  function dispose() {
    for (const [element, record] of records) {
      restoreTabIndex(element, record);
    }
  }

  return { sync, focus, blur, move, dispose };
}

export function Toolbar({ label, orientation = 'horizontal', children }: ToolbarProps) {
  const root = useRef<HTMLDivElement>(null);
  const navigation = useRef<ReturnType<typeof connectNavigation> | null>(null);

  useLayoutEffect(() => {
    const element = root.current;
    const view = element?.ownerDocument.defaultView;
    if (!element || !view) {
      return;
    }

    const connected = connectNavigation(element);
    navigation.current = connected;
    connected.sync();

    const observer = new view.MutationObserver(connected.sync);
    observer.observe(element, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'disabled',
        'aria-disabled',
        'hidden',
        'aria-hidden',
        'inert',
        'tabindex',
        'role',
        'href',
        'type',
        'contenteditable',
        'class',
        'style',
      ],
    });

    const resize =
      typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(connected.sync) : null;
    resize?.observe(element);
    view.addEventListener('resize', connected.sync);

    return () => {
      view.removeEventListener('resize', connected.sync);
      resize?.disconnect();
      observer.disconnect();
      connected.dispose();
      navigation.current = null;
    };
  }, []);

  function handleFocus(event: FocusEvent<HTMLDivElement>) {
    navigation.current?.focus(event.target);
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    navigation.current?.blur(event);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const modified = [event.altKey, event.ctrlKey, event.metaKey, event.shiftKey].some(Boolean);
    if (event.defaultPrevented || event.nativeEvent.isComposing || modified) {
      return;
    }

    if (navigation.current?.move(event.target, event.key, orientation)) {
      event.preventDefault();
    }
  }

  return (
    <div
      ref={root}
      className="studio-ui-toolbar"
      role="toolbar"
      aria-label={label}
      aria-orientation={orientation}
      tabIndex={-1}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
  );
}
