import { expect, test } from 'vitest';
import {
  createBoardRoomSession,
  type BoardRoomClock,
  type BoardRoomContentChange,
  type BoardRoomEvent,
  type BoardRoomGesturePreview,
  type BoardRoomPresence,
  type BoardRoomService,
  type BoardRoomStreamObserver,
  type BoardRoomTimer,
  type BoardRoomTimerCommand,
  type BoardRoomTimerReply,
} from '../../src/data/rooms/index.js';

const boardId = 'room-board';
const viewId = 'owner-view';
const actorId = 'owner';
const instanceId = 'room-instance';
const serverTimeUnixMs = 1_800_000_000_000;
const initialTimer = {
  version: 0n,
  phase: 'idle',
  durationMs: 60_000,
  remainingMs: 60_000,
} as const;
const start = {
  commandId: 'start-timer',
  expectedVersion: initialTimer.version,
  action: { kind: 'start' },
} as const satisfies BoardRoomTimerCommand;

interface Task {
  readonly at: number;
  readonly perform: () => void;
}

function scheduleRoomClock() {
  let now = 0;
  let sequence = 0;
  const tasks = new Map<number, Task>();
  const clock: BoardRoomClock = {
    now: () => now,
    schedule(delay, perform) {
      sequence += 1;
      const id = sequence;
      tasks.set(id, { at: now + delay, perform });

      return () => {
        tasks.delete(id);
      };
    },
  };

  async function advance(elapsed: number) {
    now += elapsed;
    const due = [...tasks].filter(([, { at }]) => at <= now);
    for (const [id, task] of due) {
      if (tasks.delete(id)) {
        task.perform();
      }
    }
    for (let turn = 0; turn < 5; turn++) {
      await Promise.resolve();
    }
  }

  return { clock, advance };
}

interface StreamProbe extends BoardRoomStreamObserver {
  readonly signal: AbortSignal;
}

interface PresenceUpdate {
  readonly sequence: bigint;
  readonly presence: BoardRoomPresence;
}

function createRoomRig(overrides: Partial<BoardRoomService> = {}, observation?: 'snapshot') {
  const streams: StreamProbe[] = [];
  const updates: PresenceUpdate[] = [];
  const leaving: bigint[] = [];
  const contents: BoardRoomContentChange[] = [];
  let lost = 0;
  const { clock, advance } = scheduleRoomClock();
  const service: BoardRoomService = {
    subscribe(board, view, observer, signal) {
      expect([board, view]).toEqual([boardId, viewId]);
      streams.push({ ...observer, signal });
    },
    async getRoom() {
      throw new Error('A stream reconnect does not request a second snapshot.');
    },
    async updatePresence(_board, _view, sequence, presence) {
      updates.push({ sequence, presence });
      return true;
    },
    async leavePresence(_board, _view, sequence) {
      leaving.push(sequence);
      return true;
    },
    async changeTimer() {
      throw new Error('Unexpected timer write.');
    },
    async getTimerReceipt() {
      return { serverTimeUnixMs };
    },
    ...overrides,
  };
  const session = createBoardRoomSession({ boardId, viewId, clock, service, observation });
  const close = session.open({
    onContentChanged(change) {
      contents.push(change);
    },
    onAccessLost() {
      lost += 1;
    },
  });

  function stream(index = 0) {
    const entry = streams[index];
    if (!entry) {
      throw new Error('Room stream was not opened.');
    }

    return entry;
  }

  return {
    session,
    advance,
    stream,
    streams,
    contents,
    updates,
    leaving,
    lost: () => lost,
    close,
  };
}

function eventHeader(sequence: bigint, stamp = serverTimeUnixMs) {
  return { boardId, instanceId, sequence, serverTimeUnixMs: stamp };
}

function snapshot(
  revision: bigint,
  sequence = 0n,
  canEdit = true,
): Extract<BoardRoomEvent, { kind: 'snapshot' }> {
  return {
    ...eventHeader(sequence),
    kind: 'snapshot',
    actorId,
    revision,
    canEdit,
    participants: [],
    timer: initialTimer,
  };
}

function runningTimer(version: bigint, deadlineUnixMs: number): BoardRoomTimer {
  return { version, phase: 'running', durationMs: 60_000, deadlineUnixMs, remainingMs: 60_000 };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((accept) => {
    resolve = accept;
  });

  return { promise, resolve };
}

