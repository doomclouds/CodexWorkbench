import assert from 'node:assert/strict';
import {
  MoveConflictReason,
  MoveRejectionReason,
  WhiteboardService,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { expect, test } from 'vitest';
import { callWhiteboard, sendWhiteboardRequest } from '../support/whiteboard-client.js';
import {
  documentId,
  documentPayloadVersion,
  editorId,
  lockedId,
  mainBoardId,
  rejectReceiptInserts,
  secondBoardId,
  shapeId,
  teammateId,
  viewerId,
} from '../support/whiteboard-database.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

const server = useWhiteboardTestServer();
const { getBoardScene, getCommandReceipt, getObjectPayloads, moveObjects } =
  WhiteboardService.method;

const initialTargets = [
  { objectId: shapeId, expectedGeometryVersion: 0n },
  { objectId: documentId, expectedGeometryVersion: 0n },
];

function moveRequest(commandId: string) {
  return {
    boardId: mainBoardId,
    commandId,
    delta: { dx: 4, dy: -6 },
    targets: initialTargets,
  };
}

async function openScene(boardId = mainBoardId) {
  const response = await callWhiteboard(server.address, editorId, getBoardScene, { boardId });
  assert.ok(response.scene);

  return response.scene;
}

async function lookupReceipt(commandId: string, actorId = editorId, boardId = mainBoardId) {
  const response = await callWhiteboard(server.address, actorId, getCommandReceipt, {
    boardId,
    commandId,
  });

  return response.result;
}

test('preserves changed metadata, payload, and a saved receipt across restart', async () => {
  const commandId = 'move-and-restart';
  const request = moveRequest(commandId);
  const payloadQuery = { boardId: mainBoardId, objectIds: [documentId] };
  const originalPayload = await callWhiteboard(
    server.address,
    editorId,
    getObjectPayloads,
    payloadQuery,
  );
  const response = await callWhiteboard(server.address, editorId, moveObjects, request);
  assert.ok(response.receipt?.outcome.case === 'applied');
  expect(response.receipt.outcome.value.boardRevision).toBe(1n);
  expect(response.receipt.outcome.value.objects).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        objectId: shapeId,
        geometry: expect.objectContaining({ x: 20, y: -14 }),
        geometryVersion: 1n,
      }),
      expect.objectContaining({
        objectId: documentId,
        geometry: expect.objectContaining({ x: 104, y: 18 }),
        geometryVersion: 1n,
        payloadVersion: documentPayloadVersion,
      }),
    ]),
  );

  await server.restart();
  const scene = await openScene();
  const receipt = await lookupReceipt(commandId);
  const savedPayload = await callWhiteboard(
    server.address,
    editorId,
    getObjectPayloads,
    payloadQuery,
  );

  expect(scene.boardRevision).toBe(1n);
  expect(scene.objects.find(({ objectId }) => objectId === shapeId)?.geometry?.x).toBe(20);
  expect(scene.objects.find(({ objectId }) => objectId === documentId)?.geometry?.x).toBe(104);
  expect(receipt).toEqual({ case: 'receipt', value: response.receipt });
  expect(savedPayload).toEqual(originalPayload);
});

test('replays a discarded response with reordered targets and rejects changed input', async () => {
  const commandId = 'retry-after-discard';
  const request = moveRequest(commandId);
  const response = await sendWhiteboardRequest(server.address, editorId, moveObjects, request);
  assert.ok(response.body);
  expect(response.status).toBe(200);
  await response.body.cancel();

  const saved = await lookupReceipt(commandId);
  assert.ok(saved.case === 'receipt');
  expect(saved.value.outcome.case).toBe('applied');

  const reorderedRequest = { ...request, targets: [...initialTargets].reverse() };
  const replay = await callWhiteboard(server.address, editorId, moveObjects, reorderedRequest);
  const changed = await callWhiteboard(server.address, editorId, moveObjects, {
    ...request,
    delta: { dx: 8, dy: -6 },
  });

  expect(replay.receipt).toEqual(saved.value);
  expect(changed.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: MoveRejectionReason.COMMAND_ID_REUSE },
  });
  expect(await lookupReceipt(commandId)).toEqual(saved);

  const scene = await openScene();
  expect(scene.boardRevision).toBe(1n);
  expect(scene.objects.find(({ objectId }) => objectId === shapeId)?.geometry?.x).toBe(20);
});

