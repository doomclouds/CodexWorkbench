import { ArrowUp } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent, SyntheticEvent } from 'react';
import { Button, StatusText } from '../../ui/base/index.js';

interface FeedbackComposerProps {
  readonly label: string;
  readonly submitLabel: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onCancel?: () => void;
  readonly disabled: boolean;
  readonly cancelDisabled?: boolean;
  readonly focusOnMount?: boolean;
  readonly variant?: 'create' | 'reply' | 'edit';
  readonly resolved?: boolean;
  readonly attachment?: {
    readonly checked: boolean;
    readonly label: string;
    readonly disabled: boolean;
    readonly onChange: (checked: boolean) => void;
  };
}

const maximumFeedbackLength = 16_000;

export function FeedbackComposer({
  label,
  submitLabel,
  value,
  onChange,
  onSubmit,
  onCancel,
  disabled,
  cancelDisabled = disabled,
  focusOnMount,
  variant = 'create',
  resolved = false,
  attachment,
}: FeedbackComposerProps) {
  const input = useRef<HTMLTextAreaElement>(null);
  const length = value.trim().length;
  const tooLong = length > maximumFeedbackLength;
  const ready = length > 0 && !tooLong && !disabled;
  const editing = variant === 'edit';
  const placeholder = variant === 'reply' && resolved ? '回复以重新打开…' : placeholders[variant];

  useLayoutEffect(() => {
    if (focusOnMount) {
      input.current?.focus({ preventScroll: true });
    }
  }, [focusOnMount]);

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (ready) {
      onSubmit();
    }
  }

  function handleSubmitKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) {
      return;
    }

    if (editing && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!cancelDisabled) {
        onCancel?.();
      }

      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !editing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <form className="whiteboard-feedback__composer" data-variant={variant} onSubmit={handleSubmit}>
      <textarea
        ref={input}
        aria-label={label}
        placeholder={placeholder}
        value={value}
        rows={composerRows[variant]}
        disabled={disabled}
        maxLength={maximumFeedbackLength}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={handleSubmitKey}
      />
      {tooLong && (
        <StatusText message="备注内容最多 16000 个字符。" tone="error" announcement="assertive" />
      )}
      <div className="whiteboard-feedback__composer-footer">
        {attachment && (
          <label className="whiteboard-feedback__composer-attachment">
            <input
              type="checkbox"
              checked={attachment.checked}
              disabled={disabled || attachment.disabled}
              onChange={(event) => attachment.onChange(event.currentTarget.checked)}
            />
            {attachment.label}
          </label>
        )}
        {onCancel && (
          <Button label="取消" variant="ghost" onActivate={onCancel} disabled={cancelDisabled} />
        )}
        {editing ? (
          <Button label={submitLabel} variant="primary" type="submit" disabled={!ready} />
        ) : (
          <button
            type="submit"
            className="whiteboard-feedback__icon whiteboard-feedback__submit"
            aria-label={submitLabel}
            title={submitLabel}
            disabled={!ready}
          >
            <ArrowUp size={20} />
          </button>
        )}
      </div>
    </form>
  );
}

const placeholders = { create: '添加备注…', reply: '回复…', edit: '' };
const composerRows = { create: 2, reply: 1, edit: 3 };
