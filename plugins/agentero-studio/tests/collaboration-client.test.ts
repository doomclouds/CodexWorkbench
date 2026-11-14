// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_STYLE, LOCAL_ACTOR, type Board, type Presence, type StudioClient } from '../src/contracts/studio';
import { createCollaboration } from '../src/app/shared/useCollaboration';
import { encodeGestureFrame, NativeGestureReceiver, type NativeGesture } from '../src/app/shared/useNativeGestureSync';
import { fitFollowViewport } from '../src/app/shared/useViewportFollow';
import { ParticipantActivity } from '../src/app/shared/presence-members';

const board = (revision: number): Board => ({ artifact: { id: 'fixture', type: 'whiteboard', title: '协作测试', revision, createdAt: '', updatedAt: '', pinned: false }, elements: [{ id: 'one', type: 'shape', version: revision + 1, x: revision * 10, y: 0, w: 100, h: 80 }], style: DEFAULT_STYLE });
const tick = async () => { for (let i = 0; i < 64; i++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let closes: (() => void)[] = [];
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); });
afterEach(() => { closes.forEach(close => close()); closes = []; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function fixture(read: (input: string | URL, init?: RequestInit) => Promise<Response>, polling = false) {
  const streams: any[] = [];
  vi.stubGlobal('EventSource', class { onmessage: ((event: { data: string }) => void) | null = null; onerror: (() => void) | null = null; close = vi.fn(); addEventListener() {} constructor(public url: string) { streams.push(this); } });
  let current: Board | null = null;
  const onPresence = vi.fn(), onEvent = vi.fn(), onError = vi.fn(), onFeedback = vi.fn(), onClock = vi.fn();
  const client: StudioClient = { embedded: polling, baseUrl: 'http://studio.test', token: 'fixture', request: read, call: vi.fn().mockRejectedValue(new Error('use abortable reads')) };
  const controller = createCollaboration({ client, polling, artifactId: 'fixture', peerId: 'page', getDocument: () => current, onDocument: next => { current = next as Board; }, onFeedback, onPresence, onEvent, onError, onClock, onStatus: vi.fn() });
  closes.push(controller.close);
  const emit = async (message: object) => { streams.at(-1).onmessage({ data: JSON.stringify({ artifactId: 'fixture', ...message }) }); await tick(); };
  return { controller, streams, emit, onPresence, onEvent, onError, onFeedback, onClock, get: () => current };
}
function reply(next: Board) { return Response.json({ ok: true, data: next }); }
function reads(next: () => Board) { return vi.fn(async (input: string | URL, init?: RequestInit) => new URL(String(input)).pathname === '/api/tools/artifact_read' ? reply(next()) : new URL(String(input)).pathname === '/api/tools/artifact_feedback' ? Response.json({ ok: true, data: { feedback: [] } }) : Response.json({ peers: [], timer: null, cursor: 'epoch:1', accepted: true, serverTime: Date.now() })); }
const ready = (cursor = 'epoch:1') => ({ type: 'ready', cursor, reset: true, events: [], peers: [], timer: null, serverTime: Date.now(), actor: LOCAL_ACTOR });

describe('collaboration client transport', () => {
  it('retains a board invalidation arriving during a slow snapshot and consumes subsequent after-units without another full pull', async () => {
    const slow = deferred<Response>(), request = reads(() => board(2));
    request.mockImplementationOnce(() => slow.promise);
    const view = fixture(request);
    await view.emit(ready());
    await view.emit({ type: 'change', cursor: 'epoch:2', revision: 3, artifact: board(3).artifact, units: [{ id: 'one', after: board(3).elements[0] }] });
    slow.resolve(reply(board(2))); await tick();
    expect(view.get()?.artifact.revision).toBe(3); expect(view.get()?.elements[0]?.x).toBe(30);
    expect(request.mock.calls.filter(([input]) => new URL(String(input)).pathname === '/api/tools/artifact_read')).toHaveLength(1);
  });

  it('coalesces in-flight presence and rejects an older POST snapshot after a newer streamed peer state', async () => {
    const request = reads(() => board(1)), waiting = deferred<Response>(); let presencePosts = 0;
    const original = request.getMockImplementation()!;
    request.mockImplementation((input, init) => new URL(String(input)).pathname === '/api/presence' && init?.method === 'POST' && ++presencePosts === 1 ? waiting.promise : original(input, init));
    const view = fixture(request); await view.emit(ready());
    view.controller.presence({ cursor: { x: 1, y: 2 } }); await tick();
    view.controller.presence({ cursor: { x: 2, y: 3 } }); view.controller.presence({ cursor: { x: 9, y: 10 } });
    const remote = { peerId: 'other', actor: { ...LOCAL_ACTOR, id: 'other' }, updatedAt: '', cursor: { x: 40, y: 50 } };
    await view.emit({ type: 'presence', cursor: 'epoch:4', peers: [remote], timer: null });
    waiting.resolve(Response.json({ peers: [], timer: null, cursor: 'epoch:2', accepted: true })); await tick(); await vi.advanceTimersByTimeAsync(33);
    expect(view.onPresence.mock.calls.at(-1)?.[0]).toEqual([remote]);
    const sent = request.mock.calls.filter(([input, init]) => new URL(String(input)).pathname === '/api/presence' && init?.method === 'POST').map(([, init]) => JSON.parse(String(init?.body)));
    expect(sent).toHaveLength(2); expect(sent[1].cursor).toMatchObject({ x: 9, y: 10 }); expect(sent[1].peerSeq).toBeGreaterThan(sent[0].peerSeq);
  });

  it('handles access loss immediately while a snapshot is pending and ignores that snapshot afterward', async () => {
    const pending = deferred<Response>(), request = reads(() => board(1)); request.mockImplementationOnce(() => pending.promise);
    const view = fixture(request); await view.emit(ready());
    await view.emit({ type: 'access-revoked', reason: 'removed', cursor: 'epoch:2' });
    expect(view.onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'access-revoked', reason: 'removed' }));
    expect(view.streams[0].close).toHaveBeenCalled(); pending.resolve(reply(board(1))); await tick();
    expect(view.get()).toBeNull();
  });

  it('does not rewind streamed peers or clock samples when an earlier reset finishes its slow snapshot', async () => {
    const slow = deferred<Response>(), request = reads(() => board(1)); request.mockImplementationOnce(() => slow.promise);
    const view = fixture(request); await view.emit(ready());
    const peer = { peerId: 'latest', actor: LOCAL_ACTOR, updatedAt: '' };
    await view.emit({ type: 'presence', cursor: 'epoch:5', peers: [peer], timer: null, serverTime: Date.now() + 2500 });
    slow.resolve(reply(board(1))); await tick();
    expect(view.onPresence.mock.calls.at(-1)?.[0]).toEqual([peer]); expect(view.onClock.mock.calls.at(-1)?.[0]).toBe(2500);
  });

  it('invalidates an in-flight feedback read after a local mutation instead of publishing its older list', async () => {
    const slow = deferred<Response>(), request = reads(() => board(1));
    const original = request.getMockImplementation()!; let feedbackReads = 0;
    request.mockImplementation((input, init) => new URL(String(input)).pathname === '/api/tools/artifact_feedback' ? ++feedbackReads === 1 ? slow.promise : Promise.resolve(Response.json({ ok: true, data: { feedback: [{ id: 'latest' }] } })) : original(input, init));
    const view = fixture(request); await view.emit(ready());
    view.controller.feedbackChanged(); void view.controller.refreshFeedback();
    slow.resolve(Response.json({ ok: true, data: { feedback: [{ id: 'old' }] } })); await tick();
    expect(view.onFeedback.mock.calls.map(([items]) => items.map((item: { id: string }) => item.id))).toEqual([['latest']]);
  });

  it('delivers room messages independently and never turns an upload preview into a full-board read', async () => {
    const request = reads(() => board(1)), view = fixture(request), listener = vi.fn(); view.controller.room.subscribe('upload', listener);
    await view.emit(ready());
    const message = { peerId: 'other', actor: LOCAL_ACTOR, seq: 2, topic: 'upload', data: { id: 'upload', seq: 1, phase: 'start' }, createdAt: '' };
    await view.emit({ type: 'room', cursor: 'epoch:2', events: [message] }); await view.emit({ type: 'room', cursor: 'epoch:2', events: [message] });
    expect(listener).toHaveBeenCalledTimes(1); expect(request.mock.calls.filter(([input]) => new URL(String(input)).pathname === '/api/tools/artifact_read')).toHaveLength(1);
  });

  it('uses bounded long polling and continues from the reset barrier after taking the snapshot', async () => {
    const request = reads(() => board(1)); let polls = 0;
    const original = request.getMockImplementation()!;
    request.mockImplementation((input, init) => {
      if (new URL(String(input)).pathname !== '/api/sync') return original(input, init);
      if (++polls === 1) return Promise.resolve(Response.json(ready()));
      return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    });
    const view = fixture(request, true); await tick(); await vi.advanceTimersByTimeAsync(10); await tick();
    expect(view.get()?.artifact.revision).toBe(1); expect(view.streams).toHaveLength(0);
    const calls = request.mock.calls.filter(([input]) => new URL(String(input)).pathname === '/api/sync');
    expect(calls).toHaveLength(2); expect(new URL(String(calls[1]![0])).searchParams.get('after')).toBe('epoch:1'); expect(new URL(String(calls[1]![0])).searchParams.get('wait')).toBe('20000');
    view.controller.close(); expect(calls[1]![1]?.signal?.aborted).toBe(true);
  });
});

