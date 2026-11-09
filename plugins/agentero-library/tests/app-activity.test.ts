import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRefreshQueue, intersectionActivity, mergeHostPatch, observeAppActivity, readSettingsStatus, startSequentialPoll } from '../src/app/activity';
import { previewSettings, previewStatus } from '../src/app/preview';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

describe('host context deduplication', () => {
  it('keeps the same state identity for duplicate themes without dropping repeated route revisions', () => {
    const original = { theme: 'dark', connected: true, routeRevision: 1, view: 'reading' };
    expect(mergeHostPatch(original, { theme: 'dark' })).toBe(original);
    expect(mergeHostPatch(original, {})).toBe(original);
    expect(mergeHostPatch(original, { routeRevision: 2, view: 'reading' })).toEqual({ ...original, routeRevision: 2 });
    expect(mergeHostPatch(original, { theme: 'light' })).not.toBe(original);
  });
});

describe('foreground resource activation', () => {
  it('preserves the Window receiver for the default browser animation-frame APIs', () => {
    const target = {} as HTMLElement; const document = new EventTarget() as EventTarget & { visibilityState: string }; document.visibilityState = 'visible';
    let callback!: IntersectionObserverCallback; let instance!: IntersectionObserver; let frame!: FrameRequestCallback;
    const cancelled: number[] = [];
    const browser = {
      requestAnimationFrame(this: unknown, next: FrameRequestCallback) { if (this !== browser) throw new TypeError('Illegal invocation'); frame = next; return 7; },
      cancelAnimationFrame(this: unknown, id: number) { if (this !== browser) throw new TypeError('Illegal invocation'); cancelled.push(id); },
    };
    class Observer implements IntersectionObserver {
      root = null; rootMargin = '0px'; scrollMargin = '0px'; thresholds = [0, .001, .01];
      constructor(next: IntersectionObserverCallback) { callback = next; instance = this; }
      observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
    }
    vi.stubGlobal('window', browser); vi.stubGlobal('document', document); vi.stubGlobal('IntersectionObserver', Observer);
    // Expose the unbound globals too: the previous method-reference defaults
    // fail this test with the same receiver error as a real browser.
    vi.stubGlobal('requestAnimationFrame', browser.requestAnimationFrame); vi.stubGlobal('cancelAnimationFrame', browser.cancelAnimationFrame);
    const changed = vi.fn(); const stop = observeAppActivity(target, changed);
    const rect = { x: 0, y: 0, width: 100, height: 100, top: 0, left: 0, bottom: 100, right: 100, toJSON: () => ({}) };
    const show = () => callback([{ target, isIntersecting: true, intersectionRatio: 1, boundingClientRect: rect, intersectionRect: rect, rootBounds: rect, time: 0 }], instance);
    expect(() => show()).not.toThrow(); frame(0); expect(changed).toHaveBeenCalledWith(true);
    show(); document.visibilityState = 'hidden'; expect(() => document.dispatchEvent(new Event('visibilitychange'))).not.toThrow();
    expect(cancelled).toEqual([7]); expect(changed.mock.calls.at(-1)).toEqual([false]); stop();
  });
  it('uses hysteresis instead of toggling on small resize/intersection fluctuations', () => {
    expect(intersectionActivity(false, true, .005)).toBe(false);
    expect(intersectionActivity(false, true, .02)).toBe(true);
    expect(intersectionActivity(true, true, .005)).toBe(true);
    expect(intersectionActivity(true, true, .0005)).toBe(false);
    expect(intersectionActivity(true, false, 1)).toBe(false);
  });
  it('coalesces repeated observer events and pauses until a fresh foreground intersection', () => {
    const target = {} as HTMLElement; const document = new EventTarget() as EventTarget & { visibilityState: string }; document.visibilityState = 'visible';
    let observerCallback!: IntersectionObserverCallback; let frameCallback: FrameRequestCallback | null = null;
    const observer = { root: null, rootMargin: '0px', scrollMargin: '0px', thresholds: [0, .001, .01], takeRecords: () => [], observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    const changed = vi.fn(); const requestFrame = vi.fn((callback: FrameRequestCallback) => { frameCallback = callback; return 1; }); const cancelFrame = vi.fn();
    const stop = observeAppActivity(target, changed, { document: document as Document, createObserver: callback => { observerCallback = callback; return observer; }, requestFrame, cancelFrame });
    const rect = { x: 0, y: 0, width: 100, height: 100, top: 0, left: 0, bottom: 100, right: 100, toJSON: () => ({}) };
    const intersect = (ratio: number) => observerCallback([{ target, isIntersecting: ratio > 0, intersectionRatio: ratio, boundingClientRect: rect, intersectionRect: rect, rootBounds: rect, time: 0 }], observer);
    const frame = () => { const callback = frameCallback!; frameCallback = null; callback(0); };
    for (let index = 0; index < 50; index++) intersect(1);
    expect(requestFrame).toHaveBeenCalledTimes(1); frame(); expect(changed.mock.calls).toEqual([[true]]);
    for (let index = 0; index < 50; index++) intersect(.006);
    frame(); expect(changed).toHaveBeenCalledTimes(1);
    document.visibilityState = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); expect(changed.mock.calls.at(-1)).toEqual([false]);
    document.visibilityState = 'visible'; document.dispatchEvent(new Event('visibilitychange')); expect(changed).toHaveBeenCalledTimes(2); expect(observer.unobserve).toHaveBeenCalledWith(target);
    document.dispatchEvent(new Event('visibilitychange')); expect(observer.unobserve).toHaveBeenCalledTimes(1);
    intersect(1); frame(); expect(changed.mock.calls.at(-1)).toEqual([true]);
    intersect(0); expect(changed.mock.calls.at(-1)).toEqual([false]);
    intersect(1); stop(); expect(observer.disconnect).toHaveBeenCalledOnce(); expect(cancelFrame).toHaveBeenCalledWith(1);
  });
});

