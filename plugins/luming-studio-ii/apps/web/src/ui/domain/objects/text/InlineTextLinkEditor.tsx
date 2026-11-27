import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

import { Button, TextField, type TextFieldHandle } from '../../../base/index.js';

interface InlineTextLinkEditorProps {
  readonly initialUrl: string;
  readonly label?: string;
  readonly applyLabel?: string;
  readonly onApply: (value: string) => boolean;
  readonly onClose: () => void;
}

export function InlineTextLinkEditor({
  initialUrl,
  label = '链接地址',
  applyLabel = '应用链接',
  onApply,
  onClose,
}: InlineTextLinkEditorProps) {
  const [value, setValue] = useState(initialUrl);
  const [error, setError] = useState<string>();
  const field = useRef<TextFieldHandle>(null);

  useLayoutEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  function handleApply() {
    if (onApply(value.trim())) {
      onClose();
    } else {
      setError('请输入有效的 HTTP 或 HTTPS 链接');
    }
  }

  function handleChange(nextValue: string) {
    setValue(nextValue);
    setError(undefined);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      event.stopPropagation();
      handleApply();
    }
  }

  return (
    <div className="studio-ui-text-object-link-fields" onKeyDown={handleKeyDown}>
      <TextField
        type="url"
        placeholder="https://"
        label={label}
        value={value}
        onValueChange={handleChange}
        error={error}
        ref={field}
      />
      <div className="studio-ui-text-object-link-actions">
        <Button label={applyLabel} onActivate={handleApply} />
        <Button label="取消链接编辑" variant="ghost" onActivate={onClose} />
      </div>
    </div>
  );
}
