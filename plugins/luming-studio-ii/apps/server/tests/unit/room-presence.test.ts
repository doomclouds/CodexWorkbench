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
    access: (_boardId, actorId) => ({
      role: actorId === 'owner' ? 'owner' : 'editor',
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

test('replaces the editing targets with each accepted presence sample without a durable write', () => {
  const { application, advance, events } = fixture();
  const sample = {
    viewId: peer.viewId,
    sequence: 1n,
    following: false,
    editingObjectIds: ['note-b', 'note-a', 'note-b'],
  };
  expect(application.publishPresence(boardId, peer.actorId, sample)).toBe(true);
  expect(events[0]?.payload).toMatchObject({
    kind: 'participants',
    changes: { upserts: [{ editingObjectIds: ['note-a', 'note-b'] }] },
  });
  expect(application.snapshot(boardId, peer.actorId).payload).toMatchObject({
    kind: 'snapshot',
    snapshot: { participants: [{ editingObjectIds: ['note-a', 'note-b'] }] },
  });

  advance(50);
  expect(
    application.publishPresence(boardId, peer.actorId, {
      ...sample,
      sequence: 2n,
      editingObjectIds: [],
    }),
  ).toBe(true);
  expect(application.publishPresence(boardId, peer.actorId, sample)).toBe(false);
  expect(events.at(-1)?.payload).toMatchObject({
    kind: 'participants',
    changes: { upserts: [{ editingObjectIds: undefined }] },
  });

  application.close();
});

test('keeps private suggestion events and their watermarks out of public room traffic', () => {
  const { application, events } = fixture();
  const ownerEvents: RoomEvent[] = [];
  const ownerId = 'owner';
  const owner = application.subscribe(
    boardId,
    { actorId: ownerId, viewId: 'owner-tab' },
    {
      deliver: (event) => ownerEvents.push(event),
      close: () => undefined,
    },
  );
  const guestStart = application.snapshot(boardId, peer.actorId);
  expect(guestStart.roomInstanceId).not.toBe(owner.initial.roomInstanceId);

  application.publishDiscussionChange(boardId, 'suggestionsChanged');
  expect(application.snapshot(boardId, peer.actorId)).toEqual(guestStart);
  application.publishDiscussionChange(boardId, 'feedbackChanged');

  expect(ownerEvents.map(({ sequence, payload }) => [sequence, payload.kind])).toEqual([
    [1n, 'suggestionsChanged'],
    [2n, 'feedbackChanged'],
  ]);
  expect(events.map(({ sequence, payload }) => [sequence, payload.kind])).toEqual([
    [1n, 'feedbackChanged'],
  ]);
  expect(application.snapshot(boardId, ownerId).payload).toMatchObject({
    kind: 'snapshot',
    snapshot: { feedbackVersion: 1n, suggestionsVersion: 1n },
  });
  expect(application.snapshot(boardId, peer.actorId).payload).toMatchObject({
    kind: 'snapshot',
    snapshot: { feedbackVersion: 1n, suggestionsVersion: undefined },
  });
  application.close();
});

test('marks view movement without letting a background heartbeat claim activity', () => {
  const { application, advance } = fixture();
  const active = { viewId: peer.viewId, sequence: 1n, cursor: { x: 40, y: 90 }, following: false };
  application.publishPresence(boardId, peer.actorId, active);
  advance(100);
  application.publishPresence(boardId, peer.actorId, { ...active, sequence: 2n });
  expect(application.snapshot(boardId, peer.actorId).payload).toMatchObject({
    kind: 'snapshot',
    snapshot: { participants: [{ activityAtUnixMs: 100_000, expiresAtUnixMs: 118_100 }] },
  });
  advance(100);
  application.publishPresence(boardId, peer.actorId, {
    ...active,
    sequence: 3n,
    cursor: { x: 50, y: 90 },
  });
  expect(application.snapshot(boardId, peer.actorId).payload).toMatchObject({
    kind: 'snapshot',
    snapshot: { participants: [{ activityAtUnixMs: 100_200 }] },
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

test('replays only an authorized lane and falls back to a snapshot after the replay window', () => {
  const { application, subscription } = fixture();
  const owner = { actorId: 'owner', viewId: 'owner-tab' };
  const ownerStart = application.snapshot(boardId, owner.actorId);
  const publicStart = subscription.initial;
  const listener = { deliver: () => undefined, close: () => undefined };

  application.publishDiscussionChange(boardId, 'suggestionsChanged');
  application.publishDiscussionChange(boardId, 'feedbackChanged');

  const ownerReplay = application.subscribeAfter(boardId, owner, ownerStart, listener);
  expect(ownerReplay.events.map(({ sequence, payload }) => [sequence, payload.kind])).toEqual([
    [1n, 'suggestionsChanged'],
    [2n, 'feedbackChanged'],
  ]);
  ownerReplay.release();
  const publicReplay = application.subscribeAfter(boardId, peer, publicStart, listener);
  expect(publicReplay.events.map(({ sequence, payload }) => [sequence, payload.kind])).toEqual([
    [1n, 'feedbackChanged'],
  ]);
  publicReplay.release();

  const wrongLane = application.subscribeAfter(boardId, peer, ownerStart, listener);
  expect(wrongLane.events).toMatchObject([
    { roomInstanceId: publicStart.roomInstanceId, payload: { kind: 'snapshot' } },
  ]);
  wrongLane.release();

  for (let index = 0; index < 33; index++) {
    application.publishDiscussionChange(boardId, 'feedbackChanged');
  }
  const expired = application.subscribeAfter(boardId, peer, publicStart, listener);
  expect(expired.events).toMatchObject([{ sequence: 34n, payload: { kind: 'snapshot' } }]);
  expired.release();
  application.close();
});
