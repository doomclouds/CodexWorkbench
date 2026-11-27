import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type {
  BoardSuggestion,
  SuggestionPreviewFrame,
  SuggestionService,
} from '../../data/suggestions/index.js';
import { rejectionMessage, requestFailure, reviewConflict } from './review-messages.js';

interface PreviewOptions {
  readonly boardId: string;
  readonly service: SuggestionService;
  readonly active: boolean;
  readonly refresh: () => void;
}

export function useSuggestionPreview({ boardId, service, active, refresh }: PreviewOptions) {
  const request = useRef<AbortController>(undefined);
  const [frame, setFrame] = useState<SuggestionPreviewFrame>();
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string>();

  function dismiss() {
    request.current?.abort();
    request.current = undefined;
    setFrame(undefined);
    setFailure(undefined);
    setLoading(false);
  }

  const closeOnHide = useEffectEvent(dismiss);
  useEffect(() => {
    const lifetime = new AbortController();
    if (!active) {
      queueMicrotask(() => {
        if (!lifetime.signal.aborted) {
          closeOnHide();
        }
      });
    }

    return () => {
      lifetime.abort();
      request.current?.abort();
    };
  }, [active, boardId, service]);

  async function show(proposal: BoardSuggestion, optionId: string) {
    dismiss();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const result = await service.previewSuggestion(
        {
          boardId,
          proposalId: proposal.proposalId,
          optionId,
          expectedProposalVersion: proposal.proposalVersion,
        },
        controller.signal,
      );

      if (controller.signal.aborted) {
        return;
      }

      if (result.kind === 'preview') {
        setFrame(result.frame);
      } else if (result.kind === 'conflict') {
        setFailure(reviewConflict);
        refresh();
      } else {
        setFailure(rejectionMessage(result.reason));
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setFailure(requestFailure(error, '打开预览失败。'));
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }

  function requestPreview(proposal: BoardSuggestion, optionId: string) {
    show(proposal, optionId).catch((error: unknown) =>
      setFailure(requestFailure(error, '打开预览失败。')),
    );
  }

  return { frame, loading, failure, requestPreview, dismiss };
}
