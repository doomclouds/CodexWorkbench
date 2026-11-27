import { useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, FocusEvent, KeyboardEvent, SyntheticEvent } from 'react';
import { digitPair, maxSeconds, minute, timerDigits, type Digits } from './timer-display.js';

type Field = 0 | 1;

const fields = [0, 1] as const;

function durationFrom(digits: Digits) {
  return Number(digits[0]) * minute + Number(digits[1]);
}

function withDigit(digits: Digits, field: Field, digit: string): Digits {
  return field === 0 ? [digit, digits[1]] : [digits[0], digit];
}

function readPastedTime(value: string): Digits | undefined {
  const match = /^\s*(\d{1,2})\s*[:.,]\s*([0-5]?\d)\s*$/u.exec(value);
  if (match) {
    return [digitPair(Number(match[1])), digitPair(Number(match[2]))];
  }
}

function adjacentField(field: Field): Field {
  return field === 0 ? 1 : 0;
}

function handleDigitSelect(event: SyntheticEvent<HTMLInputElement>) {
  const input = event.currentTarget;
  if (input.selectionStart !== input.selectionEnd) {
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

function spinDigits(digits: Digits, field: Field, direction: number): Digits {
  const value = Number(digits[field]) + direction;
  if (field === 0) {
    const empty = value === 0 && Number(digits[1]) === 0;
    if (value < 0 || value > 99 || empty) {
      return digits;
    }

    return withDigit(digits, field, digitPair(value));
  }

  const next = (value + minute) % minute;
  const adjusted =
    next === 0 && Number(digits[0]) === 0 ? (next + direction + minute) % minute : next;

  return withDigit(digits, field, digitPair(adjusted));
}

export function useTimerEntry(seconds: number, onDuration: (duration: number) => void) {
  const [draft, setDraft] = useState<Digits>();
  const [message, setMessage] = useState('');
  const inputs = useRef<[HTMLInputElement | null, HTMLInputElement | null]>([null, null]);
  const firstDigit = useRef(true);
  const digits = draft ?? timerDigits(seconds);

  function discard() {
    firstDigit.current = true;
    setDraft(undefined);
    setMessage('');
  }

  function finish(publish = true) {
    firstDigit.current = true;
    if (!draft) {
      return seconds;
    }

    const next = durationFrom(draft);
    if (next < 1 || next > maxSeconds) {
      setDraft(undefined);
      setMessage('计时时长至少为 1 秒。');
      return;
    }
    if (publish) {
      onDuration(next);
    }

    return next;
  }

  function focusField(field: Field) {
    inputs.current[field]?.focus();
  }

  function typeDigits(field: Field, source: string) {
    const value = source.normalize('NFKC');
    const pasted = readPastedTime(value);
    const separator = field === 0 && [':', '.', ','].includes(value);
    if (pasted || separator) {
      if (pasted) {
        setDraft(pasted);
      }
      firstDigit.current = true;
      focusField(1);
      return;
    }

    let next = digits;
    let index = field;
    for (const digit of value.replace(/\D/gu, '')) {
      const start = firstDigit.current;
      const text = start ? `0${digit}` : next[index].slice(-1) + digit;
      const complete = !start || (index === 1 && digit > '5');
      next = withDigit(next, index, text);
      firstDigit.current = complete;
      if (complete) {
        index = 1;
      }
    }

    if (next !== digits) {
      setMessage('');
      setDraft(next);
      if (index !== field) {
        focusField(index);
      }
    }
  }

  function handleChange(field: Field, event: ChangeEvent<HTMLInputElement>) {
    const input = event.nativeEvent as InputEvent;
    if (input.isComposing) {
      return;
    }

    if (input.inputType?.startsWith('delete')) {
      firstDigit.current = true;
      setDraft(withDigit(digits, field, '00'));
      return;
    }
    if (typeof input.data === 'string') {
      typeDigits(field, input.data);
      return;
    }

    const value = event.currentTarget.value.normalize('NFKC');
    if (/[:.,]/u.test(value)) {
      typeDigits(field, value);
    } else if (/^\d{0,2}$/u.test(value)) {
      const maximum = field === 0 ? 99 : 59;
      setDraft(withDigit(digits, field, digitPair(Math.min(maximum, Number(value)))));
      firstDigit.current = true;
    }
  }

  function handleKeyDown(field: Field, event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) {
      return;
    }

    const { key } = event;
    if (key === 'Enter') {
      event.preventDefault();
      finish();
      return;
    }
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      event.preventDefault();
      firstDigit.current = true;
      const next = spinDigits(digits, field, key === 'ArrowUp' ? 1 : -1);
      if (next !== digits) {
        setDraft(next);
      }
      return;
    }

    const otherField =
      field === 0 ? ['ArrowRight', ':', '.', ','].includes(key) : key === 'ArrowLeft';

    if (otherField) {
      event.preventDefault();
      focusField(adjacentField(field));
    }
  }

  function handleBlur(field: Field, event: FocusEvent<HTMLInputElement>) {
    const target = event.relatedTarget;
    const toAnotherField = target === inputs.current[adjacentField(field)];
    const toAction = target instanceof Element && target.closest('[data-timer-action]');
    if (!toAnotherField && !toAction) {
      finish();
    }
  }

  function handlePaste(field: Field, event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    typeDigits(field, event.clipboardData.getData('text'));
  }

  function restartDigits() {
    firstDigit.current = true;
  }

  function assign(field: Field, node: HTMLInputElement | null) {
    inputs.current[field] = node;
  }

  return {
    digits,
    draft,
    message,
    assign,
    discard,
    finish,
    handleBlur,
    handleChange,
    handleKeyDown,
    handlePaste,
    restartDigits,
    typeDigits,
  };
}

