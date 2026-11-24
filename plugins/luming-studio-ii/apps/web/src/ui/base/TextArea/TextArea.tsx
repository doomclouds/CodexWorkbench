import { useImperativeHandle, useRef, type Ref } from 'react';

import { Field } from '../Field/Field.js';
import './TextArea.css';

export interface TextAreaHandle {
  focus(): void;
  select(): void;
}

export interface TextAreaProps {
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  id?: string;
  name?: string;
  description?: string;
  error?: string;
  required?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  rows?: number;
  ref?: Ref<TextAreaHandle>;
}

export function TextArea({
  value,
  onValueChange,
  label,
  id,
  name,
  description,
  error,
  required,
  readOnly,
  disabled,
  rows,
  ref,
}: TextAreaProps) {
  const area = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      focus() {
        if (area.current?.disabled === false) {
          area.current.focus();
        }
      },
      select() {
        if (area.current?.disabled === false) {
          area.current.select();
        }
      },
    }),
    [],
  );

  return (
    <Field id={id} label={label} description={description} error={error} required={required}>
      {({ id: fieldId, describedBy, invalid, required: fieldRequired }) => (
        <textarea
          ref={area}
          className="studio-ui-text-area"
          id={fieldId}
          name={name}
          value={value}
          required={fieldRequired}
          readOnly={readOnly}
          disabled={disabled}
          rows={rows}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          onChange={(event) => onValueChange(event.currentTarget.value)}
        />
      )}
    </Field>
  );
}
