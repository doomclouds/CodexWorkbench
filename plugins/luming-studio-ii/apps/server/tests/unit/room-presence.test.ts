import { expect, test } from 'vitest';
import {
  createRoomsApplication,
  type RoomEvent,
} from '../../src/modules/rooms/application/index.js';
import type { RoomReader, RoomRepository } from '../../src/modules/rooms/ports/index.js';

const boardId = 'room-board';
const peer = { actorId: 'editor', viewId: 'tab-1' };

function fixture() {
  let now = 100_000;
  const reader: RoomReader = {
    access: () => ({
      role: 'editor',
      displayName: 'Editor',
      canEdit: true,
      boardRevision: 0n,
    }),
    timer: () => undefined,
    receipt: () => undefined,
  };
  const repository: RoomRepository = {
    read: (work) => work(reader),
    write: () => {
      throw new Error('Presence must avoid durable writes');
    },
  };
  const application = createRoomsApplication(repository, { nowMillis: () => now }, 'instance');
  const events: RoomEvent[] = [];
  const subscription = application.subscribe(boardId, peer, {
    deliver: (event) => {
      events.push(event);
    },
    close: () => undefined,
  });

  return {
    application,
    events,
    subscription,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

test('expires presence, rejects late duplicates and accepts a fresh same-view heartbeat', () => {
  const { application, advance, events, subscription } = fixture();
  expect(subscription.initial).toMatchObject({ sequence: 0n, payload: { kind: 'snapshot' } });

  const active = {
    viewId: peer.viewId,
    sequence: 1n,
    cursor: { x: 40, y: 90 },
    following: false,
  };
  expect(application.publishPresence(boardId, peer.actorId, active)).toBe(true);
  expect(application.publishPresence(boardId, peer.actorId, active)).toBe(false);
  expect(events[0]).toMatchObject({
    sequence: 1n,
    payload: { kind: 'participants', changes: { upserts: [{ key: peer, role: 'editor' }] } },
  });

  advance(18_001);
  application.tick(boardId, 0n);
  expect(events[1]).toMatchObject({
    sequence: 2n,
    payload: { kind: 'participants', changes: { removals: [peer] } },
  });
  expect(application.publishPresence(boardId, peer.actorId, active)).toBe(false);
  expect(application.publishPresence(boardId, peer.actorId, { ...active, sequence: 2n })).toBe(
    true,
  );
  expect(application.leavePresence(boardId, peer, 3n)).toBe(true);
  expect(application.publishPresence(boardId, peer.actorId, { ...active, sequence: 2n })).toBe(
    false,
  );
  expect(application.snapshot(boardId, peer.actorId).payload).toMatchObject({
    kind: 'snapshot',
    snapshot: { participants: [] },
  });

  application.close();
});

test('preserves event watermarks when an earlier listener revokes a view during delivery', () => {
  const { application } = fixture();
  const received: bigint[] = [];
  application.subscribe(boardId, peer, {
    deliver(event) {
      if (event.sequence === 1n) {
        application.revokeView(boardId, peer);
      }
    },
    close: () => undefined,
  });
  application.subscribe(
    boardId,
    { actorId: 'reader', viewId: 'tab-2' },
    {
      deliver(event) {
        received.push(event.sequence);
      },
      close: () => undefined,
    },
  );

  application.publishPresence(boardId, peer.actorId, {
    viewId: peer.viewId,
    sequence: 1n,
    following: false,
  });
  expect(received).toEqual([1n, 2n]);
  application.close();
});
