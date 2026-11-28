import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

import { Button, TextField, type TextFieldHandle } from '../../../base/index.js';
import { safeHttpLink } from './rich-text.js';

interface InlineTextLinkEditorProps {
  readonly initialUrl: string;
  readonly label?: string;
  readonly applyLabel?: string;
  readonly autoFocus?: boolean;
  readonly onApply: (value: string) => boolean;
  readonly onClose: () => void;
}

export function InlineTextLinkEditor({
  initialUrl,
  label = '链接地址',
  applyLabel = '应用链接',
  autoFocus = true,
  onApply,
  onClose,
}: InlineTextLinkEditorProps) {
  const [value, setValue] = useState(initialUrl);
  const [error, setError] = useState<string>();
  const field = useRef<TextFieldHandle>(null);
  const currentLink = safeHttpLink(initialUrl);
  const address = value.trim();

  useLayoutEffect(() => {
    if (autoFocus) {
      field.current?.focus();
      field.current?.select();
    }
  }, [autoFocus]);

  function handleApply() {
    if (!address) {
      return;
    }

    if (onApply(address)) {
      onClose();
    } else {
      setError('请输入有效的 HTTP 或 HTTPS 链接');
    }
  }

  function handleRemove() {
    if (onApply('')) {
      onClose();
    }
  }

  function handleChange(nextValue: string) {
    setValue(nextValue);
    setError(undefined);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing) {
      return;
    }

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
        {currentLink && (
          <a
            className="studio-ui-text-object-link-open"
            href={currentLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            打开链接
          </a>
        )}
        {currentLink && (
          <Button label="移除链接" variant="ghost" tone="danger" onActivate={handleRemove} />
        )}
        <Button label="取消链接编辑" variant="ghost" onActivate={onClose} />
        <Button label={applyLabel} disabled={!address} onActivate={handleApply} />
      </div>
    </div>
  );
}
