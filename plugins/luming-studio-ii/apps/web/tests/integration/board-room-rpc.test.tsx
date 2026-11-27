import { create, fromBinary, toBinary, toJsonString } from '@bufbuild/protobuf';
import {
  BoardRoomEventSchema,
  BoardRoomGestureKind,
  BoardRoomService as wireService,
  BoardRoomTimerPhase,
} from '@codexworkbench/luming-studio-ii-contracts/rooms/service';
import { expect, test } from 'vitest';
import {
  createBoardRoomService,
  type BoardRoomEvent,
  type BoardRoomEventPort,
  type BoardRoomPost,
} from '../../src/data/rooms/index.js';

const boardId = 'room-board';
const viewId = 'view-one';
const actorId = 'guest-one';
const commandId = 'timer-command';
const instanceId = 'room-instance';
const now = 1_800_000_000_000;
const objectGeometry = { x: 30, y: 40, width: 150, height: 120, rotation: 0 };
const gesture = {
  kind: 'resize',
  changes: [{ id: 'card', expectedVersion: 0, geometry: objectGeometry }],
} as const;
const wireGesture = {
  kind: BoardRoomGestureKind.RESIZE,
  changes: [{ objectId: 'card', expectedGeometryVersion: 0n, geometry: objectGeometry }],
};
const wireTimer = {
  version: 0n,
  phase: BoardRoomTimerPhase.RUNNING,
  durationMs: 60_000,
  deadlineUnixMs: BigInt(now + 60_000),
  remainingMs: 60_000,
};

const timer = {
  version: 0n,
  phase: 'running',
  durationMs: 60_000,
  deadlineUnixMs: now + 60_000,
  remainingMs: 60_000,
};

const unusedPost: BoardRoomPost = async () => {
  throw new Error('Unexpected request.');
};

const unusedEvents: BoardRoomEventPort = () => {
  throw new Error('Unexpected stream.');
};

const { changeBoardTimer, getBoardTimerReceipt, updateBoardPresence, leaveBoardPresence } =
  wireService.method;

function pathFor(name: string): string {
  return '/' + wireService.typeName + '/' + name;
}

function snapshotText(sourceBoard = boardId): string {
  return toJsonString(
    BoardRoomEventSchema,
    create(BoardRoomEventSchema, {
      boardId: sourceBoard,
      roomInstanceId: instanceId,
      sequence: 0n,
      serverTimeUnixMs: BigInt(now),
      payload: {
        case: 'snapshot',
        value: {
          actorId,
          canEdit: false,
          boardRevision: 0n,
          timer: wireTimer,
          participants: [
            {
              key: { actorId, viewId },
              role: 'viewer',
              displayName: '访客',
              sequence: 1n,
              expiresAtUnixMs: BigInt(now + 18_000),
              viewport: { centerX: 0, centerY: 0, zoom: 0.25, width: 1200, height: 800 },
            },
          ],
        },
      },
    }),
  );
}

test('decodes an explicit zero-based ProtoJSON snapshot including actor-scoped participant identity', () => {
  const received: BoardRoomEvent[] = [];
  const controller = new AbortController();
  const events: BoardRoomEventPort = (board, view, observer, signal) => {
    expect({ board, view, signal }).toEqual({
      board: boardId,
      view: viewId,
      signal: controller.signal,
    });
    observer.onEvent(snapshotText());
  };
  const service = createBoardRoomService(unusedPost, events);
  service.subscribe(
    boardId,
    viewId,
    {
      onEvent: (event) => {
        received.push(event);
      },
      onDisconnect() {
        throw new Error('Unexpected disconnect.');
      },
    },
    controller.signal,
  );

  expect(received).toMatchObject([
    {
      kind: 'snapshot',
      boardId,
      instanceId,
      sequence: 0n,
      serverTimeUnixMs: now,
      revision: 0n,
      timer,
      participants: [
        {
          actorId,
          viewId,
          expiresAtMillis: now + 18_000,
          viewport: { zoom: 0.25, width: 1200, height: 800 },
        },
      ],
    },
  ]);
});

test('rejects a foreign board event and ignores messages after the event scope is cancelled', () => {
  const controller = new AbortController();
  const events: BoardRoomEventPort = (_board, _view, observer) => {
    observer.onEvent(snapshotText('unrelated'));
    controller.abort();
    observer.onEvent(snapshotText());
  };
  let failure: unknown;
  createBoardRoomService(unusedPost, events).subscribe(
    boardId,
    viewId,
    {
      onEvent() {
        throw new Error('Unexpected event.');
      },
      onDisconnect(_reason, error) {
        failure = error;
      },
    },
    controller.signal,
  );
  expect(failure).toMatchObject({ message: '房间事件属于另一块白板。' });
});

