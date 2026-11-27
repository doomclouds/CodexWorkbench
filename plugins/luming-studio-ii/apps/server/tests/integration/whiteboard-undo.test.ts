import assert from 'node:assert/strict';
import {
  BoardEditRejectionReason,
  BoardEditService,
  BoardLayerDirection,
  BoardTransformKind,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import { WhiteboardService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { expect, test } from 'vitest';
import { callWhiteboard } from '../support/whiteboard-client.js';
import {
  documentId,
  documentTitle,
  editorId,
  mainBoardId,
  shapeId,
  teammateId,
  viewerId,
} from '../support/whiteboard-database.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

const server = useWhiteboardTestServer();
const { getBoardScene, getObjectPayloads, moveObjects } = WhiteboardService.method;
const { editBoardGeometry, reverseBoardEdit, getBoardEditReceipt } = BoardEditService.method;
const board = { boardId: mainBoardId };

async function move(actorId: string, commandId: string, objectId: string, dx: number, clock = 0n) {
  const { receipt } = await callWhiteboard(server.address, actorId, moveObjects, {
    ...board,
    commandId,
    delta: { dx, dy: 0 },
    targets: [{ objectId, expectedGeometryVersion: clock }],
  });
  assert.equal(receipt?.outcome.case, 'applied');

  return receipt.outcome.value;
}

async function reverse(
  commandId: string,
  sourceId: string,
  kind: 'move' | 'edit' = 'edit',
  actorId = editorId,
) {
  return callWhiteboard(server.address, actorId, reverseBoardEdit, {
    ...board,
    commandId,
    source: { case: kind === 'move' ? 'moveCommandId' : 'editCommandId', value: sourceId },
  });
}

async function scene() {
  const result = await callWhiteboard(server.address, editorId, getBoardScene, board);
  assert.ok(result.scene);

  return result.scene;
}

test('reverses and reapplies a move while keeping the teammate move and durable retry receipt', async () => {
  await move(editorId, 'move-shape', shapeId, 40);
  await move(teammateId, 'move-document', documentId, 75);
  const reversed = await reverse('undo-move-shape', 'move-shape', 'move');
  expect(reversed.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: { boardRevision: 3n, changedObjects: [{ objectId: shapeId, geometry: { x: 16 } }] },
  });
  expect((await scene()).objects.find(({ objectId }) => objectId === documentId)?.geometry?.x).toBe(
    175,
  );

  await server.restart();
  expect(await reverse('undo-move-shape', 'move-shape', 'move')).toEqual(reversed);
  const persisted = await callWhiteboard(server.address, editorId, getBoardEditReceipt, {
    ...board,
    commandId: 'undo-move-shape',
  });
  expect(persisted.receipt).toEqual(reversed.receipt);

  const redone = await reverse('redo-move-shape', 'undo-move-shape');
  expect(redone.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: { boardRevision: 4n, changedObjects: [{ objectId: shapeId, geometry: { x: 56 } }] },
  });
});

test('reverses only the position field when another editor has resized that object', async () => {
  const moved = await move(editorId, 'move-before-resize', shapeId, 20);
  const object = moved.objects[0];
  assert.ok(object?.geometry);
  const resized = await callWhiteboard(server.address, teammateId, editBoardGeometry, {
    ...board,
    commandId: 'teammate-resize',
    operation: {
      case: 'transform',
      value: {
        kind: BoardTransformKind.RESIZE,
        objects: [
          {
            target: { objectId: shapeId, expectedGeometryVersion: object.geometryVersion },
            geometry: { ...object.geometry, width: 150 },
          },
        ],
      },
    },
  });
  expect(resized.receipt?.outcome.case).toBe('applied');
  const reversed = await reverse('undo-move-with-resize', 'move-before-resize', 'move');
  expect(reversed.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: { changedObjects: [{ objectId: shapeId, geometry: { x: 16, width: 150 } }] },
  });
});

