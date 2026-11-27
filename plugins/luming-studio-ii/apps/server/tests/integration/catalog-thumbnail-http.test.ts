import assert from 'node:assert/strict';
import {
  BoardCatalogService,
  BoardLifecycleAction,
  type BoardSummary,
} from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import { BoardEditService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import { expect, test } from 'vitest';
import { pngImage } from '../fixtures/board-image-bytes.js';
import { seedPreviewContents, seedPreviewScene } from '../support/catalog-database.js';
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
  const trashed = boards[0]?.board;
  expect(trashed?.boardId).toBe(boardId);
  const revision = trashed?.previewRevision;
  assert.ok(revision !== undefined);
  const inTrash = await readThumbnail(boardId, revision, owner, true);
  expect(inTrash.thumbnail?.revision).toBe(revision);
  expect(inTrash.thumbnail?.content).toEqual(editorPreview.thumbnail?.content);
  const ambiguous = await sendWhiteboardRequest(server.address, owner, getBoardThumbnail, {
    boardId,
    trashed: true,
  });
  expect(ambiguous.status).toBe(400);
});

test('renders blank paper for an empty board only in the authorized trash view', async () => {
  const { boardId } = await create();
  grantCatalogEditor(server.databasePath, boardId, editor);
  expect((await readThumbnail(boardId, 0n)).thumbnail).toBeUndefined();

  await trash(await list());
  const { boards } = await callWhiteboard(server.address, owner, listTrashedBoards, {
    pageSize: 10,
  });
  const revision = boards[0]?.board?.previewRevision;
  assert.ok(revision !== undefined);
  const preview = await readThumbnail(boardId, revision, owner, true);
  expect(preview.thumbnail?.revision).toBe(revision);
  expect(readSvg(preview)).toContain('viewBox="0 0 960 540"');
  expect(readSvg(preview)).toContain('<rect width="100%" height="100%" fill="#f5f5f5"/>');
  expect(readSvg(preview)).toContain('@media(prefers-color-scheme:dark){rect{fill:#848586}}');
  expect((await readThumbnail(boardId, revision + 1n, owner, true)).thumbnail).toBeUndefined();

  const foreign = await sendWhiteboardRequest(server.address, editor, getBoardThumbnail, {
    boardId,
    revision,
    trashed: true,
  });
  expect(foreign.status).toBe(403);
});

test('uses a representative bounded sample once a saved scene exceeds the preview object budget', async () => {
  const { boardId } = await create();
  seedPreviewScene(server.databasePath, boardId, 161);

  const svg = readSvg(await readThumbnail(boardId, 1n));
  expect(svg.match(/<ellipse\b/g)).toHaveLength(160);
});

const htmlDiagram = `<!doctype html>
<head><style>.grid { display: grid; grid-template-columns: 1fr 1fr; color: #ffffff; background: #31578c }
#diagram { padding: 12px } p {background-image:url(https://example.invalid/pixel)}</style></head>
<body><main id="diagram" class="grid" onclick="window.location='https://example.invalid'">
<h2 style="background:linear-gradient(url(//example.invalid/hidden),#fff)">Saved HTML diagram</h2>
<svg width="72" height="52" viewBox="0 0 72 52">
<defs><marker id="tip" viewBox="0 0 10 10" markerWidth="6" markerHeight="6" refX="5" refY="5"><path d="M0 0L10 5L0 10Z"/></marker></defs>
<rect x="1" y="1" width="20" height="30" rx="2" fill="#80ab55"/>
<path d="M20 10L55 10" marker-end="url(#tip)" stroke="#263345"/>
<use href="https://example.invalid/sprite"/>
</svg></main><p hidden>Hidden text</p><script>live content</script>
<iframe src="https://example.invalid/frame"></iframe></body>`;

const documentBody = {
  title: 'Project notes',
  blocks: [
    {
      content: [{ text: 'Saved document paragraph' }],
      children: [{ content: [{ text: 'Nested note' }] }],
    },
  ],
};

const todoBody = {
  title: 'Checklist',
  items: [
    { text: 'Completed task', checked: true },
    { text: 'Open task', checked: false },
  ],
};

test('shows saved document, checklist, diagram, picture, and sticker contents in a small cover', async () => {
  const { boardId } = await create();
  seedPreviewContents(server.databasePath, boardId, [
    { kind: 'html', label: 'HTML frame', bodyKind: 'embed', body: { html: htmlDiagram } },
    { kind: 'document', label: 'Document frame', body: documentBody },
    { kind: 'todo', label: 'Checklist frame', body: todoBody },
    { kind: 'sticker', label: 'Sticker frame', body: { stickerId: 'heart' } },
    { kind: 'note', label: 'Note frame', bodyKind: 'text', body: { text: 'Saved sticky note' } },
    {
      kind: 'image',
      label: 'Photo frame',
      body: {
        src: 'data:image/png;base64,' + Buffer.from(pngImage).toString('base64'),
        crop: { zoom: 2, x: 0.5, y: 0.3 },
        naturalSize: { width: 1, height: 1 },
      },
    },
  ]);

  const svg = readSvg(await readThumbnail(boardId, 1n));
  expect(svg).toContain('display:grid;grid-template-columns:1fr 1fr');
  expect(svg).toContain('Saved HTML diagram');
  expect(svg).toContain('fill="#80ab55"');
  expect(svg).toContain('marker-end="url(#thumbnail-html-0-tip)"');
  expect(svg).toContain('Saved document paragraph');
  expect(svg).toContain('Nested note');
  expect(svg).toContain('✓ Completed task');
  expect(svg).toContain('□ Open task');
  expect(svg).toContain('viewBox="0 0 24 24"');
  expect(svg).toContain('Saved sticky note');
  expect(svg).toContain('href="data:image/png;base64,');
  expect(svg).toContain('preserveAspectRatio="none" href="data:image/png;base64,');
  expect(svg).not.toMatch(
    /hidden text|live content|onclick|example\.invalid|<script|<iframe|<use\b/iu,
  );
});

test('keeps small saved content when an adjacent payload exceeds the read budget', async () => {
  const { boardId } = await create();
  seedPreviewContents(server.databasePath, boardId, [
    {
      kind: 'html',
      label: 'Large source',
      bodyKind: 'embed',
      body: { html: '<p>Large source content</p>'.repeat(4_100) },
    },
    { kind: 'document', label: 'Document frame', body: documentBody },
  ]);

  const svg = readSvg(await readThumbnail(boardId, 1n));
  expect(svg).toContain('Large source</text>');
  expect(svg).toContain('Saved document paragraph');
  expect(svg).not.toContain('Large source content');
});

test('does not render detailed payload contents in a large board overview', async () => {
  const { boardId } = await create();
  seedPreviewScene(server.databasePath, boardId, 40);
  seedPreviewContents(server.databasePath, boardId, [
    { kind: 'html', label: 'HTML frame', bodyKind: 'embed', body: { html: htmlDiagram } },
    { kind: 'document', label: 'Document frame', body: documentBody },
  ]);

  const svg = readSvg(await readThumbnail(boardId, 1n));
  expect(svg).toContain('HTML frame');
  expect(svg).toContain('Document frame');
  expect(svg).not.toMatch(/<foreignObject|Saved HTML diagram|Saved document paragraph/u);
});