test('leaves the scene unchanged after a conflict, locked target, or denied edit', async () => {
  const original = await openScene();
  const stale = await callWhiteboard(server.address, editorId, moveObjects, {
    ...moveRequest('stale'),
    targets: [...initialTargets.slice(0, 1), { objectId: documentId, expectedGeometryVersion: 1n }],
  });
  const locked = await callWhiteboard(server.address, editorId, moveObjects, {
    ...moveRequest('locked'),
    targets: [...initialTargets, { objectId: lockedId, expectedGeometryVersion: 0n }],
  });
  const readOnly = await callWhiteboard(
    server.address,
    viewerId,
    moveObjects,
    moveRequest('denied'),
  );

  expect(stale.receipt?.outcome).toMatchObject({
    case: 'conflict',
    value: { reason: MoveConflictReason.GEOMETRY_VERSION_CHANGED, boardRevision: 0n },
  });
  expect(locked.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: MoveRejectionReason.GEOMETRY_LOCKED },
  });
  expect(readOnly.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: MoveRejectionReason.FORBIDDEN },
  });
  expect(await openScene()).toEqual(original);
  expect((await lookupReceipt('stale')).case).toBe('notRecorded');
  expect((await lookupReceipt('locked')).case).toBe('notRecorded');
});

test('rejects an omitted geometry version over HTTP', async () => {
  const original = await openScene();
  const response = await sendWhiteboardRequest(server.address, editorId, moveObjects, {
    ...moveRequest('missing-version'),
    targets: [{ objectId: shapeId }],
  });

  expect(response.status).toBe(400);
  expect(await openScene()).toEqual(original);
});

test('partitions durable command IDs by trusted actor and board', async () => {
  const commandId = 'shared-command-id';
  const first = await callWhiteboard(server.address, editorId, moveObjects, moveRequest(commandId));
  expect(first.receipt?.outcome.case).toBe('applied');
  expect((await lookupReceipt(commandId, teammateId)).case).toBe('notRecorded');
  expect((await lookupReceipt(commandId, editorId, secondBoardId)).case).toBe('notRecorded');

  const teammate = await callWhiteboard(server.address, teammateId, moveObjects, {
    ...moveRequest(commandId),
    targets: [{ objectId: shapeId, expectedGeometryVersion: 1n }],
  });
  const secondBoard = await callWhiteboard(server.address, editorId, moveObjects, {
    ...moveRequest(commandId),
    boardId: secondBoardId,
    targets: [{ objectId: shapeId, expectedGeometryVersion: 0n }],
  });

  expect(teammate.receipt?.outcome.case).toBe('applied');
  expect(secondBoard.receipt?.outcome.case).toBe('applied');
  expect((await openScene()).boardRevision).toBe(2n);
  expect((await openScene(secondBoardId)).boardRevision).toBe(1n);
  expect(await lookupReceipt(commandId)).toEqual({ case: 'receipt', value: first.receipt });
});

test('rolls back the entire move when SQLite aborts a receipt insert', async () => {
  const original = await openScene();
  rejectReceiptInserts(server.databasePath);
  const commandId = 'faulted-receipt-insert';
  const request = moveRequest(commandId);
  const failed = await sendWhiteboardRequest(server.address, editorId, moveObjects, request);

  expect(failed.status).toBe(500);
  expect(await failed.text()).toBe('');
  expect(server.errors).toHaveLength(1);
  expect(server.errors[0]).toMatchObject({ message: 'Injected receipt write failure' });
  expect(await openScene()).toEqual(original);
  expect((await lookupReceipt(commandId)).case).toBe('notRecorded');
});
