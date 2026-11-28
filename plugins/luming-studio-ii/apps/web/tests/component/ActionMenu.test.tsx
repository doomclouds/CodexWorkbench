import { act } from 'react';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { ActionMenu } from '../../src/ui/base/index.js';
import type {
  ActionMenuAnchor,
  ActionMenuCloseReason,
  ActionMenuItem,
  ActionMenuProps,
} from '../../src/ui/base/index.js';
import { createControlFixture } from '../support/render-control.js';

const point: ActionMenuAnchor = { x: 32, y: 48 };
const items: readonly ActionMenuItem[] = [
  { id: 'copy', label: '复制', disabled: true },
  { id: 'rename', label: '重命名' },
  { id: 'remove', label: '删除', tone: 'danger' },
];

function getMenu(host: HTMLElement) {
  const menu = host.querySelector<HTMLElement>('[role="menu"]');
  if (!menu) {
    throw new Error('ActionMenu is missing.');
  }

  return menu;
}

function getItem(menu: HTMLElement, label: string) {
  const item = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (button) => button.textContent === label,
  );

  if (!item) {
    throw new Error('ActionMenu item is missing.');
  }

  return item;
}

function press(target: HTMLElement, key: string, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });

  return event;
}

function getButton(host: HTMLElement, label: string) {
  const button = [...host.querySelectorAll('button')].find((item) => item.textContent === label);
  if (!button) {
    throw new Error('Fixture button is missing.');
  }

  return button;
}

