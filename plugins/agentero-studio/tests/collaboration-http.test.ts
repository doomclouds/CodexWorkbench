import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { SyncBatch } from '../src/contracts/studio.js';
import { StudioService } from '../src/core/service.js';
import type { StudioCollaboration } from '../src/core/shared/collaboration.js';
import { startStudioHost, type StudioHost } from '../src/server/http.js';

let directory: string, host: StudioHost, artifactId: string;
const cancellations: AbortController[] = [];
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'studio-collaboration-http-')); host = await startStudioHost({ dataRoot: directory }); artifactId = (await host.service.execute('artifact_manage', { action: 'create' })).artifact.id; });
afterEach(async () => { vi.restoreAllMocks(); for (const controller of cancellations.splice(0)) controller.abort(); await host.close(); if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected test directory'); await rm(directory, { recursive: true, force: true }); });
const ownerHeaders = () => ({ Authorization: `Bearer ${host.token}`, 'Content-Type': 'application/json' });
const request = (path: string, init: RequestInit = {}) => fetch(`${host.origin}${path}`, { ...init, headers: { ...ownerHeaders(), ...init.headers } });
const sync = async (after?: string, extra = ''): Promise<SyncBatch> => (await request(`/api/sync?artifactId=${artifactId}${after ? `&after=${encodeURIComponent(after)}` : ''}${extra}`)).json();
async function mutate(text: string, version?: number) {
  return host.service.execute('artifact_apply', { artifactId, operationId: randomUUID(), ...(version === undefined ? {} : { expectedVersions: { item: version } }), operations: version === undefined ? [{ op: 'add', element: { id: 'item', type: 'text', text } }] : [{ op: 'update', id: 'item', changes: { text } }] });
}
const buffers = new WeakMap<ReadableStreamDefaultReader<Uint8Array>, string>();
async function frame(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<{ id?: string; data: any }> {
  let text = buffers.get(reader) ?? '';
  while (!text.includes('\n\n')) { const part = await reader.read(); if (part.done) throw new Error('SSE ended before a frame'); text += new TextDecoder().decode(part.value); }
  const boundary = text.indexOf('\n\n'); buffers.set(reader, text.slice(boundary + 2));
  const lines = text.slice(0, boundary).split('\n'); return { id: lines.find(line => line.startsWith('id: '))?.slice(4), data: JSON.parse(lines.find(line => line.startsWith('data: '))!.slice(6)) };
}
async function guest(role: 'editor' | 'viewer') {
  const share = await host.service.execute('artifact_share', { artifactId, action: 'start' }), token = new URL(share.links[role]).searchParams.get('share')!;
  const joined = await fetch(`${host.origin}/api/session?artifactId=${artifactId}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `Guest-${role}` }) });
  const actor = (await joined.json()).actor, cookie = joined.headers.get('set-cookie')!.split(';')[0]!;
  const headers = { Authorization: `Bearer ${token}`, Cookie: cookie, 'Content-Type': 'application/json' };
  return { actor, request: (path: string, init: RequestInit = {}) => fetch(`${host.origin}${path}`, { ...init, headers: { ...headers, ...init.headers } }) };
}

describe('HTTP collaboration change transport', () => {
  it('closes the snapshot-to-subscribe gap with cursor replay and streams incremental units with SSE IDs', async () => {
    const initial = await sync(); expect(initial.reset).toBe(true);
    const created = await mutate('first');
    const incremental = await sync(initial.cursor); expect(incremental.reset).toBe(false);
    expect(incremental.events).toMatchObject([{ type: 'board', revision: created.board.artifact.revision, units: [{ id: 'item', after: { text: 'first', version: 1 } }] }]);
    const abort = new AbortController(); cancellations.push(abort);
    const response = await request(`/api/events?artifactId=${artifactId}&after=${encodeURIComponent(initial.cursor)}&peerId=web-a&peerEpoch=epoch-a`, { signal: abort.signal });
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const reader = response.body!.getReader(), ready = await frame(reader);
    expect(ready.data).toMatchObject({ type: 'ready', reset: false, peers: [{ peerId: 'web-a', peerEpoch: 'epoch-a' }] });
    expect(ready.data.events.some((event: any) => event.type === 'board' && event.units?.[0]?.after?.text === 'first')).toBe(true);
    expect(ready.id).toBe(ready.data.cursor);
    await mutate('second', 1); const update = await frame(reader);
    expect(update.data).toMatchObject({ type: 'board', units: [{ id: 'item', after: { text: 'second', version: 2 } }] }); expect(update.id).toBe(update.data.cursor);
    abort.abort();
    const resumed = await request(`/api/events?artifactId=${artifactId}`, { headers: { 'Last-Event-ID': incremental.cursor }, signal: AbortSignal.timeout(3000) });
    const replay = await frame(resumed.body!.getReader()); expect(replay.data.events.some((event: any) => event.units?.[0]?.after?.text === 'second')).toBe(true); await resumed.body?.cancel().catch(() => {});
  });

  it('supports cancellable bounded long polls and reconnect reset after a server epoch changes', async () => {
    const initial = await sync();
    const waiting = sync(initial.cursor, '&wait=1000'); await mutate('arrived');
    expect((await waiting).events.some(event => event.type === 'board')).toBe(true);
    expect((await sync((await sync()).cursor, '&wait=5')).events).toEqual([]);
    const abort = new AbortController(); const pending = request(`/api/sync?artifactId=${artifactId}&after=${encodeURIComponent((await sync()).cursor)}&wait=20000`, { signal: abort.signal });
    abort.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect((await request(`/api/sync?artifactId=${artifactId}&wait=20001`)).status).toBe(400);
    const stale = (await sync()).cursor; await host.close(); host = await startStudioHost({ dataRoot: directory });
    expect((await sync(stale)).reset).toBe(true);
    expect((await host.service.execute('artifact_read', { artifactId })).elements).toMatchObject([{ text: 'arrived' }]);
  });

  it('delivers a commit that occurs after the SSE snapshot was read but before its ready response', async () => {
    const after = (await sync()).cursor, original = host.service.sync.bind(host.service); let reads = 0;
    vi.spyOn(host.service, 'sync').mockImplementation(async (...args) => {
      const result = await original(...args);
      if (++reads === 2) await mutate('during-ready');
      return result;
    });
    const abort = new AbortController(); cancellations.push(abort);
    const response = await request(`/api/events?artifactId=${artifactId}&after=${encodeURIComponent(after)}`, { signal: abort.signal });
    const reader = response.body!.getReader(), ready = await frame(reader), change = await frame(reader);
    expect(ready.data).toMatchObject({ type: 'ready', events: [] });
    expect(change.data).toMatchObject({ type: 'board', units: [{ id: 'item', after: { text: 'during-ready' } }] });
    expect(change.id).not.toBe(ready.id); abort.abort();
  });

  it('binds multiple peers to their authenticated person and preserves ordered/null cursor state', async () => {
    const person = await guest('editor'), base = { artifactId, peerId: 'guest-a', peerEpoch: 'epoch-a' };
    const post = (input: Record<string, unknown>) => person.request('/api/presence', { method: 'POST', body: JSON.stringify(input) });
    await post({ ...base, peerSeq: 2, cursor: { x: 40, y: 50 }, actor: { id: 'forged', name: 'Forged', role: 'owner', kind: 'agent' } });
    const stale = await (await post({ ...base, peerSeq: 1, cursor: { x: 1, y: 1 } })).json(); expect(stale.accepted).toBe(false);
    expect(stale.peers).toMatchObject([{ actor: person.actor, cursor: { x: 40, y: 50 }, peerSeq: 2 }]);
    await post({ ...base, peerSeq: 3, cursor: null, visible: false });
    await post({ ...base, peerId: 'guest-b', peerEpoch: 'epoch-b', peerSeq: 0 });
    const peers = (await (await person.request(`/api/presence?artifactId=${artifactId}`)).json()).peers;
    expect(peers).toHaveLength(2); expect(peers[0]).toMatchObject({ actor: person.actor, cursor: null, visible: false });
    const denied = await request('/api/presence', { method: 'POST', body: JSON.stringify({ ...base, peerSeq: 100 }) }); expect(denied.status).toBe(403);
  });

  it('checks room roles and wakes/rejects a revoked guest long poll before it can receive later content', async () => {
    const person = await guest('viewer'), payload = { artifactId, peerId: 'viewer-a', peerEpoch: 'epoch-a', peerSeq: 0, events: [{ topic: 'gesture', data: { id: 'drag-a', seq: 1, phase: 'start' } }] };
    expect((await person.request('/api/room', { method: 'POST', body: JSON.stringify(payload) })).status).toBe(403);
    expect((await person.request('/api/room', { method: 'POST', body: JSON.stringify({ ...payload, peerSeq: 1, events: [{ topic: 'chat', data: { text: 'hello' } }] }) })).status).toBe(200);
    const cursor = (await (await person.request(`/api/sync?artifactId=${artifactId}`)).json()).cursor;
    const waiting = person.request(`/api/sync?artifactId=${artifactId}&after=${encodeURIComponent(cursor)}&wait=20000`);
    await host.service.execute('artifact_share', { artifactId, action: 'remove', memberId: person.actor.id });
    const rejected = await waiting; expect([401, 403]).toContain(rejected.status); expect((await rejected.json()).error.code).toBe('UNAUTHORIZED');
    expect((await person.request('/api/room', { method: 'POST', body: JSON.stringify({ ...payload, peerSeq: 2 }) })).status).toBe(401);
    expect((await host.service.execute('artifact_read', { artifactId, mode: 'history' })).history).toHaveLength(1);
  });

  it('rechecks a queued presence actor after member removal before publishing its update', async () => {
    const person = await guest('editor'), input = { artifactId, peerId: 'queued-guest', peerEpoch: 'epoch-a', peerSeq: 0 };
    await person.request('/api/presence', { method: 'POST', body: JSON.stringify(input) });
    const collaboration = (host.service as unknown as { collaboration: StudioCollaboration }).collaboration;
    let release!: () => void, entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; }), queued = new Promise<void>(resolve => { entered = resolve; });
    const barrier = (collaboration as unknown as { serialized<T>(id: string, run: () => Promise<T>): Promise<T> }).serialized(artifactId, () => blocked);
    const original = collaboration.update.bind(collaboration);
    vi.spyOn(collaboration, 'update').mockImplementation((...args) => { const task = original(...args); entered(); return task; });
    const pending = person.request('/api/presence', { method: 'POST', body: JSON.stringify({ ...input, peerSeq: 1, cursor: { x: 5, y: 6 } }) });
    try {
      await queued; await host.service.execute('artifact_share', { artifactId, action: 'remove', memberId: person.actor.id });
      expect(host.service.getPresence(artifactId)).toEqual([]);
    } finally { release(); }
    await barrier;
    expect((await pending).status).toBe(401); expect(host.service.getPresence(artifactId)).toEqual([]);
  });

  it('does not connect an already-revoked peer after the first SSE authorization result is delayed', async () => {
    const person = await guest('viewer'), original = host.service.sync.bind(host.service);
    let release!: () => void, entered!: () => void, paused = false;
    const gate = new Promise<void>(resolve => { release = resolve; }), reached = new Promise<void>(resolve => { entered = resolve; });
    vi.spyOn(host.service, 'sync').mockImplementation(async (...args) => {
      const result = await original(...args);
      if (!paused && args[1].peerId === 'revoked-sse') { paused = true; entered(); await gate; }
      return result;
    });
    const connect = vi.spyOn(host.service, 'connectPeer');
    const pending = person.request(`/api/events?artifactId=${artifactId}&peerId=revoked-sse&peerEpoch=epoch-a`);
    try { await reached; await host.service.execute('artifact_share', { artifactId, action: 'remove', memberId: person.actor.id }); }
    finally { release(); }
    const response = await pending; await response.text();
    // Let the paused route finish after the already-sent 403, then inspect actual room state.
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(response.status).toBe(403); expect(connect).not.toHaveBeenCalled(); expect(host.service.getPresence(artifactId)).toEqual([]);
    const collaboration = (host.service as unknown as { collaboration: { peers: Map<string, Map<string, { streams: number }>> } }).collaboration;
    expect(collaboration.peers.get(artifactId)?.get('revoked-sse')?.streams ?? 0).toBe(0);
  });

  it('accumulates timer actions across service instances under the artifact lock and restores them over HTTP', async () => {
    const action = (timer: Record<string, unknown>) => request('/api/presence', { method: 'POST', body: JSON.stringify({ artifactId, timer }) });
    const started = await (await action({ action: 'start', durationSeconds: 60 })).json(), other = new StudioService({ dataRoot: directory });
    try {
      const [response] = await Promise.all([action({ action: 'adjust', deltaSeconds: 60 }), other.updatePresence(artifactId, { timer: { action: 'adjust', deltaSeconds: 60 } }, other.owner)]);
      expect(response.status).toBe(200);
    } finally { await other.close(); }
    await host.close(); host = await startStudioHost({ dataRoot: directory });
    const recovered = await sync(); expect(recovered.timer).not.toBeNull();
    expect(Math.abs(recovered.timer!.deadline! - started.timer.deadline - 120_000)).toBeLessThan(50);
    expect(recovered.timer!.remainingMs).toBeGreaterThan(175_000); expect(recovered.serverTime).toBeLessThanOrEqual(Date.now());
    expect((await host.service.execute('artifact_read', { artifactId, mode: 'history' })).history).toHaveLength(1);
  });
});
