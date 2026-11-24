import { useImperativeHandle, useRef, type KeyboardEvent, type Ref } from 'react';

import { Field } from '../Field/Field.js';

import './NumberField.css';

export interface NumberFieldHandle {
  focus(): void;
  select(): void;
}

export interface NumberFieldProps {
  label: string;
  value: string;
  onValueChange: (draft: string) => void;
  description?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  ref?: Ref<NumberFieldHandle>;
}

const decimalDraft = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/u;

function decimalPlaces(value: number): number {
  const [coefficient = '', exponent = '0'] = String(value).split('e');
  const fraction = coefficient.split('.')[1]?.length ?? 0;

  return Math.max(0, fraction - Number(exponent));
}

function steppedValue(draft: string, delta: number, min: number, max: number): string | undefined {
  const raw = draft.trim();
  if (!decimalDraft.test(raw)) {
    return;
  }

  const current = Number(raw);
  const sum = current + delta;
  if (!Number.isFinite(sum)) {
    return;
  }

  const places = Math.max(decimalPlaces(current), decimalPlaces(delta));
  const rounded = places <= 100 ? Number(sum.toFixed(places)) : sum;
  const next = Math.min(max, Math.max(min, rounded));
  const moved = delta > 0 ? next > current : next < current;

  return Number.isFinite(next) && moved ? String(next) : undefined;
}

export function NumberField({
  label,
  value,
  onValueChange,
  description,
  error,
  required,
  disabled,
  readOnly,
  unit,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  ref,
}: NumberFieldProps) {
  const input = useRef<HTMLInputElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      focus() {
        if (input.current?.disabled === false) {
          input.current.focus();
        }
      },
      select() {
        if (input.current?.disabled === false) {
          input.current.select();
        }
      },
    }),
    [],
  );

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      return;
    }
    if (event.defaultPrevented || event.nativeEvent.isComposing) {
      return;
    }

    const control = event.currentTarget;
    const modified = [event.altKey, event.ctrlKey, event.metaKey, event.shiftKey].some(Boolean);
    if (control.disabled || control.readOnly || modified) {
      return;
    }
    if (!Number.isFinite(step) || step <= 0 || !(min <= max)) {
      return;
    }

    const delta = event.key === 'ArrowUp' ? step : -step;
    const next = steppedValue(control.value, delta, min, max);
    if (next === undefined) {
      return;
    }

    event.preventDefault();
    onValueChange(next);
  }

  return (
    <Field label={label} description={description} error={error} required={required}>
      {(binding) => {
        const unitId = unit ? binding.id + '-unit' : undefined;
        const describedBy = [binding.describedBy, unitId].filter(Boolean).join(' ') || undefined;

        return (
          <div className="studio-ui-number-field__control">
            <input
              ref={input}
              className="studio-ui-number-field__input"
              id={binding.id}
              type="text"
              inputMode="decimal"
              value={value}
              required={binding.required}
              disabled={disabled}
              readOnly={readOnly}
              aria-describedby={describedBy}
              aria-invalid={binding.invalid}
              onChange={(event) => onValueChange(event.currentTarget.value)}
              onKeyDown={handleKeyDown}
            />
            {unitId && (
              <span className="studio-ui-number-field__unit" id={unitId}>
                {unit}
              </span>
            )}
          </div>
        );
      }}
    </Field>
  );
}