describe('single-flight App settings refresh', () => {
  it('reads only settings on unchanged polls and refreshes status on changes or an explicit request', async () => {
    let settings = { ...previewSettings }; const readSettings = vi.fn(async () => ({ ...settings })); const readStatus = vi.fn(async () => previewStatus);
    const first = await readSettingsStatus(null, false, readSettings, readStatus, () => true); expect(readStatus).toHaveBeenCalledOnce();
    const same = await readSettingsStatus(first, false, readSettings, readStatus, () => true); expect(readSettings).toHaveBeenCalledTimes(2); expect(readStatus).toHaveBeenCalledOnce(); expect(same?.status).toBe(first?.status); expect(same?.changed).toBe(false);
    settings = { ...settings, allowAgentPdfText: !settings.allowAgentPdfText };
    const changed = await readSettingsStatus(same, false, readSettings, readStatus, () => true); expect(changed?.changed).toBe(true); expect(readStatus).toHaveBeenCalledTimes(2);
    await readSettingsStatus(changed, true, readSettings, readStatus, () => true); expect(readStatus).toHaveBeenCalledTimes(3);
  });
  it('discards an invalidated read before calling status or publishing a stale result', async () => {
    const readStatus = vi.fn(async () => previewStatus);
    expect(await readSettingsStatus(null, false, async () => previewSettings, readStatus, () => false)).toBeNull(); expect(readStatus).not.toHaveBeenCalled();
    let current = true;
    expect(await readSettingsStatus(null, false, async () => previewSettings, async () => { current = false; return previewStatus; }, () => current)).toBeNull();
  });
  it('joins automatic polls and merges deliberate refreshes into one follow-up', async () => {
    const wait = deferred(); let active = 0; let maximum = 0;
    const requests: { explicit: boolean; forceStatus: boolean }[] = [];
    const queue = createRefreshQueue(async request => { active++; maximum = Math.max(maximum, active); requests.push(request); if (requests.length === 1) await wait.promise; active--; });
    const first = queue.request({ explicit: false, forceStatus: false }); await Promise.resolve();
    expect(queue.request({ explicit: false, forceStatus: false })).toBe(first);
    queue.request({ explicit: false, forceStatus: true }); queue.request({ explicit: true, forceStatus: false });
    expect(requests).toHaveLength(1); wait.resolve(); await first;
    expect(requests).toEqual([{ explicit: false, forceStatus: false }, { explicit: true, forceStatus: true }]); expect(maximum).toBe(1);
  });
  it('drops queued work when the App is disposed without interrupting the current read', async () => {
    const wait = deferred(); const run = vi.fn(() => wait.promise); const queue = createRefreshQueue(run);
    const current = queue.request({ explicit: false, forceStatus: false }); await Promise.resolve(); queue.request({ explicit: true, forceStatus: true }); queue.clearPending(); wait.resolve(); await current;
    expect(run).toHaveBeenCalledOnce();
  });
});

describe('sequential note inspection', () => {
  it('does not overlap a slow read or repeated focus requests and schedules from completion', async () => {
    vi.useFakeTimers(); const wait = deferred(); const read = vi.fn(() => wait.promise); const poll = startSequentialPoll(read, 4000);
    await vi.advanceTimersByTimeAsync(4000); expect(read).toHaveBeenCalledOnce();
    const focused = poll.trigger(); expect(poll.trigger()).toBe(focused); await vi.advanceTimersByTimeAsync(12000); expect(read).toHaveBeenCalledOnce();
    wait.resolve(); await focused; await vi.advanceTimersByTimeAsync(3999); expect(read).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1); expect(read).toHaveBeenCalledTimes(2); poll.stop();
  });
  it('does not schedule another inspection after a hidden/unmounted view stops', async () => {
    vi.useFakeTimers(); const wait = deferred(); const read = vi.fn(() => wait.promise); const poll = startSequentialPoll(read, 4000);
    const current = poll.trigger(); await Promise.resolve(); poll.stop(); wait.resolve(); await current; await vi.advanceTimersByTimeAsync(20000); await poll.trigger(); expect(read).toHaveBeenCalledOnce();
  });
});
