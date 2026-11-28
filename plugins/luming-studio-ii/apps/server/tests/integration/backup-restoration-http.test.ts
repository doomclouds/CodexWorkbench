import assert from 'node:assert/strict';
import { fromBinary } from '@bufbuild/protobuf';
import {
  ArchiveImportRejectionReason,
  BoardArchiveService,
  ImportBoardArchiveResponseSchema,
} from '@codexworkbench/luming-studio-ii-contracts/archives/service';
import { BoardCatalogService } from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import {
  FeedbackService,
  FeedbackThreadStatus,
} from '@codexworkbench/luming-studio-ii-contracts/feedback/service';
import { BoardSuggestionService } from '@codexworkbench/luming-studio-ii-contracts/suggestions/service';
import { BoardEditService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import { BoardHistoryService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/history';
import {
  BoardExportFormat,
  ObjectPayloadUnavailableReason,
  WhiteboardService,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { expect, test } from 'vitest';
import { pngImage } from '../fixtures/board-image-bytes.js';
import { rejectArchiveReceiptInserts } from '../support/archive-database.js';
import {
  legacyStudioIIBackup,
  nativeTextBackup,
  readRestoredReviewSource,
  restoredArchiveCounts,
} from '../support/backup-restoration-database.js';
import { grantCatalogEditor } from '../support/catalog-lifecycle-database.js';
import {
  actorHeader,
  callWhiteboard,
  sendWhiteboardRequest,
} from '../support/whiteboard-client.js';
import { editorId, outsiderId, teammateId } from '../support/whiteboard-database.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

const server = useWhiteboardTestServer();
const { exportBoard, getBoardScene, getObjectPayloads } = WhiteboardService.method;
const { editBoardGeometry, editObjectContent, attachBoardImage } = BoardEditService.method;
const { listBoardVersions, getBoardVersionScene, getBoardVersionPayloads, restoreBoardVersion } =
  BoardHistoryService.method;
const { applyFeedback, getThread } = FeedbackService.method;
const geometry = { x: 30, y: 40, width: 140, height: 110, rotation: 0 };
const whole = { case: 'whole', value: {} } as const;
const timeout = 5_000;
const documentId = 'document';
const imageId = 'past-image';

function postArchive(content: Uint8Array, commandId: string, actorId = outsiderId) {
  const route = '/' + BoardArchiveService.typeName + '/ImportBoardArchive';

  return fetch(new URL(route, server.address), {
    method: 'POST',
    headers: {
      [actorHeader]: actorId,
      'content-type': 'application/zip',
      'x-studio-command-id': commandId,
    },
    body: Buffer.from(content),
    signal: AbortSignal.timeout(timeout),
  });
}

async function upload(content: Uint8Array, commandId: string) {
  const response = await postArchive(content, commandId);
  assert.equal(response.status, 200);
  const reply = fromBinary(
    ImportBoardArchiveResponseSchema,
    new Uint8Array(await response.arrayBuffer()),
  );
  assert.equal(reply.receipt?.outcome.case, 'imported');

  return reply.receipt.outcome.value.boardId;
}

async function createSourceBoard() {
  const { receipt } = await callWhiteboard(
    server.address,
    editorId,
    BoardCatalogService.method.createBoard,
    {
      commandId: 'new-backup-source',
      title: 'Portable history',
    },
  );
  assert.equal(receipt?.outcome.case, 'created');
  const { boardId } = receipt.outcome.value;
  grantCatalogEditor(server.databasePath, boardId, teammateId);
  const document = await callWhiteboard(server.address, editorId, editBoardGeometry, {
    boardId,
    commandId: 'place-document',
    operation: {
      case: 'create',
      value: {
        object: { objectId: documentId, kind: 'document', label: 'Plan', geometry },
        initialPayload: {
          body: {
            case: 'document',
            value: {
              title: 'Plan',
              schemaVersion: 1,
              blocks: [],
            },
          },
        },
      },
    },
  });
  assert.equal(document.receipt?.outcome.case, 'applied');
  const edited = await callWhiteboard(server.address, editorId, editObjectContent, {
    boardId,
    commandId: 'save-document',
    objectId: documentId,
    expectedPayloadVersion: 0n,
    edit: {
      case: 'document',
      value: {
        title: 'Plan',
        schemaVersion: 1,
        blocks: [
          {
            blockId: 'paragraph-1',
            type: 'paragraph',
            content: { kind: { case: 'stringValue', value: 'A frozen paragraph.' } },
          },
        ],
      },
    },
  });
  assert.equal(edited.receipt?.outcome.case, 'applied');

  return boardId;
}

async function addDiscussion(boardId: string) {
  const created = await callWhiteboard(server.address, editorId, applyFeedback, {
    boardId,
    commandId: 'anchor-discussion',
    operation: {
      case: 'create',
      value: {
        text: 'Check this paragraph.',
        anchor: {
          target: {
            case: 'contentPoint',
            value: {
              objectId: documentId,
              u: 0.5,
              v: 0.5,
              geometryVersion: 0n,
              payloadVersion: 1n,
              content: { case: 'document', value: { blockIds: ['paragraph-1'] } },
            },
          },
        },
      },
    },
  });
  assert.equal(created.receipt?.outcome.case, 'applied');
  const { threadId } = created.receipt.outcome.value;
  const reply = await callWhiteboard(server.address, teammateId, applyFeedback, {
    boardId,
    commandId: 'reply-discussion',
    operation: { case: 'reply', value: { threadId, text: 'I checked it.' } },
  });
  assert.equal(reply.receipt?.outcome.case, 'applied');
  const resolved = await callWhiteboard(server.address, editorId, applyFeedback, {
    boardId,
    commandId: 'resolve-discussion',
    operation: {
      case: 'resolve',
      value: { threadId, expectedThreadVersion: reply.receipt.outcome.value.threadVersion },
    },
  });
  assert.equal(resolved.receipt?.outcome.case, 'applied');

  return threadId;
}

async function addHistoricalImage(boardId: string) {
  const attached = await callWhiteboard(server.address, editorId, attachBoardImage, {
    boardId,
    commandId: 'attach-past-image',
    objectId: imageId,
    displayName: 'Previous figure.png',
    geometry,
    content: pngImage,
  });
  assert.equal(attached.receipt?.outcome.case, 'applied');
  const removed = await callWhiteboard(server.address, editorId, editBoardGeometry, {
    boardId,
    commandId: 'delete-past-image',
    operation: {
      case: 'delete',
      value: { targets: [{ objectId: imageId, expectedGeometryVersion: 0n }] },
    },
  });
  assert.equal(removed.receipt?.outcome.case, 'applied');
}

async function confirmHistoricalMedia(boardId: string) {
  const content = await callWhiteboard(server.address, outsiderId, getBoardVersionPayloads, {
    boardId,
    revision: 3n,
    objectIds: [imageId],
  });
  const payload = content.results[0]?.result;
  assert.equal(payload?.case, 'payload');
  assert.equal(payload.value.body.case, 'image');
  const { src } = payload.value.body.value;
  expect(src).toBe('/studio-archive-assets/' + boardId + '/image-' + imageId);
  assert.ok(src);
  const url = new URL(src, server.address);
  const media = await fetch(url, {
    headers: { [actorHeader]: outsiderId },
    signal: AbortSignal.timeout(timeout),
  });
  expect(media.status).toBe(200);
  expect(new Uint8Array(await media.arrayBuffer())).toEqual(pngImage);
  const other = await fetch(url, {
    headers: { [actorHeader]: editorId },
    signal: AbortSignal.timeout(timeout),
  });
  expect(other.status).toBe(404);
}

test('restores fixed revisions, historical media, discussion and frozen review source under a new owner', async () => {
  const sourceId = await createSourceBoard();
  const threadId = await addDiscussion(sourceId);
  const frozen = await callWhiteboard(
    server.address,
    editorId,
    BoardSuggestionService.method.createBoardReviewSource,
    {
      boardId: sourceId,
      commandId: 'freeze-document',
      expectedBoardRevision: 2n,
      origin: { case: 'feedbackThreadId', value: threadId },
    },
  );
  assert.ok(frozen.source);
  await addHistoricalImage(sourceId);
  const { result } = await callWhiteboard(server.address, editorId, exportBoard, {
    boardId: sourceId,
    expectedRevision: 4n,
    format: BoardExportFormat.ZIP,
    scope: whole,
  });
  assert.equal(result.case, 'file');
  const { content } = result.value;
  const boardId = await upload(content, 'restore-full-backup');
  expect(boardId).not.toBe(sourceId);
  await server.restart();
  expect(await upload(content, 'restore-full-backup')).toBe(boardId);

  const history = await callWhiteboard(server.address, outsiderId, listBoardVersions, { boardId });
  expect(history.versions.map((version) => version.revision)).toEqual([4n, 3n, 2n, 1n, 0n]);
  const latest = await callWhiteboard(server.address, outsiderId, getBoardScene, { boardId });
  expect(latest.scene?.objects.map((object) => object.objectId)).toEqual([documentId]);
  await confirmHistoricalMedia(boardId);

  const feedback = await callWhiteboard(server.address, outsiderId, getThread, {
    boardId,
    threadId,
  });
  expect(feedback.thread).toMatchObject({
    status: FeedbackThreadStatus.RESOLVED,
    version: 3n,
    first: { text: 'Check this paragraph.', authorActorId: editorId, canEdit: false },
    anchor: { frozenExcerpt: 'A frozen paragraph.', sourceBoardRevision: 2n, targetMissing: false },
  });
  expect(feedback.replies).toMatchObject([{ text: 'I checked it.', authorActorId: teammateId }]);
  expect(
    readRestoredReviewSource(server.databasePath, boardId, frozen.source.sourceId),
  ).toMatchObject({
    boardId,
    ownerActorId: outsiderId,
    capturedBoardRevision: 2n,
    targetsBoardRevision: 2n,
    feedbackThreadId: threadId,
    targets: [{ objectId: documentId, geometryVersion: 0n, payloadVersion: 1n, geometry }],
  });
  const denied = await sendWhiteboardRequest(server.address, editorId, getBoardScene, { boardId });
  expect(denied.status).toBe(403);

  const restored = await callWhiteboard(server.address, outsiderId, restoreBoardVersion, {
    boardId,
    commandId: 'restore-past-image',
    revision: 3n,
    expectedCurrentRevision: 4n,
    scope: whole,
  });
  expect(restored.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: { boardRevision: 5n },
  });
  const current = await callWhiteboard(server.address, outsiderId, getBoardScene, { boardId });
  expect(current.scene?.objects.map((object) => object.objectId)).toEqual([documentId, imageId]);

  const beforeFailure = restoredArchiveCounts(server.databasePath);
  rejectArchiveReceiptInserts(server.databasePath);
  expect((await postArchive(content, 'restore-rollback')).status).toBe(500);
  expect(restoredArchiveCounts(server.databasePath)).toEqual(beforeFailure);
});

test('recovers available history from a Studio II v4 backup predating the native archive marker', async () => {
  const content = await legacyStudioIIBackup();
  assert.ok(content);
  const boardId = await upload(content, 'restore-previous-ii');
  const history = await callWhiteboard(server.address, outsiderId, listBoardVersions, { boardId });
  expect(history.versions.map(({ revision }) => revision)).toEqual([1n, 0n]);
  const before = await callWhiteboard(server.address, outsiderId, getBoardVersionScene, {
    boardId,
    revision: 0n,
  });
  expect(before.scene?.objects).toEqual([]);
  const after = await callWhiteboard(server.address, outsiderId, getBoardScene, { boardId });
  expect(after.scene?.objects).toMatchObject([{ objectId: 'box', label: 'Current' }]);
});

test('carries the current shared ink palette through both copying and archive restoration', async () => {
  const sourceId = await createSourceBoard();
  const objectId = 'palette-shape';
  const color = '#3864A2';
  const created = await callWhiteboard(server.address, editorId, editBoardGeometry, {
    boardId: sourceId,
    commandId: 'create-palette-shape',
    operation: {
      case: 'create',
      value: {
        object: {
          objectId,
          kind: 'shape',
          label: 'Palette sample',
          geometry,
          geometryDetail: { case: 'shape', value: { outline: 'rect' } },
        },
      },
    },
  });
  assert.equal(created.receipt?.outcome.case, 'applied');

  const painted = await callWhiteboard(server.address, editorId, editBoardGeometry, {
    boardId: sourceId,
    commandId: 'register-palette-ink',
    operation: {
      case: 'style',
      value: {
        targets: [{ target: { objectId, expectedGeometryVersion: 0n } }],
        patch: { stroke: color },
        rememberColor: color,
      },
    },
  });
  assert.equal(painted.receipt?.outcome.case, 'applied');

  const { result } = await callWhiteboard(server.address, editorId, exportBoard, {
    boardId: sourceId,
    expectedRevision: painted.receipt.outcome.value.boardRevision,
    format: BoardExportFormat.ZIP,
    scope: whole,
  });
  assert.equal(result.case, 'file');
  const restoredId = await upload(result.value.content, 'restore-ink-palette');
  const copy = await callWhiteboard(
    server.address,
    editorId,
    BoardCatalogService.method.duplicateBoard,
    {
      sourceBoardId: sourceId,
      commandId: 'duplicate-ink-palette',
    },
  );
  assert.equal(copy.receipt?.outcome.case, 'created');
  const copiedId = copy.receipt.outcome.value.boardId;

  await server.restart();
  for (const [boardId, actorId] of [
    [restoredId, outsiderId],
    [copiedId, editorId],
  ] as const) {
    const restored = await callWhiteboard(server.address, actorId, getBoardScene, { boardId });
    expect(restored.scene?.customColors?.colors).toEqual([color]);
    const shape = restored.scene?.objects.find((object) => object.objectId === objectId);
    expect(shape?.appearance?.stroke).toBe(color);
  }
});

test('restores a native text payload and returns its version and content through the public read route', async () => {
  const content = await nativeTextBackup({ text: 'Stored text' });
  assert.ok(content);
  const boardId = await upload(content, 'restore-native-text');
  const { results } = await callWhiteboard(server.address, outsiderId, getObjectPayloads, {
    boardId,
    objectIds: ['archived-text', 'missing-text'],
  });

  expect(results).toMatchObject([
    {
      objectId: 'archived-text',
      result: {
        case: 'payload',
        value: { payloadVersion: 0n, body: { case: 'text', value: { text: 'Stored text' } } },
      },
    },
    {
      objectId: 'missing-text',
      result: {
        case: 'unavailable',
        value: { reason: ObjectPayloadUnavailableReason.NOT_FOUND },
      },
    },
  ]);
});

test.each([
  ['invalid field value', { text: 123 }],
  ['unknown field', { text: 'Stored text', unknown: true }],
])('records an incompatible receipt for a native payload with an %s', async (field, data) => {
  const content = await nativeTextBackup(data);
  assert.ok(content);
  const before = restoredArchiveCounts(server.databasePath);
  assert.ok(before);

  const response = await postArchive(
    content,
    'reject-native-archive-' + field.replaceAll(' ', '-'),
  );
  assert.equal(response.status, 200);
  const reply = fromBinary(
    ImportBoardArchiveResponseSchema,
    new Uint8Array(await response.arrayBuffer()),
  );
  expect(reply.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: ArchiveImportRejectionReason.INCOMPATIBLE_CONTENT },
  });
  expect(server.errors).toEqual([]);
  expect(restoredArchiveCounts(server.databasePath)).toEqual({
    ...before,
    receipts: Number(before.receipts) + 1,
  });
});