test('coalesces visible motion, keeps a room lease alive, and leaves at a higher sequence', async () => {
  const room = createRoomRig();
  room.stream().onEvent(snapshot(0n));
  await room.advance(0);
  expect(room.updates.map(({ sequence }) => sequence)).toEqual([1n]);
  expect(room.session.getSnapshot().status).toBe('online');

  room.session.publishPresence({ cursor: { x: 10, y: 20 }, following: false });
  await room.advance(15);
  room.session.publishPresence({ cursor: { x: 15, y: 25 }, following: false });
  await room.advance(34);
  expect(room.updates).toHaveLength(1);
  await room.advance(1);
  expect(room.updates.at(-1)).toEqual({
    sequence: 2n,
    presence: { cursor: { x: 15, y: 25 }, following: false },
  });

  await room.advance(4999);
  expect(room.updates).toHaveLength(2);
  await room.advance(1);
  expect(room.updates.map(({ sequence }) => sequence)).toEqual([1n, 2n, 3n]);
  room.close();
  expect(room.leaving).toEqual([4n]);
  await room.advance(5000);
  expect(room.updates).toHaveLength(3);
});

test('coalesces temporary geometry with cursor samples and drops it before reconnect', async () => {
  const room = createRoomRig();
  const first = room.stream();
  first.onEvent(snapshot(0n));
  await room.advance(0);
  const geometry = { x: 40, y: 50, width: 200, height: 150, rotation: 0 };
  const gesture = {
    kind: 'resize',
    changes: [{ id: 'note', expectedVersion: 0, geometry }],
  } as const satisfies BoardRoomGesturePreview;
  const latest = {
    ...gesture,
    changes: [{ id: 'note', expectedVersion: 0, geometry: { ...geometry, width: 250 } }],
  };
  room.session.publishPresence({ following: false, gesture });
  await room.advance(25);
  room.session.publishPresence({ following: false, cursor: { x: 55, y: 65 }, gesture: latest });
  await room.advance(25);
  expect(room.updates.at(-1)?.presence).toMatchObject({
    cursor: { x: 55, y: 65 },
    gesture: latest,
  });
  await room.advance(399);
  expect(room.updates).toHaveLength(2);
  await room.advance(1);
  expect(room.updates.at(-1)?.presence.gesture).toEqual(latest);

  first.onDisconnect();
  await room.advance(500);
  room.stream(1).onEvent(snapshot(0n));
  await room.advance(0);
  expect(room.updates.at(-1)?.presence.gesture).toBeUndefined();

  room.close();
});

test('publishes and clears canonical editing targets without waiting for the room heartbeat', async () => {
  const room = createRoomRig();
  room.stream().onEvent(snapshot(0n));
  await room.advance(0);

  room.session.publishPresence({ following: false, editingObjectIds: ['b', 'a', 'b'] });
  await room.advance(50);
  expect(room.updates.at(-1)).toEqual({
    sequence: 2n,
    presence: { following: false, editingObjectIds: ['a', 'b'] },
  });

  room.session.publishPresence({ following: false, editingObjectIds: ['b', 'a'] });
  await room.advance(50);
  expect(room.updates).toHaveLength(2);

  room.session.publishPresence({ following: false, editingObjectIds: [] });
  await room.advance(0);
  expect(room.updates.at(-1)).toEqual({
    sequence: 3n,
    presence: { following: false, editingObjectIds: [] },
  });

  room.close();
});

test('drops old editing presence on a read-only reconnect and preserves the ordinary cursor', async () => {
  const room = createRoomRig();
  const first = room.stream();
  const cursor = { x: 12, y: 30 };
  first.onEvent(snapshot(0n));
  await room.advance(0);
  room.session.publishPresence({ cursor, following: false, editingObjectIds: ['card'] });
  await room.advance(50);
  expect(room.updates.at(-1)?.presence.editingObjectIds).toEqual(['card']);

  first.onDisconnect();
  await room.advance(500);
  room.stream(1).onEvent(snapshot(0n, 0n, false));
  await room.advance(0);
  expect(room.updates.at(-1)?.presence).toMatchObject({ cursor, editingObjectIds: undefined });

  const writes = room.updates.length;
  room.session.publishPresence({ cursor, following: false, editingObjectIds: ['card'] });
  await room.advance(50);
  expect(room.updates).toHaveLength(writes);

  room.close();
});

