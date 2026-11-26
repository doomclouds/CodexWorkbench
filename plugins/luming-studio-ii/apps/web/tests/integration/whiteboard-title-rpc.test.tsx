import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  BoardCatalogService,
  BoardSortOrder,
} from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import { expect, test } from 'vitest';
import {
  createBoardCatalogService,
  createCatalogBoardRename,
  createCatalogManagementService,
  type CatalogManagementReceipt,
  type CatalogPost,
} from '../../src/data/catalog/index.js';

const { listBoards, manageBoard, getCatalogCommandReceipt } = BoardCatalogService.method;
const boardId = 'renamed-board';
const currentTitle = '同名白板';
const newTitle = '确认后的名称';
const commandId = 'rename-from-whiteboard';
const cursor = 'catalog-page-2';
const board = { boardId, title: currentTitle, entryVersion: 47n, pinned: false, canManage: true };
const renamed = { ...board, title: newTitle, entryVersion: 48n };
const confirmed = { commandId, outcome: { case: 'changed', value: renamed } } as const;
const identity = () => commandId;

test('looks up the catalog entry across pages and recovers the exact command after a lost reply', async () => {
  const calls: string[] = [];
  const post: CatalogPost = (path, bytes) => {
    const method = path.split('/').at(-1);
    if (!method) {
      throw new Error('Missing catalog method');
    }

    calls.push(method);
    if (method === listBoards.name) {
      const input = fromBinary(listBoards.input, bytes);
      expect(input).toMatchObject({ query: currentTitle, order: BoardSortOrder.TITLE });
      const result =
        input.cursor === cursor
          ? { boards: [board] }
          : { boards: [{ ...board, boardId: 'other-board' }], nextCursor: cursor };

      return Promise.resolve(toBinary(listBoards.output, create(listBoards.output, result)));
    }
    if (method === manageBoard.name) {
      expect(fromBinary(manageBoard.input, bytes)).toMatchObject({
        boardId,
        commandId,
        expectedEntryVersion: 47n,
        operation: { case: 'title', value: newTitle },
      });

      return Promise.reject(new Error('Name write reply was lost'));
    }

    expect(method).toBe(getCatalogCommandReceipt.name);
    expect(fromBinary(getCatalogCommandReceipt.input, bytes).commandId).toBe(commandId);
    const result = { case: 'receipt', value: confirmed } as const;

    return Promise.resolve(
      toBinary(
        getCatalogCommandReceipt.output,
        create(getCatalogCommandReceipt.output, { result }),
      ),
    );
  };
  const rename = createCatalogBoardRename(
    createBoardCatalogService(post),
    createCatalogManagementService(post),
    identity,
  );

  await expect(rename(boardId, currentTitle, '  ' + newTitle)).resolves.toBeUndefined();
  expect(calls).toEqual([
    listBoards.name,
    listBoards.name,
    manageBoard.name,
    getCatalogCommandReceipt.name,
  ]);
});

test('does not overwrite a name that changed after the editor opened', async () => {
  const events: string[] = [];
  const rename = createCatalogBoardRename(
    { listBoards: () => Promise.resolve({ boards: [{ ...board, title: '新的当前名称' }] }) },
    {
      manageBoard(request) {
        events.push(request.commandId);
        throw new Error('Must not start a rename with a stale displayed title');
      },
      getReceipt: () => Promise.resolve(undefined),
    },
    identity,
  );

  await expect(rename(boardId, currentTitle, newTitle)).rejects.toThrow('作品目录已变化');
  expect(events).toEqual([]);
});

test('uses the original command identity on a later retry when the first lookup failed', async () => {
  const events: string[] = [];
  const receipt: CatalogManagementReceipt = { kind: 'changed', commandId, board: renamed };
  const rename = createCatalogBoardRename(
    { listBoards: () => Promise.resolve({ boards: [board] }) },
    {
      manageBoard(request) {
        events.push('submit-' + request.commandId);

        return Promise.reject(new Error('Name write reply was lost'));
      },
      getReceipt(id) {
        expect(id).toBe(commandId);
        events.push('receipt-' + id);

        return events.length === 2
          ? Promise.reject(new Error('Receipt reply was lost'))
          : Promise.resolve(receipt);
      },
    },
    identity,
  );

  await expect(rename(boardId, currentTitle, newTitle)).rejects.toThrow('保存结果尚未确认');
  await expect(rename(boardId, currentTitle, newTitle)).resolves.toBeUndefined();
  expect(events).toEqual(['submit-' + commandId, 'receipt-' + commandId, 'receipt-' + commandId]);
});

test('replays a command with the original entry version after the server reports it absent', async () => {
  const receipt: CatalogManagementReceipt = { kind: 'changed', board: renamed, commandId };
  const attempts: unknown[] = [];
  const received: string[] = [];
  const rename = createCatalogBoardRename(
    { listBoards: () => Promise.resolve({ boards: [board] }) },
    {
      manageBoard(request) {
        attempts.push(request);

        return attempts.length === 1
          ? Promise.reject(new Error('Name write request was interrupted'))
          : Promise.resolve(receipt);
      },
      getReceipt(id) {
        received.push(id);

        return Promise.resolve(undefined);
      },
    },
    identity,
  );

  await expect(rename(boardId, currentTitle, newTitle)).resolves.toBeUndefined();
  expect(received).toEqual([commandId]);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toBe(attempts[0]);
  expect(attempts[0]).toMatchObject({ expectedEntryVersion: board.entryVersion, commandId });
});
