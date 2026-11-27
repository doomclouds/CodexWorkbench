import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fromBinary } from '@bufbuild/protobuf';
import {
  BoardArchiveService,
  ImportBoardArchiveResponseSchema,
} from '@codexworkbench/luming-studio-ii-contracts/archives/service';
import { BoardCatalogService } from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import { BoardEditService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import {
  BoardExportFormat,
  BoardExportRejectionReason,
  WhiteboardService,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { expect, test } from 'vitest';
import { pngImage } from '../fixtures/board-image-bytes.js';
import { grantCatalogEditor } from '../support/catalog-lifecycle-database.js';
import {
  actorHeader,
  callWhiteboard,
  sendWhiteboardRequest,
} from '../support/whiteboard-client.js';
import { editorId, teammateId } from '../support/whiteboard-database.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

const server = useWhiteboardTestServer();
const { exportBoard, moveObjects, getObjectPayloads, getBoardScene } = WhiteboardService.method;
const geometry = { x: 32, y: 64, width: 100, height: 80, rotation: 0 };

async function newBoard() {
  const { receipt } = await callWhiteboard(
    server.address,
    editorId,
    BoardCatalogService.method.createBoard,
    {
      commandId: 'backup-board',
      title: 'Whiteboard backup',
    },
  );
  assert.equal(receipt?.outcome.case, 'created');

  return receipt.outcome.value.boardId;
}

async function reimport(content: Uint8Array) {
  const route = '/' + BoardArchiveService.typeName + '/ImportBoardArchive';
  const response = await fetch(new URL(route, server.address), {
    method: 'POST',
    headers: {
      [actorHeader]: editorId,
      'content-type': 'application/zip',
      'x-studio-command-id': 'import-new-backup',
    },
    body: Buffer.from(content),
    signal: AbortSignal.timeout(5_000),
  });
  expect(response.status).toBe(200);
  const reply = fromBinary(
    ImportBoardArchiveResponseSchema,
    new Uint8Array(await response.arrayBuffer()),
  );
  assert.equal(reply.receipt?.outcome.case, 'imported');

  return reply.receipt.outcome.value.boardId;
}

test('only the owner can produce a v4 archive and import its latest scene with exact media bytes', async () => {
  const boardId = await newBoard();
  grantCatalogEditor(server.databasePath, boardId, teammateId);
  const { receipt } = await callWhiteboard(
    server.address,
    editorId,
    BoardEditService.method.attachBoardImage,
    {
      boardId,
      commandId: 'backup-image',
      objectId: 'drawing',
      displayName: 'Drawing.png',
      geometry,
      content: pngImage,
    },
  );
  expect(receipt?.outcome.case).toBe('applied');
  const moved = await callWhiteboard(server.address, editorId, moveObjects, {
    boardId,
    commandId: 'backup-position',
    delta: { dx: 5, dy: -4 },
    targets: [{ objectId: 'drawing', expectedGeometryVersion: 0n }],
  });
  expect(moved.receipt?.outcome.case).toBe('applied');

  const request = {
    boardId,
    expectedRevision: 2n,
    scope: { case: 'whole' as const, value: {} },
    format: BoardExportFormat.ZIP,
  };
  const foreignEditor = await sendWhiteboardRequest(
    server.address,
    teammateId,
    exportBoard,
    request,
  );
  expect(foreignEditor.status).toBe(403);
  const selection = await callWhiteboard(server.address, editorId, exportBoard, {
    ...request,
    scope: { case: 'selection', value: { objectIds: ['drawing'] } },
  });
  expect(selection.result).toMatchObject({
    case: 'rejected',
    value: { reason: BoardExportRejectionReason.INVALID_SELECTION },
  });
  const stale = await callWhiteboard(server.address, editorId, exportBoard, {
    ...request,
    expectedRevision: 1n,
  });
  expect(stale.result).toMatchObject({ case: 'stale', value: { revision: 2n } });

  const backup = await callWhiteboard(server.address, editorId, exportBoard, request);
  assert.equal(backup.result.case, 'file');
  const file = backup.result.value;
  expect(file).toMatchObject({
    filename: 'Whiteboard backup.studio.zip',
    mimeType: 'application/zip',
    revision: 2n,
  });
  expect([...file.content.slice(0, 4)]).toEqual([80, 75, 3, 4]);
  const importedId = await reimport(file.content);
  expect(importedId).not.toBe(boardId);
  const imported = await callWhiteboard(server.address, editorId, getBoardScene, {
    boardId: importedId,
  });
  expect(imported.scene?.objects).toMatchObject([
    { objectId: 'drawing', geometry: { x: 37, y: 60 } },
  ]);

  const payloads = await callWhiteboard(server.address, editorId, getObjectPayloads, {
    boardId: importedId,
    objectIds: ['drawing'],
  });
  const payload = payloads.results[0]?.result;
  assert.equal(payload?.case, 'payload');
  const { body } = payload.value;
  assert.equal(body.case, 'image');
  expect(body.value.src).toBe('/studio-archive-assets/' + importedId + '/image-drawing');
  assert.ok(body.value.src);
  const media = await fetch(new URL(body.value.src, server.address), {
    headers: { [actorHeader]: editorId },
    signal: AbortSignal.timeout(5_000),
  });
  expect(media.status).toBe(200);
  expect(new Uint8Array(await media.arrayBuffer())).toEqual(pngImage);
});
