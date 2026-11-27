import { create, fromBinary, toJson, type MessageInitShape } from '@bufbuild/protobuf';
import {
  BoardRoomEventSchema,
  BoardRoomTimerPhase,
  BoardRoomTimerSchema,
  BoardTimerReceiptSchema,
  BoardTimerRejection,
} from '@codexworkbench/luming-studio-ii-contracts/rooms/service';
import { ObjectMetadataSchema } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/scene';
import type {
  Participant,
  RoomEvent,
  RoomEventPayload,
  RoomTimer,
  RoomTimerReceipt,
  TimerRejection,
} from '../../modules/rooms/application/index.js';

const phases: Record<RoomTimer['phase'], BoardRoomTimerPhase> = {
  idle: BoardRoomTimerPhase.IDLE,
  running: BoardRoomTimerPhase.RUNNING,
  paused: BoardRoomTimerPhase.PAUSED,
  ended: BoardRoomTimerPhase.ENDED,
};

const rejections: Record<TimerRejection, BoardTimerRejection> = {
  forbidden: BoardTimerRejection.FORBIDDEN,
  invalidAction: BoardTimerRejection.INVALID_ACTION,
  commandIdReuse: BoardTimerRejection.COMMAND_ID_REUSE,
};

const encodedFrames = new WeakMap<RoomEvent, string>();
const maximumFrameCharacters = 128 * 1024;

function timerWire({
  version,
  phase,
  durationMs,
  deadlineUnixMs,
  remainingMs,
}: RoomTimer): MessageInitShape<typeof BoardRoomTimerSchema> {
  return {
    version,
    phase: phases[phase],
    durationMs,
    deadlineUnixMs: deadlineUnixMs === undefined ? undefined : BigInt(deadlineUnixMs),
    remainingMs,
  };
}

function participantWire(participant: Participant) {
  return { ...participant, expiresAtUnixMs: BigInt(participant.expiresAtUnixMs) };
}

type WireEvent = MessageInitShape<typeof BoardRoomEventSchema>;
type WirePayload = NonNullable<WireEvent['payload']>;

function payloadWire(payload: RoomEventPayload): WirePayload {
  switch (payload.kind) {
    case 'snapshot': {
      const { actorId, canEdit, boardRevision, participants, timer } = payload.snapshot;

      return {
        case: 'snapshot',
        value: {
          actorId,
          canEdit,
          boardRevision,
          participants: participants.map(participantWire),
          timer: timerWire(timer),
        },
      };
    }
    case 'participants': {
      const { upserts, removals } = payload.changes;

      return {
        case: 'participants',
        value: { upserts: upserts.map(participantWire), removals: [...removals] },
      };
    }
    case 'timer':
      return { case: 'timer', value: timerWire(payload.timer) };
    case 'contentChanged': {
      const { boardRevision, changedObjectIds, removedObjectIds, changedObjects, refreshScene } =
        payload.change;

      return {
        case: 'contentChanged',
        value: {
          boardRevision,
          changedObjectIds: [...(changedObjectIds ?? [])],
          removedObjectIds: [...(removedObjectIds ?? [])],
          changedObjects: changedObjects?.map((object) => fromBinary(ObjectMetadataSchema, object)),
          refreshScene,
        },
      };
    }
    case 'accessLost':
      return { case: 'accessLost', value: {} };
  }
}

export function eventWire(event: RoomEvent): WireEvent {
  const { boardId, roomInstanceId, sequence, serverTimeUnixMs, payload } = event;

  return {
    boardId,
    roomInstanceId,
    sequence,
    serverTimeUnixMs: BigInt(serverTimeUnixMs),
    payload: payloadWire(payload),
  };
}

function encodeFrame(event: RoomEvent): string {
  const wire = create(BoardRoomEventSchema, eventWire(event));
  const data = JSON.stringify(toJson(BoardRoomEventSchema, wire));

  return 'id: ' + event.sequence + '\ndata: ' + data + '\n\n';
}

export function eventFrame(event: RoomEvent): string {
  const cached = encodedFrames.get(event);
  if (cached !== undefined) {
    return cached;
  }

  const full = encodeFrame(event);
  const payload = event.payload;
  const compact = full.length > maximumFrameCharacters && payload.kind === 'contentChanged';
  const considered = compact
    ? encodeFrame({
        ...event,
        payload: {
          kind: 'contentChanged',
          change: {
            boardId: event.boardId,
            boardRevision: payload.change.boardRevision,
            refreshScene: true,
          },
        },
      })
    : full;
  encodedFrames.set(event, considered);

  return considered;
}

export function receiptWire({
  boardId,
  commandId,
  outcome,
}: RoomTimerReceipt): MessageInitShape<typeof BoardTimerReceiptSchema> {
  switch (outcome.kind) {
    case 'applied':
    case 'conflict':
      return {
        boardId,
        commandId,
        outcome: { case: outcome.kind, value: { timer: timerWire(outcome.timer) } },
      };
    case 'rejected':
      return {
        boardId,
        commandId,
        outcome: { case: 'rejected', value: { reason: rejections[outcome.reason] } },
      };
  }
}
