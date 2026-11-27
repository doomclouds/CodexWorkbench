import { useEffect, useRef, useState } from 'react';
import type {
  AttachedReviewSource,
  ReviewSourceCommand,
  ReviewSourceOrigin,
} from '../../data/suggestions/index.js';
import type { BoardSuggestionsSurfaceProps, SuggestionNotice } from './contracts.js';
import { requestFailure } from './review-messages.js';

interface PendingAttachment {
  readonly command: ReviewSourceCommand;
  readonly reference?: AttachedReviewSource;
}

type AttachmentOptions = Pick<
  BoardSuggestionsSurfaceProps,
  'boardId' | 'revision' | 'service' | 'createCommandId' | 'onAttachSource' | 'attachmentMode'
>;

export function useReviewAttachment({
  boardId,
  revision,
  service,
  createCommandId,
  onAttachSource,
  attachmentMode = 'context',
}: AttachmentOptions) {
  const active = useRef<AbortController>(undefined);
  const [pending, setPending] = useState<PendingAttachment>();
  const [notice, setNotice] = useState<SuggestionNotice>();
  const [busy, setBusy] = useState(false);

  useEffect(() => () => active.current?.abort(), []);

  async function attach(work: PendingAttachment, controller: AbortController) {
    try {
      const source =
        work.reference ?? (await service.createReviewSource(work.command, controller.signal));
      controller.signal.throwIfAborted();
      const { sourceId, capturedBoardRevision, targetsBoardRevision, targets } = source;
      const reference = { sourceId, capturedBoardRevision, targetsBoardRevision, targets };
      setPending({ ...work, reference });
      await onAttachSource?.(reference);
      if (!controller.signal.aborted) {
        setPending(undefined);
        const message =
          attachmentMode === 'copy' ? '已复制冻结来源引用。' : '已附加冻结来源，可在对话中发送。';
        setNotice({ tone: 'success', message });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setNotice({ tone: 'error', message: requestFailure(error, '附加未确认，可重试此来源。') });
      }
    } finally {
      if (!controller.signal.aborted) {
        active.current = undefined;
        setBusy(false);
      }
    }
  }

  function start(work: PendingAttachment) {
    if (active.current || !onAttachSource) {
      return;
    }

    const controller = new AbortController();
    active.current = controller;
    setPending(work);
    setNotice(undefined);
    setBusy(true);
    attach(work, controller).catch((error: unknown) =>
      setNotice({ tone: 'error', message: requestFailure(error, '附加来源失败。') }),
    );
  }

  function requestAttachment(origin: ReviewSourceOrigin) {
    if (!pending) {
      try {
        const expectedBoardRevision = origin.kind === 'selection' ? revision : undefined;
        start({
          command: { boardId, commandId: createCommandId(), origin, expectedBoardRevision },
        });
      } catch (error) {
        setNotice({ tone: 'error', message: requestFailure(error, '无法创建附加命令。') });
      }
    }
  }

  function retry() {
    if (pending) {
      start(pending);
    }
  }

  function dismiss() {
    if (!active.current) {
      setPending(undefined);
      setNotice(undefined);
    }
  }

  return { pending, notice, busy, requestAttachment, retry, dismiss };
}
