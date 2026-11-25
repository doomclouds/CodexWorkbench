import { useEffectEvent, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import type { ClipboardEvent, CSSProperties, FocusEvent, KeyboardEvent, Ref } from 'react';
import { readDocument, renderDocument } from './editor-document.js';
import { indentList, patchSelectedRuns, toggleList } from './editor-format.js';
import { markdownLines, serialize } from './editor-markdown.js';
import { lineText, sameEditLines, snapshotLines } from './editor-model.js';
import type { DocumentText, EditSnapshot, Run, SelectionOffsets } from './editor-model.js';
import { restoreSelection, selectedRuns, selectionOffsets } from './editor-selection.js';
import { safeHttpLink } from './rich-text.js';
import './text.css';

export type InlineTextFormat = 'bold' | 'italic' | 'link' | 'bullets' | 'numbered';

export interface InlineTextFormatState {
  bold: boolean;
  italic: boolean;
  bullets: boolean;
  numbered: boolean;
  link?: string;
}

export interface InlineTextEditorHandle {
  format: (format: InlineTextFormat, url?: string) => boolean;
  focus: (selectAll?: boolean) => void;
}

export interface InlineTextEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  onCommit: (adjacent?: boolean) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  onBlur?: (event: FocusEvent<HTMLDivElement>) => void;
  onRequestLink?: (currentUrl: string) => void;
  onFormatStateChange?: (state: InlineTextFormatState) => void;
  singleLine?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<InlineTextEditorHandle>;
}

const formatShortcuts = new Map<string, InlineTextFormat>([
  ['b', 'bold'],
  ['i', 'italic'],
  ['k', 'link'],
]);
const historyLimit = 100;

function selectionLineIndex(doc: DocumentText, selection: SelectionOffsets) {
  return Math.max(
    0,
    doc.starts.findLastIndex((start) => start <= selection.start),
  );
}

function currentFormat(doc: DocumentText, selection: SelectionOffsets, caret: Node | null) {
  const runs = selectedRuns(doc, selection, caret);
  const line = doc.lines[selectionLineIndex(doc, selection)];
  const href = runs[0]?.href;

  return {
    bold: runs.length > 0 && runs.every((run) => run.bold),
    italic: runs.length > 0 && runs.every((run) => run.italic),
    link: runs.every((run) => run.href === href) ? href : undefined,
    bullets: line?.list === 'bullet',
    numbered: line?.list === 'ordered',
  };
}

function editorSelection(
  editor: HTMLElement,
  doc: DocumentText,
  saved: SelectionOffsets | undefined,
) {
  return selectionOffsets(editor, doc) ?? saved ?? { start: 0, end: doc.length };
}

