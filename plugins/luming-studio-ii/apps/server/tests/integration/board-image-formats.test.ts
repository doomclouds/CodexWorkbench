import {
  BoardEditRejectionReason,
  BoardEditService,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import { BoardHistoryService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/history';
import { BoardExportFormat } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { expect, test } from 'vitest';
import { actorHeader, callWhiteboard } from '../support/whiteboard-client.js';
import { editorId, mainBoardId, outsiderId, viewerId } from '../support/whiteboard-database.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

const server = useWhiteboardTestServer();
const { attachBoardImage } = BoardEditService.method;
const { exportBoardVersion } = BoardHistoryService.method;
const loopingGif = new Uint8Array(
  Buffer.from(
    '47494638396101000100800000000000ffffff21ff0b4e45545343415045322e300301000000' +
      '21f90400050000002c0000000001000100000202440100' +
      '21f90400050000002c00000000010001000002024c01003b',
    'hex',
  ),
);
const objectId = 'new-format';
const commandId = 'upload-new-format';
const source = '/studio-archive-assets/' + mainBoardId + '/image-' + objectId;
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 18">';
const allowedSvg =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  svg +
  '<defs><linearGradient id="fade"><stop stop-color="#cfbc86"/></linearGradient></defs>' +
  '<rect width="32" height="18" fill="url(#fade)"/></svg>';

function upload(content: Uint8Array, displayName: string, actorId = editorId) {
  return callWhiteboard(server.address, actorId, attachBoardImage, {
    boardId: mainBoardId,
    objectId,
    commandId,
    displayName,
    geometry: { x: 20, y: 25, width: 64, height: 36 },
    content,
  });
}

function download(actorId = viewerId) {
  return fetch(new URL(source, server.address), {
    headers: { [actorHeader]: actorId },
    signal: AbortSignal.timeout(5_000),
  });
}

test('retains the original two-frame GIF across storage, restart and SVG export', async () => {
  const saved = await upload(loopingGif, 'moving.gif');
  assert.equal(saved.receipt?.outcome.case, 'applied');
  const { boardRevision } = saved.receipt.outcome.value;
  await server.restart();

  const asset = await download();
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('content-type'), 'image/gif');
  assert.deepEqual(new Uint8Array(await asset.arrayBuffer()), loopingGif);
  assert.equal((await download(outsiderId)).status, 404);

  const exportResult = await callWhiteboard(server.address, viewerId, exportBoardVersion, {
    boardId: mainBoardId,
    revision: boardRevision,
    scope: { case: 'selection', value: { objectIds: [objectId] } },
    format: BoardExportFormat.SVG,
  });
  assert.equal(exportResult.result.case, 'file');
  const markup = new TextDecoder().decode(exportResult.result.value.content);
  const animation = /data:image\/gif;base64,([^"]+)/u.exec(markup)?.[1];
  assert.ok(animation);
  assert.deepEqual(new Uint8Array(Buffer.from(animation, 'base64')), loopingGif);
});

test('normalizes safe SVG to a PNG and returns the original idempotent receipt', async () => {
  const content = new TextEncoder().encode(allowedSvg);
  const saved = await upload(content, 'gradient.svg');
  assert.equal(saved.receipt?.outcome.case, 'applied');
  assert.deepEqual(await upload(content, 'gradient.svg'), saved);
  expect((await upload(loopingGif, 'changed.gif')).receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.COMMAND_ID_REUSE },
  });

  const asset = await download();
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('content-type'), 'image/png');
  const raster = new DataView(await asset.arrayBuffer());
  assert.equal(raster.getUint32(0), 0x89504e47);
  assert.equal(raster.getUint32(16), 32);
  assert.equal(raster.getUint32(20), 18);
});

test('rejects script, active DOM and external references before publishing SVG assets', async () => {
  const unsafe = [
    svg + '<script>alert(1)</script></svg>',
    svg + '<rect width="32" height="18" onload="alert(1)"/></svg>',
    svg + '<foreignObject width="32" height="18"/></svg>',
    svg + '<image href="https://example.invalid/image.png"/></svg>',
    svg + '<use href="https://example.invalid/vector.svg#item"/></svg>',
    svg + '<rect fill="url(https://example.invalid/gradient.svg#value)"/></svg>',
    svg + '<style>@import "https://example.invalid/style.css";</style></svg>',
    svg + '<use href="&#x68;ttps://example.invalid/vector.svg#item"/></svg>',
    '<?xml-stylesheet href="https://example.invalid/style.css"?>' + svg + '</svg>',
    '<!DOCTYPE svg [<!ENTITY external SYSTEM "file:///image">]>' + svg + '&external;</svg>',
    svg + '<text>&#0;</text></svg>',
  ];

  for (const markup of unsafe) {
    const saved = await upload(new TextEncoder().encode(markup), 'unsafe.svg');
    expect(saved.receipt?.outcome).toMatchObject({
      case: 'rejected',
      value: { reason: BoardEditRejectionReason.INVALID_IMAGE },
    });
  }

  assert.equal((await download()).status, 404);
  assert.deepEqual(server.errors, []);
});

test('checks board edit access before preparing SVG or publishing a receipt', async () => {
  const forbidden = await upload(new TextEncoder().encode(allowedSvg), 'gradient.svg', viewerId);
  expect(forbidden.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.FORBIDDEN },
  });
  assert.equal((await download()).status, 404);
});
