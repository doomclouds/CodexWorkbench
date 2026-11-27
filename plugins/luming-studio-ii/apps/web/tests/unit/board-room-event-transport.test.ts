import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { subscribeGuestRoomEvents, subscribeRoomEvents } from '../../src/platform/browser/index.js';

const sources: FakeEventSource[] = [];

class FakeEventSource extends EventTarget {
  readonly url: string;
  closed = 0;

  constructor(url: string) {
    super();
    this.url = url;
    sources.push(this);
  }

  close() {
    this.closed += 1;
  }
}

beforeEach(() => {
  sources.length = 0;
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function newestSource() {
  const source = sources.at(-1);
  if (!source) {
    throw new Error('Expected the EventSource adapter to open a stream.');
  }

  return source;
}

test('uses the same origin, encodes board and view IDs, and marks only guest subscriptions', () => {
  const callbacks = { onEvent: vi.fn(), onDisconnect: vi.fn() };
  const owner = new AbortController();
  const guest = new AbortController();
  subscribeRoomEvents('board&alternate', 'view+test', callbacks, owner.signal);
  const ownerUrl = new URL(newestSource().url);
  expect(ownerUrl.origin).toBe(window.location.origin);
  expect(ownerUrl.pathname).toBe('/studio-room-events');
  expect([...ownerUrl.searchParams.entries()]).toEqual([
    ['boardId', 'board&alternate'],
    ['viewId', 'view+test'],
  ]);

  subscribeGuestRoomEvents('board&alternate', 'view+test', callbacks, guest.signal);
  const guestUrl = new URL(newestSource().url);
  expect(guestUrl.origin).toBe(window.location.origin);
  expect(guestUrl.searchParams.get('guest')).toBe('1');
  expect(guestUrl.searchParams.get('boardId')).toBe('board&alternate');
  expect(guestUrl.hash).toBe('');

  owner.abort();
  guest.abort();
  expect(sources.map(({ closed }) => closed)).toEqual([1, 1]);
});

test('closes on error and reports a single disconnect for the injected reconnect policy', () => {
  const onEvent = vi.fn<(text: string) => void>();
  const onDisconnect = vi.fn<() => void>();
  const controller = new AbortController();
  subscribeRoomEvents('board', 'view', { onEvent, onDisconnect }, controller.signal);
  const source = newestSource();
  source.dispatchEvent(new MessageEvent('message', { data: 'snapshot' }));
  expect(onEvent).toHaveBeenCalledExactlyOnceWith('snapshot');

  source.dispatchEvent(new Event('error'));
  source.dispatchEvent(new Event('error'));
  source.dispatchEvent(new MessageEvent('message', { data: 'late' }));
  controller.abort();
  expect(source.closed).toBe(1);
  expect(onDisconnect).toHaveBeenCalledOnce();
  expect(onEvent).toHaveBeenCalledOnce();
});

test('honors abort without treating an intentional unmount as a disconnect', () => {
  const callbacks = { onEvent: vi.fn(), onDisconnect: vi.fn() };
  const controller = new AbortController();
  subscribeRoomEvents('board', 'view', callbacks, controller.signal);
  const source = newestSource();
  controller.abort();
  source.dispatchEvent(new Event('error'));
  source.dispatchEvent(new MessageEvent('message', { data: 'late' }));
  subscribeRoomEvents('board', 'unused', callbacks, controller.signal);

  expect(sources).toHaveLength(1);
  expect(source.closed).toBe(1);
  expect(callbacks.onDisconnect).not.toHaveBeenCalled();
  expect(callbacks.onEvent).not.toHaveBeenCalled();
});