test('ignores repeats and reconnects on an event gap with only a changed revision of content', async () => {
  const room = createRoomRig();
  const original = room.stream();
  original.onEvent(snapshot(4n, 10n));
  const patch = {
    revision: 5n,
    changedObjectIds: ['shape'],
    removedObjectIds: [],
    refreshScene: false,
  };
  original.onEvent({ ...eventHeader(11n), kind: 'contentChanged', change: patch });
  original.onEvent({ ...eventHeader(11n), kind: 'contentChanged', change: patch });
  expect(room.contents).toEqual([
    { revision: 4n, changedObjectIds: [], removedObjectIds: [], refreshScene: true },
    patch,
  ]);

  original.onEvent({
    ...eventHeader(13n),
    kind: 'timer',
    timer: runningTimer(3n, serverTimeUnixMs + 2000),
  });
  expect(original.signal.aborted).toBe(true);
  expect(room.session.getSnapshot()).toMatchObject({ status: 'reconnecting', canEdit: false });
  original.onEvent(snapshot(90n));

  await room.advance(499);
  expect(room.streams).toHaveLength(1);
  await room.advance(1);
  room.stream(1).onEvent(snapshot(5n, 99n));
  expect(room.contents).toHaveLength(2);
  expect(room.session.getSnapshot()).toMatchObject({
    status: 'online',
    boardRevision: 5n,
    canEdit: true,
  });
  room.close();
});

test('accepts host snapshots across sequence gaps and room restarts without reloading unchanged content', () => {
  const room = createRoomRig({}, 'snapshot');
  const stream = room.stream();
  stream.onEvent(snapshot(4n, 10n));
  stream.onEvent(snapshot(4n, 18n));
  stream.onEvent(snapshot(4n, 18n, false));
  stream.onEvent(snapshot(3n, 17n));
  expect(room.session.getSnapshot()).toMatchObject({
    status: 'online',
    boardRevision: 4n,
    canEdit: false,
  });

  stream.onEvent({ ...snapshot(4n, 0n), instanceId: 'restarted-room', actorId: 'new-owner' });
  expect(room.session.getSnapshot()).toMatchObject({ actorId: 'new-owner', canEdit: true });
  expect(room.contents.map(({ revision }) => revision)).toEqual([4n]);

  stream.onEvent({ ...snapshot(5n, 20n), instanceId: 'restarted-room' });
  expect(room.contents.map(({ revision }) => revision)).toEqual([4n, 5n]);
  expect(room.streams).toHaveLength(1);

  stream.onEvent({ ...snapshot(6n, 30n), boardId: 'different-board' });
  expect(room.session.getSnapshot()).toMatchObject({ status: 'reconnecting', boardRevision: 5n });
  expect(stream.signal.aborted).toBe(true);
  room.close();
});

test('a host snapshot and a restarted room cannot apply out-of-date timer results', async () => {
  const oldRoomRequest = deferred<BoardRoomTimerReply>();
  const newerTimer = runningTimer(2n, serverTimeUnixMs + 60_000);
  const applied = {
    receipt: { kind: 'applied', commandId: start.commandId, timer: newerTimer },
    serverTimeUnixMs,
  } as const;
  const room = createRoomRig(
    {
      changeTimer: (_board, { action }) =>
        action.kind === 'start' ? Promise.resolve(applied) : oldRoomRequest.promise,
    },
    'snapshot',
  );
  const stream = room.stream();
  stream.onEvent(snapshot(0n));
  await room.session.changeTimer(start);
  stream.onEvent(snapshot(0n));
  expect(room.session.getSnapshot().timer).toEqual(newerTimer);

  const pending = room.session.changeTimer({ ...start, action: { kind: 'reset' } });
  stream.onEvent({ ...snapshot(0n), instanceId: 'restarted-room' });
  oldRoomRequest.resolve(applied);
  await expect(pending).rejects.toThrow('房间实例已更新');
  expect(room.session.getSnapshot().timer).toEqual(initialTimer);
  room.close();
});

