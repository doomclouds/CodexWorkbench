import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
  type SyntheticEvent,
} from 'react';

import { Field } from '../Field/Field.js';

import './ColorField.css';

export interface ColorFieldProps {
  label: string;
  value: string;
  disabled?: boolean;
  onValueChange: (next: string) => void;
  onValueCommit?: (next: string) => void;
}

interface ColorPreview {
  original: string | undefined;
  color: string;
}

function normalizeColor(value: string): string | undefined {
  return /^#[0-9a-f]{6}$/iu.test(value) ? value.toUpperCase() : undefined;
}

function updateInputs(
  hex: HTMLInputElement | null,
  picker: HTMLInputElement | null,
  value: string,
) {
  if (hex) {
    hex.value = value;
  }

  if (picker) {
    picker.value = normalizeColor(value) ?? '#000000';
  }
}

export function ColorField({
  label,
  value,
  disabled,
  onValueChange,
  onValueCommit,
}: ColorFieldProps) {
  const hex = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const preview = useRef<ColorPreview | null>(null);

  useLayoutEffect(() => {
    if (disabled || !preview.current || preview.current.color !== normalizeColor(value)) {
      preview.current = null;
      updateInputs(hex.current, picker.current, value);
    }
  }, [disabled, value]);

  function publishPreview(color: string) {
    const pending = preview.current;
    const original = pending ? pending.original : normalizeColor(value);
    if (color === (pending?.color ?? original)) {
      return;
    }

    preview.current = { original, color };
    onValueChange(color);
  }

  function handleCancel() {
    const pending = preview.current;
    preview.current = null;
    updateInputs(hex.current, picker.current, value);
    if (pending?.original && pending.color !== pending.original) {
      onValueChange(pending.original);
    }
  }

  function commitColor(color: string) {
    const pending = preview.current;
    const original = pending ? pending.original : normalizeColor(value);
    preview.current = null;
    updateInputs(hex.current, picker.current, value);
    if (color !== (pending?.color ?? original)) {
      onValueChange(color);
    }

    if (color !== original) {
      onValueCommit?.(color);
    }
  }

  const confirmPicker = useEffectEvent((draft: string) => {
    const color = normalizeColor(draft);
    if (!disabled && color) {
      commitColor(color);
    }
  });

  useEffect(() => {
    const input = picker.current;
    if (!input) {
      return;
    }

    const handlePickerChange = () => confirmPicker(input.value);

    input.addEventListener('change', handlePickerChange);
    return () => input.removeEventListener('change', handlePickerChange);
  }, []);

  function handleHexChange(event: ChangeEvent<HTMLInputElement>) {
    const color = normalizeColor(event.currentTarget.value);
    if (disabled || !color) {
      return;
    }

    if (picker.current) {
      picker.current.value = color;
    }

    publishPreview(color);
  }

  function handleHexBlur(event: SyntheticEvent<HTMLInputElement>) {
    if (disabled) {
      return;
    }

    const color = normalizeColor(event.currentTarget.value);
    if (color) {
      commitColor(color);
    } else {
      handleCancel();
    }
  }

  function handleHexKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (disabled || event.nativeEvent.isComposing) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      handleCancel();
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const color = normalizeColor(event.currentTarget.value);
      if (color) {
        commitColor(color);
      }
    }
  }

  function handlePickerInput(event: SyntheticEvent<HTMLInputElement>) {
    const color = normalizeColor(event.currentTarget.value);
    if (disabled || !color) {
      return;
    }

    if (hex.current) {
      hex.current.value = color;
    }

    publishPreview(color);
  }

  function handlePickerKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!disabled && event.key === 'Escape') {
      handleCancel();
    }
  }

  return (
    <Field label={label}>
      {(binding) => (
        <div className="studio-ui-color-field">
          <input
            ref={hex}
            id={binding.id}
            className="studio-ui-color-field__hex"
            type="text"
            defaultValue={value}
            disabled={disabled}
            aria-describedby={binding.describedBy}
            placeholder="#RRGGBB"
            spellCheck={false}
            onChange={handleHexChange}
            onBlur={handleHexBlur}
            onKeyDown={handleHexKeyDown}
          />
          <input
            ref={picker}
            className="studio-ui-color-field__picker"
            type="color"
            defaultValue={normalizeColor(value) ?? '#000000'}
            disabled={disabled}
            aria-label={label + '选色'}
            onInput={handlePickerInput}
            onKeyDown={handlePickerKeyDown}
            onBlur={handleCancel}
          />
        </div>
      )}
    </Field>
  );
}
