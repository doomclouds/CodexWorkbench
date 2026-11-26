import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fromBinary } from '@bufbuild/protobuf';
import {
  BoardArchiveService,
  ImportBoardArchiveResponseSchema,
} from '@codexworkbench/luming-studio-ii-contracts/archives/service';
import {
  BoardCatalogService,
  BoardLifecycleAction,
  BoardSortOrder,
  CatalogRejectionReason,
  type BoardSummary,
  type ManageBoardRequest,
} from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import { WhiteboardService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { expect, test } from 'vitest';
import { archiveRowCounts, retainedArchiveChunks } from '../support/archive-database.js';
import {
  clearLifecycleRows,
  grantCatalogEditor,
  managementReceiptWriteFailure,
  rejectCatalogManagementReceiptInserts,
} from '../support/catalog-lifecycle-database.js';
import {
  actorHeader,
  callWhiteboard as callProtobuf,
  sendWhiteboardRequest as sendProtobuf,
} from '../support/whiteboard-client.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

const server = useWhiteboardTestServer();
const {
  createBoard,
  getCatalogCommandReceipt,
  listBoards,
  listTrashedBoards,
  manageBoard,
  purgeBoards,
} = BoardCatalogService.method;
const { getBoardScene, getObjectPayloads } = WhiteboardService.method;
const ownerId = 'lifecycle-owner';
const editorId = 'lifecycle-editor';
const archivePath = '/' + BoardArchiveService.typeName + '/ImportBoardArchive';
const archiveFixture = new URL('../fixtures/archives/legacy-v4.studio.zip', import.meta.url);
const imageObjectId = 'release-image';
const requestTimeoutMs = 5_000;
const listing = { order: BoardSortOrder.RECENT, pageSize: 20 };
const trash = { case: 'lifecycle', value: BoardLifecycleAction.TRASH } as const;
const restore = { case: 'lifecycle', value: BoardLifecycleAction.RESTORE } as const;

async function addBoard(commandId: string, title: string) {
  const { receipt } = await callProtobuf(server.address, ownerId, createBoard, {
    commandId,
    title,
  });
  assert.ok(receipt?.outcome.case === 'created');

  return receipt.outcome.value;
}

async function activeBoards(actorId = ownerId) {
  const { boards } = await callProtobuf(server.address, actorId, listBoards, listing);

  return boards;
}

async function trashedBoards(actorId = ownerId) {
  const { boards } = await callProtobuf(server.address, actorId, listTrashedBoards, listing);

  return boards;
}

function target(board: BoardSummary) {
  assert.ok(board.entryVersion !== undefined);

  return { boardId: board.boardId, expectedEntryVersion: board.entryVersion };
}

function manage(command: Omit<ManageBoardRequest, '$typeName'>, actorId = ownerId) {
  return callProtobuf(server.address, actorId, manageBoard, command);
}

async function change(
  board: BoardSummary,
  commandId: string,
  operation: ManageBoardRequest['operation'],
) {
  const { receipt } = await manage({ ...target(board), commandId, operation });
  assert.ok(receipt?.outcome.case === 'changed');

  return receipt.outcome.value;
}

function lookup(commandId: string, actorId = ownerId) {
  return callProtobuf(server.address, actorId, getCatalogCommandReceipt, { commandId });
}

async function importBoard(commandId: string) {
  const response = await fetch(new URL(archivePath, server.address), {
    method: 'POST',
    headers: {
      [actorHeader]: ownerId,
      'content-type': 'application/zip',
      'x-studio-command-id': commandId,
    },
    body: await readFile(archiveFixture),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  assert.equal(response.status, 200);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const { receipt } = fromBinary(ImportBoardArchiveResponseSchema, bytes);
  assert.ok(receipt?.outcome.case === 'imported');
  const { boardId } = receipt.outcome.value;
  const board = (await activeBoards()).find((summary) => summary.boardId === boardId);
  assert.ok(board);

  return board;
}

function scene(boardId: string) {
  return callProtobuf(server.address, ownerId, getBoardScene, { boardId });
}

function payloads(boardId: string) {
  return callProtobuf(server.address, ownerId, getObjectPayloads, {
    boardId,
    objectIds: [imageObjectId],
  });
}

function imageSource(response: Awaited<ReturnType<typeof payloads>>) {
  const image = response.results[0]?.result;
  assert.ok(image?.case === 'payload' && image.value.body.case === 'image');
  const { src } = image.value.body.value;
  assert.ok(src);

  return src;
}

function loadAsset(path: string) {
  return fetch(new URL(path, server.address), {
    headers: { [actorHeader]: ownerId },
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
}

async function expectHiddenBoard(boardId: string, assetPath: string) {
  const [oldScene, oldPayload, oldAsset] = await Promise.all([
    sendProtobuf(server.address, ownerId, getBoardScene, { boardId }),
    sendProtobuf(server.address, ownerId, getObjectPayloads, {
      boardId,
      objectIds: [imageObjectId],
    }),
    loadAsset(assetPath),
  ]);

  expect(oldScene.status).toBe(403);
  expect(oldPayload.status).toBe(403);
  expect(oldAsset.status).toBe(404);
}

test('proves catalog ownership and replays the same management receipt after restart', async () => {
  const board = await addBoard('create-owned', 'Original title');
  grantCatalogEditor(server.databasePath, board.boardId, editorId);
  const [editorBoard] = await activeBoards(editorId);
  expect(editorBoard).toMatchObject({ boardId: board.boardId, canManage: false });
  expect(board.canManage).toBe(true);
  const command = {
    ...target(board),
    commandId: 'rename-owned',
    operation: { case: 'title', value: 'Updated title' } as const,
  };

  const { receipt } = await manage(command);
  assert.ok(receipt?.outcome.case === 'changed');
  expect((await scene(board.boardId)).scene?.title).toBe('Updated title');
  const { receipt: forbidden } = await manage(
    { ...command, ...target(receipt.outcome.value), commandId: 'editor-rename' },
    editorId,
  );
  expect(forbidden?.outcome).toEqual({
    case: 'rejected',
    value: expect.objectContaining({ reason: CatalogRejectionReason.FORBIDDEN }),
  });

  await server.restart();

  expect((await manage(command)).receipt).toEqual(receipt);
  expect((await lookup(command.commandId)).result).toEqual({ case: 'receipt', value: receipt });
  expect((await lookup(command.commandId, editorId)).result).toMatchObject({
    case: 'notRecorded',
    value: { commandId: command.commandId },
  });
  const { receipt: reused } = await manage({
    ...command,
    operation: { case: 'title', value: 'Different title' },
  });
  expect(reused?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: CatalogRejectionReason.COMMAND_ID_REUSE },
  });
  expect(await activeBoards()).toEqual([receipt.outcome.value]);
});

test('adopts existing ownership from Stage 3 create and import receipts on restart', async () => {
  const created = await addBoard('previous-create', 'Previously created');
  const imported = await importBoard('previous-import');
  clearLifecycleRows(server.databasePath, [created.boardId, imported.boardId]);

  await server.restart();

  const boards = await activeBoards();
  expect(boards).toHaveLength(2);
  expect(boards).toEqual(expect.arrayContaining([created, imported]));
  const result = await Promise.all([
    change(created, 'pin-previous-create', { case: 'pinned', value: true }),
    change(imported, 'pin-previous-import', { case: 'pinned', value: true }),
  ]);

  expect(result).toMatchObject([
    { boardId: created.boardId, canManage: true, pinned: true },
    { boardId: imported.boardId, canManage: true, pinned: true },
  ]);
});

test('restores a pinned archive with the original scene, payload, and media after hiding its routes', async () => {
  const adopted = await importBoard('import-owned');
  expect(adopted.canManage).toBe(true);
  const renamed = await change(adopted, 'rename-import', {
    case: 'title',
    value: 'Archive restored',
  });
  const pinned = await change(renamed, 'pin-import', { case: 'pinned', value: true });
  const { boardId } = pinned;
  const beforeScene = await scene(boardId);
  const beforePayload = await payloads(boardId);
  const assetPath = imageSource(beforePayload);
  const asset = await loadAsset(assetPath);
  expect(asset.status).toBe(200);
  const beforeAsset = await asset.text();

  const trashed = await change(pinned, 'trash-import', trash);

  expect(await activeBoards()).toEqual([]);
  expect(await trashedBoards()).toMatchObject([{ board: trashed }]);
  expect(await trashedBoards(editorId)).toEqual([]);
  await expectHiddenBoard(boardId, assetPath);

  const restored = await change(trashed, 'restore-import', restore);

  expect(restored).toMatchObject({
    boardId,
    title: 'Archive restored',
    pinned: true,
    canManage: true,
  });
  expect(await activeBoards()).toEqual([restored]);
  expect(await trashedBoards()).toEqual([]);
  expect(await scene(boardId)).toEqual(beforeScene);
  expect(await payloads(boardId)).toEqual(beforePayload);
  const restoredAsset = await loadAsset(assetPath);
  expect(restoredAsset.status).toBe(200);
  expect(await restoredAsset.text()).toBe(beforeAsset);
});

test('purges only matching trash snapshots and preserves restored and retrash copies', async () => {
  const archive = await importBoard('import-to-purge');
  const assetPath = imageSource(await payloads(archive.boardId));
  expect(retainedArchiveChunks(server.databasePath, archive.boardId)).not.toHaveLength(0);
  grantCatalogEditor(server.databasePath, archive.boardId, editorId);
  const second = await addBoard('create-restored', 'Keep restored');
  const third = await addBoard('create-retrash', 'Keep retrash');
  const purgeable = await change(archive, 'trash-purgeable', trash);
  const previouslyTrashed = await change(second, 'trash-restored', trash);
  const stale = await change(third, 'trash-to-retrash', trash);
  const restored = await change(previouslyTrashed, 'restore-before-purge', restore);
  const reopened = await change(stale, 'restore-before-retrash', restore);
  const retrash = await change(reopened, 'retrashing', trash);
  const { receipt: forbidden } = await callProtobuf(server.address, editorId, purgeBoards, {
    commandId: 'editor-purge',
    targets: [target(purgeable)],
  });
  expect(forbidden?.outcome).toMatchObject({
    case: 'purged',
    value: {
      items: [
        {
          boardId: purgeable.boardId,
          outcome: { case: 'rejected', value: { reason: CatalogRejectionReason.FORBIDDEN } },
        },
      ],
    },
  });
  const command = {
    commandId: 'purge-confirmed',
    targets: [target(purgeable), target(previouslyTrashed), target(stale)],
  };

  const { receipt } = await callProtobuf(server.address, ownerId, purgeBoards, command);
  assert.ok(receipt?.outcome.case === 'purged');
  expect(receipt.outcome.value.items).toMatchObject([
    { boardId: purgeable.boardId, outcome: { case: 'deleted', value: true } },
    {
      boardId: restored.boardId,
      outcome: { case: 'rejected', value: { reason: CatalogRejectionReason.STATE_CHANGED } },
    },
    {
      boardId: stale.boardId,
      outcome: {
        case: 'rejected',
        value: { reason: CatalogRejectionReason.ENTRY_VERSION_CHANGED },
      },
    },
  ]);
  expect(await activeBoards()).toEqual([restored]);
  expect(await trashedBoards()).toMatchObject([{ board: retrash }]);
  await expectHiddenBoard(purgeable.boardId, assetPath);
  expect(retainedArchiveChunks(server.databasePath, purgeable.boardId)).toHaveLength(0);
  expect((await callProtobuf(server.address, ownerId, purgeBoards, command)).receipt).toEqual(
    receipt,
  );
});

test('rolls back every purge and leaves no receipt when the receipt insert fails', async () => {
  const archive = await importBoard('import-rollback');
  const second = await addBoard('create-rollback', 'Keep empty board');
  const firstTrashed = await change(archive, 'trash-rollback-first', trash);
  const secondTrashed = await change(second, 'trash-rollback-second', trash);
  const beforeTrash = await trashedBoards();
  const beforeCounts = archiveRowCounts(server.databasePath);
  rejectCatalogManagementReceiptInserts(server.databasePath);
  const commandId = 'purge-rollback';

  const response = await sendProtobuf(server.address, ownerId, purgeBoards, {
    commandId,
    targets: [target(firstTrashed), target(secondTrashed)],
  });

  expect(response.status).toBe(500);
  expect(await response.text()).toBe('');
  expect(server.errors).toHaveLength(1);
  expect(server.errors[0]).toMatchObject({ message: managementReceiptWriteFailure });
  expect(archiveRowCounts(server.databasePath)).toEqual(beforeCounts);
  expect(await trashedBoards()).toEqual(beforeTrash);
  expect((await lookup(commandId)).result).toMatchObject({
    case: 'notRecorded',
    value: { commandId },
  });
});
