import type { MessageInitShape } from '@bufbuild/protobuf';
import { BoardEditService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import type { ObjectMetadataSchema } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/scene';
import { WhiteboardService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { callWhiteboard } from '../support/whiteboard-client.js';
import { editorId, mainBoardId, viewerId } from '../support/whiteboard-database.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

const server = useWhiteboardTestServer();
const { editBoardGeometry, editObjectContent } = BoardEditService.method;
const { getBoardScene, getObjectPayloads } = WhiteboardService.method;
const geometry = { x: 20, y: 40, width: 280, height: 80, rotation: 0 };

function detail(kind: string): MessageInitShape<typeof ObjectMetadataSchema>['geometryDetail'] {
  if (kind === 'shape') {
    return { case: 'shape', value: { outline: 'rounded' } };
  }
  if (kind === 'section') {
    return { case: 'section', value: { transparent: false } };
  }

  const start = { point: { x: geometry.x, y: geometry.y } };
  const end = { point: { x: geometry.x + geometry.width, y: geometry.y + geometry.height } };

  return { case: 'connector', value: { start, end } };
}

test.each(['shape', 'section', 'connector'])(
  'persists the edited %s caption and style through a board reopen',
  async (kind) => {
    const boardId = mainBoardId;
    const objectId = 'caption-' + kind;
    const created = await callWhiteboard(server.address, editorId, editBoardGeometry, {
      boardId,
      commandId: 'create-caption',
      operation: {
        case: 'create',
        value: {
          object: {
            objectId,
            kind,
            label: '新对象',
            geometry,
            geometryDetail: detail(kind),
          },
        },
      },
    });
    assert.equal(created.receipt?.outcome.case, 'applied');
    const expectedPayloadVersion = created.receipt.outcome.value.changedObjects[0]?.payloadVersion;
    assert.equal(expectedPayloadVersion, 0n);

    const text = '真实标注';
    const saved = await callWhiteboard(server.address, editorId, editObjectContent, {
      boardId,
      commandId: 'write-caption',
      objectId,
      expectedPayloadVersion,
      edit: { case: 'text', value: { text, bold: true, italic: true } },
    });
    assert.equal(saved.receipt?.outcome.case, 'applied');

    await server.restart();
    const scene = await callWhiteboard(server.address, viewerId, getBoardScene, { boardId });
    const object = scene.scene?.objects.find((entry) => entry.objectId === objectId);
    assert.equal(object?.label, text);
    assert.equal(object.payloadVersion, 1n);
    const body = await callWhiteboard(server.address, viewerId, getObjectPayloads, {
      boardId,
      objectIds: [objectId],
    });
    const payload = body.results[0]?.result;
    assert.equal(payload?.case, 'payload');
    assert.equal(payload.value.body.case, 'text');
    assert.equal(payload.value.body.value.text, text);
    assert.equal(payload.value.body.value.bold, true);
    assert.equal(payload.value.body.value.italic, true);
  },
);

test('clears standalone text only against its current payload and unlocked geometry', async () => {
  const boardId = mainBoardId;
  const objectId = 'board-text-clear';
  const created = await callWhiteboard(server.address, editorId, editBoardGeometry, {
    boardId,
    commandId: 'new-clearable-text',
    operation: { case: 'create', value: { object: { objectId, kind: 'text', geometry } } },
  });
  assert.equal(created.receipt?.outcome.case, 'applied');

  const saved = await callWhiteboard(server.address, editorId, editObjectContent, {
    boardId,
    commandId: 'save-clearable-text',
    objectId,
    expectedPayloadVersion: 0n,
    edit: { case: 'text', value: { text: '并行编辑的正文' } },
  });
  assert.equal(saved.receipt?.outcome.case, 'applied');

  const clear = {
    boardId,
    objectId,
    deleteEmptyText: true,
    edit: { case: 'text' as const, value: { text: '' } },
  };
  const stale = await callWhiteboard(server.address, editorId, editObjectContent, {
    ...clear,
    commandId: 'stale-clear',
    expectedPayloadVersion: 0n,
  });
  assert.equal(stale.receipt?.outcome.case, 'conflict');

  const geometryVersion = created.receipt.outcome.value.changedObjects[0]?.geometryVersion;
  const locked = await callWhiteboard(server.address, editorId, editBoardGeometry, {
    boardId,
    commandId: 'lock-clearable-text',
    operation: {
      case: 'changeLock',
      value: { locked: true, targets: [{ objectId, expectedGeometryVersion: geometryVersion }] },
    },
  });
  assert.equal(locked.receipt?.outcome.case, 'applied');
  const lockedClear = await callWhiteboard(server.address, editorId, editObjectContent, {
    ...clear,
    commandId: 'locked-clear',
    expectedPayloadVersion: 1n,
  });
  assert.equal(lockedClear.receipt?.outcome.case, 'rejected');

  const lockedVersion = locked.receipt.outcome.value.changedObjects[0]?.geometryVersion;
  const unlocked = await callWhiteboard(server.address, editorId, editBoardGeometry, {
    boardId,
    commandId: 'unlock-clearable-text',
    operation: {
      case: 'changeLock',
      value: { locked: false, targets: [{ objectId, expectedGeometryVersion: lockedVersion }] },
    },
  });
  assert.equal(unlocked.receipt?.outcome.case, 'applied');

  const confirmed = await callWhiteboard(server.address, editorId, editObjectContent, {
    ...clear,
    commandId: 'fresh-clear',
    expectedPayloadVersion: 1n,
  });
  assert.equal(confirmed.receipt?.outcome.case, 'applied');
  assert.deepEqual(confirmed.receipt.outcome.value.removedObjectIds, [objectId]);

  await server.restart();
  const scene = await callWhiteboard(server.address, viewerId, getBoardScene, { boardId });
  assert.equal(
    scene.scene?.objects.some((object) => object.objectId === objectId),
    false,
  );
});
