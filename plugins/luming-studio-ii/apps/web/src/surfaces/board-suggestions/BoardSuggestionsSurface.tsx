import { Lightbulb, X } from 'lucide-react';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { BoardSuggestion } from '../../data/suggestions/index.js';
import { AnchoredPopover, Button, StatusText, type ButtonHandle } from '../../ui/base/index.js';
import type { BoardSuggestionsSurfaceProps } from './contracts.js';
import { SuggestionAttachment } from './SuggestionAttachment.js';
import { SuggestionCard } from './SuggestionCard.js';
import { useReviewAttachment } from './use-review-attachment.js';
import { useSuggestionDecision } from './use-suggestion-decision.js';
import { useSuggestionList } from './use-suggestion-list.js';
import { useSuggestionPreview } from './use-suggestion-preview.js';
import './board-suggestions.css';

type Decision = ReturnType<typeof useSuggestionDecision>;

function ReviewRecovery({ decision }: { readonly decision: Decision }) {
  const { action, recovery, handleCheck, handleRetry, notice } = decision;
  const busy = action !== undefined;

  return (
    <div className="board-suggestion-review">
      {busy && <StatusText message="正在确认审阅结果…" announcement="polite" busy />}
      {notice && <StatusText message={notice.message} tone={notice.tone} announcement="polite" />}
      {recovery && !busy && (
        <div className="board-suggestion-card__actions">
          {recovery.kind === 'accept' && <Button label="核对原回执" onActivate={handleCheck} />}
          <Button label="重试原命令" onActivate={handleRetry} />
        </div>
      )}
    </div>
  );
}

type SuggestionList = ReturnType<typeof useSuggestionList>;

function SuggestionReadStatus({ list }: { readonly list: SuggestionList }) {
  const { loading, failure, snapshot, requestRead } = list;
  if (failure) {
    return (
      <div className="board-suggestion-review">
        <StatusText message={failure} tone="error" announcement="polite" />
        <Button label="重新读取建议" onActivate={() => requestRead()} />
      </div>
    );
  }
  if (loading || !snapshot) {
    return <StatusText message="正在读取私人建议…" announcement="polite" busy />;
  }

  return snapshot.proposals.length === 0 ? <StatusText message="暂无私人建议。" /> : null;
}

interface SuggestionChoiceState {
  readonly proposalId: string;
  readonly proposalVersion: bigint;
  readonly optionId: string;
}

function SuggestionReviewSurface(props: BoardSuggestionsSurfaceProps) {
  const { anchor, boardId, service, onRequestClose, restoreFocus, renderPreview } = props;
  const open = anchor !== null;
  const closeButton = useRef<ButtonHandle>(null);
  const [choice, setChoice] = useState<SuggestionChoiceState>();
  const [reviewed, setReviewed] = useState<ReadonlySet<string>>(() => new Set());
  const list = useSuggestionList(boardId, open, service);
  const refresh = () => list.requestRead();
  const preview = useSuggestionPreview({ boardId, service, active: open, refresh });
  const decision = useSuggestionDecision({ ...props, refresh, onReviewed: handleReviewed });
  const attachment = useReviewAttachment(props);
  const busy = Boolean(decision.recovery) || preview.loading;
  const previewEnabled = renderPreview !== undefined;
  const previewVisible = open && preview.frame !== undefined && previewEnabled;
  const reportPreview = useEffectEvent((active: boolean) => props.onPreviewChange?.(active));

  useEffect(() => {
    if (previewVisible) {
      reportPreview(true);
      return () => reportPreview(false);
    }
  }, [previewVisible]);

  function handleReviewed(proposalId: string) {
    setReviewed((current) => new Set([...current, proposalId]));
    setChoice(undefined);
  }

  function handleClose() {
    preview.dismiss();
    onRequestClose();
  }

  function decide(suggestion: BoardSuggestion, optionId?: string) {
    preview.dismiss();
    decision.handleDecide(suggestion, optionId);
  }

  function renderCard(suggestion: BoardSuggestion) {
    const { proposalId, proposalVersion } = suggestion;
    const awaitingRefresh = reviewed.has(proposalId);
    const chosen = choice?.proposalId === proposalId && choice.proposalVersion === proposalVersion;

    return (
      <SuggestionCard
        key={proposalId}
        suggestion={suggestion}
        chosenOption={chosen ? choice.optionId : undefined}
        busy={busy || awaitingRefresh}
        previewEnabled={previewEnabled}
        onSelect={(optionId) => {
          preview.dismiss();
          setChoice({ proposalId, proposalVersion, optionId });
        }}
        onPreview={(optionId) => preview.requestPreview(suggestion, optionId)}
        onAccept={(optionId) => decide(suggestion, optionId)}
        onReject={() => decide(suggestion)}
      />
    );
  }

  const cursor = list.snapshot?.nextBeforeProposalId;

  return (
    <>
      <AnchoredPopover
        open={open}
        anchor={anchor}
        label="私人建议"
        placement="bottom"
        align="end"
        initialFocus={() => closeButton.current?.focus()}
        restoreFocus={restoreFocus}
        onRequestClose={handleClose}
      >
        <section className="board-suggestion-panel">
          <header className="board-suggestion-panel__header">
            <h2>
              <Lightbulb size={16} aria-hidden="true" />
              私人建议
            </h2>
            <Button
              ref={closeButton}
              label="关闭建议"
              iconOnly
              icon={<X size={14} />}
              onActivate={handleClose}
            />
          </header>
          <SuggestionAttachment {...props} attachment={attachment} />
          <ReviewRecovery decision={decision} />
          <SuggestionReadStatus list={list} />
          {preview.failure && (
            <StatusText message={preview.failure} tone="error" announcement="polite" />
          )}
          {preview.loading && <StatusText message="正在读取方案预览…" announcement="polite" busy />}
          <div className="board-suggestion-panel__list">
            {list.snapshot?.proposals.map(renderCard)}
          </div>
          {cursor && (
            <Button
              label="更多建议"
              disabled={list.loading}
              onActivate={() => list.requestRead(cursor)}
            />
          )}
        </section>
      </AnchoredPopover>
      {open && preview.frame && renderPreview && (
        <section className="board-suggestion-preview" aria-label="只读方案预览">
          <header className="board-suggestion-preview__header">
            <span>只读方案预览</span>
            <Button label="退出方案预览" onActivate={preview.dismiss} />
          </header>
          <div className="board-suggestion-preview__canvas">{renderPreview(preview.frame)}</div>
        </section>
      )}
    </>
  );
}

export function BoardSuggestionsSurface(props: BoardSuggestionsSurfaceProps) {
  return <SuggestionReviewSurface key={props.boardId} {...props} />;
}
