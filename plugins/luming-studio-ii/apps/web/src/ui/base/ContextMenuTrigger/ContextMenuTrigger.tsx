import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';

export interface ContextMenuTriggerRequest {
  anchor: Element | { x: number; y: number };
  source: 'pointer' | 'keyboard';
  restoreFocus: () => void;
}

export interface ContextMenuTriggerProps {
  enabled?: boolean;
  children: ReactNode;
  returnFocus?: () => void;
  onRequestOpen: (request: ContextMenuTriggerRequest) => void;
}

const editableInputTypes = new Set([
  'text',
  'search',
  'url',
  'tel',
  'email',
  'password',
  'number',
  'date',
  'datetime-local',
  'month',
  'week',
  'time',
]);

function getTarget(trigger: HTMLDivElement, target: EventTarget): Element | undefined {
  const view = trigger.ownerDocument.defaultView;
  if (view && target instanceof view.Element && trigger.contains(target)) {
    return target;
  }

  return undefined;
}

function preservesNativeMenu(target: Element): boolean {
  const input = target.closest('input');
  if (input && editableInputTypes.has(input.type)) {
    return true;
  }
  if (target.closest('textarea, select')) {
    return true;
  }

  const view = target.ownerDocument.defaultView;
  if (view && target instanceof view.HTMLElement && target.isContentEditable) {
    return true;
  }

  const editable = target
    .closest('[contenteditable]')
    ?.getAttribute('contenteditable')
    ?.toLowerCase();

  return editable === '' || editable === 'true' || editable === 'plaintext-only';
}

function focusedInside(trigger: HTMLDivElement): Element | undefined {
  const active = trigger.ownerDocument.activeElement;

  return active && trigger.contains(active) ? active : undefined;
}

function createRestoreFocus(
  trigger: HTMLDivElement,
  preferred: Element,
  returnFocus?: () => void,
): () => void {
  if (returnFocus) {
    return returnFocus;
  }

  return () => {
    if (!trigger.isConnected) {
      return;
    }

    const view = trigger.ownerDocument.defaultView;
    if (view && preferred instanceof view.HTMLElement && trigger.contains(preferred)) {
      preferred.focus({ preventScroll: true });
    }

    if (trigger.ownerDocument.activeElement !== preferred) {
      trigger.focus({ preventScroll: true });
    }
  };
}

export function ContextMenuTrigger({
  enabled = true,
  children,
  returnFocus,
  onRequestOpen,
}: ContextMenuTriggerProps) {
  function handleContextMenu(event: MouseEvent<HTMLDivElement>) {
    if (!enabled || event.defaultPrevented) {
      return;
    }

    const trigger = event.currentTarget;
    const target = getTarget(trigger, event.target);
    if (!target || preservesNativeMenu(target)) {
      return;
    }

    event.preventDefault();
    const preferred =
      focusedInside(trigger) ?? target.closest('button, a[href], [tabindex]') ?? trigger;
    onRequestOpen({
      anchor: { x: event.clientX, y: event.clientY },
      source: 'pointer',
      restoreFocus: createRestoreFocus(trigger, preferred, returnFocus),
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!enabled || event.defaultPrevented || event.nativeEvent.isComposing) {
      return;
    }

    const trigger = event.currentTarget;
    const target = getTarget(trigger, event.target);
    const shortcut = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
    if (!shortcut || !target || preservesNativeMenu(target)) {
      return;
    }

    event.preventDefault();
    if (event.repeat) {
      return;
    }

    const anchor = focusedInside(trigger) ?? target;
    onRequestOpen({
      anchor,
      source: 'keyboard',
      restoreFocus: createRestoreFocus(trigger, anchor, returnFocus),
    });
  }

  return (
    <div tabIndex={-1} onContextMenu={handleContextMenu} onKeyDown={handleKeyDown}>
      {children}
    </div>
  );
}
