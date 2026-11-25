import { useLayoutEffect, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, MouseEvent } from 'react';
import { Button, TextField, ToggleButton, Toolbar } from '../../../base/index.js';
import type { TextFieldHandle } from '../../../base/index.js';
import { InlineTextEditor } from './InlineTextEditor.js';
import type { InlineTextEditorHandle, InlineTextFormatState } from './InlineTextEditor.js';
import { RichText } from './RichText.js';
import './text.css';

export interface TextObjectProps {
  text: string;
  label?: string;
  editing?: boolean;
  singleLine?: boolean;
  readOnly?: boolean;
  color?: string;
  fontFamily?: string;
  fontSize?: number;
  align?: 'left' | 'center' | 'right';
  onTextChange?: (text: string) => void;
  onCommit?: (adjacent?: boolean) => void;
  onRequestEdit?: () => void;
}

interface TextObjectEditorProps {
  text: string;
  label?: string;
  singleLine?: boolean;
  onTextChange: (text: string) => void;
  onCommit?: (adjacent?: boolean) => void;
}

interface LinkFieldsProps {
  initialUrl: string;
  onApply: (value: string) => boolean;
  onClose: () => void;
}

const formatOptions = [
  { kind: 'bold', label: '粗体' },
  { kind: 'italic', label: '斜体' },
  { kind: 'bullets', label: '项目列表' },
  { kind: 'numbered', label: '编号列表' },
] as const;

const unformatted: InlineTextFormatState = {
  bold: false,
  italic: false,
  bullets: false,
  numbered: false,
};

function LinkFields({ initialUrl, onApply, onClose }: LinkFieldsProps) {
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
        label="链接地址"
        value={value}
        onValueChange={handleChange}
        error={error}
        ref={field}
      />
      <div className="studio-ui-text-object-link-actions">
        <Button label="应用链接" onActivate={handleApply} />
        <Button label="取消链接编辑" variant="ghost" onActivate={onClose} />
      </div>
    </div>
  );
}

function TextObjectEditor({
  text,
  label,
  singleLine,
  onTextChange,
  onCommit,
}: TextObjectEditorProps) {
  const editor = useRef<InlineTextEditorHandle>(null);
  const [format, setFormat] = useState(unformatted);
  const [link, setLink] = useState<string>();

  function handleCloseLink() {
    editor.current?.focus();
    setLink(undefined);
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      onCommit?.(false);
    }
  }

  return (
    <div className="studio-ui-text-object-editor" data-canvas-native="" onBlur={handleBlur}>
      <InlineTextEditor
        ref={editor}
        value={text}
        ariaLabel={label}
        singleLine={singleLine}
        onChange={onTextChange}
        onCommit={(adjacent) => onCommit?.(adjacent)}
        onBlur={(event) => event.preventDefault()}
        onFormatStateChange={setFormat}
        onRequestLink={setLink}
      />
      <Toolbar label="文字格式">
        {formatOptions.map(({ kind, label }) => (
          <ToggleButton
            key={kind}
            label={label}
            pressed={format[kind]}
            onPressedChange={() => editor.current?.format(kind)}
          />
        ))}
        <Button label="链接" onActivate={() => editor.current?.format('link')} />
      </Toolbar>
      {link !== undefined && (
        <LinkFields
          initialUrl={link}
          onApply={(url) => editor.current?.format('link', url) ?? false}
          onClose={handleCloseLink}
        />
      )}
    </div>
  );
}

export function TextObject({
  text,
  label,
  editing,
  singleLine,
  readOnly,
  color,
  fontFamily,
  fontSize,
  align,
  onTextChange,
  onCommit,
  onRequestEdit,
}: TextObjectProps) {
  const activatable = !readOnly && Boolean(onRequestEdit);
  const showEditor = editing && !readOnly && onTextChange;

  function requestEdit(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (target instanceof Element && target.closest('a')) {
      return;
    }

    onRequestEdit?.();
  }

  function handlePreviewKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' && event.target === event.currentTarget) {
      event.preventDefault();
      onRequestEdit?.();
    }
  }

  return (
    <div
      className="studio-ui-text-object"
      style={{ color, fontFamily, fontSize, textAlign: align }}
      onDoubleClick={activatable && !showEditor ? requestEdit : undefined}
      onKeyDown={activatable && !showEditor ? handlePreviewKey : undefined}
      tabIndex={activatable && !showEditor ? 0 : undefined}
    >
      {showEditor ? (
        <TextObjectEditor
          text={text}
          label={label}
          singleLine={singleLine}
          onTextChange={onTextChange}
          onCommit={onCommit}
        />
      ) : (
        <RichText text={text} />
      )}
    </div>
  );
}
