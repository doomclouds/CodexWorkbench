import { Button, StatusText } from '../../ui/base/index.js';
import type { BoardSuggestionsSurfaceProps } from './contracts.js';
import type { useReviewAttachment } from './use-review-attachment.js';

interface SuggestionAttachmentProps extends Pick<
  BoardSuggestionsSurfaceProps,
  'selection' | 'feedbackThreadId' | 'onAttachSource' | 'attachmentMode'
> {
  readonly attachment: ReturnType<typeof useReviewAttachment>;
}

export function SuggestionAttachment(props: SuggestionAttachmentProps) {
  const { attachment, selection, feedbackThreadId, attachmentMode } = props;
  const hasSelection = selection !== undefined && selection.length > 0;
  const unavailable = attachment.busy || Boolean(attachment.pending);
  const copying = attachmentMode === 'copy';

  if (!props.onAttachSource) {
    return null;
  }

  return (
    <section className="board-suggestion-attachment" aria-label="附加建议来源">
      <div className="board-suggestion-card__actions">
        {hasSelection && (
          <Button
            label={copying ? '复制选区引用' : '附加选区'}
            disabled={unavailable}
            onActivate={() =>
              attachment.requestAttachment({ kind: 'selection', objectIds: [...selection] })
            }
          />
        )}
        {feedbackThreadId && (
          <Button
            label={copying ? '复制批注引用' : '附加批注'}
            disabled={unavailable}
            onActivate={() =>
              attachment.requestAttachment({ kind: 'feedback', threadId: feedbackThreadId })
            }
          />
        )}
        {attachment.pending && !attachment.busy && (
          <>
            <Button label="重试附加" onActivate={attachment.retry} />
            <Button label="取消此附加" onActivate={attachment.dismiss} />
          </>
        )}
      </div>
      {attachment.busy && <StatusText message="正在保存并附加来源…" announcement="polite" busy />}
      {attachment.notice && (
        <StatusText
          message={attachment.notice.message}
          tone={attachment.notice.tone}
          announcement="polite"
        />
      )}
    </section>
  );
}
