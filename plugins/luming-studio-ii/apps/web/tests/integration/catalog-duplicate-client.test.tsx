import { create, fromBinary, toBinary, type MessageInitShape } from '@bufbuild/protobuf';
import {
  BoardCatalogService,
  CatalogRejectionReason,
  type CatalogCommandReceiptSchema,
} from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import { expect, test } from 'vitest';
import {
  createBoardCatalogService,
  type CatalogDuplicateRequest,
} from '../../src/data/catalog/index.js';

const { duplicateBoard, getCatalogCommandReceipt } = BoardCatalogService.method;
const catalogPath = '/luming.studio.v1.BoardCatalogService/';
const sourceBoardId = 'original-board';
const commandId = 'duplicate-42';
const command: CatalogDuplicateRequest = { sourceBoardId, commandId };
const board = {
  boardId: 'new-board',
  title: '发布工作台 副本',
  updatedAtMillis: 1_795_707_308_815n,
  pinned: false,
  entryVersion: 0n,
  canManage: true,
};
const created = { commandId, outcome: { case: 'created', value: board } } as const;

type WireReceipt = MessageInitShape<typeof CatalogCommandReceiptSchema>;

function reply(receipt: WireReceipt) {
  return toBinary(duplicateBoard.output, create(duplicateBoard.output, { receipt }));
}

test('requests a copy with both IDs and reads the confirmed new catalog entry', async () => {
  const signal = new AbortController().signal;
  const catalog = createBoardCatalogService(async (path, bytes, activeSignal) => {
    expect(path).toBe(catalogPath + 'DuplicateBoard');
    expect(fromBinary(duplicateBoard.input, bytes)).toMatchObject(command);
    expect(activeSignal).toBe(signal);

    return reply(created);
  });

  await expect(catalog.duplicateBoard(command, signal)).resolves.toEqual({
    kind: 'created',
    commandId,
    board,
  });
});

test('checks a previously confirmed copy through the existing command receipt RPC', async () => {
  const signal = new AbortController().signal;
  const catalog = createBoardCatalogService(async (path, bytes, activeSignal) => {
    expect(path).toBe(catalogPath + 'GetCatalogCommandReceipt');
    expect(fromBinary(getCatalogCommandReceipt.input, bytes).commandId).toBe(commandId);
    expect(activeSignal).toBe(signal);

    return toBinary(
      getCatalogCommandReceipt.output,
      create(getCatalogCommandReceipt.output, { result: { case: 'receipt', value: created } }),
    );
  });

  await expect(catalog.getReceipt(commandId, signal)).resolves.toEqual({
    kind: 'created',
    commandId,
    board,
  });
});

test('keeps an unrecorded copy distinct from a confirmed or rejected outcome', async () => {
  const catalog = createBoardCatalogService(async () =>
    toBinary(
      getCatalogCommandReceipt.output,
      create(getCatalogCommandReceipt.output, {
        result: { case: 'notRecorded', value: { commandId } },
      }),
    ),
  );

  await expect(catalog.getReceipt(commandId)).resolves.toBeUndefined();
});

test.each([
  [CatalogRejectionReason.FORBIDDEN, 'forbidden'],
  [CatalogRejectionReason.STATE_CHANGED, 'stateChanged'],
  [CatalogRejectionReason.INVALID_COMMAND, 'invalidCommand'],
  [CatalogRejectionReason.COMMAND_ID_REUSE, 'commandIdReuse'],
  [CatalogRejectionReason.UNSPECIFIED, 'unknown'],
] as const)('decodes duplicate rejection %s as %s', async (reason, expected) => {
  const receipt = { commandId, outcome: { case: 'rejected', value: { reason } } } as const;
  const catalog = createBoardCatalogService(async () => reply(receipt));

  await expect(catalog.duplicateBoard(command)).resolves.toEqual({
    kind: 'rejected',
    commandId,
    reason: expected,
  });
});

test('rejects a response belonging to another command or the source board', async () => {
  const wrongIdentity = createBoardCatalogService(async () =>
    reply({ ...created, commandId: 'another-command' }),
  );
  const sameBoard = createBoardCatalogService(async () =>
    reply({
      ...created,
      outcome: { case: 'created', value: { ...board, boardId: sourceBoardId } },
    }),
  );

  await expect(wrongIdentity.duplicateBoard(command)).rejects.toThrow('unexpected command ID');
  await expect(sameBoard.duplicateBoard(command)).rejects.toThrow('returned the source board ID');
});

test('requires both IDs before making a duplicate request', async () => {
  let requests = 0;
  const catalog = createBoardCatalogService(async () => {
    requests++;

    return reply(created);
  });

  await expect(catalog.duplicateBoard({ ...command, sourceBoardId: ' ' })).rejects.toThrow(
    'source board ID is required',
  );
  await expect(catalog.duplicateBoard({ ...command, commandId: '' })).rejects.toThrow(
    'command ID is required',
  );
  expect(requests).toBe(0);
});
