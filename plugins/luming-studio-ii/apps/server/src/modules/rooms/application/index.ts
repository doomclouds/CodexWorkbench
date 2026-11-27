import {
  initialTimer,
  timerView,
  validPresence,
  validViewId,
  type ParticipantKey,
  type PresenceInput,
  type RoomAccess,
  type RoomContentChange,
  type RoomEvent,
  type RoomTimerReceipt,
  type TimerCommand,
  type TimerCommandKey,
} from '../domain/index.js';
import type { RoomClock, RoomRepository } from '../ports/index.js';
import { RoomMemory, type RoomListener } from './room-memory.js';
import { executeTimerChange } from './timer-commands.js';

export type {
  Participant,
  ParticipantKey,
  RoomAccess,
  RoomContentChange,
  RoomEvent,
  RoomEventPayload,
  RoomTimer,
  RoomTimerPhase,
  RoomTimerReceipt,
  TimerAction,
  TimerCommand,
  TimerCommandKey,
  TimerRejection,
} from '../domain/index.js';

const maxRooms = 128;
const maxChangedIds = 512;
const maxChangedMetadataBytes = 48 * 1024;

interface RoomSubscription {
  readonly initial: RoomEvent;
  readonly access: RoomAccess;
  readonly release: () => void;
}

interface RoomTimerReply {
  readonly receipt?: RoomTimerReceipt;
  readonly serverTimeUnixMs: number;
}

export interface RoomsApplication {
  snapshot(boardId: string, actorId: string): RoomEvent;
  access(boardId: string, actorId: string): RoomAccess | undefined;
  publishPresence(boardId: string, actorId: string, input: PresenceInput): boolean;
  leavePresence(boardId: string, key: ParticipantKey, sequence: bigint): boolean;
  subscribe(boardId: string, key: ParticipantKey, listener: RoomListener): RoomSubscription;
  tick(boardId: string, boardRevision: bigint): void;
  notifyAccessChanged(boardId: string): void;
  revokeView(boardId: string, key: ParticipantKey): void;
  changeTimer(actorId: string, command: TimerCommand): RoomTimerReply;
  timerReceipt(actorId: string, key: TimerCommandKey): RoomTimerReply;
  publishContentChange(change: RoomContentChange): void;
  close(): void;
}

export class RoomAccessError extends Error {}

export class RoomInputError extends Error {}

export class RoomCapacityError extends Error {}

function requireAccess(access: RoomAccess | undefined): RoomAccess {
  if (!access) {
    throw new RoomAccessError('Room access is unavailable');
  }

  return access;
}

function limitedChange(change: RoomContentChange): RoomContentChange {
  const {
    boardId,
    boardRevision,
    changedObjectIds = [],
    removedObjectIds = [],
    changedObjects = [],
  } = change;
  const changedBytes = changedObjects.reduce((sum, value) => sum + value.byteLength, 0);
  const tooManyIds = changedObjectIds.length + removedObjectIds.length > maxChangedIds;
  const incomplete = changedObjectIds.length !== changedObjects.length;
  const tooLarge = changedBytes > maxChangedMetadataBytes || tooManyIds;
  const refreshScene = change.refreshScene || tooLarge || incomplete;

  return refreshScene
    ? { boardId, boardRevision, refreshScene: true }
    : { boardId, boardRevision, changedObjectIds, removedObjectIds, changedObjects };
}

