import { useEffect, useRef, useState } from 'react';
import type { WhiteboardFeedbackSurfaceProps } from './contracts.js';

interface AttachmentTarget {
  readonly threadId: string;
  readonly threadVersion: bigint;
}

interface PendingAttachment extends AttachmentTarget {
  readonly commandId: string;
  readonly saved: boolean;
}

type AttachOptions = Pick<
  WhiteboardFeedbackSurfaceProps,
  'boardId' | 'createCommandId' | 'onAttachThread'
>;

function failureMessage(error: unknown) {
  return error instanceof Error ? error.message : '未收到附加确认。';
}

export function useFeedbackAttachment({ boardId, createCommandId, onAttachThread }: AttachOptions) {
  const [pending, setPending] = useState<PendingAttachment>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [complete, setComplete] = useState<ReadonlyMap<string, bigint>>(() => new Map());
  const active = useRef<AbortController>(undefined);

  useEffect(() => () => active.current?.abort(), [boardId]);

  function run(attachment: PendingAttachment) {
    if (!onAttachThread || active.current) {
      return;
    }

    const controller = new AbortController();
    active.current = controller;
    setPending(attachment);
    setBusy(true);
    setFailure(undefined);
    const { threadId, threadVersion, commandId } = attachment;
    const { signal } = controller;
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return onAttachThread({ boardId, threadId, commandId, signal });
      })
      .then(() => {
        if (!signal.aborted) {
          setComplete((previous) => new Map(previous).set(threadId, threadVersion));
          setPending(undefined);
        }
      })
      .catch((error: unknown) => {
        if (!signal.aborted) {
          setFailure(failureMessage(error));
        }
      })
      .finally(() => {
        if (!signal.aborted) {
          active.current = undefined;
          setBusy(false);
        }
      })
      .catch((error: unknown) => {
        if (!signal.aborted) {
          setFailure(failureMessage(error));
        }
      });
  }

  function request(target: AttachmentTarget, saved = false) {
    const attached = complete.get(target.threadId) === target.threadVersion;
    const unavailable = !onAttachThread || active.current !== undefined;
    if (unavailable || pending || attached) {
      return;
    }

    try {
      run({ ...target, commandId: createCommandId(), saved });
    } catch (error) {
      setFailure(failureMessage(error));
    }
  }

  function retry() {
    if (pending) {
      run(pending);
    }
  }

  function cancel() {
    if (!active.current) {
      setPending(undefined);
      setFailure(undefined);
    }
  }

  return {
    available: onAttachThread !== undefined,
    busy,
    failure,
    pending,
    complete,
    request,
    retry,
    cancel,
  };
}

export type FeedbackAttachment = ReturnType<typeof useFeedbackAttachment>;