function insertPlainText(editor: HTMLElement, text: string, singleLine: boolean) {
  const document = editor.ownerDocument;
  const selection = document.getSelection();
  if (!selection?.rangeCount) {
    return;
  }

  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) {
    return;
  }

  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = singleLine ? [normalized.replace(/\n/g, ' ')] : normalized.split('\n');
  const fragment = document.createDocumentFragment();
  lines.forEach((line, index) => {
    if (index) {
      fragment.append(document.createElement('br'));
    }

    fragment.append(document.createTextNode(line));
  });

  const last = fragment.lastChild!;
  range.deleteContents();
  range.insertNode(fragment);
  range.setStartAfter(last);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function InlineTextEditor({
  value,
  onChange,
  onCommit,
  onKeyDown,
  onBlur,
  onRequestLink,
  onFormatStateChange,
  singleLine = false,
  disabled = false,
  autoFocus = true,
  ariaLabel = '编辑文字',
  className,
  style,
  ref,
}: InlineTextEditorProps) {
  const root = useRef<HTMLDivElement>(null);
  const lastValue = useRef(value);
  const savedSelection = useRef<SelectionOffsets | undefined>(undefined);
  const savedCaret = useRef<Node | null>(null);
  const history = useRef<EditSnapshot[]>([]);
  const future = useRef<EditSnapshot[]>([]);

  function publish() {
    const editor = root.current;
    if (!editor || disabled) {
      return;
    }

    const doc = readDocument(editor);
    const lines = snapshotLines(doc.lines);
    if (!sameEditLines(lines, history.current.at(-1)?.lines)) {
      const selection = selectionOffsets(editor, doc) ??
        savedSelection.current ?? { start: doc.length, end: doc.length };
      history.current = [...history.current.slice(1 - historyLimit), { lines, selection }];
      future.current = [];
    }

    const markdown = serialize(doc.lines, singleLine);
    lastValue.current = markdown;
    onChange(markdown);
  }

  function handleSelectionChange() {
    const editor = root.current;
    if (!editor) {
      return;
    }

    const doc = readDocument(editor);
    const selection = selectionOffsets(editor, doc);
    if (!selection) {
      return;
    }

    savedSelection.current = selection;
    savedCaret.current = editor.ownerDocument.getSelection()?.anchorNode ?? null;
    onFormatStateChange?.(currentFormat(doc, selection, savedCaret.current));
  }

  function mutate(change: (doc: DocumentText, selection: SelectionOffsets) => void) {
    const editor = root.current;
    if (!editor || disabled) {
      return false;
    }

    const doc = readDocument(editor);
    const selection = editorSelection(editor, doc, savedSelection.current);
    change(doc, selection);
    renderDocument(editor, doc.lines);
    editor.focus({ preventScroll: true });
    restoreSelection(editor, selection);
    savedSelection.current = selection;
    publish();
    handleSelectionChange();

    return true;
  }

  function requestLink() {
    const editor = root.current;
    if (!editor) {
      return false;
    }

    const doc = readDocument(editor);
    const selection = editorSelection(editor, doc, savedSelection.current);
    savedSelection.current = selection;
    const current = selectedRuns(doc, selection, savedCaret.current)[0]?.href ?? '';
    onRequestLink?.(current);

    return true;
  }

  function format(kind: InlineTextFormat, url?: string) {
    if (disabled) {
      return false;
    }
    if (kind === 'link' && url === undefined) {
      return requestLink();
    }

    if (kind === 'bullets' || kind === 'numbered') {
      const list = kind === 'bullets' ? 'bullet' : 'ordered';

      return mutate((doc, selection) => toggleList(doc, selection, list));
    }

    const href = safeHttpLink(url);
    const invalidLink = kind === 'link' && Boolean(url) && !href;
    if (invalidLink) {
      return false;
    }

    return mutate((doc, selection) => {
      const runs = selectedRuns(doc, selection, savedCaret.current);
      const enabled = kind !== 'link' && !runs.every((run) => run[kind]);
      const patch = (run: Run) =>
        kind === 'link' ? { ...run, href } : { ...run, [kind]: runs.length === 0 || enabled };
      patchSelectedRuns(doc, selection, patch);
    });
  }

  function focus(selectAll?: boolean) {
    const editor = root.current;
    if (!editor) {
      return;
    }

    editor.focus({ preventScroll: true });
    const { length } = readDocument(editor);
    const selection = selectAll
      ? { start: 0, end: length }
      : (savedSelection.current ?? { start: length, end: length });
    restoreSelection(editor, selection);
  }

  useImperativeHandle(ref, () => ({ format, focus }));

  const observeSelection = useEffectEvent(handleSelectionChange);
  const focusOnMount = useEffectEvent(() => {
    if (autoFocus && !disabled) {
      focus();
    }
  });

  useLayoutEffect(() => {
    const editor = root.current;
    if (!editor) {
      return;
    }

    const lines = markdownLines(lastValue.current);
    renderDocument(editor, lines);
    const { length } = readDocument(editor);
    history.current = [{ lines: snapshotLines(lines), selection: { start: length, end: length } }];
    focusOnMount();

    const doc = editor.ownerDocument;
    function selectionChanged() {
      observeSelection();
    }

    doc.addEventListener('selectionchange', selectionChanged);

    return () => doc.removeEventListener('selectionchange', selectionChanged);
  }, []);

  useLayoutEffect(() => {
    const editor = root.current;
    if (!editor || value === lastValue.current) {
      return;
    }

    const previous = selectionOffsets(editor, readDocument(editor));
    const lines = markdownLines(value);
    lastValue.current = value;
    renderDocument(editor, lines);

    const { length } = readDocument(editor);
    const selection = previous
      ? { start: Math.min(previous.start, length), end: Math.min(previous.end, length) }
      : { start: length, end: length };

    if (editor.ownerDocument.activeElement === editor) {
      restoreSelection(editor, selection);
    }

    savedSelection.current = selection;
    savedCaret.current = null;
    history.current = [{ lines: snapshotLines(lines), selection }];
    future.current = [];
  }, [value]);

  function changeHistory(redo: boolean) {
    const editor = root.current;
    if (!editor || disabled) {
      return;
    }

    let snapshot: EditSnapshot | undefined;
    if (redo) {
      snapshot = future.current.pop();
      if (snapshot) {
        history.current.push(snapshot);
      }
    } else if (history.current.length > 1) {
      future.current.push(history.current.pop()!);
      snapshot = history.current.at(-1);
    }

    if (!snapshot) {
      return;
    }

    renderDocument(editor, snapshot.lines);
    editor.focus({ preventScroll: true });
    restoreSelection(editor, snapshot.selection);
    savedSelection.current = snapshot.selection;
    lastValue.current = serialize(snapshot.lines, singleLine);
    onChange(lastValue.current);
    handleSelectionChange();
  }

  function handleInput() {
    handleSelectionChange();
    publish();
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    handleSelectionChange();
    onBlur?.(event);
    const toolbarFocused = event.relatedTarget?.closest('.studio-selection-toolbar');
    if (!event.defaultPrevented && !toolbarFocused) {
      onCommit(false);
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const editor = root.current;
    if (!editor || disabled) {
      return;
    }

    insertPlainText(editor, event.clipboardData.getData('text/plain'), singleLine);
    handleInput();
  }

  function applyFormattingShortcut(event: KeyboardEvent<HTMLDivElement>, command: boolean) {
    if (!command) {
      return false;
    }

    const key = event.key.toLowerCase();
    if (!event.altKey && (key === 'z' || key === 'y')) {
      event.preventDefault();
      changeHistory(key === 'y' || event.shiftKey);

      return true;
    }

    const mark = formatShortcuts.get(key);
    if (!event.altKey && mark) {
      event.preventDefault();
      format(mark);

      return true;
    }

    const listKey = ['7', '8'].includes(key) || ['Digit7', 'Digit8'].includes(event.code);
    if (event.shiftKey && listKey) {
      event.preventDefault();
      format(key === '7' || event.code === 'Digit7' ? 'numbered' : 'bullets');

      return true;
    }

    return false;
  }

  function handleListKey(event: KeyboardEvent<HTMLDivElement>, command: boolean) {
    const editor = root.current;
    if (!editor) {
      return;
    }

    const doc = readDocument(editor);
    const selection = selectionOffsets(editor, doc);
    if (!selection) {
      return;
    }

    const index = selectionLineIndex(doc, selection);
    const line = doc.lines[index];
    if (!line?.list) {
      return;
    }

    if (event.key === 'Tab' && !command && !event.altKey) {
      event.preventDefault();
      mutate((doc, range) => indentList(doc, range, event.shiftKey));

      return;
    }

    const emptyItem = event.key === 'Enter' && !lineText(line);
    const caretAtStart = selection.start === selection.end && selection.start === doc.starts[index];

    if (emptyItem || (event.key === 'Backspace' && caretAtStart)) {
      event.preventDefault();
      mutate((value) => {
        const selectedLine = value.lines[index]!;
        if (selectedLine.level) {
          selectedLine.level--;
        } else {
          selectedLine.list = undefined;
        }
      });
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented) {
      return;
    }

    event.stopPropagation();
    if (disabled || event.nativeEvent.isComposing) {
      return;
    }

    const command = event.ctrlKey || event.metaKey;
    if (applyFormattingShortcut(event, command)) {
      return;
    }

    const enterToCommit = event.key === 'Enter' && (command || singleLine);
    if (event.key === 'Escape' || enterToCommit) {
      event.preventDefault();
      publish();
      onCommit(event.key === 'Enter' && command);

      return;
    }

    handleListKey(event, command);
  }

  const editorClass = className
    ? 'studio-ui-inline-text-editor ' + className
    : 'studio-ui-inline-text-editor';

  return (
    <div
      ref={root}
      className={editorClass}
      style={style}
      role="textbox"
      aria-label={ariaLabel}
      aria-multiline={!singleLine}
      aria-disabled={disabled || undefined}
      contentEditable={!disabled}
      suppressContentEditableWarning
      data-canvas-native=""
      data-native-interactive="true"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={handleSelectionChange}
      onKeyUp={handleSelectionChange}
      onInput={handleInput}
      onBlur={handleBlur}
      onPaste={handlePaste}
      onDrop={(event) => event.preventDefault()}
      onKeyDown={handleKeyDown}
    />
  );
}
