import type {
  BoardCatalogService,
  CatalogBoardSummary,
  CatalogListRequest,
  CatalogPage,
  CatalogSortOrder,
} from './contracts.js';

export interface CatalogDirectorySnapshot {
  readonly kind: 'loading' | 'ready' | 'failed';
  readonly query: string;
  readonly order: CatalogSortOrder;
  readonly pinnedOnly: boolean;
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
  readonly setPinnedOnly: (pinnedOnly: boolean, clearQuery?: boolean) => void;
  readonly loadMore: () => void;
  readonly reload: () => void;
}

const pageSize = 60;
const searchDelayMs = 180;

type ReadMode = 'replace' | 'append' | 'refresh';

function loading(
  query: string,
  order: CatalogSortOrder,
  pinnedOnly: boolean,
): CatalogDirectorySnapshot {
  return { kind: 'loading', query, order, pinnedOnly, boards: [], loadingMore: false };
}

function mergeBoards(
  prior: readonly CatalogBoardSummary[],
  page: readonly CatalogBoardSummary[],
): readonly CatalogBoardSummary[] {
  const byId = new Map(prior.map((board) => [board.boardId, board]));
  for (const board of page) {
    const known = byId.get(board.boardId);
    if (!known || known.entryVersion <= board.entryVersion) {
      byId.set(board.boardId, board);
    }
  }

  return [...byId.values()];
}

function equalBoard(left: CatalogBoardSummary, right: CatalogBoardSummary) {
  return (
    left.title === right.title &&
    left.pinned === right.pinned &&
    left.entryVersion === right.entryVersion &&
    left.updatedAtMillis === right.updatedAtMillis &&
    left.canManage === right.canManage &&
    left.previewRevision === right.previewRevision
  );
}

function reuseBoards(prior: readonly CatalogBoardSummary[], page: readonly CatalogBoardSummary[]) {
  const previous = new Map(prior.map((board) => [board.boardId, board]));
  const updated = page.map((board) => {
    const known = previous.get(board.boardId);
    return known && equalBoard(known, board) ? known : board;
  });

  return updated.length === prior.length && updated.every((board, index) => board === prior[index])
    ? prior
    : updated;
}

async function readVisiblePages(
  service: BoardCatalogService,
  input: CatalogListRequest,
  count: number,
  signal: AbortSignal,
): Promise<CatalogPage> {
  const first = await service.listBoards(input, signal);
  let { boards, nextCursor } = first;
  const cursors = new Set<string>();
  while (boards.length < count && nextCursor) {
    signal.throwIfAborted();
    if (cursors.has(nextCursor)) {
      throw new Error('目录分页游标重复。');
    }

    cursors.add(nextCursor);
    const page = await service.listBoards(
      { ...input, pageSize: Math.min(pageSize, count - boards.length), cursor: nextCursor },
      signal,
    );
    boards = mergeBoards(boards, page.boards);
    nextCursor = page.nextCursor;
  }

  return { ...first, boards, nextCursor };
}