it('assembles out-of-order gesture parts, ignores stale frames, clears cancellation, and retires landed previews', () => {
  let now = 100, seq = 0; const receiver = new NativeGestureReceiver(() => now);
  const gesture: NativeGesture = { id: 'gesture', kind: 'ink', elements: [{ ...board(1).elements[0]!, type: 'stroke', points: Array.from({ length: 900 }, (_, index) => index) }] };
  const parts = encodeGestureFrame(gesture, 1, () => ++seq);
  const message = (data: any) => ({ peerId: 'other', actor: LOCAL_ACTOR, seq: ++seq, topic: 'gesture', data, createdAt: '' });
  for (const part of [...parts].reverse()) receiver.receive(message(part));
  expect(receiver.read(board(0))[0]?.elements[0]?.points).toHaveLength(900);
  const incomplete = encodeGestureFrame({ ...gesture, elements: gesture.elements.map(element => ({ ...element, x: 100 })) }, 2, () => ++seq);
  receiver.receive(message(incomplete[0]));
  expect(receiver.read(board(0))[0]?.elements[0]?.x).toBe(10); // Missing parts keep the last complete frame.
  receiver.receive(message({ id: 'gesture', seq: ++seq, phase: 'end', kind: 'ink', frame: 3, cancelled: true })); expect(receiver.read(board(0))).toEqual([]);
  const moving: NativeGesture = { id: 'move', kind: 'move', elements: board(2).elements };
  for (const part of encodeGestureFrame(moving, 2, () => ++seq)) receiver.receive(message(part));
  receiver.receive(message({ id: 'move', seq: ++seq, phase: 'end', kind: 'move', frame: 2, storedIds: ['one'] }));
  expect(receiver.read(board(0))).toHaveLength(1); expect(receiver.read(board(2))).toEqual([]);
  for (const part of encodeGestureFrame({ ...moving, id: 'expiry' }, 3, () => ++seq)) receiver.receive(message(part)); now += 3001; expect(receiver.read(board(0))).toEqual([]);
});

