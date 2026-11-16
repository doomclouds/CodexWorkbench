// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ReadingControls, { type ReadingControlsProps } from '../src/app/canvas/ReadingControls.js';

let host: HTMLDivElement, root: Root, props: ReadingControlsProps;
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const field = () => host.querySelector<HTMLInputElement>('[aria-label="全屏缩放比例"]')!;
async function mount(extra: Partial<ReadingControlsProps> = {}) { props = { ...props, ...extra }; await act(async () => root.render(<ReadingControls {...props} />)); }
async function click(label: string) { await act(async () => button(label).click()); }
async function change(value: string) {
  await act(async () => { field().focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field(), value); field().dispatchEvent(new Event('input', { bubbles: true })); });
}
async function key(key: string, target: HTMLElement = field()) { await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); }); }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  props = { zoom: 1, onZoom: vi.fn(), onFit: vi.fn(), markerMode: false, onMarkerModeChange: vi.fn(), onClear: vi.fn(), onCanvasFocus: vi.fn() };
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('commits a precise percentage once and returns keyboard focus to the canvas', async () => {
  await mount(); await change('137.5%'); await key('Enter');
  expect(props.onZoom).toHaveBeenCalledExactlyOnceWith(1.375);
  expect(field().value).toBe('137.5'); expect(props.onCanvasFocus).toHaveBeenCalledOnce();
});
it.each(['abc', '801', '4.9'])('keeps the current view when an invalid percentage %s is entered', async value => {
  await mount(); await change(value); await key('Enter');
  expect(props.onZoom).not.toHaveBeenCalled(); expect(host.querySelector('[role=alert]')?.textContent).toContain('5%–800%'); expect(field().getAttribute('aria-invalid')).toBe('true');
});
it('discards an unfinished percentage on Escape without changing the view', async () => {
  await mount(); await change('250'); await key('Escape');
  expect(field().value).toBe('100'); expect(props.onZoom).not.toHaveBeenCalled(); expect(props.onCanvasFocus).toHaveBeenCalledOnce();
});
it('shows gesture-driven ratio changes and bounds the stable step buttons', async () => {
  await mount({ zoom: .75 }); expect(field().value).toBe('75');
  await click('全屏放大'); expect(vi.mocked(props.onZoom).mock.lastCall?.[0]).toBeCloseTo(.9, 12);
  await mount({ zoom: .05 }); expect(field().value).toBe('5'); expect(button('全屏缩小').disabled).toBe(true);
  await mount({ zoom: 8 }); expect(button('全屏放大').disabled).toBe(true);
  await click('适应全屏内容'); expect(props.onFit).toHaveBeenCalledOnce();
});
it('focuses the current preset, supports arrow keys and closes its menu before leaving the view', async () => {
  await mount(); await click('常用全屏比例');
  expect(document.activeElement?.textContent).toBe('100%');
  await key('ArrowDown', document.activeElement as HTMLElement); expect(document.activeElement?.textContent).toBe('150%');
  await key('Escape', document.activeElement as HTMLElement);
  expect(host.querySelector('[role=menu]')).toBeNull(); expect(document.activeElement).toBe(button('常用全屏比例')); expect(props.onCanvasFocus).not.toHaveBeenCalled();
});
it('keeps viewing, temporary drawing and clearing as explicit independent actions', async () => {
  await mount(); await click('临时荧光笔'); expect(props.onMarkerModeChange).toHaveBeenLastCalledWith(true);
  await mount({ markerMode: true }); expect(button('临时荧光笔').getAttribute('aria-pressed')).toBe('true'); expect(host.querySelector('[role=status]')?.textContent).toContain('3 秒');
  await click('浏览内容'); expect(props.onMarkerModeChange).toHaveBeenLastCalledWith(false);
  await click('清除临时笔迹'); expect(props.onClear).toHaveBeenCalledOnce(); expect(props.onZoom).not.toHaveBeenCalled();
});
it('returns pointer actions to canvas focus while retaining native keyboard activation', async () => {
  await mount();
  await act(async () => { button('临时荧光笔').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })); });
  expect(props.onCanvasFocus).toHaveBeenCalledOnce();
  await click('临时荧光笔'); expect(props.onCanvasFocus).toHaveBeenCalledOnce();
  await act(async () => { button('全屏放大').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })); });
  expect(props.onCanvasFocus).toHaveBeenCalledTimes(2);
});
