import assert from 'node:assert/strict';
import { BoardEditService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import { WhiteboardService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { expect, test } from 'vitest';
import { seedLayerScale } from '../support/board-geometry-database.js';
import { callWhiteboard } from '../support/whiteboard-client.js';
import {
  editorId,
  lockedId,
  mainBoardId,
  shapeId,
  teammateId,
} from '../support/whiteboard-database.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

const server = useWhiteboardTestServer();
const { editBoardGeometry, reverseBoardEdit } = BoardEditService.method;
const board = { boardId: mainBoardId };
const firstColor = '#24689A';
const secondColor = '#9A6842';

async function paint(commandId: string, color: string, actorId = editorId, objectId = shapeId) {
  const { receipt } = await callWhiteboard(server.address, actorId, editBoardGeometry, {
    ...board,
    commandId,
    operation: {
      case: 'style',
      value: {
        targets: [{ target: { objectId, expectedGeometryVersion: 0n } }],
        patch: { stroke: color },
        rememberColor: color,
      },
    },
  });
  assert.equal(receipt?.outcome.case, 'applied');

  return receipt.outcome.value;
}

function reverse(commandId: string, source: string) {
  return callWhiteboard(server.address, editorId, reverseBoardEdit, {
    ...board,
    commandId,
    source: { case: 'editCommandId', value: source },
  });
}

async function scene() {
  const view = await callWhiteboard(
    server.address,
    editorId,
    WhiteboardService.method.getBoardScene,
    board,
  );
  assert.ok(view.scene);

  return view.scene;
}

function stroke(view: Awaited<ReturnType<typeof scene>>, objectId: string) {
  const object = view.objects.find((entry) => entry.objectId === objectId);
  assert.ok(object);

  return object.appearance?.stroke;
}

test('undoes object paint and palette registration together and redoes the persisted reversal', async () => {
  const original = await scene();
  const painted = await paint('paint-and-remember', firstColor);
  expect(painted.customColors?.colors).toEqual([firstColor]);
  expect(stroke(await scene(), shapeId)).toBe(firstColor);

  await server.restart();
  const undone = await reverse('undo-paint-and-remember', 'paint-and-remember');
  expect(undone.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: {
      boardRevision: 2n,
      changedObjects: [{ objectId: shapeId }],
      customColors: { colors: [] },
    },
  });
  const restored = await scene();
  expect(stroke(restored, shapeId)).toBe(stroke(original, shapeId));
  expect(restored.customColors?.colors).toEqual([]);

  await server.restart();
  expect(await reverse('undo-paint-and-remember', 'paint-and-remember')).toEqual(undone);
  const redone = await reverse('redo-paint-and-remember', 'undo-paint-and-remember');
  expect(redone.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: {
      boardRevision: 3n,
      changedObjects: [{ objectId: shapeId, appearance: { stroke: firstColor } }],
      customColors: { colors: [firstColor] },
    },
  });
  expect((await scene()).customColors?.colors).toEqual([firstColor]);
});

test('undoes and redoes a palette-only removal without loading a large board scene', async () => {
  await paint('register-removable-color', firstColor);
  const { receipt } = await callWhiteboard(server.address, editorId, editBoardGeometry, {
    ...board,
    commandId: 'remove-color-chip',
    operation: { case: 'removeCustomColor', value: { color: firstColor } },
  });
  expect(receipt?.outcome).toMatchObject({
    case: 'applied',
    value: { boardRevision: 2n, changedObjects: [], customColors: { colors: [] } },
  });
  seedLayerScale(server.databasePath, 20_001);

  const undone = await reverse('undo-remove-color-chip', 'remove-color-chip');
  expect(undone.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: { boardRevision: 3n, changedObjects: [], customColors: { colors: [firstColor] } },
  });
  const redone = await reverse('redo-remove-color-chip', 'undo-remove-color-chip');
  expect(redone.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: { boardRevision: 4n, changedObjects: [], customColors: { colors: [] } },
  });
});

test('rejects a mixed undo when a collaborator has registered another color without changing the target', async () => {
  await paint('first-palette-edit', firstColor);
  await paint('teammate-palette-edit', secondColor, teammateId, lockedId);
  const before = await scene();
  expect(before.customColors?.colors).toEqual([firstColor, secondColor]);
  expect(stroke(before, shapeId)).toBe(firstColor);

  const conflicted = await reverse('undo-with-changed-palette', 'first-palette-edit');
  expect(conflicted.receipt?.outcome).toMatchObject({
    case: 'conflict',
    value: { boardRevision: 2n },
  });
  expect(await scene()).toEqual(before);
});

test('rejects redo after a collaborator has changed the palette since the undo', async () => {
  await paint('paint-before-undo', firstColor);
  const undone = await reverse('undo-before-teammate', 'paint-before-undo');
  expect(undone.receipt?.outcome.case).toBe('applied');
  await paint('teammate-paints-after-undo', secondColor, teammateId, lockedId);
  const before = await scene();
  expect(before.customColors?.colors).toEqual([secondColor]);

  const conflicted = await reverse('redo-with-changed-palette', 'undo-before-teammate');
  expect(conflicted.receipt?.outcome).toMatchObject({
    case: 'conflict',
    value: { boardRevision: 3n },
  });
  expect(await scene()).toEqual(before);
});
