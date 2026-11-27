import {
  BoardRoomService,
  type BoardRoomCursor,
} from '@codexworkbench/luming-studio-ii-contracts/rooms/service';
import { expect, test } from 'vitest';
import { makeRoomMemberReadOnly } from '../support/rooms-database.js';
import { callWhiteboard, sendWhiteboardRequest } from '../support/whiteboard-client.js';
import { editorId, mainBoardId, teammateId } from '../support/whiteboard-database.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

const server = useWhiteboardTestServer();
const { waitBoardRoomEvents, updateBoardPresence, leaveBoardPresence } = BoardRoomService.method;
const scope = { boardId: mainBoardId, viewId: 'room-wait-observer' };
const peer = { boardId: mainBoardId, viewId: 'room-wait-peer' };

type Cursor = Pick<BoardRoomCursor, 'roomInstanceId' | 'sequence'>;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function readWait(after?: Cursor, signal = AbortSignal.timeout(4500)) {
  return callWhiteboard(server.address, editorId, waitBoardRoomEvents, { ...scope, after }, signal);
}

async function initialCursor(): Promise<Cursor> {
  const {
    events: [initial],
  } = await readWait();
  expect(initial?.payload.case).toBe('snapshot');
  if (!initial) {
    throw new Error('The first wait did not return a snapshot');
  }

  return { roomInstanceId: initial.roomInstanceId, sequence: initial.sequence };
}

test('blocks until an event, replays events published between requests, and resynchronizes a stale cursor', async () => {
  const cursor = await initialCursor();
  const controller = new AbortController();
  let settled = false;
  const waiting = readWait(cursor, controller.signal).finally(() => {
    settled = true;
  });

  try {
    await delay(650);
    expect(settled).toBe(false);
    await callWhiteboard(server.address, teammateId, updateBoardPresence, {
      ...peer,
      sequence: 1n,
    });
    const { events } = await waiting;
    expect(events).toMatchObject([{ sequence: 1n, payload: { case: 'participants' } }]);

    await callWhiteboard(server.address, teammateId, leaveBoardPresence, { ...peer, sequence: 2n });
    const replay = await readWait({ ...cursor, sequence: 1n });
    expect(replay.events).toMatchObject([
      {
        sequence: 2n,
        payload: {
          case: 'participants',
          value: { removals: [{ actorId: teammateId, viewId: peer.viewId }] },
        },
      },
    ]);
    const recovered = await readWait({ ...cursor, roomInstanceId: 'expired-room' });
    expect(recovered.events).toMatchObject([
      {
        roomInstanceId: cursor.roomInstanceId,
        sequence: 2n,
        payload: { case: 'snapshot' },
      },
    ]);
  } finally {
    controller.abort();
    await waiting.catch((error: unknown) => {
      if (!(error instanceof Error) || error.name !== 'AbortError') {
        throw error;
      }
    });
  }
});

test('cancels a waiting request and terminates a live wait when its authorization changes', async () => {
  const cursor = await initialCursor();
  const controller = new AbortController();
  const canceled = sendWhiteboardRequest(
    server.address,
    editorId,
    waitBoardRoomEvents,
    { ...scope, after: cursor },
    controller.signal,
  );
  await delay(30);
  controller.abort();
  await expect(canceled).rejects.toMatchObject({ name: 'AbortError' });

  const denied = sendWhiteboardRequest(server.address, editorId, waitBoardRoomEvents, {
    ...scope,
    after: cursor,
  });
  await delay(80);
  makeRoomMemberReadOnly(server.databasePath, editorId);
  expect((await denied).status).toBe(403);

  expect(
    (
      await sendWhiteboardRequest(server.address, editorId, waitBoardRoomEvents, {
        ...scope,
        boardId: 'unavailable-board',
      })
    ).status,
  ).toBe(403);
});

test(
  'returns an empty batch when the authorized room stays idle for the wait window',
  { timeout: 25_000 },
  async () => {
    const cursor = await initialCursor();
    const started = Date.now();
    const idle = await readWait(cursor, AbortSignal.timeout(23_000));

    expect(idle.events).toEqual([]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(19_000);
  },
);
