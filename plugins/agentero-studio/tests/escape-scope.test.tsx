// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { installEscapeBoundary, registerEscapeLayer } from '../src/app/shared/escape';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).reverse().forEach(cleanup => cleanup()); document.body.replaceChildren(); });
function layer(hidden = false) { const node = document.createElement('section'); node.hidden = hidden; document.body.append(node); return node; }
function key(node: EventTarget, type = 'keydown', options: KeyboardEventInit = {}) { const event = new KeyboardEvent(type, { key: 'Escape', bubbles: true, cancelable: true, ...options }); node.dispatchEvent(event); return event; }

it('lets a local editor handle the first press, blocks repeat and release, and isolates an idle page', () => {
  cleanups.push(installEscapeBoundary(window));
  const root = layer(), close = vi.fn(), editor = document.createElement('input'); root.append(editor);
  cleanups.push(registerEscapeLayer(root, close));
  const edit = vi.fn((event: KeyboardEvent) => { event.preventDefault(); event.stopPropagation(); }); editor.addEventListener('keydown', edit);
  expect(key(editor).defaultPrevented).toBe(true); expect(edit).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
  expect(key(editor, 'keydown', { repeat: true }).defaultPrevented).toBe(true); expect(edit).toHaveBeenCalledOnce();
  expect(key(document.body, 'keyup').defaultPrevented).toBe(true); expect(close).not.toHaveBeenCalled();
  const unregister = cleanups.pop()!; unregister();
  expect(key(document.body).defaultPrevented).toBe(true);
  expect(key(document.body, 'keydown', { key: 'Enter' }).defaultPrevented).toBe(false);
});

it('dismisses just the top visible layer, skips hidden instances and leaves composing input intact', () => {
  const base = vi.fn(), top = vi.fn(), hidden = vi.fn();
  cleanups.push(registerEscapeLayer(layer(), base, 0), registerEscapeLayer(layer(), top), registerEscapeLayer(layer(true), hidden));
  expect(key(document.body).defaultPrevented).toBe(true); expect(top).toHaveBeenCalledOnce(); expect(base).not.toHaveBeenCalled(); expect(hidden).not.toHaveBeenCalled();
  key(document.body, 'keydown', { isComposing: true }); expect(top).toHaveBeenCalledOnce();
});

it('runs a nested control before a parent dialog and restores the parent for the next press', () => {
  const dialog = layer(), menu = document.createElement('div'); dialog.append(menu);
  const closeDialog = vi.fn(), closeMenu = vi.fn();
  cleanups.push(registerEscapeLayer(dialog, closeDialog, 20));
  const unregister = registerEscapeLayer(menu, closeMenu);
  key(menu); expect(closeMenu).toHaveBeenCalledOnce(); expect(closeDialog).not.toHaveBeenCalled();
  unregister(); key(dialog, 'keyup'); expect(closeDialog).not.toHaveBeenCalled(); key(dialog); expect(closeDialog).toHaveBeenCalledOnce();
});