test('retries a throttled presence after its response without reconnecting the event stream', async () => {
  const sent: PresenceUpdate[] = [];
  const room = createRoomRig({
    async updatePresence(_board, _view, sequence, presence) {
      sent.push({ sequence, presence });
      return sequence > 1n;
    },
  });
  room.stream().onEvent(snapshot(0n));
  await room.advance(0);
  expect(sent.map(({ sequence }) => sequence)).toEqual([1n]);
  expect(room.session.getSnapshot().status).toBe('online');

  room.session.publishPresence({ cursor: { x: 14, y: 28 }, following: false });
  await room.advance(49);
  expect(sent).toHaveLength(1);
  await room.advance(1);
  expect(sent.at(-1)).toEqual({
    sequence: 2n,
    presence: { cursor: { x: 14, y: 28 }, following: false },
  });
  expect(room.streams).toHaveLength(1);
  room.close();
});

test('terminates presence and aborts pending timer writes when access is withdrawn', async () => {
  const request = deferred<BoardRoomTimerReply>();
  let submitted: AbortSignal | undefined;
  const room = createRoomRig({
    async changeTimer(_board, _command, signal) {
      submitted = signal;
      return request.promise;
    },
  });
  const stream = room.stream();
  stream.onEvent(snapshot(0n));
  await room.advance(0);
  const pending = room.session.changeTimer(start);
  stream.onEvent({ ...eventHeader(1n), kind: 'accessLost' });
  expect(room.lost()).toBe(1);
  expect(stream.signal.aborted).toBe(true);
  expect(submitted?.aborted).toBe(true);
  expect(room.session.getSnapshot()).toEqual({
    status: 'accessLost',
    viewId,
    canEdit: false,
    participants: [],
  });
  request.resolve({
    receipt: { kind: 'applied', commandId: start.commandId, timer: initialTimer },
    serverTimeUnixMs,
  });
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await room.advance(10_000);
  expect(room.streams).toHaveLength(1);
  expect(room.updates).toHaveLength(1);
  room.close();
});

test('clock round trips cannot replace a newer timer event with an older receipt', async () => {
  const request = deferred<BoardRoomTimerReply>();
  const room = createRoomRig({ changeTimer: () => request.promise });
  const stream = room.stream();
  stream.onEvent(snapshot(0n));
  const sending = room.session.changeTimer(start);
  await room.advance(100);
  const later = runningTimer(2n, serverTimeUnixMs + 60_000);
  stream.onEvent({ ...eventHeader(1n, serverTimeUnixMs + 40), kind: 'timer', timer: later });
  request.resolve({
    receipt: {
      kind: 'applied',
      commandId: start.commandId,
      timer: runningTimer(1n, serverTimeUnixMs + 60_000),
    },
    serverTimeUnixMs: serverTimeUnixMs + 60,
  });
  await expect(sending).resolves.toMatchObject({ kind: 'applied' });
  expect(room.session.getSnapshot().timer).toEqual(later);
  expect(room.session.now()).toBe(serverTimeUnixMs + 110);
  await room.advance(250);
  expect(room.session.now()).toBe(serverTimeUnixMs + 360);
  room.close();
});

test('receives another view of the same actor without combining its cursor sequence', () => {
  const room = createRoomRig();
  const stream = room.stream();
  const identity = {
    actorId: 'shared-actor',
    expiresAtMillis: serverTimeUnixMs + 18_000,
    role: 'viewer',
    displayName: '同一成员',
    following: false,
  };
  stream.onEvent(snapshot(0n, 0n, false));
  stream.onEvent({
    ...eventHeader(1n),
    kind: 'participants',
    upserts: [
      { ...identity, viewId: 'view-a', sequence: 2n, cursor: { x: 1, y: 2 } },
      { ...identity, viewId: 'view-b', sequence: 1n, cursor: { x: 3, y: 4 } },
    ],
    removals: [],
  });
  stream.onEvent({
    ...eventHeader(2n),
    kind: 'participants',
    upserts: [{ ...identity, viewId: 'view-b', sequence: 2n, cursor: { x: 6, y: 7 } }],
    removals: [{ actorId: identity.actorId, viewId: 'view-a' }],
  });
  expect(room.session.getSnapshot().participants).toMatchObject([
    { actorId: identity.actorId, viewId: 'view-b', cursor: { x: 6, y: 7 } },
  ]);
  room.close();
});
