// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LibraryArtifactMenu } from '../src/app/LibraryArtifactMenu';
import CanvasActionsMenu from '../src/app/canvas/CanvasActionsMenu';
import type { Artifact } from '../src/contracts/studio';

let container: HTMLDivElement, root: Root, anchorTop: number;
const dimensions = { width: window.innerWidth, height: window.innerHeight };
const artifact: Artifact = { id: 'last-artifact', type: 'whiteboard', title: '很长的作品标题'.repeat(10), revision: 1, pinned: false, createdAt: '', updatedAt: '' };
function rect(left: number, top: number, width: number, height: number): DOMRect { return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }; }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 }); Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
  anchorTop = 560;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('studio')) return rect(0, 0, window.innerWidth, window.innerHeight);
    if (this.classList.contains('studio-library-main')) return rect(0, 80, window.innerWidth, window.innerHeight - 80);
    if (this.getAttribute('aria-haspopup') === 'menu') return rect(window.innerWidth - 38, anchorTop, 32, 32);
    if (this.tagName === 'SPAN' && this.style.position === 'absolute') return rect(Number.parseFloat(this.style.left), Number.parseFloat(this.style.top), 0, 0);
    if (this.classList.contains('studio-canvas-actions-menu')) return rect(0, 0, 220, 398);
    if (this.getAttribute('role') === 'menu') return rect(0, 0, 192, 220);
    return rect(0, 0, 0, 0);
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: dimensions.width }); Object.defineProperty(window, 'innerHeight', { configurable: true, value: dimensions.height }); });
function Example({ theme, layout, actions }: { theme: 'light' | 'dark'; layout: 'list' | 'grid'; actions: (() => void)[] }) {
  const [open, setOpen] = useState(false);
  return <div className="studio studio-library" data-studio-theme={theme}><main className="studio-library-main" style={{ overflow: 'auto' }}><div className={`studio-artifacts-${layout}`}><article className="studio-artifact"><LibraryArtifactMenu artifact={artifact} open={open} busy={false} onOpenChange={setOpen} onPin={actions[0]!} onRename={actions[1]!} onCopyLink={actions[2]!} onDuplicate={actions[3]!} onTrash={actions[4]!} /></article></div></main></div>;
}
async function click(node: HTMLElement) { await act(async () => node.click()); }

it.each(['light', 'dark'] as const)('keeps the canvas action menu inside a short %s viewport and preserves its delete action', async theme => {
  const command = vi.fn(), close = vi.fn();
  await act(async () => root.render(<div className="studio" data-studio-theme={theme}><section className="studio-whiteboard" style={{ overflow: 'hidden' }}><CanvasActionsMenu point={{ x: 380, y: 560 }} canEdit selected={1} locked={false} hasClipboard onCommand={command} onClose={close} /></section></div>));
  const menu = container.querySelector<HTMLElement>('[role="menu"]')!;
  expect(menu.parentElement).toBe(container.querySelector('.studio'));
  expect(menu.closest('.studio-whiteboard')).toBeNull();
  expect(menu.dataset.placement).toBe('point');
  expect(menu.style.top).toBe('194px');
  expect(menu.style.left).toBe('172px');
  expect(menu.style.maxHeight).toBe('584px');
  expect(menu.closest('[data-studio-theme]')?.getAttribute('data-studio-theme')).toBe(theme);
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 260 });
  await act(async () => window.dispatchEvent(new Event('resize')));
  expect(menu.style.top).toBe('8px');
  expect(menu.style.maxHeight).toBe('244px');
  await act(async () => menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })));
  expect(document.activeElement?.textContent).toBe('适应白板Shift 1');
  const remove = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === '删除Delete')!;
  expect(remove.disabled).toBe(false);
  await click(remove);
  expect(command).toHaveBeenCalledWith('delete');
  expect(close).toHaveBeenCalledOnce();
});

it.each([['light', 'list'], ['dark', 'list'], ['light', 'grid'], ['dark', 'grid']] as const)('keeps all five actions above the last %s %s item, outside its scroll pane and inside its theme root', async (theme, layout) => {
  const actions = Array.from({ length: 5 }, () => vi.fn());
  await act(async () => root.render(<Example theme={theme} layout={layout} actions={actions} />));
  const trigger = container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
  for (let index = 0; index < actions.length; index++) {
    await click(trigger);
    const menu = container.querySelector<HTMLElement>('[role="menu"]')!;
    expect(menu.parentElement).toBe(container.querySelector('.studio'));
    expect(menu.closest('.studio-library-main')).toBeNull();
    expect(menu.closest('[data-studio-theme]')?.getAttribute('data-studio-theme')).toBe(theme);
    expect(menu.dataset.placement).toBe('above'); expect(menu.style.position).toBe('fixed');
    expect(Number.parseFloat(menu.style.top)).toBe(334);
    expect(Number.parseFloat(menu.style.left)).toBeGreaterThanOrEqual(8);
    expect(Number.parseFloat(menu.style.left) + 192).toBeLessThanOrEqual(392);
    const items = menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    expect(items).toHaveLength(5); await click(items[index]!);
    expect(actions[index]).toHaveBeenCalledOnce(); expect(container.querySelector('[role="menu"]')).toBeNull();
  }
});

it('repositions with a visible scrolled anchor, closes once it leaves the pane and restores keyboard focus on Escape', async () => {
  await act(async () => root.render(<Example theme="dark" layout="list" actions={Array.from({ length: 5 }, () => vi.fn())} />));
  const trigger = container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!, scrollPane = container.querySelector('main')!;
  await click(trigger);
  anchorTop = 180;
  await act(async () => scrollPane.dispatchEvent(new Event('scroll')));
  expect(container.querySelector<HTMLElement>('[role="menu"]')?.dataset.placement).toBe('below');
  expect(container.querySelector<HTMLElement>('[role="menu"]')?.style.top).toBe('218px');
  anchorTop = 20;
  await act(async () => scrollPane.dispatchEvent(new Event('scroll')));
  expect(container.querySelector('[role="menu"]')).toBeNull();
  anchorTop = 560; await click(trigger);
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })));
  expect(document.activeElement?.textContent).toBe('移入回收站');
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(container.querySelector('[role="menu"]')).toBeNull(); expect(document.activeElement).toBe(trigger);
});
