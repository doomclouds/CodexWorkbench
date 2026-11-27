import { fromJsonString, type MessageInitShape } from '@bufbuild/protobuf';
import {
  BoardRoomEventSchema,
  BoardRoomGestureKind,
  BoardRoomService,
  BoardRoomTimerPhase,
  BoardTimerRejection,
  type BoardRoomEvent,
  type ChangeBoardTimerRequestSchema,
} from '@codexworkbench/luming-studio-ii-contracts/rooms/service';
import { WhiteboardService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { expect, test } from 'vitest';
import {
  actorHeader,
  callWhiteboard,
  sendWhiteboardRequest,
} from '../support/whiteboard-client.js';
import {
  editorId,
  mainBoardId,
  secondBoardId,
  shapeId,
  teammateId,
  viewerId,
} from '../support/whiteboard-database.js';
import { makeRoomMemberReadOnly, rejectRoomTimerReceipts } from '../support/rooms-database.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

type TimerAction = MessageInitShape<typeof ChangeBoardTimerRequestSchema>['action'];

const server = useWhiteboardTestServer();
const {
  getBoardRoom,
  updateBoardPresence,
  leaveBoardPresence,
  changeBoardTimer,
  getBoardTimerReceipt,
} = BoardRoomService.method;
const viewId = 'tab-2';
const scope = { boardId: mainBoardId };
const extras = {
  cursor: { x: 25, y: 35 },
  viewport: { centerX: 40, centerY: 55, width: 640, height: 480, zoom: 1 },
  following: true,
};
const frameSeparator = '\n\n';
const dataPrefix = 'data: ';
const gesture = {
  kind: BoardRoomGestureKind.RESIZE,
  changes: [
    {
      objectId: shapeId,
      expectedGeometryVersion: 0n,
      geometry: { x: 50, y: 60, width: 400, height: 300, rotation: 0 },
    },
  ],
};

function streamUrl(boardId: string, viewId: string): URL {
  const url = new URL('/studio-room-events', server.address);
  url.searchParams.set('boardId', boardId);
  url.searchParams.set('viewId', viewId);

  return url;
}

function frameEvent(frame: string): BoardRoomEvent | undefined {
  const line = frame.split('\n').find((value) => value.startsWith(dataPrefix));

  return line === undefined
    ? undefined
    : fromJsonString(BoardRoomEventSchema, line.slice(dataPrefix.length));
}

async function openRoom(actorId: string, tabId: string) {
  const response = await fetch(streamUrl(mainBoardId, tabId), {
    headers: { [actorHeader]: actorId },
    signal: AbortSignal.timeout(4_500),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toMatch(/^text\/event-stream/);

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Room stream must include a readable body');
  }

  const body = reader;
  const decoder = new TextDecoder();
  let pending = '';

  function takeEvent(): BoardRoomEvent | undefined {
    let delimiter = pending.indexOf(frameSeparator);
    while (delimiter >= 0) {
      const frame = pending.slice(0, delimiter);
      pending = pending.slice(delimiter + frameSeparator.length);
      const event = frameEvent(frame);
      if (event) {
        return event;
      }

      delimiter = pending.indexOf(frameSeparator);
    }
  }

  async function next(): Promise<BoardRoomEvent | undefined> {
    let event = takeEvent();
    while (!event) {
      const part = await body.read();
      if (part.done) {
        return undefined;
      }

      pending += decoder.decode(part.value, { stream: true });
      event = takeEvent();
    }

    return event;
  }

  return { next, close: () => body.cancel() };
}

function updatePresence(sequence: bigint) {
  return callWhiteboard(server.address, teammateId, updateBoardPresence, {
    ...scope,
    viewId,
    sequence,
    ...extras,
  });
}

function timerAs(actorId: string, commandId: string, version: bigint, action: TimerAction) {
  return callWhiteboard(server.address, actorId, changeBoardTimer, {
    ...scope,
    commandId,
    expectedVersion: version,
    action,
  });
}

test('streams a snapshot, viewport deltas and ordered departure to board members', async () => {
  const stream = await openRoom(editorId, 'tab-1');
  try {
    const initial = await stream.next();
    expect(initial?.payload).toMatchObject({
      case: 'snapshot',
      value: { actorId: editorId, canEdit: true, participants: [] },
    });

    expect((await updatePresence(1n)).accepted).toBe(true);
    const added = await stream.next();
    expect(added).toMatchObject({
      roomInstanceId: initial?.roomInstanceId,
      sequence: 1n,
      payload: {
        case: 'participants',
        value: { upserts: [{ key: { actorId: teammateId, viewId }, sequence: 1n, ...extras }] },
      },
    });
    expect((await updatePresence(1n)).accepted).toBe(false);

    const current = await callWhiteboard(server.address, editorId, getBoardRoom, scope);
    expect(current.event?.payload).toMatchObject({
      case: 'snapshot',
      value: { participants: [{ key: { actorId: teammateId, viewId } }] },
    });

    const departed = await callWhiteboard(server.address, teammateId, leaveBoardPresence, {
      ...scope,
      viewId,
      sequence: 2n,
    });
    expect(departed.accepted).toBe(true);
    expect(await stream.next()).toMatchObject({
      sequence: 2n,
      payload: { case: 'participants', value: { removals: [{ actorId: teammateId, viewId }] } },
    });
  } finally {
    await stream.close();
  }
});

test('publishes authorized transient gestures without writing scene state and clears the departed view', async () => {
  const stream = await openRoom(editorId, 'observer');
  try {
    const original = await callWhiteboard(
      server.address,
      editorId,
      WhiteboardService.method.getBoardScene,
      scope,
    );
    await stream.next();
    const input = { ...scope, viewId, sequence: 1n, gesture };
    const accepted = await callWhiteboard(server.address, teammateId, updateBoardPresence, input);
    expect(accepted.accepted).toBe(true);

    const frame = await stream.next();
    expect(frame?.payload).toMatchObject({
      case: 'participants',
      value: { upserts: [{ key: { actorId: teammateId, viewId }, gesture }] },
    });

    if (frame?.payload.case === 'participants') {
      const deadline = frame.payload.value.upserts[0]?.gestureExpiresAtUnixMs;
      expect(Number(deadline) - Number(frame.serverTimeUnixMs)).toBe(1200);
    }

    const unchanged = await callWhiteboard(
      server.address,
      editorId,
      WhiteboardService.method.getBoardScene,
      scope,
    );
    expect(unchanged).toEqual(original);
    await callWhiteboard(server.address, teammateId, leaveBoardPresence, {
      ...scope,
      viewId,
      sequence: 2n,
    });
    expect((await stream.next())?.payload).toMatchObject({
      case: 'participants',
      value: { removals: [{ actorId: teammateId, viewId }] },
    });
  } finally {
    await stream.close();
  }
});

test('rejects gesture publication by a viewer and malformed or oversized geometry', async () => {
  const valid = { ...scope, viewId, sequence: 1n, gesture };
  const denied = await sendWhiteboardRequest(server.address, viewerId, updateBoardPresence, valid);
  expect(denied.status).toBe(403);

  const changes = Array.from({ length: 33 }, (_, index) => ({
    ...gesture.changes[0],
    objectId: 'preview-' + index,
  }));
  const oversized = await sendWhiteboardRequest(server.address, editorId, updateBoardPresence, {
    ...valid,
    gesture: { ...gesture, changes },
  });
  expect(oversized.status).toBe(400);

  const duplicate = await sendWhiteboardRequest(server.address, editorId, updateBoardPresence, {
    ...valid,
    gesture: { ...gesture, changes: [...gesture.changes, ...gesture.changes] },
  });
  expect(duplicate.status).toBe(400);
});

test('closes the old stream on role downgrade and denies another board', async () => {
  const forbidden = await fetch(streamUrl(secondBoardId, viewId), {
    headers: { [actorHeader]: viewerId },
    signal: AbortSignal.timeout(3_000),
  });
  expect(forbidden.status).toBe(403);

  const stream = await openRoom(editorId, 'tab-1');
  try {
    const initial = await stream.next();
    expect(initial?.payload.case).toBe('snapshot');

    makeRoomMemberReadOnly(server.databasePath, editorId);
    const terminal = await stream.next();
    expect(terminal).toMatchObject({
      sequence: 1n,
      roomInstanceId: initial?.roomInstanceId,
      payload: { case: 'accessLost' },
    });
    expect(await stream.next()).toBeUndefined();

    const renewed = await callWhiteboard(server.address, editorId, getBoardRoom, scope);
    expect(renewed.event?.payload).toMatchObject({ case: 'snapshot', value: { canEdit: false } });
  } finally {
    await stream.close();
  }
});

test('restarts with a fresh room instance and closes streams without retaining presence', async () => {
  expect((await updatePresence(1n)).accepted).toBe(true);
  const stream = await openRoom(editorId, 'tab-restart');
  try {
    const active = await stream.next();
    expect(active?.payload).toMatchObject({
      case: 'snapshot',
      value: { participants: [{ key: { actorId: teammateId, viewId } }] },
    });

    await server.restart();
    expect(await stream.next()).toBeUndefined();
    const reopened = await callWhiteboard(server.address, editorId, getBoardRoom, scope);
    expect(reopened.event?.roomInstanceId).not.toBe(active?.roomInstanceId);
    expect(reopened.event).toMatchObject({
      sequence: 0n,
      payload: { case: 'snapshot', value: { participants: [] } },
    });
  } finally {
    await stream.close();
  }
});

test('keeps the same accepted deadline and own timer receipt after a server restart', async () => {
  const set = await timerAs(editorId, 'set-duration', 0n, { case: 'setDurationMs', value: 42_000 });
  expect(set.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: { timer: { phase: BoardRoomTimerPhase.IDLE, durationMs: 42_000, version: 1n } },
  });

  const startAction = { case: 'start', value: {} } as const;
  const start = await timerAs(editorId, 'start-timer', 1n, startAction);
  const expectedDeadline = (start.serverTimeUnixMs ?? 0n) + 42_000n;
  expect(start.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: {
      timer: { phase: BoardRoomTimerPhase.RUNNING, deadlineUnixMs: expectedDeadline, version: 2n },
    },
  });

  const pause = await timerAs(editorId, 'pause-timer', 2n, { case: 'pause', value: {} });
  expect(pause.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: { timer: { phase: BoardRoomTimerPhase.PAUSED, version: 3n } },
  });

  await server.restart();
  expect((await timerAs(editorId, 'start-timer', 1n, startAction)).receipt).toEqual(start.receipt);
  const read = await callWhiteboard(server.address, editorId, getBoardTimerReceipt, {
    ...scope,
    commandId: 'start-timer',
  });
  expect(read.receipt).toEqual(start.receipt);

  const snapshot = await callWhiteboard(server.address, viewerId, getBoardRoom, scope);
  expect(snapshot.event?.payload).toMatchObject({
    case: 'snapshot',
    value: { timer: { phase: BoardRoomTimerPhase.PAUSED, version: 3n } },
  });
});

