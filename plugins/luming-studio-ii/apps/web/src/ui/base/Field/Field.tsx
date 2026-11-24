import { useId, type ReactNode } from 'react';

import './Field.css';

export interface FieldBinding {
  id: string;
  describedBy: string | undefined;
  invalid: boolean | undefined;
  required: boolean | undefined;
}

export interface FieldProps {
  id?: string;
  label: string;
  description?: string;
  error?: string;
  required?: boolean;
  children: (binding: FieldBinding) => ReactNode;
}

export function Field({ id, label, description, error, required, children }: FieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const descriptionId = description ? fieldId + '-description' : undefined;
  const errorId = error ? fieldId + '-error' : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="studio-ui-field">
      <label className="studio-ui-field__label" htmlFor={fieldId}>
        {label}
      </label>
      {children({ id: fieldId, describedBy, invalid: errorId ? true : undefined, required })}
      {descriptionId && (
        <div className="studio-ui-field__description" id={descriptionId}>
          {description}
        </div>
      )}
      {errorId && (
        <div className="studio-ui-field__error" id={errorId}>
          {error}
        </div>
      )}
    </div>
  );
}
