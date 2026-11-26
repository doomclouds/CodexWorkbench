import { describe, expect, it, vi } from 'vitest';
import {
  CatalogQueryError,
  createCatalogApplication,
} from '../../src/modules/catalog/application/index.js';
import type { CatalogListRequest } from '../../src/modules/catalog/application/index.js';
import type {
  CatalogBoardSummary,
  CatalogCreatedReceipt,
  CatalogRepository,
} from '../../src/modules/catalog/ports/index.js';

const owner = { id: 'owner' };
const anotherActor = { id: 'another-actor' };
const recentRequest: CatalogListRequest = { query: ' architecture ', order: 'recent', pageSize: 1 };
const nowMillis = 1_800_000_000_000;

function fixture() {
  const receipts = new Map<string, CatalogCreatedReceipt>();
  const listBoards = vi.fn<CatalogRepository['listBoards']>(() => []);
  const beforeCommit = vi.fn();
  const now = vi.fn(() => nowMillis);
  let lastBoardId = 0;
  const newBoardId = vi.fn(() => `board-${++lastBoardId}`);

  function getReceipt(actorId: string, commandId: string) {
    return receipts.get(JSON.stringify([actorId, commandId]));
  }

  const repository: CatalogRepository = {
    listBoards,
    getReceipt,
    write(work) {
      let persist: (() => void) | undefined;
      const result = work({
        getReceipt,
        saveBoard(actorId, receipt) {
          persist = () => {
            receipts.set(JSON.stringify([actorId, receipt.commandId]), receipt);
          };
        },
      });
      beforeCommit();
      persist?.();

      return result;
    },
  };

  return {
    app: createCatalogApplication(repository, { newBoardId, now }),
    listBoards,
    beforeCommit,
    newBoardId,
    now,
  };
}

function summary(boardId: string, updatedAtMillis?: bigint): CatalogBoardSummary {
  return {
    boardId,
    title: `Architecture ${boardId}`,
    updatedAtMillis,
    pinned: false,
    entryVersion: 0n,
  };
}

describe('Catalog application', () => {
  it('binds a bounded over-fetch to the actor and recovers its precise cursor position', () => {
    const { app, listBoards } = fixture();
    const latest = summary('latest', 9_223_372_036_854_775_807n);
    const legacy = summary('legacy');
    listBoards.mockReturnValueOnce([latest, legacy]).mockReturnValueOnce([legacy]);
    const firstPage = app.listBoards(owner, recentRequest);
    expect(firstPage.boards).toEqual([latest]);
    expect(firstPage.nextCursor).toBeTypeOf('string');
    expect(listBoards).toHaveBeenNthCalledWith(1, {
      actorId: owner.id,
      query: 'architecture',
      order: 'recent',
      limit: 2,
    });

    const secondPage = app.listBoards(owner, { ...recentRequest, cursor: firstPage.nextCursor });
    expect(secondPage).toEqual({ boards: [legacy] });
    expect(listBoards).toHaveBeenNthCalledWith(2, {
      actorId: owner.id,
      query: 'architecture',
      order: 'recent',
      limit: 2,
      after: {
        boardId: latest.boardId,
        title: latest.title,
        pinned: latest.pinned,
        updatedAtMillis: latest.updatedAtMillis,
      },
    });
  });

  it('rejects a cursor for another actor, query, or sort before consulting storage', () => {
    const { app, listBoards } = fixture();
    listBoards.mockReturnValue([summary('latest'), summary('legacy')]);
    const { nextCursor: cursor } = app.listBoards(owner, recentRequest);
    const existing = { ...recentRequest, cursor };

    expect(() => app.listBoards(anotherActor, existing)).toThrow(CatalogQueryError);
    expect(() => app.listBoards(owner, { ...existing, query: 'diagrams' })).toThrow(
      CatalogQueryError,
    );
    expect(() => app.listBoards(owner, { ...existing, order: 'title' })).toThrow(CatalogQueryError);
    expect(listBoards).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid pagination and malformed cursors before consulting storage', () => {
    const { app, listBoards } = fixture();
    const requests: CatalogListRequest[] = [
      { ...recentRequest, pageSize: 0 },
      { ...recentRequest, pageSize: 101 },
      { ...recentRequest, query: 'q'.repeat(201) },
      { ...recentRequest, cursor: '{' },
    ];

    for (const request of requests) {
      expect(() => app.listBoards(owner, request)).toThrow(CatalogQueryError);
    }
    expect(listBoards).not.toHaveBeenCalled();
  });

  it('returns the same creation receipt on a normalized retry and scopes it to the creator', () => {
    const { app, newBoardId, now } = fixture();
    const command = { title: ' Architecture ', commandId: 'create' };
    const created = app.createBoard(owner, command);
    expect(created).toEqual({
      kind: 'created',
      commandId: command.commandId,
      board: {
        boardId: 'board-1',
        title: 'Architecture',
        pinned: false,
        entryVersion: 1n,
        updatedAtMillis: BigInt(nowMillis),
      },
    });
    expect(app.createBoard(owner, { ...command, title: 'Architecture' })).toEqual(created);
    expect(app.getReceipt(owner, command.commandId)).toEqual(created);
    expect(app.getReceipt(anotherActor, command.commandId)).toBeUndefined();
    expect(app.createBoard(owner, { ...command, title: 'Different title' })).toEqual({
      kind: 'rejected',
      commandId: command.commandId,
      reason: 'commandIdReuse',
    });
    expect(newBoardId).toHaveBeenCalledTimes(1);
    expect(now).toHaveBeenCalledTimes(1);
  });

  it('normalizes a blank title to the existing default and rejects invalid titles', () => {
    const { app, newBoardId } = fixture();
    const commandId = 'create-default';
    const created = app.createBoard(owner, { commandId, title: '  ' });
    expect(created).toMatchObject({ kind: 'created', board: { title: '未命名白板' } });
    expect(app.createBoard(owner, { commandId, title: '未命名白板' })).toEqual(created);

    const invalid = { title: 'a'.repeat(201), commandId: 'invalid' };
    expect(app.createBoard(owner, invalid)).toEqual({
      kind: 'rejected',
      commandId: invalid.commandId,
      reason: 'invalidTitle',
    });
    expect(app.getReceipt(owner, invalid.commandId)).toBeUndefined();
    expect(newBoardId).toHaveBeenCalledTimes(1);
  });

  it('propagates a failed write and permits the same command to be retried', () => {
    const { app, beforeCommit } = fixture();
    const failure = new Error('Cannot commit catalog entry');
    beforeCommit.mockImplementationOnce(() => {
      throw failure;
    });
    const command = { title: 'Architecture', commandId: 'retry' };
    expect(() => app.createBoard(owner, command)).toThrow(failure);
    expect(app.getReceipt(owner, command.commandId)).toBeUndefined();

    const retried = app.createBoard(owner, command);
    expect(retried).toMatchObject({ kind: 'created', commandId: command.commandId });
    expect(app.getReceipt(owner, command.commandId)).toEqual(retried);
  });
});