test('publishes a timer change, denies read-only writes and rejects conflicting versions', async () => {
  const stream = await openRoom(viewerId, 'watch-timer');
  try {
    await stream.next();
    const startAction = { case: 'start', value: {} } as const;
    const forbidden = await timerAs(viewerId, 'viewer-start', 0n, startAction);
    expect(forbidden.receipt?.outcome).toMatchObject({
      case: 'rejected',
      value: { reason: BoardTimerRejection.FORBIDDEN },
    });

    const start = await timerAs(editorId, 'run-timer', 0n, startAction);
    expect(start.receipt?.outcome.case).toBe('applied');
    expect(await stream.next()).toMatchObject({
      sequence: 1n,
      payload: { case: 'timer', value: { phase: BoardRoomTimerPhase.RUNNING, version: 1n } },
    });

    const conflict = await timerAs(teammateId, 'old-reset', 0n, { case: 'reset', value: {} });
    expect(conflict.receipt?.outcome).toMatchObject({
      case: 'conflict',
      value: { timer: { version: 1n } },
    });
  } finally {
    await stream.close();
  }
});

test('publishes one confirmed metadata delta after the whiteboard transaction', async () => {
  const stream = await openRoom(viewerId, 'watch-board-content');
  try {
    await stream.next();
    const moved = await callWhiteboard(
      server.address,
      editorId,
      WhiteboardService.method.moveObjects,
      {
        ...scope,
        commandId: 'room-move',
        delta: { dx: 5, dy: 3 },
        targets: [{ objectId: shapeId, expectedGeometryVersion: 0n }],
      },
    );
    expect(moved.receipt?.outcome.case).toBe('applied');

    expect(await stream.next()).toMatchObject({
      sequence: 1n,
      payload: {
        case: 'contentChanged',
        value: {
          boardRevision: 1n,
          changedObjectIds: [shapeId],
          changedObjects: [{ objectId: shapeId, geometry: { x: 21, y: -5 }, geometryVersion: 1n }],
          refreshScene: false,
        },
      },
    });
  } finally {
    await stream.close();
  }
});

test('rolls back timer and receipt together when durable receipt writing fails', async () => {
  rejectRoomTimerReceipts(server.databasePath);
  const failed = await sendWhiteboardRequest(server.address, editorId, changeBoardTimer, {
    ...scope,
    commandId: 'start-failed-timer',
    expectedVersion: 0n,
    action: { case: 'start', value: {} },
  });
  expect(failed.status).toBe(500);

  const restored = await callWhiteboard(server.address, editorId, getBoardRoom, scope);
  expect(restored.event?.payload).toMatchObject({
    case: 'snapshot',
    value: { timer: { phase: BoardRoomTimerPhase.IDLE, version: 0n } },
  });
  const receipt = await callWhiteboard(server.address, editorId, getBoardTimerReceipt, {
    ...scope,
    commandId: 'start-failed-timer',
  });
  expect(receipt.receipt).toBeUndefined();
});
