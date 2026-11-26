import type {
  FeedbackOperation,
  FeedbackPoint,
  FeedbackTarget,
} from '../../data/feedback/index.js';
import type { FeedbackCanvasObject } from './contracts.js';
import { FeedbackThreadView } from './FeedbackThreadView.js';
import type { ThreadDraft } from './thread-draft.js';
import type { useFeedbackQueries } from './use-feedback-queries.js';

export interface CreateDraft {
  readonly target: FeedbackTarget;
  readonly text: string;
  readonly frozenPoint?: FeedbackPoint;
  readonly label: string;
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
  readonly onSubmit: (operation: FeedbackOperation) => void;
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
}: FeedbackDetailsProps) {
  const { detail, refresh } = queries;
  const target = detail.page?.thread.anchor.target;
  const missing = target?.kind === 'object' && !objects.has(target.objectId);

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
      targetMissing={missing}
      hasMore={Boolean(detail.page?.nextCursor)}
      loadMore={detail.loadMore}
      onRefresh={refresh}
      onBack={onClose}
      onLocate={onLocate}
      onSubmit={onSubmit}
    />
  );
}
