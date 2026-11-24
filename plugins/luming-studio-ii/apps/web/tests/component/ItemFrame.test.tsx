import { act, type MouseEvent, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { ItemFrame, type ItemFrameProps } from '../../src/ui/base/index.js';
import { createControlFixture } from '../support/render-control.js';

let fixture: ReturnType<typeof createControlFixture>;

beforeEach(() => {
  fixture = createControlFixture();
});

afterEach(() => fixture.dispose());

function getElement(selector: string): HTMLElement {
  const element = fixture.host.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error('Expected the rendered item frame or one of its slots.');
  }

  return element;
}

describe('ItemFrame', () => {
  it.each(['row', 'card'] as const)('presents a named, noninteractive %s with content', (kind) => {
    fixture.render(
      <ItemFrame
        kind={kind}
        title="团队白板"
        metadata={<span>已保存</span>}
        primaryAction={<button type="button">打开</button>}
      >
        <p>作品说明</p>
      </ItemFrame>,
    );

    const item = getElement('article');
    const heading = getElement('h2');
    expect(heading.textContent).toBe('团队白板');
    expect(heading.id).not.toBe('');
    expect(item.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(item.getAttribute('data-kind')).toBe(kind);
    expect(item.hasAttribute('tabindex')).toBe(false);
    expect(item.textContent).toContain('已保存');
    expect(item.textContent).toContain('作品说明');
  });

  it('keeps link, menu and selection actions independent', () => {
    const onOpen = vi.fn((event: MouseEvent<HTMLAnchorElement>) => event.preventDefault());
    const onMenu = vi.fn();
    const onSelect = vi.fn();
    fixture.render(
      <ItemFrame
        kind="row"
        title="团队白板"
        primaryAction={
          <a href="#whiteboard" onClick={onOpen}>
            打开
          </a>
        }
        secondaryActions={
          <>
            <label>
              <input type="checkbox" onChange={onSelect} />
              选择
            </label>
            <button type="button" onClick={onMenu}>
              更多操作
            </button>
          </>
        }
      />,
    );

    const item = getElement('article');
    const link = getElement('a');
    const menu = getElement('button');
    const selection = getElement('input');
    expect(link.getAttribute('href')).toBe('#whiteboard');
    expect(link.contains(menu)).toBe(false);
    expect(link.contains(selection)).toBe(false);
    expect(menu.contains(link)).toBe(false);
    expect(menu.contains(selection)).toBe(false);

    act(() => item.click());
    expect(onOpen).not.toHaveBeenCalled();
    act(() => link.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onMenu).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();

    act(() => menu.click());
    act(() => selection.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onMenu).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('exposes the named content and action slots without a DOM handle', () => {
    expectTypeOf<ItemFrameProps>().toEqualTypeOf<{
      kind: 'row' | 'card';
      title: string;
      metadata?: ReactNode;
      primaryAction: ReactNode;
      secondaryActions?: ReactNode;
      children?: ReactNode;
    }>();
  });
});
