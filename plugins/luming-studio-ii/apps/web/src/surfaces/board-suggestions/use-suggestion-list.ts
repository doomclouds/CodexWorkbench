import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { BoardSuggestionPage, SuggestionService } from '../../data/suggestions/index.js';
import { requestFailure } from './review-messages.js';

const pageLimit = 20;

export function useSuggestionList(boardId: string, active: boolean, service: SuggestionService) {
  const [snapshot, setSnapshot] = useState<BoardSuggestionPage>();
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string>();
  const request = useRef<AbortController>(undefined);

  async function load(cursor?: string) {
    request.current?.abort();
    const current = new AbortController();
    request.current = current;
    try {
      const result = await service.listSuggestions(
        { boardId, limit: pageLimit, beforeProposalId: cursor },
        current.signal,
      );

      if (!current.signal.aborted) {
        setFailure(undefined);
        setSnapshot((previous) => {
          if (!previous || !cursor) {
            return result;
          }

          const proposals = new Map(previous.proposals.map((item) => [item.proposalId, item]));
          for (const suggestion of result.proposals) {
            proposals.set(suggestion.proposalId, suggestion);
          }

          return {
            proposals: [...proposals.values()],
            nextBeforeProposalId: result.nextBeforeProposalId,
          };
        });
      }
    } catch (error) {
      if (!current.signal.aborted) {
        setFailure(requestFailure(error, '读取建议失败。'));
      }
    } finally {
      if (!current.signal.aborted) {
        setLoading(false);
      }
    }
  }

  function readSuggestions(cursor?: string) {
    load(cursor).catch((error: unknown) => setFailure(requestFailure(error, '读取建议失败。')));
  }

  function requestRead(cursor?: string) {
    setLoading(true);
    setFailure(undefined);
    readSuggestions(cursor);
  }

  const loadOnOpen = useEffectEvent(readSuggestions);
  useEffect(() => {
    const lifetime = new AbortController();
    if (active) {
      queueMicrotask(() => {
        if (!lifetime.signal.aborted) {
          loadOnOpen();
        }
      });
    }

    return () => {
      lifetime.abort();
      request.current?.abort();
    };
  }, [active, boardId, service]);

  return { snapshot, loading, failure, requestRead };
}
