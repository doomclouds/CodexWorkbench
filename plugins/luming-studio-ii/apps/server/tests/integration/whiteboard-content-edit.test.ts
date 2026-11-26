import {
  BoardEditRejectionReason,
  BoardEditService,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import { WhiteboardService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { expect, test } from 'vitest';
import { callWhiteboard, sendWhiteboardRequest } from '../support/whiteboard-client.js';
import {
  imageAssetId,
  noteObjectId,
  seedEditableContent,
  todoObjectId,
} from '../support/whiteboard-content-fixture.js';
import {
  documentId,
  documentPayloadVersion,
  editorId,
  mainBoardId,
  secondBoardId,
  shapeId,
  viewerId,
} from '../support/whiteboard-database.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

const server = useWhiteboardTestServer();
const { editObjectContent, getBoardEditReceipt } = BoardEditService.method;
const { getBoardScene, getObjectPayloads, moveObjects } = WhiteboardService.method;
const nextTitle = 'Revised architecture document';
const request = {
  boardId: mainBoardId,
  commandId: 'save-content',
  objectId: documentId,
  expectedPayloadVersion: documentPayloadVersion,
  edit: {
    case: 'document' as const,
    value: {
      title: nextTitle,
      schemaVersion: 1,
      blocks: [{ blockId: 'paragraph-1', type: 'paragraph' }],
    },
  },
};

test('saves exact payload versions without undoing a move and replays the durable receipt', async () => {
  const moved = await callWhiteboard(server.address, editorId, moveObjects, {
    boardId: mainBoardId,
    commandId: 'move-before-content',
    delta: { dx: 20, dy: 12 },
    targets: [{ objectId: documentId, expectedGeometryVersion: 0n }],
  });
  expect(moved.receipt?.outcome.case).toBe('applied');

  const saved = await callWhiteboard(server.address, editorId, editObjectContent, request);
  const payloadVersion = documentPayloadVersion + 1n;
  expect(saved.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: {
      boardRevision: 2n,
      changedObjects: [
        { objectId: documentId, label: nextTitle, geometryVersion: 1n, payloadVersion },
      ],
      changedPayloads: [
        {
          objectId: documentId,
          result: { case: 'payload', value: { payloadVersion, body: { case: 'document' } } },
        },
      ],
    },
  });

  await server.restart();
  const replayed = await callWhiteboard(server.address, editorId, editObjectContent, request);
  const receipt = await callWhiteboard(server.address, editorId, getBoardEditReceipt, {
    boardId: mainBoardId,
    commandId: request.commandId,
  });
  expect(replayed.receipt).toEqual(saved.receipt);
  expect(receipt.receipt).toEqual(saved.receipt);

  const scene = await callWhiteboard(server.address, viewerId, getBoardScene, {
    boardId: mainBoardId,
  });
  expect(scene.scene?.boardRevision).toBe(2n);
  expect(scene.scene?.objects.find(({ objectId }) => objectId === documentId)).toMatchObject({
    label: nextTitle,
    geometry: { x: 120, y: 36 },
    geometryVersion: 1n,
    payloadVersion,
  });

  const content = await callWhiteboard(server.address, viewerId, getObjectPayloads, {
    boardId: mainBoardId,
    objectIds: [documentId],
  });
  expect(content.results[0]?.result).toMatchObject({
    case: 'payload',
    value: {
      payloadVersion,
      body: {
        case: 'document',
        value: { title: nextTitle, blocks: [{ blockId: 'paragraph-1', type: 'paragraph' }] },
      },
    },
  });
});

test('reports current content on a stale editor and rejects writes by viewers or to the wrong type', async () => {
  const saved = await callWhiteboard(server.address, editorId, editObjectContent, request);
  expect(saved.receipt?.outcome.case).toBe('applied');

  const conflict = await callWhiteboard(server.address, editorId, editObjectContent, {
    ...request,
    commandId: 'stale-content',
  });
  expect(conflict.receipt?.outcome).toMatchObject({
    case: 'conflict',
    value: { boardRevision: 1n, currentPayloads: [{ objectId: documentId }] },
  });

  const readonly = await callWhiteboard(server.address, viewerId, editObjectContent, {
    ...request,
    commandId: 'readonly-content',
  });
  expect(readonly.receipt?.outcome).toEqual({
    case: 'rejected',
    value: expect.objectContaining({ reason: BoardEditRejectionReason.FORBIDDEN }),
  });

  const wrongKind = await callWhiteboard(server.address, editorId, editObjectContent, {
    ...request,
    commandId: 'wrong-kind',
    objectId: shapeId,
  });
  expect(wrongKind.receipt?.outcome).toEqual({
    case: 'rejected',
    value: expect.objectContaining({ reason: BoardEditRejectionReason.UNSUPPORTED_KIND }),
  });
});

test('requires a version before planning writes', async () => {
  const missingVersion = await sendWhiteboardRequest(server.address, editorId, editObjectContent, {
    ...request,
    expectedPayloadVersion: undefined,
  });
  expect(missingVersion.status).toBe(400);
  expect(server.errors).toHaveLength(0);
});

test('persists todo order, false checked state and validated same-board links', async () => {
  seedEditableContent(server.databasePath);
  const sourceRef = { boardId: mainBoardId, objectId: documentId, blockId: 'paragraph-1' };
  const response = await callWhiteboard(server.address, editorId, editObjectContent, {
    boardId: mainBoardId,
    commandId: 'save-todo',
    objectId: todoObjectId,
    expectedPayloadVersion: 0n,
    edit: {
      case: 'todo',
      value: {
        edits: [
          {
            operation: {
              case: 'insert',
              value: {
                item: { itemId: 'another-row', text: 'Read source', sourceRef },
                placement: { position: { case: 'first', value: true } },
              },
            },
          },
          { operation: { case: 'update', value: { itemId: 'initial-row', checked: false } } },
        ],
      },
    },
  });
  expect(response.receipt?.outcome.case).toBe('applied');

  const invalidSource = await callWhiteboard(server.address, editorId, editObjectContent, {
    boardId: mainBoardId,
    commandId: 'save-foreign-todo-source',
    objectId: todoObjectId,
    expectedPayloadVersion: 1n,
    edit: {
      case: 'todo',
      value: {
        edits: [
          {
            operation: {
              case: 'update',
              value: {
                itemId: 'initial-row',
                sourceChange: {
                  case: 'sourceRef',
                  value: { ...sourceRef, boardId: secondBoardId },
                },
              },
            },
          },
        ],
      },
    },
  });
  expect(invalidSource.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.INVALID_EDIT },
  });

  const content = await callWhiteboard(server.address, viewerId, getObjectPayloads, {
    boardId: mainBoardId,
    objectIds: [todoObjectId],
  });
  expect(content.results[0]?.result).toMatchObject({
    case: 'payload',
    value: {
      payloadVersion: 1n,
      body: {
        case: 'todo',
        value: {
          items: [
            { itemId: 'another-row', sourceRef },
            { itemId: 'initial-row', checked: false },
          ],
        },
      },
    },
  });
});

