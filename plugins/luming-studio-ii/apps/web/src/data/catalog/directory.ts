import type {
  BoardCatalogService,
  CatalogBoardSummary,
  CatalogListRequest,
  CatalogSortOrder,
} from './contracts.js';

export interface CatalogDirectorySnapshot {
  readonly kind: 'loading' | 'ready' | 'failed';
  readonly query: string;
  readonly order: CatalogSortOrder;
  readonly boards: readonly CatalogBoardSummary[];
  readonly loadingMore: boolean;
  readonly nextCursor?: string;
  readonly error?: string;
}

export interface CatalogDirectory {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => CatalogDirectorySnapshot;
  readonly open: () => () => void;
  readonly setQuery: (query: string) => void;
  readonly setOrder: (order: CatalogSortOrder) => void;
  readonly loadMore: () => void;
  readonly reload: () => void;
}

const pageSize = 30;
const searchDelayMs = 180;

function loading(query: string, order: CatalogSortOrder): CatalogDirectorySnapshot {
  return { kind: 'loading', query, order, boards: [], loadingMore: false };
}

function mergeBoards(
  prior: readonly CatalogBoardSummary[],
  page: readonly CatalogBoardSummary[],
): readonly CatalogBoardSummary[] {
  const byId = new Map(prior.map((board) => [board.boardId, board]));
  for (const board of page) {
    const known = byId.get(board.boardId);
    if (!known || known.entryVersion < board.entryVersion) {
      byId.set(board.boardId, board);
    }
  }

  return [...byId.values()];
}

export function createCatalogDirectory(service: BoardCatalogService): CatalogDirectory {
  const listeners = new Set<() => void>();
  let snapshot = loading('', 'recent');
  let owner: symbol | undefined;
  let active: AbortController | undefined;
  let scheduled: ReturnType<typeof setTimeout> | undefined;

  function publish(next: CatalogDirectorySnapshot) {
    snapshot = next;
    for (const listener of listeners) {
      listener();
    }
  }

  function cancelRead() {
    const request = active;
    active = undefined;
    clearTimeout(scheduled);
    scheduled = undefined;
    request?.abort();
  }

  function failPage(request: AbortController, append: boolean, cause: unknown) {
    if (request !== active) {
      return;
    }

    active = undefined;
    publish({
      ...snapshot,
      kind: append ? 'ready' : 'failed',
      loadingMore: false,
      error: cause instanceof Error ? cause.message : '无法读取白板列表。',
    });
  }

  async function readPage(input: CatalogListRequest, request: AbortController, append: boolean) {
    const page = await service.listBoards(input, request.signal);
    if (request !== active) {
      return;
    }

    active = undefined;
    publish({
      ...snapshot,
      kind: 'ready',
      loadingMore: false,
      error: undefined,
      boards: append ? mergeBoards(snapshot.boards, page.boards) : page.boards,
      nextCursor: page.nextCursor,
    });
  }

  function startRead(next: CatalogDirectorySnapshot, input: CatalogListRequest, delay: number) {
    cancelRead();
    const request = owner === undefined ? undefined : new AbortController();
    active = request;
    publish(next);
    if (!request || request !== active) {
      return;
    }

    function start() {
      if (!request || request !== active) {
        return;
      }

      scheduled = undefined;
      const append = next.loadingMore;
      readPage(input, request, append).catch((cause: unknown) => failPage(request, append, cause));
    }

    if (delay > 0) {
      scheduled = setTimeout(start, delay);

      return;
    }

    start();
  }

  function replace(query: string, order: CatalogSortOrder, delay = 0) {
    startRead(loading(query, order), { query, order, pageSize }, delay);
  }

  function reload() {
    replace(snapshot.query, snapshot.order);
  }

  return {
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    open() {
      const lifetime = Symbol();
      owner = lifetime;
      reload();

      return () => {
        if (owner === lifetime) {
          owner = undefined;
          cancelRead();
        }
      };
    },
    setQuery(query) {
      if (query !== snapshot.query) {
        replace(query, snapshot.order, query.trim() ? searchDelayMs : 0);
      }
    },
    setOrder(order) {
      if (order !== snapshot.order) {
        replace(snapshot.query, order);
      }
    },
    loadMore() {
      const { kind, loadingMore, nextCursor, query, order } = snapshot;
      if (kind !== 'ready' || loadingMore || nextCursor === undefined) {
        return;
      }

      startRead(
        { ...snapshot, loadingMore: true, error: undefined },
        { query, order, pageSize, cursor: nextCursor },
        0,
      );
    },
    reload,
  };
}
