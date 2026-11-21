import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { MessageSquare } from 'lucide-react';
import type { Actor, Feedback } from '../../../contracts/studio';
import { CommentThread, type RunCommentAction } from './CommentThread';
import { isAttachmentPending } from './attachment';
import { commentAuthorKey, commentAuthorName } from './comment-author';
import './comments.css';
import './comment-panel.css';

interface Props {
  feedback: Feedback[];
  actor: Actor;
  busy: boolean;
  showResolved: boolean;
  onShowResolved: (value: boolean) => void;
  onOpen: (feedback: Feedback) => void;
  onAction: RunCommentAction;
  onAttach: (feedback: Feedback) => Promise<void>;
  renderSuggestion: (feedback: Feedback) => ReactNode;
  renderAnchorNotice?: (feedback: Feedback) => ReactNode;
  attachingId?: string;
  openFeedbackId?: string;
  onCloseFeedback?: () => void;
  replyTextById?: Record<string, string>;
  onReplyTextChange?: (id: string, text: string) => void;
}

export function CommentsPanel({
  feedback,
  actor,
  busy,
  showResolved,
  onShowResolved,
  onOpen,
  onAction,
  onAttach,
  renderSuggestion,
  renderAnchorNotice,
  attachingId,
  openFeedbackId,
  onCloseFeedback,
  replyTextById,
  onReplyTextChange,
}: Props) {
  const [mine, setMine] = useState(false);
  const [authorKey, setAuthorKey] = useState('');
  const expandedRow = useRef<HTMLDivElement>(null);
  const closingRow = useRef<HTMLDivElement | null>(null);
  const authors = new Map<string, Feedback['author']>();
  for (const item of [...feedback].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  )) {
    const key = commentAuthorKey(item.author);
    if (!authors.has(key)) {
      authors.set(key, item.author);
    }
  }

  const authorOptions = [...authors].sort(([, left], [, right]) =>
    commentAuthorName(left).localeCompare(commentAuthorName(right), 'zh-CN'),
  );
  const selectedAuthor = authors.has(authorKey) ? authorKey : '';
  const visible = feedback
    .filter((item) => {
      if (!showResolved && item.status === 'resolved' && !isAttachmentPending(item)) {
        return false;
      }
      if (mine) {
        return item.author.id === actor.id && item.author.kind === actor.kind;
      }

      return !selectedAuthor || commentAuthorKey(item.author) === selectedAuthor;
    })
    .sort(
      (left, right) =>
        Number(isAttachmentPending(right)) - Number(isAttachmentPending(left)) ||
        right.createdAt.localeCompare(left.createdAt),
    );
  const openVisible = visible.some((item) => item.id === openFeedbackId && !item.proposal);
  useEffect(() => {
    if (openFeedbackId && !openVisible) {
      onCloseFeedback?.();
    }
  }, [openFeedbackId, openVisible, onCloseFeedback]);
  useLayoutEffect(() => {
    if (openFeedbackId && openVisible) {
      expandedRow.current?.focus({ preventScroll: true });
    } else {
      closingRow.current
        ?.querySelector<HTMLElement>('.studio-comment-list-item')
        ?.focus({ preventScroll: true });
    }

    closingRow.current = null;
  }, [openFeedbackId, openVisible]);

  const filtered = mine || selectedAuthor;
  const filteredEmptyMessage = filtered ? '没有符合筛选的备注' : '没有未解决的备注';
  const emptyMessage = feedback.length ? filteredEmptyMessage : '还没有备注';
  function handleCloseFeedback() {
    closingRow.current = expandedRow.current;
    onCloseFeedback?.();
  }

  return (
    <div className="studio-comment-list" aria-label="备注列表面板">
      <div className="studio-comment-list-controls">
        <div className="studio-comment-scope" role="group" aria-label="备注范围">
          <button type="button" aria-pressed={!mine} onClick={() => setMine(false)}>
            全部
          </button>
          <button type="button" aria-pressed={mine} onClick={() => setMine(true)}>
            我发起
          </button>
        </div>
        <div className="studio-comment-list-filters">
          {!mine && (
            <label className="studio-comment-author-filter">
              作者
              <select value={selectedAuthor} onChange={(event) => setAuthorKey(event.target.value)}>
                <option value="">所有作者</option>
                {authorOptions.map(([key, author]) => (
                  <option value={key} key={key}>
                    {commentAuthorName(author)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="studio-comment-resolved-filter">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(event) => onShowResolved(event.target.checked)}
            />
            显示已解决
          </label>
        </div>
      </div>
      {!visible.length && (
        <div className="studio-panel-empty">
          <MessageSquare size={24} />
          <p>{emptyMessage}</p>
          {!feedback.length && <small>点击顶部备注图标，再选择要讨论的目标。</small>}
        </div>
      )}
      {visible.map((item) => {
        if (item.proposal) {
          return <div key={item.id}>{renderSuggestion(item)}</div>;
        }

        const expanded = item.id === openFeedbackId;

        return (
          <div
            key={item.id}
            className={`studio-comment-list-row${expanded ? ' is-expanded' : ''}`}
            ref={expanded ? expandedRow : undefined}
            role={expanded ? 'region' : undefined}
            aria-label={expanded ? `备注讨论 · ${commentAuthorName(item.author)}` : undefined}
            tabIndex={expanded ? -1 : undefined}
          >
            {expanded && renderAnchorNotice?.(item)}
            <CommentThread
              compact={!expanded}
              feedback={item}
              actor={actor}
              busy={busy}
              attaching={item.id === attachingId}
              onOpen={() => onOpen(item)}
              onClose={handleCloseFeedback}
              onAction={onAction}
              onAttach={onAttach}
              replyText={replyTextById?.[item.id]}
              onReplyTextChange={
                onReplyTextChange ? (text) => onReplyTextChange(item.id, text) : undefined
              }
            />
          </div>
        );
      })}
    </div>
  );
}
