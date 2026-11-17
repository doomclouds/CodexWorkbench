// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_STYLE, LOCAL_ACTOR, type Board, type Presence, type StudioClient, type StudioEvent } from '../src/contracts/studio';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StudioService } from '../src/core/service';
import { createCollaboration } from '../src/app/shared/useCollaboration';
import { encodeGestureFrame, NativeGestureReceiver, type NativeGesture } from '../src/app/shared/useNativeGestureSync';
import { fitFollowViewport } from '../src/app/shared/useViewportFollow';
import { ParticipantActivity } from '../src/app/shared/presence-members';
import { applyWhiteboardRemoteEvent } from '../src/app/products/whiteboard';

const board = (revision: number): Board => ({ artifact: { id: 'fixture', type: 'whiteboard', title: '协作测试', revision, createdAt: '', updatedAt: '', pinned: false }, elements: [{ id: 'one', type: 'shape', version: revision + 1, x: revision * 10, y: 0, w: 100, h: 80 }], style: DEFAULT_STYLE });
const tick = async () => { for (let i = 0; i < 64; i++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let closes: (() => void)[] = [];
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); });
afterEach(() => { closes.forEach(close => close()); closes = []; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function fixture(read: (input: string | URL, init?: RequestInit) => Promise<Response>, polling = false, artifactId = 'fixture') {
  const streams: any[] = [];
  vi.stubGlobal('EventSource', class { onmessage: ((event: { data: string }) => void) | null = null; onerror: (() => void) | null = null; close = vi.fn(); addEventListener() {} constructor(public url: string) { streams.push(this); } });
  let current: Board | null = null;
  const onPresence = vi.fn(), onEvent = vi.fn(), onError = vi.fn(), onFeedback = vi.fn(), onClock = vi.fn(), onDocument = vi.fn(next => { current = next as Board; });
  const client: StudioClient = { embedded: polling, baseUrl: 'http://studio.test', token: 'fixture', request: read, call: vi.fn().mockRejectedValue(new Error('use abortable reads')) };
  const controller = createCollaboration({ client, polling, artifactId, peerId: 'page', getDocument: () => current, onDocument, onFeedback, onPresence, onEvent, onError, onClock, onStatus: vi.fn() });
  closes.push(controller.close);
  const emit = async (message: object) => { streams.at(-1).onmessage({ data: JSON.stringify({ artifactId, ...message }) }); await tick(); };
  return { controller, streams, emit, onPresence, onEvent, onError, onFeedback, onClock, onDocument, get: () => current };
}
function reply(next: Board) { return Response.json({ ok: true, data: next }); }
function reads(next: () => Board) { return vi.fn(async (input: string | URL, init?: RequestInit) => new URL(String(input)).pathname === '/api/tools/artifact_read' ? reply(next()) : new URL(String(input)).pathname === '/api/tools/artifact_feedback' ? Response.json({ ok: true, data: { feedback: [] } }) : Response.json({ peers: [], timer: null, cursor: 'epoch:1', accepted: true, serverTime: Date.now() })); }
const ready = (cursor = 'epoch:1') => ({ type: 'ready', cursor, reset: true, events: [], peers: [], timer: null, serverTime: Date.now(), actor: LOCAL_ACTOR });

describe('collaboration client transport', () => {
  it('rejects removed cursor chat before sending any room traffic', async () => {
    const request = reads(() => board(1)), view = fixture(request); await view.emit(ready());
    request.mockClear();
    expect(await view.controller.room.send('chat', { text: 'removed chat' })).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(request.mock.calls.filter(([input]) => new URL(String(input)).pathname === '/api/room')).toHaveLength(0);
  });

  it('publishes trusted document state only after the canonical commit is locally applied', async () => {
    const slow = deferred<Response>(), request = reads(() => board(1)); request.mockImplementationOnce(() => slow.promise);
    const view = fixture(request), states: any[] = [];
    view.controller.room.subscribeState!(state => { states.push(state); if (state.type === 'document') expect(view.get()!.artifact.revision).toBeGreaterThanOrEqual(state.commitRevision ?? state.document.artifact.revision); });
    await view.emit(ready());
    await view.emit({ type: 'board', operationId: 'real-save', actorId: LOCAL_ACTOR.id, changedIds: ['one'], unitVersions: { one: 3 }, cursor: 'epoch:2', revision: 2, artifact: board(2).artifact, units: [{ id: 'one', after: board(2).elements[0] }] });
    expect(states.filter(state => state.operationId === 'real-save')).toEqual([]);
    slow.resolve(reply(board(1))); await tick();
    const applied = states.find(state => state.operationId === 'real-save');
    expect(applied).toMatchObject({ type: 'document', epoch: 'epoch', cursor: 'epoch:2', actorId: LOCAL_ACTOR.id, commitRevision: 2, changedIds: ['one'], unitVersions: { one: 3 }, document: { artifact: { revision: 2 } } });
    expect(applied.document).toBe(view.get());
    const count = states.length;
    await view.emit({ type: 'room', cursor: 'epoch:3', events: [{ peerId: 'remote', actor: LOCAL_ACTOR, seq: 1, topic: 'document', data: { operationId: 'forged', commitRevision: 999 }, createdAt: '' }] });
    expect(states).toHaveLength(count);
    expect(await view.controller.room.send('document', { operationId: 'forged' })).toBe(false);
  });

  it('confirms an already-applied commit without replacing a newer document with an old body', async () => {
    const view = fixture(reads(() => board(3))), states: any[] = [];
    view.controller.room.subscribeState!(state => states.push(state)); await view.emit(ready());
    const current = view.get();
    await view.emit({ type: 'board', cursor: 'epoch:2', operationId: 'older-commit', actorId: LOCAL_ACTOR.id, changedIds: ['one'], unitVersions: { one: 3 }, revision: 2, artifact: board(2).artifact, units: [{ id: 'one', after: board(2).elements[0] }] });
    expect(view.get()).toBe(current);
    expect(states.at(-1)).toMatchObject({ type: 'document', operationId: 'older-commit', actorId: LOCAL_ACTOR.id, commitRevision: 2, unitVersions: { one: 3 }, document: { artifact: { revision: 3 } } });
    expect(view.onDocument).toHaveBeenCalledTimes(1);
  });

  it('clears transient peers on connection loss while preserving the durable timer and emits local reset', async () => {
    const view = fixture(reads(() => board(1))), states: any[] = [];
    view.controller.room.subscribeState!(state => states.push(state));
    const timer = { durationMs: 60000, deadline: Date.now() + 60000, remainingMs: 60000, paused: false, source: LOCAL_ACTOR };
    const peer = { peerId: 'remote', actor: LOCAL_ACTOR, updatedAt: '' };
    await view.emit({ ...ready(), peers: [peer], timer });
    expect(states.some(state => state.type === 'peers' && state.peers.length === 1)).toBe(true);
    view.streams[0].onerror(); await tick();
    expect(view.onPresence.mock.calls.at(-1)).toEqual([[], timer]);
    expect(states.at(-1)).toEqual({ type: 'reset', reason: 'pause' });
    expect(view.get()?.artifact.revision).toBe(1);
    view.controller.close(); expect(states.at(-1)).toEqual({ type: 'reset', reason: 'close' });
  });

  it('waits for exact unit repair before publishing an invalidated commit and resets transient state on hidden pages', async () => {
    const slow = deferred<Response>(), request = reads(() => board(1)), original = request.getMockImplementation()!;
    request.mockImplementation((input, init) => JSON.parse(String(init?.body || '{}')).mode === 'units' ? slow.promise : original(input, init));
    const view = fixture(request), states: any[] = [];
    view.controller.room.subscribeState!(state => states.push(state)); await view.emit(ready());
    await view.emit({ type: 'board', cursor: 'epoch:2', operationId: 'repaired', actorId: LOCAL_ACTOR.id, revision: 2, changedIds: ['one'], unitVersions: { one: 3 }, invalidation: true });
    expect(states.filter(state => state.operationId === 'repaired')).toEqual([]);
    slow.resolve(Response.json({ ok: true, data: { artifact: board(2).artifact, units: [{ id: 'one', after: board(2).elements[0] }] } })); await tick();
    expect(states.at(-1)).toMatchObject({ type: 'document', operationId: 'repaired', commitRevision: 2, unitVersions: { one: 3 } });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden'); document.dispatchEvent(new Event('visibilitychange')); await tick();
    expect(states.at(-1)).toEqual({ type: 'reset', reason: 'pause' }); expect(view.get()?.artifact.revision).toBe(2);
  });

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
    const view = fixture(request), states: any[] = []; view.controller.room.subscribeState!(state => states.push(state)); await view.emit(ready());
    await view.emit({ type: 'access-revoked', reason: 'removed', cursor: 'epoch:2' });
    expect(view.onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'access-revoked', reason: 'removed' }));
    expect(view.streams[0].close).toHaveBeenCalled(); pending.resolve(reply(board(1))); await tick();
    expect(view.get()).toBeNull();
    expect(states.at(-1)).toEqual({ type: 'reset', reason: 'pause' }); expect(states.some(state => state.type === 'document')).toBe(false);
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

  it.each([false, true])('handles a background feedback failure without rejecting a completed write (closed=%s)', async closed => {
    const request = reads(() => board(1)), view = fixture(request);
    await view.emit(ready());
    let reject!: (error: Error) => void;
    const waiting = new Promise<Response>((_resolve, fail) => { reject = fail; });
    const original = request.getMockImplementation()!;
    request.mockImplementation((input, init) => new URL(String(input)).pathname === '/api/tools/artifact_feedback' ? waiting : original(input, init));
    view.controller.feedbackChanged();
    expect(view.controller.refreshFeedback()).toBeUndefined();
    if (closed) view.controller.close();
    const failure = new Error('备注列表读取失败'); reject(failure); await tick();
    if (closed) expect(view.onError).not.toHaveBeenCalled();
    else {
      expect(view.onError).toHaveBeenCalledExactlyOnceWith(failure);
      expect(view.streams[0].close).toHaveBeenCalled();
    }
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

  it('continues receiving from its own cursor while a document read waits and delivers room and peers first', async () => {
    const slow = deferred<Response>(), request = reads(() => board(1)), listener = vi.fn();
    const peer = { peerId: 'remote', actor: LOCAL_ACTOR, updatedAt: '' };
    const message = { peerId: 'remote', actor: LOCAL_ACTOR, seq: 1, topic: 'gesture', data: { id: 'moving' }, createdAt: '' };
    const original = request.getMockImplementation()!; let polls = 0;
    request.mockImplementation((input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/artifact_read')) return slow.promise;
      if (path !== '/api/sync') return original(input, init);
      if (++polls === 1) return Promise.resolve(Response.json(ready()));
      if (polls === 2) return Promise.resolve(Response.json({ cursor: 'epoch:2', peers: [peer], events: [{ type: 'room', artifactId: 'fixture', cursor: 'epoch:2', events: [message] }] }));
      return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    });
    const view = fixture(request, true); view.controller.room.subscribe('gesture', listener);
    await tick(); await vi.advanceTimersByTimeAsync(20); await tick();
    expect(view.get()).toBeNull(); expect(listener).toHaveBeenCalledTimes(1);
    expect(view.onPresence.mock.calls.at(-1)?.[0]).toEqual([peer]);
    const calls = request.mock.calls.filter(([input]) => new URL(String(input)).pathname === '/api/sync');
    expect(calls.map(([input]) => new URL(String(input)).searchParams.get('after'))).toEqual([null, 'epoch:1', 'epoch:2']);
    slow.resolve(reply(board(1))); await tick();
    expect(view.get()?.artifact.revision).toBe(1); expect(listener).toHaveBeenCalledTimes(1);
    view.controller.close(); expect(calls[2]![1]?.signal?.aborted).toBe(true);
  });

  it('applies a versioned geometry patch without reading or replacing unchanged HTML and state', async () => {
    const initial = board(1); initial.elements[0] = { ...initial.elements[0]!, type: 'html', html: '<p>unchanged</p>'.repeat(20000), sourceRevision: 4, state: { selected: 'kept' }, bold: true };
    const request = reads(() => initial), view = fixture(request); await view.emit(ready());
    await view.emit({ type: 'board', cursor: 'epoch:2', revision: 2, artifact: board(2).artifact, changedIds: ['one'], units: [{ id: 'one', patch: { baseVersion: 2, version: 3, changes: { x: 90 }, removedKeys: ['bold'] } }] });
    expect(view.get()?.elements[0]).toMatchObject({ version: 3, x: 90, html: initial.elements[0].html, sourceRevision: 4, state: { selected: 'kept' } });
    expect(view.get()?.elements[0]).not.toHaveProperty('bold');
    expect(request.mock.calls.filter(([input]) => new URL(String(input)).pathname.endsWith('/artifact_read'))).toHaveLength(1);
  });

  it('rejects reserved, rewound and malformed patches without partially changing the document', () => {
    const current = board(1), patch = { baseVersion: 2, version: 3, changes: { x: 90 }, removedKeys: [] as string[] };
    for (const invalid of [{ ...patch, version: 2 }, { ...patch, changes: { id: 'other' } }, { ...patch, changes: { version: 900 } }, { ...patch, changes: { w: -1 } }, { ...patch, removedKeys: ['type'] }]) {
      expect(applyWhiteboardRemoteEvent(current, { type: 'board', artifactId: 'fixture', revision: 2, artifact: board(2).artifact, units: [{ id: 'one', patch: invalid }] })).toBeUndefined();
    }
    expect(applyWhiteboardRemoteEvent(current, { type: 'board', artifactId: 'fixture', revision: 2, artifact: board(2).artifact, units: [{ id: 'one', patch }, { id: 'missing', patch }] })).toBeUndefined();
    expect(current.elements[0]).toMatchObject({ version: 2, x: 10 });
  });

  it('revokes a polling client while its initial snapshot is still pending', async () => {
    const slow = deferred<Response>(), request = reads(() => board(1)), original = request.getMockImplementation()!; let polls = 0;
    request.mockImplementation((input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/artifact_read')) return slow.promise;
      if (path === '/api/sync') return Promise.resolve(Response.json(++polls === 1 ? ready() : { cursor: 'epoch:2', events: [{ type: 'access-revoked', artifactId: 'fixture', cursor: 'epoch:2', reason: 'removed' }] }));
      return original(input, init);
    });
    const view = fixture(request, true); await tick(); await vi.advanceTimersByTimeAsync(10); await tick();
    expect(view.onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'access-revoked', reason: 'removed' }));
    const read = request.mock.calls.find(([input]) => new URL(String(input)).pathname.endsWith('/artifact_read'));
    expect(read?.[1]?.signal?.aborted).toBe(true);
    slow.resolve(reply(board(1))); await tick();
    expect(view.get()).toBeNull(); expect(polls).toBe(2);
  });

  it('does not publish an old epoch snapshot after a newer reset was already received', async () => {
    const slow = deferred<Response>(), request = reads(() => board(2)); request.mockImplementationOnce(() => slow.promise);
    const view = fixture(request), states: any[] = []; view.controller.room.subscribeState!(state => states.push(state)); await view.emit(ready()); await view.emit(ready('replacement:1'));
    slow.resolve(reply(board(1))); await tick();
    expect(view.get()?.artifact.revision).toBe(2);
    expect(view.onDocument.mock.calls.map(([next]) => next.artifact.revision)).toEqual([2]);
    expect(states.filter(state => state.type === 'document').map(state => state.epoch)).toEqual(['replacement']);
  });

  it('ignores duplicate and older received event cursors before applying document callbacks', async () => {
    const request = reads(() => board(1)), view = fixture(request); await view.emit(ready());
    const changed = { type: 'board', cursor: 'epoch:3', revision: 2, artifact: board(2).artifact, units: [{ id: 'one', after: board(2).elements[0] }] };
    await view.emit(changed); await view.emit(changed); await view.emit({ ...changed, cursor: 'epoch:2' });
    expect(view.onDocument.mock.calls.map(([next]) => next.artifact.revision)).toEqual([1, 2]);
    expect(view.onEvent.mock.calls.filter(([event]) => event.type === 'board')).toHaveLength(1);
  });

  it('repairs a patch base mismatch from exact historical units instead of pulling the entire board', async () => {
    const request = reads(() => board(1)), original = request.getMockImplementation()!;
    request.mockImplementation((input, init) => {
      const args = init?.body ? JSON.parse(String(init.body)) : {};
      return args.mode === 'units' ? Promise.resolve(Response.json({ ok: true, data: { artifact: board(2).artifact, units: [{ id: 'one', after: board(2).elements[0] }] } })) : original(input, init);
    });
    const view = fixture(request); await view.emit(ready());
    await view.emit({ type: 'board', cursor: 'epoch:2', revision: 2, artifact: board(2).artifact, changedIds: ['one'], units: [{ id: 'one', patch: { baseVersion: 1, version: 3, changes: { x: 999 }, removedKeys: [] } }] });
    expect(view.get()?.elements[0]?.x).toBe(20);
    const args = request.mock.calls.filter(([input]) => new URL(String(input)).pathname.endsWith('/artifact_read')).map(([, init]) => JSON.parse(String(init?.body)));
    expect(args).toEqual([{ artifactId: 'fixture', mode: 'board' }, { artifactId: 'fixture', mode: 'units', ids: ['one'], atRevision: 2 }]);
    expect(view.onError).not.toHaveBeenCalled();
  });

  it('uses a full snapshot only when the requested repair revision is no longer retained', async () => {
    let latest = board(1); const request = reads(() => latest), original = request.getMockImplementation()!;
    request.mockImplementation((input, init) => {
      const args = init?.body ? JSON.parse(String(init.body)) : {};
      if (args.mode === 'units') { latest = board(3); return Promise.resolve(Response.json({ error: { code: 'VERSION_NOT_FOUND', message: 'History expired' } }, { status: 404 })); }
      return original(input, init);
    });
    const view = fixture(request); await view.emit(ready());
    await view.emit({ type: 'board', cursor: 'epoch:2', revision: 2, artifact: board(2).artifact, changedIds: ['one'], invalidation: true });
    expect(view.get()?.artifact.revision).toBe(3); expect(view.onError).not.toHaveBeenCalled();
    expect(request.mock.calls.filter(([, init]) => init?.body && JSON.parse(String(init.body)).mode === 'board')).toHaveLength(2);
  });

  it('keeps repair permission failures observable and does not fall back to a broader read', async () => {
    const request = reads(() => board(1)), original = request.getMockImplementation()!;
    request.mockImplementation((input, init) => init?.body && JSON.parse(String(init.body)).mode === 'units' ? Promise.resolve(Response.json({ error: { code: 'FORBIDDEN', message: 'Access changed' } }, { status: 403 })) : original(input, init));
    const view = fixture(request); await view.emit(ready());
    await view.emit({ type: 'board', cursor: 'epoch:2', revision: 2, artifact: board(2).artifact, changedIds: ['one'], invalidation: true });
    expect(view.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(request.mock.calls.filter(([, init]) => init?.body && JSON.parse(String(init.body)).mode === 'board')).toHaveLength(1);
  });

  it('bounds queued documents while retaining later room delivery and an authoritative overflow barrier', async () => {
    const slow = deferred<Response>(), request = reads(() => board(70)); request.mockImplementationOnce(() => slow.promise);
    const view = fixture(request), listener = vi.fn(); view.controller.room.subscribe('gesture', listener);
    await view.emit(ready());
    for (let revision = 1; revision <= 70; revision++) await view.emit({ type: 'board', cursor: `epoch:${revision + 1}`, revision, artifact: board(revision).artifact, units: [{ id: 'one', after: board(revision).elements[0] }] });
    await view.emit({ type: 'room', cursor: 'epoch:72', events: [{ peerId: 'other', actor: LOCAL_ACTOR, seq: 1, topic: 'gesture', data: { id: 'last' }, createdAt: '' }] });
    expect(listener).toHaveBeenCalledTimes(1); expect(view.get()).toBeNull();
    slow.resolve(reply(board(0))); for (let i = 0; i < 8; i++) await tick();
    expect(view.get()?.artifact.revision).toBe(70); expect(listener).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.filter(([, init]) => init?.body && JSON.parse(String(init.body)).mode === 'board')).toHaveLength(2);
  });
});

