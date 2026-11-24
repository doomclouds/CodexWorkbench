import { useLayoutEffect, useRef, type ChangeEvent } from 'react';

import './Checkbox.css';

export interface CheckboxProps {
  label: string;
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onCheckedChange: (next: boolean) => void;
}

export function Checkbox({
  label,
  checked,
  indeterminate = false,
  disabled,
  onCheckedChange,
}: CheckboxProps) {
  const input = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (input.current) {
      input.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const checkbox = event.currentTarget;
    if (checkbox.disabled) {
      return;
    }

    checkbox.indeterminate = indeterminate;
    onCheckedChange(checkbox.checked);
  }

  return (
    <label className="studio-ui-checkbox">
      <input
        ref={input}
        className="studio-ui-checkbox__input"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={handleChange}
      />
      <span className="studio-ui-checkbox__label">{label}</span>
    </label>
  );
}
