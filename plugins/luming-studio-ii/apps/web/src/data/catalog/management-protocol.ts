import type { MessageInitShape } from '@bufbuild/protobuf';
import {
  BoardCatalogService,
  BoardLifecycleAction,
  CatalogRejectionReason,
  type CatalogCommandReceipt,
  type CatalogPurgeItemResult as WirePurgeItem,
  type ManageBoardRequestSchema,
  type TrashedBoardSummary as WireTrashedBoard,
} from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import type {
  CatalogManagementReceipt,
  CatalogManagementRejectionReason,
  CatalogManagementService,
  CatalogManageRequest,
  CatalogPost,
  CatalogPurgeItemResult,
  CatalogPurgeRequest,
  TrashedBoardSummary,
} from './contracts.js';
import {
  listInput,
  readBoard,
  readCommandOutcome,
  readReceiptLookup,
  request,
  requireCommandId,
} from './protocol.js';

const managementReasons = new Map<CatalogRejectionReason, CatalogManagementRejectionReason>([
  [CatalogRejectionReason.INVALID_TITLE, 'invalidTitle'],
  [CatalogRejectionReason.COMMAND_ID_REUSE, 'commandIdReuse'],
  [CatalogRejectionReason.FORBIDDEN, 'forbidden'],
  [CatalogRejectionReason.ENTRY_VERSION_CHANGED, 'entryVersionChanged'],
  [CatalogRejectionReason.STATE_CHANGED, 'stateChanged'],
  [CatalogRejectionReason.INVALID_COMMAND, 'invalidCommand'],
]);

type WireOperation = MessageInitShape<typeof ManageBoardRequestSchema>['operation'];

function manageOperation(operation: CatalogManageRequest['operation']): WireOperation {
  switch (operation.kind) {
    case 'rename':
      return { case: 'title', value: operation.title };
    case 'pin':
      return { case: 'pinned', value: operation.pinned };
    case 'trash':
      return { case: 'lifecycle', value: BoardLifecycleAction.TRASH };
    case 'restore':
      return { case: 'lifecycle', value: BoardLifecycleAction.RESTORE };
  }
}

function readTrashedBoards(entries: readonly WireTrashedBoard[]): readonly TrashedBoardSummary[] {
  const seen = new Set<string>();

  return entries.map(({ board, trashedAtMillis }) => {
    if (!board) {
      throw new Error('Trashed catalog response is missing board details.');
    }
    if (seen.has(board.boardId)) {
      throw new Error('Trashed catalog response contains a duplicate board ID.');
    }

    seen.add(board.boardId);

    return { board: readBoard(board), trashedAtMillis };
  });
}

function readPurgeItem({ boardId, outcome }: WirePurgeItem): CatalogPurgeItemResult {
  if (!boardId.trim()) {
    throw new Error('Catalog purge result is missing a board ID.');
  }
  if (outcome.case === 'deleted' && outcome.value) {
    return { boardId, deleted: true };
  }
  if (outcome.case === 'rejected') {
    return {
      boardId,
      deleted: false,
      reason: managementReasons.get(outcome.value.reason) ?? 'unknown',
    };
  }

  throw new Error('Catalog purge result is missing a board outcome.');
}

function readPurgeItems(entries: readonly WirePurgeItem[]): readonly CatalogPurgeItemResult[] {
  const ids = new Set(entries.map(({ boardId }) => boardId));
  if (ids.size !== entries.length) {
    throw new Error('Catalog purge receipt contains a duplicate board ID.');
  }

  return entries.map(readPurgeItem);
}

function readManagementReceipt(
  receipt: CatalogCommandReceipt | undefined,
  commandId: string,
): CatalogManagementReceipt {
  const { case: kind, value } = readCommandOutcome(receipt, commandId);

  switch (kind) {
    case 'changed':
      return { kind, commandId, board: readBoard(value) };
    case 'purged':
      return { kind, commandId, items: readPurgeItems(value.items) };
    case 'rejected':
      return { kind, commandId, reason: managementReasons.get(value.reason) ?? 'unknown' };
    case 'created':
    case undefined:
      throw new Error('Catalog receipt is missing a management outcome.');
  }
}

function checkPurgeTargets(items: readonly CatalogPurgeItemResult[], input: CatalogPurgeRequest) {
  const targetIds = new Set(input.targets.map(({ boardId }) => boardId));
  if (items.length !== targetIds.size || items.some(({ boardId }) => !targetIds.has(boardId))) {
    throw new Error('Catalog purge receipt has unexpected board IDs.');
  }
}

export function createCatalogManagementService(post: CatalogPost): CatalogManagementService {
  const { listTrashedBoards, manageBoard, purgeBoards, getCatalogCommandReceipt } =
    BoardCatalogService.method;

  return {
    async listTrashedBoards(input, signal) {
      const { boards, nextCursor } = await request(
        post,
        listTrashedBoards,
        listInput(input),
        signal,
      );

      return { boards: readTrashedBoards(boards), nextCursor };
    },
    async manageBoard({ commandId, boardId, expectedEntryVersion, operation }, signal) {
      requireCommandId(commandId);
      const { receipt } = await request(
        post,
        manageBoard,
        { commandId, boardId, expectedEntryVersion, operation: manageOperation(operation) },
        signal,
      );
      const result = readManagementReceipt(receipt, commandId);
      if (
        result.kind === 'purged' ||
        (result.kind === 'changed' && result.board.boardId !== boardId)
      ) {
        throw new Error('Catalog receipt does not match the board management request.');
      }

      return result;
    },
    async purgeBoards(input, signal) {
      const { commandId, targets } = input;
      requireCommandId(commandId);
      const { receipt } = await request(
        post,
        purgeBoards,
        { commandId, targets: [...targets] },
        signal,
      );
      const result = readManagementReceipt(receipt, commandId);
      if (result.kind === 'changed') {
        throw new Error('Catalog receipt does not match the purge request.');
      }

      if (result.kind === 'purged') {
        checkPurgeTargets(result.items, input);
      }

      return result;
    },
    async getReceipt(commandId, signal) {
      requireCommandId(commandId);
      const response = await request(post, getCatalogCommandReceipt, { commandId }, signal);

      return readReceiptLookup(response, commandId, readManagementReceipt);
    },
  };
}
