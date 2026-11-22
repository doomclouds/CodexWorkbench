import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { SyncBatch } from '../../src/contracts/studio.js';
import type { BoardOpenResponse, BoardSceneResponse } from '../../src/contracts/board-open.js';
import { createStudioService } from '../../src/server/studio-composition.js';
import type { StudioCollaboration } from '../../src/core/shared/collaboration.js';
import { startStudioHost, type StudioHost } from '../../src/server/http.js';
import { SqliteArtifactRepository } from '../../src/infrastructure/sqlite-artifact.js';

let directory: string;
let host: StudioHost;
let artifactId: string;
const cancellations: AbortController[] = [];

type PeerStreams = Map<string, { streams: number }>;
type ArtifactStreams = Map<string, PeerStreams>;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'studio-collaboration-http-'));
  host = await startStudioHost({ dataRoot: directory });
  artifactId = (await host.service.execute('artifact_manage', { action: 'create' })).artifact.id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const controller of cancellations.splice(0)) {
    controller.abort();
  }

  await host.close();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) {
    throw new Error('Unexpected test directory');
  }

  await rm(directory, { recursive: true, force: true });
});
const ownerHeaders = () => ({
  Authorization: `Bearer ${host.token}`,
  'Content-Type': 'application/json',
});
const request = (path: string, init: RequestInit = {}) =>
  fetch(`${host.origin}${path}`, { ...init, headers: { ...ownerHeaders(), ...init.headers } });
const sync = async (after?: string, extra = ''): Promise<SyncBatch> =>
  (
    await request(
      `/api/sync?artifactId=${artifactId}${after ? `&after=${encodeURIComponent(after)}` : ''}${extra}`,
    )
  ).json();

async function mutate(text: string, version?: number) {
  return host.service.execute('artifact_apply', {
    artifactId,
    operationId: randomUUID(),
    ...(version === undefined ? {} : { expectedVersions: { item: version } }),
    operations:
      version === undefined
        ? [{ op: 'add', element: { id: 'item', type: 'text', text } }]
        : [{ op: 'update', id: 'item', changes: { text } }],
  });
}

const buffers = new WeakMap<ReadableStreamDefaultReader<Uint8Array>, string>();

