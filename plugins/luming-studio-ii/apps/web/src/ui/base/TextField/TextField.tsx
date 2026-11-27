import { useImperativeHandle, useRef, type Ref } from 'react';

import { Field } from '../Field/Field.js';

import './TextField.css';

export interface TextFieldHandle {
  focus(): void;
  select(): void;
}

export interface TextFieldProps {
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  placeholder?: string;
  description?: string;
  error?: string;
  required?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  type?: 'text' | 'email' | 'url' | 'password' | 'search';
  ref?: Ref<TextFieldHandle>;
}

export function TextField({
  value,
  onValueChange,
  label,
  placeholder,
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

  return (
    <Field id={id} label={label} description={description} error={error} required={required}>
      {(binding) => (
        <input
          ref={input}
          className="studio-ui-text-field__input"
          id={binding.id}
          name={name}
          type={type}
          placeholder={placeholder}
          value={value}
          required={binding.required}
          readOnly={readOnly}
          disabled={disabled}
          aria-describedby={binding.describedBy}
          aria-invalid={binding.invalid}
          onChange={(event) => onValueChange(event.currentTarget.value)}
        />
      )}
    </Field>
  );
}
