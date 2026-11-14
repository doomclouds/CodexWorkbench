import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { LOCAL_ACTOR, type Actor, type StudioEvent } from '../src/contracts/studio.js';
import { StudioCollaboration } from '../src/core/shared/collaboration.js';

const editor: Actor = { id: 'editor', name: 'Editor', kind: 'human', role: 'editor' };
const viewer: Actor = { id: 'viewer', name: 'Viewer', kind: 'human', role: 'viewer' };
const instances: StudioCollaboration[] = [], folders: string[] = [];
const create = (dataRoot?: string) => { const instance = new StudioCollaboration({ dataRoot }); instances.push(instance); return instance; };
afterEach(async () => { for (const instance of instances.splice(0)) instance.close(); vi.restoreAllMocks(); vi.useRealTimers(); for (const folder of folders.splice(0)) { if (!resolve(folder).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected test directory'); await rm(folder, { recursive: true, force: true }); } });

describe('bounded collaboration replay and peer ordering', () => {
  it('replays each change after a watermark, resets expired/foreign cursors and drops expired room messages', async () => {
    const collaboration = create(), first = collaboration.cursor();
    collaboration.emit({ type: 'board', artifactId: 'board-a', revision: 2, units: [{ id: 'one', after: { text: 'two' } }] });
    const batch = await collaboration.sync('board-a', { after: first }, LOCAL_ACTOR);
    expect(batch.reset).toBe(false); expect(batch.events).toHaveLength(1); expect(batch.events[0]).toMatchObject({ revision: 2, cursor: batch.cursor, units: [{ id: 'one', after: { text: 'two' } }] });
    expect((await collaboration.sync('board-b', { after: first }, LOCAL_ACTOR)).events).toEqual([]);
    expect((await collaboration.sync('board-a', { after: 'another-process:0' }, LOCAL_ACTOR)).reset).toBe(true);
    for (let index = 0; index < 513; index++) collaboration.emit({ type: 'feedback', artifactId: 'board-a' });
    expect((await collaboration.sync('board-a', { after: first }, LOCAL_ACTOR)).reset).toBe(true);
    const watermark = collaboration.cursor(); collaboration.emit({ type: 'room', artifactId: 'board-a', expiresAt: Date.now() - 1, events: [] });
    expect((await collaboration.sync('board-a', { after: watermark }, LOCAL_ACTOR)).events).toEqual([]);
  });

  it('wakes bounded waits on a change, returns an empty timeout and removes aborted waits', async () => {
    const collaboration = create(), after = collaboration.cursor();
    const waiting = collaboration.sync('board-a', { after, wait: 1000 }, LOCAL_ACTOR);
    collaboration.emit({ type: 'feedback', artifactId: 'board-a' });
    expect((await waiting).events).toHaveLength(1);
    expect((await collaboration.sync('board-a', { after: collaboration.cursor(), wait: 5 }, LOCAL_ACTOR)).events).toEqual([]);
    const abort = new AbortController(), pending = collaboration.sync('board-a', { after: collaboration.cursor(), wait: 20_000, signal: abort.signal }, LOCAL_ACTOR);
    abort.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(collaboration.sync('board-a', { wait: 20_001 }, LOCAL_ACTOR)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('also bounds replay by bytes and leaves oversized content as an invalidation', async () => {
    const collaboration = create(), after = collaboration.cursor();
    for (let index = 0; index < 20; index++) collaboration.emit({ type: 'board', artifactId: 'board-a', units: [{ id: 'item', after: { text: 'x'.repeat(70_000) } }] });
    expect((await collaboration.sync('board-a', { after }, LOCAL_ACTOR)).reset).toBe(true);
    const cursor = collaboration.cursor(); collaboration.emit({ type: 'board', artifactId: 'board-a', revision: 30, units: [{ id: 'item', after: { text: 'x'.repeat(150_000) } }] });
    const batch = await collaboration.sync('board-a', { after: cursor }, LOCAL_ACTOR);
    expect(batch.events).toHaveLength(1); expect(batch.events[0]).toMatchObject({ type: 'board', revision: 30 }); expect(batch.events[0]!.units).toBeUndefined();
  });

  it('keeps modern peer state monotonic and cursor:null clears only the cursor', async () => {
    const collaboration = create(), base = { peerId: 'tab-a', peerEpoch: 'epoch-a' };
    await collaboration.update('board-a', { ...base, peerSeq: 2, cursor: { x: 20, y: 30, t: Date.now() + 1_000_000 }, actor: viewer }, editor);
    const stale = await collaboration.update('board-a', { ...base, peerSeq: 1, cursor: { x: 1, y: 1 } }, editor);
    expect(stale.accepted).toBe(false); expect(stale.peers[0]).toMatchObject({ actor: editor, cursor: { x: 20, y: 30 }, peerSeq: 2 });
    expect(stale.peers[0]!.cursor!.t).toBeLessThanOrEqual(Date.now());
    await expect(collaboration.update('board-a', { peerId: 'tab-a', cursor: { x: 0, y: 0 } }, editor)).rejects.toMatchObject({ code: 'STALE_PEER' });
    await expect(collaboration.update('board-a', { ...base, peerSeq: 3 }, viewer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await collaboration.update('board-a', { ...base, peerSeq: 3, cursor: null, visible: false }, editor);
    expect(collaboration.getPresence('board-a')).toMatchObject([{ peerId: 'tab-a', actor: editor, cursor: null, visible: false }]);
    await collaboration.update('board-a', { peerId: 'tab-b', peerEpoch: 'epoch-b', peerSeq: 0 }, editor);
    expect(collaboration.getPresence('board-a')).toHaveLength(2);
  });

  it('gives disconnected streams a grace period, renews RPC leases and rejects old-epoch leave', async () => {
    vi.useFakeTimers(); const collaboration = create(), base = { peerId: 'tab-a', peerEpoch: 'epoch-a', peerSeq: 0 };
    await collaboration.update('board-a', base, editor);
    const release = collaboration.connectPeer('board-a', 'tab-a', 'epoch-a', editor); release();
    await vi.advanceTimersByTimeAsync(3999); expect(collaboration.getPresence('board-a')).toHaveLength(1);
    await collaboration.sync('board-a', { peerId: 'tab-a', peerEpoch: 'epoch-a' }, editor);
    await vi.advanceTimersByTimeAsync(2); expect(collaboration.getPresence('board-a')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(45_000); expect(collaboration.getPresence('board-a')).toEqual([]);
    await collaboration.sync('board-a', { peerId: 'tab-a', peerEpoch: 'epoch-new' }, editor);
    await collaboration.update('board-a', { ...base, peerEpoch: 'epoch-new', peerSeq: 0 }, editor);
    await expect(collaboration.update('board-a', { ...base, peerSeq: 1, leave: true }, editor)).rejects.toMatchObject({ code: 'STALE_PEER' });
    expect(collaboration.getPresence('board-a')).toMatchObject([{ peerEpoch: 'epoch-new' }]);
    const events: StudioEvent[] = []; collaboration.subscribe('board-a', event => events.push(event));
    const close = collaboration.connectPeer('board-a', 'tab-a', 'epoch-new', editor); close();
    await vi.advanceTimersByTimeAsync(4000); expect(collaboration.getPresence('board-a')).toEqual([]); expect(events.at(-1)).toMatchObject({ type: 'presence', peers: [] });
  });

  it('bounds room traffic, preserves ordered parts, prioritizes end and enforces roles without touching content', () => {
    const collaboration = create(), events: StudioEvent[] = []; collaboration.subscribe('board-a', event => events.push(event));
    const base = { peerId: 'tab-a', peerEpoch: 'epoch-a' }, frame = (seq: number, phase = 'parts') => ({ topic: 'gesture', data: { id: 'drag-a', seq, phase, atoms: [] } });
    expect(collaboration.room('board-a', { ...base, peerSeq: 0, events: [frame(1, 'start'), frame(2), frame(3), frame(4, 'end')] }, editor).accepted).toBe(4);
    expect((events[0]!.events as { data: { seq: number } }[]).map(event => event.data.seq)).toEqual([1, 2, 3, 4]);
    expect(collaboration.room('board-a', { ...base, peerSeq: 1, events: [frame(3, 'step')] }, editor).accepted).toBe(0);
    expect(collaboration.room('board-a', { ...base, peerSeq: 0, events: [frame(100, 'end')] }, editor).accepted).toBe(0);
    expect(() => collaboration.room('board-a', { peerId: 'view', events: [frame(1)] }, viewer)).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(collaboration.room('board-a', { peerId: 'view', events: [{ topic: 'chat', data: { text: 'hello' } }] }, viewer).accepted).toBe(1);
    const many = Array.from({ length: 80 }, (_, index) => ({ topic: 'gesture', data: { id: 'drag-b', seq: index, phase: 'step' } }));
    const overloaded = collaboration.room('board-a', { ...base, peerSeq: 2, events: many }, editor); expect(overloaded.dropped).toBeGreaterThan(0);
    expect(collaboration.room('board-a', { ...base, peerSeq: 3, events: [{ topic: 'gesture', data: { id: 'drag-b', seq: 100, phase: 'end' } }] }, editor).accepted).toBe(1);
  });

  it.each(['room', 'presence'])('does not reserve peer capacity for rejected %s input', async kind => {
    const collaboration = create();
    for (let index = 0; index < 128; index++) {
      const peerId = `rejected-${index}`;
      if (kind === 'room') expect(() => collaboration.room('board-a', { peerId, events: [{ topic: 'gesture', data: { id: 'drag-a', seq: 0, phase: 'start' } }] }, viewer)).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
      else await expect(collaboration.update('board-a', { peerId, context: { artifactId: 'other-board', viewId: peerId, selectedIds: [] } }, viewer)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
    expect(collaboration.getPresence('board-a')).toEqual([]);
    expect((await collaboration.update('board-a', { peerId: 'owner' }, LOCAL_ACTOR)).accepted).toBe(true);
  });

  it('aggregates independent server-registered agents and cannot create their peers through public presence', async () => {
    vi.useFakeTimers(); const collaboration = create(), agent = { ...LOCAL_ACTOR, id: 'model-one', kind: 'agent' as const };
    const endRead = collaboration.beginActivity('board-a', agent, { status: 'reading', selectedIds: ['a'] });
    const endWrite = collaboration.beginActivity('board-a', agent, { status: 'writing', editingIds: ['b'] });
    collaboration.beginActivity('board-a', { ...agent, id: 'model-two' }, { status: 'reading' });
    expect(collaboration.getPresence('board-a')).toHaveLength(2);
    expect(collaboration.getPresence('board-a')[0]).toMatchObject({ actor: agent, context: { activity: 'writing', editingIds: ['b'], selectedIds: ['a'] } });
    endRead(); expect(collaboration.getPresence('board-a')[0]).toMatchObject({ context: { activity: 'writing' } });
    endWrite(); expect(collaboration.getPresence('board-a')).toHaveLength(2);
    expect(collaboration.getPresence('board-a')[0]).toMatchObject({ context: { activity: 'idle', lastActivity: 'writing', editingIds: [], movingIds: [] } });
    await vi.advanceTimersByTimeAsync(19_999); expect(collaboration.getPresence('board-a')).toHaveLength(2);
    const endNew = collaboration.beginActivity('board-a', agent, { status: 'writing', editingIds: ['c'] });
    endWrite(); await vi.advanceTimersByTimeAsync(20_001);
    expect(collaboration.getPresence('board-a')[0]).toMatchObject({ context: { activity: 'writing', editingIds: ['c'] } });
    endNew(); await vi.advanceTimersByTimeAsync(20_000); expect(collaboration.getPresence('board-a')).toHaveLength(1);
    await expect(collaboration.update('board-a', { peerId: 'agent-model-two' }, LOCAL_ACTOR)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('releases bounded room capacity after finished agent idle leases expire', async () => {
    vi.useFakeTimers(); const collaboration = create();
    for (let index = 0; index < 128; index++) collaboration.beginActivity('board-a', { ...LOCAL_ACTOR, id: `model-${index}`, kind: 'agent' }, { status: 'reading' })();
    expect(collaboration.getPresence('board-a')).toHaveLength(128);
    await vi.advanceTimersByTimeAsync(20_000); expect(collaboration.getPresence('board-a')).toEqual([]);
    expect((await collaboration.update('board-a', { peerId: 'human' }, editor)).accepted).toBe(true);
  });
});

describe('durable server-computed room timers', () => {
  it('keeps a corrupt timer observable without publishing a peer that would later fail in a background expiry', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studio-room-timer-corrupt-')); folders.push(directory);
    const folder = join(directory, 'artifacts', 'board-a'); await mkdir(folder, { recursive: true }); await writeFile(join(folder, 'room-timer.json'), '{broken');
    vi.useFakeTimers(); const collaboration = create(directory);
    await expect(collaboration.update('board-a', { peerId: 'tab-a' }, editor)).rejects.toMatchObject({ code: 'CORRUPT_TIMER' });
    expect(collaboration.getPresence('board-a')).toEqual([]); await vi.advanceTimersByTimeAsync(46_000);
    expect(await readFile(join(folder, 'room-timer.json'), 'utf8')).toBe('{broken');
  });

  it('persists actions, accumulates simultaneous adjustments and restores the absolute deadline after restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studio-room-timer-')); folders.push(directory);
    const collaboration = create(directory), now = Date.now(), time = vi.spyOn(Date, 'now').mockReturnValue(now);
    await collaboration.update('board-a', { timer: { action: 'start', durationSeconds: 60 } }, editor);
    await Promise.all([collaboration.update('board-a', { timer: { action: 'adjust', deltaSeconds: 60 } }, editor), collaboration.update('board-a', { timer: { action: 'adjust', deltaSeconds: 60 } }, editor)]);
    expect(collaboration.getTimer('board-a')).toMatchObject({ deadline: now + 180_000, remainingMs: 180_000 });
    const persisted = await readFile(join(directory, 'artifacts', 'board-a', 'room-timer.json'), 'utf8');
    collaboration.close(); time.mockReturnValue(now + 30_000);
    const restarted = create(directory); expect(restarted.getTimer('board-a')).toMatchObject({ deadline: now + 180_000, remainingMs: 150_000 });
    time.mockReturnValue(now + 40_000); restarted.getTimer('board-a');
    expect(await readFile(join(directory, 'artifacts', 'board-a', 'room-timer.json'), 'utf8')).toBe(persisted);
    await expect(restarted.update('board-a', { timer: { action: 'pause' } }, viewer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(restarted.getTimer('board-a')).toMatchObject({ deadline: now + 180_000 });
  });
});
