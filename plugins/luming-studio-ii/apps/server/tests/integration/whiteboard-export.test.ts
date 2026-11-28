import assert from 'node:assert/strict';
import { BoardEditService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import { BoardHistoryService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/history';
import {
  BoardExportFormat,
  BoardExportRejectionReason,
  WhiteboardService,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { expect, test } from 'vitest';
import { pngImage } from '../fixtures/board-image-bytes.js';
import { callWhiteboard, sendWhiteboardRequest } from '../support/whiteboard-client.js';
import {
  documentId,
  documentContent,
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
const { exportBoardVersion } = BoardHistoryService.method;
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

test('rasterizes native content as a real PNG and exports the same saved historical version', async () => {
  const selection = { case: 'selection' as const, value: { objectIds: [shapeId] } };
  const live = await callWhiteboard(server.address, viewerId, exportBoard, {
    ...request,
    scope: selection,
    format: BoardExportFormat.PNG,
  });
  assert.equal(live.result.case, 'file');
  const bytes = live.result.value.content;
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(live.result.value).toMatchObject({
    filename: 'Architecture.png',
    mimeType: 'image/png',
    revision: 0n,
  });
  expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect([header.getUint32(16), header.getUint32(20)]).toEqual([164, 144]);

  const version = await callWhiteboard(server.address, viewerId, exportBoardVersion, {
    boardId: mainBoardId,
    revision: 0n,
    scope: selection,
    format: BoardExportFormat.PNG,
  });
  expect(version.result).toEqual(live.result);
});

test('keeps the world crop in the browser plan and applies scale only to output pixels', async () => {
  const crop = { x: 104.5, y: 26.25, width: 30.5, height: 25 };
  const result = await callWhiteboard(server.address, viewerId, exportBoard, {
    ...request,
    format: BoardExportFormat.PNG,
    rectangle: crop,
    scale: 2,
  });
  assert.equal(result.result.case, 'browserPng');
  expect(result.result.value).toMatchObject({
    width: 61,
    height: 50,
    regions: [{ width: 100, height: 80 }],
  });
  const svg = result.result.value.svgTemplate;
  expect(svg).toContain('width="61" height="50" viewBox="104.5 26.25 30.5 25"');
  expect(svg).toContain('preserveAspectRatio="none"');
  expect(svg).not.toContain('translate(300 44)');

  const oversize = await callWhiteboard(server.address, viewerId, exportBoard, {
    ...request,
    format: BoardExportFormat.PNG,
    rectangle: { ...crop, width: 10_000 },
    scale: 2,
  });
  expect(oversize.result).toMatchObject({
    case: 'rejected',
    value: { reason: BoardExportRejectionReason.TOO_LARGE },
  });
});

test('exports the todo progress, checkbox shapes and task sources in SVG and renders its PNG', async () => {
  const objectId = 'todo-export-card';
  const create = await callWhiteboard(
    server.address,
    editorId,
    BoardEditService.method.editBoardGeometry,
    {
      boardId: mainBoardId,
      commandId: 'add-export-todo',
      operation: {
        case: 'create',
        value: {
          object: {
            objectId,
            kind: 'todo',
            label: '项目待办',
            geometry: { width: 340, height: 160 },
          },
        },
      },
    },
  );
  expect(create.receipt?.outcome.case).toBe('applied');

  const change = await callWhiteboard(
    server.address,
    editorId,
    BoardEditService.method.editObjectContent,
    {
      boardId: mainBoardId,
      objectId,
      commandId: 'fill-export-todo',
      expectedPayloadVersion: 0n,
      edit: {
        case: 'todo',
        value: {
          edits: [
            {
              operation: {
                case: 'insert',
                value: {
                  item: {
                    itemId: 'done',
                    text: '审核 <事项>',
                    checked: true,
                    sourceRef: { objectId: documentId, boardId: mainBoardId, version: 0n },
                  },
                  placement: { position: { case: 'append', value: true } },
                },
              },
            },
            {
              operation: {
                case: 'insert',
                value: {
                  item: { itemId: 'open', text: '发给同事' },
                  placement: { position: { case: 'append', value: true } },
                },
              },
            },
          ],
        },
      },
    },
  );
  expect(change.receipt?.outcome.case).toBe('applied');

  const selection = {
    ...request,
    expectedRevision: 2n,
    scope: { case: 'selection' as const, value: { objectIds: [objectId] } },
  };
  const svg = await callWhiteboard(server.address, viewerId, exportBoard, {
    ...selection,
    format: BoardExportFormat.SVG,
  });
  assert.equal(svg.result.case, 'file');
  const markup = new TextDecoder().decode(svg.result.value.content);
  expect(markup).toContain('>1/2</text>');
  expect(markup).toContain('data-studio-task-id="done" data-checked="true"');
  expect(markup).toContain('data-studio-task-id="open" data-checked="false"');
  expect(markup).toContain(
    `data-source-ref="{&quot;elementId&quot;:&quot;${documentId}&quot;,&quot;artifactId&quot;:&quot;${mainBoardId}&quot;,&quot;version&quot;:0}"`,
  );
  expect(markup).toContain('<rect x="14" y="9" width="14" height="14"');
  expect(markup).toContain('审核 &lt;事项&gt;');

  const png = await callWhiteboard(server.address, viewerId, exportBoard, {
    ...selection,
    format: BoardExportFormat.PNG,
  });
  assert.equal(png.result.case, 'file');
  expect(png.result.value.mimeType).toBe('image/png');
  const bytes = png.result.value.content;
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect([header.getUint32(16), header.getUint32(20)]).toEqual([404, 224]);
});

async function createExportDiagram(html: string) {
  const { receipt } = await callWhiteboard(
    server.address,
    editorId,
    BoardEditService.method.editBoardGeometry,
    {
      boardId: mainBoardId,
      commandId: 'insert-export-html',
      operation: {
        case: 'create',
        value: {
          object: {
            objectId: 'html-card',
            kind: 'html',
            label: 'Offline',
            geometry: { x: 8, y: -6, width: 200, height: 120 },
          },
          initialPayload: {
            body: { case: 'embed', value: { title: 'Offline', html, sourceRevision: 0n } },
          },
        },
      },
    },
  );
  expect(receipt?.outcome.case).toBe('applied');
}

test('exports complete native documents plus isolated embedded content, and prepares its rich PNG', async () => {
  const html =
    '<!doctype html><html><body><p>Offline diagram</p><script>window.loaded=true</script></body></html>';
  await createExportDiagram(html);
  const current = { ...request, expectedRevision: 1n };
  const web = await callWhiteboard(server.address, viewerId, exportBoard, {
    ...current,
    format: BoardExportFormat.HTML,
  });
  assert.equal(web.result.case, 'file');
  expect(web.result.value).toMatchObject({
    filename: 'Architecture.html',
    mimeType: 'text/html',
    revision: 1n,
  });
  const contents = new TextDecoder().decode(web.result.value.content);
  expect(contents).toContain(documentContent);
  expect(contents).toContain('sandbox="allow-scripts"');
  expect(contents).toContain('Offline diagram');
  expect(contents).toContain('connect-src &apos;none&apos;');

  const source = await callWhiteboard(server.address, viewerId, exportBoard, {
    ...current,
    scope: { case: 'selection', value: { objectIds: ['html-card'] } },
    format: BoardExportFormat.HTML_SOURCE,
  });
  assert.equal(source.result.case, 'file');
  expect(source.result.value).toMatchObject({
    filename: 'Offline.html',
    mimeType: 'text/html',
    content: new TextEncoder().encode(html),
  });

  const selection = await callWhiteboard(server.address, viewerId, exportBoard, {
    ...current,
    scope: { case: 'selection', value: { objectIds: ['html-card'] } },
    format: BoardExportFormat.HTML,
  });
  assert.equal(selection.result.case, 'file');
  const selected = new TextDecoder().decode(selection.result.value.content);
  expect(selected).toContain('sandbox="allow-scripts"');
  expect(selected).toContain('Offline diagram');
  expect(selected).not.toContain(documentContent);

  const png = await callWhiteboard(server.address, viewerId, exportBoard, {
    ...current,
    format: BoardExportFormat.PNG,
  });
  assert.equal(png.result.case, 'browserPng');
  const plan = png.result.value;
  const region = plan.regions.find((item) => item.html.includes('Offline diagram'));
  assert.ok(region);
  expect(plan).toMatchObject({ filename: 'Architecture.png', revision: 1n });
  expect(plan.svgTemplate).toContain(`<g data-studio-png-region="${region.index}"></g>`);
  expect(plan.svgTemplate).not.toContain('<script>');
  expect(region.html).toContain("script-src 'unsafe-inline'");
  expect(region.html).toContain("connect-src 'none'");
  expect(region.html).toContain('Offline diagram');
  expect(region.html).toContain('Object.defineProperty(window');
});

test('prepares live and historical SVG and HTML for a selection and its own media', async () => {
  const attach = await callWhiteboard(
    server.address,
    editorId,
    BoardEditService.method.attachBoardImage,
    {
      boardId: mainBoardId,
      commandId: 'rich-svg-media',
      objectId: 'rich-svg-media',
      displayName: 'Figure.png',
      geometry: { x: 0, y: 0, width: 100, height: 80 },
      content: pngImage,
    },
  );
  expect(attach.receipt?.outcome.case).toBe('applied');
  await createExportDiagram(
    `<p>Diagram at revision two</p><img src="/studio-archive-assets/${mainBoardId}/image-rich-svg-media">`,
  );

  const selection = { case: 'selection' as const, value: { objectIds: ['html-card'] } };
  const live = await callWhiteboard(server.address, viewerId, exportBoard, {
    ...request,
    expectedRevision: 2n,
    scope: selection,
    format: BoardExportFormat.SVG,
  });
  assert.equal(live.result.case, 'browserPng');
  expect(live.result.value).toMatchObject({
    filename: 'Architecture.svg',
    revision: 2n,
    width: 264,
    height: 184,
  });
  expect(live.result.value.svgTemplate).toContain('data-studio-png-region="0"');
  expect(live.result.value.regions[0]?.html).toContain('src="data:image/png;base64,');

  const liveHtml = await callWhiteboard(server.address, viewerId, exportBoard, {
    ...request,
    expectedRevision: 2n,
    scope: selection,
    format: BoardExportFormat.HTML,
  });
  assert.equal(liveHtml.result.case, 'file');
  const liveContents = new TextDecoder().decode(liveHtml.result.value.content);
  expect(liveContents).toContain('Diagram at revision two');
  expect(liveContents).toContain('data:image/png;base64,');
  expect(liveContents).not.toContain(documentContent);

  const changed = await callWhiteboard(
    server.address,
    editorId,
    BoardEditService.method.editObjectContent,
    {
      boardId: mainBoardId,
      commandId: 'edit-rich-svg',
      objectId: 'html-card',
      expectedPayloadVersion: 0n,
      edit: {
        case: 'embedSource',
        value: { title: 'Offline', html: '<p>Later diagram</p>', expectedSourceRevision: 0n },
      },
    },
  );
  expect(changed.receipt?.outcome.case).toBe('applied');
  const archived = await callWhiteboard(server.address, viewerId, exportBoardVersion, {
    boardId: mainBoardId,
    revision: 2n,
    scope: selection,
    format: BoardExportFormat.SVG,
  });
  expect(archived.result).toEqual(live.result);
  assert.equal(archived.result.case, 'browserPng');
  expect(archived.result.value.regions[0]?.html).toContain('Diagram at revision two');
  expect(archived.result.value.regions[0]?.html).not.toContain('Later diagram');

  const archivedHtml = await callWhiteboard(server.address, viewerId, exportBoardVersion, {
    boardId: mainBoardId,
    revision: 2n,
    scope: selection,
    format: BoardExportFormat.HTML,
  });
  expect(archivedHtml.result).toEqual(liveHtml.result);
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
