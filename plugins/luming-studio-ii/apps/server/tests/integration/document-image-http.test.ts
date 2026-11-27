import assert from 'node:assert/strict';
import { fromBinary } from '@bufbuild/protobuf';
import {
  BoardArchiveService,
  ImportBoardArchiveResponseSchema,
} from '@codexworkbench/luming-studio-ii-contracts/archives/service';
import { BoardCatalogService } from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import {
  BoardEditRejectionReason,
  BoardEditService,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import {
  BoardExportFormat,
  WhiteboardService,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { expect, test } from 'vitest';
import { pngImage, svgImage } from '../fixtures/board-image-bytes.js';
import { archiveRowCounts } from '../support/archive-database.js';
import { actorHeader, callWhiteboard } from '../support/whiteboard-client.js';
import {
  documentId,
  editorId,
  mainBoardId,
  outsiderId,
  shapeId,
  viewerId,
} from '../support/whiteboard-database.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

const server = useWhiteboardTestServer();
const { createBoard } = BoardCatalogService.method;
const { editBoardGeometry, editObjectContent, uploadBoardDocumentImage } = BoardEditService.method;
const { getBoardScene, getObjectPayloads, exportBoard } = WhiteboardService.method;
const archivePath = '/' + BoardArchiveService.typeName + '/ImportBoardArchive';
const owner = 'document-image-owner';
const ownedDocumentId = 'uploaded-document';
const title = 'Document with a saved image';

async function createDocumentBoard() {
  const created = await callWhiteboard(server.address, owner, createBoard, {
    commandId: 'document-image-board',
    title,
  });
  const catalog = created.receipt?.outcome;
  assert.equal(catalog?.case, 'created');
  const { boardId } = catalog.value;
  const added = await callWhiteboard(server.address, owner, editBoardGeometry, {
    boardId,
    commandId: 'document-image-add-document',
    operation: {
      case: 'create',
      value: {
        object: {
          objectId: ownedDocumentId,
          kind: 'document',
          label: title,
          geometry: { x: 10, y: 10, width: 320, height: 240, rotation: 0 },
        },
        initialPayload: {
          body: { case: 'document', value: { title, schemaVersion: 1, blocks: [] } },
        },
      },
    },
  });
  assert.equal(added.receipt?.outcome.case, 'applied');

  return boardId;
}

async function fetchImage(assetUrl: string, actorId: string) {
  return fetch(new URL(assetUrl, server.address), {
    headers: { [actorHeader]: actorId },
    signal: AbortSignal.timeout(5_000),
  });
}

async function submitImage(boardId: string, objectId: string, actorId: string) {
  return callWhiteboard(server.address, actorId, uploadBoardDocumentImage, {
    boardId,
    commandId: 'document-image-upload',
    objectId,
    content: pngImage,
  });
}

async function assertStoredImage(url: string) {
  const asset = await fetchImage(url, owner);
  expect(asset.status).toBe(200);
  expect(asset.headers.get('content-type')).toBe('image/png');
  expect(new Uint8Array(await asset.arrayBuffer())).toEqual(pngImage);
}

async function commitDocument(boardId: string, assetUrl: string) {
  const result = await callWhiteboard(server.address, owner, editObjectContent, {
    boardId,
    commandId: 'document-image-save-content',
    objectId: ownedDocumentId,
    expectedPayloadVersion: 0n,
    edit: {
      case: 'document',
      value: {
        title,
        schemaVersion: 1,
        blocks: [{ blockId: 'document-image', type: 'image', props: { url: assetUrl } }],
      },
    },
  });
  expect(result.receipt?.outcome).toMatchObject({ case: 'applied', value: { boardRevision: 2n } });
}

async function copyArchive(boardId: string) {
  const exported = await callWhiteboard(server.address, owner, exportBoard, {
    boardId,
    expectedRevision: 2n,
    format: BoardExportFormat.ZIP,
    scope: { case: 'whole', value: {} },
  });
  assert.equal(exported.result.case, 'file');
  const response = await fetch(new URL(archivePath, server.address), {
    method: 'POST',
    headers: {
      [actorHeader]: owner,
      'content-type': 'application/zip',
      'x-studio-command-id': 'document-image-roundtrip',
    },
    body: new Uint8Array(exported.result.value.content),
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(response.status, 200);
  const imported = fromBinary(
    ImportBoardArchiveResponseSchema,
    new Uint8Array(await response.arrayBuffer()),
  );
  const outcome = imported.receipt?.outcome;
  assert.equal(outcome?.case, 'imported');

  return outcome.value.boardId;
}

async function readDocumentImage(boardId: string) {
  const response = await callWhiteboard(server.address, owner, getObjectPayloads, {
    boardId,
    objectIds: [ownedDocumentId],
  });
  const result = response.results[0]?.result;
  assert.ok(result?.case === 'payload' && result.value.body.case === 'document');
  const image = result.value.body.value.blocks[0]?.props?.url;
  assert.ok(typeof image === 'string');

  return image;
}

test('stores only an owned file, replays its URL, and carries a saved document image through backup and import', async () => {
  const boardId = await createDocumentBoard();
  const before = archiveRowCounts(server.databasePath);
  const submitted = await submitImage(boardId, ownedDocumentId, owner);
  expect(submitted.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: { boardRevision: 1n, changedObjects: [], changedPayloads: [], objectOrder: [] },
  });
  const { assetUrl } = submitted;
  assert.ok(assetUrl);
  expect(assetUrl).toMatch('/studio-archive-assets/' + boardId + '/document-image-');
  await assertStoredImage(assetUrl);
  expect((await fetchImage(assetUrl, outsiderId)).status).toBe(404);

  await server.restart();
  expect(await submitImage(boardId, ownedDocumentId, owner)).toEqual(submitted);
  expect(archiveRowCounts(server.databasePath)).toEqual({
    ...before,
    assets: Number(before?.assets) + 1,
  });
  const current = await callWhiteboard(server.address, owner, getBoardScene, { boardId });
  expect(current.scene).toMatchObject({
    boardRevision: 1n,
    objects: [{ objectId: ownedDocumentId, payloadVersion: 0n }],
  });

  await commitDocument(boardId, assetUrl);
  expect(await readDocumentImage(boardId)).toBe(assetUrl);
  const importedBoardId = await copyArchive(boardId);
  expect(importedBoardId).not.toBe(boardId);
  const importedUrl = await readDocumentImage(importedBoardId);
  expect(importedUrl).toContain('/studio-archive-assets/' + importedBoardId + '/');
  await assertStoredImage(importedUrl);
});

test('rejects read-only actors, non-documents, unsafe formats and reuse with different bytes', async () => {
  const readOnly = await submitImage(mainBoardId, documentId, viewerId);
  expect(readOnly.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.FORBIDDEN },
  });
  expect(readOnly.assetUrl).toBeUndefined();
  const nonDocument = await submitImage(mainBoardId, shapeId, editorId);
  expect(nonDocument.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.UNSUPPORTED_KIND },
  });
  const badImage = await callWhiteboard(server.address, editorId, uploadBoardDocumentImage, {
    boardId: mainBoardId,
    objectId: documentId,
    commandId: 'document-image-invalid',
    content: new TextEncoder().encode('<svg onload="script()"/>'),
  });
  expect(badImage.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.INVALID_IMAGE },
  });
  expect(badImage.assetUrl).toBeUndefined();

  const accepted = await submitImage(mainBoardId, documentId, editorId);
  expect(accepted.receipt?.outcome.case).toBe('applied');
  const reused = await callWhiteboard(server.address, editorId, uploadBoardDocumentImage, {
    boardId: mainBoardId,
    objectId: documentId,
    commandId: 'document-image-upload',
    content: new Uint8Array([1, 2, 3]),
  });
  expect(reused.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.COMMAND_ID_REUSE },
  });
  expect(reused.assetUrl).toBeUndefined();
});

test('stores, backs up and serves a 20 MiB SVG attached to a document', async () => {
  const boardId = await createDocumentBoard();
  const size = 20 * 1024 * 1024;
  const content = svgImage(size);
  const input = { boardId, objectId: ownedDocumentId, commandId: 'upload-document-vector' };
  const oversized = await callWhiteboard(server.address, owner, uploadBoardDocumentImage, {
    ...input,
    content: svgImage(size + 1),
  });
  expect(oversized.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.TOO_LARGE },
  });
  const saved = await callWhiteboard(server.address, owner, uploadBoardDocumentImage, {
    ...input,
    content,
  });
  assert.equal(saved.receipt?.outcome.case, 'applied');
  assert.ok(saved.assetUrl);
  await commitDocument(boardId, saved.assetUrl);

  const importedId = await copyArchive(boardId);
  const importedUrl = await readDocumentImage(importedId);
  const asset = await fetchImage(importedUrl, owner);
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('content-type'), 'image/svg+xml');
  assert.deepEqual(new Uint8Array(await asset.arrayBuffer()), content);
  assert.equal((await fetchImage(importedUrl, outsiderId)).status, 404);
});