test('undoes an object creation and recreates its exact ID and content on redo', async () => {
  const objectId = 'reversible-html';
  const html = '<h2>可恢复的图表</h2>';
  const created = await callWhiteboard(server.address, editorId, editBoardGeometry, {
    ...board,
    commandId: 'create-reversible-object',
    operation: {
      case: 'create',
      value: {
        object: {
          objectId,
          kind: 'html',
          label: '图表',
          geometry: { x: 40, y: 20, width: 180, height: 120, rotation: 0 },
        },
        initialPayload: {
          body: { case: 'embed', value: { title: '图表', html, sourceRevision: 0n } },
        },
      },
    },
  });
  expect(created.receipt?.outcome.case).toBe('applied');
  const undo = await reverse('undo-create-object', 'create-reversible-object');
  expect(undo.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: { removedObjectIds: [objectId] },
  });
  const redo = await reverse('redo-create-object', 'undo-create-object');
  expect(redo.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: { changedObjects: [{ objectId }], changedPayloads: [{ objectId }] },
  });
  const result = await callWhiteboard(server.address, editorId, getObjectPayloads, {
    ...board,
    objectIds: [objectId],
  });
  expect(result.results[0]?.result).toMatchObject({
    case: 'payload',
    value: { body: { case: 'embed', value: { html } } },
  });
});

test('restores a deleted native object, its payload and layer, then deletes it again', async () => {
  const original = await scene();
  const { receipt } = await callWhiteboard(server.address, editorId, editBoardGeometry, {
    ...board,
    commandId: 'delete-document',
    operation: {
      case: 'delete',
      value: { targets: [{ objectId: documentId, expectedGeometryVersion: 0n }] },
    },
  });
  expect(receipt?.outcome).toMatchObject({
    case: 'applied',
    value: { removedObjectIds: [documentId] },
  });

  const restored = await reverse('undo-delete-document', 'delete-document');
  expect(restored.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: {
      changedObjects: [{ objectId: documentId }],
      changedPayloads: [{ objectId: documentId }],
    },
  });
  expect((await scene()).objects.map(({ objectId }) => objectId)).toEqual(
    original.objects.map(({ objectId }) => objectId),
  );
  const payloads = await callWhiteboard(server.address, editorId, getObjectPayloads, {
    ...board,
    objectIds: [documentId],
  });
  expect(payloads.results[0]?.result).toMatchObject({
    case: 'payload',
    value: { body: { case: 'document', value: { title: documentTitle } } },
  });
  const redone = await reverse('redo-delete-document', 'undo-delete-document');
  expect(redone.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: { removedObjectIds: [documentId] },
  });
});

test('rejects conflicting target edits, a different actor and read-only callers without writing', async () => {
  const first = await move(editorId, 'initial-move', shapeId, 20);
  const clock = first.objects.find(({ objectId }) => objectId === shapeId)?.geometryVersion;
  assert.ok(clock !== undefined);
  await move(teammateId, 'later-move', shapeId, 20, clock);
  expect(
    (await reverse('conflicting-undo', 'initial-move', 'move')).receipt?.outcome,
  ).toMatchObject({
    case: 'conflict',
    value: { boardRevision: 2n },
  });
  expect(
    (await reverse('foreign-undo', 'initial-move', 'move', teammateId)).receipt?.outcome,
  ).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.VERSION_UNAVAILABLE },
  });
  expect(
    (await reverse('readonly-undo', 'initial-move', 'move', viewerId)).receipt?.outcome,
  ).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.FORBIDDEN },
  });
  expect((await scene()).boardRevision).toBe(2n);
});

test('does not turn a no-op layer receipt into an undo of another operation', async () => {
  await move(editorId, 'move-before-layer-noop', documentId, 40);
  const { receipt } = await callWhiteboard(server.address, editorId, editBoardGeometry, {
    ...board,
    commandId: 'layer-noop',
    operation: {
      case: 'reorder',
      value: {
        direction: BoardLayerDirection.BACK,
        expectedBoardRevision: 1n,
        targets: [{ objectId: shapeId, expectedGeometryVersion: 0n }],
      },
    },
  });
  expect(receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.INVALID_EDIT },
  });
  expect((await reverse('undo-layer-noop', 'layer-noop')).receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.VERSION_UNAVAILABLE },
  });
  expect((await scene()).boardRevision).toBe(1n);
});
