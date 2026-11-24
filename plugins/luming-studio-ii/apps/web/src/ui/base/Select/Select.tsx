import type { ChangeEvent } from 'react';

import { Field } from '../Field/Field.js';

import './Select.css';

export interface SelectOption {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  label: string;
  value: string;
  options: readonly SelectOption[];
  disabled?: boolean;
  onValueChange: (id: string) => void;
}

export function Select({ label, value, options, disabled, onValueChange }: SelectProps) {
  const valueIsAvailable = options.some((option) => option.id === value);

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    const select = event.currentTarget;
    const option = select.selectedOptions[0];
    if (!select.disabled && option && !option.disabled) {
      onValueChange(option.value);
    }
  }

  return (
    <Field label={label}>
      {({ id, describedBy, invalid, required }) => (
        <select
          id={id}
          className="studio-ui-select"
          value={value}
          disabled={disabled}
          required={required}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onChange={handleChange}
        >
          {!valueIsAvailable && <option value={value} hidden disabled />}
          {options.map((option) => (
            <option key={option.id} value={option.id} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}
