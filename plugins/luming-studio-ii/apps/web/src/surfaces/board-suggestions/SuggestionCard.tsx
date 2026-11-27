import { Check, Lightbulb } from 'lucide-react';
import { useId } from 'react';
import type { BoardSuggestion, BoardSuggestionOption } from '../../data/suggestions/index.js';
import { Button } from '../../ui/base/index.js';

interface SuggestionCardProps {
  readonly suggestion: BoardSuggestion;
  readonly chosenOption?: string;
  readonly busy: boolean;
  readonly previewEnabled: boolean;
  readonly onSelect: (optionId: string) => void;
  readonly onPreview: (optionId: string) => void;
  readonly onAccept: (optionId: string) => void;
  readonly onReject: () => void;
}

function SuggestionChoice({
  option,
  chosen,
  busy,
  onSelect,
}: {
  readonly option: BoardSuggestionOption;
  readonly chosen: boolean;
  readonly busy: boolean;
  readonly onSelect: (optionId: string) => void;
}) {
  const descriptionId = useId();
  const Icon = chosen ? Check : Lightbulb;

  return (
    <button
      type="button"
      className="board-suggestion-option"
      aria-pressed={chosen}
      aria-describedby={option.description ? descriptionId : undefined}
      disabled={busy}
      onClick={() => onSelect(option.optionId)}
    >
      <span className="board-suggestion-option__label">
        <Icon size={14} aria-hidden="true" />
        {option.label}
      </span>
      {option.description && <span id={descriptionId}>{option.description}</span>}
    </button>
  );
}

export function SuggestionCard({
  suggestion,
  chosenOption,
  busy,
  previewEnabled,
  onSelect,
  onPreview,
  onAccept,
  onReject,
}: SuggestionCardProps) {
  const accepted = suggestion.options.find(
    ({ optionId }) => optionId === suggestion.acceptedOptionId,
  );
  const resolved = suggestion.rejected || Boolean(suggestion.acceptedOptionId);
  const option = suggestion.options.find(({ optionId }) => optionId === chosenOption);

  return (
    <article className="board-suggestion-card" aria-label="私人建议">
      <p className="board-suggestion-card__observation">{suggestion.observation}</p>
      {resolved ? (
        <p className="board-suggestion-card__state">
          {suggestion.rejected ? '已拒绝' : '已采用 ' + (accepted?.label ?? '所选方案')}
        </p>
      ) : (
        <>
          <div className="board-suggestion-options" role="group" aria-label="选择建议方案">
            {suggestion.options.map((choice) => (
              <SuggestionChoice
                key={choice.optionId}
                option={choice}
                chosen={chosenOption === choice.optionId}
                busy={busy}
                onSelect={onSelect}
              />
            ))}
          </div>
          <div className="board-suggestion-card__actions">
            {previewEnabled && (
              <Button
                label="预览所选方案"
                disabled={busy || !option}
                onActivate={option ? () => onPreview(option.optionId) : undefined}
              />
            )}
            <Button label="拒绝建议" disabled={busy} onActivate={onReject} />
            <Button
              label="接受所选方案"
              variant="primary"
              disabled={busy || !option}
              onActivate={option ? () => onAccept(option.optionId) : undefined}
            />
          </div>
        </>
      )}
    </article>
  );
}