async function withUnitContractService(run: (service: StudioService, initial: Board) => Promise<void>) {
  vi.useRealTimers();
  const directory = await mkdtemp(join(tmpdir(), 'studio-client-unit-contract-')), service = new StudioService({ dataRoot: directory, ownerName: 'Unit contract QA' });
  try {
    const created = await service.execute('artifact_manage', { action: 'create', elements: ['one', 'two', 'three'].map(id => ({ id, type: 'text', text: id })) });
    await run(service, created.board as Board);
  } finally {
    await service.close(); const target = resolve(directory);
    if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith('studio-client-unit-contract-')) throw new Error('Unexpected unit-contract fixture');
    await rm(target, { recursive: true, force: true });
  }
}

describe('real service content-unit publication contract', () => {
  it.each(['add', 'delete'] as const)('preserves order versions from a remote %s before the receiver issues a layer CAS', async action => {
    await withUnitContractService(async (service, initial) => {
      const events: StudioEvent[] = [], unsubscribe = service.subscribe(initial.artifact.id, event => { if (event.type === 'board') events.push(event); });
      try {
        const committed = await service.execute('artifact_apply', { artifactId: initial.artifact.id, operationId: randomUUID(), expectedRevision: initial.artifact.revision, operations: action === 'add' ? [{ op: 'add', element: { id: 'added', type: 'text', text: 'Remote addition' } }] : [{ op: 'delete', id: 'three' }] });
        expect(events).toHaveLength(1); expect(events[0]!.invalidation).not.toBe(true);
        const received = applyWhiteboardRemoteEvent(initial, events[0]!); expect(received).toBeDefined();
        expect(received!.elements.map(element => element.id)).toEqual(committed.board.elements.map((element: { id: string }) => element.id));
        const layered = await service.execute('artifact_apply', { artifactId: initial.artifact.id, operationId: randomUUID(), expectedRevision: received!.artifact.revision, expectedVersions: { one: received!.elements.find(element => element.id === 'one')!.version, $order: received!.orderVersion ?? 0 }, operations: [{ op: 'layout', ids: ['one'], preset: 'front' }] });
        expect(received!.orderVersion).toBe(committed.board.orderVersion); expect(layered.board.orderVersion).toBe(committed.board.orderVersion + 1);
        expect(layered.board.elements.at(-1).id).toBe('one'); expect(events[0]!.changedIds).toEqual(expect.arrayContaining(['$order']));
      } finally { unsubscribe(); }
    });
  });

  it('recovers a >128KiB remote addition from exact units including order before a layer CAS', async () => {
    await withUnitContractService(async (service, initial) => {
      const events: StudioEvent[] = [], unsubscribe = service.subscribe(initial.artifact.id, event => { if (event.type === 'board') events.push(event); });
      const request = vi.fn(async (input: string | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname, args = init?.body ? JSON.parse(String(init.body)) : {};
        try {
          if (path.endsWith('/artifact_read')) return Response.json({ ok: true, data: await service.execute('artifact_read', args) });
          if (path.endsWith('/artifact_feedback')) return Response.json({ ok: true, data: await service.execute('artifact_feedback', args) });
          return Response.json({ peers: [], timer: null, cursor: service.cursor(), accepted: true, serverTime: Date.now() });
        } catch (error) {
          return Response.json({ error: { code: (error as { code?: string }).code, message: (error as Error).message } }, { status: 409 });
        }
      });
      const view = fixture(request, false, initial.artifact.id);
      try {
        await view.emit({ ...ready(service.cursor()), artifactId: initial.artifact.id });
        await vi.waitFor(() => expect(view.get()?.artifact.revision).toBe(initial.artifact.revision), { timeout: 3000, interval: 10 });
        const committed = await service.execute('artifact_apply', { artifactId: initial.artifact.id, operationId: randomUUID(), expectedRevision: initial.artifact.revision, operations: [{ op: 'add', element: { id: 'large', type: 'html', html: '<p>Large remote content</p>' + 'x'.repeat(160 * 1024) } }] });
        expect(events).toHaveLength(1); expect(events[0]!.invalidation).toBe(true); expect(events[0]!.units).toBeUndefined();
        await view.emit(events[0]!);
        await vi.waitFor(() => expect(view.get()?.artifact.revision).toBe(committed.board.artifact.revision), { timeout: 3000, interval: 10 });
        const reads = request.mock.calls.filter(([input]) => new URL(String(input)).pathname.endsWith('/artifact_read')).map(([, init]) => JSON.parse(String(init?.body)));
        expect(reads).toHaveLength(2); expect(reads[0]).toMatchObject({ mode: 'board' });
        expect(reads[1]).toMatchObject({ mode: 'units', atRevision: committed.board.artifact.revision }); expect(reads[1].ids).toEqual(expect.arrayContaining(['large', '$order']));
        const received = view.get()!;
        const layered = await service.execute('artifact_apply', { artifactId: initial.artifact.id, operationId: randomUUID(), expectedRevision: received.artifact.revision, expectedVersions: { one: received.elements.find(element => element.id === 'one')!.version, $order: received.orderVersion ?? 0 }, operations: [{ op: 'layout', ids: ['one'], preset: 'front' }] });
        expect(received.orderVersion).toBe(committed.board.orderVersion); expect(layered.board.orderVersion).toBe(committed.board.orderVersion + 1); expect(view.onError).not.toHaveBeenCalled();
      } finally { view.controller.close(); unsubscribe(); }
    });
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
  const moving: NativeGesture = { id: 'move', kind: 'move', elements: board(2).elements.map(element => ({ ...element, version: 1 })) };
  for (const part of encodeGestureFrame(moving, 2, () => ++seq)) receiver.receive(message(part));
  receiver.receive(message({ id: 'move', seq: ++seq, phase: 'end', kind: 'move', frame: 2, storedIds: ['one'] }));
  expect(receiver.read(board(0))).toHaveLength(1);
  receiver.authority({ type: 'document', document: board(2), operationId: 'move', actorId: LOCAL_ACTOR.id, commitRevision: 2, changedIds: ['one'], unitVersions: { one: 3 } });
  expect(receiver.read(board(2))).toEqual([]);
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
