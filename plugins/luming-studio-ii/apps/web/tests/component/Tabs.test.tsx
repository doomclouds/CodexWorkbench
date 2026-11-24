import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Tabs, type TabsItem } from '../../src/ui/base/index.js';
import { createControlFixture } from '../support/render-control.js';

const items: readonly TabsItem[] = [
  { id: 'overview', label: '概览', panel: '当前作品' },
  { id: 'history', label: '历史', disabled: true, panel: '已归档内容' },
  { id: 'current notes', label: '批注', panel: '当前批注' },
  { id: 'members', label: '协作', panel: '当前成员' },
];

function findTab(host: HTMLElement, label: string): HTMLButtonElement {
  const tab = Array.from(host.querySelectorAll<HTMLButtonElement>('button[role="tab"]')).find(
    (candidate) => candidate.textContent === label,
  );

  if (!tab) {
    throw new Error('Expected tab is missing.');
  }

  return tab;
}

function findPanel(tab: HTMLButtonElement): HTMLElement {
  const id = tab.getAttribute('aria-controls');
  const panel = document.getElementById(id ?? '');
  if (!panel) {
    throw new Error('Expected tab panel is missing.');
  }

  return panel;
}

function pressKey(tab: HTMLButtonElement, key: string, modifiers?: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });

  act(() => {
    tab.dispatchEvent(event);
  });

  return event.defaultPrevented;
}

describe('Tabs', () => {
  let fixture: ReturnType<typeof createControlFixture>;

  beforeEach(() => {
    fixture = createControlFixture();
  });

  afterEach(() => {
    fixture.dispose();
  });

  it('keeps tab and panel associations stable when keyed items move', () => {
    const onValueChange = vi.fn();
    fixture.render(
      <Tabs label="作品信息" value="overview" items={items} onValueChange={onValueChange} />,
    );

    const overview = findTab(fixture.host, '概览');
    const notes = findTab(fixture.host, '批注');
    const panel = findPanel(notes);
    expect(fixture.host.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe(
      '作品信息',
    );
    expect(panel.getAttribute('role')).toBe('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe(notes.id);
    expect(panel.hidden).toBe(true);
    expect(overview.getAttribute('aria-selected')).toBe('true');
    expect(findPanel(overview).hidden).toBe(false);
    expect(findPanel(overview).tabIndex).toBe(0);

    fixture.render(
      <Tabs
        label="作品信息"
        value="current notes"
        items={[...items].reverse()}
        onValueChange={onValueChange}
      />,
    );

    expect(findTab(fixture.host, '批注')).toBe(notes);
    expect(findPanel(notes)).toBe(panel);
    expect(notes.getAttribute('aria-selected')).toBe('true');
    expect(panel.hidden).toBe(false);
    expect(findPanel(overview).hidden).toBe(true);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('moves and activates automatically, skipping disabled tabs and wrapping at either end', () => {
    const onValueChange = vi.fn();
    fixture.render(
      <Tabs label="作品信息" value="overview" items={items} onValueChange={onValueChange} />,
    );

    const overview = findTab(fixture.host, '概览');
    const history = findTab(fixture.host, '历史');
    const notes = findTab(fixture.host, '批注');
    const members = findTab(fixture.host, '协作');
    act(() => overview.focus());

    expect(history.disabled).toBe(true);
    expect(pressKey(overview, 'ArrowRight')).toBe(true);
    expect(document.activeElement).toBe(notes);
    expect(notes.tabIndex).toBe(0);
    expect(overview.tabIndex).toBe(-1);
    expect(pressKey(notes, 'End')).toBe(true);
    expect(document.activeElement).toBe(members);
    expect(pressKey(members, 'ArrowRight')).toBe(true);
    expect(document.activeElement).toBe(overview);
    expect(pressKey(overview, 'ArrowLeft')).toBe(true);
    expect(document.activeElement).toBe(members);
    expect(pressKey(members, 'Home')).toBe(true);
    expect(document.activeElement).toBe(overview);
    expect(pressKey(overview, 'ArrowDown')).toBe(false);
    expect(onValueChange.mock.calls).toEqual([['current notes'], ['members'], ['members']]);
    expect(findPanel(overview).hidden).toBe(false);
  });

  it('requests automatic activation when focus is moved directly to a tab', () => {
    const onValueChange = vi.fn();
    fixture.render(
      <Tabs label="作品信息" value="overview" items={items} onValueChange={onValueChange} />,
    );
    const notes = findTab(fixture.host, '批注');

    act(() => notes.focus());

    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('current notes');
    expect(notes.tabIndex).toBe(0);
    expect(findPanel(notes).hidden).toBe(true);
  });

  it('reports focus and click from one pointer press once when the value stays unchanged', () => {
    const onValueChange = vi.fn();
    fixture.render(
      <Tabs label="作品信息" value="overview" items={items} onValueChange={onValueChange} />,
    );
    const notes = findTab(fixture.host, '批注');

    act(() => {
      notes.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
      notes.focus();
    });
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('current notes');

    act(() => {
      notes.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('current notes');
    expect(notes.getAttribute('aria-selected')).toBe('false');

    act(() => {
      notes.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
      notes.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    });
    expect(onValueChange.mock.calls).toEqual([['current notes'], ['current notes']]);
  });

  it('leaves modified and composition keys to the browser', () => {
    const onValueChange = vi.fn();
    fixture.render(
      <Tabs label="作品信息" value="overview" items={items} onValueChange={onValueChange} />,
    );
    const overview = findTab(fixture.host, '概览');
    act(() => overview.focus());

    expect(pressKey(overview, 'ArrowLeft', { altKey: true })).toBe(false);
    expect(pressKey(overview, 'ArrowRight', { isComposing: true })).toBe(false);
    expect(onValueChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(overview);
  });

  it('uses manual focus navigation and keeps the selected tab as the entry after focus leaves', () => {
    const onValueChange = vi.fn();
    fixture.render(
      <>
        <button type="button">另一个操作</button>
        <Tabs
          label="作品信息"
          value="overview"
          items={items}
          activationMode="manual"
          onValueChange={onValueChange}
        />
      </>,
    );

    const overview = findTab(fixture.host, '概览');
    const notes = findTab(fixture.host, '批注');
    act(() => overview.focus());
    pressKey(overview, 'ArrowRight');

    expect(document.activeElement).toBe(notes);
    expect(notes.tabIndex).toBe(0);
    expect(overview.getAttribute('aria-selected')).toBe('true');
    expect(findPanel(notes).hidden).toBe(true);
    expect(onValueChange).not.toHaveBeenCalled();

    act(() => notes.click());
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('current notes');

    act(() => fixture.host.querySelector('button')?.focus());
    expect(overview.tabIndex).toBe(0);
    expect(notes.tabIndex).toBe(-1);
  });
});
