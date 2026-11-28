import { useEffectEvent, useLayoutEffect, useState } from 'react';
import type { DocumentActivity } from './contracts.js';
import { useDocumentEditor } from './useDocumentEditor.js';

interface DocumentView {
  readonly mode: DocumentActivity['mode'];
  readonly focusBlockId?: string;
}

interface DocumentViewOptions {
  readonly focused: boolean;
  readonly readOnly: boolean;
  readonly annotationActive?: boolean;
  readonly composing: boolean;
  readonly editRequest?: number;
  readonly onOpen?: () => void;
}

function documentMode(
  mode: DocumentView['mode'],
  { focused, readOnly, composing }: DocumentViewOptions,
): DocumentView['mode'] {
  const blockedEditor = mode === 'edit' && readOnly && !composing;
  const focusedReader = focused && mode === 'inline';

  return focusedReader || blockedEditor ? 'read' : mode;
}

export function useDocumentView(options: DocumentViewOptions) {
  const { focused, readOnly, annotationActive, editRequest, onOpen } = options;
  const [view, setView] = useState<DocumentView>({ mode: 'inline' });
  const [wasFocused, setWasFocused] = useState(focused);
  const [consumedEditRequest, setConsumedEditRequest] = useState<number>();
  const mode = documentMode(view.mode, options);
  const loadingRequest = mode === 'edit' && !annotationActive ? view : undefined;
  const module = useDocumentEditor(loadingRequest);
  const editor = mode === 'edit' ? module.editor : undefined;
  const displayMode = mode === 'edit' && !editor ? 'read' : mode;
  const hosted = Boolean(onOpen);
  const seekBoardFocus = hosted && mode !== 'inline' && !focused;
  const requestBoardFocus = useEffectEvent(() => onOpen?.());

  if (wasFocused !== focused) {
    setWasFocused(focused);
    if (!focused) {
      setView({ mode: 'inline' });
    }
  }
  if (editRequest !== undefined && consumedEditRequest !== editRequest) {
    setConsumedEditRequest(editRequest);
    if (!readOnly && !annotationActive) {
      setView({ mode: 'edit' });
    }
  }

  useLayoutEffect(() => {
    if (seekBoardFocus) {
      requestBoardFocus();
    }
  }, [seekBoardFocus]);

  const standalone = mode !== 'inline' && !focused && !hosted;

  return { view, setView, mode: displayMode, standalone, editor, editorState: module.state };
}
