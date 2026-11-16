// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StudioDialog } from '../src/app/products/dialog.js';

let app: HTMLDivElement, session: HTMLDivElement, canvas: HTMLDivElement, root: Root, opener: HTMLButtonElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  app = document.createElement('div'); app.className = 'studio'; session = document.createElement('div'); session.className = 'studio-session-content';
  const header = document.createElement('header'); header.className = 'studio-editor-header';
  canvas = document.createElement('div'); canvas.className = 'studio-whiteboard'; opener = document.createElement('button'); opener.textContent = '整理选区'; header.append(opener);
  session.append(header, canvas); app.append(session); document.body.append(app); root = createRoot(canvas); opener.focus();
});
afterEach(async () => { await act(async () => root.unmount()); app.remove(); vi.unstubAllGlobals(); });

it('places a canvas dialog in the themed session layer alongside the header', async () => {
  await act(async () => root.render(<StudioDialog title="整理选区" portalRoot={session} onClose={() => {}}><p>预览</p></StudioDialog>));
  const backdrop = session.querySelector('.studio-modal-backdrop')!;
  expect(backdrop.parentElement).toBe(session); expect(canvas.querySelector('[role=dialog]')).toBeNull();
  expect(backdrop.closest('.studio')).toBe(app); expect(session.querySelector('[aria-modal=true]')).not.toBeNull();
});
it('keeps native clipboard events inside a portaled dialog without replacing their default behavior', async () => {
  const copy = vi.fn(), cut = vi.fn(), paste = vi.fn();
  await act(async () => root.render(<div onCopy={copy} onCut={cut} onPaste={paste}><StudioDialog title="比较草稿" portalRoot={session} onClose={() => {}}><textarea defaultValue="我的草稿" /></StudioDialog></div>));
  const field = session.querySelector('textarea')!;
  for (const type of ['copy', 'cut', 'paste']) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    await act(async () => { field.dispatchEvent(event); }); expect(event.defaultPrevented).toBe(false);
  }
  expect(copy).not.toHaveBeenCalled(); expect(cut).not.toHaveBeenCalled(); expect(paste).not.toHaveBeenCalled();
});
it('closes through the same Escape layer and restores the original focus', async () => {
  const close = vi.fn();
  await act(async () => root.render(<StudioDialog title="整理选区" portalRoot={session} onClose={close}><input aria-label="间距" /></StudioDialog>));
  expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭弹窗');
  await act(async () => { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
  expect(close).toHaveBeenCalledOnce();
  await act(async () => root.render(null)); expect(document.activeElement).toBe(opener);
});
