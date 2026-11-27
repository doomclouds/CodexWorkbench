import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import type {
  FeedbackAnchor,
  FeedbackTarget,
  FeedbackThread,
  FeedbackThreadPage,
} from '../../data/feedback/index.js';
import type { CanvasContentLocationRequest } from '../../ui/domain/canvas/index.js';
import type { FeedbackCanvasObject, WhiteboardFeedbackSurfaceProps } from './contracts.js';
import { locateAnchor, locateDraft } from './geometry.js';

interface AnchorSelection {
  readonly id: string;
  readonly anchor?: FeedbackAnchor;
  readonly draftTarget?: FeedbackTarget;
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
  readonly focusedObjectId?: string;
  readonly objects: ReadonlyMap<string, FeedbackCanvasObject>;
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
}: LocationOptions) {
  const sequence = useRef(0);
  const [pending, setPending] = useState<{ id: string; reveal: number }>();
  const threads = pinnedThreads.length ? pinnedThreads : undefined;
  const id = selection?.id;
  const anchor = detail?.thread.anchor ?? selection?.anchor;
  const requests = useMemo(() => {
    if (viewing || !onContentLocationRequests) {
      return undefined;
    }

    const entries = new Map<string, CanvasContentLocationRequest[]>();
    function request(threadId: string, anchor: FeedbackAnchor) {
      const { target, targetMissing } = anchor;
      if (target.kind !== 'content' || targetMissing) {
        return;
      }
      if (focusedObjectId && target.objectId !== focusedObjectId && pending?.id !== threadId) {
        return;
      }

      const object = entries.get(target.objectId) ?? [];
      object.push({
        id: threadId,
        target: target.content,
        u: target.u,
        v: target.v,
        reveal: pending?.id === threadId ? pending.reveal : undefined,
      });
      entries.set(target.objectId, object);
    }
    for (const thread of threads ?? []) {
      if (thread.id !== id || !anchor) {
        request(thread.id, thread.anchor);
      }
    }
    if (id && anchor) {
      request(id, anchor);
    }

    return entries.size ? entries : undefined;
  }, [anchor, focusedObjectId, id, onContentLocationRequests, pending, threads, viewing]);

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
    const point = contentLocations?.get(threadId)?.point ?? contentPoints?.get(threadId);

    return locateAnchor(anchor, objects, point);
  }

  const draft = selection?.draftTarget;
  const threadPoint = id && anchor ? pointFor(id, anchor) : draft && locateDraft(draft, objects);

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

  return { threadPoint, focusThread, focusSelected, cancel: () => setPending(undefined) };
}
