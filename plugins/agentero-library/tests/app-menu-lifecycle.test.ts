import { afterEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ menu: null as any, effects: [] as (() => (() => void) | void)[], refs: 0, positions: [] as unknown[] }));
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>();
  return { ...actual,
    useRef: (value: unknown) => ({ current: hooks.refs++ === 0 ? hooks.menu : value }),
    useState: () => [null, (value: unknown) => hooks.positions.push(value)],
    useLayoutEffect: (effect: () => (() => void) | void) => { hooks.effects.push(effect); },
  };
});
vi.mock('react-dom', () => ({ createPortal: (content: unknown) => content }));
import { AnchoredMenu } from '../src/app/ui/AnchoredMenu';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); hooks.positions = []; });

function surface() {
  const view = Object.assign(new EventTarget(), { innerWidth: 800, innerHeight: 600 });
  const body = {}, owner = Object.assign(new EventTarget(), { defaultView: view, body, activeElement: body as any });
  const button = { focus: vi.fn(() => { owner.activeElement = button; }) };
  const lastButton = { focus: vi.fn(() => { owner.activeElement = lastButton; }) };
  const anchor = { ownerDocument: owner, isConnected: true, getBoundingClientRect: () => ({ left: 40, right: 60, top: 100, bottom: 124 }), contains: (node: unknown) => node === anchor, focus: vi.fn(() => { owner.activeElement = anchor; }) };
  const menu = { querySelectorAll: () => [button, lastButton], focus: vi.fn(), getBoundingClientRect: () => ({ width: 190, height: 160 }), contains: (node: unknown) => [menu, button, lastButton].includes(node as any) };
  const mount = (onClose = vi.fn()) => {
    hooks.menu = menu; hooks.refs = 0;
    AnchoredMenu({ anchor: { element: anchor as unknown as HTMLElement }, onClose, children: null });
    const cleanup = hooks.effects.shift()!(); if (cleanup) cleanups.push(cleanup);
    return onClose;
  };
  return { view, owner, anchor, menu, button, lastButton, mount };
}
function key(view: EventTarget, value: string) {
  const event = new Event('keydown', { cancelable: true }); Object.defineProperty(event, 'key', { value }); view.dispatchEvent(event); return event;
}
function pointer(owner: EventTarget, target: unknown) {
  const event = new Event('pointerdown'); Object.defineProperty(event, 'target', { value: target }); owner.dispatchEvent(event);
}

it('enters the menu, moves through items, consumes Escape, and restores the trigger', () => {
  const ctx = surface(), close = ctx.mount(), hostKey = vi.fn();
  expect(ctx.button.focus).toHaveBeenCalled();
  key(ctx.view, 'ArrowDown'); expect(ctx.lastButton.focus).toHaveBeenCalled();
  key(ctx.view, 'Home'); expect(ctx.owner.activeElement).toBe(ctx.button);
  ctx.view.addEventListener('keydown', hostKey);
  expect(key(ctx.view, 'Escape').defaultPrevented).toBe(true);
  expect(hostKey).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
  cleanups.pop()!(); expect(ctx.anchor.focus).toHaveBeenCalled();
});

it('ignores its trigger and contents, closes on outside pointer events, and allows one open menu', () => {
  const first = surface(), firstClose = first.mount();
  pointer(first.owner, first.anchor); pointer(first.owner, first.button); expect(firstClose).not.toHaveBeenCalled();
  const second = surface(), secondClose = second.mount(); expect(firstClose).toHaveBeenCalledOnce();
  pointer(second.owner, {}); expect(secondClose).toHaveBeenCalledOnce();
});
