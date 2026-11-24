import { useId, useImperativeHandle, useRef, type Ref } from 'react';

import './TextField.css';

export interface TextFieldHandle {
  focus(): void;
  select(): void;
}

export interface TextFieldProps {
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  description?: string;
  error?: string;
  required?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  type?: 'text' | 'email' | 'url' | 'password';
  ref?: Ref<TextFieldHandle>;
}

export function TextField({
  value,
  onValueChange,
  label,
  description,
  error,
  required,
  readOnly,
  disabled,
  id,
  name,
  type = 'text',
  ref,
}: TextFieldProps) {
  const generatedId = useId();
  const input = useRef<HTMLInputElement>(null);
  const fieldId = id ?? generatedId;
  const descriptionId = description ? fieldId + '-description' : undefined;
  const errorId = error ? fieldId + '-error' : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;

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

  return (
    <div className="studio-text-field">
      <label className="studio-text-field__label" htmlFor={fieldId}>
        {label}
      </label>
      <input
        ref={input}
        className="studio-text-field__input"
        id={fieldId}
        name={name}
        type={type}
        value={value}
        required={required}
        readOnly={readOnly}
        disabled={disabled}
        aria-describedby={describedBy}
        aria-invalid={errorId ? true : undefined}
        onChange={(event) => onValueChange(event.currentTarget.value)}
      />
      {descriptionId && (
        <div className="studio-text-field__description" id={descriptionId}>
          {description}
        </div>
      )}
      {errorId && (
        <div className="studio-text-field__error" id={errorId}>
          {error}
        </div>
      )}
    </div>
  );
}
