import assert from 'node:assert/strict';
import type { MessageInitShape } from '@bufbuild/protobuf';
import { BoardCatalogService } from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import {
  BoardEditRejectionReason,
  BoardEditService,
  type EditBoardGeometryRequestSchema,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import type { EmbedPayloadSchema } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/payload';
import { WhiteboardService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { test } from 'vitest';
import { callWhiteboard } from '../support/whiteboard-client.js';
import { editorId } from '../support/whiteboard-database.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

const server = useWhiteboardTestServer();
const { createBoard } = BoardCatalogService.method;
const { editBoardGeometry, editObjectContent } = BoardEditService.method;
const { getBoardScene, getObjectPayloads } = WhiteboardService.method;
const objectId = 'html-diagram-1';
const title = 'HTML 图解';
const html = '<!doctype html>\n<html lang="zh-CN"><p>流程预览</p></html>';
const geometry = { x: 80, y: 80, width: 1440, height: 1120, rotation: 0 };

async function createBlankBoard() {
  const { receipt } = await callWhiteboard(server.address, editorId, createBoard, {
    commandId: 'create-empty-html-board',
    title: '空白板',
  });
  assert.equal(receipt?.outcome.case, 'created');

  return receipt.outcome.value.boardId;
}

function createDiagram(
  boardId: string,
  content?: MessageInitShape<typeof EmbedPayloadSchema>,
): MessageInitShape<typeof EditBoardGeometryRequestSchema> {
  return {
    boardId,
    commandId: 'create-html-diagram',
    operation: {
      case: 'create',
      value: {
        object: { objectId, kind: 'html', label: title, geometry },
        initialPayload: content && { body: { case: 'embed', value: content } },
      },
    },
  };
}

test('creates an HTML diagram on an empty board and replays its saved source after restart', async () => {
  const boardId = await createBlankBoard();
  const request = createDiagram(boardId, { title, html, sourceRevision: 0n });
  const saved = await callWhiteboard(server.address, editorId, editBoardGeometry, request);
  assert.equal(saved.receipt?.outcome.case, 'applied');
  assert.equal(saved.receipt.outcome.value.boardRevision, 1n);
  assert.equal(saved.receipt.outcome.value.changedObjects[0]?.kind, 'html');

  await server.restart();
  const replayed = await callWhiteboard(server.address, editorId, editBoardGeometry, request);
  assert.deepEqual(replayed, saved);

  const board = await callWhiteboard(server.address, editorId, getBoardScene, { boardId });
  assert.equal(board.scene?.boardRevision, 1n);
  assert.deepEqual(
    board.scene.objects.map((object) => object.objectId),
    [objectId],
  );
  const { results } = await callWhiteboard(server.address, editorId, getObjectPayloads, {
    boardId,
    objectIds: [objectId],
  });
  const result = results[0]?.result;
  assert.equal(result?.case, 'payload');
  assert.equal(result.value.payloadVersion, 0n);
  assert.equal(result.value.body.case, 'embed');
  assert.equal(result.value.body.value.title, title);
  assert.equal(result.value.body.value.html, html);
  assert.equal(result.value.body.value.sourceRevision, 0n);

  const nextHtml = '<h1>确认修改</h1>';
  const edited = await callWhiteboard(server.address, editorId, editObjectContent, {
    boardId,
    commandId: 'update-html-diagram',
    objectId,
    expectedPayloadVersion: 0n,
    edit: { case: 'embedSource', value: { title, html: nextHtml, expectedSourceRevision: 0n } },
  });
  assert.equal(edited.receipt?.outcome.case, 'applied');
  assert.equal(edited.receipt.outcome.value.boardRevision, 2n);
  const updated = edited.receipt.outcome.value.changedPayloads[0]?.result;
  assert.equal(updated?.case, 'payload');
  assert.equal(updated.value.body.case, 'embed');
  assert.equal(updated.value.body.value.html, nextHtml);
  assert.equal(updated.value.body.value.sourceRevision, 1n);
});

const rejectedSources = [
  ['missing', undefined],
  ['blank', { title, html: ' ' }],
  ['stale', { title, html, sourceRevision: 1n }],
  ['mismatched titles', { title: '不同标题', html }],
  ['initial state', { title, html, state: { kind: { case: 'boolValue', value: true } } }],
] as const;

test.each(rejectedSources)(
  'rejects %s HTML creation without publishing an object',
  async (_reason, content) => {
    const boardId = await createBlankBoard();
    const saved = await callWhiteboard(
      server.address,
      editorId,
      editBoardGeometry,
      createDiagram(boardId, content),
    );
    assert.equal(saved.receipt?.outcome.case, 'rejected');
    assert.equal(saved.receipt.outcome.value.reason, BoardEditRejectionReason.INVALID_EDIT);

    const board = await callWhiteboard(server.address, editorId, getBoardScene, { boardId });
    assert.equal(board.scene?.boardRevision, 0n);
    assert.deepEqual(board.scene.objects, []);
  },
);