test('decodes changed metadata through the shared object codec without carrying object bodies', () => {
  const received: BoardRoomEvent[] = [];
  const events: BoardRoomEventPort = (_board, _view, observer) => {
    const delta = create(BoardRoomEventSchema, {
      boardId,
      roomInstanceId: instanceId,
      sequence: 2n,
      serverTimeUnixMs: BigInt(now),
      payload: {
        case: 'contentChanged',
        value: {
          boardRevision: 2n,
          changedObjectIds: ['shape'],
          removedObjectIds: ['removed-shape'],
          changedObjects: [
            {
              objectId: 'shape',
              kind: 'shape',
              label: '轮廓',
              geometryVersion: 5n,
              payloadVersion: 3n,
              geometry: { x: 12, y: 25, width: 80, height: 40, rotation: 15 },
              geometryDetail: { case: 'shape', value: { outline: 'ellipse' } },
            },
          ],
        },
      },
    });
    observer.onEvent(toJsonString(BoardRoomEventSchema, delta));
  };
  createBoardRoomService(unusedPost, events).subscribe(
    boardId,
    viewId,
    {
      onEvent(event) {
        received.push(event);
      },
      onDisconnect() {
        throw new Error('Unexpected disconnect.');
      },
    },
    new AbortController().signal,
  );
  expect(received).toMatchObject([
    {
      kind: 'contentChanged',
      change: {
        revision: 2n,
        changedObjectIds: ['shape'],
        removedObjectIds: ['removed-shape'],
        refreshScene: false,
        changedObjects: [
          {
            id: 'shape',
            geometryVersion: 5n,
            payloadVersion: 3n,
            detail: { kind: 'shape', outline: 'ellipse' },
          },
        ],
      },
    },
  ]);
});

test('publishes ordered temporary presence and leaves using its next sequence', async () => {
  const post: BoardRoomPost = async (path, body) => {
    if (path === pathFor(updateBoardPresence.name)) {
      expect(fromBinary(updateBoardPresence.input, body)).toMatchObject({
        boardId,
        viewId,
        sequence: 1n,
        cursor: { x: 10, y: 20 },
        following: true,
        gesture: wireGesture,
      });

      return toBinary(
        updateBoardPresence.output,
        create(updateBoardPresence.output, { accepted: true }),
      );
    }

    expect(path).toBe(pathFor(leaveBoardPresence.name));
    expect(fromBinary(leaveBoardPresence.input, body)).toMatchObject({
      boardId,
      viewId,
      sequence: 2n,
    });

    return toBinary(
      leaveBoardPresence.output,
      create(leaveBoardPresence.output, { accepted: true }),
    );
  };
  const service = createBoardRoomService(post, unusedEvents);
  await expect(
    service.updatePresence(boardId, viewId, 1n, {
      cursor: { x: 10, y: 20 },
      following: true,
      gesture,
    }),
  ).resolves.toBe(true);
  await expect(service.leavePresence(boardId, viewId, 2n)).resolves.toBe(true);
});

test('decodes a peer gesture lease and an explicit zero geometry version', () => {
  const received: BoardRoomEvent[] = [];
  const events: BoardRoomEventPort = (_board, _view, observer) => {
    const event = create(BoardRoomEventSchema, {
      boardId,
      roomInstanceId: instanceId,
      sequence: 1n,
      serverTimeUnixMs: BigInt(now),
      payload: {
        case: 'participants',
        value: {
          upserts: [
            {
              key: { actorId: 'peer-editor', viewId: 'peer-tab' },
              role: 'editor',
              displayName: '另一位编辑者',
              sequence: 1n,
              expiresAtUnixMs: BigInt(now + 18_000),
              gesture: wireGesture,
              gestureExpiresAtUnixMs: BigInt(now + 1_200),
            },
          ],
        },
      },
    });
    observer.onEvent(toJsonString(BoardRoomEventSchema, event));
  };
  createBoardRoomService(unusedPost, events).subscribe(
    boardId,
    viewId,
    {
      onEvent: (event) => {
        received.push(event);
      },
      onDisconnect() {
        throw new Error('Unexpected disconnect.');
      },
    },
    new AbortController().signal,
  );
  expect(received).toMatchObject([
    {
      kind: 'participants',
      upserts: [
        {
          actorId: 'peer-editor',
          viewId: 'peer-tab',
          gesture,
          gestureExpiresAtMillis: now + 1_200,
        },
      ],
    },
  ]);
});

test('pins timer version zero on writes and retains an absent receipt separately from server time', async () => {
  const post: BoardRoomPost = async (path, body) => {
    if (path === pathFor(changeBoardTimer.name)) {
      expect(fromBinary(changeBoardTimer.input, body)).toMatchObject({
        boardId,
        commandId,
        expectedVersion: 0n,
        action: { case: 'adjustDurationMs', value: -60_000 },
      });

      return toBinary(
        changeBoardTimer.output,
        create(changeBoardTimer.output, {
          receipt: {
            boardId,
            commandId,
            outcome: { case: 'conflict', value: { timer: wireTimer } },
          },
          serverTimeUnixMs: BigInt(now),
        }),
      );
    }

    expect(path).toBe(pathFor(getBoardTimerReceipt.name));
    expect(fromBinary(getBoardTimerReceipt.input, body)).toMatchObject({ boardId, commandId });

    return toBinary(
      getBoardTimerReceipt.output,
      create(getBoardTimerReceipt.output, { serverTimeUnixMs: BigInt(now) }),
    );
  };
  const service = createBoardRoomService(post, unusedEvents);
  const action = { kind: 'adjustDuration' as const, deltaMs: -60_000 };
  await expect(
    service.changeTimer(boardId, { commandId, expectedVersion: 0n, action }),
  ).resolves.toEqual({
    receipt: { kind: 'conflict', commandId, timer },
    serverTimeUnixMs: now,
  });
  await expect(service.getTimerReceipt(boardId, commandId)).resolves.toEqual({
    receipt: undefined,
    serverTimeUnixMs: now,
  });
});
