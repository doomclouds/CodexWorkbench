import { MessageSquare } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { FeedbackThread } from '../../data/feedback/index.js';
import { Button, StatusText } from '../../ui/base/index.js';
import { FeedbackPager } from './FeedbackPager.js';
import { FeedbackAvatar, feedbackAuthorName } from './feedback-author.js';

interface FeedbackListProps {
  readonly threads: readonly FeedbackThread[];
  readonly draftThreadIds: ReadonlySet<string>;
  readonly authorId: string;
  readonly authors: readonly { readonly id: string; readonly label: string }[];
  readonly mine: boolean;
  readonly showResolved: boolean;
  readonly onAuthorChange: (authorId: string) => void;
  readonly onMineChange: (mine: boolean) => void;
  readonly onShowResolvedChange: (showResolved: boolean) => void;
  readonly expandedId?: string;
  readonly expanded?: ReactNode;
  readonly onThread: (thread: FeedbackThread) => void;
  readonly pending: boolean;
  readonly hasMore: boolean;
  readonly loadMore: () => void;
  readonly error?: string;
  readonly onRefresh: () => void;
  readonly suggestionsOutlet?: (element: HTMLDivElement | null) => void;
  readonly hasVisibleSuggestions?: boolean;
}

interface FeedbackListEntryProps {
  readonly thread: FeedbackThread;
  readonly draft: boolean;
  readonly expanded: boolean;
  readonly details?: ReactNode;
  readonly onOpen: (thread: FeedbackThread) => void;
}

const displayTime = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function FeedbackListEntry({ thread, draft, expanded, details, onOpen }: FeedbackListEntryProps) {
  const row = useRef<HTMLLIElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const wasExpanded = useRef(false);
  const name = feedbackAuthorName(thread.first);

  useLayoutEffect(() => {
    if (expanded) {
      row.current?.focus({ preventScroll: true });
    } else if (wasExpanded.current) {
      button.current?.focus({ preventScroll: true });
    }

    wasExpanded.current = expanded;
  }, [expanded]);

  return (
    <li
      ref={row}
      className="whiteboard-feedback__list-row"
      data-expanded={expanded || undefined}
      aria-label={expanded ? '备注讨论 · ' + name : undefined}
      tabIndex={expanded ? -1 : undefined}
    >
      {expanded ? (
        details
      ) : (
        <button
          type="button"
          ref={button}
          className="whiteboard-feedback__row"
          data-status={thread.status}
          aria-label={'展开备注 · ' + thread.first.text}
          onClick={() => onOpen(thread)}
        >
          <span className="whiteboard-feedback__message-header">
            <FeedbackAvatar author={thread.first} />
            <span className="whiteboard-feedback__message-author">
              <strong>{name}</strong>
              <time dateTime={new Date(thread.first.createdAt).toISOString()}>
                {displayTime.format(thread.first.createdAt)}
              </time>
            </span>
            {thread.status === 'resolved' && <small>已解决</small>}
          </span>
          <span className="whiteboard-feedback__summary">{thread.first.text}</span>
          {thread.replyCount > 0 && (
            <span className="whiteboard-feedback__reply-count">{thread.replyCount} 条回复</span>
          )}
          {draft && <span className="whiteboard-feedback__reply-count">未保存的草稿</span>}
        </button>
      )}
    </li>
  );
}

export function FeedbackList({
  threads,
  draftThreadIds,
  authorId,
  authors,
  mine,
  showResolved,
  onAuthorChange,
  onMineChange,
  onShowResolvedChange,
  expandedId,
  expanded,
  onThread,
  pending,
  hasMore,
  loadMore,
  error,
  onRefresh,
  suggestionsOutlet,
  hasVisibleSuggestions,
}: FeedbackListProps) {
  const ready = !pending && !error;
  const empty = ready && threads.length === 0 && !hasVisibleSuggestions;
  const filtered = mine || Boolean(authorId);

  return (
    <>
      <div className="whiteboard-feedback__list-controls">
        <div className="whiteboard-feedback__scope" role="group" aria-label="备注范围">
          <button type="button" aria-pressed={!mine} onClick={() => onMineChange(false)}>
            全部
          </button>
          <button type="button" aria-pressed={mine} onClick={() => onMineChange(true)}>
            我发起
          </button>
        </div>
        <div className="whiteboard-feedback__filters">
          {!mine && (
            <label className="whiteboard-feedback__author-filter">
              作者
              <select
                value={authorId}
                onChange={(event) => onAuthorChange(event.currentTarget.value)}
              >
                <option value="">所有作者</option>
                {authors.map(({ id, label }) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="whiteboard-feedback__resolved-filter">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(event) => onShowResolvedChange(event.currentTarget.checked)}
            />
            显示已解决
          </label>
        </div>
      </div>
      {suggestionsOutlet && <div ref={suggestionsOutlet} />}
      {pending && <StatusText message="正在加载备注…" announcement="polite" />}
      {error && (
        <div className="whiteboard-feedback__actions">
          <StatusText message={error} tone="error" announcement="assertive" />
          <Button label="重新加载" onActivate={onRefresh} />
        </div>
      )}
      {empty && (
        <div className="whiteboard-feedback__empty">
          <MessageSquare size={24} />
          <p>{filtered ? '没有符合筛选的备注' : '还没有备注'}</p>
          {!filtered && <small>点击顶部备注图标，再选择要讨论的目标。</small>}
        </div>
      )}
      <ul className="whiteboard-feedback__threads" aria-label="备注讨论">
        {threads.map((thread) => (
          <FeedbackListEntry
            key={thread.id}
            thread={thread}
            draft={draftThreadIds.has(thread.id)}
            expanded={thread.id === expandedId}
            details={thread.id === expandedId ? expanded : undefined}
            onOpen={onThread}
          />
        ))}
      </ul>
      {hasMore && <FeedbackPager label="更多备注" pending={pending} onActivate={loadMore} />}
    </>
  );
}