async function frame(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<{ id?: string; data: any }> {
  let text = buffers.get(reader) ?? '';
  while (!text.includes('\n\n')) {
    const part = await reader.read();
    if (part.done) {
      throw new Error('SSE ended before a frame');
    }

    text += new TextDecoder().decode(part.value);
  }

  const boundary = text.indexOf('\n\n');
  buffers.set(reader, text.slice(boundary + 2));
  const lines = text.slice(0, boundary).split('\n');

  return {
    id: lines.find((line) => line.startsWith('id: '))?.slice(4),
    data: JSON.parse(lines.find((line) => line.startsWith('data: '))!.slice(6)),
  };
}

async function guest(role: 'editor' | 'viewer') {
  const share = await host.service.execute('artifact_share', { artifactId, action: 'start' });
  const token = new URL(share.links[role]).searchParams.get('share')!;
  const joined = await fetch(`${host.origin}/api/session?artifactId=${artifactId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `Guest-${role}` }),
  });
  const actor = (await joined.json()).actor;
  const cookie = joined.headers.get('set-cookie')!.split(';')[0]!;
  const headers = {
    Authorization: `Bearer ${token}`,
    Cookie: cookie,
    'Content-Type': 'application/json',
  };

  return {
    actor,
    request: (path: string, init: RequestInit = {}) =>
      fetch(`${host.origin}${path}`, { ...init, headers: { ...headers, ...init.headers } }),
  };
}

it('checks the authorized revision without reading content or historical snapshots', async () => {
  const committed = await mutate('校对版次');
  const viewer = await guest('viewer');
  const readAll = vi.spyOn(SqliteArtifactRepository.prototype, 'readState');
  const response = await viewer.request(`/api/sync?artifactId=${artifactId}&check=revision`);

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    artifactId,
    revision: committed.board.artifact.revision,
  });
  expect(readAll).not.toHaveBeenCalled();
});

it('opens a cached exact board without reading bodies and returns full content for a stale service epoch', async () => {
  const saved = await mutate('Cached board');
  const viewer = await guest('viewer');
  const path = `/api/sync?artifactId=${artifactId}&check=board`;
  const initial = await viewer.request(path);
  const opened: BoardOpenResponse = await initial.json();
  expect(initial.status).toBe(200);
  expect(opened).toMatchObject({ unchanged: false, board: saved.board });

  const readAll = vi.spyOn(SqliteArtifactRepository.prototype, 'readState');
  const known = `${path}&knownRevision=${opened.revision}&knownEpoch=${opened.epoch}`;
  const current = await viewer.request(known);
  expect(await current.json()).toMatchObject({
    artifactId,
    revision: opened.revision,
    unchanged: true,
    artifact: saved.board.artifact,
  });
  expect(readAll).not.toHaveBeenCalled();

  const stale = await viewer.request(
    `${path}&knownRevision=${opened.revision}&knownEpoch=previous-service`,
  );
  expect(await stale.json()).toMatchObject({ unchanged: false, board: saved.board });
  expect(readAll).toHaveBeenCalledOnce();
});

it('reads geometry for a rich object without returning its saved source', async () => {
  await host.service.execute('artifact_apply', {
    artifactId,
    operationId: randomUUID(),
    expectedRevision: 0,
    operations: [
      { op: 'add', element: { id: 'rich', type: 'html', html: '<p>Rich source</p>' } },
      { op: 'add', element: { id: 'short', type: 'text', text: 'Visible text' } },
    ],
  });
  const viewer = await guest('viewer');
  const readAll = vi.spyOn(SqliteArtifactRepository.prototype, 'readState');
  const response = await viewer.request(`/api/sync?artifactId=${artifactId}&check=scene`);
  const payload: BoardSceneResponse = await response.json();
  expect(response.status).toBe(200);
  expect(payload.scene.units).toEqual([
    { state: 'unloaded', geometry: expect.objectContaining({ id: 'rich', type: 'html' }) },
    { state: 'complete', element: expect.objectContaining({ id: 'short', text: 'Visible text' }) },
  ]);
  expect(JSON.stringify(payload)).not.toContain('Rich source');
  expect(readAll).not.toHaveBeenCalled();
});

function holdSseWrite(matches: (text: string) => boolean = () => true) {
  const original = ServerResponse.prototype.write;
  const writes: string[] = [];
  let response: ServerResponse | undefined;

  vi.spyOn(ServerResponse.prototype, 'write').mockImplementation(function (
    this: ServerResponse,
    ...args
  ) {
    const accepted = original.apply(this, args);
    if (this.getHeader('Content-Type') !== 'text/event-stream' || (response && response !== this)) {
      return accepted;
    }

    const text = String(args[0]);
    writes.push(text);
    if (!response && matches(text)) {
      response = this;

      return false;
    }

    return accepted;
  });

  return {
    writes,
    get response() {
      if (!response) {
        throw new Error('Expected a held SSE write');
      }

      return response;
    },
    drain() {
      this.response.emit('drain');
    },
  };
}

function emitBoard(revision: number, text = 'synthetic') {
  const collaboration = (host.service as unknown as { collaboration: StudioCollaboration })
    .collaboration;
  collaboration.emit({
    type: 'board',
    artifactId,
    revision,
    units: [{ id: 'item', after: { id: 'item', type: 'text', text } }],
  });
}

it('binds canonical board events to the real persisted operation without duplicating idempotent commits', async () => {
  const cursor = host.service.cursor();
  const operationId = 'canonical-preview-handoff';
  const args = {
    artifactId,
    operationId,
    operations: [
      { op: 'add', element: { id: 'handoff', type: 'table', x: 0, y: 0, w: 200, h: 100 } },
    ],
  };
  await host.service.execute('artifact_apply', args);
  await host.service.execute('artifact_apply', args);
  const result = await sync(cursor);
  const events = result.events.filter((event) => event.type === 'board');
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    operationId,
    actorId: host.service.owner.id,
    revision: 1,
    changedIds: expect.arrayContaining(['handoff', '$order']),
    unitVersions: { handoff: 1 },
  });
  expect((await host.service.store.read(artifactId)).artifact.revision).toBe(1);
});

it('keeps an actual pending human save protected from Agent writes without calling it active editing', async () => {
  await mutate('initial');
  const invalid = await request('/api/presence', {
    method: 'POST',
    body: JSON.stringify({
      artifactId,
      peerId: 'invalid-saving',
      context: { artifactId, viewId: 'invalid-saving', selectedIds: [], savingIds: 'item' },
    }),
  });
  expect(invalid.status).toBe(400);
  expect((await invalid.json()).error.code).toBe('INVALID_ARGUMENT');
  await host.service.updatePresence(
    artifactId,
    {
      peerId: 'human-saving',
      context: {
        artifactId,
        viewId: 'human-saving',
        selectedIds: [],
        editingIds: [],
        movingIds: [],
        savingIds: ['item'],
      },
    },
    host.service.owner,
  );
  const agent = {
    id: 'synthetic-agent',
    name: 'Synthetic Agent',
    kind: 'agent' as const,
    role: 'owner' as const,
  };
  const begun = await host.service.execute(
    'artifact_activity',
    {
      artifactId,
      action: 'begin',
      taskId: 'after-human-save',
      phase: 'writing',
      scope: { ids: ['item'] },
    },
    agent,
  );
  const binding = { taskId: 'after-human-save', generation: begun.tasks[0].generation };
  const args = {
    artifactId,
    ...binding,
    operationId: 'agent-after-human-save',
    expectedVersions: { item: 1 },
    operations: [{ op: 'update', id: 'item', changes: { text: 'Agent result' } }],
  };
  await expect(host.service.execute('artifact_apply', args, agent)).rejects.toMatchObject({
    code: 'EDIT_IN_PROGRESS',
  });
  await host.service.updatePresence(
    artifactId,
    {
      peerId: 'human-saving',
      context: {
        artifactId,
        viewId: 'human-saving',
        selectedIds: [],
        editingIds: [],
        movingIds: [],
        savingIds: [],
      },
    },
    host.service.owner,
  );
  const saved = await host.service.execute('artifact_apply', args, agent);
  expect(saved).toMatchObject({ historyEntry: { changedIds: ['item'] } });
  expect(saved).not.toHaveProperty('board');
  const verified = await host.service.execute(
    'artifact_read',
    { artifactId, mode: 'objects', ids: ['item'] },
    agent,
  );
  expect(verified.elements).toMatchObject([{ id: 'item', text: 'Agent result', version: 2 }]);
  await host.service.execute(
    'artifact_activity',
    { artifactId, action: 'end', ...binding, outcome: 'completed' },
    agent,
  );
});

it('retains commit targets and versions when a large canonical unit becomes an invalidation and when it is deleted', async () => {
  const cursor = host.service.cursor();
  await host.service.execute('artifact_apply', {
    artifactId,
    operationId: 'large-handoff',
    operations: [
      {
        op: 'add',
        element: { id: 'large-unit', type: 'html', html: `<div>${'x'.repeat(150000)}</div>` },
      },
    ],
  });
  const added = (await sync(cursor)).events.find((event) => event.operationId === 'large-handoff')!;
  expect(added).toMatchObject({
    type: 'board',
    actorId: host.service.owner.id,
    revision: 1,
    unitVersions: { 'large-unit': 1 },
    invalidation: true,
  });
  expect(added.units).toBeUndefined();
  await host.service.execute('artifact_apply', {
    artifactId,
    operationId: 'delete-handoff',
    expectedVersions: { 'large-unit': 1 },
    operations: [{ op: 'delete', id: 'large-unit' }],
  });
  const deleted = (await sync(added.cursor)).events.find(
    (event) => event.operationId === 'delete-handoff',
  )!;
  expect(deleted).toMatchObject({
    type: 'board',
    actorId: host.service.owner.id,
    revision: 2,
    unitVersions: { 'large-unit': 0 },
    changedIds: expect.arrayContaining(['large-unit', '$order']),
  });
});

describe('HTTP collaboration change transport', () => {
  it('keeps a backpressured ready response open and drains a burst in cursor order', async () => {
    const pressure = holdSseWrite();
    const abort = new AbortController();
    cancellations.push(abort);
    const response = await request(`/api/events?artifactId=${artifactId}`, {
      signal: abort.signal,
    });
    const reader = response.body!.getReader();
    const ready = await frame(reader);
    expect(pressure.response.writableEnded).toBe(false);
    for (let revision = 1; revision <= 64; revision++) {
      emitBoard(revision);
    }

    expect(pressure.writes).toHaveLength(1);
    expect(pressure.response.listenerCount('drain')).toBe(1);
    pressure.drain();
    const ids = [ready.id];
    for (let revision = 1; revision <= 64; revision++) {
      const update = await frame(reader);
      expect(update.data.revision).toBe(revision);
      ids.push(update.id);
    }

    expect(new Set(ids).size).toBe(65);
    expect(pressure.response.writableEnded).toBe(false);
    expect(pressure.response.listenerCount('drain')).toBe(0);
  });

  it('does not resend an accepted backpressured event or write later events before drain', async () => {
    const pressure = holdSseWrite((text) => text.includes('"type":"board"'));
    const abort = new AbortController();
    cancellations.push(abort);
    const response = await request(`/api/events?artifactId=${artifactId}`, {
      signal: abort.signal,
    });
    const reader = response.body!.getReader();
    await frame(reader);
    emitBoard(1);
    expect((await frame(reader)).data.revision).toBe(1);
    emitBoard(2);
    emitBoard(3);
    expect(pressure.response.writableEnded).toBe(false);
    expect(pressure.writes).toHaveLength(2);
    pressure.drain();
    expect((await frame(reader)).data.revision).toBe(2);
    expect((await frame(reader)).data.revision).toBe(3);
    expect(pressure.writes).toHaveLength(4);
  });

  it('waits for drain when a heartbeat encounters temporary backpressure', async () => {
    const original = globalThis.setInterval;
    let heartbeat!: () => void;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((
      callback: () => void,
      delay?: number,
    ) => {
      if (delay === 15_000) {
        heartbeat = callback;
      }

      return original(callback, delay);
    }) as typeof setInterval);
    const pressure = holdSseWrite((text) => text === ': keep-alive\n\n');
    const abort = new AbortController();
    cancellations.push(abort);
    const response = await request(`/api/events?artifactId=${artifactId}`, {
      signal: abort.signal,
    });
    const reader = response.body!.getReader();
    await frame(reader);
    heartbeat();
    emitBoard(1);
    expect(pressure.response.writableEnded).toBe(false);
    expect(pressure.writes).toHaveLength(2);
    pressure.drain();
    expect(pressure.writes).toHaveLength(3);
    expect(pressure.writes[2]).toContain('"revision":1');
  });

  it.each([
    { budget: 'frame count', count: 512, text: 'synthetic' },
    { budget: 'bytes', count: 15, text: 'x'.repeat(64 * 1024) },
  ])('closes only when the pending $budget budget overflows', async ({ count, text }) => {
    const pressure = holdSseWrite();
    const response = await request(`/api/events?artifactId=${artifactId}`, {
      signal: AbortSignal.timeout(3000),
    });
    const reader = response.body!.getReader();
    const ready = await frame(reader);
    for (let revision = 1; revision <= count; revision++) {
      emitBoard(revision, text);
    }

    expect(pressure.response.writableEnded).toBe(false);
    expect(pressure.writes).toHaveLength(1);
    emitBoard(count + 1, text);
    expect(pressure.response.writableEnded).toBe(true);
    expect(pressure.response.listenerCount('drain')).toBe(0);
    pressure.drain();
    expect(pressure.writes).toHaveLength(1);
    expect((await reader.read()).done).toBe(true);
    const replay = await sync(ready.id);
    expect(replay.reset).toBe(true);
    expect(replay.cursor).toBe(host.service.cursor());
  });

  it('drops pending frames and removes drain handlers when a member is removed', async () => {
    const person = await guest('viewer');
    const pressure = holdSseWrite();
    const response = await person.request(
      `/api/events?artifactId=${artifactId}&peerId=removed-pending&peerEpoch=epoch-a`,
      { signal: AbortSignal.timeout(3000) },
    );
    const reader = response.body!.getReader();
    await frame(reader);
    emitBoard(1, 'pending-before-removal');
    await host.service.execute('artifact_share', {
      artifactId,
      action: 'remove',
      memberId: person.actor.id,
    });
    expect((await frame(reader)).data.type).toBe('access-revoked');
    expect((await reader.read()).done).toBe(true);
    expect(pressure.response.listenerCount('drain')).toBe(0);
    const written = pressure.writes.length;
    pressure.drain();
    emitBoard(2, 'after-removal');
    expect(pressure.writes).toHaveLength(written);
    expect(pressure.writes.join('')).not.toContain('pending-before-removal');
  });

  it('cleans pending writes on client disconnect and host close', async () => {
    const pressure = holdSseWrite();
    const abort = new AbortController();
    cancellations.push(abort);
    const response = await request(`/api/events?artifactId=${artifactId}`, {
      signal: abort.signal,
    });
    await frame(response.body!.getReader());
    emitBoard(1);
    const closed = once(pressure.response, 'close');
    abort.abort();
    await closed;
    expect(pressure.response.listenerCount('drain')).toBe(0);
    pressure.drain();
    expect(pressure.writes).toHaveLength(1);
    vi.restoreAllMocks();
    const closing = holdSseWrite();
    const second = await request(`/api/events?artifactId=${artifactId}`);
    const reader = second.body!.getReader();
    await frame(reader);
    emitBoard(2, 'pending-before-close');
    await host.close();
    expect(closing.response.listenerCount('drain')).toBe(0);
    const written = closing.writes.length;
    closing.drain();
    expect(closing.writes).toHaveLength(written);
    expect(closing.writes.join('')).not.toContain('pending-before-close');
    expect((await frame(reader)).data).toMatchObject({
      type: 'access-revoked',
      reason: 'sharing-closed',
    });
    expect((await reader.read()).done).toBe(true);
  });

  it('closes the snapshot-to-subscribe gap with cursor replay and streams incremental units with SSE IDs', async () => {
    const initial = await sync();
    expect(initial.reset).toBe(true);
    const created = await mutate('first');
    const incremental = await sync(initial.cursor);
    expect(incremental.reset).toBe(false);
    expect(incremental.events).toMatchObject([
      {
        type: 'board',
        revision: created.board.artifact.revision,
        units: [
          { id: 'item', after: { text: 'first', version: 1 } },
          { id: '$order', after: { ids: ['item'], version: created.board.orderVersion } },
        ],
      },
    ]);
    const abort = new AbortController();
    cancellations.push(abort);
    const response = await request(
      `/api/events?artifactId=${artifactId}&after=${encodeURIComponent(initial.cursor)}&peerId=web-a&peerEpoch=epoch-a`,
      { signal: abort.signal },
    );
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const reader = response.body!.getReader();
    const ready = await frame(reader);
    expect(ready.data).toMatchObject({
      type: 'ready',
      reset: false,
      peers: [{ peerId: 'web-a', peerEpoch: 'epoch-a' }],
    });
    expect(
      ready.data.events.some(
        (event: any) => event.type === 'board' && event.units?.[0]?.after?.text === 'first',
      ),
    ).toBe(true);
    expect(ready.id).toBe(ready.data.cursor);
    await mutate('second', 1);
    const update = await frame(reader);
    expect(update.data).toMatchObject({ type: 'board', units: [{ id: 'item' }] });
    const changed = update.data.units[0];
    if (changed.patch) {
      expect(changed.patch).toMatchObject({
        baseVersion: 1,
        version: 2,
        changes: { text: 'second' },
        removedKeys: [],
      });
    } else {
      expect(changed.after).toMatchObject({ text: 'second', version: 2 });
    }

    expect(update.id).toBe(update.data.cursor);
    abort.abort();
    const resume = new AbortController();
    cancellations.push(resume);
    const resumed = await request(`/api/events?artifactId=${artifactId}`, {
      headers: { 'Last-Event-ID': incremental.cursor },
      signal: AbortSignal.any([resume.signal, AbortSignal.timeout(3000)]),
    });
    const replay = await frame(resumed.body!.getReader());
    expect(
      replay.data.events.some((event: any) =>
        event.units?.some(
          (unit: any) =>
            unit.id === 'item' &&
            ((unit.after?.text === 'second' && unit.after.version === 2) ||
              (unit.patch?.baseVersion === 1 &&
                unit.patch.version === 2 &&
                unit.patch.changes.text === 'second')),
        ),
      ),
    ).toBe(true);
    resume.abort();
  });

  it('supports cancellable bounded long polls and reconnect reset after a server epoch changes', async () => {
    const initial = await sync();
    const waiting = sync(initial.cursor, '&wait=1000');
    await mutate('arrived');
    expect((await waiting).events.some((event) => event.type === 'board')).toBe(true);
    expect((await sync((await sync()).cursor, '&wait=5')).events).toEqual([]);
    const abort = new AbortController();
    const pending = request(
      `/api/sync?artifactId=${artifactId}&after=${encodeURIComponent((await sync()).cursor)}&wait=20000`,
      { signal: abort.signal },
    );
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect((await request(`/api/sync?artifactId=${artifactId}&wait=20001`)).status).toBe(400);
    const stale = (await sync()).cursor;
    await host.close();
    host = await startStudioHost({ dataRoot: directory });
    expect((await sync(stale)).reset).toBe(true);
    expect((await host.service.execute('artifact_read', { artifactId })).elements).toMatchObject([
      { text: 'arrived' },
    ]);
  });

  it('delivers a commit that occurs after the SSE snapshot was read but before its ready response', async () => {
    const after = (await sync()).cursor;
    const original = host.service.sync.bind(host.service);
    let reads = 0;
    vi.spyOn(host.service, 'sync').mockImplementation(async (...args) => {
      const result = await original(...args);
      if (++reads === 2) {
        await mutate('during-ready');
      }

      return result;
    });
    const abort = new AbortController();
    cancellations.push(abort);
    const response = await request(
      `/api/events?artifactId=${artifactId}&after=${encodeURIComponent(after)}`,
      { signal: abort.signal },
    );
    const reader = response.body!.getReader();
    const ready = await frame(reader);
    const change = await frame(reader);
    expect(ready.data).toMatchObject({ type: 'ready', events: [] });
    expect(change.data).toMatchObject({
      type: 'board',
      units: [
        { id: 'item', after: { text: 'during-ready' } },
        { id: '$order', after: { ids: ['item'], version: 1 } },
      ],
    });
    expect(change.id).not.toBe(ready.id);
    abort.abort();
  });

  it('binds multiple peers to their authenticated person and preserves ordered/null cursor state', async () => {
    const person = await guest('editor');
    const base = { artifactId, peerId: 'guest-a', peerEpoch: 'epoch-a' };
    const post = (input: Record<string, unknown>) =>
      person.request('/api/presence', { method: 'POST', body: JSON.stringify(input) });
    await post({
      ...base,
      peerSeq: 2,
      cursor: { x: 40, y: 50 },
      actor: { id: 'forged', name: 'Forged', role: 'owner', kind: 'agent' },
    });
    const stale = await (await post({ ...base, peerSeq: 1, cursor: { x: 1, y: 1 } })).json();
    expect(stale.accepted).toBe(false);
    expect(stale.peers).toMatchObject([
      { actor: person.actor, cursor: { x: 40, y: 50 }, peerSeq: 2 },
    ]);
    await post({ ...base, peerSeq: 3, cursor: null, visible: false });
    await post({ ...base, peerId: 'guest-b', peerEpoch: 'epoch-b', peerSeq: 0 });
    const peers = (await (await person.request(`/api/presence?artifactId=${artifactId}`)).json())
      .peers;
    expect(peers).toHaveLength(2);
    expect(peers[0]).toMatchObject({ actor: person.actor, cursor: null, visible: false });
    const denied = await request('/api/presence', {
      method: 'POST',
      body: JSON.stringify({ ...base, peerSeq: 100 }),
    });
    expect(denied.status).toBe(403);
  });

  it('keeps ordinary presence and following while removed cursor chat is neither published nor accepted as a room topic', async () => {
    const person = await guest('viewer');
    const base = { artifactId, peerId: 'viewer-chat-removal', peerEpoch: 'epoch-chat-removal' };
    const response = await person.request('/api/presence', {
      method: 'POST',
      body: JSON.stringify({
        ...base,
        peerSeq: 0,
        cursor: { x: 12, y: 34 },
        following: 'editor-page',
        color: '#785ee8',
        visible: true,
        chat: 'removed chat',
        chatExpiresAt: Date.now() + 60_000,
      }),
    });
    expect(response.status).toBe(200);
    const value = (await response.json()).peers.find(
      (peer: { peerId: string }) => peer.peerId === base.peerId,
    );
    expect(value).toMatchObject({
      actor: person.actor,
      cursor: { x: 12, y: 34 },
      following: 'editor-page',
      color: '#785ee8',
      visible: true,
    });
    expect(value).not.toHaveProperty('chat');
    expect(value).not.toHaveProperty('chatExpiresAt');
    const post = (topic: string) =>
      person.request('/api/room', {
        method: 'POST',
        body: JSON.stringify({
          ...base,
          peerSeq: 1,
          events: [{ topic, data: { of: 'editor-page' } }],
        }),
      });
    const rejected = await post('chat');
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error.code).toBe('INVALID_ARGUMENT');
    const followed = await post('follow');
    expect(followed.status).toBe(200);
    expect((await followed.json()).accepted).toBe(1);
  });

  it('checks room roles and wakes/rejects a revoked guest long poll before it can receive later content', async () => {
    const person = await guest('viewer');
    const payload = {
      artifactId,
      peerId: 'viewer-a',
      peerEpoch: 'epoch-a',
      peerSeq: 0,
      events: [{ topic: 'gesture', data: { id: 'drag-a', seq: 1, phase: 'start' } }],
    };
    expect(
      (await person.request('/api/room', { method: 'POST', body: JSON.stringify(payload) })).status,
    ).toBe(403);
    expect(
      (
        await person.request('/api/room', {
          method: 'POST',
          body: JSON.stringify({
            ...payload,
            peerSeq: 1,
            events: [{ topic: 'follow', data: { of: 'editor-a' } }],
          }),
        })
      ).status,
    ).toBe(200);
    const cursor = (await (await person.request(`/api/sync?artifactId=${artifactId}`)).json())
      .cursor;
    const waiting = person.request(
      `/api/sync?artifactId=${artifactId}&after=${encodeURIComponent(cursor)}&wait=20000`,
    );
    await host.service.execute('artifact_share', {
      artifactId,
      action: 'remove',
      memberId: person.actor.id,
    });
    const rejected = await waiting;
    expect([401, 403]).toContain(rejected.status);
    expect((await rejected.json()).error.code).toBe('UNAUTHORIZED');
    expect(
      (
        await person.request('/api/room', {
          method: 'POST',
          body: JSON.stringify({ ...payload, peerSeq: 2 }),
        })
      ).status,
    ).toBe(401);
    expect(
      (await host.service.execute('artifact_read', { artifactId, mode: 'history' })).history,
    ).toHaveLength(1);
  });

  it('rechecks a queued presence actor after member removal before publishing its update', async () => {
    const person = await guest('editor');
    const input = { artifactId, peerId: 'queued-guest', peerEpoch: 'epoch-a', peerSeq: 0 };
    await person.request('/api/presence', { method: 'POST', body: JSON.stringify(input) });
    const collaboration = (host.service as unknown as { collaboration: StudioCollaboration })
      .collaboration;
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const barrier = (
      collaboration as unknown as { serialized<T>(id: string, run: () => Promise<T>): Promise<T> }
    ).serialized(artifactId, () => blocked);
    const original = collaboration.update.bind(collaboration);
    vi.spyOn(collaboration, 'update').mockImplementation((...args) => {
      const task = original(...args);
      entered();

      return task;
    });
    const pending = person.request('/api/presence', {
      method: 'POST',
      body: JSON.stringify({ ...input, peerSeq: 1, cursor: { x: 5, y: 6 } }),
    });

    try {
      await queued;
      await host.service.execute('artifact_share', {
        artifactId,
        action: 'remove',
        memberId: person.actor.id,
      });
      expect(host.service.getPresence(artifactId)).toEqual([]);
    } finally {
      release();
    }

    await barrier;
    expect((await pending).status).toBe(401);
    expect(host.service.getPresence(artifactId)).toEqual([]);
  });

  it('does not connect an already-revoked peer after the first SSE authorization result is delayed', async () => {
    const person = await guest('viewer');
    const original = host.service.sync.bind(host.service);
    let release!: () => void;
    let entered!: () => void;
    let paused = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.spyOn(host.service, 'sync').mockImplementation(async (...args) => {
      const result = await original(...args);
      if (!paused && args[1].peerId === 'revoked-sse') {
        paused = true;
        entered();
        await gate;
      }

      return result;
    });
    const connect = vi.spyOn(host.service, 'connectPeer');
    const pending = person.request(
      `/api/events?artifactId=${artifactId}&peerId=revoked-sse&peerEpoch=epoch-a`,
    );

    try {
      await reached;
      await host.service.execute('artifact_share', {
        artifactId,
        action: 'remove',
        memberId: person.actor.id,
      });
    } finally {
      release();
    }

    const response = await pending;
    await response.text();

    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(response.status).toBe(403);
    expect(connect).not.toHaveBeenCalled();
    expect(host.service.getPresence(artifactId)).toEqual([]);
    const collaboration = (
      host.service as unknown as {
        collaboration: { peers: ArtifactStreams };
      }
    ).collaboration;
    expect(collaboration.peers.get(artifactId)?.get('revoked-sse')?.streams ?? 0).toBe(0);
  });

  it('accumulates timer actions across service instances under the artifact lock and restores them over HTTP', async () => {
    const action = (timer: Record<string, unknown>) =>
      request('/api/presence', { method: 'POST', body: JSON.stringify({ artifactId, timer }) });
    const started = await (await action({ action: 'start', durationSeconds: 60 })).json();
    const other = createStudioService({ dataRoot: directory });
    try {
      const [response] = await Promise.all([
        action({ action: 'adjust', deltaSeconds: 60 }),
        other.updatePresence(
          artifactId,
          { timer: { action: 'adjust', deltaSeconds: 60 } },
          other.owner,
        ),
      ]);
      expect(response.status).toBe(200);
    } finally {
      await other.close();
    }

    await host.close();
    host = await startStudioHost({ dataRoot: directory });
    const recovered = await sync();
    expect(recovered.timer).not.toBeNull();
    expect(Math.abs(recovered.timer!.deadline! - started.timer.deadline - 120_000)).toBeLessThan(
      50,
    );
    expect(recovered.timer!.remainingMs).toBeGreaterThan(175_000);
    expect(recovered.serverTime).toBeLessThanOrEqual(Date.now());
    expect(
      (await host.service.execute('artifact_read', { artifactId, mode: 'history' })).history,
    ).toHaveLength(1);
  });
});
