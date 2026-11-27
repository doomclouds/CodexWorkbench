import { useEffect, useRef, useState } from 'react';
import type {
  AcceptSuggestionCommand,
  BoardSuggestion,
  RejectSuggestionCommand,
  SuggestionReviewReceipt,
  SuggestionService,
} from '../../data/suggestions/index.js';
import type { BoardSuggestionsSurfaceProps, SuggestionNotice } from './contracts.js';
import { rejectionMessage, requestFailure, reviewConflict } from './review-messages.js';

type Decision =
  | {
      readonly kind: 'accept';
      readonly command: AcceptSuggestionCommand;
      readonly wasActive: boolean;
    }
  | { readonly kind: 'reject'; readonly command: RejectSuggestionCommand };

type ReviewAction = 'submit' | 'check' | 'retry';

interface ReviewAttempt {
  readonly controller: AbortController;
  readonly decision: Decision;
  readonly action: ReviewAction;
}

type ReviewResult =
  | { readonly kind: 'accept'; readonly receipt?: SuggestionReviewReceipt }
  | { readonly kind: 'reject' };

interface DecisionOptions extends Pick<
  BoardSuggestionsSurfaceProps,
  'boardId' | 'service' | 'createCommandId' | 'onApplied'
> {
  readonly refresh: () => void;
}

async function checkAcceptance(
  service: SuggestionService,
  { boardId, commandId }: AcceptSuggestionCommand,
  signal: AbortSignal,
) {
  const receipt = await service.getAcceptReceipt(boardId, commandId, signal);
  signal.throwIfAborted();
  if (receipt?.kind === 'rejected' && receipt.reason === 'forbidden') {
    throw new Error('当前身份无法核对原接受回执。');
  }

  return receipt;
}

async function runAcceptance(
  service: SuggestionService,
  command: AcceptSuggestionCommand,
  action: ReviewAction,
  signal: AbortSignal,
) {
  if (action === 'check') {
    return checkAcceptance(service, command, signal);
  }

  if (action === 'retry') {
    const recorded = await checkAcceptance(service, command, signal);
    if (recorded) {
      return recorded;
    }
  }

  try {
    signal.throwIfAborted();
    return await service.acceptSuggestion(command, signal);
  } catch (error) {
    signal.throwIfAborted();
    const recorded = await checkAcceptance(service, command, signal);
    if (recorded) {
      return recorded;
    }

    throw error;
  }
}

async function review(
  service: SuggestionService,
  { controller: { signal }, decision, action }: ReviewAttempt,
): Promise<ReviewResult> {
  if (decision.kind === 'reject') {
    await service.rejectSuggestion(decision.command, signal);

    return { kind: 'reject' };
  }

  return {
    kind: 'accept',
    receipt: await runAcceptance(service, decision.command, action, signal),
  };
}

export function useSuggestionDecision({
  boardId,
  service,
  createCommandId,
  onApplied,
  refresh,
}: DecisionOptions) {
  const active = useRef<ReviewAttempt>(undefined);
  const [recovery, setRecovery] = useState<Decision>();
  const [action, setAction] = useState<ReviewAction>();
  const [notice, setNotice] = useState<SuggestionNotice>();

  useEffect(() => () => active.current?.controller.abort(), []);

  function finish(attempt: ReviewAttempt): boolean {
    if (active.current !== attempt || attempt.controller.signal.aborted) {
      return false;
    }

    active.current = undefined;
    setAction(undefined);

    return true;
  }

  function acceptResult(receipt: SuggestionReviewReceipt, wasActive: boolean) {
    setRecovery(undefined);
    if (receipt.kind === 'applied') {
      setNotice({
        tone: 'success',
        message: wasActive ? '已撤回方案并保存白板。' : '已应用方案并保存白板。',
      });
      onApplied(receipt);
      refresh();
      return;
    }

    setNotice({
      tone: 'error',
      message: receipt.kind === 'conflict' ? reviewConflict : rejectionMessage(receipt.reason),
    });
    refresh();
  }

  function handleResult(attempt: ReviewAttempt, result: ReviewResult) {
    if (!finish(attempt)) {
      return;
    }

    const { decision } = attempt;
    if (result.kind === 'reject') {
      setRecovery(undefined);
      setNotice({ tone: 'success', message: '已清除建议，保留已应用内容。' });
      refresh();
      return;
    }
    if (!result.receipt) {
      setNotice({ tone: 'error', message: '尚未查到原命令回执。' });
      return;
    }

    acceptResult(result.receipt, decision.kind === 'accept' && decision.wasActive);
  }

  function handleFailure(attempt: ReviewAttempt, error: unknown) {
    if (attempt.controller.signal.aborted) {
      return;
    }

    const unknown = finish(attempt);
    setNotice({
      tone: 'error',
      message: requestFailure(error, unknown ? '审阅结果待确认。' : '审阅已确认，界面未能更新。'),
    });
  }

  function start(decision: Decision, nextAction: ReviewAction) {
    if (active.current) {
      return;
    }

    const attempt = { controller: new AbortController(), decision, action: nextAction };
    active.current = attempt;
    setRecovery(decision);
    setAction(nextAction);
    setNotice(undefined);
    review(service, attempt)
      .then((result) => handleResult(attempt, result))
      .catch((error: unknown) => handleFailure(attempt, error));
  }

  function handleDecide(proposal: BoardSuggestion, optionId?: string) {
    if (active.current || recovery || proposal.rejected) {
      return;
    }

    try {
      const commandId = createCommandId();
      const command = {
        boardId,
        commandId,
        proposalId: proposal.proposalId,
        expectedProposalVersion: proposal.proposalVersion,
      };
      const decision: Decision = optionId
        ? {
            kind: 'accept',
            command: { ...command, optionId },
            wasActive: proposal.activeOptionIds.includes(optionId),
          }
        : { kind: 'reject', command };
      start(decision, 'submit');
    } catch (error) {
      setNotice({ tone: 'error', message: requestFailure(error, '无法创建审阅命令。') });
    }
  }

  function handleCheck() {
    if (recovery?.kind === 'accept') {
      start(recovery, 'check');
    }
  }

  function handleRetry() {
    if (recovery) {
      start(recovery, 'retry');
    }
  }

  return { action, recovery, notice, handleDecide, handleCheck, handleRetry };
}
