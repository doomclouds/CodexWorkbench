import { useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, MouseEvent } from 'react';
import { AnchoredPopover, type AnchoredPopoverCloseReason } from '../../../base/index.js';
import { InlineTextEditor } from './InlineTextEditor.js';
import type { InlineTextEditorHandle, InlineTextFormat } from './InlineTextEditor.js';
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

interface TextLinkDraft {
  readonly anchor: HTMLElement;
  readonly url: string;
}

function TextObjectEditor({
  text,
  label,
  singleLine,
  onTextChange,
  onCommit,
  formatRequest,
}: TextObjectEditorProps) {
  const root = useRef<HTMLDivElement>(null);
  const editor = useRef<InlineTextEditorHandle>(null);
  const linkPanel = useRef<HTMLDivElement>(null);
  const formatSeen = useRef<number>(undefined);
  const opened = useRef(false);
  const [link, setLink] = useState<TextLinkDraft>();

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

  function handleOpenLink(url: string) {
    const element = root.current;
    if (element) {
      setLink({ anchor: element.closest<HTMLElement>('[data-canvas-object]') ?? element, url });
    }
  }

  function focusLink() {
    const field = linkPanel.current?.querySelector('input');
    field?.focus({ preventScroll: true });
    field?.select();
  }

  function handleCloseLink() {
    editor.current?.focus();
    setLink(undefined);
  }

  function handleDismissLink(reason: AnchoredPopoverCloseReason) {
    if (reason === 'escape') {
      handleCloseLink();
    } else {
      setLink(undefined);
    }
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    const target = event.relatedTarget;
    if (!target) {
      return;
    }

    const canvasToolbar = target.closest('[data-canvas-selection-actions]');
    const canvas = event.currentTarget.closest('[data-canvas-root]');
    const inToolbar = canvasToolbar && canvas?.contains(canvasToolbar);

    if (
      !event.currentTarget.contains(target) &&
      !linkPanel.current?.contains(target) &&
      !inToolbar
    ) {
      onCommit?.(false);
    }
  }

  return (
    <div
      ref={root}
      className="studio-ui-text-object-editor"
      data-canvas-native=""
      onBlur={handleBlur}
    >
      <InlineTextEditor
        ref={editor}
        value={text}
        ariaLabel={label}
        singleLine={singleLine}
        onChange={onTextChange}
        onCommit={(adjacent) => onCommit?.(adjacent)}
        onBlur={(event) => event.preventDefault()}
        onRequestLink={handleOpenLink}
      />
      {link && (
        <AnchoredPopover
          open
          anchor={link.anchor}
          portalRoot={link.anchor.closest<HTMLElement>('[data-canvas-root]')}
          label="文字链接"
          initialFocus={focusLink}
          onRequestClose={handleDismissLink}
        >
          <div ref={linkPanel} className="studio-ui-text-object-link" data-canvas-controls="">
            <InlineTextLinkEditor
              initialUrl={link.url}
              autoFocus={false}
              onApply={(url) => editor.current?.format('link', url) ?? false}
              onClose={handleCloseLink}
            />
          </div>
        </AnchoredPopover>
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
