import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  ContextMenuTrigger,
  type ContextMenuTriggerProps,
  type ContextMenuTriggerRequest,
} from '../../src/ui/base/index.js';
import { createControlFixture } from '../support/render-control.js';

let fixture: ReturnType<typeof createControlFixture>;

beforeEach(() => {
  fixture = createControlFixture();
});

afterEach(() => fixture.dispose());

function getElement(selector: string): HTMLElement {
  const element = fixture.host.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error('Expected an element for the context menu test.');
  }

  return element;
}

function pointerMenu(target: HTMLElement): MouseEvent {
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    button: 2,
    clientX: 37,
    clientY: 51,
  });
  act(() => {
    target.dispatchEvent(event);
  });

  return event;
}

function keyboardMenu(target: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });

  return event;
}

describe('ContextMenuTrigger', () => {
  it('requests a viewport-point anchor on right click and restores the triggering control', () => {
    const onRequestOpen = vi.fn<(request: ContextMenuTriggerRequest) => void>();
    fixture.render(
      <>
        <ContextMenuTrigger onRequestOpen={onRequestOpen}>
          <button type="button">
            <span id="trigger-label">白板对象</span>
          </button>
        </ContextMenuTrigger>
        <button id="outside" type="button">
          外部按钮
        </button>
      </>,
    );

    const event = pointerMenu(getElement('#trigger-label'));
    const request = onRequestOpen.mock.lastCall?.[0];
    expect(event.defaultPrevented).toBe(true);
    expect(onRequestOpen).toHaveBeenCalledTimes(1);
    expect(request).toMatchObject({ anchor: { x: 37, y: 51 }, source: 'pointer' });
    getElement('#outside').focus();
    request?.restoreFocus();
    expect(document.activeElement).toBe(getElement('button'));
  });

  it.each([
    { key: 'F10', shiftKey: true },
    { key: 'ContextMenu', shiftKey: false },
  ])('anchors $key to the focused element and returns focus on request', (shortcut) => {
    const onRequestOpen = vi.fn<(request: ContextMenuTriggerRequest) => void>();
    fixture.render(
      <>
        <ContextMenuTrigger onRequestOpen={onRequestOpen}>
          <button id="keyboard-trigger" type="button">
            白板对象
          </button>
        </ContextMenuTrigger>
        <button id="outside" type="button">
          外部按钮
        </button>
      </>,
    );
    const focused = getElement('#keyboard-trigger');
    focused.focus();

    expect(keyboardMenu(focused, shortcut).defaultPrevented).toBe(true);
    expect(keyboardMenu(focused, { ...shortcut, repeat: true }).defaultPrevented).toBe(true);
    const request = onRequestOpen.mock.lastCall?.[0];
    expect(onRequestOpen).toHaveBeenCalledTimes(1);
    expect(request?.source).toBe('keyboard');
    expect(request?.anchor).toBe(focused);
    getElement('#outside').focus();
    request?.restoreFocus();
    expect(document.activeElement).toBe(focused);
  });

  it('passes the explicit focus callback to the caller', () => {
    const returnFocus = vi.fn();
    const onRequestOpen = vi.fn<(request: ContextMenuTriggerRequest) => void>();
    fixture.render(
      <ContextMenuTrigger returnFocus={returnFocus} onRequestOpen={onRequestOpen}>
        <span>白板对象</span>
      </ContextMenuTrigger>,
    );

    pointerMenu(getElement('span'));
    expect(returnFocus).not.toHaveBeenCalled();
    onRequestOpen.mock.lastCall?.[0].restoreFocus();
    expect(returnFocus).toHaveBeenCalledTimes(1);
  });

  it('leaves disabled triggers, plain F10, and composing shortcuts to the browser', () => {
    const onRequestOpen = vi.fn();
    fixture.render(
      <ContextMenuTrigger enabled={false} onRequestOpen={onRequestOpen}>
        <button type="button">对象</button>
      </ContextMenuTrigger>,
    );
    const button = getElement('button');
    expect(pointerMenu(button).defaultPrevented).toBe(false);
    expect(keyboardMenu(button, { key: 'ContextMenu' }).defaultPrevented).toBe(false);

    fixture.render(
      <ContextMenuTrigger onRequestOpen={onRequestOpen}>
        <button type="button">对象</button>
      </ContextMenuTrigger>,
    );
    expect(keyboardMenu(button, { key: 'F10' }).defaultPrevented).toBe(false);
    expect(keyboardMenu(button, { key: 'ContextMenu', isComposing: true }).defaultPrevented).toBe(
      false,
    );
    expect(onRequestOpen).not.toHaveBeenCalled();
  });

  it('keeps only one request when a nested trigger handles the event', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    fixture.render(
      <ContextMenuTrigger onRequestOpen={outer}>
        <ContextMenuTrigger onRequestOpen={inner}>
          <button type="button">对象</button>
        </ContextMenuTrigger>
      </ContextMenuTrigger>,
    );
    const button = getElement('button');
    expect(pointerMenu(button).defaultPrevented).toBe(true);
    expect(keyboardMenu(button, { key: 'ContextMenu' }).defaultPrevented).toBe(true);

    expect(inner).toHaveBeenCalledTimes(2);
    expect(outer).not.toHaveBeenCalled();
  });

  it('leaves editing controls and editable content to native behavior', () => {
    const onRequestOpen = vi.fn();
    fixture.render(
      <ContextMenuTrigger onRequestOpen={onRequestOpen}>
        <input aria-label="表单标题" />
        <textarea aria-label="备注" />
        <div contentEditable suppressContentEditableWarning>
          <span id="editable-content">编辑内容</span>
        </div>
      </ContextMenuTrigger>,
    );

    for (const selector of ['input', 'textarea', '#editable-content']) {
      const element = getElement(selector);
      expect(pointerMenu(element).defaultPrevented).toBe(false);
      expect(keyboardMenu(element, { key: 'F10', shiftKey: true }).defaultPrevented).toBe(false);
    }

    expect(onRequestOpen).not.toHaveBeenCalled();
  });

  it('exposes only the public trigger and request contracts', () => {
    expectTypeOf<ContextMenuTriggerProps>().toEqualTypeOf<{
      enabled?: boolean;
      children: ReactNode;
      returnFocus?: () => void;
      onRequestOpen: (request: ContextMenuTriggerRequest) => void;
    }>();
    expectTypeOf<ContextMenuTriggerRequest>().toEqualTypeOf<{
      anchor: Element | { x: number; y: number };
      source: 'pointer' | 'keyboard';
      restoreFocus: () => void;
    }>();
  });
});
