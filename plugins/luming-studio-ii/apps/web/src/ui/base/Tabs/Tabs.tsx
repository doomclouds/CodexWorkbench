import {
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import './Tabs.css';

export interface TabsItem {
  id: string;
  label: string;
  disabled?: boolean;
  panel: ReactNode;
}

export interface TabsProps {
  label: string;
  value: string;
  items: readonly TabsItem[];
  activationMode?: 'automatic' | 'manual';
  onValueChange: (id: string) => void;
}

interface PointerPress {
  target: HTMLButtonElement;
  activationRequested: boolean;
}

function tabId(groupId: string, id: string): string {
  return groupId + '-tab-' + encodeURIComponent(id);
}

function panelId(groupId: string, id: string): string {
  return groupId + '-panel-' + encodeURIComponent(id);
}

function navigationTarget(ids: readonly string[], index: number, key: string): string | undefined {
  switch (key) {
    case 'ArrowLeft':
      return ids[(index - 1 + ids.length) % ids.length];
    case 'ArrowRight':
      return ids[(index + 1) % ids.length];
    case 'Home':
      return ids[0];
    case 'End':
      return ids.at(-1);
    default:
      return;
  }
}

export function Tabs({
  label,
  value,
  items,
  activationMode = 'automatic',
  onValueChange,
}: TabsProps) {
  const groupId = useId();
  const [focusedId, setFocusedId] = useState<string>();
  const pointerPress = useRef<PointerPress | undefined>(undefined);
  const enabledIds = items.filter((item) => !item.disabled).map((item) => item.id);
  const entryId = enabledIds.includes(value) ? value : enabledIds[0];
  const focusId = focusedId !== undefined && enabledIds.includes(focusedId) ? focusedId : entryId;

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    pointerPress.current =
      event.button === 0 ? { target: event.currentTarget, activationRequested: false } : undefined;
  }

  function handleFocus(event: FocusEvent<HTMLButtonElement>, id: string) {
    setFocusedId(id);
    if (activationMode !== 'automatic' || id === value) {
      return;
    }

    const press = pointerPress.current;
    if (press?.target === event.currentTarget) {
      press.activationRequested = true;
    }

    onValueChange(id);
  }

  function handleClick(event: MouseEvent<HTMLButtonElement>, id: string) {
    const press = pointerPress.current;

    pointerPress.current = undefined;
    const alreadyRequested = press?.target === event.currentTarget && press.activationRequested;
    if (event.detail > 0 && alreadyRequested) {
      return;
    }

    if (id !== value) {
      onValueChange(id);
    }
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      pointerPress.current = undefined;
      setFocusedId(undefined);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    const modified = [event.altKey, event.ctrlKey, event.metaKey, event.shiftKey].some(Boolean);
    if (modified || event.nativeEvent.isComposing) {
      return;
    }

    const index = enabledIds.indexOf(id);
    if (index < 0 || event.defaultPrevented) {
      return;
    }

    const target = navigationTarget(enabledIds, index, event.key);
    if (target === undefined) {
      return;
    }

    const list = event.currentTarget.closest('[role="tablist"]');
    const nextId = tabId(groupId, target);
    const tab = Array.from(
      list?.querySelectorAll<HTMLButtonElement>('button[role="tab"]') ?? [],
    ).find((candidate) => candidate.id === nextId);

    if (!tab) {
      return;
    }

    event.preventDefault();
    tab.focus();
  }

  return (
    <div className="studio-ui-tabs">
      <div className="studio-ui-tabs__list" role="tablist" aria-label={label} onBlur={handleBlur}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="studio-ui-tabs__tab"
            role="tab"
            id={tabId(groupId, item.id)}
            aria-selected={item.id === value}
            aria-controls={panelId(groupId, item.id)}
            disabled={item.disabled}
            tabIndex={item.id === focusId ? 0 : -1}
            onPointerDown={handlePointerDown}
            onPointerCancel={() => {
              pointerPress.current = undefined;
            }}
            onFocus={(event) => handleFocus(event, item.id)}
            onClick={(event) => handleClick(event, item.id)}
            onKeyDown={(event) => handleKeyDown(event, item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          className="studio-ui-tabs__panel"
          id={panelId(groupId, item.id)}
          role="tabpanel"
          aria-labelledby={tabId(groupId, item.id)}
          tabIndex={item.id === value ? 0 : -1}
          hidden={item.id !== value}
        >
          {item.panel}
        </div>
      ))}
    </div>
  );
}
