import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  BoardArchiveService,
  BoardAssetRejection,
} from '@codexworkbench/luming-studio-ii-contracts/archives/service';
import { BoardCatalogService } from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import { FeedbackService } from '@codexworkbench/luming-studio-ii-contracts/feedback/service';
import { BoardEditService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import { expect, test } from 'vitest';
import { pngImage, svgImage } from '../fixtures/board-image-bytes.js';
import { rejectArchiveAssetDeletion, removedArchiveAsset } from '../support/archive-database.js';
import { grantCatalogEditor } from '../support/catalog-lifecycle-database.js';
import {
  actorHeader,
  callWhiteboard,
  sendWhiteboardRequest,
} from '../support/whiteboard-client.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

const server = useWhiteboardTestServer();
const owner = 'asset-owner';
const other = 'different-owner';
const { importBoardAsset, listBoardAssets, deleteBoardAsset } = BoardArchiveService.method;
const { editBoardGeometry, editObjectContent } = BoardEditService.method;

async function board(actorId: string, commandId: string) {
  const { receipt } = await callWhiteboard(
    server.address,
    actorId,
    BoardCatalogService.method.createBoard,
    { commandId, title: 'Board asset tests' },
  );
  assert.equal(receipt?.outcome.case, 'created');

  return receipt.outcome.value.boardId;
}

async function addAsset(boardId: string, commandId: string, actorId = owner) {
  const result = await callWhiteboard(server.address, actorId, importBoardAsset, {
    boardId,
    commandId,
    content: pngImage,
  });
  assert.equal(result.result.case, 'asset');

  return result.result.value;
}

function list(boardId: string, cursor?: string, limit?: number) {
  return callWhiteboard(server.address, owner, listBoardAssets, { boardId, cursor, limit });
}

function remove(boardId: string, assetId: string) {
  return callWhiteboard(server.address, owner, deleteBoardAsset, { boardId, assetId });
}

function readAsset(src: string, actorId = owner) {
  return fetch(new URL(src, server.address), {
    headers: { [actorHeader]: actorId },
    signal: AbortSignal.timeout(5_000),
  });
}

test('paginates only the active owner’s own board assets and keeps stable import identity', async () => {
  const boardId = await board(owner, 'owner-board');
  const foreignBoard = await board(other, 'foreign-board');
  grantCatalogEditor(server.databasePath, boardId, other);
  const first = await addAsset(boardId, 'one');
  const second = await addAsset(boardId, 'two');
  const foreign = await addAsset(foreignBoard, 'three', other);
  expect(await addAsset(boardId, 'one')).toEqual(first);
  expect(
    (
      await callWhiteboard(server.address, owner, importBoardAsset, {
        boardId,
        commandId: 'one',
        content: svgImage(220),
      })
    ).result,
  ).toEqual({ case: 'rejected', value: BoardAssetRejection.COMMAND_ID_REUSE });
  expect(first).toMatchObject({ mediaType: 'image/png', byteLength: pngImage.byteLength });
  expect(first.src).toBe(`/studio-archive-assets/${boardId}/${first.assetId}`);
  expect(foreign.src).not.toBe(first.src);
  expect((await readAsset(first.src)).status).toBe(200);
  expect((await readAsset(first.src, other)).status).toBe(200);
  expect((await readAsset(foreign.src)).status).toBe(404);

  const page = await list(boardId, undefined, 1);
  expect(page.assets).toHaveLength(1);
  expect(page.nextCursor).toBe(page.assets[0]?.assetId);
  const tail = await list(boardId, page.nextCursor, 1);
  expect(tail.nextCursor).toBeUndefined();
  expect([...page.assets, ...tail.assets]).toEqual(
    [first, second].sort((left, right) => left.assetId.localeCompare(right.assetId)),
  );
  expect(
    (await sendWhiteboardRequest(server.address, other, listBoardAssets, { boardId })).status,
  ).toBe(403);
  expect(
    (await sendWhiteboardRequest(server.address, owner, listBoardAssets, { boardId: foreignBoard }))
      .status,
  ).toBe(403);
  expect(
    (
      await sendWhiteboardRequest(server.address, owner, listBoardAssets, {
        boardId,
        cursor: '../asset',
      })
    ).status,
  ).toBe(400);
  expect(
    (await sendWhiteboardRequest(server.address, owner, listBoardAssets, { boardId, limit: 101 }))
      .status,
  ).toBe(400);
  expect(
    (
      await sendWhiteboardRequest(server.address, other, importBoardAsset, {
        boardId,
        commandId: 'denied',
        content: pngImage,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await sendWhiteboardRequest(server.address, other, deleteBoardAsset, {
        boardId,
        assetId: first.assetId,
      })
    ).status,
  ).toBe(403);
});

test('rejects unsafe media and removes only unused assets from the active catalog', async () => {
  const boardId = await board(owner, 'asset-cleanup');
  const invalid = await callWhiteboard(server.address, owner, importBoardAsset, {
    boardId,
    commandId: 'html-media',
    content: new TextEncoder().encode('<html><script>alert(1)</script></html>'),
  });
  expect(invalid.result).toEqual({ case: 'rejected', value: BoardAssetRejection.INVALID_MEDIA });
  const asset = await addAsset(boardId, 'unused');
  await server.restart();
  expect((await list(boardId)).assets).toEqual([asset]);
  expect((await remove(boardId, asset.assetId)).result).toEqual({
    case: 'removed',
    value: asset.assetId,
  });
  expect((await remove(boardId, asset.assetId)).result).toEqual({
    case: 'removed',
    value: asset.assetId,
  });
  expect((await remove(boardId, 'absent')).result).toEqual({
    case: 'rejected',
    value: BoardAssetRejection.NOT_FOUND,
  });
  expect((await list(boardId)).assets).toEqual([]);
  expect(removedArchiveAsset(server.databasePath, boardId, asset.assetId)).toBe(true);
  expect((await readAsset(asset.src)).status).toBe(404);
  const replay = await callWhiteboard(server.address, owner, importBoardAsset, {
    boardId,
    commandId: 'unused',
    content: pngImage,
  });
  expect(replay.result).toEqual({ case: 'rejected', value: BoardAssetRejection.NOT_FOUND });
});

test('serves detected video bytes and enforces the media request budget', async () => {
  const boardId = await board(owner, 'media-formats');
  const content = new Uint8Array(
    await readFile(new URL('../fixtures/blue-frame.webm', import.meta.url)),
  );
  const { result } = await callWhiteboard(server.address, owner, importBoardAsset, {
    boardId,
    commandId: 'video',
    content,
  });
  assert.equal(result.case, 'asset');
  expect(result.value).toMatchObject({ mediaType: 'video/webm', byteLength: content.byteLength });
  const media = await readAsset(result.value.src);
  expect(media.headers.get('content-type')).toBe('video/webm');
  expect(new Uint8Array(await media.arrayBuffer())).toEqual(content);
  const tooLarge = await callWhiteboard(server.address, owner, importBoardAsset, {
    boardId,
    commandId: 'oversized',
    content: new Uint8Array(20 * 1024 * 1024 + 1),
  });
  expect(tooLarge.result).toEqual({ case: 'rejected', value: BoardAssetRejection.TOO_LARGE });
  expect((await list(boardId)).assets).toEqual([result.value]);
});

test('rolls back the recycle copy if removal fails before commit', async () => {
  const boardId = await board(owner, 'rollback');
  const asset = await addAsset(boardId, 'rollback-media');
  rejectArchiveAssetDeletion(server.databasePath);

  const result = await sendWhiteboardRequest(server.address, owner, deleteBoardAsset, {
    boardId,
    assetId: asset.assetId,
  });
  expect(result.status).toBe(500);
  expect(server.errors[0]).toMatchObject({ message: 'Injected archive asset deletion failure' });
  expect((await list(boardId)).assets).toEqual([asset]);
  expect((await readAsset(asset.src)).status).toBe(200);
  expect(removedArchiveAsset(server.databasePath, boardId, asset.assetId)).toBe(false);
});

test('preserves active document, historical document and feedback references', async () => {
  const boardId = await board(owner, 'retained-references');
  const objectId = 'document-object';
  const asset = await addAsset(boardId, 'document-media');
  const { receipt: created } = await callWhiteboard(server.address, owner, editBoardGeometry, {
    boardId,
    commandId: 'create-document',
    operation: {
      case: 'create',
      value: {
        object: {
          objectId,
          kind: 'document',
          label: 'Document',
          geometry: { x: 10, y: 10, width: 320, height: 240, rotation: 0 },
        },
        initialPayload: {
          body: { case: 'document', value: { title: 'Document', schemaVersion: 1, blocks: [] } },
        },
      },
    },
  });
  assert.equal(created?.outcome.case, 'applied');
  const { receipt } = await callWhiteboard(server.address, owner, editObjectContent, {
    boardId,
    objectId,
    commandId: 'add-media-reference',
    expectedPayloadVersion: 0n,
    edit: {
      case: 'document',
      value: {
        title: 'Document',
        schemaVersion: 1,
        blocks: [{ blockId: 'media', type: 'image', props: { url: asset.src } }],
      },
    },
  });
  expect(receipt?.outcome.case).toBe('applied');
  expect((await remove(boardId, asset.assetId)).result).toEqual({
    case: 'rejected',
    value: BoardAssetRejection.REFERENCE_IN_USE,
  });
  const { receipt: cleared } = await callWhiteboard(server.address, owner, editObjectContent, {
    boardId,
    objectId,
    commandId: 'clear-media-reference',
    expectedPayloadVersion: 1n,
    edit: { case: 'document', value: { title: 'Document', schemaVersion: 1, blocks: [] } },
  });
  assert.equal(cleared?.outcome.case, 'applied');
  expect((await remove(boardId, asset.assetId)).result).toEqual({
    case: 'rejected',
    value: BoardAssetRejection.REFERENCE_IN_USE,
  });
  const feedback = await addAsset(boardId, 'feedback-media');
  const { receipt: thread } = await callWhiteboard(
    server.address,
    owner,
    FeedbackService.method.applyFeedback,
    {
      boardId,
      commandId: 'create-media-note',
      operation: {
        case: 'create',
        value: {
          text: 'Media: ' + feedback.src,
          anchor: { target: { case: 'boardPoint', value: { x: 10, y: 10 } } },
        },
      },
    },
  );
  assert.equal(thread?.outcome.case, 'applied');
  expect((await remove(boardId, feedback.assetId)).result).toEqual({
    case: 'rejected',
    value: BoardAssetRejection.REFERENCE_IN_USE,
  });
  expect((await readAsset(asset.src)).status).toBe(200);
  expect((await readAsset(feedback.src)).status).toBe(200);
});
