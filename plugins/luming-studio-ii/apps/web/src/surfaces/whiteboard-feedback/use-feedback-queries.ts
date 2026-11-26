import { useMemo, useState } from 'react';
import type {
  BoardFeedbackService,
  FeedbackMessage,
  FeedbackPage,
  FeedbackStatus,
  FeedbackThread,
  FeedbackThreadPage,
} from '../../data/feedback/index.js';
import { useFeedbackPages } from './use-feedback-pages.js';

interface FeedbackQueryOptions {
  readonly boardId: string;
  readonly enabled: boolean;
  readonly panelOpen: boolean;
  readonly service: BoardFeedbackService;
  readonly threadId?: string;
}

const pageSize = 30;

function authorsOf(threads: readonly FeedbackThread[], current: string) {
  const authors = new Map<string, string>();
  for (const { first } of threads) {
    const { authorId, authoredByViewer } = first;
    authors.set(authorId, authoredByViewer ? '我' : authorId);
  }
  if (current && !authors.has(current)) {
    authors.set(current, current);
  }

  return Array.from(authors, ([id, label]) => ({ id, label }));
}

export function useFeedbackQueries({
  boardId,
  enabled,
  panelOpen,
  service,
  threadId,
}: FeedbackQueryOptions) {
  const [authorId, setAuthorId] = useState('');
  const [mine, setMine] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [requestVersion, setRequestVersion] = useState(0);
  const status: FeedbackStatus | undefined = showResolved ? undefined : 'open';
  const baseQuery = useMemo(
    () => ({
      requestVersion,
      load(cursor: string | undefined, signal: AbortSignal) {
        return service.listThreads({ boardId, pageSize, status, cursor }, signal);
      },
    }),
    [boardId, requestVersion, service, status],
  );
  const baseList = useFeedbackPages<FeedbackThread, FeedbackPage<FeedbackThread>>(
    enabled ? baseQuery : undefined,
  );
  const ownAuthor = baseList.items.find(({ first }) => first.authoredByViewer)?.first.authorId;
  const selectedAuthor = mine ? ownAuthor : authorId;
  const openQuery = useMemo(
    () => ({
      requestVersion,
      load(cursor: string | undefined, signal: AbortSignal) {
        return service.listThreads({ boardId, cursor, pageSize: 1, status: 'open' }, signal);
      },
    }),
    [boardId, requestVersion, service],
  );
  const openThreads = useFeedbackPages<FeedbackThread, FeedbackPage<FeedbackThread>>(
    enabled && showResolved ? openQuery : undefined,
  );
  const authorQuery = useMemo(
    () => ({
      requestVersion,
      load(cursor: string | undefined, signal: AbortSignal) {
        return service.listThreads(
          { boardId, pageSize, status, cursor, authorId: selectedAuthor },
          signal,
        );
      },
    }),
    [selectedAuthor, boardId, requestVersion, service, status],
  );
  const detailQuery = useMemo(() => {
    if (!threadId) {
      return undefined;
    }

    return {
      requestVersion,
      load(cursor: string | undefined, signal: AbortSignal) {
        return service.getThread({ boardId, threadId, pageSize, cursor }, signal);
      },
    };
  }, [threadId, boardId, requestVersion, service]);

  const panelEnabled = enabled && panelOpen;
  const filterEnabled = panelEnabled && Boolean(selectedAuthor);
  const filteredList = useFeedbackPages<FeedbackThread, FeedbackPage<FeedbackThread>>(
    filterEnabled ? authorQuery : undefined,
  );
  const detail = useFeedbackPages<FeedbackMessage, FeedbackThreadPage>(
    enabled ? detailQuery : undefined,
  );

  function refresh() {
    setRequestVersion((previous) => previous + 1);
  }

  const list = selectedAuthor ? filteredList : baseList;
  const unresolved = showResolved ? openThreads : baseList;

  return {
    authors: authorsOf(baseList.items, authorId),
    authorId,
    setAuthorId,
    mine,
    setMine,
    showResolved,
    setShowResolved,
    pinnedThreads: baseList.items,
    hasUnresolved: unresolved.page && unresolved.items.some((thread) => thread.status === 'open'),
    canWrite: baseList.page?.canWrite === true,
    list: mine && !ownAuthor ? { ...list, items: [] } : list,
    detail,
    refresh,
  };
}