export function createCatalogDirectory(
  service: BoardCatalogService,
  initialPinnedOnly = false,
): CatalogDirectory {
  const listeners = new Set<() => void>();
  let snapshot = loading('', 'recent', initialPinnedOnly);
  let owner: AbortController | undefined;
  let active: AbortController | undefined;
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  let catalogCursor: string | undefined;
  let refreshRequested = false;

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

  function currentInput(): CatalogListRequest {
    const { query, order, pinnedOnly } = snapshot;
    return { query, order, pageSize, ...(pinnedOnly ? { pinnedOnly: true } : {}) };
  }

  function refreshIfReady() {
    const ready = owner && snapshot.kind === 'ready';
    if (!refreshRequested || active || !ready) {
      return;
    }

    refreshRequested = false;
    startRead(snapshot, currentInput(), 'refresh', 0);
  }

  function observedChange(cursor: string) {
    refreshRequested ||= catalogCursor !== cursor;
    catalogCursor = cursor;
    refreshIfReady();
  }

  function recordCatalogPage(cursor: string | undefined) {
    if (!cursor || !owner || !service.watchChanges) {
      return;
    }

    if (catalogCursor === undefined) {
      catalogCursor = cursor;
      service.watchChanges(cursor, observedChange, owner.signal);
    }
    if (cursor === catalogCursor) {
      refreshRequested = false;
    }
  }

  function failPage(request: AbortController, mode: ReadMode, cause: unknown) {
    if (request !== active) {
      return;
    }

    active = undefined;
    if (mode === 'refresh') {
      refreshRequested = true;
      return;
    }

    publish({
      ...snapshot,
      kind: mode === 'append' ? 'ready' : 'failed',
      loadingMore: false,
      error: cause instanceof Error ? cause.message : '无法读取白板列表。',
    });
  }

  async function readPage(input: CatalogListRequest, request: AbortController, mode: ReadMode) {
    const page =
      mode === 'refresh'
        ? await readVisiblePages(service, input, snapshot.boards.length, request.signal)
        : await service.listBoards(input, request.signal);

    if (request !== active) {
      return;
    }

    active = undefined;
    const boards =
      mode === 'append'
        ? mergeBoards(snapshot.boards, page.boards)
        : reuseBoards(snapshot.boards, page.boards);

    if (mode !== 'append') {
      recordCatalogPage(page.catalogCursor);
    }
    const unchanged =
      mode === 'refresh' && boards === snapshot.boards && page.nextCursor === snapshot.nextCursor;

    if (unchanged && !snapshot.error) {
      refreshIfReady();
      return;
    }

    publish({
      ...snapshot,
      kind: 'ready',
      loadingMore: false,
      error: undefined,
      boards,
      nextCursor: page.nextCursor,
    });
    refreshIfReady();
  }

  function startRead(
    next: CatalogDirectorySnapshot,
    input: CatalogListRequest,
    mode: ReadMode,
    delay: number,
  ) {
    cancelRead();
    const request = owner === undefined ? undefined : new AbortController();
    active = request;
    if (mode !== 'refresh') {
      publish(next);
    }
    if (!request || request !== active) {
      return;
    }

    function start() {
      if (!request || request !== active) {
        return;
      }

      scheduled = undefined;
      readPage(input, request, mode).catch((cause: unknown) => failPage(request, mode, cause));
    }

    if (delay > 0) {
      scheduled = setTimeout(start, delay);

      return;
    }

    start();
  }

  function replace(query: string, order: CatalogSortOrder, pinnedOnly: boolean, delay = 0) {
    const input = { query, order, pageSize, ...(pinnedOnly ? { pinnedOnly: true } : {}) };
    startRead(loading(query, order, pinnedOnly), input, 'replace', delay);
  }

  function reload() {
    const { query, order, pinnedOnly } = snapshot;
    if (snapshot.kind === 'ready' && catalogCursor !== undefined) {
      refreshRequested = true;
      refreshIfReady();
      return;
    }

    startRead(
      { ...loading(query, order, pinnedOnly), boards: snapshot.boards },
      currentInput(),
      'replace',
      0,
    );
  }

  function close() {
    owner?.abort();
    owner = undefined;
    catalogCursor = undefined;
    refreshRequested = false;
    cancelRead();
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
      close();
      const lifetime = new AbortController();
      owner = lifetime;
      reload();

      return () => {
        if (owner === lifetime) {
          close();
        }
      };
    },
    setQuery(query) {
      if (query !== snapshot.query) {
        replace(query, snapshot.order, snapshot.pinnedOnly, query.trim() ? searchDelayMs : 0);
      }
    },
    setOrder(order) {
      if (order !== snapshot.order) {
        replace(snapshot.query, order, snapshot.pinnedOnly);
      }
    },
    setPinnedOnly(pinnedOnly, clearQuery = false) {
      const query = clearQuery ? '' : snapshot.query;
      if (pinnedOnly !== snapshot.pinnedOnly || query !== snapshot.query) {
        replace(query, 'recent', pinnedOnly);
      }
    },
    loadMore() {
      const { kind, loadingMore, nextCursor, query, order, pinnedOnly } = snapshot;
      if (kind !== 'ready' || loadingMore || nextCursor === undefined) {
        return;
      }

      startRead(
        { ...snapshot, loadingMore: true, error: undefined },
        { query, order, pageSize, cursor: nextCursor, ...(pinnedOnly ? { pinnedOnly: true } : {}) },
        'append',
        0,
      );
    },
    reload,
  };
}
