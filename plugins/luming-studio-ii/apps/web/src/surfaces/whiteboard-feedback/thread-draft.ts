export type ThreadDraft =
  | { readonly kind: 'reply'; readonly text: string }
  | {
      readonly kind: 'edit';
      readonly messageId: string;
      readonly expectedVersion: bigint;
      readonly originalText: string;
      readonly text: string;
    };

export function hasDraftChanges(draft: ThreadDraft | undefined) {
  if (!draft) {
    return false;
  }

  return draft.kind === 'edit' ? draft.text !== draft.originalText : Boolean(draft.text.trim());
}

import { useMemo, useState } from 'react';

export function useFeedbackDrafts(activeThreadId: string | undefined) {
  const [drafts, setDrafts] = useState<ReadonlyMap<string, ThreadDraft>>(new Map());
  const threadDraft = activeThreadId ? drafts.get(activeThreadId) : undefined;
  const draftThreadIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [id, draft] of drafts) {
      if (hasDraftChanges(draft)) {
        ids.add(id);
      }
    }

    return ids;
  }, [drafts]);

  function replace(threadId: string, draft: ThreadDraft | undefined) {
    setDrafts((previous) => {
      if (previous.get(threadId) === draft) {
        return previous;
      }

      const updated = new Map(previous);
      if (draft) {
        updated.set(threadId, draft);
      } else {
        updated.delete(threadId);
      }

      return updated;
    });
  }

  function handleSetThreadDraft(draft: ThreadDraft | undefined) {
    if (activeThreadId) {
      replace(activeThreadId, draft);
    }
  }

  function clearDraft(threadId: string) {
    replace(threadId, undefined);
  }

  return { threadDraft, draftThreadIds, handleSetThreadDraft, clearDraft };
}
