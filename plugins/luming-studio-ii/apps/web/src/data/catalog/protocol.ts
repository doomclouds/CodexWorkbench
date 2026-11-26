import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import type { DescMessage, DescMethodUnary, MessageInitShape } from '@bufbuild/protobuf';
import {
  BoardCatalogService as wireService,
  BoardSortOrder,
  CatalogRejectionReason,
  type BoardSummary,
  type CatalogCommandReceipt,
  type GetCatalogCommandReceiptResponse,
} from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import type {
  BoardCatalogService,
  CatalogBoardSummary,
  CatalogPost,
  CatalogReceipt,
  CatalogRejectionReason as RejectionReason,
  CatalogSortOrder,
} from './contracts.js';

const orders: Readonly<Record<CatalogSortOrder, BoardSortOrder>> = {
  recent: BoardSortOrder.RECENT,
  title: BoardSortOrder.TITLE,
};
const reasons = new Map<CatalogRejectionReason, RejectionReason>([
  [CatalogRejectionReason.INVALID_TITLE, 'invalidTitle'],
  [CatalogRejectionReason.COMMAND_ID_REUSE, 'commandIdReuse'],
]);

async function request<Input extends DescMessage, Output extends DescMessage>(
  post: CatalogPost,
  method: DescMethodUnary<Input, Output>,
  input: MessageInitShape<Input>,
  signal?: AbortSignal,
) {
  const path = '/' + method.parent.typeName + '/' + method.name;
  const bytes = toBinary(method.input, create(method.input, input));
  const response = await post(path, bytes, signal);

  return fromBinary(method.output, response, { readUnknownFields: false });
}

function readBoard({
  boardId,
  title,
  updatedAtMillis,
  pinned,
  entryVersion,
}: BoardSummary): CatalogBoardSummary {
  if (!boardId.trim()) {
    throw new Error('Catalog response is missing a board ID.');
  }
  if (entryVersion === undefined) {
    throw new Error('Catalog response is missing a board entry version.');
  }

  return { boardId, title, updatedAtMillis, pinned, entryVersion };
}

function readBoards(boards: readonly BoardSummary[]): readonly CatalogBoardSummary[] {
  const seen = new Set<string>();

  return boards.map((board) => {
    if (seen.has(board.boardId)) {
      throw new Error('Catalog response contains a duplicate board ID.');
    }

    seen.add(board.boardId);

    return readBoard(board);
  });
}

function requireCommandId(commandId: string): void {
  if (!commandId.trim()) {
    throw new Error('Catalog command ID is required.');
  }
}

function matchCommandId(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error('Catalog response has an unexpected command ID.');
  }
}

function readReceipt(
  receipt: CatalogCommandReceipt | undefined,
  commandId: string,
): CatalogReceipt {
  if (receipt === undefined) {
    throw new Error('Catalog response is missing a command receipt.');
  }

  matchCommandId(receipt.commandId, commandId);

  const { case: kind, value } = receipt.outcome;

  switch (kind) {
    case 'created':
      return { kind, commandId, board: readBoard(value) };
    case 'rejected':
      return { kind, commandId, reason: reasons.get(value.reason) ?? 'unknown' };
    case undefined:
      throw new Error('Catalog receipt is missing a command outcome.');
  }
}

function readReceiptLookup(
  { result }: GetCatalogCommandReceiptResponse,
  commandId: string,
): CatalogReceipt | undefined {
  switch (result.case) {
    case 'receipt':
      return readReceipt(result.value, commandId);
    case 'notRecorded':
      matchCommandId(result.value.commandId, commandId);

      return undefined;
    case undefined:
      throw new Error('Catalog response is missing a receipt lookup result.');
  }
}

export function createBoardCatalogService(post: CatalogPost): BoardCatalogService {
  const { listBoards, createBoard, getCatalogCommandReceipt } = wireService.method;

  return {
    async listBoards({ query, order, pageSize, cursor }, signal) {
      const { boards, nextCursor } = await request(
        post,
        listBoards,
        { query, order: orders[order], pageSize, cursor },
        signal,
      );

      return { boards: readBoards(boards), nextCursor };
    },
    async createBoard({ commandId, title }, signal) {
      requireCommandId(commandId);

      const response = await request(post, createBoard, { commandId, title }, signal);

      return readReceipt(response.receipt, commandId);
    },
    async getReceipt(commandId, signal) {
      requireCommandId(commandId);

      const response = await request(post, getCatalogCommandReceipt, { commandId }, signal);

      return readReceiptLookup(response, commandId);
    },
  };
}
