import assert from 'node:assert/strict';
import {
  BoardEditRejectionReason,
  BoardEditService,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import { WhiteboardService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { expect, test } from 'vitest';
import {
  countReceiptBytes,
  openBoardEditReceiptDatabase,
  receiptActor,
  receiptBoardId,
  receiptDocumentId,
  stableDocumentId,
} from '../support/board-edit-receipt-database.js';
import { callWhiteboard } from '../support/whiteboard-client.js';
import {
  documentId,
  documentPayloadVersion,
  editorId,
  mainBoardId,
} from '../support/whiteboard-database.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

type ReceiptDatabase = ReturnType<typeof openBoardEditReceiptDatabase>;

const editionCount = 220;
const largeParagraph = 'a'.repeat(64 * 1024);
const geometryCommit = {
  actorId: receiptActor.id,
  kind: 'geometry',
  savedAtMillis: 2_000,
} as const;

const server = useWhiteboardTestServer();
const { editObjectContent, getBoardEditReceipt } = BoardEditService.method;
const { getBoardScene } = WhiteboardService.method;

function editDocument(edition: number, title = 'Saved document ' + edition) {
  return callWhiteboard(server.address, editorId, editObjectContent, {
    boardId: mainBoardId,
    commandId: 'document-edit-' + edition,
    objectId: documentId,
    expectedPayloadVersion: documentPayloadVersion + BigInt(edition - 1),
    edit: {
      case: 'document',
      value: {
        title,
        schemaVersion: 1,
        blocks: [
          {
            blockId: 'paragraph',
            type: 'paragraph',
            content: {
              kind: { case: 'stringValue', value: largeParagraph + edition },
            },
          },
        ],
      },
    },
  });
}

test('stores only compact references through 220 document edits and never reapplies an expired command', async () => {
  const first = await editDocument(1);
  const command = { boardId: mainBoardId, commandId: 'document-edit-1' };
  expect(first.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: {
      boardRevision: 1n,
      changedPayloads: [{ objectId: documentId }],
    },
  });
  const before = await callWhiteboard(server.address, editorId, getBoardEditReceipt, command);
  expect(before.receipt).toEqual(first.receipt);

  for (let edition = 2; edition <= editionCount; edition += 1) {
    const { receipt } = await editDocument(edition);
    assert.equal(receipt?.outcome.case, 'applied');
    assert.equal(receipt.outcome.value.boardRevision, BigInt(edition));
  }

  const statistics = countReceiptBytes(server.databasePath, mainBoardId);
  expect(statistics?.receipt_count).toBe(editionCount);
  expect(statistics?.receipt_bytes).toBeLessThan(editionCount * 512);

  await server.restart();
  const retained = await editDocument(21);
  expect(retained.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: {
      boardRevision: 21n,
      changedPayloads: [
        {
          objectId: documentId,
          result: {
            case: 'payload',
            value: {
              payloadVersion: documentPayloadVersion + 21n,
              body: {
                case: 'document',
                value: {
                  blocks: [
                    { content: { kind: { case: 'stringValue', value: largeParagraph + '21' } } },
                  ],
                },
              },
            },
          },
        },
      ],
      detailsExpired: false,
    },
  });

  const expired = await callWhiteboard(server.address, editorId, getBoardEditReceipt, command);
  expect(expired.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: {
      boardRevision: 1n,
      changedObjects: [{ objectId: documentId, payloadVersion: documentPayloadVersion + 1n }],
      changedPayloads: [],
      detailsExpired: true,
    },
  });
  expect((await editDocument(1)).receipt).toEqual(expired.receipt);
  expect((await editDocument(1, 'Different intent')).receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.COMMAND_ID_REUSE },
  });

  const live = await callWhiteboard(server.address, editorId, getBoardScene, {
    boardId: mainBoardId,
  });
  expect(live.scene?.boardRevision).toBe(220n);
  expect(server.errors).toEqual([]);
}, 15_000);

function storeReceipt(
  { repository }: ReceiptDatabase,
  commandId: string,
  ids: readonly string[],
  order?: readonly string[],
) {
  return repository.write((writer) => {
    const board = writer.getBoard(receiptBoardId);
    assert.ok(board);
    const payloads = writer.getPayloads(receiptBoardId, ids).map((payload) => ({
      ...payload,
      payloadVersion: 1n,
      data: { ...payload.data, title: 'Original ' + payload.objectId },
    }));
    const outcome = writer.applyBoardChanges(
      board,
      { kind: 'changes', payloads, order },
      geometryCommit,
    );
    const receipt = { boardId: receiptBoardId, commandId, outcome };
    writer.saveEditReceipt(receiptActor.id, { signature: commandId, receipt });

    return receipt;
  });
}

function changeDocumentAndOrder({ repository }: ReceiptDatabase) {
  repository.write((writer) => {
    const board = writer.getBoard(receiptBoardId);
    const [payload] = writer.getPayloads(receiptBoardId, [receiptDocumentId]);
    assert.ok(board && payload);
    writer.applyBoardChanges(
      board,
      {
        kind: 'changes',
        payloads: [
          { ...payload, payloadVersion: 2n, data: { ...payload.data, title: 'Current title' } },
        ],
        order: [receiptDocumentId, stableDocumentId],
      },
      geometryCommit,
    );
  });
}

function ageReceipt({ repository }: ReceiptDatabase) {
  for (let move = 0; move < 200; move += 1) {
    repository.write((writer) => {
      const board = writer.getBoard(receiptBoardId);
      const [object] = writer.getObjects(receiptBoardId, [receiptDocumentId]);
      assert.ok(board && object);

      writer.applyBoardChanges(
        board,
        {
          kind: 'changes',
          objects: [
            {
              ...object,
              geometryVersion: object.geometryVersion + 1n,
              geometry: { ...object.geometry, x: move + 1 },
            },
          ],
        },
        geometryCommit,
      );
    });
  }
}

test('replays historical order and exact payloads, then keeps only exact live details after expiry', () => {
  const storage = openBoardEditReceiptDatabase();
  function readReceipt(commandId: string) {
    return storage.repository.read(
      (reader) => reader.getEditReceipt(receiptBoardId, receiptActor.id, commandId)?.receipt,
    );
  }
  try {
    const first = storeReceipt(
      storage,
      'ordered-receipt',
      [receiptDocumentId, stableDocumentId],
      [stableDocumentId, receiptDocumentId],
    );
    changeDocumentAndOrder(storage);
    expect(readReceipt(first.commandId)).toEqual(first);

    ageReceipt(storage);
    const expired = readReceipt(first.commandId);
    expect(expired?.outcome).toMatchObject({
      kind: 'applied',
      boardRevision: 1n,
      detailsExpired: true,
      order: undefined,
      payloads: [
        {
          objectId: stableDocumentId,
          payloadVersion: 1n,
          data: { title: 'Original ' + stableDocumentId },
        },
      ],
    });
  } finally {
    storage.close();
  }
});

test('fully replays an expired unordered receipt if its payload version is still live', () => {
  const storage = openBoardEditReceiptDatabase();
  try {
    const first = storeReceipt(storage, 'unchanged-content', [stableDocumentId]);
    ageReceipt(storage);
    storage.repository.read((reader) => {
      expect(reader.getVersion(receiptBoardId, 1n)).toBeUndefined();
      expect(reader.getEditReceipt(receiptBoardId, receiptActor.id, first.commandId)).toEqual({
        signature: first.commandId,
        receipt: first,
      });
    });
  } finally {
    storage.close();
  }
});