export function createRoomsApplication(
  repository: RoomRepository,
  clock: RoomClock,
  instanceId: string,
): RoomsApplication {
  const rooms = new Map<string, RoomMemory>();
  let instances = 0;

  function roomFor(boardId: string, revision: bigint, now: number): RoomMemory {
    const existing = rooms.get(boardId);
    if (existing) {
      return existing;
    }

    if (rooms.size >= maxRooms) {
      for (const [id, room] of rooms) {
        room.sweep(now);
        if (!room.active) {
          rooms.delete(id);
        }
      }
    }

    if (rooms.size >= maxRooms) {
      throw new RoomCapacityError('Too many active board rooms');
    }

    const room = new RoomMemory(boardId, instanceId + ':' + ++instances, revision);
    rooms.set(boardId, room);

    return room;
  }

  function access(boardId: string, actorId: string): RoomAccess | undefined {
    return repository.read((reader) => reader.access(boardId, actorId));
  }

  function readSnapshot(boardId: string, actorId: string, now: number) {
    const stored = repository.read((reader) => ({
      access: requireAccess(reader.access(boardId, actorId)),
      timer: reader.timer(boardId) ?? initialTimer,
    }));
    const room = roomFor(boardId, stored.access.boardRevision, now);
    room.sweep(now);

    const event = room.event(
      {
        kind: 'snapshot',
        snapshot: {
          actorId,
          canEdit: stored.access.canEdit,
          boardRevision: stored.access.boardRevision,
          participants: room.snapshot(),
          timer: timerView(stored.timer, now),
        },
      },
      now,
    );

    return { room, event, access: stored.access };
  }

  function publishContentChange(change: RoomContentChange): void {
    const room = rooms.get(change.boardId);
    if (!room || change.boardRevision <= room.baselineRevision) {
      return;
    }

    room.baselineRevision = change.boardRevision;
    room.publish({ kind: 'contentChanged', change: limitedChange(change) }, clock.nowMillis());
  }

  return {
    snapshot: (boardId, actorId) => readSnapshot(boardId, actorId, clock.nowMillis()).event,
    access,
    publishPresence(boardId, actorId, input) {
      const authorized = requireAccess(access(boardId, actorId));
      if (!validPresence(input)) {
        throw new RoomInputError('Invalid room presence');
      }

      const now = clock.nowMillis();
      const room = roomFor(boardId, authorized.boardRevision, now);

      return room.update(actorId, input, authorized, now);
    },
    leavePresence(boardId, key, sequence) {
      const authorized = requireAccess(access(boardId, key.actorId));
      if (!validViewId(key.viewId) || sequence <= 0n) {
        throw new RoomInputError('Invalid room presence identity');
      }

      const now = clock.nowMillis();

      return roomFor(boardId, authorized.boardRevision, now).leave(key, sequence, now);
    },
    subscribe(boardId, key, listener) {
      if (!validViewId(key.viewId)) {
        throw new RoomInputError('Invalid room presence identity');
      }

      const { room, event, access } = readSnapshot(boardId, key.actorId, clock.nowMillis());
      const release = room.listen(listener);
      if (!release) {
        throw new RoomCapacityError('Too many room connections');
      }

      return { initial: event, access, release };
    },
    tick(boardId, boardRevision) {
      rooms.get(boardId)?.sweep(clock.nowMillis());
      publishContentChange({ boardId, boardRevision, refreshScene: true });
    },
    notifyAccessChanged(boardId) {
      rooms.get(boardId)?.recheck();
    },
    revokeView(boardId, key) {
      rooms.get(boardId)?.revoke(key, clock.nowMillis());
    },
    changeTimer(actorId, command) {
      const now = clock.nowMillis();
      const { changed, receipt } = executeTimerChange(repository, actorId, command, now);
      if (changed && receipt.outcome.kind === 'applied') {
        rooms.get(command.boardId)?.publish({ kind: 'timer', timer: receipt.outcome.timer }, now);
      }

      return { receipt, serverTimeUnixMs: now };
    },
    timerReceipt(actorId, key) {
      const receipt = repository.read((reader) => {
        const current = requireAccess(reader.access(key.boardId, actorId));

        return current.canEdit ? reader.receipt(actorId, key)?.receipt : undefined;
      });

      return { receipt, serverTimeUnixMs: clock.nowMillis() };
    },
    publishContentChange,
    close() {
      for (const room of rooms.values()) {
        room.close();
      }

      rooms.clear();
    },
  };
}
