import { readDocument } from './editor-document.js';
import { cleanText } from './editor-model.js';
import type { DocumentText, Run, SelectionOffsets } from './editor-model.js';

export function selectionOffsets(
  root: HTMLElement,
  value: DocumentText,
): SelectionOffsets | undefined {
  const selection = root.ownerDocument.getSelection();
  if (!selection?.rangeCount) {
    return;
  }

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    return;
  }

  const offset = (node: Node, at: number) => {
    const record = value.records.find((record) => record.node === node);
    if (record) {
      return record.start + cleanText((node.textContent ?? '').slice(0, at)).length;
    }

    for (const candidate of value.records) {
      const probe = root.ownerDocument.createRange();
      probe.selectNodeContents(candidate.node);
      if (probe.comparePoint(node, at) <= 0) {
        return candidate.start;
      }
    }
    return value.length;
  };

  return {
    start: offset(range.startContainer, range.startOffset),
    end: offset(range.endContainer, range.endOffset),
  };
}

export function restoreSelection(root: HTMLElement, offsets: SelectionOffsets) {
  const value = readDocument(root);
  const point = (at: number): [Node, number] => {
    const empty = value.records.find(
      (record) =>
        record.start === at && record.end === at && record.node.textContent?.includes('\u200b'),
    );

    if (empty) {
      return [empty.node, 1];
    }

    const record = value.records.find((record) => at >= record.start && at <= record.end);
    if (record) {
      return [record.node, Math.min(record.node.length, at - record.start)];
    }

    const index = Math.max(
      0,
      value.starts.findLastIndex((start) => start <= at),
    );

    return [value.lines[index]?.element ?? root, 0];
  };
  const range = root.ownerDocument.createRange();
  range.setStart(...point(offsets.start));
  range.setEnd(...point(offsets.end));
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function selectedRuns(
  value: DocumentText,
  selection: SelectionOffsets,
  caret?: Node | null,
): Run[] {
  if (selection.start === selection.end && caret) {
    const run = value.lines.flatMap((line) => line.runs).find((run) => run.node === caret);
    if (run) {
      return [run];
    }
  }
  const runs: Run[] = [];
  value.lines.forEach((line, index) => {
    let at = value.starts[index]!;
    for (const run of line.runs) {
      if (
        selection.end === selection.start
          ? at <= selection.start && at + run.text.length >= selection.start
          : at < selection.end && at + run.text.length > selection.start
      ) {
        runs.push(run);
      }
      at += run.text.length;
    }
  });

  return runs;
}

function wholeLink(value: DocumentText, run: Run, href: string) {
  for (const [index, { runs }] of value.lines.entries()) {
    const at = runs.indexOf(run);
    if (at === -1) {
      continue;
    }

    let first = at;
    let last = at + 1;
    while (runs[first - 1]?.href === href) {
      first--;
    }
    while (runs[last]?.href === href) {
      last++;
    }

    const start = runs
      .slice(0, first)
      .reduce((offset, item) => offset + item.text.length, value.starts[index]!);
    const end = runs.slice(first, last).reduce((offset, item) => offset + item.text.length, start);

    return { start, end };
  }
}

export function selectedLink(
  value: DocumentText,
  selection: SelectionOffsets,
  caret?: Node | null,
) {
  const runs = selectedRuns(value, selection, caret);
  const run = runs[0];
  const href = run?.href;
  if (!run || !href || !runs.every((item) => item.href === href)) {
    return undefined;
  }

  const range = selection.start === selection.end ? wholeLink(value, run, href) : undefined;

  return { href, selection: range ?? selection };
}
