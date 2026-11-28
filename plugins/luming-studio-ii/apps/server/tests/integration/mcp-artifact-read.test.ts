import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { BoardArchiveService } from '@codexworkbench/luming-studio-ii-contracts/archives/service';
import { BoardCatalogService } from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import { FeedbackService } from '@codexworkbench/luming-studio-ii-contracts/feedback/service';
import { BoardEditService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import { WhiteboardService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect, test } from 'vitest';
import { createStudioMcpServer } from '../../src/entrypoints/mcp/index.js';
import { pngImage } from '../fixtures/board-image-bytes.js';
import { grantCatalogEditor } from '../support/catalog-lifecycle-database.js';
import { actorHeader, callWhiteboard } from '../support/whiteboard-client.js';
import { seedEditableContent, todoObjectId } from '../support/whiteboard-content-fixture.js';
import {
  documentContent,
  documentId,
  documentPayloadVersion,
  editorId,
  mainBoardId,
  outsiderId,
  secondBoardId,
  shapeId,
} from '../support/whiteboard-database.js';
import {
  embedId,
  seedNativeObjects,
  tableId,
} from '../support/whiteboard-native-content-fixture.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

const server = useWhiteboardTestServer();
const { editObjectContent } = BoardEditService.method;
const { moveObjects } = WhiteboardService.method;
const { applyFeedback } = FeedbackService.method;
const boardId = mainBoardId;
let nextFixture = 0;

async function fixture(actor = editorId, now = Date.now) {
  const fixtureId = ++nextFixture;
  let count = 0;
  const mcp = createStudioMcpServer({
    html: '<html></html>',
    pluginVersion: '1.0.0',
    now,
    allocateId: () =>
      '11111111-1111-4111-8111-' +
      String(fixtureId).padStart(6, '0') +
      String(++count).padStart(6, '0'),
    createFile: () => Promise.reject(new Error('The read took an unexpected transfer path.')),
    async dispatch({ route, method, mediaType, body }, signal) {
      const headers = new Headers({ [actorHeader]: actor });
      if (mediaType) {
        headers.set('content-type', mediaType);
      }

      return fetch(new URL(route, server.address), {
        method,
        headers,
        body: body instanceof Uint8Array ? Buffer.from(body) : body,
        signal,
      });
    },
    onError(error) {
      throw error;
    },
  });
  const client = new Client({ name: 'model-read-fixture', version: '1.0.0' });
  const [incoming, outgoing] = InMemoryTransport.createLinkedPair();
  await mcp.connect(outgoing);
  await client.connect(incoming);

  const result = (args: Record<string, unknown>) =>
    client.callTool({ name: 'artifact_read', arguments: args });

  return {
    client,
    result,
    async read(args: Record<string, unknown>) {
      const reply = (await result(args)).structuredContent;
      assert.ok(reply && typeof reply === 'object' && 'ok' in reply);
      assert.equal(reply.ok, true);
      assert.ok('data' in reply);

      return reply.data;
    },
    async denied(args: Record<string, unknown>, code: string) {
      const reply = await result(args);
      expect(reply).toMatchObject({
        isError: true,
        structuredContent: { ok: false, error: { code } },
      });
    },
    async close() {
      try {
        await mcp.close();
      } finally {
        await client.close();
      }
    },
  };
}

type ReadFixture = Awaited<ReturnType<typeof fixture>>;

async function connectView(app: ReadFixture, boardId?: string) {
  const tool = await app.client.callTool({
    name: 'studio_app_request',
    arguments: { version: 1, action: 'connect', boardId },
  });
  expect(tool.structuredContent).toEqual({ ok: true });
  const meta = tool._meta as { session?: { id: string } } | undefined;
  assert.ok(meta?.session?.id);

  return meta.session.id;
}

function viewAction(app: ReadFixture, sessionId: string, fields: Record<string, unknown>) {
  return app.client.callTool({
    name: 'studio_app_request',
    arguments: { version: 1, action: 'view', sessionId, ...fields },
  });
}

const viewId = 'actual-codex-view';
const panelState = {
  boardId,
  selectedIds: [documentId, shapeId],
  selectedCount: 2,
  viewport: { x: 145, y: -62, zoom: 0.65 },
  focusedObjectId: documentId,
  returnViewport: { x: 17, y: 24, zoom: 1 },
};

test('reads only the exact shared live panel across MCP servers and clears it on close', async () => {
  const panel = await fixture();
  const agent = await fixture();
  const otherActor = await fixture(outsiderId);
  try {
    const sessionId = await connectView(panel, boardId);
    const request = { boardId, viewId, mode: 'context' };
    const first = { viewId, sequence: 1, state: panelState };
    expect((await viewAction(panel, sessionId, first)).structuredContent).toEqual({ ok: true });
    expect(await agent.read(request)).toMatchObject({
      boardId,
      viewId,
      source: 'live-panel',
      contexts: [{ ...panelState, viewId, updatedAtMillis: expect.stringMatching(/^\d+$/u) }],
    });
    await agent.denied({ ...request, boardId: secondBoardId }, 'LIVE_CONTEXT_REQUIRED');
    await agent.denied({ ...request, viewId: 'other-view' }, 'LIVE_CONTEXT_REQUIRED');
    await otherActor.denied(request, 'LIVE_CONTEXT_REQUIRED');

    const otherBoard = { ...panelState, boardId: secondBoardId };
    expect(
      (await viewAction(panel, sessionId, { viewId, sequence: 2, state: otherBoard })).isError,
    ).toBe(true);
    expect((await viewAction(panel, sessionId, { ...first, viewId: 'forged-view' })).isError).toBe(
      true,
    );
    const generic = await panel.client.callTool({
      name: 'studio_app_request',
      arguments: {
        version: 1,
        action: 'request',
        sessionId,
        service: 'luming.studio.v1.McpPanelViewService',
        method: 'UpdatePanelView',
      },
    });
    expect(generic.isError).toBe(true);
    expect((await viewAction(panel, sessionId, { viewId, sequence: 2 })).structuredContent).toEqual(
      { ok: true },
    );
    await agent.denied(request, 'LIVE_CONTEXT_REQUIRED');
    expect(
      (await viewAction(panel, sessionId, { ...first, sequence: 3 })).structuredContent,
    ).toEqual({ ok: true });

    await panel.close();
    await agent.denied(request, 'LIVE_CONTEXT_REQUIRED');
  } finally {
    await Promise.all([panel.close(), agent.close(), otherActor.close()]);
  }
});

test('rejects an older update and leaves the current board live when its previous lease closes', async () => {
  const panel = await fixture();
  const agent = await fixture();
  try {
    const previous = await connectView(panel, boardId);
    const next = await connectView(panel, secondBoardId);
    const update = (sessionId: string, sequence: number, state: typeof panelState) =>
      viewAction(panel, sessionId, { viewId, sequence, state });
    expect((await update(previous, 1, panelState)).structuredContent).toEqual({ ok: true });
    const state = {
      ...panelState,
      boardId: secondBoardId,
      selectedIds: [shapeId],
      selectedCount: 1,
    };
    expect((await update(next, 2, state)).structuredContent).toEqual({ ok: true });
    expect((await update(previous, 1, panelState)).structuredContent).toEqual({ ok: true });
    const closed = await panel.client.callTool({
      name: 'studio_app_request',
      arguments: { version: 1, action: 'close', sessionId: previous },
    });
    expect(closed.structuredContent).toEqual({ ok: true });

    const request = { boardId: secondBoardId, viewId, mode: 'context' };
    expect(await agent.read(request)).toMatchObject({ contexts: [{ boardId: secondBoardId }] });
    await agent.denied({ ...request, boardId }, 'LIVE_CONTEXT_REQUIRED');
  } finally {
    await Promise.all([panel.close(), agent.close()]);
  }
});

test('expires a published view when its panel lease ends without an explicit close', async () => {
  const expiry = 1_600;
  const issued = Date.now() - 30 * 60_000 + expiry;
  const panel = await fixture(editorId, () => issued);
  const agent = await fixture();
  try {
    const sessionId = await connectView(panel, boardId);
    const view = { viewId, sequence: 1, state: panelState };
    expect((await viewAction(panel, sessionId, view)).structuredContent).toEqual({ ok: true });
    const read = { boardId, viewId, mode: 'context' };
    expect(await agent.read(read)).toMatchObject({ boardId, viewId });
    await expect
      .poll(async () => (await agent.result(read)).structuredContent, { timeout: 3_000 })
      .toMatchObject({ ok: false, error: { code: 'LIVE_CONTEXT_REQUIRED' } });
  } finally {
    await Promise.all([panel.close(), agent.close()]);
  }
});

function cursor(page: unknown) {
  assert.ok(page && typeof page === 'object' && 'nextCursor' in page);
  assert.ok(typeof page.nextCursor === 'string');

  return page.nextCursor;
}

async function move() {
  const { receipt } = await callWhiteboard(server.address, editorId, moveObjects, {
    boardId,
    commandId: 'advance-board',
    delta: { dx: 24, dy: 20 },
    targets: [{ objectId: shapeId, expectedGeometryVersion: 0n }],
  });
  assert.equal(receipt?.outcome.case, 'applied');
}

test('discovers exact stable targets by range and saved text with cursor scope and revision checks', async () => {
  seedNativeObjects(server.databasePath, false);
  const mcp = await fixture();
  try {
    const catalog = (await mcp.client.listTools()).tools.find(
      ({ name }) => name === 'artifact_read',
    );
    expect(catalog?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    const args = { artifactId: boardId, limit: 1 };
    const first = await mcp.read(args);
    const next = cursor(first);
    expect(first).toMatchObject({
      artifact: { id: boardId, revision: '0' },
      items: [{ id: shapeId, geometryVersion: '0' }],
    });
    expect(await mcp.read({ ...args, cursor: next })).toMatchObject({
      items: [{ id: documentId, payloadVersion: documentPayloadVersion.toString() }],
    });
    await mcp.denied({ ...args, cursor: next, type: 'document' }, 'INVALID_CURSOR');
    await mcp.denied({ ...args, cursor: next, artifactId: secondBoardId }, 'INVALID_CURSOR');

    const region = await mcp.read({ boardId, mode: 'region', rect: { x: 18, y: -6, w: 3, h: 3 } });
    expect(region).toMatchObject({ items: [{ id: shapeId, bounds: { x: 16, y: -8 } }] });
    expect(
      await mcp.read({ boardId, mode: 'search', query: 'fetched when', ids: [documentId] }),
    ).toMatchObject({ items: [{ id: documentId, blockId: 'paragraph-1' }] });
    expect(
      await mcp.read({ boardId, mode: 'search', query: 'open', ids: [tableId] }),
    ).toMatchObject({ items: [{ id: tableId, rowId: 'row-1', columnId: 'col-1' }] });

    await move();
    await mcp.denied({ ...args, cursor: next }, 'CURSOR_STALE');
    await mcp.denied({ ...args, mode: 'context', viewId: 'unseen-view' }, 'LIVE_CONTEXT_REQUIRED');
  } finally {
    await mcp.close();
  }
});

test('returns full typed object payloads, exact document blocks and filtered tasks', async () => {
  seedEditableContent(server.databasePath);
  const mcp = await fixture();
  try {
    const version = documentPayloadVersion.toString();
    const block = { blockId: 'paragraph-1', type: 'paragraph', content: documentContent };
    const payload = { payloadVersion: version, document: { schemaVersion: 1, blocks: [block] } };
    expect(
      await mcp.read({ boardId, mode: 'objects', ids: [documentId, 'missing'] }),
    ).toMatchObject({ items: [{ id: documentId, payload }], missingIds: ['missing'] });
    expect(
      await mcp.read({
        boardId,
        mode: 'blocks',
        elementId: documentId,
        blockIds: ['paragraph-1', 'absent'],
      }),
    ).toMatchObject({
      elementId: documentId,
      payloadVersion: version,
      blocks: [block],
      missingBlockIds: ['absent'],
    });
    expect(
      await mcp.read({ boardId, mode: 'tasks', elementId: todoObjectId, checked: true }),
    ).toMatchObject({
      items: [{ itemId: 'initial-row', text: 'Inspect design', checked: true }],
    });
    expect(
      await mcp.read({ boardId, mode: 'tasks', elementId: todoObjectId, checked: false }),
    ).toMatchObject({ items: [] });
    const before = await mcp.read({
      boardId,
      mode: 'units',
      atRevision: '0',
      ids: [documentId, 'missing'],
    });
    expect(before).toMatchObject({
      units: [
        { id: documentId, after: { payload } },
        { id: 'missing', after: null },
      ],
    });
  } finally {
    await mcp.close();
  }
});

async function editSource(text: string, expectedPayloadVersion: bigint) {
  const { receipt } = await callWhiteboard(server.address, editorId, editObjectContent, {
    boardId,
    commandId: 'edit-read-source-' + expectedPayloadVersion,
    objectId: embedId,
    expectedPayloadVersion,
    edit: {
      case: 'embedSource',
      value: {
        title: 'Read source test',
        html: text,
        expectedSourceRevision: expectedPayloadVersion,
      },
    },
  });
  assert.equal(receipt?.outcome.case, 'applied');
}

async function reassembleHtml(mcp: ReadFixture, requested: Record<string, unknown>) {
  let cursor: string | undefined;
  let html = '';
  do {
    const page = await mcp.read({ ...requested, cursor });
    assert.ok(page && typeof page === 'object' && 'html' in page);
    assert.ok(typeof page.html === 'string');
    expect(page).toMatchObject({ offset: html.length, sourceRevision: '1', payloadVersion: '1' });
    expect(Buffer.byteLength(JSON.stringify(page), 'utf8')).toBeLessThanOrEqual(32 * 1024);
    html += page.html;
    cursor = 'nextCursor' in page ? String(page.nextCursor) : undefined;
  } while (cursor);

  return html;
}

async function commentOnSource() {
  const { receipt } = await callWhiteboard(server.address, editorId, applyFeedback, {
    boardId,
    commandId: 'feedback-frozen-source',
    operation: {
      case: 'create',
      value: {
        text: 'Read this original HTML node.',
        anchor: {
          target: {
            case: 'contentPoint',
            value: {
              objectId: embedId,
              u: 0.3,
              v: 0.4,
              geometryVersion: 0n,
              payloadVersion: 1n,
              content: { case: 'html', value: { nodeIds: ['read-node'], sourceRevision: 1n } },
            },
          },
        },
      },
    },
  });
  assert.equal(receipt?.outcome.case, 'applied');

  return receipt.outcome.value.threadId;
}

test('pages exact HTML without splitting Unicode and refuses latest-content substitution', async () => {
  seedNativeObjects(server.databasePath, false);
  const html = '<div data-studio-id="read-node">' + '协作🧪\n'.repeat(13_000) + '</div>';
  await editSource(html, 0n);
  const feedbackId = await commentOnSource();
  const mcp = await fixture();
  try {
    const request = { boardId, mode: 'source', regionId: embedId, sourceRevision: '1' };
    const first = await mcp.read(request);
    expect(first).toHaveProperty('nextCursor');
    expect(await reassembleHtml(mcp, request)).toBe(html);

    await editSource('<p>Current source, different content.</p>', 1n);
    await mcp.denied({ ...request, cursor: cursor(first), sourceRevision: '2' }, 'INVALID_CURSOR');
    await mcp.denied(request, 'VERSION_NOT_FOUND');
    expect(await reassembleHtml(mcp, { ...request, atRevision: '1' })).toBe(html);
    expect(await reassembleHtml(mcp, { ...request, feedbackId })).toBe(html);
    await mcp.denied({ ...request, atRevision: '100' }, 'VERSION_NOT_FOUND');
  } finally {
    await mcp.close();
  }
});

async function commentOnBlock() {
  const { receipt } = await callWhiteboard(server.address, editorId, applyFeedback, {
    boardId,
    commandId: 'feedback-frozen-content',
    operation: {
      case: 'create',
      value: {
        text: 'Read this original block.',
        anchor: {
          target: {
            case: 'contentPoint',
            value: {
              objectId: documentId,
              u: 0.3,
              v: 0.4,
              geometryVersion: 0n,
              payloadVersion: documentPayloadVersion,
              content: { case: 'document', value: { blockIds: ['paragraph-1'] } },
            },
          },
        },
      },
    },
  });
  assert.equal(receipt?.outcome.case, 'applied');

  return receipt.outcome.value.threadId;
}

async function changeDocument() {
  const { receipt } = await callWhiteboard(server.address, editorId, editObjectContent, {
    boardId,
    commandId: 'write-latest-doc',
    objectId: documentId,
    expectedPayloadVersion: documentPayloadVersion,
    edit: {
      case: 'document',
      value: {
        title: 'Updated doc',
        schemaVersion: 1,
        blocks: [
          {
            blockId: 'paragraph-1',
            type: 'paragraph',
            content: { kind: { case: 'stringValue', value: 'Replacement content.' } },
          },
        ],
      },
    },
  });
  assert.equal(receipt?.outcome.case, 'applied');
}

test('reads only the authorized frozen feedback target after the same block changes', async () => {
  const feedbackId = await commentOnBlock();
  await changeDocument();
  const mcp = await fixture();
  const outsider = await fixture(outsiderId);
  try {
    const context = await mcp.read({ boardId, mode: 'context', feedbackId });
    expect(context).toMatchObject({ feedbackId, atRevision: '0' });
    const block = { boardId, mode: 'blocks', elementId: documentId };
    expect(await mcp.read(block)).toMatchObject({
      blocks: [{ content: 'Replacement content.' }],
    });
    expect(await mcp.read({ ...block, feedbackId })).toMatchObject({
      blocks: [{ content: documentContent }],
      payloadVersion: documentPayloadVersion.toString(),
    });
    await mcp.denied({ ...block, feedbackId, blockIds: ['different-block'] }, 'OUT_OF_SCOPE');
    await mcp.denied({ ...block, feedbackId, elementId: shapeId }, 'OUT_OF_SCOPE');
    await mcp.denied({ ...block, feedbackId, atRevision: '1' }, 'INVALID_ARGUMENT');
    await mcp.denied({ boardId: secondBoardId, mode: 'context', feedbackId }, 'NOT_FOUND');
    await outsider.denied({ ...block, feedbackId }, 'FORBIDDEN');
  } finally {
    await Promise.all([mcp.close(), outsider.close()]);
  }
});

test('paginates history and returns scoped before and after revisions with exact diff data', async () => {
  await changeDocument();
  await move();
  const mcp = await fixture();
  try {
    const history = { boardId, mode: 'history', limit: 1 };
    const first = await mcp.read(history);
    expect(first).toMatchObject({ revision: '2', history: [{ id: 'revision-2', revision: '2' }] });
    expect(await mcp.read({ ...history, cursor: cursor(first) })).toMatchObject({
      history: [{ id: 'revision-1', revision: '1' }],
    });
    const ids = [shapeId, documentId];
    const diff = { boardId, mode: 'diff', ids };
    expect(
      await mcp.read({ ...diff, fromVersionId: 'revision-0', toVersionId: '1' }),
    ).toMatchObject({
      fromRevision: '0',
      toRevision: '1',
      units: [
        {
          id: documentId,
          before: { payload: { payloadVersion: documentPayloadVersion.toString() } },
        },
      ],
    });
    expect(await mcp.read({ ...diff, adjacent: true, versionId: 'revision-2' })).toMatchObject({
      fromRevision: '1',
      toRevision: '2',
      units: [
        {
          id: shapeId,
          before: { object: { geometry: { x: 16 } } },
          after: { object: { geometry: { x: 40 }, geometryVersion: '1' } },
        },
      ],
    });
  } finally {
    await mcp.close();
  }
});

async function importAsset(boardId: string, commandId: string) {
  const imported = await callWhiteboard(
    server.address,
    editorId,
    BoardArchiveService.method.importBoardAsset,
    { boardId, commandId, content: pngImage },
  );
  assert.equal(imported.result.case, 'asset');

  return imported.result.value;
}

async function boardWithAsset() {
  const { receipt } = await callWhiteboard(
    server.address,
    editorId,
    BoardCatalogService.method.createBoard,
    { commandId: 'create-model-asset-board', title: 'Model asset read' },
  );
  assert.equal(receipt?.outcome.case, 'created');
  const { boardId } = receipt.outcome.value;
  const asset = await importAsset(boardId, 'model-read-import');

  return { boardId, asset };
}

test('uses owner-only asset metadata listing and requires same-board access for exact bytes', async () => {
  const { asset, boardId } = await boardWithAsset();
  grantCatalogEditor(server.databasePath, boardId, outsiderId);
  const mcp = await fixture();
  const guest = await fixture(outsiderId);
  try {
    expect(await mcp.read({ boardId, mode: 'assets' })).toMatchObject({
      assets: [
        {
          assetId: asset.assetId,
          src: asset.src,
          mediaType: 'image/png',
          byteLength: pngImage.byteLength,
        },
      ],
    });
    await guest.denied({ boardId, mode: 'assets' }, 'FORBIDDEN');
    expect(await guest.read({ boardId, mode: 'resource', assetId: asset.assetId })).toMatchObject({
      assetId: asset.assetId,
      mediaType: 'image/png',
      base64: Buffer.from(pngImage).toString('base64'),
    });
    await mcp.denied(
      { boardId: secondBoardId, mode: 'resource', assetId: asset.assetId },
      'NOT_FOUND',
    );
    await importAsset(boardId, 'second-model-read-import');
    const page = await mcp.read({ boardId, mode: 'assets', limit: 1 });
    const next = cursor(page);
    expect(await mcp.read({ boardId, mode: 'assets', limit: 1, cursor: next })).toMatchObject({
      assets: [expect.objectContaining({ mediaType: 'image/png' })],
    });
    await mcp.denied({ boardId: secondBoardId, mode: 'assets', cursor: next }, 'INVALID_CURSOR');
  } finally {
    await Promise.all([mcp.close(), guest.close()]);
  }
});
