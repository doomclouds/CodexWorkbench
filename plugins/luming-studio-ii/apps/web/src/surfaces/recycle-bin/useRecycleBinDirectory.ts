import { useEffect, useState } from 'react';
import type { CatalogManagementService, TrashedBoardSummary } from '../../data/catalog/index.js';

interface DirectorySnapshot {
  readonly boards: readonly TrashedBoardSummary[];
  readonly nextCursor?: string;
  readonly status: 'loading' | 'ready' | 'failed';
  readonly error?: string;
}

interface DirectoryRequest {
  readonly query: string;
  readonly cursor?: string;
  readonly delay?: number;
}

const pageSize = 60;
const searchDelay = 180;

function mergeBoards(
  previous: readonly TrashedBoardSummary[],
  incoming: readonly TrashedBoardSummary[],
) {
  const byId = new Map(previous.map((item) => [item.board.boardId, item]));
  for (const item of incoming) {
    byId.set(item.board.boardId, item);
  }

  return [...byId.values()];
}

export function useRecycleBinDirectory(management: CatalogManagementService, initialQuery = '') {
  const [request, setRequest] = useState<DirectoryRequest>(() => ({ query: initialQuery }));
  const [snapshot, setSnapshot] = useState<DirectorySnapshot>({ boards: [], status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const { query, cursor, delay } = request;

    function read() {
      Promise.resolve()
        .then(() => {
          signal.throwIfAborted();
          return management.listTrashedBoards(
            { query: query.trim(), order: 'recent', pageSize, cursor },
            signal,
          );
        })
        .then((page) => {
          if (signal.aborted) {
            return;
          }

          setSnapshot((previous) => ({
            status: 'ready',
            boards: cursor ? mergeBoards(previous.boards, page.boards) : page.boards,
            nextCursor: page.nextCursor,
          }));
        })
        .catch((cause: unknown) => {
          if (signal.aborted) {
            return;
          }

          setSnapshot((previous) => ({
            ...previous,
            status: 'failed',
            error: cause instanceof Error ? cause.message : '无法读取回收站。',
          }));
        });
    }

    const timer = delay ? setTimeout(read, delay) : undefined;
    if (!delay) {
      read();
    }

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [management, request]);

  function changeQuery(query: string) {
    if (query === request.query) {
      return;
    }

    setSnapshot({ boards: [], status: 'loading' });
    setRequest({ query, delay: query.trim() ? searchDelay : undefined });
  }

  function refresh(removedIds: readonly string[] = []) {
    const removed = new Set(removedIds);
    setSnapshot((previous) => ({
      boards: previous.boards.filter(({ board }) => !removed.has(board.boardId)),
      status: 'loading',
    }));
    setRequest({ query: request.query });
  }

  function loadMore() {
    if (!snapshot.nextCursor || snapshot.status === 'loading') {
      return;
    }

    setSnapshot({ ...snapshot, status: 'loading', error: undefined });
    setRequest({ query: request.query, cursor: snapshot.nextCursor });
  }

  function retry() {
    setSnapshot({ ...snapshot, status: 'loading', error: undefined });
    setRequest({ ...request, delay: undefined });
  }

  return { ...snapshot, query: request.query, changeQuery, refresh, loadMore, retry };
}
