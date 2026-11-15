import { afterEach, expect, it, vi } from 'vitest';
import { handleDialogEscape, installEscapeBoundary, registerEscapeLayer } from '../src/app/ui/escape';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).reverse().forEach(cleanup => cleanup()));
function page() {
  const view = Object.assign(new EventTarget(), { getComputedStyle: () => ({}) });
  const root = (hidden = false) => ({ ownerDocument: { defaultView: view }, isConnected: true, closest: () => hidden ? {} : null, contains: () => false }) as unknown as HTMLElement;
  return { view: view as unknown as Window, root };
}
function key(view: EventTarget, type = 'keydown', properties = {}) {
  const event = new Event(type, { cancelable: true }); Object.defineProperty(event, 'key', { value: 'Escape' }); Object.assign(event, properties); view.dispatchEvent(event); return event;
}

it('isolates an idle page, releases without dismissing, and leaves other shortcuts alone', () => {
  const { view, root } = page(), close = vi.fn(); cleanups.push(installEscapeBoundary(view), registerEscapeLayer(root(), close));
  expect(key(view).defaultPrevented).toBe(true); expect(close).toHaveBeenCalledOnce();
  expect(key(view, 'keyup').defaultPrevented).toBe(true); expect(key(view, 'keydown', { repeat: true }).defaultPrevented).toBe(true); expect(close).toHaveBeenCalledOnce();
  const unregister = cleanups.pop()!; unregister(); expect(key(view).defaultPrevented).toBe(true);
  const ordinary = new Event('keydown', { cancelable: true }); Object.defineProperty(ordinary, 'key', { value: 'Enter' }); view.dispatchEvent(ordinary); expect(ordinary.defaultPrevented).toBe(false);
});

it('handles only the newest visible layer and does not dismiss on an already claimed or composing key', () => {
  const { view, root } = page(), lower = vi.fn(), upper = vi.fn(), hidden = vi.fn();
  cleanups.push(registerEscapeLayer(root(), lower, 0), registerEscapeLayer(root(), upper), registerEscapeLayer(root(true), hidden));
  key(view); expect(upper).toHaveBeenCalledOnce(); expect(lower).not.toHaveBeenCalled(); expect(hidden).not.toHaveBeenCalled();
  const claimed = new Event('keydown', { cancelable: true }); Object.defineProperty(claimed, 'key', { value: 'Escape' }); claimed.preventDefault(); view.dispatchEvent(claimed);
  key(view, 'keydown', { isComposing: true }); expect(upper).toHaveBeenCalledOnce();
});

it('consumes dialog Escape synchronously and respects an inner editor or IME', () => {
  const close = vi.fn(), event = { key: 'Escape', defaultPrevented: false, nativeEvent: { isComposing: false }, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  handleDialogEscape(event, close); expect(close).toHaveBeenCalledOnce(); expect(event.preventDefault).toHaveBeenCalledOnce(); expect(event.stopPropagation).toHaveBeenCalledOnce();
  handleDialogEscape({ ...event, defaultPrevented: true }, close); handleDialogEscape({ ...event, nativeEvent: { isComposing: true } }, close); expect(close).toHaveBeenCalledOnce();
});
