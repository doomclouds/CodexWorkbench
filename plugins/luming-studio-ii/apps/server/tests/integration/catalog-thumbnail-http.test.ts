import assert from 'node:assert/strict';
import {
  BoardCatalogService,
  BoardLifecycleAction,
  type BoardSummary,
} from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import { BoardEditService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import { expect, test } from 'vitest';
import { pngImage } from '../fixtures/board-image-bytes.js';
import { seedPreviewScene } from '../support/catalog-database.js';
import { grantCatalogEditor } from '../support/catalog-lifecycle-database.js';
import { callWhiteboard, sendWhiteboardRequest } from '../support/whiteboard-client.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

const { createBoard, listBoards, listTrashedBoards, manageBoard, getBoardThumbnail } =
  BoardCatalogService.method;
const { editBoardGeometry, attachBoardImage } = BoardEditService.method;
const owner = 'thumbnail-owner';
const editor = 'thumbnail-editor';
const outsider = 'thumbnail-outsider';
const server = useWhiteboardTestServer();

async function create() {
  const { receipt } = await callWhiteboard(server.address, owner, createBoard, {
    commandId: 'thumbnail-board',
    title: 'Saved layout',
  });
  assert.equal(receipt?.outcome.case, 'created');

  return receipt.outcome.value;
}

async function list() {
  const { boards } = await callWhiteboard(server.address, owner, listBoards, { pageSize: 10 });
  const [board] = boards;
  assert.ok(board);

  return board;
}

async function draw(boardId: string) {
  const saved = await callWhiteboard(server.address, owner, editBoardGeometry, {
    boardId,
    commandId: 'save-thumbnail-shape',
    operation: {
      case: 'create',
      value: {
        object: {
          objectId: 'thumbnail-shape',
          kind: 'shape',
          label: '<script>Visible',
          geometry: { x: 10, y: 20, width: 220, height: 120, rotation: 0 },
          appearance: { fill: '#aabbcc' },
          geometryDetail: { case: 'shape', value: { outline: 'ellipse' } },
        },
      },
    },
  });
  assert.equal(saved.receipt?.outcome.case, 'applied');
}

function readThumbnail(boardId: string, revision: bigint, actorId = owner, trashed = false) {
  return callWhiteboard(server.address, actorId, getBoardThumbnail, { boardId, revision, trashed });
}

function readSvg(response: Awaited<ReturnType<typeof readThumbnail>>) {
  assert.ok(response.thumbnail);
  expect(response.thumbnail.mimeType).toBe('image/svg+xml');
  expect(response.thumbnail.content.byteLength).toBeLessThanOrEqual(128 * 1024);

  return new TextDecoder().decode(response.thumbnail.content);
}

async function trash(board: BoardSummary) {
  const { receipt } = await callWhiteboard(server.address, owner, manageBoard, {
    boardId: board.boardId,
    commandId: 'trash-preview-board',
    expectedEntryVersion: board.entryVersion,
    operation: { case: 'lifecycle', value: BoardLifecycleAction.TRASH },
  });
  assert.equal(receipt?.outcome.case, 'changed');
}

test('renders a bounded SVG of the saved scene and replaces it only at a new revision', async () => {
  const { boardId } = await create();
  expect((await readThumbnail(boardId, 0n)).thumbnail).toBeUndefined();
  await draw(boardId);
  expect((await list()).previewRevision).toBe(1n);
  const before = await readThumbnail(boardId, 1n);
  expect(before.thumbnail?.revision).toBe(1n);
  const initialSvg = readSvg(before);
  expect(initialSvg).toContain('viewBox="0 0 560 320"');
  expect(initialSvg).toContain('<ellipse');
  expect(initialSvg).toContain('fill="#aabbcc"');
  expect(initialSvg).toContain('&lt;script&gt;Visible');
  expect(initialSvg).not.toContain('<script>');
  expect((await readThumbnail(boardId, 0n)).thumbnail).toBeUndefined();

  const image = await callWhiteboard(server.address, owner, attachBoardImage, {
    boardId,
    commandId: 'add-thumbnail-image',
    objectId: 'thumbnail-photo',
    displayName: 'Photo',
    geometry: { x: 300, y: 20, width: 80, height: 120, rotation: 0 },
    content: pngImage,
  });
  assert.equal(image.receipt?.outcome.case, 'applied');
  expect((await list()).previewRevision).toBe(2n);
  expect((await readThumbnail(boardId, 1n)).thumbnail).toBeUndefined();
  const newSvg = readSvg(await readThumbnail(boardId, 2n));
  expect(newSvg).toContain('href="data:image/png;base64,');
  expect(newSvg).not.toEqual(initialSvg);
});

test('authorizes every cached preview against the current active or owner trash view', async () => {
  const { boardId } = await create();
  grantCatalogEditor(server.databasePath, boardId, editor);
  await draw(boardId);
  const active = await list();
  const editorPreview = await readThumbnail(boardId, 1n, editor);
  expect(editorPreview.thumbnail?.revision).toBe(1n);

  const foreign = await sendWhiteboardRequest(server.address, outsider, getBoardThumbnail, {
    boardId,
    revision: 1n,
  });
  expect(foreign.status).toBe(403);
  await trash(active);

  const hidden = await sendWhiteboardRequest(server.address, owner, getBoardThumbnail, {
    boardId,
    revision: 1n,
  });
  const foreignTrash = await sendWhiteboardRequest(server.address, editor, getBoardThumbnail, {
    boardId,
    revision: 1n,
    trashed: true,
  });
  expect(hidden.status).toBe(403);
  expect(foreignTrash.status).toBe(403);

  const { boards } = await callWhiteboard(server.address, owner, listTrashedBoards, {
    pageSize: 10,
  });
  expect(boards[0]?.board).toMatchObject({ boardId, previewRevision: 1n });
  const inTrash = await readThumbnail(boardId, 1n, owner, true);
  expect(inTrash.thumbnail).toEqual(editorPreview.thumbnail);
  const ambiguous = await sendWhiteboardRequest(server.address, owner, getBoardThumbnail, {
    boardId,
    trashed: true,
  });
  expect(ambiguous.status).toBe(400);
});

test('uses a representative bounded sample once a saved scene exceeds the preview object budget', async () => {
  const { boardId } = await create();
  seedPreviewScene(server.databasePath, boardId, 161);

  const svg = readSvg(await readThumbnail(boardId, 1n));
  expect(svg.match(/<ellipse\b/g)).toHaveLength(160);
});
