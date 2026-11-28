import { Check, Lightbulb, RotateCcw, X } from 'lucide-react';
import { useId } from 'react';
import type { BoardSuggestion, BoardSuggestionOption } from '../../data/suggestions/index.js';
import { Button } from '../../ui/base/index.js';

interface SuggestionCardProps {
  readonly suggestion: BoardSuggestion;
  readonly busy: boolean;
  readonly onPreview?: (optionId: string) => void;
  readonly onEndPreview: () => void;
  readonly onChoose: (optionId?: string) => void;
}

interface SuggestionOptionProps extends Omit<SuggestionCardProps, 'suggestion'> {
  readonly option: BoardSuggestionOption;
  readonly active: boolean;
}

function SuggestionOption({
  option,
  active,
  busy,
  onPreview,
  onEndPreview,
  onChoose,
}: SuggestionOptionProps) {
  const descriptionId = useId();
  const Icon = active ? Check : Lightbulb;
  const preview = !active && !busy && onPreview ? () => onPreview(option.optionId) : undefined;

  return (
    <button
      type="button"
      className="board-suggestion-option"
      aria-label={option.label}
      aria-pressed={active}
      aria-describedby={option.description ? descriptionId : undefined}
      disabled={busy}
      onMouseEnter={preview}
      onMouseLeave={onEndPreview}
      onFocus={preview}
      onBlur={onEndPreview}
      onClick={() => onChoose(option.optionId)}
    >
      <Icon size={15} aria-hidden="true" />
      <span className="board-suggestion-option__content">
        <strong>{option.label}</strong>
        {option.description && <small id={descriptionId}>{option.description}</small>}
      </span>
      {active && <RotateCcw size={14} aria-label="再次点击可安全撤回" />}
    </button>
  );
}

export function SuggestionCard({ suggestion, ...interactions }: SuggestionCardProps) {
  const { busy, onChoose, onPreview } = interactions;
  if (suggestion.rejected) {
    return null;
  }

  return (
    <article className="board-suggestion-card" aria-label="私人建议">
      <header className="board-suggestion-card__header">
        <strong>
          <Lightbulb size={15} aria-hidden="true" />
          私人建议
        </strong>
        <Button
          iconOnly
          icon={<X size={15} />}
          label="清除建议，保留已应用内容"
          tone="danger"
          disabled={busy}
          onActivate={() => onChoose()}
        />
      </header>
      <p className="board-suggestion-card__observation">{suggestion.observation}</p>
      <div className="board-suggestion-options" role="group" aria-label="选择建议方案">
        {suggestion.options.map((option) => (
          <SuggestionOption
            key={option.optionId}
            option={option}
            active={suggestion.activeOptionIds.includes(option.optionId)}
            {...interactions}
          />
        ))}
      </div>
      <small className="board-suggestion-card__hint">
        {onPreview
          ? '仅自己可见 · 悬停预览，点击应用，再次点击安全撤回'
          : '仅自己可见 · 点击应用，再次点击安全撤回'}
      </small>
    </article>
  );
}
