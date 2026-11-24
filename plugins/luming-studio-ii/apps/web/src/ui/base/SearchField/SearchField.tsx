import { useImperativeHandle, useRef, type Ref } from 'react';

import { Button } from '../Button/Button.js';
import { TextField, type TextFieldHandle } from '../TextField/TextField.js';
import './SearchField.css';

export interface SearchFieldHandle {
  focus(): void;
}

export interface SearchFieldProps {
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  clearLabel: string;
  clearable?: boolean;
  disabled?: boolean;
  ref?: Ref<SearchFieldHandle>;
}

export function SearchField({
  value,
  onValueChange,
  label,
  clearLabel,
  clearable = true,
  disabled,
  ref,
}: SearchFieldProps) {
  const input = useRef<TextFieldHandle>(null);

  useImperativeHandle(
    ref,
    () => ({
      focus() {
        input.current?.focus();
      },
    }),
    [],
  );

  function handleClear() {
    onValueChange('');
    input.current?.focus();
  }

  return (
    <div className="studio-ui-search-field">
      <div className="studio-ui-search-field__field">
        <TextField
          ref={input}
          label={label}
          type="search"
          value={value}
          disabled={disabled}
          onValueChange={onValueChange}
        />
      </div>
      {clearable && value !== '' && (
        <Button
          label={clearLabel}
          icon={<span className="studio-ui-search-field__clear-mark">×</span>}
          iconOnly
          variant="ghost"
          disabled={disabled}
          onActivate={handleClear}
        />
      )}
    </div>
  );
}