test('updates text on a position-locked note and respects prior formatting', async () => {
  seedEditableContent(server.databasePath);
  const response = await callWhiteboard(server.address, editorId, editObjectContent, {
    boardId: mainBoardId,
    commandId: 'edit-locked-note',
    objectId: noteObjectId,
    expectedPayloadVersion: 0n,
    edit: { case: 'text', value: { text: 'Revised note' } },
  });
  expect(response.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: {
      changedObjects: [
        { objectId: noteObjectId, label: 'Revised note', locked: true, geometryVersion: 0n },
      ],
      changedPayloads: [
        {
          objectId: noteObjectId,
          result: {
            case: 'payload',
            value: {
              payloadVersion: 1n,
              body: {
                case: 'text',
                value: { text: 'Revised note', color: '#2d3142', fontSize: 24 },
              },
            },
          },
        },
      ],
    },
  });
});

function imageBlock(source: string) {
  return { blockId: 'diagram-image', type: 'image', props: { url: source } };
}

function documentWithImage(source: string) {
  return {
    case: 'document' as const,
    value: { ...request.edit.value, blocks: [imageBlock(source)] },
  };
}

test('retains a canonical asset path and rejects an absolute alias to a local server', async () => {
  seedEditableContent(server.databasePath);
  const assetPath = '/studio-archive-assets/' + mainBoardId + '/' + imageAssetId;
  const saved = await callWhiteboard(server.address, editorId, editObjectContent, {
    ...request,
    edit: documentWithImage(assetPath),
  });
  expect(saved.receipt?.outcome.case).toBe('applied');

  const payloadVersion = documentPayloadVersion + 1n;
  const rejected = await callWhiteboard(server.address, editorId, editObjectContent, {
    ...request,
    commandId: 'edit-absolute-image',
    expectedPayloadVersion: payloadVersion,
    edit: documentWithImage(new URL(assetPath, server.address).href),
  });
  expect(rejected.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.INVALID_EDIT },
  });

  const reply = await callWhiteboard(server.address, viewerId, getObjectPayloads, {
    boardId: mainBoardId,
    objectIds: [documentId],
  });
  expect(reply.results[0]?.result).toMatchObject({
    case: 'payload',
    value: {
      payloadVersion,
      body: { case: 'document', value: { blocks: [imageBlock(assetPath)] } },
    },
  });
});
