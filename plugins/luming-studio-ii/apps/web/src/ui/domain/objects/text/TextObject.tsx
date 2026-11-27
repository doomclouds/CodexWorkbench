import { useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, MouseEvent } from 'react';
import { Button, ToggleButton, Toolbar } from '../../../base/index.js';
import { InlineTextEditor } from './InlineTextEditor.js';
import type {
  InlineTextEditorHandle,
  InlineTextFormat,
  InlineTextFormatState,
} from './InlineTextEditor.js';
import { InlineTextLinkEditor } from './InlineTextLinkEditor.js';
import { RichText } from './RichText.js';
import './text.css';

export interface InlineTextFormatRequest {
  readonly sequence: number;
  readonly format: InlineTextFormat;
}

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
  bold?: boolean;
  italic?: boolean;
  formatRequest?: InlineTextFormatRequest;
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
  formatRequest?: InlineTextFormatRequest;
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

function TextObjectEditor({
  text,
  label,
  singleLine,
  onTextChange,
  onCommit,
  formatRequest,
}: TextObjectEditorProps) {
  const editor = useRef<InlineTextEditorHandle>(null);
  const formatSeen = useRef<number>(undefined);
  const opened = useRef(false);
  const [format, setFormat] = useState(unformatted);
  const [link, setLink] = useState<string>();

  const applyFormatRequest = useEffectEvent(() => {
    const firstOpen = !opened.current;
    opened.current = true;
    const active = editor.current;
    if (!formatRequest || formatSeen.current === formatRequest.sequence || !active) {
      return;
    }

    formatSeen.current = formatRequest.sequence;
    if (firstOpen) {
      active.focus(true);
    }

    active.format(formatRequest.format);
  });

  useLayoutEffect(() => {
    applyFormatRequest();
  }, [formatRequest]);

  function handleCloseLink() {
    editor.current?.focus();
    setLink(undefined);
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    const target = event.relatedTarget;
    const canvasToolbar = target?.closest('[data-canvas-selection-actions]');
    const canvas = event.currentTarget.closest('[data-canvas-root]');
    const inToolbar = canvasToolbar && canvas?.contains(canvasToolbar);

    if (!event.currentTarget.contains(target) && !inToolbar) {
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
        <InlineTextLinkEditor
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
  bold,
  italic,
  formatRequest,
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
      style={{
        color,
        fontFamily,
        fontSize,
        textAlign: align,
        fontWeight: bold ? 700 : undefined,
        fontStyle: italic ? 'italic' : undefined,
      }}
      onDoubleClick={activatable && !showEditor ? requestEdit : undefined}
      onKeyDown={activatable && !showEditor ? handlePreviewKey : undefined}
      tabIndex={activatable && !showEditor ? 0 : undefined}
    >
      {showEditor ? (
        <TextObjectEditor
          text={text}
          label={label}
          singleLine={singleLine}
          formatRequest={formatRequest}
          onTextChange={onTextChange}
          onCommit={onCommit}
        />
      ) : (
        <RichText text={text} />
      )}
    </div>
  );
}
