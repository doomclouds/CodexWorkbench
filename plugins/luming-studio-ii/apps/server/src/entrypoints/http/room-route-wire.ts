import { create, fromBinary, toJson, type MessageInitShape } from '@bufbuild/protobuf';
import {
  BoardRoomEventSchema,
  BoardRoomGestureKind,
  BoardRoomTimerPhase,
  BoardRoomTimerSchema,
  BoardTimerReceiptSchema,
  BoardTimerRejection,
} from '@codexworkbench/luming-studio-ii-contracts/rooms/service';
import { ObjectMetadataSchema } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/scene';
import type {
  GesturePreview,
  Participant,
  RoomEvent,
  RoomEventPayload,
  RoomTimer,
  RoomTimerReceipt,
  TimerRejection,
} from '../../modules/rooms/application/index.js';
import { agentWorkspaceWire } from './room-agent-activity.js';

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

const gestureKinds: Record<GesturePreview['kind'], BoardRoomGestureKind> = {
  move: BoardRoomGestureKind.MOVE,
  resize: BoardRoomGestureKind.RESIZE,
  rotate: BoardRoomGestureKind.ROTATE,
};

function participantWire({
  expiresAtUnixMs,
  activityAtUnixMs,
  gesture,
  gestureExpiresAtUnixMs,
  editingObjectIds,
  ...participant
}: Participant) {
  return {
    ...participant,
    expiresAtUnixMs: BigInt(expiresAtUnixMs),
    activityAtUnixMs: activityAtUnixMs === undefined ? undefined : BigInt(activityAtUnixMs),
    gesture: gesture && { kind: gestureKinds[gesture.kind], changes: [...gesture.changes] },
    gestureExpiresAtUnixMs:
      gestureExpiresAtUnixMs === undefined ? undefined : BigInt(gestureExpiresAtUnixMs),
    editingObjectIds: editingObjectIds && [...editingObjectIds],
  };
}

type WireEvent = MessageInitShape<typeof BoardRoomEventSchema>;
type WirePayload = NonNullable<WireEvent['payload']>;

function payloadWire(payload: RoomEventPayload): WirePayload {
  switch (payload.kind) {
    case 'snapshot': {
      const {
        actorId,
        canEdit,
        boardRevision,
        participants,
        timer,
        agentWorkspaces,
        canReleaseAgentActivity,
        feedbackVersion,
        suggestionsVersion,
      } = payload.snapshot;

      return {
        case: 'snapshot',
        value: {
          actorId,
          canEdit,
          boardRevision,
          participants: participants.map(participantWire),
          timer: timerWire(timer),
          agentWorkspaces: agentWorkspaces.map(agentWorkspaceWire),
          canReleaseAgentActivity,
          feedbackVersion,
          suggestionsVersion,
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
    case 'agentWorkspaces':
      return {
        case: 'agentWorkspaces',
        value: { workspaces: payload.workspaces.map(agentWorkspaceWire) },
      };
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
    case 'feedbackChanged':
      return { case: 'feedbackChanged', value: { version: payload.version } };
    case 'suggestionsChanged':
      return { case: 'suggestionsChanged', value: { version: payload.version } };
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

export function compactPayload(event: RoomEvent): RoomEventPayload {
  const { payload } = event;
  if (payload.kind === 'contentChanged') {
    return {
      kind: 'contentChanged',
      change: {
        boardId: event.boardId,
        boardRevision: payload.change.boardRevision,
        refreshScene: true,
      },
    };
  }

  if (payload.kind === 'snapshot') {
    const participants = payload.snapshot.participants.map((participant) => ({
      ...participant,
      gesture: undefined,
      gestureExpiresAtUnixMs: undefined,
    }));

    return { kind: 'snapshot', snapshot: { ...payload.snapshot, participants } };
  }

  return payload;
}

export function eventFrame(event: RoomEvent): string {
  const cached = encodedFrames.get(event);
  if (cached !== undefined) {
    return cached;
  }

  const full = encodeFrame(event);
  const considered =
    full.length > maximumFrameCharacters
      ? encodeFrame({ ...event, payload: compactPayload(event) })
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
