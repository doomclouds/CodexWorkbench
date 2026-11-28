import {
  BoardRoomService,
  BoardRoomGestureKind,
  type ChangeBoardTimerRequest,
  type UpdateBoardPresenceRequest,
} from '@codexworkbench/luming-studio-ii-contracts/rooms/service';
import type {
  GesturePreview,
  RoomsApplication,
  TimerAction,
} from '../../modules/rooms/application/index.js';
import { HttpRequestError, requireId } from './request.js';
import { agentActivityRoute } from './room-agent-activity.js';
import { eventWire, receiptWire } from './room-route-wire.js';
import { unaryRoute, type RouteEntry } from './unary-route.js';

export { roomEventPath, serveRoomEvents } from './room-route-events.js';

const {
  getBoardRoom,
  updateBoardPresence,
  leaveBoardPresence,
  changeBoardTimer,
  getBoardTimerReceipt,
} = BoardRoomService.method;

function roomId(id: string): string {
  const value = requireId(id);
  if (value.length > 160) {
    throw new HttpRequestError(400, 'Room identifiers are too long');
  }

  return value;
}

function requireVersion(value: bigint | undefined): bigint {
  if (value === undefined) {
    throw new HttpRequestError(400, 'A room sequence or version is required');
  }

  return value;
}

function actionOf(action: ChangeBoardTimerRequest['action']): TimerAction {
  switch (action.case) {
    case 'start':
    case 'pause':
    case 'resume':
    case 'reset':
      return { kind: action.case };
    case 'setDurationMs':
      return { kind: 'setDuration', milliseconds: action.value };
    case 'adjustDurationMs':
      return { kind: 'adjustDuration', milliseconds: action.value };
    case undefined:
      throw new HttpRequestError(400, 'A timer action is required');
  }
}

const gestureKinds = new Map<BoardRoomGestureKind, GesturePreview['kind']>([
  [BoardRoomGestureKind.MOVE, 'move'],
  [BoardRoomGestureKind.RESIZE, 'resize'],
  [BoardRoomGestureKind.ROTATE, 'rotate'],
]);

function readGesture(wire: UpdateBoardPresenceRequest['gesture']): GesturePreview | undefined {
  if (!wire) {
    return;
  }

  const kind = gestureKinds.get(wire.kind);
  if (!kind) {
    throw new HttpRequestError(400, 'Unsupported room gesture');
  }

  return {
    kind,
    changes: wire.changes.map(({ objectId, expectedGeometryVersion, geometry }) => {
      if (!geometry) {
        throw new HttpRequestError(400, 'A room gesture requires object geometry');
      }

      const { x, y, width, height, rotation } = geometry;
      return {
        objectId: roomId(objectId),
        expectedGeometryVersion: requireVersion(expectedGeometryVersion),
        geometry: { x, y, width, height, rotation },
      };
    }),
  };
}

function readPresence(request: UpdateBoardPresenceRequest) {
  const { viewId, sequence, cursor, viewport, following, gesture, editingObjectIds } = request;

  return {
    viewId: roomId(viewId),
    sequence: requireVersion(sequence),
    cursor: cursor && { x: cursor.x, y: cursor.y },
    viewport: viewport && {
      centerX: viewport.centerX,
      centerY: viewport.centerY,
      zoom: viewport.zoom,
      width: viewport.width,
      height: viewport.height,
    },
    following,
    gesture: readGesture(gesture),
    editingObjectIds,
  };
}

export function createRoomRoutes(application: RoomsApplication): readonly RouteEntry[] {
  return [
    agentActivityRoute(application),
    unaryRoute(getBoardRoom, (actor, request) => ({
      event: eventWire(application.snapshot(roomId(request.boardId), actor.id)),
    })),
    unaryRoute(updateBoardPresence, (actor, request) => ({
      accepted: application.publishPresence(
        roomId(request.boardId),
        actor.id,
        readPresence(request),
      ),
    })),
    unaryRoute(leaveBoardPresence, (actor, request) => ({
      accepted: application.leavePresence(
        roomId(request.boardId),
        { actorId: actor.id, viewId: roomId(request.viewId) },
        requireVersion(request.sequence),
      ),
    })),
    unaryRoute(changeBoardTimer, (actor, request) => {
      const result = application.changeTimer(actor.id, {
        boardId: roomId(request.boardId),
        commandId: roomId(request.commandId),
        expectedVersion: requireVersion(request.expectedVersion),
        action: actionOf(request.action),
      });

      return {
        receipt: result.receipt && receiptWire(result.receipt),
        serverTimeUnixMs: BigInt(result.serverTimeUnixMs),
      };
    }),
    unaryRoute(getBoardTimerReceipt, (actor, request) => {
      const result = application.timerReceipt(actor.id, {
        boardId: roomId(request.boardId),
        commandId: roomId(request.commandId),
      });

      return {
        receipt: result.receipt && receiptWire(result.receipt),
        serverTimeUnixMs: BigInt(result.serverTimeUnixMs),
      };
    }),
  ];
}
