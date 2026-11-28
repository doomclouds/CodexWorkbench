import { useEffect, useRef, useState } from 'react';
import type { FeedbackOperation } from '../../data/feedback/index.js';
import type { WhiteboardFeedbackSurfaceProps } from './contracts.js';

interface AttachmentTarget {
  readonly threadId: string;
  readonly threadVersion: bigint;
}

interface PendingAttachment extends AttachmentTarget {
  readonly commandId: string;
  readonly saved: boolean;
  readonly resetRequestId?: string;
  resetCommandId?: string;
  claimId?: string;
  confirmId?: string;
  delivered?: boolean;
}

type AttachOptions = Pick<
  WhiteboardFeedbackSurfaceProps,
  'boardId' | 'createCommandId' | 'onAttachThread' | 'service'
> & { readonly onChanged: () => void };

function failureMessage(error: unknown) {
  return error instanceof Error ? error.message : '未收到附加确认。';
}

export function useFeedbackAttachment({
  boardId,
  createCommandId,
  onAttachThread,
  service,
  onChanged,
}: AttachOptions) {
  const [pending, setPending] = useState<PendingAttachment>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const active = useRef<AbortController>(undefined);

  useEffect(() => () => active.current?.abort(), [boardId]);

  async function apply(commandId: string, operation: FeedbackOperation, signal: AbortSignal) {
    const receipt = await service.apply({ boardId, commandId, operation }, signal);
    signal.throwIfAborted();
    if (receipt.kind === 'rejected') {
      if (receipt.reason === 'attachmentClaimed') {
        throw new Error('另一面板正在处理这条备注。请先核对 Codex 草稿。');
      }

      throw new Error('备注已发生变化或附加权限不可用。请重新打开这条备注。');
    }
  }

  async function deliver(attachment: PendingAttachment, signal: AbortSignal) {
    const { threadId, threadVersion, commandId } = attachment;
    if (attachment.resetRequestId) {
      const id = (attachment.resetCommandId ??= createCommandId());
      await apply(
        id,
        { kind: 'resetAttachmentClaim', threadId, requestId: attachment.resetRequestId },
        signal,
      );
    }
    await apply(
      commandId,
      { kind: 'requestAttachment', threadId, expectedVersion: threadVersion },
      signal,
    );
    onChanged();
    if (!onAttachThread) {
      return '已请求房主在 Codex 中附加。';
    }

    const { thread } = await service.getThread({ boardId, threadId, pageSize: 1 }, signal);
    signal.throwIfAborted();
    const queued = thread.attachment;
    if (!queued || queued.threadVersion !== threadVersion) {
      throw new Error('找不到这次待附加请求。请重新打开备注。');
    }
    if (queued.state === 'attached') {
      return '已附加到 Codex 对话。';
    }

    const { requestId } = queued;
    const claimId = (attachment.claimId ??= createCommandId());
    await apply(claimId, { kind: 'claimAttachment', threadId, requestId }, signal);
    if (!attachment.delivered) {
      await onAttachThread({ boardId, threadId, threadVersion, commandId: requestId, signal });
      attachment.delivered = true;
    }
    const confirmId = (attachment.confirmId ??= createCommandId());
    await apply(confirmId, { kind: 'confirmAttachment', threadId, requestId, claimId }, signal);
    onChanged();

    return '已附加到 Codex 对话。';
  }

  function run(attachment: PendingAttachment) {
    if (active.current) {
      return;
    }

    const controller = new AbortController();
    active.current = controller;
    setPending(attachment);
    setBusy(true);
    setFailure(undefined);
    setNotice(undefined);
    const { signal } = controller;
    deliver(attachment, signal)
      .then((result) => {
        if (!signal.aborted) {
          setNotice(result);
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

  function request(target: AttachmentTarget, saved = false, resetRequestId?: string) {
    if (active.current || pending) {
      return;
    }

    try {
      run({ ...target, commandId: createCommandId(), saved, resetRequestId });
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
    canDeliver: onAttachThread !== undefined,
    actionLabel: onAttachThread ? '附加到 Codex 对话' : '请求房主附加到 Codex',
    notice,
    busy,
    failure,
    pending,
    request,
    retry,
    cancel,
  };
}

export type FeedbackAttachment = ReturnType<typeof useFeedbackAttachment>;
