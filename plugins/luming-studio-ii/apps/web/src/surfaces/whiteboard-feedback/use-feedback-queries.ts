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
import { feedbackAuthorName } from './feedback-author.js';

interface FeedbackQueryOptions {
  readonly boardId: string;
  readonly updateKey?: string;
  readonly enabled: boolean;
  readonly panelOpen: boolean;
  readonly service: BoardFeedbackService;
  readonly threadId?: string;
}

const pageSize = 30;

function authorsOf(threads: readonly FeedbackThread[], current: string) {
  const authors = new Map<string, string>();
  for (const { first } of threads) {
    authors.set(first.authorId, feedbackAuthorName(first));
  }
  if (current && !authors.has(current)) {
    authors.set(current, '协作者');
  }

  return Array.from(authors, ([id, label]) => ({ id, label }));
}

export function useFeedbackQueries({
  boardId,
  updateKey,
  enabled,
  panelOpen,
  service,
  threadId,
}: FeedbackQueryOptions) {
  const [authorId, setAuthorId] = useState('');
  const [scope, setScope] = useState<'all' | 'mine' | 'pending'>('all');
  const mine = scope === 'mine';
  const pendingAttachment = scope === 'pending';
  const [showResolved, setShowResolved] = useState(false);
  const [localVersion, setLocalVersion] = useState(0);
  const requestVersion = (updateKey ?? '') + '/' + localVersion;
  const status: FeedbackStatus | undefined = showResolved ? undefined : 'open';
  const baseQuery = useMemo(
    () => ({
      load(cursor: string | undefined, signal: AbortSignal) {
        return service.listThreads({ boardId, pageSize, status, cursor }, signal);
      },
    }),
    [boardId, service, status],
  );
  const baseList = useFeedbackPages<FeedbackThread, FeedbackPage<FeedbackThread>>(
    enabled ? baseQuery : undefined,
    requestVersion,
  );
  const selectedAuthor = scope === 'all' ? authorId : undefined;
  const filtering = scope !== 'all' || Boolean(selectedAuthor);
  const openQuery = useMemo(
    () => ({
      load(cursor: string | undefined, signal: AbortSignal) {
        return service.listThreads({ boardId, cursor, pageSize: 1, status: 'open' }, signal);
      },
    }),
    [boardId, service],
  );
  const openThreads = useFeedbackPages<FeedbackThread, FeedbackPage<FeedbackThread>>(
    enabled && showResolved ? openQuery : undefined,
    requestVersion,
  );
  const authorQuery = useMemo(
    () => ({
      load(cursor: string | undefined, signal: AbortSignal) {
        return service.listThreads(
          {
            boardId,
            pageSize,
            status: pendingAttachment ? undefined : status,
            cursor,
            authorId: selectedAuthor,
            authoredByViewer: mine,
            pendingAttachment,
          },
          signal,
        );
      },
    }),
    [selectedAuthor, boardId, mine, pendingAttachment, service, status],
  );
  const detailQuery = useMemo(() => {
    if (!threadId) {
      return undefined;
    }

    return {
      load(cursor: string | undefined, signal: AbortSignal) {
        return service.getThread({ boardId, threadId, pageSize, cursor }, signal);
      },
    };
  }, [threadId, boardId, service]);

  const panelEnabled = enabled && panelOpen;
  const filterEnabled = panelEnabled && filtering;
  const filteredList = useFeedbackPages<FeedbackThread, FeedbackPage<FeedbackThread>>(
    filterEnabled ? authorQuery : undefined,
    requestVersion,
  );
  const detail = useFeedbackPages<FeedbackMessage, FeedbackThreadPage>(
    enabled ? detailQuery : undefined,
    requestVersion,
  );

  function refresh() {
    setLocalVersion((previous) => previous + 1);
  }

  const list = filtering ? filteredList : baseList;
  const unresolved = showResolved ? openThreads : baseList;

  return {
    authors: authorsOf(baseList.items, authorId),
    authorId,
    setAuthorId,
    mine,
    scope,
    setScope,
    showResolved,
    setShowResolved,
    pinnedThreads: baseList.items,
    hasUnresolved: unresolved.page && unresolved.items.some((thread) => thread.status === 'open'),
    canWrite: baseList.page?.canWrite === true,
    list,
    detail,
    refresh,
  };
}
