import assert from 'node:assert/strict';
import {
  BoardExportFormat,
  BoardExportRejectionReason,
  WhiteboardService,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { expect, test } from 'vitest';
import { callWhiteboard, sendWhiteboardRequest } from '../support/whiteboard-client.js';
import {
  editorId,
  lockedId,
  mainBoardId,
  outsiderId,
  shapeId,
  viewerId,
} from '../support/whiteboard-database.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

const server = useWhiteboardTestServer();
const { exportBoard, getBoardScene, moveObjects } = WhiteboardService.method;
const whole = { case: 'whole', value: {} } as const;
const request = {
  boardId: mainBoardId,
  expectedRevision: 0n,
  scope: whole,
  format: BoardExportFormat.JSON,
};

test('exports a read-only board and limits a safe SVG to the exact confirmed selection', async () => {
  const board = await callWhiteboard(server.address, viewerId, exportBoard, request);
  assert.equal(board.result.case, 'file');
  const json = board.result.value;
  expect(json).toMatchObject({ mimeType: 'application/json', revision: 0n });
  expect(JSON.parse(new TextDecoder().decode(json.content))).toMatchObject({
    board: { boardId: mainBoardId, title: 'Architecture', revision: '0' },
    objects: [{ objectId: shapeId }, expect.any(Object), { objectId: lockedId }],
  });

  const selection = await callWhiteboard(server.address, editorId, exportBoard, {
    ...request,
    scope: { case: 'selection', value: { objectIds: [shapeId] } },
    format: BoardExportFormat.SVG,
  });
  assert.equal(selection.result.case, 'file');
  const svg = selection.result.value;
  expect(svg).toMatchObject({ mimeType: 'image/svg+xml', revision: 0n });
  const markup = new TextDecoder().decode(svg.content);
  expect(markup).toMatch(/<svg\b/);
  expect(markup).not.toMatch(/<script|<foreignObject|https?:\/\/(?!www\.w3\.org\/2000\/svg)/);

  const after = await callWhiteboard(server.address, editorId, getBoardScene, {
    boardId: mainBoardId,
  });
  expect(after.scene?.boardRevision).toBe(0n);
});

test('returns the newer revision without a file after a concurrent saved move', async () => {
  const moved = await callWhiteboard(server.address, editorId, moveObjects, {
    boardId: mainBoardId,
    commandId: 'move-before-export',
    delta: { dx: 12, dy: 4 },
    targets: [{ objectId: shapeId, expectedGeometryVersion: 0n }],
  });
  expect(moved.receipt?.outcome.case).toBe('applied');

  const stale = await callWhiteboard(server.address, editorId, exportBoard, request);
  expect(stale.result).toMatchObject({ case: 'stale', value: { revision: 1n } });
  const current = await callWhiteboard(server.address, editorId, exportBoard, {
    ...request,
    expectedRevision: 1n,
  });
  expect(current.result).toMatchObject({ case: 'file', value: { revision: 1n } });
});

test('rejects missing revisions or formats, vanished selections and non-member downloads', async () => {
  const missingRevision = await sendWhiteboardRequest(server.address, editorId, exportBoard, {
    ...request,
    expectedRevision: undefined,
  });
  expect(missingRevision.status).toBe(400);

  const missingFormat = await sendWhiteboardRequest(server.address, editorId, exportBoard, {
    ...request,
    format: BoardExportFormat.UNSPECIFIED,
  });
  expect(missingFormat.status).toBe(400);

  const vanished = await callWhiteboard(server.address, editorId, exportBoard, {
    ...request,
    scope: { case: 'selection', value: { objectIds: ['missing-object'] } },
  });
  expect(vanished.result).toMatchObject({
    case: 'rejected',
    value: { reason: BoardExportRejectionReason.INVALID_SELECTION },
  });

  const forbidden = await sendWhiteboardRequest(server.address, outsiderId, exportBoard, request);
  expect(forbidden.status).toBe(403);
  expect(server.errors).toHaveLength(0);
});
