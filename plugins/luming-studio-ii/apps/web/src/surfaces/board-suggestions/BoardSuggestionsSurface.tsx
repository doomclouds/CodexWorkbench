import { Lightbulb, X } from 'lucide-react';
import { useEffect, useEffectEvent, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
type SuggestionPreview = ReturnType<typeof useSuggestionPreview>;

function SuggestionReadStatus({
  list,
  showEmpty,
}: {
  readonly list: SuggestionList;
  readonly showEmpty: boolean;
}) {
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

  return showEmpty && snapshot.proposals.length === 0 ? (
    <StatusText message="暂无私人建议。" />
  ) : null;
}

function SuggestionResults({
  list,
  preview,
  showEmpty,
  renderCard,
}: {
  readonly list: SuggestionList;
  readonly preview: SuggestionPreview;
  readonly showEmpty: boolean;
  readonly renderCard: (suggestion: BoardSuggestion) => ReactNode;
}) {
  const cursor = list.snapshot?.nextBeforeProposalId;

  return (
    <>
      <SuggestionReadStatus list={list} showEmpty={showEmpty} />
      {preview.failure && (
        <StatusText message={preview.failure} tone="error" announcement="polite" />
      )}
      {preview.loading && <StatusText message="正在读取方案预览…" announcement="polite" busy />}
      <div className="board-suggestion-panel__list">{list.snapshot?.proposals.map(renderCard)}</div>
      {cursor && (
        <Button
          label="更多建议"
          disabled={list.loading}
          onActivate={() => list.requestRead(cursor)}
        />
      )}
    </>
  );
}

interface SuggestionLayoutProps extends Pick<
  BoardSuggestionsSurfaceProps,
  'inline' | 'anchor' | 'restoreFocus'
> {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly overlay: ReactNode;
}

function SuggestionLayout({
  inline,
  anchor,
  restoreFocus,
  open,
  onClose,
  children,
  overlay,
}: SuggestionLayoutProps) {
  const closeButton = useRef<ButtonHandle>(null);
  if (inline) {
    return (
      <>
        {inline.outlet &&
          createPortal(
            <section className="board-suggestion-panel board-suggestion-panel--inline">
              {children}
            </section>,
            inline.outlet,
          )}
        {inline.previewHost && overlay && createPortal(overlay, inline.previewHost)}
      </>
    );
  }

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
        onRequestClose={onClose}
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
              onActivate={onClose}
            />
          </header>
          {children}
        </section>
      </AnchoredPopover>
      {overlay}
    </>
  );
}

function SuggestionReviewSurface(props: BoardSuggestionsSurfaceProps) {
  const { anchor, boardId, service, onRequestClose, restoreFocus, renderPreview, inline } = props;
  const open = inline ? inline.outlet !== null : anchor !== null;
  const showCards = inline?.showCards ?? true;
  const active = open && showCards;
  const list = useSuggestionList(boardId, active, service, props.updateKey);
  const refresh = () => list.requestRead();
  const preview = useSuggestionPreview({ boardId, service, active, refresh });
  const decision = useSuggestionDecision({ ...props, refresh });
  const attachment = useReviewAttachment(props);
  const busy = Boolean(decision.recovery) || list.loading || list.failure !== undefined;
  const hasPreviewHost = !inline || inline.previewHost !== null;
  const previewEnabled = renderPreview !== undefined && hasPreviewHost;
  const previewVisible = active && preview.frame !== undefined && previewEnabled;
  const hasCards = list.snapshot?.proposals.some((item) => !item.rejected) === true;
  const reportPreview = useEffectEvent((active: boolean) => props.onPreviewChange?.(active));
  const reportCards = useEffectEvent((visible: boolean) => inline?.onCardsVisibleChange(visible));

  useEffect(() => {
    if (previewVisible) {
      reportPreview(true);
      return () => reportPreview(false);
    }
  }, [previewVisible]);

  useEffect(() => {
    reportCards(active && hasCards);
  }, [active, hasCards]);

  function handleClose() {
    preview.dismiss();
    onRequestClose();
  }

  function decide(suggestion: BoardSuggestion, optionId?: string) {
    preview.dismiss();
    decision.handleDecide(suggestion, optionId);
  }

  function renderCard(suggestion: BoardSuggestion) {
    return (
      <SuggestionCard
        key={suggestion.proposalId}
        suggestion={suggestion}
        busy={busy}
        onPreview={
          previewEnabled ? (optionId) => preview.requestPreview(suggestion, optionId) : undefined
        }
        onEndPreview={preview.dismiss}
        onChoose={(optionId) => decide(suggestion, optionId)}
      />
    );
  }

  const overlay = previewVisible && preview.frame && renderPreview && (
    <section className="board-suggestion-preview" aria-label="只读方案预览">
      <header className="board-suggestion-preview__header">
        <span>只读方案预览</span>
      </header>
      <div className="board-suggestion-preview__canvas">{renderPreview(preview.frame)}</div>
    </section>
  );

  return (
    <SuggestionLayout
      inline={inline}
      anchor={anchor}
      restoreFocus={restoreFocus}
      open={open}
      onClose={handleClose}
      overlay={overlay}
    >
      <SuggestionAttachment {...props} attachment={attachment} />
      <ReviewRecovery decision={decision} />
      {active && (
        <SuggestionResults
          list={list}
          preview={preview}
          showEmpty={!inline}
          renderCard={renderCard}
        />
      )}
    </SuggestionLayout>
  );
}

export function BoardSuggestionsSurface(props: BoardSuggestionsSurfaceProps) {
  return <SuggestionReviewSurface key={props.boardId} {...props} />;
}