describe('ActionMenu', () => {
  let fixture: ReturnType<typeof createControlFixture>;

  beforeEach(() => {
    fixture = createControlFixture();
  });

  afterEach(() => {
    fixture.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function renderMenu(props: Partial<ActionMenuProps> = {}) {
    const onAction = vi.fn<(id: string) => void>();
    const onRequestClose = vi.fn<(reason: ActionMenuCloseReason) => void>();
    fixture.render(
      <>
        <button type="button">打开菜单</button>
        <ActionMenu
          open
          anchor={point}
          label="作品操作"
          items={items}
          onAction={onAction}
          onRequestClose={onRequestClose}
          {...props}
        />
        <button type="button">菜单之后</button>
      </>,
    );

    return { onAction, onRequestClose };
  }

  it('uses a controlled menu and renders from a virtual anchor without an anchor element', () => {
    expectTypeOf<ActionMenuProps>().not.toHaveProperty('ref');
    renderMenu({ open: false });
    expect(fixture.host.querySelector('[role="menu"]')).toBeNull();

    renderMenu();
    const menu = getMenu(fixture.host);
    expect(menu.getAttribute('aria-label')).toBe('作品操作');
    expect([...menu.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      '复制',
      '重命名',
      '删除',
    ]);
    expect(getItem(menu, '删除').dataset.tone).toBe('danger');
    expect(getItem(menu, '重命名').dataset.tone).toBeUndefined();
    expect(Number.parseFloat(menu.style.left)).toBe(point.x);
    expect(Number.parseFloat(menu.style.top)).toBe(point.y);
    expect(menu.dataset.placement).toBeUndefined();
    expect(menu.style.getPropertyValue('--studio-ui-anchor-offset')).toBe('');
  });

  it('clamps a context menu at the right and bottom edges without flipping around the point', () => {
    const width = 240;
    const height = 160;
    vi.spyOn(HTMLDivElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, width, height),
    );
    const anchor = { x: window.innerWidth - 12, y: window.innerHeight - 20 };
    renderMenu({ anchor });
    const menu = getMenu(fixture.host);

    expect(Number.parseFloat(menu.style.left)).toBe(window.innerWidth - width - 8);
    expect(Number.parseFloat(menu.style.top)).toBe(window.innerHeight - height - 8);
    expect(menu.dataset.placement).toBeUndefined();
  });

  it('requests an anchor-hidden close once when an open menu has no anchor', () => {
    const onRequestClose = vi.fn();
    renderMenu({ anchor: null, onRequestClose });
    expect(fixture.host.querySelector('[role="menu"]')).toBeNull();
    expect(onRequestClose).toHaveBeenCalledExactlyOnceWith('anchor-hidden');

    renderMenu({ anchor: null, onRequestClose });
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it('focuses a disabled first item and moves through all items with arrows, Home and End', () => {
    renderMenu();
    const menu = getMenu(fixture.host);
    const first = getItem(menu, '复制');
    const second = getItem(menu, '重命名');
    const last = getItem(menu, '删除');
    expect(document.activeElement).toBe(first);
    expect(first.disabled).toBe(false);
    expect(first.getAttribute('aria-disabled')).toBe('true');
    expect(first.tabIndex).toBe(-1);

    expect(press(first, 'ArrowDown').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(second);
    press(second, 'End');
    expect(document.activeElement).toBe(last);
    press(last, 'ArrowDown');
    expect(document.activeElement).toBe(first);
    press(first, 'ArrowUp');
    expect(document.activeElement).toBe(last);
    press(last, 'Home');
    expect(document.activeElement).toBe(first);
  });

  it('renders a separator and a visual shortcut without adding navigation targets', () => {
    renderMenu({
      items: [
        { id: 'forward', label: '上移一层' },
        { id: 'delete', label: '删除', separatorBefore: true, shortcut: 'Delete' },
      ],
    });
    const menu = getMenu(fixture.host);
    const first = getItem(menu, '上移一层');
    const shortcut = menu.querySelector('small');
    expect(shortcut?.textContent).toBe('Delete');
    expect(shortcut?.getAttribute('aria-hidden')).toBe('true');
    expect(
      menu.querySelector('[role="separator"]')?.nextElementSibling?.getAttribute('aria-label'),
    ).toBe('删除');
    press(first, 'ArrowDown');
    expect(document.activeElement).toBe(shortcut?.parentElement);
  });

  it('uses native activation and only reports enabled actions', () => {
    const { onAction, onRequestClose } = renderMenu();
    const menu = getMenu(fixture.host);
    const disabled = getItem(menu, '复制');
    const enabled = getItem(menu, '重命名');
    act(() => disabled.click());
    expect(onAction).not.toHaveBeenCalled();

    expect(press(enabled, 'Enter').defaultPrevented).toBe(false);
    expect(press(enabled, ' ').defaultPrevented).toBe(false);
    expect(onAction).not.toHaveBeenCalled();

    act(() => enabled.click());
    expect(onAction).toHaveBeenCalledExactlyOnceWith('rename');
    expect(onRequestClose).not.toHaveBeenCalled();
    expect(getMenu(fixture.host)).toBe(menu);
  });

  it('retains item focus on rerender and restores focus after a controlled close', () => {
    const opener = () => getButton(fixture.host, '打开菜单');
    const returnFocus = vi.fn(() => opener().focus());
    renderMenu({ open: false });
    act(() => opener().focus());
    renderMenu({ returnFocus });

    const selected = getItem(getMenu(fixture.host), '重命名');
    act(() => selected.focus());
    renderMenu({
      anchor: { x: 64, y: 80 },
      items: [{ id: 'remove', label: '删除' }, ...items.slice(0, 2)],
      returnFocus,
    });
    expect(document.activeElement).toBe(selected);
    expect(returnFocus).not.toHaveBeenCalled();

    renderMenu({ open: false, returnFocus });
    expect(returnFocus).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener());
  });

  it('requests Escape through the layer and restores the opening focus when closed', () => {
    renderMenu({ open: false });
    const opener = getButton(fixture.host, '打开菜单');
    act(() => opener.focus());
    const { onRequestClose } = renderMenu();
    const first = getItem(getMenu(fixture.host), '复制');

    press(first, 'Escape');
    expect(onRequestClose).toHaveBeenCalledExactlyOnceWith('escape');
    expect(document.activeElement).toBe(first);

    renderMenu({ open: false });
    expect(document.activeElement).toBe(opener);
  });

  it('allows normal Tab or Shift+Tab movement and does not restore the old focus', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const returnFocus = vi.fn();
    const { onRequestClose } = renderMenu({ returnFocus });
    const first = getItem(getMenu(fixture.host), '复制');
    const next = getButton(fixture.host, '菜单之后');

    const event = press(first, 'Tab');
    expect(event.defaultPrevented).toBe(false);
    act(() => next.focus());
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(onRequestClose).toHaveBeenCalledExactlyOnceWith('tab');

    renderMenu({ open: false, returnFocus });
    expect(document.activeElement).toBe(next);
    expect(returnFocus).not.toHaveBeenCalled();

    const secondOpening = renderMenu({ returnFocus });
    const previous = getButton(fixture.host, '打开菜单');
    const laterEvent = press(getItem(getMenu(fixture.host), '复制'), 'Tab', true);
    expect(laterEvent.defaultPrevented).toBe(false);
    act(() => previous.focus());
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(secondOpening.onRequestClose).toHaveBeenCalledExactlyOnceWith('tab');

    renderMenu({ open: false, returnFocus });
    expect(document.activeElement).toBe(previous);
    expect(returnFocus).not.toHaveBeenCalled();
  });

  it('requests outside dismissal and leaves focus at the pointer target', () => {
    const returnFocus = vi.fn();
    const { onRequestClose } = renderMenu({ returnFocus });
    const menu = getMenu(fixture.host);
    const next = getButton(fixture.host, '菜单之后');

    act(() => {
      menu.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(onRequestClose).not.toHaveBeenCalled();

    act(() => {
      next.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(onRequestClose).toHaveBeenCalledExactlyOnceWith('outside-press');
    renderMenu({ open: false, returnFocus });
    act(() => next.focus());
    expect(returnFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(next);
  });
});
