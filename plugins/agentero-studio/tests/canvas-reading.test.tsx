// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import WhiteboardCanvas, { type WhiteboardCanvasProps } from '../src/app/canvas/WhiteboardCanvas.js';
import { DEFAULT_STYLE, LOCAL_ACTOR, type Board, type BoardElement } from '../src/contracts/studio.js';

let host: HTMLDivElement, root: Root;
const originalViewport = { x: 17, y: 39, zoom: .5 };
const element = (id: string, extra: Partial<BoardElement> = {}): BoardElement => ({ id, type: 'shape', x: 100, y: 120, w: 200, h: 100, version: 1, text: id, ...extra });
const board = (elements: BoardElement[]): Board => ({ artifact: { id: 'board', type: 'whiteboard', title: 'Reading', revision: 1, createdAt: '', updatedAt: '', pinned: false }, style: DEFAULT_STYLE, elements });
const query = (label: string) => host.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
const world = () => host.querySelector<HTMLElement>('.studio-canvas-world')!;
async function event(node: Element, type: string, extra: MouseEventInit = {}) { await act(async () => { node.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, ...extra })); }); }
async function click(label: string) { await event(query(label), 'click'); }
async function key(key: string) { await act(async () => { query('白板画布').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); }); }
async function mount(elements: BoardElement[], props: Partial<WhiteboardCanvasProps> = {}) {
  await act(async () => { root.render(<WhiteboardCanvas board={board(elements)} client={{ embedded: true, call: vi.fn() }} actor={LOCAL_ACTOR} onChanged={() => {}} onAnnotate={() => {}} externalViewport={originalViewport} externalSelectedIds={[elements[0]!.id]} {...props} />); });
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(650);
  HTMLElement.prototype.setPointerCapture = vi.fn(); HTMLElement.prototype.releasePointerCapture = vi.fn(); HTMLElement.prototype.hasPointerCapture = () => false;
  host = document.createElement('div'); host.className = 'studio'; document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('opens a native component from its first-level toolbar, enlarges only that component, and restores view and focus on Escape', async () => {
  const reading = vi.fn(), changed = vi.fn();
  await mount([element('one'), element('other', { x: 1400 })], { onReadingChange: reading, onChanged: changed });
  const before = world().style.transform;
  expect(query('全屏观看选区').closest('[role="toolbar"]')?.getAttribute('aria-label')).toBe('选区格式');
  expect(host.querySelector('[role="menu"]')).toBeNull();
  await click('全屏观看选区');
  expect(host.querySelector('.studio-whiteboard')?.classList.contains('is-reading')).toBe(true);
  expect(world().style.transform).toContain('scale(4.52)');
  expect((host.querySelector('[data-element-id="other"]') as HTMLElement).style.display).toBe('none');
  expect(query('白板工具').hidden).toBe(true);
  expect(host.querySelector('.studio-selection-frame')).toBeNull();
  expect(host.querySelector('.studio-reading-hint')?.textContent).toContain('Esc');
  await key('Delete'); await key('3'); await event(host.querySelector('[data-element-id="one"]')!, 'dblclick');
  expect(changed).not.toHaveBeenCalled(); expect(host.querySelector('[contenteditable="true"]')).toBeNull();
  await key('Escape');
  expect(world().style.transform).toBe(before); expect(query('白板工具').hidden).toBe(false);
  expect((host.querySelector('[data-element-id="other"]') as HTMLElement).style.display).toBe('');
  expect(reading.mock.calls).toEqual([[true], [false]]);
  await vi.waitFor(() => expect(document.activeElement).toBe(query('全屏观看选区')));
});

it('views multiple native components and keeps locked contents of a selected container visible', async () => {
  const elements = [element('section', { type: 'container', x: 0, y: 0, w: 600, h: 360 }), element('locked-child', { locked: true }), element('second', { x: 800 }), element('outside', { x: 1600 })];
  await mount(elements, { externalSelectedIds: ['section', 'second'] }); await click('全屏观看选区');
  for (const id of ['section', 'locked-child', 'second']) expect((host.querySelector(`[data-element-id="${id}"]`) as HTMLElement).style.display).toBe('');
  expect((host.querySelector('[data-element-id="outside"]') as HTMLElement).style.display).toBe('none');
  await click('退出全屏观看'); expect(host.querySelector('.is-reading')).toBeNull();
});

it.each([['Enter', 'Enter'], [' ', 'Space']])('lets %s activate the reading button instead of editing or panning', async (key, code) => {
  await mount([element('one', { type: 'note' })]);
  const button = query('全屏观看选区'); button.focus();
  const down = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true });
  await act(async () => { button.dispatchEvent(down); });
  expect(down.defaultPrevented).toBe(false);
  expect(host.querySelector('[contenteditable="true"]')).toBeNull();
  expect(host.querySelector('.studio-whiteboard')?.getAttribute('data-tool')).toBe('select');
  // jsdom does not synthesize a button's native keyboard click.
  await click('全屏观看选区'); expect(host.querySelector('.is-reading')).not.toBeNull();
});

