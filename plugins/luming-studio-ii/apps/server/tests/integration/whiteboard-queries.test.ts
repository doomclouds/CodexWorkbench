import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { toJson } from '@bufbuild/protobuf';
import { ObjectPayloadSchema } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/payload';
import { BoardSceneSchema } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/scene';
import {
  ObjectPayloadUnavailableReason,
  WhiteboardService,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { expect, test } from 'vitest';
import {
  callWhiteboard,
  sendChunkedWhiteboardRequest,
  sendWhiteboardRequest,
} from '../support/whiteboard-client.js';
import {
  documentContent,
  documentId,
  documentPayloadVersion,
  documentTitle,
  editorId,
  insertUnreadableShapePayload,
  lockedId,
  mainBoardId,
  outsiderId,
  shapeId,
  viewerId,
} from '../support/whiteboard-database.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

const server = useWhiteboardTestServer();
const { getBoardScene, getCommandReceipt, getObjectPayloads } = WhiteboardService.method;

test('advertises budgeted reads and defers the current stored payload that exceeds the budget', async () => {
  const { boundedPayloadRead } = await callWhiteboard(server.address, editorId, getBoardScene, {
    boardId: mainBoardId,
  });
  expect(boundedPayloadRead).toBe(true);
  const missing = 'missing-object';
  const first = await callWhiteboard(server.address, editorId, getObjectPayloads, {
    boardId: mainBoardId,
    objectIds: [missing, documentId],
    maxPayloadJsonBytes: 1,
  });
  expect(first.results.map(({ objectId }) => objectId)).toEqual([missing]);
  expect(first.deferredObjectIds).toEqual([documentId]);
  const final = await callWhiteboard(server.address, editorId, getObjectPayloads, {
    boardId: mainBoardId,
    objectIds: first.deferredObjectIds,
    maxPayloadJsonBytes: 1,
  });
  expect(final.results[0]?.result).toMatchObject({
    case: 'payload',
    value: { payloadVersion: documentPayloadVersion },
  });
  expect(final.deferredObjectIds).toEqual([]);
  const denied = await sendWhiteboardRequest(server.address, outsiderId, getObjectPayloads, {
    boardId: mainBoardId,
    objectIds: [documentId],
    maxPayloadJsonBytes: 1,
  });
  expect(denied.status).toBe(403);
});

test('lists the scene in layer order with versions and geometry but no document body', async () => {
  const response = await callWhiteboard(server.address, editorId, getBoardScene, {
    boardId: mainBoardId,
  });
  const scene = response.scene;
  assert.ok(scene);
  expect(scene).toMatchObject({
    boardId: mainBoardId,
    title: 'Architecture',
    boardRevision: 0n,
    access: { canEdit: true },
    objects: [
      { objectId: shapeId, geometry: { x: 16, y: -8 }, geometryVersion: 0n, locked: false },
      { objectId: documentId, kind: 'document', payloadVersion: documentPayloadVersion },
      { objectId: lockedId, locked: true },
    ],
  });

  const encodedScene = JSON.stringify(toJson(BoardSceneSchema, scene));
  expect(encodedScene).not.toContain(documentTitle);
  expect(encodedScene).not.toContain(documentContent);
});

test('decodes only requested payloads and returns missing IDs in the same batch', async () => {
  insertUnreadableShapePayload(server.databasePath);
  const scene = await callWhiteboard(server.address, editorId, getBoardScene, {
    boardId: mainBoardId,
  });
  const shape = scene.scene?.objects.find(({ objectId }) => objectId === shapeId);
  expect(shape?.payloadVersion).toBe(0n);

  const missingId = 'missing-object';
  const payloads = await callWhiteboard(server.address, editorId, getObjectPayloads, {
    boardId: mainBoardId,
    objectIds: [documentId, missingId],
  });
  const [document, missing] = payloads.results;
  assert.ok(document?.result.case === 'payload');
  expect(payloads.boardId).toBe(mainBoardId);
  expect(payloads.results.map(({ objectId }) => objectId)).toEqual([documentId, missingId]);
  expect(document.result.value.payloadVersion).toBe(documentPayloadVersion);
  expect(toJson(ObjectPayloadSchema, document.result.value)).toMatchObject({
    document: {
      title: documentTitle,
      schemaVersion: 1,
      blocks: [{ blockId: 'paragraph-1', type: 'paragraph', content: documentContent }],
    },
  });
  expect(missing?.result).toMatchObject({
    case: 'unavailable',
    value: { reason: ObjectPayloadUnavailableReason.NOT_FOUND },
  });

  const unreadable = await sendWhiteboardRequest(server.address, editorId, getObjectPayloads, {
    boardId: mainBoardId,
    objectIds: [shapeId],
  });
  expect(unreadable.status).toBe(500);
  expect(server.errors).toHaveLength(1);
});

test('checks membership for independent reads and reports read-only access', async () => {
  const query = { boardId: mainBoardId };
  const viewerScene = await callWhiteboard(server.address, viewerId, getBoardScene, query);
  expect(viewerScene.scene?.access?.canEdit).toBe(false);

  const viewerPayloads = await callWhiteboard(server.address, viewerId, getObjectPayloads, {
    ...query,
    objectIds: [documentId],
  });
  expect(viewerPayloads.results[0]?.result.case).toBe('payload');

  const unauthenticated = await sendWhiteboardRequest(
    server.address,
    undefined,
    getBoardScene,
    query,
  );
  const hiddenScene = await sendWhiteboardRequest(server.address, outsiderId, getBoardScene, query);
  const missingScene = await sendWhiteboardRequest(server.address, editorId, getBoardScene, {
    boardId: 'missing-board',
  });
  const hiddenPayload = await sendWhiteboardRequest(server.address, outsiderId, getObjectPayloads, {
    ...query,
    objectIds: [documentId],
  });

  expect(unauthenticated.status).toBe(401);
  expect(hiddenScene.status).toBe(403);
  expect(missingScene.status).toBe(hiddenScene.status);
  expect(hiddenPayload.status).toBe(403);
});

test('reports no recorded outcome for a command in a newly initialized receipt store', async () => {
  const query = { boardId: mainBoardId, commandId: 'never-submitted' };
  const response = await callWhiteboard(server.address, editorId, getCommandReceipt, query);
  expect(response.result).toMatchObject({ case: 'notRecorded', value: query });

  const hiddenReceipt = await sendWhiteboardRequest(
    server.address,
    outsiderId,
    getCommandReceipt,
    query,
  );
  expect(hiddenReceipt.status).toBe(403);
});

test('rejects a chunked request above the limit without Content-Length', async () => {
  const halfMebibyte = Buffer.alloc(512 * 1024);
  const status = await sendChunkedWhiteboardRequest(server.address, editorId, getBoardScene, [
    halfMebibyte,
    halfMebibyte,
    Buffer.alloc(1),
  ]);

  expect(status).toBe(413);
  expect(server.errors).toHaveLength(0);
});
