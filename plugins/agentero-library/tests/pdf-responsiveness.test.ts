import { afterEach, expect, test, vi } from 'vitest';
import { abortable, canvasBudget, MAX_CANVAS_PIXELS, releasePageResources, RenderScheduler, timeBudget, yieldToHost } from '../src/app/pdf/scheduling';
import { imageBudgetFailure, launchPdfWorker } from '../src/app/pdf/worker-controller';
import { MAX_MOUNTED_PAGES, pageAtOffset, pageSlots, pageWindow } from '../src/app/pdf/virtualization';

afterEach(() => vi.useRealTimers());
class TestWorker extends EventTarget { terminated = 0; terminate() { this.terminated++; } ready() { this.dispatchEvent(new MessageEvent('message', { data: { sourceName: 'worker', action: 'ready' } })); } }
function workerHarness() {
  const worker = new TestWorker(); const revoked: string[] = []; let made = 0;
  return { worker, revoked, options: { createWorker: () => { made++; return worker; }, createUrl: () => 'blob:synthetic-worker', revokeUrl: (url: string) => revoked.push(url) }, count: () => made };
}

test('a real-worker handshake owns one worker and releases its URL exactly once', async () => {
  const harness = workerHarness(); const ready = launchPdfWorker('export {}', harness.options); harness.worker.ready();
  const owned = await ready; expect(harness.count()).toBe(1); expect(harness.worker.terminated).toBe(0);
  owned.dispose(); owned.dispose(); expect(harness.worker.terminated).toBe(1); expect(harness.revoked).toEqual(['blob:synthetic-worker']);
});
test('a CSP-rejected worker fails instead of falling back and releases its URL', async () => {
  const harness = workerHarness();
  await expect(launchPdfWorker('export {}', { ...harness.options, createWorker: () => { throw new DOMException('blocked', 'SecurityError'); } })).rejects.toMatchObject({ code: 'PDF_WORKER_UNAVAILABLE' });
  expect(harness.revoked).toEqual(['blob:synthetic-worker']);
});
test('worker startup timeout and abort release resources', async () => {
  vi.useFakeTimers(); const timeout = workerHarness(); const pending = launchPdfWorker('', { ...timeout.options, timeoutMs: 100 });
  const rejected = expect(pending).rejects.toMatchObject({ code: 'PDF_WORKER_UNAVAILABLE' }); await vi.advanceTimersByTimeAsync(101); await rejected;
  expect(timeout.worker.terminated).toBe(1); expect(timeout.revoked).toHaveLength(1);
  const stopped = workerHarness(); const controller = new AbortController(); const starting = launchPdfWorker('', { ...stopped.options, signal: controller.signal });
  controller.abort(); await expect(starting).rejects.toMatchObject({ name: 'AbortError' }); expect(stopped.worker.terminated).toBe(1); expect(stopped.revoked).toHaveLength(1);
});
test('a worker error after readiness notifies its document and releases the worker', async () => {
  const harness = workerHarness(); const failure = vi.fn(); const starting = launchPdfWorker('', { ...harness.options, onFailure: failure }); harness.worker.ready();
  await starting; harness.worker.dispatchEvent(new Event('error', { cancelable: true }));
  expect(failure).toHaveBeenCalledTimes(1); expect(harness.worker.terminated).toBe(1); expect(harness.revoked).toHaveLength(1);
});
const imageLimitPacket = { sourceName: 'd0_worker', targetName: 'd0', stream: 5, streamId: 1, reason: { name: 'UnknownErrorException', message: 'Image exceeded maximum allowed size and was removed.' } };
test('the pinned SDK image-budget stream error is surfaced and disposes its worker once', async () => {
  const harness = workerHarness(); const failure = vi.fn(); const starting = launchPdfWorker('', { ...harness.options, pdfjsVersion: '6.5.438', onFailure: failure }); harness.worker.ready();
  await starting; harness.worker.dispatchEvent(new MessageEvent('message', { data: imageLimitPacket }));
  expect(failure).toHaveBeenCalledOnce(); expect(failure.mock.calls[0][0]).toMatchObject({ code: 'PDF_RESOURCE_LIMIT' }); expect(failure.mock.calls[0][0].message).not.toContain('启动');
  expect(harness.worker.terminated).toBe(1); expect(harness.revoked).toHaveLength(1);
  harness.worker.dispatchEvent(new MessageEvent('message', { data: imageLimitPacket })); expect(failure).toHaveBeenCalledOnce();
});
test('the compatibility guard does not treat cancellation, unrelated failures or another SDK as image limits', () => {
  expect(imageBudgetFailure(imageLimitPacket, '6.5.438')?.code).toBe('PDF_RESOURCE_LIMIT');
  expect(imageBudgetFailure(imageLimitPacket, '6.5.439')).toBeNull();
  expect(imageBudgetFailure({ ...imageLimitPacket, stream: 1 }, '6.5.438')).toBeNull();
  expect(imageBudgetFailure({ ...imageLimitPacket, reason: { name: 'AbortException', message: imageLimitPacket.reason.message } }, '6.5.438')).toBeNull();
  expect(imageBudgetFailure({ ...imageLimitPacket, reason: { name: 'UnknownErrorException', message: 'Unrelated decoder error' } }, '6.5.438')).toBeNull();
  expect(imageBudgetFailure({ ...imageLimitPacket, targetName: 'another-document' }, '6.5.438')).toBeNull();
});
test('an image-budget failure cancels unresponsive page RPCs and leaves slots for another document', async () => {
  const harness = workerHarness(); const controller = new AbortController(); const scheduler = new RenderScheduler(2);
  const starting = launchPdfWorker('', { ...harness.options, pdfjsVersion: '6.5.438', onFailure: () => controller.abort() }); harness.worker.ready(); await starting;
  const first = scheduler.run(() => abortable(new Promise<never>(() => {}), controller.signal), controller.signal);
  const second = scheduler.run(() => abortable(new Promise<never>(() => {}), controller.signal), controller.signal);
  await Promise.resolve(); expect(scheduler.running).toBe(2);
  harness.worker.dispatchEvent(new MessageEvent('message', { data: imageLimitPacket })); await Promise.allSettled([first, second]);
  await expect(scheduler.run(async () => 'next document rendered', new AbortController().signal)).resolves.toBe('next document rendered');
  await Promise.resolve(); expect(scheduler.running).toBe(0); expect(harness.worker.terminated).toBe(1);
});
test('canvas allocation is bounded at high DPI, zoom and extreme page dimensions', () => {
  for (const [width, height, ratio] of [[1836, 2376, 2], [9000, 12000, 3], [120000, 300, 2]]) {
    const budget = canvasBudget(width, height, ratio); expect(budget.width * budget.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS); expect(budget.width).toBeLessThanOrEqual(16384); expect(budget.height).toBeLessThanOrEqual(16384);
  }
});
test('renderer concurrency stays at two and a cancelled queued task never starts', async () => {
  const scheduler = new RenderScheduler(2); let running = 0; let peak = 0; const releases: (() => void)[] = [];
  const task = () => new Promise<void>(resolve => { running++; peak = Math.max(peak, running); releases.push(() => { running--; resolve(); }); });
  const first = scheduler.run(task, new AbortController().signal); const second = scheduler.run(task, new AbortController().signal);
  const cancelled = new AbortController(); const never = vi.fn(async () => {}); const queued = scheduler.run(never, cancelled.signal);
  cancelled.abort(); await expect(queued).rejects.toMatchObject({ name: 'AbortError' }); await Promise.resolve();
  expect(peak).toBe(2); expect(scheduler.running).toBe(2); expect(scheduler.pending).toBe(0); expect(never).not.toHaveBeenCalled();
  releases.forEach(release => release()); await Promise.all([first, second]);
});
test('a synchronous task failure releases its slot for the next document', async () => {
  const scheduler = new RenderScheduler(1); const failure = scheduler.run(() => { throw new Error('render failed'); }, new AbortController().signal);
  const next = scheduler.run(async () => 'next document painted', new AbortController().signal);
  await expect(failure).rejects.toThrow('render failed'); await expect(next).resolves.toBe('next document painted');
});
test('terminated-worker RPCs cannot hold either render slot after cancellation', async () => {
  const scheduler = new RenderScheduler(2); const a = new AbortController(); const b = new AbortController();
  const unresponsiveWorker = () => new Promise<never>(() => {});
  const first = scheduler.run(() => abortable(unresponsiveWorker(), a.signal), a.signal);
  const second = scheduler.run(() => abortable(unresponsiveWorker(), b.signal), b.signal);
  await Promise.resolve(); expect(scheduler.running).toBe(2); a.abort(); b.abort();
  await Promise.allSettled([first, second]);
  const next = scheduler.run(async () => 'new document', new AbortController().signal);
  await expect(next).resolves.toBe('new document'); await Promise.resolve(); expect(scheduler.running).toBe(0);
});
test('cancelled page cleanup clears bitmap, text layer and PDF resources', async () => {
  const controller = new AbortController(); const canvas = { width: 3000, height: 2500 }; const text = { replaceChildren: vi.fn() }; const page = { cleanup: vi.fn(() => true) };
  const task = abortable(new Promise<never>(() => {}), controller.signal).catch(() => {}).finally(() => releasePageResources(canvas, text, page));
  controller.abort(); await task; expect(canvas).toEqual({ width: 0, height: 0 }); expect(text.replaceChildren).toHaveBeenCalledOnce(); expect(page.cleanup).toHaveBeenCalledOnce();
});
test('a 400-page document mounts a bounded window and resolves page offsets by binary lookup', () => {
  const slots = pageSlots(400, new Map([[8, { width: 792, height: 612 }]]), { width: 612, height: 792 }, 0, 1, 800, 226);
  for (let page = 0; page < slots.length; page++) { const window = pageWindow(slots, slots[page].top, 1600); expect(window.end - window.start + 1).toBeLessThanOrEqual(MAX_MOUNTED_PAGES); expect(window.start).toBeLessThanOrEqual(page); expect(window.end).toBeGreaterThanOrEqual(page); }
  expect(pageAtOffset(slots, slots[7].top + 20)).toBe(7); expect(pageAtOffset(slots, slots[399].top + 20)).toBe(399);
});
test('cooperative work yields to timers and cancellation rather than only chaining microtasks', async () => {
  const controller = new AbortController(); let heartbeat = false; setTimeout(() => { heartbeat = true; }, 0);
  const checkpoint = timeBudget(controller.signal, 0); await checkpoint(); expect(heartbeat).toBe(true);
  controller.abort(); await expect(yieldToHost(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
});
