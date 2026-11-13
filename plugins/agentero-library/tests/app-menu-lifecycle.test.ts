import { afterEach, expect, it, vi } from 'vitest';

interface HookRender { menu: any; slots: any[]; index: number; pending: (() => void)[] }
const hooks = vi.hoisted(() => ({ current: null as HookRender | null }));
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>();
  const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  return { ...actual,
    useRef: (value: unknown) => {
      const render = hooks.current!, index = render.index++;
      return render.slots[index] ||= { current: index === 0 ? render.menu : value };
    },
    useState: (value: unknown) => {
      const render = hooks.current!, index = render.index++;
      const slot = render.slots[index] ||= { value };
      return [slot.value, (next: unknown) => { slot.value = next; }];
    },
    useLayoutEffect: (effect: () => (() => void) | void, dependencies?: unknown[]) => {
      const render = hooks.current!, index = render.index++, old = render.slots[index];
      if (!old || !same(old.dependencies, dependencies)) {
        const slot = render.slots[index] = { dependencies, cleanup: old?.cleanup };
        render.pending.push(() => { old?.cleanup?.(); slot.cleanup = effect(); });
      }
    },
  };
});
vi.mock('react-dom', () => ({ createPortal: (content: any) => {
  // Apply the rendered style before layout effects, matching a DOM commit.
  hooks.current!.menu.visibility = content.props.style.visibility;
  return content;
} }));
import { AnchoredMenu } from '../src/app/ui/AnchoredMenu';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); hooks.current = null; });

function surface() {
  const view = Object.assign(new EventTarget(), { innerWidth: 800, innerHeight: 600 });
  const body = {}, owner = Object.assign(new EventTarget(), { defaultView: view, body, activeElement: body as any });
  const button = { focus: vi.fn(() => { if (menu.visibility === 'visible') owner.activeElement = button; }) };
  const lastButton = { focus: vi.fn(() => { if (menu.visibility === 'visible') owner.activeElement = lastButton; }) };
  const anchor = { ownerDocument: owner, isConnected: true, getBoundingClientRect: () => ({ left: 40, right: 60, top: 100, bottom: 124 }), contains: (node: unknown) => node === anchor, focus: vi.fn(() => { owner.activeElement = anchor; }) };
  const menu = { visibility: 'hidden', querySelector: () => button, querySelectorAll: () => [button, lastButton], focus: vi.fn(() => { if (menu.visibility === 'visible') owner.activeElement = menu; }), getBoundingClientRect: () => ({ width: 190, height: 160 }), contains: (node: unknown) => [menu, button, lastButton].includes(node as any) };
  owner.activeElement = anchor;
  const render: HookRender = { menu, slots: [], index: 0, pending: [] };
  const menuAnchor = { element: anchor as unknown as HTMLElement };
  let close = vi.fn();
  const commit = () => {
    hooks.current = render; render.index = 0;
    AnchoredMenu({ anchor: menuAnchor, onClose: close, children: null });
    render.pending.splice(0).forEach(effect => effect());
  };
  const dispose = () => { render.slots.forEach(slot => slot?.cleanup?.()); render.slots = []; };
  cleanups.push(dispose);
  const mount = (onClose = vi.fn(), reveal = true) => {
    close = onClose; commit(); if (reveal) commit(); return onClose;
  };
  return { view, owner, anchor, menu, button, lastButton, mount, commit, dispose };
}
function key(view: EventTarget, value: string) {
  const event = new Event('keydown', { cancelable: true }); Object.defineProperty(event, 'key', { value }); view.dispatchEvent(event); return event;
}
function pointer(owner: EventTarget, target: unknown) {
  const event = new Event('pointerdown'); Object.defineProperty(event, 'target', { value: target }); owner.dispatchEvent(event);
}

it('focuses only after the measured visible commit and keeps the current item on later placement updates', () => {
  const ctx = surface(); ctx.mount(vi.fn(), false);
  expect(ctx.menu.visibility).toBe('hidden'); expect(ctx.owner.activeElement).toBe(ctx.anchor);
  expect(ctx.button.focus).not.toHaveBeenCalled();
  ctx.commit();
  expect(ctx.menu.visibility).toBe('visible'); expect(ctx.owner.activeElement).toBe(ctx.button);
  key(ctx.view, 'ArrowDown'); expect(ctx.owner.activeElement).toBe(ctx.lastButton);
  ctx.view.dispatchEvent(new Event('resize')); ctx.commit();
  expect(ctx.owner.activeElement).toBe(ctx.lastButton); expect(ctx.button.focus).toHaveBeenCalledOnce();
});

it('enters the menu, moves through items, consumes Escape, and restores the trigger', () => {
  const ctx = surface(), close = ctx.mount(), hostKey = vi.fn();
  expect(ctx.button.focus).toHaveBeenCalled();
  key(ctx.view, 'ArrowDown'); expect(ctx.lastButton.focus).toHaveBeenCalled();
  key(ctx.view, 'Home'); expect(ctx.owner.activeElement).toBe(ctx.button);
  ctx.view.addEventListener('keydown', hostKey);
  expect(key(ctx.view, 'Escape').defaultPrevented).toBe(true);
  expect(hostKey).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
  ctx.dispose(); expect(ctx.anchor.focus).toHaveBeenCalled();
});

it('ignores its trigger and contents, closes on outside pointer events, and allows one open menu', () => {
  const first = surface(), firstClose = first.mount();
  pointer(first.owner, first.anchor); pointer(first.owner, first.button); expect(firstClose).not.toHaveBeenCalled();
  const second = surface(), secondClose = second.mount(); expect(firstClose).toHaveBeenCalledOnce();
  pointer(second.owner, {}); expect(secondClose).toHaveBeenCalledOnce();
});
