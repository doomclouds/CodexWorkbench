import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import type {
  FeedbackAnchor,
  FeedbackTarget,
  FeedbackThread,
  FeedbackThreadPage,
} from '../../data/feedback/index.js';
import type { CanvasContentLocationRequest } from '../../ui/domain/canvas/index.js';
import type { FeedbackCanvasObject, WhiteboardFeedbackSurfaceProps } from './contracts.js';
import type { CreateDraft } from './FeedbackPanelContent.js';
import { locateAnchor, locateDraft } from './geometry.js';

interface AnchorSelection {
  readonly id: string;
  readonly anchor?: FeedbackAnchor;
  readonly draftTarget?: FeedbackTarget;
  readonly draftPoint?: FeedbackAnchor['frozenPoint'];
}

interface LocationOptions extends Pick<
  WhiteboardFeedbackSurfaceProps,
  | 'viewing'
  | 'contentLocations'
  | 'contentPoints'
  | 'onContentLocationRequests'
  | 'focusWorldPoint'
  | 'focusContentObject'
> {
  readonly pinnedThreads: readonly FeedbackThread[];
  readonly selection?: AnchorSelection;
  readonly detail?: FeedbackThreadPage;
  readonly draft?: CreateDraft;
  readonly focusedObjectId?: string;
  readonly objects: ReadonlyMap<string, FeedbackCanvasObject>;
}

function draftPointFor(
  draft: CreateDraft | undefined,
  objects: LocationOptions['objects'],
  locations: LocationOptions['contentLocations'],
) {
  if (draft) {
    return (
      locations?.get(draft.locationId)?.point ??
      locateDraft(draft.target, objects) ??
      draft.frozenPoint
    );
  }
}

export function useFeedbackContentLocations({
  viewing,
  contentLocations,
  contentPoints,
  onContentLocationRequests,
  focusWorldPoint,
  focusContentObject,
  focusedObjectId,
  objects,
  pinnedThreads,
  selection,
  detail,
  draft,
}: LocationOptions) {
  const sequence = useRef(0);
  const [pending, setPending] = useState<{ id: string; reveal: number }>();
  const threads = pinnedThreads.length ? pinnedThreads : undefined;
  const id = selection?.id;
  const anchor = detail?.thread.anchor ?? selection?.anchor;
  const draftId = draft?.locationId;
  const draftTarget = draft?.target;
  const requests = useMemo(() => {
    if (viewing || !onContentLocationRequests) {
      return undefined;
    }

    const entries = new Map<string, CanvasContentLocationRequest[]>();
    function request(targetId: string, target: FeedbackTarget) {
      if (target.kind !== 'content') {
        return;
      }
      if (focusedObjectId && target.objectId !== focusedObjectId && pending?.id !== targetId) {
        return;
      }

      const object = entries.get(target.objectId) ?? [];
      object.push({
        id: targetId,
        target: target.content,
        u: target.u,
        v: target.v,
        reveal: pending?.id === targetId ? pending.reveal : undefined,
      });
      entries.set(target.objectId, object);
    }
    for (const thread of threads ?? []) {
      if (!thread.anchor.targetMissing && (thread.id !== id || !anchor)) {
        request(thread.id, thread.anchor.target);
      }
    }
    if (id && anchor && !anchor.targetMissing) {
      request(id, anchor.target);
    }
    if (draftId && draftTarget) {
      request(draftId, draftTarget);
    }

    return entries.size ? entries : undefined;
  }, [
    anchor,
    draftId,
    draftTarget,
    focusedObjectId,
    id,
    onContentLocationRequests,
    pending,
    threads,
    viewing,
  ]);

  useEffect(() => {
    onContentLocationRequests?.(requests);
  }, [onContentLocationRequests, requests]);
  useEffect(() => () => onContentLocationRequests?.(undefined), [onContentLocationRequests]);

  const report = pending && contentLocations?.get(pending.id);
  const finish = useEffectEvent(() => {
    if (!pending || report?.reveal !== pending.reveal) {
      return;
    }

    if (report.point) {
      focusWorldPoint?.(report.point);
    }
    setPending(undefined);
  });
  useEffect(() => {
    if (report && report.reveal === pending?.reveal) {
      const frame = requestAnimationFrame(() => finish());

      return () => cancelAnimationFrame(frame);
    }
  }, [pending, report]);

  function reveal(threadId: string, { target, targetMissing }: FeedbackAnchor) {
    const available = target.kind === 'content' && objects.has(target.objectId);
    if (!onContentLocationRequests || targetMissing || !available) {
      setPending(undefined);
      return false;
    }

    sequence.current += 1;
    setPending({ id: threadId, reveal: sequence.current });
    const point = contentLocations?.get(threadId)?.point;
    const differentReadingObject = focusedObjectId && target.objectId !== focusedObjectId;
    if (!point || differentReadingObject) {
      focusContentObject?.(target.objectId);
    }

    return true;
  }

  function pointFor(threadId: string, anchor: FeedbackAnchor) {
    const point =
      contentLocations?.get(threadId)?.point ??
      contentPoints?.get(threadId) ??
      (threadId === id ? selection?.draftPoint : undefined);

    return locateAnchor(anchor, objects, point);
  }

  const submitted = selection?.draftTarget;
  const submittedPoint = submitted && (selection.draftPoint ?? locateDraft(submitted, objects));
  const threadPoint = id && anchor ? pointFor(id, anchor) : submittedPoint;
  const awaitingPostedPoint =
    submitted && !pinnedThreads.some((thread) => thread.id === id) ? threadPoint : undefined;
  const draftPoint = draftPointFor(draft, objects, contentLocations);

  function focusThread({ id, anchor }: FeedbackThread) {
    if (!reveal(id, anchor)) {
      focusWorldPoint?.(pointFor(id, anchor));
    }
  }

  function focusSelected() {
    if (id && anchor && reveal(id, anchor)) {
      return;
    }

    if (threadPoint) {
      focusWorldPoint?.(threadPoint);
    }
  }

  return {
    draftPoint,
    threadPoint,
    awaitingPostedPoint,
    focusThread,
    focusSelected,
    cancel: () => setPending(undefined),
  };
}
