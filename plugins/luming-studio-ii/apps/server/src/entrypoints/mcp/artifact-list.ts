import {
  BoardCatalogService,
  BoardSortOrder,
  type BoardSummary,
} from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import { z } from 'zod';
import { BridgeError, invalidArgument } from './errors.js';
import { callModelRpc, type ModelToolOptions } from './model-tool.js';

const maxResponseBytes = 16 * 1024;
const defaultPageSize = 10;
const pageSize = z.number().int().min(1).max(20).optional();

export const artifactListSchema = z.strictObject({
  query: z.string().max(512).optional(),
  trashed: z.boolean().optional(),
  pinned: z.boolean().optional(),
  sort: z.enum(['recent', 'title']).optional(),
  cursor: z.string().min(1).max(4096).optional(),
  offset: z.number().int().min(0).max(0xff_ff_ff_ff).optional(),
  limit: pageSize,
  pageSize,
});

type ArtifactListInput = z.infer<typeof artifactListSchema>;

function describeArtifact(board: BoardSummary | undefined, trashedAtMillis?: bigint) {
  if (!board) {
    throw new BridgeError('UNAVAILABLE', '本机目录未返回白板摘要。');
  }

  const { boardId, title, pinned, canManage, entryVersion, previewRevision, updatedAtMillis } =
    board;

  return {
    id: boardId,
    type: 'whiteboard',
    title,
    pinned,
    canManage,
    entryVersion: entryVersion?.toString(),
    revision: previewRevision?.toString(),
    updatedAt:
      updatedAtMillis === undefined ? undefined : new Date(Number(updatedAtMillis)).toISOString(),
    trashedAt:
      trashedAtMillis === undefined ? undefined : new Date(Number(trashedAtMillis)).toISOString(),
  };
}

async function fetchArtifacts(
  options: ModelToolOptions,
  input: ArtifactListInput,
  signal: AbortSignal,
) {
  const request = {
    query: input.query ?? '',
    pinnedOnly: input.pinned ?? false,
    order: input.sort === 'title' ? BoardSortOrder.TITLE : BoardSortOrder.RECENT,
    pageSize: input.pageSize ?? input.limit ?? defaultPageSize,
    cursor: input.cursor,
    offset: input.offset,
  };
  const { listBoards, listTrashedBoards } = BoardCatalogService.method;
  if (input.trashed) {
    const { boards, nextCursor } = await callModelRpc(
      options,
      listTrashedBoards,
      request,
      signal,
      maxResponseBytes,
    );

    return {
      artifacts: boards.map(({ board, trashedAtMillis }) =>
        describeArtifact(board, trashedAtMillis),
      ),
      nextCursor,
    };
  }

  const { boards, nextCursor } = await callModelRpc(
    options,
    listBoards,
    request,
    signal,
    maxResponseBytes,
  );

  return { artifacts: boards.map((board) => describeArtifact(board)), nextCursor };
}

export async function listArtifacts(
  options: ModelToolOptions,
  input: ArtifactListInput,
  signal: AbortSignal,
) {
  const { cursor, offset, pageSize, limit } = input;
  if (cursor !== undefined && offset !== undefined) {
    throw invalidArgument('游标 cursor 和偏移 offset 只能使用其中一个。');
  }
  if (pageSize !== undefined && limit !== undefined && pageSize !== limit) {
    throw invalidArgument('pageSize 与 limit 同时提供时必须相等。');
  }

  const result = await fetchArtifacts(options, input, signal);
  if (cursor !== undefined) {
    return result;
  }

  const start = offset ?? 0;

  return {
    ...result,
    offset: start,
    nextOffset: result.nextCursor === undefined ? undefined : start + result.artifacts.length,
  };
}