export function TimerDigits({
  digits,
  ended,
  decorative,
}: {
  readonly digits: Digits;
  readonly ended?: boolean;
  readonly decorative?: boolean;
}) {
  return (
    <span
      className="whiteboard-shared-timer__digits"
      data-ended={ended || undefined}
      aria-hidden={decorative || undefined}
    >
      {digits[0]}
      <span>:</span>
      {digits[1]}
    </span>
  );
}

export function TimerEntry({
  entry,
  readOnly,
}: {
  readonly entry: ReturnType<typeof useTimerEntry>;
  readonly readOnly: boolean;
}) {
  return (
    <>
      <TimerDigits digits={entry.digits} decorative />
      <div className="whiteboard-shared-timer__duration" role="group" aria-label="计时时长">
        {fields.map((field) => (
          <input
            key={field}
            readOnly={readOnly}
            ref={(node) => entry.assign(field, node)}
            type="text"
            role="spinbutton"
            aria-label={field === 0 ? '计时分钟' : '计时秒数'}
            aria-valuemin={0}
            aria-valuemax={field === 0 ? 99 : 59}
            aria-valuenow={Number(entry.digits[field])}
            inputMode="numeric"
            enterKeyHint="done"
            autoComplete="off"
            value={entry.digits[field]}
            onChange={readOnly ? undefined : (event) => entry.handleChange(field, event)}
            onCompositionEnd={readOnly ? undefined : (event) => entry.typeDigits(field, event.data)}
            onPaste={readOnly ? undefined : (event) => entry.handlePaste(field, event)}
            onKeyDown={readOnly ? undefined : (event) => entry.handleKeyDown(field, event)}
            onKeyUp={(event) => {
              if (!readOnly && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                entry.finish();
              }
            }}
            onFocus={entry.restartDigits}
            onPointerDown={entry.restartDigits}
            onSelect={handleDigitSelect}
            onBlur={readOnly ? undefined : (event) => entry.handleBlur(field, event)}
          />
        ))}
      </div>
    </>
  );
}
