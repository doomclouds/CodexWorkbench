import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import type { DescMessage, DescMethodUnary, MessageInitShape } from '@bufbuild/protobuf';
import {
  BoardCatalogService as wireService,
  BoardSortOrder,
  CatalogRejectionReason,
  type BoardSummary,
  type CatalogCommandReceipt,
  type GetCatalogCommandReceiptResponse,
  type GetBoardThumbnailResponse,
} from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import type {
  BoardCatalogService,
  CatalogBoardSummary,
  CatalogListRequest,
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
  [CatalogRejectionReason.FORBIDDEN, 'forbidden'],
  [CatalogRejectionReason.ENTRY_VERSION_CHANGED, 'entryVersionChanged'],
  [CatalogRejectionReason.STATE_CHANGED, 'stateChanged'],
  [CatalogRejectionReason.INVALID_COMMAND, 'invalidCommand'],
]);

export function readCatalogRejection(reason: CatalogRejectionReason): RejectionReason {
  return reasons.get(reason) ?? 'unknown';
}

export async function request<Input extends DescMessage, Output extends DescMessage>(
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

export function readBoard({
  boardId,
  title,
  updatedAtMillis,
  pinned,
  entryVersion,
  canManage,
  previewRevision,
}: BoardSummary): CatalogBoardSummary {
  if (!boardId.trim()) {
    throw new Error('Catalog response is missing a board ID.');
  }
  if (entryVersion === undefined) {
    throw new Error('Catalog response is missing a board entry version.');
  }

  return {
    boardId,
    title,
    updatedAtMillis,
    pinned,
    entryVersion,
    canManage,
    ...(previewRevision === undefined ? {} : { previewRevision }),
  };
}

export function listInput(input: CatalogListRequest) {
  return { ...input, order: orders[input.order] };
}

const thumbnailMaxBytes = 128 * 1024;
const thumbnailMime = 'image/svg+xml';
const base64ChunkSize = 8192;

function readThumbnail({ thumbnail }: GetBoardThumbnailResponse, expectedRevision: bigint) {
  if (thumbnail?.revision !== expectedRevision) {
    return;
  }

  const { mimeType, content } = thumbnail;
  if (mimeType !== thumbnailMime || !content.length || content.length > thumbnailMaxBytes) {
    throw new Error('目录缩略图的格式或大小无效。');
  }

  let binary = '';
  for (let offset = 0; offset < content.length; offset += base64ChunkSize) {
    const chunk = content.subarray(offset, offset + base64ChunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return 'data:' + thumbnailMime + ';base64,' + btoa(binary);
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

export function requireCommandId(commandId: string): void {
  if (!commandId.trim()) {
    throw new Error('Catalog command ID is required.');
  }
}

function matchCommandId(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error('Catalog response has an unexpected command ID.');
  }
}

export function readCommandOutcome(receipt: CatalogCommandReceipt | undefined, commandId: string) {
  if (receipt === undefined) {
    throw new Error('Catalog response is missing a command receipt.');
  }

  matchCommandId(receipt.commandId, commandId);

  return receipt.outcome;
}

function readReceipt(
  receipt: CatalogCommandReceipt | undefined,
  commandId: string,
): CatalogReceipt {
  const { case: kind, value } = readCommandOutcome(receipt, commandId);

  switch (kind) {
    case 'created':
      return { kind, commandId, board: readBoard(value) };
    case 'rejected':
      return { kind, commandId, reason: readCatalogRejection(value.reason) };
    case undefined:
      throw new Error('Catalog receipt is missing a command outcome.');
    case 'changed':
    case 'purged':
      throw new Error('Catalog receipt has an unexpected creation outcome.');
  }
}

export function readReceiptLookup<Receipt>(
  { result }: GetCatalogCommandReceiptResponse,
  commandId: string,
  read: (receipt: CatalogCommandReceipt, commandId: string) => Receipt,
): Receipt | undefined {
  switch (result.case) {
    case 'receipt':
      return read(result.value, commandId);
    case 'notRecorded':
      matchCommandId(result.value.commandId, commandId);

      return undefined;
    case undefined:
      throw new Error('Catalog response is missing a receipt lookup result.');
  }
}

export function createBoardCatalogService(post: CatalogPost) {
  const { listBoards, createBoard, duplicateBoard, getCatalogCommandReceipt, getBoardThumbnail } =
    wireService.method;

  return {
    async listBoards(input, signal?: AbortSignal) {
      const { boards, nextCursor } = await request(post, listBoards, listInput(input), signal);

      return { boards: readBoards(boards), nextCursor };
    },
    async getBoardThumbnail(input, signal?: AbortSignal) {
      signal?.throwIfAborted();
      const response = await request(post, getBoardThumbnail, input, signal);
      signal?.throwIfAborted();
      return readThumbnail(response, input.revision);
    },
    async createBoard({ commandId, title }, signal?: AbortSignal) {
      requireCommandId(commandId);

      const response = await request(post, createBoard, { commandId, title }, signal);

      return readReceipt(response.receipt, commandId);
    },
    async duplicateBoard({ sourceBoardId, commandId }, signal?: AbortSignal) {
      requireCommandId(commandId);
      if (!sourceBoardId.trim()) {
        throw new Error('Catalog source board ID is required.');
      }

      const response = await request(post, duplicateBoard, { sourceBoardId, commandId }, signal);
      const receipt = readReceipt(response.receipt, commandId);
      if (receipt.kind === 'created' && receipt.board.boardId === sourceBoardId) {
        throw new Error('Catalog duplicate receipt returned the source board ID.');
      }

      return receipt;
    },
    async getReceipt(commandId, signal?: AbortSignal) {
      requireCommandId(commandId);

      const response = await request(post, getCatalogCommandReceipt, { commandId }, signal);

      return readReceiptLookup(response, commandId, readReceipt);
    },
  } satisfies BoardCatalogService;
}
