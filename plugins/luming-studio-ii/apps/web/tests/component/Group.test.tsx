import { act } from 'react';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { Button, Group } from '../../src/ui/base/index.js';
import type { GroupProps } from '../../src/ui/base/index.js';
import { createControlFixture } from '../support/render-control.js';

describe('Group', () => {
  let fixture: ReturnType<typeof createControlFixture>;

  beforeEach(() => {
    fixture = createControlFixture();
  });

  afterEach(() => fixture.dispose());

  it('gives child controls an accessible group without adding a Tab stop', () => {
    expectTypeOf<GroupProps>().not.toHaveProperty('ref');
    fixture.render(
      <Group label="作品操作" orientation="vertical">
        <Button label="复制" onActivate={vi.fn()} />
        <Button label="删除" onActivate={vi.fn()} />
      </Group>,
    );
    const group = fixture.host.querySelector<HTMLElement>('[role="group"]');
    if (!group) {
      throw new Error('Group is missing.');
    }

    expect(group.getAttribute('aria-label')).toBe('作品操作');
    expect(group.tabIndex).toBe(-1);
    expect([...group.querySelectorAll('button')].map((button) => button.tabIndex)).toEqual([0, 0]);
  });

  it('keeps native key handling, click activation, and focus on the child controls', () => {
    const onCopy = vi.fn();
    fixture.render(
      <Group label="作品操作">
        <Button label="复制" onActivate={onCopy} />
        <Button label="删除" onActivate={vi.fn()} />
      </Group>,
    );
    const copy = [...fixture.host.querySelectorAll('button')].find(
      (button) => button.textContent === '复制',
    );

    if (!copy) {
      throw new Error('Copy button is missing.');
    }

    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      copy.focus();
      copy.dispatchEvent(event);
      copy.click();
    });

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(copy);
    expect(onCopy).toHaveBeenCalledTimes(1);
  });
});
