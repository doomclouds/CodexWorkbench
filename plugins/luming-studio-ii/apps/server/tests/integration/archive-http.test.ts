import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fromBinary } from '@bufbuild/protobuf';
import {
  ArchiveImportRejectionReason,
  BoardArchiveService,
  ImportBoardArchiveResponseSchema,
} from '@codexworkbench/luming-studio-ii-contracts/archives/service';
import {
  BoardCatalogService,
  BoardSortOrder,
} from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import { WhiteboardService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { expect, test } from 'vitest';
import {
  archiveReceiptWriteFailure,
  archiveRowCounts,
  rejectArchiveReceiptInserts,
  retainedArchiveChunks,
} from '../support/archive-database.js';
import { actorHeader, callWhiteboard as callProtobuf } from '../support/whiteboard-client.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

const server = useWhiteboardTestServer();
const ownerId = 'archive-editor';
const outsiderId = 'archive-outsider';
const archivePath = '/' + BoardArchiveService.typeName + '/ImportBoardArchive';
const { getArchiveImportReceipt } = BoardArchiveService.method;
const { getBoardScene, getObjectPayloads } = WhiteboardService.method;
const { listBoards } = BoardCatalogService.method;
const fixtures = new URL('../fixtures/archives/', import.meta.url);
const currentArchive = new URL('legacy-v4.studio.zip', fixtures);
const obsoleteArchive = new URL('obsolete-v3.studio.zip', fixtures);
const documentPathsArchive = new URL('document-paths-v4.studio.zip', fixtures);
const requestTimeoutMs = 5_000;

async function upload(file: URL, commandId: string, actorId: string | null = ownerId) {
  const headers = new Headers({
    'content-type': 'application/zip',
    'x-studio-command-id': commandId,
  });

  if (actorId) {
    headers.set(actorHeader, actorId);
  }

  return fetch(new URL(archivePath, server.address), {
    method: 'POST',
    headers,
    body: await readFile(file),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
}

async function importReceipt(response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('application/protobuf');
  const bytes = new Uint8Array(await response.arrayBuffer());
  const { receipt } = fromBinary(ImportBoardArchiveResponseSchema, bytes);
  assert.ok(receipt);

  return receipt;
}

function listImportedBoards() {
  return callProtobuf(server.address, ownerId, listBoards, {
    pageSize: 10,
    order: BoardSortOrder.RECENT,
  });
}

function loadArchiveAsset(path: string, actorId: string) {
  return fetch(new URL(path, server.address), {
    headers: { [actorHeader]: actorId },
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
}

test('publishes the current archive with its live scene, selected assets and exact source bytes', async () => {
  const commandId = 'import-current';
  const receipt = await importReceipt(await upload(currentArchive, commandId));
  assert.equal(receipt.outcome.case, 'imported');
  const { boardId, title } = receipt.outcome.value;

  expect(title).toBe('产品发布工作台');
  const catalog = await listImportedBoards();
  expect(catalog.boards).toMatchObject([{ boardId, title }]);

  const { scene } = await callProtobuf(server.address, ownerId, getBoardScene, { boardId });
  expect(scene?.access?.canEdit).toBe(true);
  expect(scene?.objects.map(({ kind }) => kind).sort()).toEqual([
    'document',
    'image',
    'shape',
    'shape',
    'shape',
    'text',
    'todo',
  ]);
  expect(scene?.objects.find(({ objectId }) => objectId === 'release-scope')?.geometry?.x).toBe(76);

  const payloads = await callProtobuf(server.address, ownerId, getObjectPayloads, {
    boardId,
    objectIds: ['release-document', 'release-checklist', 'release-image'],
  });
  expect(payloads.results.map(({ result }) => result.case)).toEqual([
    'payload',
    'payload',
    'payload',
  ]);
  const image = payloads.results[2]?.result;
  assert.ok(image?.case === 'payload');
  const { body } = image.value;
  assert.ok(body.case === 'image');
  const imagePath = body.value.src;
  assert.ok(imagePath);
  expect(imagePath).toMatch(/^\/studio-archive-assets\//u);
  const asset = await loadArchiveAsset(imagePath, ownerId);
  expect(asset.status).toBe(200);
  expect(asset.headers.get('content-type')).toBe('image/svg+xml');
  expect(asset.headers.get('x-content-type-options')).toBe('nosniff');
  expect(await asset.text()).toContain('<svg');
  expect((await loadArchiveAsset(imagePath, outsiderId)).status).toBe(404);
  expect(Buffer.concat(retainedArchiveChunks(server.databasePath, boardId))).toEqual(
    await readFile(currentArchive),
  );
});

test('preserves ordinary document paths and rewrites exact declared archive asset paths', async () => {
  const receipt = await importReceipt(await upload(documentPathsArchive, 'import-document-paths'));
  assert.equal(receipt.outcome.case, 'imported');
  const { boardId } = receipt.outcome.value;
  const result = await callProtobuf(server.address, ownerId, getObjectPayloads, {
    boardId,
    objectIds: ['release-notes'],
  });
  const document = result.results[0]?.result;
  assert.ok(document?.case === 'payload');
  const { body } = document.value;
  assert.ok(body.case === 'document');

  const assetPath = `/studio-archive-assets/${boardId}/cover`;
  expect(body.value.blocks[0]?.content?.kind).toEqual({
    case: 'stringValue',
    value: `Read /assets/docs/manual or /assets/release-board/cover.svg. See ${assetPath} for the bundled cover.`,
  });
  expect((await loadArchiveAsset(assetPath, ownerId)).status).toBe(200);
});

test('rejects older backup formats and exposes the same rejection through receipt lookup', async () => {
  const commandId = 'reject-obsolete';
  const receipt = await importReceipt(await upload(obsoleteArchive, commandId));
  expect(receipt.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: ArchiveImportRejectionReason.UNSUPPORTED_VERSION },
  });
  expect((await listImportedBoards()).boards).toEqual([]);

  const lookup = await callProtobuf(server.address, ownerId, getArchiveImportReceipt, {
    commandId,
  });
  expect(lookup.result).toEqual({ case: 'receipt', value: receipt });
});

test('replays an imported receipt across server restarts and scopes command identity to its actor', async () => {
  const commandId = 'retry-import';
  const receipt = await importReceipt(await upload(currentArchive, commandId));
  assert.equal(receipt.outcome.case, 'imported');

  await server.restart();

  const replayed = await importReceipt(await upload(currentArchive, commandId));
  expect(replayed).toEqual(receipt);
  expect((await listImportedBoards()).boards).toHaveLength(1);
  const otherFile = await importReceipt(await upload(obsoleteArchive, commandId));
  expect(otherFile.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: ArchiveImportRejectionReason.COMMAND_ID_REUSE },
  });
  const lookup = await callProtobuf(server.address, outsiderId, getArchiveImportReceipt, {
    commandId,
  });
  expect(lookup.result).toMatchObject({ case: 'notRecorded', value: { commandId } });
  expect((await upload(currentArchive, commandId, null)).status).toBe(401);
});

test('rolls back the whole publication when the receipt insert fails', async () => {
  const countsBefore = archiveRowCounts(server.databasePath);
  rejectArchiveReceiptInserts(server.databasePath);

  const commandId = 'archive-receipt-failure';
  const response = await upload(currentArchive, commandId);

  expect(response.status).toBe(500);
  expect(await response.text()).toBe('');
  expect(server.errors).toHaveLength(1);
  expect(server.errors[0]).toMatchObject({ message: archiveReceiptWriteFailure });
  expect(archiveRowCounts(server.databasePath)).toEqual(countsBefore);
  const lookup = await callProtobuf(server.address, ownerId, getArchiveImportReceipt, {
    commandId,
  });
  expect(lookup.result).toMatchObject({ case: 'notRecorded', value: { commandId } });
});
