import { useEffect, useState } from 'react';
import type { FeedbackPage } from '../../data/feedback/index.js';

interface FeedbackPagesQuery<T extends { readonly id: string }, Page extends FeedbackPage<T>> {
  readonly load: (cursor: string | undefined, signal: AbortSignal) => Promise<Page>;
}

interface CursorRequest<T extends { readonly id: string }, Page extends FeedbackPage<T>> {
  readonly query: FeedbackPagesQuery<T, Page>;
  readonly cursor: string;
}

interface FeedbackPagesResult<T extends { readonly id: string }, Page extends FeedbackPage<T>> {
  readonly query: FeedbackPagesQuery<T, Page>;
  readonly cursor?: string;
  readonly page?: Page;
  readonly items: readonly T[];
  readonly error?: string;
}

function uniqueItems<T extends { readonly id: string }>(
  previous: readonly T[],
  next: readonly T[],
) {
  return [...new Map([...previous, ...next].map((item) => [item.id, item])).values()];
}

export function useFeedbackPages<T extends { readonly id: string }, Page extends FeedbackPage<T>>(
  query: FeedbackPagesQuery<T, Page> | undefined,
) {
  const [request, setRequest] = useState<CursorRequest<T, Page>>();
  const [result, setResult] = useState<FeedbackPagesResult<T, Page>>();
  const cursor = request?.query === query ? request?.cursor : undefined;
  const active = result?.query === query ? result : undefined;
  const pending = Boolean(query) && (!active || active.cursor !== cursor);

  useEffect(() => {
    if (!query) {
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;
    Promise.resolve()
      .then(() => query.load(cursor, signal))
      .then((page) => {
        signal.throwIfAborted();
        setResult((previous) => ({
          query,
          cursor,
          page,
          items:
            cursor && previous?.query === query
              ? uniqueItems(previous.items, page.items)
              : page.items,
        }));
      })
      .catch((error: unknown) => {
        if (!signal.aborted) {
          const message = error instanceof Error ? error.message : '备注服务暂不可用。';
          setResult((previous) => ({
            query,
            cursor,
            page: previous?.query === query ? previous.page : undefined,
            items: previous?.query === query ? previous.items : [],
            error: message,
          }));
        }
      });

    return () => controller.abort();
  }, [query, cursor]);

  function loadMore() {
    if (query && active?.page?.nextCursor && !pending) {
      setRequest({ query, cursor: active.page.nextCursor });
    }
  }

  return {
    pending,
    page: active?.page,
    items: active?.items ?? [],
    error: active?.error,
    loadMore,
  };
}
