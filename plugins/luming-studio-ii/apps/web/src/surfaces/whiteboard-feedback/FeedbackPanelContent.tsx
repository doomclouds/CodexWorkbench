import type {
  FeedbackOperation,
  FeedbackPoint,
  FeedbackTarget,
} from '../../data/feedback/index.js';
import type { FeedbackCanvasObject } from './contracts.js';
import { FeedbackThreadView } from './FeedbackThreadView.js';
import { describeFeedbackTarget } from './target-description.js';
import type { ThreadDraft } from './thread-draft.js';
import type { FeedbackAttachment } from './use-feedback-attachment.js';
import type { useFeedbackQueries } from './use-feedback-queries.js';

export interface CreateDraft {
  readonly locationId: string;
  readonly target: FeedbackTarget;
  readonly text: string;
  readonly frozenPoint?: FeedbackPoint;
  readonly label: string;
  readonly excerpt?: string;
  readonly attach?: boolean;
}

interface FeedbackDetailsProps {
  readonly threadId: string;
  readonly queries: ReturnType<typeof useFeedbackQueries>;
  readonly objects: ReadonlyMap<string, FeedbackCanvasObject>;
  readonly draft?: ThreadDraft;
  readonly setDraft: (draft: ThreadDraft | undefined) => void;
  readonly canEdit: boolean;
  readonly blocked: boolean;
  readonly onLocate: () => void;
  readonly onClose: () => void;
  readonly onSubmit: (operation: FeedbackOperation, attach?: boolean) => void;
  readonly attachment: FeedbackAttachment;
}

export function FeedbackDetails({
  threadId,
  queries,
  objects,
  draft,
  setDraft,
  canEdit,
  blocked,
  onLocate,
  onClose,
  onSubmit,
  attachment,
}: FeedbackDetailsProps) {
  const { detail, refresh } = queries;
  const anchor = detail.page?.thread.anchor;
  const target = anchor?.target;
  const object = target && target.kind !== 'board' ? objects.get(target.objectId) : undefined;
  const missing =
    target && target.kind !== 'board' ? anchor?.targetMissing === true || !object : false;

  return (
    <FeedbackThreadView
      key={threadId}
      page={detail.page}
      replies={detail.items}
      draft={draft}
      setDraft={setDraft}
      canEdit={canEdit}
      blocked={blocked}
      pending={detail.pending}
      error={detail.error}
      targetLabel={anchor && describeFeedbackTarget(anchor.target, anchor.frozenObject ?? object)}
      targetMissing={missing}
      contentAnchor={target?.kind === 'content' ? anchor : undefined}
      hasMore={Boolean(detail.page?.nextCursor)}
      loadMore={detail.loadMore}
      onRefresh={refresh}
      onBack={onClose}
      onLocate={onLocate}
      onSubmit={onSubmit}
      attachment={attachment}
    />
  );
}
