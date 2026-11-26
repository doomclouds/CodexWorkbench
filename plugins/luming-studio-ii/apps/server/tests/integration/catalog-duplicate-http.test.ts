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
  type CatalogCommandReceipt,
} from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import { FeedbackService } from '@codexworkbench/luming-studio-ii-contracts/feedback/service';
import {
  BoardHistoryService,
  BoardVersionKind,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/history';
import { WhiteboardService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { expect, test } from 'vitest';
import { retainedArchiveChunks } from '../support/archive-database.js';
import {
  copyCounts,
  documentObjectId,
  externalAssetLinks,
  failCopyWrite,
  foreignSource,
  grantCopyViewer,
  htmlObjectId,
  imageObjectId,
  mixedCopyMarkup,
  removeCopyAssets,
  seedCopyReferences,
  todoObjectId,
} from '../support/catalog-copy-database.js';
import { grantCatalogEditor } from '../support/catalog-lifecycle-database.js';
import {
  actorHeader,
  callWhiteboard as callProtobuf,
  sendWhiteboardRequest as sendProtobuf,
} from '../support/whiteboard-client.js';
import { editorId, mainBoardId } from '../support/whiteboard-database.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

const server = useWhiteboardTestServer();
const owner = 'copy-owner';
const otherEditor = 'copy-editor';
const viewer = 'copy-viewer';
const releaseShapeId = 'release-scope';
const {
  createBoard,
  duplicateBoard,
  getCatalogCommandReceipt,
  listBoards,
  manageBoard,
  purgeBoards,
} = BoardCatalogService.method;
const { getBoardScene, getObjectPayloads, moveObjects } = WhiteboardService.method;

function list(actorId = owner) {
  return callProtobuf(server.address, actorId, listBoards, {
    pageSize: 20,
    order: BoardSortOrder.RECENT,
  });
}

async function importSource() {
  const archive = new URL('../fixtures/archives/legacy-v4.studio.zip', import.meta.url);
  const path = '/' + BoardArchiveService.typeName + '/ImportBoardArchive';
  const response = await fetch(new URL(path, server.address), {
    method: 'POST',
    headers: {
      [actorHeader]: owner,
      'content-type': 'application/zip',
      'x-studio-command-id': 'import-source',
    },
    body: await readFile(archive),
    signal: AbortSignal.timeout(5_000),
  });
  expect(response.status).toBe(200);
  const { receipt } = fromBinary(
    ImportBoardArchiveResponseSchema,
    new Uint8Array(await response.arrayBuffer()),
  );
  assert.ok(receipt?.outcome.case === 'imported');

  const { boardId } = receipt.outcome.value;
  const board = (await list()).boards.find((entry) => entry.boardId === boardId);
  assert.ok(board);

  return board;
}

function copy(sourceBoardId: string, commandId = 'copy', actorId = owner) {
  return callProtobuf(server.address, actorId, duplicateBoard, { sourceBoardId, commandId });
}

function created(receipt: CatalogCommandReceipt | undefined) {
  assert.ok(receipt?.outcome.case === 'created');

  return receipt.outcome.value;
}

function rejection(receipt: CatalogCommandReceipt | undefined, reason: CatalogRejectionReason) {
  expect(receipt?.outcome).toMatchObject({ case: 'rejected', value: { reason } });
}

function snapshot(boardId: string) {
  return callProtobuf(server.address, owner, getBoardScene, { boardId });
}

async function sourceOfImage(boardId: string) {
  const { results } = await callProtobuf(server.address, owner, getObjectPayloads, {
    boardId,
    objectIds: [imageObjectId],
  });
  const image = results[0]?.result;
  assert.ok(image?.case === 'payload');
  assert.ok(image.value.body.case === 'image');

  const { src } = image.value.body.value;
  assert.ok(src);

  return src;
}

function loadAsset(path: string, actorId = owner) {
  return fetch(new URL(path, server.address), {
    headers: { [actorHeader]: actorId },
    signal: AbortSignal.timeout(5_000),
  });
}

async function trashSource(boardId: string, expectedEntryVersion: bigint | undefined) {
  const { receipt } = await callProtobuf(server.address, owner, manageBoard, {
    boardId,
    expectedEntryVersion,
    commandId: 'trash-source',
    operation: { case: 'lifecycle', value: BoardLifecycleAction.TRASH },
  });
  assert.ok(receipt?.outcome.case === 'changed');

  return receipt.outcome.value.entryVersion;
}

async function assertRewrittenContents(boardId: string, sourceBoardId: string, copiedPath: string) {
  const { results } = await callProtobuf(server.address, owner, getObjectPayloads, {
    boardId,
    objectIds: [documentObjectId, todoObjectId, htmlObjectId],
  });
  const [document, todo, embed] = results.map(({ result }) => {
    assert.equal(result.case, 'payload');
    expect(result.value.payloadVersion).toBe(0n);

    return result.value.body;
  });
  assert.equal(document?.case, 'document');
  expect(document.value.blocks.at(-1)).toMatchObject({
    blockId: 'copy-image',
    props: { url: copiedPath },
    content: {
      kind: {
        case: 'stringValue',
        value: `Open ${copiedPath} or /assets/docs/manual. External ${externalAssetLinks(sourceBoardId).query}.`,
      },
    },
  });

  assert.equal(todo?.case, 'todo');
  expect(todo.value.items).toMatchObject([
    {
      itemId: 'local-source',
      sourceRef: { boardId, objectId: documentObjectId, blockId: 'copy-image' },
    },
    { itemId: 'foreign-source', sourceRef: { boardId: foreignSource, version: 6n } },
  ]);
  expect(todo.value.items[0]?.sourceRef?.version).toBeUndefined();

  assert.equal(embed?.case, 'embed');
  expect(embed.value.html).toBe(mixedCopyMarkup(copiedPath, sourceBoardId));
  expect(embed.value.state).toMatchObject({
    kind: {
      case: 'structValue',
      value: {
        fields: { image: { kind: { case: 'stringValue', value: `Use ${copiedPath} here` } } },
      },
    },
  });
}

test('copies an edited imported board as an independent baseline with rewritten assets and TODO links', async () => {
  const source = await importSource();
  const sourceId = source.boardId;
  const originalPath = await sourceOfImage(sourceId);
  const originalAsset = await loadAsset(originalPath);
  expect(originalAsset.status).toBe(200);
  const originalBytes = new Uint8Array(await originalAsset.arrayBuffer());
  seedCopyReferences(server.databasePath, sourceId, originalPath);
  const move = await callProtobuf(server.address, owner, moveObjects, {
    boardId: sourceId,
    commandId: 'move-source',
    delta: { dx: 38, dy: 0 },
    targets: [{ objectId: releaseShapeId, expectedGeometryVersion: 0n }],
  });
  expect(move.receipt?.outcome.case).toBe('applied');

  await callProtobuf(server.address, owner, FeedbackService.method.applyFeedback, {
    boardId: sourceId,
    commandId: 'source-feedback',
    operation: {
      case: 'create',
      value: {
        text: 'Original discussion',
        anchor: { target: { case: 'boardPoint', value: { x: 3, y: 4 } } },
      },
    },
  });

  const { receipt } = await copy(sourceId);
  const destination = created(receipt);
  const { boardId } = destination;
  expect(boardId).not.toBe(sourceId);
  expect(destination).toMatchObject({
    title: source.title + ' 副本',
    canManage: true,
    pinned: false,
  });

  const original = await snapshot(sourceId);
  const copied = await snapshot(boardId);
  expect(original.scene?.boardRevision).toBe(1n);
  expect(copied.scene?.boardRevision).toBe(0n);
  const expected = original.scene?.objects.map((object) => ({
    ...object,
    geometryVersion: 0n,
    payloadVersion: object.payloadVersion === undefined ? undefined : 0n,
  }));
  expect(copied.scene?.objects).toEqual(expected);
  expect(
    copied.scene?.objects.find(({ objectId }) => objectId === releaseShapeId)?.geometry?.x,
  ).toBe(114);

  const copiedPath = await sourceOfImage(boardId);
  expect(copiedPath).toBe(originalPath.replace('/' + sourceId + '/', '/' + boardId + '/'));
  await assertRewrittenContents(boardId, sourceId, copiedPath);
  expect((await loadAsset(`/studio-archive-assets/${boardId}/unreferenced`)).status).toBe(404);
  expect(retainedArchiveChunks(server.databasePath, boardId)).toEqual([]);
  const history = await callProtobuf(
    server.address,
    owner,
    BoardHistoryService.method.listBoardVersions,
    { boardId },
  );
  expect(history.versions).toMatchObject([{ revision: 0n, kind: BoardVersionKind.BASELINE }]);
  const threads = await callProtobuf(server.address, owner, FeedbackService.method.listThreads, {
    boardId,
  });
  expect(threads.threads).toEqual([]);

  const expectedEntryVersion = await trashSource(sourceId, source.entryVersion);
  await callProtobuf(server.address, owner, purgeBoards, {
    commandId: 'purge-source',
    targets: [{ boardId: sourceId, expectedEntryVersion }],
  });
  await server.restart();

  expect((await copy(sourceId)).receipt).toEqual(receipt);
  expect((await list()).boards.map((entry) => entry.boardId)).toEqual([boardId]);
  expect((await loadAsset(originalPath)).status).toBe(404);
  const copiedAsset = await loadAsset(copiedPath);
  expect(copiedAsset.status).toBe(200);
  expect(new Uint8Array(await copiedAsset.arrayBuffer())).toEqual(originalBytes);
  expect((await snapshot(boardId)).scene?.objects).toEqual(copied.scene?.objects);
});

test('requires an active recorded owner and does not assign a legacy reader ownership', async () => {
  const source = await importSource();
  grantCatalogEditor(server.databasePath, source.boardId, otherEditor);
  grantCopyViewer(server.databasePath, source.boardId, viewer);
  const editors = await copy(source.boardId, 'unauthorized-editor', otherEditor);
  const readers = await copy(source.boardId, 'unauthorized-reader', viewer);
  const legacy = await copy(mainBoardId, 'unowned', editorId);
  rejection(editors.receipt, CatalogRejectionReason.FORBIDDEN);
  rejection(readers.receipt, CatalogRejectionReason.FORBIDDEN);
  rejection(legacy.receipt, CatalogRejectionReason.FORBIDDEN);
  expect(
    (await sendProtobuf(server.address, editorId, getBoardScene, { boardId: mainBoardId })).status,
  ).toBe(200);

  await trashSource(source.boardId, source.entryVersion);
  rejection((await copy(source.boardId, 'trashed')).receipt, CatalogRejectionReason.STATE_CHANGED);
  expect((await list()).boards).toEqual([]);
});

test('reuses a creation-shaped receipt only for the same copy request', async () => {
  const source = await importSource();
  const [first, repeat] = await Promise.all([copy(source.boardId), copy(source.boardId)]);
  expect(repeat.receipt).toEqual(first.receipt);
  const board = created(first.receipt);
  const lookup = await callProtobuf(server.address, owner, getCatalogCommandReceipt, {
    commandId: 'copy',
  });
  expect(lookup.result).toEqual({ case: 'receipt', value: first.receipt });

  const recreate = await callProtobuf(server.address, owner, createBoard, {
    commandId: 'copy',
    title: board.title,
  });
  rejection(recreate.receipt, CatalogRejectionReason.COMMAND_ID_REUSE);
  const management = await callProtobuf(server.address, owner, manageBoard, {
    boardId: board.boardId,
    expectedEntryVersion: board.entryVersion,
    commandId: 'copy',
    operation: { case: 'pinned', value: true },
  });
  rejection(management.receipt, CatalogRejectionReason.COMMAND_ID_REUSE);
  rejection((await copy(board.boardId)).receipt, CatalogRejectionReason.COMMAND_ID_REUSE);
  expect((await list()).boards).toHaveLength(2);
});

test('rejects a missing required same-board asset without publishing a new board', async () => {
  const source = await importSource();
  removeCopyAssets(server.databasePath, source.boardId);
  const before = copyCounts(server.databasePath);
  const { receipt } = await copy(source.boardId);
  rejection(receipt, CatalogRejectionReason.STATE_CHANGED);
  expect(copyCounts(server.databasePath)).toEqual(before);
});

test.each(['asset', 'receipt'] as const)('rolls back every write on %s failure', async (stage) => {
  const source = await importSource();
  const before = copyCounts(server.databasePath);
  failCopyWrite(server.databasePath, stage);
  const result = await sendProtobuf(server.address, owner, duplicateBoard, {
    sourceBoardId: source.boardId,
    commandId: 'failed-copy',
  });
  expect(result.status).toBe(500);
  expect(copyCounts(server.databasePath)).toEqual(before);
  const lookup = await callProtobuf(server.address, owner, getCatalogCommandReceipt, {
    commandId: 'failed-copy',
  });
  expect(lookup.result.case).toBe('notRecorded');
  expect(server.errors).toHaveLength(1);
});
