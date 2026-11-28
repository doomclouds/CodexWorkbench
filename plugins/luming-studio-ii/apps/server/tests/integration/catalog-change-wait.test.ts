import assert from 'node:assert/strict';
import {
  BoardCatalogService,
  BoardLifecycleAction,
  type ManageBoardRequest,
} from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import { BoardEditService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import { test } from 'vitest';
import {
  actorHeader,
  callWhiteboard,
  sendWhiteboardRequest,
} from '../support/whiteboard-client.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

const ownerId = 'catalog-watcher';
const { listBoards, waitForBoardCatalogChange, createBoard, manageBoard } =
  BoardCatalogService.method;
const { editBoardGeometry } = BoardEditService.method;
const server = useWhiteboardTestServer((request) => {
  const id = request.headers[actorHeader];
  switch (id) {
    case ownerId:
      return { id };
    case 'agent':
      return { id, kind: 'agent' };
    case 'guest':
      return { id, guestScope: 'lan' };
    case undefined:
    default:
      return undefined;
  }
});

function list() {
  return callWhiteboard(server.address, ownerId, listBoards, { pageSize: 20 });
}

function wait(afterCursor: string) {
  return callWhiteboard(server.address, ownerId, waitForBoardCatalogChange, { afterCursor });
}

async function createCatalogBoard() {
  const { receipt } = await callWhiteboard(server.address, ownerId, createBoard, {
    commandId: 'create-watch-board',
    title: '目录订阅',
  });
  assert.equal(receipt?.outcome.case, 'created');

  return receipt.outcome.value;
}

test('wakes the existing directory on committed creation, edits, management and restoration', async () => {
  let { catalogCursor } = await list();
  assert.notEqual(catalogCursor, '');
  const created = wait(catalogCursor);
  const board = await createCatalogBoard();

  async function readChange(pending: ReturnType<typeof wait>) {
    const next = (await pending).catalogCursor;
    assert.notEqual(next, catalogCursor);
    catalogCursor = next;

    const updated = await list();
    assert.equal(updated.catalogCursor, next);

    return updated.boards.find(({ boardId }) => boardId === board.boardId);
  }

  const active = await readChange(created);
  assert.equal(active?.title, '目录订阅');

  const edited = wait(catalogCursor);
  const { receipt } = await callWhiteboard(server.address, ownerId, editBoardGeometry, {
    boardId: board.boardId,
    commandId: 'add-watch-object',
    operation: {
      case: 'create',
      value: {
        object: {
          objectId: 'watch-object',
          kind: 'text',
          label: '目录缩略图',
          geometry: { x: 10, y: 10, width: 120, height: 50 },
        },
      },
    },
  });
  assert.equal(receipt?.outcome.case, 'applied');
  assert.equal((await readChange(edited))?.previewRevision, 1n);

  async function change(
    commandId: string,
    expectedEntryVersion: bigint,
    operation: ManageBoardRequest['operation'],
  ) {
    const pending = wait(catalogCursor);
    const { receipt } = await callWhiteboard(server.address, ownerId, manageBoard, {
      boardId: board.boardId,
      commandId,
      expectedEntryVersion,
      operation,
    });
    assert.equal(receipt?.outcome.case, 'changed');

    return readChange(pending);
  }

  assert.equal(
    (await change('rename-watch', 1n, { case: 'title', value: '新目录名' }))?.title,
    '新目录名',
  );
  assert.equal((await change('pin-watch', 2n, { case: 'pinned', value: true }))?.pinned, true);

  const trash = { case: 'lifecycle', value: BoardLifecycleAction.TRASH } as const;
  const restore = { case: 'lifecycle', value: BoardLifecycleAction.RESTORE } as const;
  assert.equal(await change('trash-watch', 3n, trash), undefined);
  assert.equal((await change('restore-watch', 4n, restore))?.title, '新目录名');
});

test('holds an unchanged wait, ignores receipt replay, and resynchronizes stale cursors', async () => {
  const original = (await list()).catalogCursor;
  await createCatalogBoard();
  const afterCreate = (await list()).catalogCursor;
  assert.notEqual(afterCreate, original);
  assert.equal((await wait(original)).catalogCursor, afterCreate);

  await createCatalogBoard();
  assert.equal((await list()).catalogCursor, afterCreate);
  await assert.rejects(
    sendWhiteboardRequest(
      server.address,
      ownerId,
      waitForBoardCatalogChange,
      { afterCursor: afterCreate },
      AbortSignal.timeout(100),
    ),
    { name: 'TimeoutError' },
  );

  await server.restart();
  const restarted = (await list()).catalogCursor;
  assert.notEqual(restarted, afterCreate);
  assert.equal((await wait(afterCreate)).catalogCursor, restarted);
  assert.deepEqual(server.errors, []);
});

test('rejects guest, Agent and unauthenticated watchers', async () => {
  for (const [actor, expected] of [
    ['guest', 403],
    ['agent', 403],
    [undefined, 401],
  ] as const) {
    const result = await sendWhiteboardRequest(
      server.address,
      actor,
      waitForBoardCatalogChange,
      {},
    );
    assert.equal(result.status, expected);
    await result.body?.cancel();
  }
});
