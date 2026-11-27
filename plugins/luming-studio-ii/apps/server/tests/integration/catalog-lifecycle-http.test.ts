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
import {
  BoardHistoryService,
  BoardVersionKind,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/history';
import {
  BoardExportFormat,
  MoveRejectionReason,
  WhiteboardService,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { expect, test } from 'vitest';
import { archiveRowCounts, retainedArchiveChunks } from '../support/archive-database.js';
import {
  clearLifecycleRows,
  grantCatalogEditor,
  installLegacyBoardVersions,
  managementReceiptWriteFailure,
  readLegacyBoardVersionKinds,
  rejectCatalogManagementReceiptInserts,
  setCatalogTrashTimes,
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
const { exportBoard, getBoardScene, getObjectPayloads, moveObjects } = WhiteboardService.method;
const { getBoardVersionScene, listBoardVersions } = BoardHistoryService.method;
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

async function importBoard(commandId: string, content?: Uint8Array<ArrayBuffer>) {
  const response = await fetch(new URL(archivePath, server.address), {
    method: 'POST',
    headers: {
      [actorHeader]: ownerId,
      'content-type': 'application/zip',
      'x-studio-command-id': commandId,
    },
    body: content ?? (await readFile(archiveFixture)),
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

function history(boardId: string) {
  return callProtobuf(server.address, ownerId, listBoardVersions, { boardId, limit: 20 });
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

function loadAsset(path: string, actorId = ownerId) {
  return fetch(new URL(path, server.address), {
    headers: { [actorHeader]: actorId },
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
}

async function expectHiddenBoard(boardId: string, assetPath: string, actorId = ownerId) {
  const [oldScene, oldPayload, oldAsset] = await Promise.all([
    sendProtobuf(server.address, actorId, getBoardScene, { boardId }),
    sendProtobuf(server.address, actorId, getObjectPayloads, {
      boardId,
      objectIds: [imageObjectId],
    }),
    loadAsset(assetPath, actorId),
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
  expect(await activeBoards()).toEqual([{ ...receipt.outcome.value, previewRevision: 0n }]);
});

test('adopts existing ownership from Stage 3 create and import receipts on restart', async () => {
  const created = await addBoard('previous-create', 'Previously created');
  const imported = await importBoard('previous-import');
  clearLifecycleRows(server.databasePath, [created.boardId, imported.boardId]);

  await server.restart();

  const boards = await activeBoards();
  expect(boards).toHaveLength(2);
  expect(boards).toEqual(expect.arrayContaining([{ ...created, previewRevision: 0n }, imported]));
  const result = await Promise.all([
    change(created, 'pin-previous-create', { case: 'pinned', value: true }),
    change(imported, 'pin-previous-import', { case: 'pinned', value: true }),
  ]);

  expect(result).toMatchObject([
    { boardId: created.boardId, canManage: true, pinned: true },
    { boardId: imported.boardId, canManage: true, pinned: true },
  ]);
});

test('lets only the owner preview a trashed archive and restores its original scene and media', async () => {
  const adopted = await importBoard('import-owned');
  expect(adopted.canManage).toBe(true);
  const renamed = await change(adopted, 'rename-import', {
    case: 'title',
    value: 'Archive restored',
  });
  const pinned = await change(renamed, 'pin-import', { case: 'pinned', value: true });
  const { boardId } = pinned;
  grantCatalogEditor(server.databasePath, boardId, editorId);
  const beforeScene = await scene(boardId);
  assert.ok(beforeScene.scene?.boardRevision !== undefined);
  const beforePayload = await payloads(boardId);
  const assetPath = imageSource(beforePayload);
  const asset = await loadAsset(assetPath);
  expect(asset.status).toBe(200);
  const beforeAsset = await asset.text();

  const trashed = await change(pinned, 'trash-import', trash);

  expect(await activeBoards()).toEqual([]);
  expect(await trashedBoards()).toMatchObject([{ board: trashed }]);
  expect(await trashedBoards(editorId)).toEqual([]);
  await expectHiddenBoard(boardId, assetPath, editorId);
  expect((await scene(boardId)).scene).toMatchObject({
    boardId,
    access: { canEdit: false, trashed: true },
    objects: beforeScene.scene.objects,
  });
  expect(await payloads(boardId)).toEqual(beforePayload);
  const trashedAsset = await loadAsset(assetPath);
  expect(trashedAsset.status).toBe(200);
  expect(await trashedAsset.text()).toBe(beforeAsset);
  const moved = await callProtobuf(server.address, ownerId, moveObjects, {
    boardId,
    commandId: 'move-trashed-image',
    delta: { dx: 1, dy: 1 },
    targets: [{ objectId: imageObjectId, expectedGeometryVersion: 0n }],
  });
  expect(moved.receipt?.outcome).toEqual({
    case: 'rejected',
    value: expect.objectContaining({ reason: MoveRejectionReason.FORBIDDEN }),
  });

  await server.restart();
  expect((await scene(boardId)).scene?.access).toMatchObject({ canEdit: false, trashed: true });
  const retriedTrash = await manage({
    ...target(pinned),
    commandId: 'trash-import',
    operation: trash,
  });
  expect(retriedTrash.receipt?.outcome).toEqual({ case: 'changed', value: trashed });
  const restored = await change(trashed, 'restore-import', restore);

  expect(restored).toMatchObject({
    boardId,
    title: 'Archive restored',
    pinned: true,
    canManage: true,
  });
  const restoredRevision = beforeScene.scene.boardRevision + 2n;
  expect(await activeBoards()).toEqual([{ ...restored, previewRevision: restoredRevision }]);
  expect(await trashedBoards()).toEqual([]);
  expect((await scene(boardId)).scene).toEqual({
    ...beforeScene.scene,
    boardRevision: restoredRevision,
  });
  expect(await payloads(boardId)).toEqual(beforePayload);
  expect(await history(boardId)).toMatchObject({
    currentRevision: restoredRevision,
    versions: [
      {
        revision: restoredRevision,
        kind: BoardVersionKind.RESTORE_TRASH,
        actorId: ownerId,
        savedAtMillis: restored.updatedAtMillis,
        changedObjectCount: 0,
      },
      {
        revision: restoredRevision - 1n,
        kind: BoardVersionKind.TRASH,
        actorId: ownerId,
        savedAtMillis: trashed.updatedAtMillis,
        changedObjectCount: 0,
      },
      { revision: beforeScene.scene.boardRevision },
    ],
  });
  const archived = await callProtobuf(server.address, ownerId, getBoardVersionScene, {
    boardId,
    revision: restoredRevision - 1n,
  });
  expect(archived.scene?.objects).toEqual(beforeScene.scene.objects);
  const restoredAsset = await loadAsset(assetPath);
  expect(restoredAsset.status).toBe(200);
  expect(await restoredAsset.text()).toBe(beforeAsset);
});

test('preserves lifecycle version kinds, dates and actor through a backup and reimport', async () => {
  const created = await addBoard('create-lifecycle-backup', 'Lifecycle backup');
  const trashed = await change(created, 'trash-lifecycle-backup', trash);
  await change(trashed, 'restore-lifecycle-backup', restore);
  const before = await history(created.boardId);
  const { result } = await callProtobuf(server.address, ownerId, exportBoard, {
    boardId: created.boardId,
    expectedRevision: 2n,
    format: BoardExportFormat.ZIP,
    scope: { case: 'whole', value: {} },
  });
  assert.ok(result.case === 'file');

  const copied = await importBoard('import-lifecycle-backup', new Uint8Array(result.value.content));
  expect(copied.boardId).not.toBe(created.boardId);
  expect(await history(copied.boardId)).toEqual(before);
});

test('rolls back the catalog and lifecycle version when the management receipt cannot be written', async () => {
  const created = await addBoard('create-trash-rollback', 'Keep active with original history');
  const before = await history(created.boardId);
  const active = await activeBoards();
  rejectCatalogManagementReceiptInserts(server.databasePath);
  const commandId = 'trash-with-failing-receipt';
  const response = await sendProtobuf(server.address, ownerId, manageBoard, {
    ...target(created),
    commandId,
    operation: trash,
  });
  expect(response.status).toBe(500);
  expect(server.errors[0]).toMatchObject({ message: managementReceiptWriteFailure });
  expect(await history(created.boardId)).toEqual(before);
  expect(await activeBoards()).toEqual(active);
  expect(await trashedBoards()).toEqual([]);
  expect((await lookup(commandId)).result.case).toBe('notRecorded');
});

test('upgrades the previous history constraint without losing saved versions', async () => {
  const created = await addBoard('create-legacy-history', 'Legacy history');
  installLegacyBoardVersions(server.databasePath, created.boardId, ownerId);
  expect(readLegacyBoardVersionKinds(server.databasePath, created.boardId)).toEqual([
    'content',
    'baseline',
  ]);
  await server.restart();
  const before = await history(created.boardId);
  expect(before.versions).toMatchObject([
    {
      revision: 1n,
      title: created.title,
      kind: BoardVersionKind.CONTENT,
      actorId: ownerId,
      savedAtMillis: 10n,
    },
    { revision: 0n, title: created.title, kind: BoardVersionKind.BASELINE },
  ]);

  const trashed = await change(created, 'trash-legacy-history', trash);
  await change(trashed, 'restore-legacy-history', restore);
  const after = await history(created.boardId);
  expect(after.currentRevision).toBe(3n);
  expect(readLegacyBoardVersionKinds(server.databasePath, created.boardId)).toEqual([
    'content',
    'content',
    'content',
    'baseline',
  ]);
  expect(after.versions.slice(-2)).toEqual(before.versions);
});

test('pages trashed boards by pin and last update time, using board ID to break ties', async () => {
  const cases = [
    { key: 'first', pinned: true, updatedAtMillis: 300, trashedAtMillis: 100 },
    { key: 'second', pinned: true, updatedAtMillis: 300, trashedAtMillis: 200 },
    { key: 'older', pinned: true, updatedAtMillis: 200, trashedAtMillis: 500 },
    { key: 'latest', pinned: false, updatedAtMillis: 600, trashedAtMillis: 300 },
    { key: 'early', pinned: false, updatedAtMillis: 400, trashedAtMillis: 700 },
  ];
  const entries = [];
  for (const item of cases) {
    const created = await addBoard('create-' + item.key, item.key);
    const prepared = item.pinned
      ? await change(created, 'pin-' + item.key, { case: 'pinned', value: true })
      : created;
    const trashed = await change(prepared, 'trash-' + item.key, trash);
    entries.push({ ...item, boardId: trashed.boardId });
  }
  setCatalogTrashTimes(server.databasePath, entries);

  const expected = [
    ...entries.slice(0, 2).sort((first, second) => first.boardId.localeCompare(second.boardId)),
    ...entries.slice(2),
  ];
  let cursor: string | undefined;
  for (const item of expected) {
    const page = await callProtobuf(server.address, ownerId, listTrashedBoards, {
      ...listing,
      pageSize: 1,
      cursor,
    });
    expect(page.boards).toMatchObject([
      {
        board: {
          boardId: item.boardId,
          pinned: item.pinned,
          updatedAtMillis: BigInt(item.updatedAtMillis),
        },
        trashedAtMillis: BigInt(item.trashedAtMillis),
      },
    ]);
    cursor = page.nextCursor;
  }
  expect(cursor).toBeUndefined();
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
  expect(await activeBoards()).toEqual([{ ...restored, previewRevision: 2n }]);
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
