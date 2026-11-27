import {
  BoardEditRejectionReason,
  BoardEditService,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import { WhiteboardService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { actorHeader, callWhiteboard } from '../support/whiteboard-client.js';
import { editorId, mainBoardId, outsiderId, viewerId } from '../support/whiteboard-database.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

const server = useWhiteboardTestServer();
const { attachBoardVideo, editBoardGeometry, editObjectContent, getBoardEditReceipt } =
  BoardEditService.method;
const { getObjectPayloads } = WhiteboardService.method;
const geometry = { x: 24, y: 128, width: 480, height: 270, rotation: 0 };

function fixture(extension: string) {
  const path = new URL('../fixtures/blue-frame.' + extension, import.meta.url);

  return new Uint8Array(readFileSync(path));
}

function asset(actorId: string, objectId: string) {
  const source = '/studio-archive-assets/' + mainBoardId + '/video-' + objectId;

  return fetch(new URL(source, server.address), {
    headers: { [actorHeader]: actorId },
    signal: AbortSignal.timeout(5_000),
  });
}

test.each([
  ['mp4', 'video/mp4'],
  ['webm', 'video/webm'],
  ['mov', 'video/quicktime'],
])(
  'persists a real %s video and reuses its authorized receipt and bytes',
  async (extension, mediaType) => {
    const displayName = 'clip.' + extension;
    const content = fixture(extension);
    const objectId = 'video-card';
    const commandId = 'attach-clip';
    const input = {
      boardId: mainBoardId,
      commandId,
      objectId,
      displayName,
      geometry,
      content,
      mediaType,
    };
    const result = await callWhiteboard(server.address, editorId, attachBoardVideo, input);
    assert.equal(result.receipt?.outcome.case, 'applied');
    assert.equal(result.receipt.outcome.value.changedObjects[0]?.kind, 'video');
    assert.equal(result.receipt.outcome.value.boardRevision, 1n);

    assert.deepEqual(
      await callWhiteboard(server.address, editorId, attachBoardVideo, input),
      result,
    );
    await server.restart();
    const recorded = await callWhiteboard(server.address, editorId, getBoardEditReceipt, {
      boardId: mainBoardId,
      commandId,
    });
    assert.deepEqual(recorded.receipt, result.receipt);

    const payloads = await callWhiteboard(server.address, viewerId, getObjectPayloads, {
      boardId: mainBoardId,
      objectIds: [objectId],
    });
    const stored = payloads.results[0]?.result;
    assert.equal(stored?.case, 'payload');
    assert.equal(stored.value.body.case, 'video');
    assert.equal(
      stored.value.body.value.src,
      '/studio-archive-assets/' + mainBoardId + '/video-' + objectId,
    );

    const downloaded = await asset(viewerId, objectId);
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.headers.get('content-type'), mediaType);
    assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), content);
    assert.equal((await asset(outsiderId, objectId)).status, 404);
  },
);

test('rejects a mislabeled container and a viewer without publishing an asset', async () => {
  const objectId = 'invalid-video';
  const input = {
    boardId: mainBoardId,
    commandId: 'attach-invalid',
    objectId,
    displayName: 'fake.mp4',
    geometry,
    content: fixture('webm'),
    mediaType: 'video/mp4',
  };
  const invalid = await callWhiteboard(server.address, editorId, attachBoardVideo, input);
  assert.equal(invalid.receipt?.outcome.case, 'rejected');
  assert.equal(invalid.receipt.outcome.value.reason, BoardEditRejectionReason.INVALID_VIDEO);

  const forbidden = await callWhiteboard(server.address, viewerId, attachBoardVideo, {
    ...input,
    mediaType: 'video/webm',
  });
  assert.equal(forbidden.receipt?.outcome.case, 'rejected');
  assert.equal(forbidden.receipt.outcome.value.reason, BoardEditRejectionReason.FORBIDDEN);
  assert.equal((await asset(editorId, objectId)).status, 404);
});

test('creates a link with its URL and applies title and address together against the original version', async () => {
  const boardId = mainBoardId;
  const objectId = 'reference-link';
  const firstHref = 'https://example.com/first';
  const created = await callWhiteboard(server.address, editorId, editBoardGeometry, {
    boardId,
    commandId: 'create-reference',
    operation: {
      case: 'create',
      value: {
        object: { objectId, kind: 'link', label: '链接', geometry },
        initialPayload: { body: { case: 'link', value: { href: firstHref } } },
      },
    },
  });
  assert.equal(created.receipt?.outcome.case, 'applied');
  const expectedPayloadVersion = created.receipt.outcome.value.changedObjects[0]?.payloadVersion;
  assert.equal(expectedPayloadVersion, 0n);

  const title = '架构规范';
  const href = 'https://example.com/design';
  const edit = {
    boardId,
    objectId,
    commandId: 'update-reference',
    expectedPayloadVersion,
    edit: { case: 'link' as const, value: { title, href } },
  };
  const updated = await callWhiteboard(server.address, editorId, editObjectContent, edit);
  assert.equal(updated.receipt?.outcome.case, 'applied');
  assert.equal(updated.receipt.outcome.value.changedObjects[0]?.label, title);
  const payload = updated.receipt.outcome.value.changedPayloads[0]?.result;
  assert.equal(payload?.case, 'payload');
  assert.equal(payload.value.body.case, 'link');
  assert.equal(payload.value.body.value.href, href);

  const stale = await callWhiteboard(server.address, editorId, editObjectContent, {
    ...edit,
    commandId: 'stale-reference',
  });
  assert.equal(stale.receipt?.outcome.case, 'conflict');
  const unsafe = await callWhiteboard(server.address, editorId, editObjectContent, {
    ...edit,
    commandId: 'unsafe-reference',
    expectedPayloadVersion: payload.value.payloadVersion,
    edit: { case: 'link', value: { title, href: 'javascript:alert(1)' } },
  });
  assert.equal(unsafe.receipt?.outcome.case, 'rejected');
  assert.equal(unsafe.receipt.outcome.value.reason, BoardEditRejectionReason.INVALID_EDIT);
});
