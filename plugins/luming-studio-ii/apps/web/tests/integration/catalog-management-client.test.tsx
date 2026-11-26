import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  BoardCatalogService,
  BoardLifecycleAction,
  BoardSortOrder,
  CatalogRejectionReason,
} from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import { expect, test } from 'vitest';
import { createCatalogManagementService } from '../../src/data/catalog/index.js';

const { listTrashedBoards, manageBoard, purgeBoards, getCatalogCommandReceipt } =
  BoardCatalogService.method;
const catalogPath = '/luming.studio.v1.BoardCatalogService/';
const commandId = 'catalog-command';
const board = {
  boardId: 'board-alpha',
  title: '原型白板',
  pinned: false,
  entryVersion: 1n,
  canManage: true,
};
const baseCommand = { commandId, boardId: board.boardId, expectedEntryVersion: 0n };
const changed = { commandId, outcome: { case: 'changed', value: board } } as const;

test('reads a trashed page with its cursor, timestamp and management capability', async () => {
  const input = { query: '原型', order: 'title', pageSize: 12, cursor: 'page-2' } as const;
  const trashed = { board, trashedAtMillis: 900n };
  const service = createCatalogManagementService((path, body) => {
    expect(path).toBe(catalogPath + 'ListTrashedBoards');
    expect(fromBinary(listTrashedBoards.input, body)).toMatchObject({
      ...input,
      order: BoardSortOrder.TITLE,
    });

    return Promise.resolve(
      toBinary(
        listTrashedBoards.output,
        create(listTrashedBoards.output, { boards: [trashed], nextCursor: 'page-3' }),
      ),
    );
  });

  await expect(service.listTrashedBoards(input)).resolves.toEqual({
    boards: [trashed],
    nextCursor: 'page-3',
  });
});

const operations = [
  {
    input: { kind: 'rename', title: '新版白板' },
    output: { case: 'title', value: '新版白板' },
  },
  {
    input: { kind: 'pin', pinned: false },
    output: { case: 'pinned', value: false },
  },
  {
    input: { kind: 'trash' },
    output: { case: 'lifecycle', value: BoardLifecycleAction.TRASH },
  },
  {
    input: { kind: 'restore' },
    output: { case: 'lifecycle', value: BoardLifecycleAction.RESTORE },
  },
] as const;

test.each(operations)(
  'encodes $input.kind with the expected catalog entry version',
  async (entry) => {
    const signal = new AbortController().signal;
    const service = createCatalogManagementService((path, body, activeSignal) => {
      expect(path).toBe(catalogPath + 'ManageBoard');
      expect(activeSignal).toBe(signal);
      expect(fromBinary(manageBoard.input, body)).toMatchObject({
        ...baseCommand,
        operation: entry.output,
      });

      return Promise.resolve(
        toBinary(manageBoard.output, create(manageBoard.output, { receipt: changed })),
      );
    });

    await expect(
      service.manageBoard({ ...baseCommand, operation: entry.input }, signal),
    ).resolves.toEqual({ kind: 'changed', commandId, board });
  },
);

test('reports the confirmed and rejected outcomes for separate purge targets', async () => {
  const otherBoardId = 'board-beta';
  const targets = [
    { boardId: board.boardId, expectedEntryVersion: 0n },
    { boardId: otherBoardId, expectedEntryVersion: 7n },
  ];
  const service = createCatalogManagementService((path, body) => {
    expect(path).toBe(catalogPath + 'PurgeBoards');
    expect(fromBinary(purgeBoards.input, body)).toMatchObject({ commandId, targets });

    return Promise.resolve(
      toBinary(
        purgeBoards.output,
        create(purgeBoards.output, {
          receipt: {
            commandId,
            outcome: {
              case: 'purged',
              value: {
                items: [
                  { boardId: board.boardId, outcome: { case: 'deleted', value: true } },
                  {
                    boardId: otherBoardId,
                    outcome: {
                      case: 'rejected',
                      value: { reason: CatalogRejectionReason.ENTRY_VERSION_CHANGED },
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
    );
  });

  await expect(service.purgeBoards({ commandId, targets })).resolves.toEqual({
    kind: 'purged',
    commandId,
    items: [
      { boardId: board.boardId, deleted: true },
      { boardId: otherBoardId, deleted: false, reason: 'entryVersionChanged' },
    ],
  });
});

test('leaves a lost response for the caller to query using the original command ID', async () => {
  const failure = new Error('Response interrupted');
  const routes: string[] = [];
  const managePath = catalogPath + 'ManageBoard';
  const receiptPath = catalogPath + 'GetCatalogCommandReceipt';
  const service = createCatalogManagementService((path, body) => {
    routes.push(path);
    if (path === managePath) {
      return Promise.reject(failure);
    }

    expect(path).toBe(receiptPath);
    expect(fromBinary(getCatalogCommandReceipt.input, body).commandId).toBe(commandId);

    return Promise.resolve(
      toBinary(
        getCatalogCommandReceipt.output,
        create(getCatalogCommandReceipt.output, { result: { case: 'receipt', value: changed } }),
      ),
    );
  });

  await expect(service.manageBoard({ ...baseCommand, operation: { kind: 'trash' } })).rejects.toBe(
    failure,
  );
  expect(routes).toEqual([managePath]);
  await expect(service.getReceipt(commandId)).resolves.toEqual({
    kind: 'changed',
    commandId,
    board,
  });
  expect(routes).toEqual([managePath, receiptPath]);
});

test('treats a matching not-recorded lookup as unknown', async () => {
  const response = create(getCatalogCommandReceipt.output, {
    result: { case: 'notRecorded', value: { commandId } },
  });
  const service = createCatalogManagementService(() =>
    Promise.resolve(toBinary(getCatalogCommandReceipt.output, response)),
  );

  await expect(service.getReceipt(commandId)).resolves.toBeUndefined();
});