it('lets a later failure cancel an ended gesture and prevents old parts from resurrecting it', () => {
  let seq = 0; const receiver = new NativeGestureReceiver(() => 100);
  const gesture: NativeGesture = { id: 'failed', kind: 'move', elements: board(2).elements };
  const message = (data: any) => ({ peerId: 'other', actor: LOCAL_ACTOR, seq: ++seq, topic: 'gesture', data, createdAt: '' });
  const parts = encodeGestureFrame(gesture, 1, () => ++seq); parts.forEach(part => receiver.receive(message(part)));
  receiver.receive(message({ id: 'failed', kind: 'move', seq: ++seq, phase: 'end', frame: 1 })); expect(receiver.read(board(0))).toHaveLength(1);
  receiver.receive(message({ id: 'failed', kind: 'move', seq: ++seq, phase: 'end', cancelled: true, frame: 2 }));
  parts.forEach(part => receiver.receive(message(part))); expect(receiver.read(board(0))).toEqual([]);
});

it('fits a followed world area to a different viewport and keeps heartbeat-only updates inactive', () => {
  expect(fitFollowViewport({ x: -100, y: -50, zoom: 2 }, { w: 800, h: 400 }, { w: 400, h: 400 })).toEqual({ x: -50, y: 75, zoom: 1 });
  const tracker = new ParticipantActivity(), peer: Presence = { peerId: 'p', actor: { ...LOCAL_ACTOR, id: 'other' }, cursor: { x: 1, y: 2 }, updatedAt: new Date(1000).toISOString() };
  const first = tracker.read([peer], 'self', 2000)[0]!;
  const heartbeat = tracker.read([{ ...peer, peerSeq: 100, updatedAt: new Date(6000).toISOString() }], 'self', 6000)[0]!;
  expect(heartbeat.activeAt).toBe(first.activeAt);
});
