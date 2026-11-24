import { useEffect, useRef, type InputEvent, type KeyboardEvent, type PointerEvent } from 'react';

import { Field } from '../Field/Field.js';
import './Range.css';

export interface RangeProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  onValueChange: (next: number) => void;
  onValueCommit?: (next: number) => void;
  onValueCancel?: () => void;
}

type Gesture = { kind: 'pointer'; id: number } | { kind: 'keyboard'; keys: Set<string> };

interface Adjustment {
  gesture?: Gesture;
  preview?: number;
  ignoredChange?: readonly number[];
}

const adjustmentKeys = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
]);

export function Range({
  label,
  value,
  min,
  max,
  step,
  unit,
  disabled,
  onValueChange,
  onValueCommit,
  onValueCancel,
}: RangeProps) {
  const input = useRef<HTMLInputElement>(null);
  const adjustment = useRef<Adjustment>({});
  const valueText = unit ? value + ' ' + unit : String(value);

  useEffect(() => {
    const range = input.current;
    if (!range) {
      return;
    }

    function handleNativeChange() {
      if (!range || range.disabled || adjustment.current.gesture) {
        return;
      }

      const next = range.valueAsNumber;
      const { preview, ignoredChange } = adjustment.current;
      adjustment.current = {};

      if (ignoredChange?.includes(next) || (preview === undefined && next === value)) {
        return;
      }

      if (preview !== next) {
        onValueChange(next);
      }

      onValueCommit?.(next);
    }

    range.addEventListener('change', handleNativeChange);

    return () => range.removeEventListener('change', handleNativeChange);
  }, [onValueChange, onValueCommit, value]);

  function handleInput(event: InputEvent<HTMLInputElement>) {
    const range = event.currentTarget;
    if (range.disabled) {
      return;
    }

    const next = range.valueAsNumber;
    adjustment.current.preview = next;
    adjustment.current.ignoredChange = undefined;
    onValueChange(next);
  }

  function finishAdjustment(range: HTMLInputElement, canceled = false) {
    const { preview } = adjustment.current;
    adjustment.current = {};
    if (preview === undefined) {
      return;
    }

    adjustment.current.ignoredChange = [preview, range.valueAsNumber];
    if (canceled || range.disabled) {
      onValueCancel?.();
      return;
    }

    onValueCommit?.(preview);
  }

  function handlePointerDown(event: PointerEvent<HTMLInputElement>) {
    const range = event.currentTarget;
    if (range.disabled || event.button !== 0 || adjustment.current.gesture) {
      return;
    }

    adjustment.current = { gesture: { kind: 'pointer', id: event.pointerId } };
    if (event.isTrusted) {
      range.setPointerCapture?.(event.pointerId);
    }
  }

  function handlePointerUp(event: PointerEvent<HTMLInputElement>) {
    const gesture = adjustment.current.gesture;
    if (gesture?.kind === 'pointer' && gesture.id === event.pointerId) {
      finishAdjustment(event.currentTarget);
    }
  }

  function handlePointerCancel(event: PointerEvent<HTMLInputElement>) {
    const gesture = adjustment.current.gesture;
    if (gesture?.kind === 'pointer' && gesture.id === event.pointerId) {
      finishAdjustment(event.currentTarget, true);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.currentTarget.disabled || !adjustmentKeys.has(event.key)) {
      return;
    }

    const gesture = adjustment.current.gesture;
    if (!gesture) {
      adjustment.current = { gesture: { kind: 'keyboard', keys: new Set([event.key]) } };
      return;
    }

    if (gesture.kind === 'keyboard') {
      gesture.keys.add(event.key);
    }
  }

  function handleKeyUp(event: KeyboardEvent<HTMLInputElement>) {
    const gesture = adjustment.current.gesture;
    if (gesture?.kind !== 'keyboard' || !gesture.keys.delete(event.key)) {
      return;
    }

    if (gesture.keys.size === 0) {
      finishAdjustment(event.currentTarget);
    }
  }

  return (
    <Field label={label}>
      {({ id }) => (
        <div className="studio-ui-range">
          <input
            ref={input}
            id={id}
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={disabled}
            aria-valuetext={unit ? valueText : undefined}
            onInput={handleInput}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onLostPointerCapture={handlePointerCancel}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            onBlur={(event) => {
              if (adjustment.current.gesture?.kind === 'keyboard') {
                finishAdjustment(event.currentTarget);
              }
            }}
          />
          <span aria-hidden="true" className="studio-ui-range__value">
            {valueText}
          </span>
        </div>
      )}
    </Field>
  );
}
