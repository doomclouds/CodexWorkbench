import { BoardEditService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import { BoardHistoryService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/history';
import {
  BoardExportFormat,
  WhiteboardService,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { pngImage } from '../fixtures/board-image-bytes.js';
import { rejectImageReceipt } from '../support/board-image-database.js';
import {
  actorHeader,
  callWhiteboard,
  sendWhiteboardRequest,
} from '../support/whiteboard-client.js';
import {
  editorId,
  mainBoardId,
  outsiderId,
  secondBoardId,
  viewerId,
} from '../support/whiteboard-database.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

const server = useWhiteboardTestServer();
const { attachBoardImage, editBoardGeometry, getBoardEditReceipt } = BoardEditService.method;
const { exportBoardVersion } = BoardHistoryService.method;
const { getBoardScene, getObjectPayloads } = WhiteboardService.method;
const objectId = 'inserted-image';
const commandId = 'insert-image';
const imageAssetId = 'image-inserted-image';
const assetPrefix = '/studio-archive-assets/';
const imageInput = {
  boardId: mainBoardId,
  commandId,
  objectId,
  displayName: '插入的图片.png',
  geometry: { x: 24, y: 128, width: 200, height: 300, rotation: 0 },
  content: pngImage,
};
const source = assetPrefix + mainBoardId + '/' + imageAssetId;

function downloadAsset(actorId: string, asset: string) {
  return fetch(new URL(asset, server.address), {
    headers: { [actorHeader]: actorId },
    signal: AbortSignal.timeout(5_000),
  });
}

async function assertImageMissing() {
  const scene = await callWhiteboard(server.address, viewerId, getBoardScene, {
    boardId: mainBoardId,
  });
  assert.equal(scene.scene?.boardRevision, 0n);
  assert.equal(
    scene.scene.objects.some((object) => object.objectId === objectId),
    false,
  );
  const missing = await downloadAsset(viewerId, source);
  assert.equal(missing.status, 404);
}

test('publishes the image and receipt once and serves stored bytes after restart', async () => {
  const saved = await callWhiteboard(server.address, editorId, attachBoardImage, imageInput);
  assert.equal(saved.receipt?.outcome.case, 'applied');
  assert.equal(saved.receipt.outcome.value.boardRevision, 1n);

  const repeated = await callWhiteboard(server.address, editorId, attachBoardImage, imageInput);
  assert.deepEqual(repeated, saved);
  await server.restart();

  const recorded = await callWhiteboard(server.address, editorId, getBoardEditReceipt, {
    boardId: mainBoardId,
    commandId,
  });
  assert.deepEqual(recorded.receipt, saved.receipt);
  const scene = await callWhiteboard(server.address, viewerId, getBoardScene, {
    boardId: mainBoardId,
  });
  assert.equal(scene.scene?.boardRevision, 1n);
  assert.deepEqual(
    scene.scene.objects.filter((object) => object.objectId === objectId).map(({ kind }) => kind),
    ['image'],
  );
  const payloads = await callWhiteboard(server.address, viewerId, getObjectPayloads, {
    boardId: mainBoardId,
    objectIds: [objectId],
  });
  const payload = payloads.results[0]?.result;
  assert.equal(payload?.case, 'payload');
  assert.equal(payload.value.body.case, 'image');
  assert.equal(payload.value.body.value.src, source);
  assert.equal(payload.value.body.value.naturalSize?.width, 2);
  assert.equal(payload.value.body.value.naturalSize?.height, 3);

  const authorized = await downloadAsset(viewerId, source);
  assert.equal(authorized.status, 200);
  assert.equal(authorized.headers.get('content-type'), 'image/png');
  assert.deepEqual(new Uint8Array(await authorized.arrayBuffer()), pngImage);
  const outsider = await downloadAsset(outsiderId, source);
  assert.equal(outsider.status, 404);
  const crossBoard = await downloadAsset(
    editorId,
    assetPrefix + secondBoardId + '/' + imageAssetId,
  );
  assert.equal(crossBoard.status, 404);
});

test('rejects an invalid image without saving a board object or asset', async () => {
  const content = new Uint8Array([1, 2, 3, 4]);
  const saved = await callWhiteboard(server.address, editorId, attachBoardImage, {
    ...imageInput,
    content,
  });
  assert.equal(saved.receipt?.outcome.case, 'rejected');

  await assertImageMissing();
});

test('rejects writes from a read-only member and rolls back when receipt publication fails', async () => {
  const forbidden = await callWhiteboard(server.address, viewerId, attachBoardImage, imageInput);
  assert.equal(forbidden.receipt?.outcome.case, 'rejected');
  await assertImageMissing();

  rejectImageReceipt(server.databasePath);
  const failed = await sendWhiteboardRequest(
    server.address,
    editorId,
    attachBoardImage,
    imageInput,
  );
  assert.equal(failed.status, 500);
  assert.equal(server.errors.length, 1);
  assert.match(String(server.errors[0]), /Injected image receipt write failure/u);
  await assertImageMissing();
});

test('a saved version still exports its image after the current object is removed', async () => {
  const saved = await callWhiteboard(server.address, editorId, attachBoardImage, imageInput);
  assert.equal(saved.receipt?.outcome.case, 'applied');
  const object = saved.receipt.outcome.value.changedObjects.find(
    (item) => item.objectId === objectId,
  );
  assert.ok(object);

  const removed = await callWhiteboard(server.address, editorId, editBoardGeometry, {
    boardId: mainBoardId,
    commandId: 'remove-image',
    operation: {
      case: 'delete',
      value: { targets: [{ objectId, expectedGeometryVersion: object.geometryVersion }] },
    },
  });
  assert.equal(removed.receipt?.outcome.case, 'applied');
  assert.deepEqual(removed.receipt.outcome.value.removedObjectIds, [objectId]);
  const exported = await callWhiteboard(server.address, viewerId, exportBoardVersion, {
    boardId: mainBoardId,
    revision: saved.receipt.outcome.value.boardRevision,
    scope: { case: 'selection', value: { objectIds: [objectId] } },
    format: BoardExportFormat.SVG,
  });
  assert.equal(exported.result.case, 'file');
  assert.equal(exported.result.value.revision, 1n);
  assert.match(new TextDecoder().decode(exported.result.value.content), /data:image\/png;base64,/u);
});