it.each([false, true])('makes HTML interactive without reloading it, then restores its previous interactive=%s mode through iframe Escape', async previous => {
  await mount([element('html', { type: 'html', html: '<button>Count</button>', sourceRevision: 1 })]);
  const frame = host.querySelector('iframe')!;
  if (previous) await event(host.querySelector('[data-element-id="html"]')!, 'dblclick');
  const source = frame.srcdoc, post = vi.spyOn(frame.contentWindow!, 'postMessage');
  await act(async () => { frame.dispatchEvent(new Event('load')); });
  const mode = post.mock.calls.find(([value]) => value.type === 'studio-html-mode')![0];
  await click('全屏观看选区');
  expect(host.querySelector('iframe')).toBe(frame); expect(frame.srcdoc).toBe(source); expect(frame.style.pointerEvents).toBe('auto');
  await act(async () => { window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { type: 'studio-html-escape', channel: mode.channel, regionId: 'html', sourceRevision: 1 } })); });
  expect(host.querySelector('.is-reading')).toBeNull(); expect(frame.style.pointerEvents).toBe(previous ? 'auto' : 'none');
  expect(host.querySelector('iframe')).toBe(frame);
});

it('exits safely if the viewed component is deleted remotely', async () => {
  const reading = vi.fn(); await mount([element('one')], { onReadingChange: reading }); await click('全屏观看选区');
  await act(async () => { root.render(<WhiteboardCanvas board={board([])} client={{ embedded: true, call: vi.fn() }} actor={LOCAL_ACTOR} onChanged={() => {}} onAnnotate={() => {}} onReadingChange={reading} />); });
  expect(host.querySelector('.is-reading')).toBeNull(); expect(reading.mock.lastCall).toEqual([false]);
});

it('cancels an active reading pan before restoring the previous viewport', async () => {
  await mount([element('one')]); const before = world().style.transform;
  await click('全屏观看选区');
  await event(query('白板画布'), 'pointerdown', { clientX: 300, clientY: 300 });
  await event(query('白板画布'), 'pointermove', { clientX: 400, clientY: 350 });
  await key('Escape'); expect(world().style.transform).toBe(before);
  await event(query('白板画布'), 'pointermove', { clientX: 480, clientY: 390 });
  await event(query('白板画布'), 'pointerup', { clientX: 480, clientY: 390 });
  expect(world().style.transform).toBe(before);
});

it('keeps a remotely moved reading target in view', async () => {
  await mount([element('one')]); await click('全屏观看选区'); const before = world().style.transform;
  await mount([element('one', { x: 5000, version: 2 })]);
  expect(world().style.transform).not.toBe(before); expect(host.querySelector('.is-reading')).not.toBeNull();
});

it('does not open an arrow label editor while reading', async () => {
  const changed = vi.fn();
  await mount([element('arrow', { type: 'arrow', label: 'Read only', from: [100, 120], to: [300, 220] })], { onChanged: changed });
  await click('全屏观看选区');
  await event(host.querySelector('.studio-canvas-arrow path[stroke="transparent"]')!, 'dblclick');
  expect(host.querySelector('[contenteditable="true"]')).toBeNull(); expect(changed).not.toHaveBeenCalled();
});

it('does not steal iframe focus when only its saved interaction state changes', async () => {
  const html = element('html', { type: 'html', html: '<input value="Reading"/>', sourceRevision: 1 });
  await mount([html]); await click('全屏观看选区'); const frame = host.querySelector('iframe')!;
  frame.focus(); expect(document.activeElement).toBe(frame);
  await mount([{ ...html, version: 2, state: { value: 'Changed' } }]);
  expect(document.activeElement).toBe(frame);
});

it('offers fit selection in the element context menu and fits selected rotated geometry without including the rest of the board', async () => {
  await mount([element('one', { rotation: 90 }), element('other', { x: 5000 })]);
  await event(host.querySelector('[data-element-id="one"]')!, 'contextmenu', { clientX: 120, clientY: 140 });
  const fit = [...host.querySelectorAll('button')].find(button => button.textContent?.startsWith('适应选区'))!;
  expect(fit).toBeDefined(); await event(fit, 'click');
  expect(world().style.transform).toContain('scale(2.53)');
  expect(host.querySelector('[role="menu"]')).toBeNull();
});

it('converts an interactive iframe pointer through element rotation independently of canvas zoom and clears it on leave', async () => {
  const cursor = vi.fn();
  await mount([element('html', { type: 'html', html: '<p>Pointer</p>', rotation: 90, sourceRevision: 1 })], { onCursorMove: cursor });
  await event(host.querySelector('[data-element-id="html"]')!, 'dblclick');
  const frame = host.querySelector('iframe')!, post = vi.spyOn(frame.contentWindow!, 'postMessage');
  await act(async () => { frame.dispatchEvent(new Event('load')); });
  const mode = post.mock.calls.find(([value]) => value.type === 'studio-html-mode')![0];
  const send = (point: unknown) => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { type: 'studio-html-pointer', channel: mode.channel, regionId: 'html', sourceRevision: 1, point } }));
  await act(async () => { send({ x: .75, y: .5 }); });
  await vi.waitFor(() => expect(cursor.mock.lastCall?.[0]).toEqual({ x: 200, y: 220 }));
  await act(async () => { send(null); }); expect(cursor.mock.lastCall).toEqual([null]);
});
