import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent } from 'react';
import { Check, Lightbulb, Loader2, RotateCcw, X } from 'lucide-react';
import { STUDIO_TOOLS, type Feedback, type StudioClient } from '../../../contracts/studio';
import type { ProposalOperation, ProposalOption } from '../../../contracts/proposals';
import type { StudioDocument } from '../../product-contract';
import { newClientId } from '../../shared/client-id.js';
import './suggestion.css';

export interface SuggestionPanelProps<Document extends StudioDocument = StudioDocument> {
  feedback: Feedback;
  client: StudioClient;
  artifactId: string;
  onChanged: (document: Document) => void;
  onPreview: (operations: ProposalOperation[] | null) => void;
  onRefresh: () => void | Promise<void>;
  onError: (error: unknown) => void;
}

export function SuggestionPanel<Document extends StudioDocument = StudioDocument>({
  feedback,
  client,
  artifactId,
  onChanged,
  onPreview,
  onRefresh,
  onError,
}: SuggestionPanelProps<Document>) {
  const proposal = feedback.proposal;
  const expiresAt = proposal?.expiresAt;
  const expirationKey = JSON.stringify([artifactId, feedback.id, expiresAt]);
  const [busy, setBusy] = useState<string | null>(null);
  const [expiredKey, setExpiredKey] = useState<string>();
  const interaction = useRef(false);
  const card = useRef<HTMLElement>(null);
  const callbacks = useRef({ onChanged, onPreview, onRefresh, onError });
  useLayoutEffect(() => {
    callbacks.current = { onChanged, onPreview, onRefresh, onError };
  }, [onChanged, onPreview, onRefresh, onError]);

  useEffect(() => {
    if (!expiresAt) {
      return;
    }

    let clearing = false;
    const check = () => {
      const shouldDefer = document.visibilityState === 'hidden' || interaction.current;
      if (shouldDefer || Date.now() < Date.parse(expiresAt) || clearing) {
        return;
      }

      clearing = true;
      setExpiredKey(expirationKey);
      callbacks.current.onPreview(null);
      void client
        .call(STUDIO_TOOLS.feedback, { action: 'withdraw', artifactId, feedbackId: feedback.id })
        .then(() => callbacks.current.onRefresh())
        .catch((error) => {
          clearing = false;
          callbacks.current.onError(error);
        });
    };

    check();
    const timer = window.setInterval(check, 1000);
    document.addEventListener('visibilitychange', check);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      callbacks.current.onPreview(null);
    };
  }, [artifactId, client, feedback.id, expiresAt, expirationKey]);

  async function choose(optionId?: string) {
    if (busy || !proposal) {
      return;
    }

    setBusy(optionId ?? 'clear');
    callbacks.current.onPreview(null);
    try {
      const result = await client.call<{
        feedback: Feedback[];
        board?: Document;
        document?: Document;
      }>(STUDIO_TOOLS.feedback, {
        action: optionId ? 'choose' : 'withdraw',
        artifactId,
        feedbackId: feedback.id,
        ...(optionId ? { optionId } : {}),
        operationId: newClientId(),
      });
      const changed = result.document ?? result.board;
      if (changed) {
        callbacks.current.onChanged(changed);
      }

      await callbacks.current.onRefresh();
    } catch (error) {
      callbacks.current.onError(error);
      await callbacks.current.onRefresh();
    } finally {
      setBusy(null);
    }
  }

  function handleInteraction() {
    interaction.current = true;
  }

  function handlePointerLeave() {
    interaction.current = !!card.current?.contains(document.activeElement);
    callbacks.current.onPreview(null);
  }

  function handleBlur(event: FocusEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      interaction.current = false;
      callbacks.current.onPreview(null);
    }
  }

  function handlePreviewOption(option: ProposalOption) {
    if (!busy) {
      callbacks.current.onPreview(option.active ? null : option.operations);
    }
  }

  function handleChoose(optionId?: string) {
    void choose(optionId).catch((error) => callbacks.current.onError(error));
  }

  if (!proposal || expiredKey === expirationKey) {
    return null;
  }

  return (
    <article
      ref={card}
      className="studio-feedback-item studio-suggestion"
      data-feedback-id={feedback.id}
      onMouseEnter={handleInteraction}
      onMouseLeave={handlePointerLeave}
      onFocus={handleInteraction}
      onBlur={handleBlur}
    >
      <div className="studio-feedback-meta">
        <strong>
          <Lightbulb size={15} />
          私人建议
        </strong>
        <button
          type="button"
          className="studio-icon-button"
          aria-label="清除建议，保留已应用内容"
          disabled={!!busy}
          onClick={() => handleChoose()}
        >
          <X size={15} />
        </button>
      </div>
      <p className="studio-feedback-message">{feedback.text}</p>
      <div className="studio-suggestion-options" role="group" aria-label="选择建议方案">
        {proposal.options.map((option) => {
          const OptionIcon = option.active ? Check : Lightbulb;

          return (
            <button
              type="button"
              key={option.id}
              className={`studio-button studio-suggestion-option${option.active ? ' is-active' : ''}`}
              aria-pressed={option.active}
              disabled={!!busy}
              aria-describedby={
                option.description ? `${feedback.id}-${option.id}-description` : undefined
              }
              onMouseEnter={() => handlePreviewOption(option)}
              onMouseLeave={() => callbacks.current.onPreview(null)}
              onFocus={() => handlePreviewOption(option)}
              onBlur={() => callbacks.current.onPreview(null)}
              onClick={() => handleChoose(option.id)}
            >
              {busy === option.id ? (
                <Loader2 size={15} className="studio-spin" />
              ) : (
                <OptionIcon size={15} />
              )}
              <span>
                <strong>{option.label}</strong>
                {option.description && (
                  <small id={`${feedback.id}-${option.id}-description`}>{option.description}</small>
                )}
              </span>
              {option.active && <RotateCcw size={14} aria-label="再次点击可安全撤回" />}
            </button>
          );
        })}
      </div>
      <small className="studio-source-version">
        仅自己可见 · 悬停预览，点击应用，再次点击安全撤回
      </small>
    </article>
  );
}
