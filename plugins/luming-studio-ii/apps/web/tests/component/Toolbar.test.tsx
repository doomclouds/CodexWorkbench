import { act } from 'react';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { Button, Group, Select, TextField, Toolbar } from '../../src/ui/base/index.js';
import type { ToolbarProps } from '../../src/ui/base/index.js';
import { createControlFixture } from '../support/render-control.js';

function element<T extends HTMLElement>(host: HTMLElement, selector: string) {
  const result = host.querySelector<T>(selector);
  if (!result) {
    throw new Error('Toolbar fixture element is missing.');
  }

  return result;
}

function press(target: HTMLElement, key: string) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });

  return event;
}

const noop = () => undefined;

describe('Toolbar', () => {
  let fixture: ReturnType<typeof createControlFixture>;

  beforeEach(() => {
    fixture = createControlFixture();
  });

  afterEach(() => fixture.dispose());

  function action(label: string) {
    const button = [...fixture.host.querySelectorAll('button')].find(
      (item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label,
    );

    if (!button) {
      throw new Error('Toolbar action is missing.');
    }

    return button;
  }

  function stop(label: string) {
    expect(action(label).tabIndex).toBe(0);
    expect(document.activeElement).toBe(action(label));
  }

  it('names a toolbar and gives only the first available action a Tab stop on open', () => {
    expectTypeOf<ToolbarProps>().not.toHaveProperty('ref');
    fixture.render(
      <Toolbar label="作品操作">
        <Button label="复制" disabled onActivate={noop} />
        <Button label="重命名" onActivate={noop} />
        <Button label="删除" onActivate={noop} />
      </Toolbar>,
    );
    const toolbar = element(fixture.host, '[role="toolbar"]');
    expect(toolbar.getAttribute('aria-label')).toBe('作品操作');
    expect(toolbar.getAttribute('aria-orientation')).toBe('horizontal');
    expect(toolbar.tabIndex).toBe(-1);
    expect([action('复制').tabIndex, action('重命名').tabIndex, action('删除').tabIndex]).toEqual([
      -1, 0, -1,
    ]);
  });

  it('leaves the action Tab entry on the first rendered control when CSS hides earlier actions', () => {
    fixture.render(
      <>
        <style>{'.toolbar-fixture-hidden { display: none; }'}</style>
        <Toolbar label="作品操作">
          <button type="button" className="toolbar-fixture-hidden">
            暂不可见
          </button>
          <div className="toolbar-fixture-hidden">
            <Button label="父项不可见" onActivate={noop} />
          </div>
          <Button label="重命名" onActivate={noop} />
          <Button label="删除" onActivate={noop} />
        </Toolbar>
      </>,
    );

    expect(getComputedStyle(action('暂不可见')).display).toBe('none');
    expect(action('暂不可见').tabIndex).toBe(-1);
    expect(action('父项不可见').tabIndex).toBe(-1);
    expect(action('重命名').tabIndex).toBe(0);
    expect(action('删除').tabIndex).toBe(-1);
  });

  it('updates the entry and recovers focus when active actions become CSS-hidden', async () => {
    function renderActions(hidden = false) {
      fixture.render(
        <>
          <style>{'.toolbar-fixture-concealed { visibility: hidden; }'}</style>
          <Toolbar label="作品操作">
            <button type="button" className={hidden ? 'toolbar-fixture-concealed' : undefined}>
              复制
            </button>
            <Button label="重命名" onActivate={noop} />
          </Toolbar>
        </>,
      );
    }

    renderActions();
    act(() => action('复制').focus());
    stop('复制');

    await act(async () => {
      renderActions(true);
      await Promise.resolve();
    });

    expect(getComputedStyle(action('复制')).visibility).toBe('hidden');
    expect(action('复制').tabIndex).toBe(-1);
    stop('重命名');
  });

  it('navigates horizontal actions, wraps, and preserves native activation', () => {
    const onRename = vi.fn();
    fixture.render(
      <Toolbar label="作品操作">
        <Button label="复制" onActivate={noop} />
        <Button label="不可用" disabled onActivate={noop} />
        <Button label="重命名" onActivate={onRename} />
        <Button label="删除" onActivate={noop} />
      </Toolbar>,
    );
    act(() => action('复制').focus());
    expect(press(action('复制'), 'ArrowRight').defaultPrevented).toBe(true);
    stop('重命名');
    expect(action('复制').tabIndex).toBe(-1);

    expect(press(action('重命名'), 'Enter').defaultPrevented).toBe(false);
    act(() => action('重命名').click());
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(press(action('重命名'), 'ArrowDown').defaultPrevented).toBe(false);
    stop('重命名');

    press(action('重命名'), 'End');
    stop('删除');
    press(action('删除'), 'ArrowRight');
    stop('复制');
    press(action('复制'), 'ArrowLeft');
    stop('删除');
    press(action('删除'), 'Home');
    stop('复制');
  });

  it('uses the vertical axis and keeps a newly focused action as the next Tab entry', () => {
    fixture.render(
      <>
        <Toolbar label="作品操作" orientation="vertical">
          <Button label="复制" onActivate={noop} />
          <Button label="重命名" onActivate={noop} />
          <Button label="删除" onActivate={noop} />
        </Toolbar>
        <button type="button" aria-label="下一项">
          下一项
        </button>
      </>,
    );
    const toolbar = element(fixture.host, '[role="toolbar"]');
    expect(toolbar.getAttribute('aria-orientation')).toBe('vertical');
    act(() => action('重命名').focus());
    stop('重命名');
    expect(action('复制').tabIndex).toBe(-1);
    expect(press(action('重命名'), 'ArrowRight').defaultPrevented).toBe(false);

    press(action('重命名'), 'ArrowDown');
    stop('删除');
    press(action('删除'), 'ArrowUp');
    stop('重命名');
    const next = action('下一项');
    expect(press(action('重命名'), 'Tab').defaultPrevented).toBe(false);
    act(() => next.focus());
    expect(action('重命名').tabIndex).toBe(0);
    expect(document.activeElement).toBe(next);
  });

  it('keeps editing controls in the native Tab order and leaves their direction keys alone', () => {
    fixture.render(
      <Toolbar label="作品操作">
        <Button label="复制" onActivate={noop} />
        <TextField label="作品名称" value="设计稿" onValueChange={noop} />
        <Select
          label="格式"
          value="svg"
          options={[
            { id: 'svg', label: 'SVG' },
            { id: 'png', label: 'PNG' },
          ]}
          onValueChange={noop}
        />
        <Button label="删除" onActivate={noop} />
      </Toolbar>,
    );
    const input = element<HTMLInputElement>(fixture.host, 'input');
    const select = element<HTMLSelectElement>(fixture.host, 'select');
    expect(input.tabIndex).toBe(0);
    expect(select.tabIndex).toBe(0);
    expect(action('复制').tabIndex).toBe(0);
    expect(action('删除').tabIndex).toBe(-1);

    act(() => input.focus());
    expect(press(input, 'ArrowLeft').defaultPrevented).toBe(false);
    expect(press(input, 'Home').defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(input);

    act(() => select.focus());
    expect(press(select, 'ArrowRight').defaultPrevented).toBe(false);
    expect(press(select, 'End').defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(select);
    expect(action('复制').tabIndex).toBe(0);
  });

  it('recovers focus to the next available action when the active action is disabled or removed', async () => {
    function renderActions(disabled = false, includeRemove = true) {
      fixture.render(
        <Toolbar label="作品操作">
          <Button key="copy" label="复制" onActivate={noop} />
          <Button key="rename" label="重命名" disabled={disabled} onActivate={noop} />
          {includeRemove && <Button key="remove" label="删除" onActivate={noop} />}
        </Toolbar>,
      );
    }

    renderActions();
    act(() => action('重命名').focus());
    stop('重命名');

    await act(async () => {
      renderActions(true);
      await Promise.resolve();
    });
    stop('删除');
    expect(action('重命名').tabIndex).toBe(-1);

    await act(async () => {
      renderActions(true, false);
      await Promise.resolve();
    });
    stop('复制');
  });

  it('repairs the Tab entry after removal without taking focus from another control', async () => {
    function renderActions(includeRemove = true) {
      fixture.render(
        <>
          <Toolbar label="作品操作">
            <Button key="copy" label="复制" onActivate={noop} />
            {includeRemove && <Button key="remove" label="删除" onActivate={noop} />}
          </Toolbar>
          <button type="button" aria-label="下一项">
            下一项
          </button>
        </>,
      );
    }

    renderActions();
    act(() => action('删除').focus());
    act(() => action('下一项').focus());

    await act(async () => {
      renderActions(false);
      await Promise.resolve();
    });
    expect(action('复制').tabIndex).toBe(0);
    expect(document.activeElement).toBe(action('下一项'));
  });

  it('roves through a Group and leaves a nested Toolbar in charge of its own actions', () => {
    fixture.render(
      <Toolbar label="作品操作">
        <Button label="复制" onActivate={noop} />
        <Group label="附加操作">
          <Button label="重命名" onActivate={noop} />
        </Group>
        <Toolbar label="缩放">
          <Button label="缩小" onActivate={noop} />
          <Button label="放大" onActivate={noop} />
        </Toolbar>
      </Toolbar>,
    );
    act(() => action('复制').focus());
    press(action('复制'), 'ArrowRight');
    stop('重命名');
    expect(action('缩小').tabIndex).toBe(0);

    act(() => action('缩小').focus());
    press(action('缩小'), 'ArrowRight');
    stop('放大');
    expect(action('重命名').tabIndex).toBe(0);
  });
});
