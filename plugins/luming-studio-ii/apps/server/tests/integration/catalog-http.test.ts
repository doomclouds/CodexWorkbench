import assert from 'node:assert/strict';
import {
  BoardCatalogService,
  BoardSortOrder,
  CatalogRejectionReason,
} from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import { WhiteboardService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { expect, test } from 'vitest';
import {
  catalogRowCounts,
  receiptInsertFailure,
  rejectCatalogReceiptInserts,
} from '../support/catalog-database.js';
import {
  callWhiteboard as callProtobuf,
  sendWhiteboardRequest as sendProtobufRequest,
} from '../support/whiteboard-client.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

const server = useWhiteboardTestServer();
const { listBoards, createBoard, getCatalogCommandReceipt, manageBoard } =
  BoardCatalogService.method;
const { getBoardScene } = WhiteboardService.method;
const actorId = 'catalog-editor';
const otherActorId = 'catalog-outsider';

function addBoard(commandId: string, title: string, owner = actorId) {
  return callProtobuf(server.address, owner, createBoard, { commandId, title });
}

async function addPinnedBoard(commandId: string, title: string, owner = actorId) {
  const { receipt } = await addBoard(commandId, title, owner);
  assert.equal(receipt?.outcome.case, 'created');
  const { boardId, entryVersion } = receipt.outcome.value;
  const pinned = await callProtobuf(server.address, owner, manageBoard, {
    commandId: 'pin-' + commandId,
    boardId,
    expectedEntryVersion: entryVersion,
    operation: { case: 'pinned', value: true },
  });
  assert.equal(pinned.receipt?.outcome.case, 'changed');
}

test('creates an editable empty board and replays its catalog receipt after restart', async () => {
  const commandId = 'create-and-open';
  const title = 'Catalog integration';
  const { receipt } = await addBoard(commandId, title);
  assert.ok(receipt?.outcome.case === 'created');
  const board = receipt.outcome.value;

  expect(board).toMatchObject({ title, pinned: false });
  expect(board.entryVersion).toBeDefined();
  expect(board.updatedAtMillis).toBeDefined();

  await server.restart();

  const { scene } = await callProtobuf(server.address, actorId, getBoardScene, {
    boardId: board.boardId,
  });
  const saved = await callProtobuf(server.address, actorId, getCatalogCommandReceipt, {
    commandId,
  });
  const replayed = await addBoard(commandId, title);

  expect(scene).toMatchObject({
    boardId: board.boardId,
    title,
    boardRevision: 0n,
    access: { canEdit: true },
    objects: [],
  });
  expect(saved.result).toEqual({ case: 'receipt', value: receipt });
  expect(replayed.receipt).toEqual(receipt);

  const reused = await addBoard(commandId, 'Changed title');
  const foreign = await callProtobuf(server.address, otherActorId, getCatalogCommandReceipt, {
    commandId,
  });
  const directory = await callProtobuf(server.address, actorId, listBoards, { pageSize: 2 });

  expect(reused.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: CatalogRejectionReason.COMMAND_ID_REUSE },
  });
  expect(foreign.result).toMatchObject({ case: 'notRecorded', value: { commandId } });
  expect(directory.boards).toEqual([{ ...board, previewRevision: 0n }]);
});

test('filters and pages the authenticated catalog with an opaque cursor', async () => {
  await addBoard('create-beta', 'Design Beta');
  await addBoard('create-alpha', 'Design Alpha');
  await addBoard('create-unmatched', 'Other project');
  await addBoard('create-foreign', 'Design Foreign', otherActorId);

  const query = { query: 'Design', order: BoardSortOrder.TITLE, pageSize: 1 };
  const firstPage = await callProtobuf(server.address, actorId, listBoards, query);
  assert.ok(firstPage.nextCursor);
  const secondPage = await callProtobuf(server.address, actorId, listBoards, {
    ...query,
    cursor: firstPage.nextCursor,
  });

  expect(firstPage.boards.map(({ title }) => title)).toEqual(['Design Alpha']);
  expect(secondPage.boards.map(({ title }) => title)).toEqual(['Design Beta']);
  expect(secondPage.nextCursor).toBeUndefined();
});

test('filters pins before pagination and keeps the default cursor on its original scope', async () => {
  await addPinnedBoard('pinned-beta', 'Design Beta');
  await addPinnedBoard('pinned-alpha', 'Design Alpha');
  await addBoard('unpinned', 'Design Unpinned');
  await addPinnedBoard('foreign-pin', 'Design Foreign', otherActorId);

  const query = { query: 'Design', order: BoardSortOrder.TITLE, pageSize: 1 };
  const first = await callProtobuf(server.address, actorId, listBoards, {
    ...query,
    pinnedOnly: true,
  });
  assert.ok(first.nextCursor);
  const second = await callProtobuf(server.address, actorId, listBoards, {
    ...query,
    pinnedOnly: true,
    cursor: first.nextCursor,
  });
  expect(first.boards.map(({ title }) => title)).toEqual(['Design Alpha']);
  expect(second.boards.map(({ title }) => title)).toEqual(['Design Beta']);
  expect(second.nextCursor).toBeUndefined();

  const changedFilter = await sendProtobufRequest(server.address, actorId, listBoards, {
    ...query,
    cursor: first.nextCursor,
  });
  expect(changedFilter.status).toBe(400);
  const unfiltered = await callProtobuf(server.address, actorId, listBoards, {
    ...query,
    pageSize: 2,
  });
  assert.ok(unfiltered.nextCursor);
  expect(unfiltered.nextCursor).not.toContain('pinnedOnly');
  const remaining = await callProtobuf(server.address, actorId, listBoards, {
    ...query,
    pinnedOnly: false,
    cursor: unfiltered.nextCursor,
  });
  expect(remaining.boards.map(({ title }) => title)).toEqual(['Design Unpinned']);
});

test('requires authentication and maps invalid directory requests to HTTP 400', async () => {
  const unauthorized = await sendProtobufRequest(server.address, undefined, listBoards, {
    order: BoardSortOrder.RECENT,
    pageSize: 1,
  });
  const invalid = await sendProtobufRequest(server.address, actorId, listBoards, {
    order: BoardSortOrder.RECENT,
    pageSize: 1,
    cursor: 'invalid',
  });

  expect(unauthorized.status).toBe(401);
  expect(invalid.status).toBe(400);
  expect(await invalid.text()).toBe('');
  expect(server.errors).toHaveLength(0);
});

test('rolls back all board creation records when SQLite aborts the receipt insert', async () => {
  const countsBefore = catalogRowCounts(server.databasePath);
  assert.ok(countsBefore);
  rejectCatalogReceiptInserts(server.databasePath);

  const commandId = 'create-with-receipt-write-failure';
  const failed = await sendProtobufRequest(server.address, actorId, createBoard, {
    commandId,
    title: 'Rollback check',
  });

  expect(failed.status).toBe(500);
  expect(await failed.text()).toBe('');
  expect(server.errors).toHaveLength(1);
  expect(server.errors[0]).toMatchObject({ message: receiptInsertFailure });
  expect(catalogRowCounts(server.databasePath)).toEqual(countsBefore);

  const lookup = await callProtobuf(server.address, actorId, getCatalogCommandReceipt, {
    commandId,
  });

  expect(lookup.result).toMatchObject({ case: 'notRecorded', value: { commandId } });
});
