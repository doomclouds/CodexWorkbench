import { useEffect, useRef, useState } from 'react';
import { Check, Lightbulb, Loader2, RotateCcw, X } from 'lucide-react';
import type { Feedback, StudioClient } from '../contracts/studio';
import type { ProposalOperation } from '../contracts/proposals';
import type { StudioDocument } from './products';

export interface SuggestionPanelProps<Document extends StudioDocument = StudioDocument> {
  feedback: Feedback;
  client: StudioClient;
  artifactId: string;
  onChanged: (document: Document) => void;
  onPreview: (operations: ProposalOperation[] | null) => void;
  onRefresh: () => void | Promise<void>;
  onError: (error: unknown) => void;
}

/** Cards show only the intent of a private option; source and operations stay out of the UI. */
export function SuggestionPanel<Document extends StudioDocument = StudioDocument>({ feedback, client, artifactId, onChanged, onPreview, onRefresh, onError }: SuggestionPanelProps<Document>) {
  const proposal = feedback.proposal;
  const [busy, setBusy] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const interaction = useRef(false), clearing = useRef(false), card = useRef<HTMLElement>(null);
  const callbacks = useRef({ onChanged, onPreview, onRefresh, onError });
  callbacks.current = { onChanged, onPreview, onRefresh, onError };

  useEffect(() => {
    setExpired(false); clearing.current = false;
    if (!proposal) return;
    const check = () => {
      if (document.visibilityState === 'hidden' || interaction.current || Date.now() < Date.parse(proposal.expiresAt) || clearing.current) return;
      clearing.current = true; setExpired(true); callbacks.current.onPreview(null);
      void client.call('artifact_feedback', { action: 'withdraw', artifactId, feedbackId: feedback.id }).then(() => callbacks.current.onRefresh()).catch(error => { clearing.current = false; callbacks.current.onError(error); });
    };
    check(); const timer = window.setInterval(check, 1000);
    document.addEventListener('visibilitychange', check);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', check); callbacks.current.onPreview(null); };
  }, [artifactId, client, feedback.id, proposal?.expiresAt]);

  async function choose(optionId?: string) {
    if (busy || !proposal) return;
    setBusy(optionId ?? 'clear'); callbacks.current.onPreview(null);
    try {
      const result = await client.call<{ feedback: Feedback[]; board?: Document; document?: Document }>('artifact_feedback', { action: optionId ? 'choose' : 'withdraw', artifactId, feedbackId: feedback.id, ...(optionId ? { optionId } : {}), operationId: crypto.randomUUID() });
      const changed = result.document ?? result.board;
      if (changed) callbacks.current.onChanged(changed);
      await callbacks.current.onRefresh();
    } catch (error) { callbacks.current.onError(error); await callbacks.current.onRefresh(); }
    finally { setBusy(null); }
  }

  if (!proposal || expired) return null;
  return <article ref={card} className="studio-feedback-item studio-suggestion" data-feedback-id={feedback.id}
    onMouseEnter={() => { interaction.current = true; }}
    onMouseLeave={() => { interaction.current = !!card.current?.contains(document.activeElement); callbacks.current.onPreview(null); }}
    onFocus={() => { interaction.current = true; }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { interaction.current = false; callbacks.current.onPreview(null); } }}>
    <div className="studio-feedback-meta"><strong><Lightbulb size={15} />私人建议</strong><button type="button" className="studio-icon-button" aria-label="清除建议，保留已应用内容" disabled={!!busy} onClick={() => void choose()}><X size={15} /></button></div>
    <p className="studio-feedback-message">{feedback.text}</p>
    <div className="studio-suggestion-options" role="group" aria-label="选择建议方案">
      {proposal.options.map(option => <button type="button" key={option.id} className={`studio-button studio-suggestion-option${option.active ? ' is-active' : ''}`} aria-pressed={option.active} disabled={!!busy} aria-describedby={option.description ? `${feedback.id}-${option.id}-description` : undefined}
        onMouseEnter={() => { if (!busy) callbacks.current.onPreview(option.active ? null : option.operations); }}
        onMouseLeave={() => callbacks.current.onPreview(null)}
        onFocus={() => { if (!busy) callbacks.current.onPreview(option.active ? null : option.operations); }}
        onBlur={() => callbacks.current.onPreview(null)}
        onClick={() => void choose(option.id)}>
        {busy === option.id ? <Loader2 size={15} className="studio-spin" /> : option.active ? <Check size={15} /> : <Lightbulb size={15} />}
        <span><strong>{option.label}</strong>{option.description && <small id={`${feedback.id}-${option.id}-description`}>{option.description}</small>}</span>
        {option.active && <RotateCcw size={14} aria-label="再次点击可安全撤回" />}
      </button>)}
    </div>
    <small className="studio-source-version">仅自己可见 · 悬停预览，点击应用，再次点击安全撤回</small>
  </article>;
}
