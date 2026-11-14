import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type CSSProperties, type FocusEvent, type KeyboardEvent } from 'react';
import { parseInlineText, safeHttpLink, type RichTextSegment } from '../../core/shared/rich-text.js';

export type InlineTextFormat = 'bold' | 'italic' | 'link' | 'bullets' | 'numbered';
export interface InlineTextFormatState { bold: boolean; italic: boolean; bullets: boolean; numbered: boolean; link?: string }
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
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
}

interface Marks { bold?: boolean; italic?: boolean; code?: boolean; href?: string }
interface Run extends Marks { text: string; node?: Text }
interface Line { runs: Run[]; list?: 'bullet' | 'ordered'; level: number; order?: number; element?: HTMLElement }
interface TextRecord { node: Text; start: number; end: number }
interface DocumentText { lines: Line[]; records: TextRecord[]; starts: number[]; length: number }
interface SelectionOffsets { start: number; end: number }
interface EditSnapshot { lines: Line[]; selection: SelectionOffsets }
const clean = (text: string) => text.replace(/\u200b/g, '').replace(/\u00a0/g, ' ');
const blockTags = new Set(['DIV', 'P', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
const lineText = (line: Line) => line.runs.map(run => run.text).join('');

function readDocument(root: HTMLElement): DocumentText {
  function container(element: HTMLElement, list?: Line['list'], level = 0, order?: number): Line[] {
    const lines: Line[] = [];
    let runs: Run[] = [];
    const flush = (force = false) => { if (runs.length || force) lines.push({ runs, list, level, order, element }); runs = []; };
    const visit = (node: Node, inherited: Marks = {}) => {
      if (node.nodeType === Node.TEXT_NODE) { runs.push({ ...inherited, text: clean(node.textContent ?? ''), node: node as Text }); return; }
      if (!(node instanceof HTMLElement)) return;
      if (node.tagName === 'BR') { flush(true); return; }
      if (node.tagName === 'UL' || node.tagName === 'OL') {
        flush();
        const kind = node.tagName === 'OL' ? 'ordered' : 'bullet';
        const indent = Number(node.dataset.indent ?? (list ? level + 1 : level));
        const first = Number(node.getAttribute('start') ?? 1);
        [...node.children].forEach((child, index) => lines.push(...container(child as HTMLElement, kind, indent, first + index)));
        return;
      }
      if (blockTags.has(node.tagName)) { flush(); lines.push(...container(node, list, level, order)); return; }
      const marks = { ...inherited };
      if (node.tagName === 'STRONG' || node.tagName === 'B' || Number(node.style.fontWeight) >= 600 || node.style.fontWeight === 'bold') marks.bold = true;
      if (node.tagName === 'EM' || node.tagName === 'I' || node.style.fontStyle === 'italic') marks.italic = true;
      if (node.tagName === 'CODE') marks.code = true;
      if (node.tagName === 'A') marks.href = safeHttpLink(node.getAttribute('href') ?? undefined);
      node.childNodes.forEach(child => visit(child, marks));
    };
    element.childNodes.forEach(node => visit(node));
    flush();
    return lines.length ? lines : [{ runs: [], list, level, order, element }];
  }
  const lines = container(root), records: TextRecord[] = [], starts: number[] = [];
  let at = 0;
  lines.forEach((line, index) => {
    starts.push(at);
    for (const run of line.runs) { if (run.node) records.push({ node: run.node, start: at, end: at + run.text.length }); at += run.text.length; }
    if (index < lines.length - 1) at++;
  });
  return { lines, records, starts, length: at };
}

function markdownLines(value: string): Line[] {
  return value.split(/\r?\n/).map(text => {
    const list = /^( *)(?:([-*]) |(\d+)\. )(.*)$/.exec(text);
    const body = list ? list[4]! : text;
    return { list: list ? list[3] ? 'ordered' : 'bullet' : undefined, level: list ? Math.floor(list[1]!.length / 2) : 0, order: list?.[3] ? Number(list[3]) : undefined, runs: parseInlineText(body).map(segment => {
      const marks = segment as RichTextSegment & Marks;
      return { text: segment.text, bold: marks.bold || segment.type === 'bold', italic: marks.italic || segment.type === 'italic', code: marks.code || segment.type === 'code', href: segment.href };
    }) };
  });
}

function serializeRuns(input: Run[]): string {
  const runs = input.filter(run => run.text);
  if (!runs.length) return '';
  const keys: (keyof Marks)[] = ['href', 'bold', 'italic', 'code'];
  const same = (a: Run, b: Run, key: keyof Marks) => key === 'href' ? a.href === b.href : !!a[key] === !!b[key];
  const shared = keys.find(key => runs[0]![key] && runs.every(run => same(run, runs[0]!, key)));
  const wrap = (key: keyof Marks, contents: Run[]) => {
    if (key === 'code') return `\`${contents.map(run => run.text).join('')}\``;
    const unmarked = contents.map(run => { const next = { ...run }; delete next[key]; return next; });
    const text = serializeRuns(unmarked);
    return key === 'href' ? `[${text}](${contents[0]!.href!.replace(/\(/g, '%28').replace(/\)/g, '%29')})` : key === 'bold' ? `**${text}**` : `_${text}_`;
  };
  if (shared) return wrap(shared, runs);
  let key: keyof Marks | undefined, count = 0;
  for (const candidate of keys) {
    if (!runs[0]![candidate]) continue;
    let length = 1;
    while (length < runs.length && same(runs[length]!, runs[0]!, candidate)) length++;
    if (length > count) { key = candidate; count = length; }
  }
  if (key) return wrap(key, runs.slice(0, count)) + serializeRuns(runs.slice(count));
  return runs[0]!.text.replace(/([\\*_`\[\]])/g, '\\$1') + serializeRuns(runs.slice(1));
}

function serialize(lines: Line[], singleLine = false): string {
  const counters = new Map<number, number>();
  const value = lines.map((line, index) => {
    const runs: Run[] = [];
    for (const run of line.runs) {
      const previous = runs.at(-1);
      if (previous && !!previous.bold === !!run.bold && !!previous.italic === !!run.italic && !!previous.code === !!run.code && previous.href === run.href) previous.text += run.text;
      else runs.push({ ...run });
    }
    const body = serializeRuns(runs);
    const previous = lines[index - 1];
    const order = line.list === 'ordered' && previous?.list && previous.level >= line.level && counters.has(line.level) ? counters.get(line.level)! + 1 : line.order ?? 1;
    if (line.list === 'ordered') counters.set(line.level, order);
    else if (line.list) counters.delete(line.level);
    else counters.clear();
    return `${line.list ? '  '.repeat(line.level) + (line.list === 'ordered' ? `${order}. ` : '- ') : ''}${body}`;
  }).join('\n');
  return singleLine ? value.replace(/\n/g, ' ') : value;
}

function renderDocument(root: HTMLElement, lines: Line[]) {
  const fragment = document.createDocumentFragment();
  for (const line of lines) {
    let block: HTMLElement;
    if (line.list) {
      const list = document.createElement(line.list === 'ordered' ? 'ol' : 'ul');
      list.dataset.indent = String(line.level);
      if (line.list === 'ordered') list.setAttribute('start', String(line.order ?? 1));
      Object.assign(list.style, { margin: '0', marginInlineStart: `${line.level * 1.5}em`, paddingInlineStart: '1.4em' });
      block = document.createElement('li'); list.append(block); fragment.append(list);
    } else { block = document.createElement('div'); fragment.append(block); }
    block.dataset.editorLine = '';
    for (const run of line.runs) {
      const node = document.createTextNode(run.text || '\u200b');
      let outer: Node = node;
      for (const tag of [run.code ? 'code' : '', run.italic ? 'em' : '', run.bold ? 'strong' : '', run.href ? 'a' : ''].filter(Boolean)) {
        const mark = document.createElement(tag);
        if (tag === 'a') { mark.setAttribute('href', run.href!); mark.setAttribute('rel', 'noopener noreferrer'); }
        mark.append(outer); outer = mark;
      }
      block.append(outer);
    }
    if (!block.childNodes.length) block.append(document.createElement('br'));
  }
  root.replaceChildren(fragment);
}

function selectionOffsets(root: HTMLElement, value: DocumentText): SelectionOffsets | undefined {
  const selection = root.ownerDocument.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
  const offset = (node: Node, at: number) => {
    const record = value.records.find(record => record.node === node);
    if (record) return record.start + clean((node.textContent ?? '').slice(0, at)).length;
    for (const candidate of value.records) {
      const probe = document.createRange(); probe.selectNodeContents(candidate.node);
      if (probe.comparePoint(node, at) <= 0) return candidate.start;
    }
    return value.length;
  };
  return { start: offset(range.startContainer, range.startOffset), end: offset(range.endContainer, range.endOffset) };
}

function restoreSelection(root: HTMLElement, offsets: SelectionOffsets) {
  const value = readDocument(root);
  const point = (at: number): [Node, number] => {
    const empty = value.records.find(record => record.start === at && record.end === at && record.node.textContent?.includes('\u200b'));
    if (empty) return [empty.node, 1];
    const record = value.records.find(record => at >= record.start && at <= record.end);
    if (record) return [record.node, Math.min(record.node.length, at - record.start)];
    const index = Math.max(0, value.starts.findLastIndex(start => start <= at));
    return [value.lines[index]?.element ?? root, 0];
  };
  const range = document.createRange(); range.setStart(...point(offsets.start)); range.setEnd(...point(offsets.end));
  const selection = root.ownerDocument.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
}

function selectedRuns(value: DocumentText, selection: SelectionOffsets, caret?: Node | null): Run[] {
  if (selection.start === selection.end && caret) {
    const run = value.lines.flatMap(line => line.runs).find(run => run.node === caret);
    if (run) return [run];
  }
  const runs: Run[] = [];
  value.lines.forEach((line, index) => {
    let at = value.starts[index]!;
    for (const run of line.runs) {
      if (selection.end === selection.start ? at <= selection.start && at + run.text.length >= selection.start : at < selection.end && at + run.text.length > selection.start) runs.push(run);
      at += run.text.length;
    }
  });
  return runs;
}

/** DOM selection is owned here; persistence and CAS remain with the canvas. */
const InlineTextEditor = forwardRef<InlineTextEditorHandle, InlineTextEditorProps>(function InlineTextEditor({ value, onChange, onCommit, onKeyDown, onBlur, onRequestLink, onFormatStateChange, singleLine = false, disabled, ariaLabel = '编辑文字', className = 'studio-inline-editor', style }, ref) {
  const root = useRef<HTMLDivElement>(null);
  const lastValue = useRef(value);
  const savedSelection = useRef<SelectionOffsets | undefined>(undefined);
  const savedCaret = useRef<Node | null>(null);
  const history = useRef<EditSnapshot[]>([]), future = useRef<EditSnapshot[]>([]);
  const callbacks = useRef({ onChange, onCommit, onRequestLink, onFormatStateChange, singleLine, disabled }); callbacks.current = { onChange, onCommit, onRequestLink, onFormatStateChange, singleLine, disabled };
  const publish = () => {
    if (!root.current) return;
    const doc = readDocument(root.current);
    const lines = doc.lines.map(line => ({ list: line.list, level: line.level, order: line.order, runs: line.runs.map(({ node: _node, ...run }) => run) }));
    if (JSON.stringify(lines) !== JSON.stringify(history.current.at(-1)?.lines)) {
      history.current = [...history.current.slice(-99), { lines, selection: selectionOffsets(root.current, doc) ?? savedSelection.current ?? { start: doc.length, end: doc.length } }]; future.current = [];
    }
    const markdown = serialize(doc.lines, callbacks.current.singleLine);
    lastValue.current = markdown; callbacks.current.onChange(markdown);
  };
  const capture = () => {
    if (!root.current) return;
    const doc = readDocument(root.current), selection = selectionOffsets(root.current, doc);
    if (!selection) return;
    savedSelection.current = selection;
    savedCaret.current = root.current.ownerDocument.getSelection()?.anchorNode ?? null;
    const runs = selectedRuns(doc, selection, savedCaret.current), index = Math.max(0, doc.starts.findLastIndex(start => start <= selection.start));
    callbacks.current.onFormatStateChange?.({ bold: !!runs.length && runs.every(run => run.bold), italic: !!runs.length && runs.every(run => run.italic), link: runs.length && runs.every(run => run.href === runs[0]?.href) ? runs[0]?.href : undefined, bullets: doc.lines[index]?.list === 'bullet', numbered: doc.lines[index]?.list === 'ordered' });
  };
  const mutate = (change: (doc: DocumentText, selection: SelectionOffsets) => SelectionOffsets | void) => {
    const editor = root.current; if (!editor || callbacks.current.disabled) return false;
    const doc = readDocument(editor), selection = selectionOffsets(editor, doc) ?? savedSelection.current ?? { start: 0, end: doc.length };
    const nextSelection = change(doc, selection) ?? selection;
    renderDocument(editor, doc.lines); editor.focus({ preventScroll: true }); restoreSelection(editor, nextSelection);
    savedSelection.current = nextSelection; publish(); capture(); return true;
  };
  const format = (kind: InlineTextFormat, url?: string) => {
    if (kind === 'link' && url === undefined) {
      const editor = root.current; if (!editor) return false;
      const doc = readDocument(editor), selection = selectionOffsets(editor, doc) ?? savedSelection.current ?? { start: 0, end: doc.length };
      savedSelection.current = selection; callbacks.current.onRequestLink?.(selectedRuns(doc, selection, savedCaret.current)[0]?.href ?? ''); return true;
    }
    if (kind === 'link' && url && !safeHttpLink(url)) return false;
    return mutate((doc, selection) => {
      if (kind === 'bullets' || kind === 'numbered') {
        const selected = doc.lines.filter((line, index) => doc.starts[index]! <= selection.end && doc.starts[index]! + lineText(line).length >= selection.start);
        const list = kind === 'bullets' ? 'bullet' : 'ordered', remove = selected.every(line => line.list === list);
        selected.forEach((line, index) => { line.list = remove ? undefined : list; line.order = remove ? undefined : index + 1; if (remove) line.level = 0; }); return;
      }
      const runs = selectedRuns(doc, selection, savedCaret.current), enabled = kind === 'link' ? undefined : !runs.length || !runs.every(run => run[kind]);
      const patch = (run: Run): Run => kind === 'link' ? { ...run, href: url ? safeHttpLink(url) : undefined } : { ...run, [kind]: enabled };
      let inserted = false;
      doc.lines.forEach((line, index) => {
        let at = doc.starts[index]!;
        const changed: Run[] = [];
        for (const run of line.runs) {
          const start = Math.max(0, selection.start - at), end = Math.min(run.text.length, selection.end - at);
          if (selection.start === selection.end && !inserted && start >= 0 && start <= run.text.length && at <= selection.start) {
            if (start) changed.push({ ...run, text: run.text.slice(0, start) });
            changed.push(patch({ ...run, text: '' })); inserted = true;
            if (start < run.text.length) changed.push({ ...run, text: run.text.slice(start) });
          } else if (start < end) {
            if (start) changed.push({ ...run, text: run.text.slice(0, start) });
            changed.push(patch({ ...run, text: run.text.slice(start, end) }));
            if (end < run.text.length) changed.push({ ...run, text: run.text.slice(end) });
          } else changed.push(run);
          at += run.text.length;
        }
        if (!line.runs.length && selection.start === selection.end && doc.starts[index] === selection.start) { changed.push(patch({ text: '' })); inserted = true; }
        line.runs = changed;
      });
    });
  };
  const commands = useRef({ format, capture }); commands.current = { format, capture };
  useImperativeHandle(ref, () => ({ format: (kind, url) => commands.current.format(kind, url), focus: selectAll => { const editor = root.current; if (editor) { editor.focus({ preventScroll: true }); const doc = readDocument(editor); restoreSelection(editor, selectAll ? { start: 0, end: doc.length } : savedSelection.current ?? { start: doc.length, end: doc.length }); } } }), []);
  useLayoutEffect(() => {
    const editor = root.current; if (!editor) return;
    renderDocument(editor, markdownLines(value)); editor.focus({ preventScroll: true });
    const length = readDocument(editor).length; restoreSelection(editor, { start: length, end: length });
    history.current = [{ lines: markdownLines(value), selection: { start: length, end: length } }];
    const selectionChanged = () => commands.current.capture();
    document.addEventListener('selectionchange', selectionChanged);
    return () => document.removeEventListener('selectionchange', selectionChanged);
  }, []);
  useLayoutEffect(() => {
    const editor = root.current;
    if (!editor || value === lastValue.current) return;
    const previous = selectionOffsets(editor, readDocument(editor));
    lastValue.current = value; renderDocument(editor, markdownLines(value));
    const length = readDocument(editor).length, selection = previous ? { start: Math.min(previous.start, length), end: Math.min(previous.end, length) } : { start: length, end: length };
    if (document.activeElement === editor) restoreSelection(editor, selection);
    history.current = [{ lines: markdownLines(value), selection }]; future.current = [];
  }, [value]);
  const changeHistory = (redo: boolean) => {
    const editor = root.current; if (!editor || disabled) return;
    let snapshot: EditSnapshot | undefined;
    if (redo) { snapshot = future.current.pop(); if (snapshot) history.current.push(snapshot); }
    else if (history.current.length > 1) { future.current.push(history.current.pop()!); snapshot = history.current.at(-1); }
    if (!snapshot) return;
    renderDocument(editor, snapshot.lines); editor.focus({ preventScroll: true }); restoreSelection(editor, snapshot.selection);
    savedSelection.current = snapshot.selection; lastValue.current = serialize(snapshot.lines, singleLine); onChange(lastValue.current); capture();
  };
  const indent = (out: boolean) => mutate((doc, selection) => {
    doc.lines.forEach((line, index) => { if (line.list && doc.starts[index]! <= selection.end && doc.starts[index]! + lineText(line).length >= selection.start) line.level = Math.min(6, Math.max(0, line.level + (out ? -1 : 1))); });
  });
  return <div ref={root} className={className} style={{ outline: 'none', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', ...style }} role="textbox" aria-label={ariaLabel} aria-multiline={!singleLine} aria-disabled={disabled || undefined} contentEditable={!disabled} suppressContentEditableWarning data-native-interactive="true" onPointerDown={event => event.stopPropagation()} onPointerUp={capture} onKeyUp={capture} onInput={() => { capture(); publish(); }} onBlur={event => {
    capture();
    onBlur?.(event);
    if (event.defaultPrevented) return;
    if (!(event.relatedTarget instanceof Element && event.relatedTarget.closest('.studio-selection-toolbar'))) callbacks.current.onCommit(false);
  }} onPaste={event => {
    event.preventDefault(); event.stopPropagation();
    const selection = root.current?.ownerDocument.getSelection(); if (!root.current || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0); range.deleteContents();
    const text = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
    const fragment = document.createDocumentFragment();
    (singleLine ? text.replace(/\n/g, ' ') : text).split('\n').forEach((line, index) => { if (index) fragment.append(document.createElement('br')); fragment.append(document.createTextNode(line)); });
    const last = fragment.lastChild!;
    range.insertNode(fragment); range.setStartAfter(last); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); publish(); capture();
  }} onKeyDown={event => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;
    const command = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
    if (command && !event.altKey && (key === 'z' || key === 'y')) { event.preventDefault(); changeHistory(key === 'y' || event.shiftKey); return; }
    if (command && !event.altKey && ['b', 'i', 'k'].includes(key)) { event.preventDefault(); format(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'link'); return; }
    if (command && event.shiftKey && (['7', '8'].includes(key) || ['Digit7', 'Digit8'].includes(event.code))) { event.preventDefault(); format(key === '7' || event.code === 'Digit7' ? 'numbered' : 'bullets'); return; }
    if (event.key === 'Escape' || event.key === 'Enter' && (command || singleLine)) { event.preventDefault(); publish(); callbacks.current.onCommit(event.key === 'Enter' && command); return; }
    const editor = root.current; if (!editor) return;
    const doc = readDocument(editor), selection = selectionOffsets(editor, doc);
    if (!selection) return;
    const index = Math.max(0, doc.starts.findLastIndex(start => start <= selection.start)), line = doc.lines[index]!;
    if (event.key === 'Tab' && !command && !event.altKey && line.list) { event.preventDefault(); indent(event.shiftKey); }
    else if (line.list && (event.key === 'Enter' && !lineText(line) || event.key === 'Backspace' && selection.start === selection.end && selection.start === doc.starts[index])) {
      event.preventDefault(); mutate(value => { const line = value.lines[index]!; if (line.level) line.level--; else line.list = undefined; });
    }
  }} />;
});

export default InlineTextEditor;
