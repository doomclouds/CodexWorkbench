// @vitest-environment jsdom
import { act, type PointerEventHandler, type WheelEventHandler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ReadingMarker, { type ReadingMarkerProps } from '../src/app/canvas/ReadingMarker.js';
import { registerEscapeLayer } from '../src/app/shared/escape.js';

let host: HTMLDivElement, root: Root, props: ReadingMarkerProps, parentDown: PointerEventHandler<HTMLDivElement> | undefined, parentWheel: WheelEventHandler<HTMLDivElement> | undefined;
const surface = () => host.querySelector<HTMLDivElement>('.studio-reading-marker')!;
async function render(next: Partial<ReadingMarkerProps> = {}) { props = { ...props, ...next }; await act(async () => root.render(<div onPointerDown={parentDown} onWheel={parentWheel}><ReadingMarker {...props} /></div>)); }
async function pointer(type: string, x = 50, y = 70, extra: MouseEventInit & { pointerId?: number } = {}) {
  await act(async () => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, ...extra });
    Object.defineProperty(event, 'getCoalescedEvents', { value: () => [] });
    Object.defineProperty(event, 'pointerId', { value: extra.pointerId ?? 1 }); surface().dispatchEvent(event);
  });
}
async function stroke() { await pointer('pointerdown'); await pointer('pointermove', 90, 110); await act(async () => vi.advanceTimersByTime(16)); await pointer('pointerup', 110, 130); }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 16)); vi.stubGlobal('cancelAnimationFrame', window.clearTimeout);
  HTMLElement.prototype.setPointerCapture = vi.fn(); HTMLElement.prototype.releasePointerCapture = vi.fn(); HTMLElement.prototype.hasPointerCapture = () => false;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  parentDown = undefined; parentWheel = undefined;
  props = { viewport: { x: 10, y: 20, zoom: 2 }, active: true, scopeKey: 'board:one' };
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('draws real world-coordinate paths, follows pan/zoom, then fades and removes each completed mark', async () => {
  const onDrawingChange = vi.fn(); await render({ onDrawingChange }); await stroke();
  const mark = surface().querySelector('path')!;
  expect(mark.getAttribute('d')).toBe('M20 25 L40 45 L50 55'); expect(mark.getAttribute('stroke-width')).toBe('7');
  expect(onDrawingChange.mock.calls).toEqual([[true], [false]]);
  await act(async () => vi.advanceTimersByTime(2000));
  await render({ viewport: { x: -100, y: 50, zoom: 4 } });
  expect(surface().querySelector('g')?.getAttribute('transform')).toBe('translate(-100 50) scale(4)'); expect(mark.getAttribute('d')).toBe('M20 25 L40 45 L50 55');
  await act(async () => vi.advanceTimersByTime(999)); expect(mark.classList.contains('is-fading')).toBe(false);
  await act(async () => vi.advanceTimersByTime(1)); expect(mark.classList.contains('is-fading')).toBe(true);
  await act(async () => vi.advanceTimersByTime(450)); expect(surface().querySelector('path')).toBeNull();
});

it('clears all marks and timers immediately on clear, scope change and unmount', async () => {
  await render(); await stroke(); await render({ clearRevision: 1 }); expect(surface().querySelector('path')).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  await stroke(); await render({ scopeKey: 'board:two' }); expect(surface().querySelector('path')).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  await stroke(); await act(async () => root.unmount()); expect(vi.getTimerCount()).toBe(0);
  root = createRoot(host);
});

it('keeps completed ink on its original deadline while browsing and lets the content receive input', async () => {
  const down = parentDown = vi.fn(); await render(); await stroke();
  await act(async () => vi.advanceTimersByTime(2000)); await pointer('pointerdown', 75, 80);
  await render({ active: false });
  expect(surface().style.pointerEvents).toBe('none'); expect(surface().querySelector('.is-drawing')).toBeNull(); expect(surface().querySelectorAll('path')).toHaveLength(1);
  await pointer('pointerdown'); expect(down).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTime(999)); expect(surface().querySelector('path.is-fading')).toBeNull();
  await act(async () => vi.advanceTimersByTime(1)); expect(surface().querySelector('path.is-fading')).not.toBeNull();
  await render({ active: true }); expect(surface().style.pointerEvents).toBe('auto');
  await act(async () => vi.advanceTimersByTime(450)); expect(surface().querySelector('path')).toBeNull();
});

it('leaves middle/right buttons, space navigation and wheel to its parent without starting ink', async () => {
  const down = parentDown = vi.fn(), wheel = parentWheel = vi.fn();
  await render(); await pointer('pointerdown', 50, 70, { button: 1 }); await pointer('pointerdown', 50, 70, { button: 2 });
  expect(down).toHaveBeenCalledTimes(2); expect(surface().querySelector('path')).toBeNull();
  await render({ navigationActive: true }); await pointer('pointerdown'); expect(down).toHaveBeenCalledTimes(3);
  await act(async () => surface().dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: 30 })));
  expect(wheel).toHaveBeenCalledTimes(1); expect(wheel.mock.calls[0]![0].defaultPrevented).toBe(false);
  await render({ navigationActive: false }); await pointer('pointerdown'); expect(down).toHaveBeenCalledTimes(3); expect(surface().querySelector('.is-drawing')).not.toBeNull();
  await render({ active: false }); await pointer('pointerdown'); expect(down).toHaveBeenCalledTimes(4); expect(surface().querySelector('path')).toBeNull();
});

it('cancels only the unfinished mark on Escape, blur, pointer cancellation and navigation switch', async () => {
  const onDrawingChange = vi.fn(), exit = vi.fn(); await render({ onDrawingChange }); const dispose = registerEscapeLayer(host, exit, 10);
  await stroke(); await pointer('pointerdown', 70, 80);
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(surface().querySelector('.is-drawing')).toBeNull(); expect(surface().querySelectorAll('path')).toHaveLength(1); expect(exit).not.toHaveBeenCalled();
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))); expect(exit).toHaveBeenCalledTimes(1);
  for (const end of ['blur', 'pointercancel', 'lostpointercapture', 'navigation'] as const) {
    await pointer('pointerdown');
    if (end === 'blur') await act(async () => window.dispatchEvent(new Event('blur')));
    else if (end === 'pointercancel' || end === 'lostpointercapture') await pointer(end);
    else await render({ navigationActive: true });
    expect(surface().querySelector('.is-drawing')).toBeNull(); expect(onDrawingChange.mock.lastCall).toEqual([false]);
  }
  dispose();
});

it('keeps separate completed strokes on independent fade schedules and ignores stray pointer ids', async () => {
  await render(); await pointer('pointerdown'); await pointer('pointerup', 90, 100, { pointerId: 2 }); expect(surface().querySelector('.is-drawing')).not.toBeNull();
  await pointer('pointercancel'); await stroke(); await act(async () => vi.advanceTimersByTime(1000)); await stroke();
  await act(async () => vi.advanceTimersByTime(2000)); expect(surface().querySelectorAll('path.is-fading')).toHaveLength(1); expect(surface().querySelectorAll('path')).toHaveLength(2);
  await act(async () => vi.advanceTimersByTime(450)); expect(surface().querySelectorAll('path')).toHaveLength(1);
  await act(async () => vi.advanceTimersByTime(1000)); expect(surface().querySelectorAll('path')).toHaveLength(0);
});
