import { lineText } from './editor-model.js';
import type { DocumentText, Run, SelectionOffsets } from './editor-model.js';

function selectedLines(doc: DocumentText, selection: SelectionOffsets) {
  return doc.lines.filter((line, index) => {
    const start = doc.starts[index]!;

    return start <= selection.end && start + lineText(line).length >= selection.start;
  });
}

export function toggleList(
  document: DocumentText,
  selection: SelectionOffsets,
  list: 'bullet' | 'ordered',
) {
  const lines = selectedLines(document, selection);
  const remove = lines.every((line) => line.list === list);
  lines.forEach((line, index) => {
    line.list = remove ? undefined : list;
    line.order = remove ? undefined : index + 1;
    if (remove) {
      line.level = 0;
    }
  });
}

const maxListIndent = 6;

export function indentList(doc: DocumentText, selection: SelectionOffsets, out: boolean) {
  for (const line of selectedLines(doc, selection)) {
    if (line.list) {
      line.level = Math.min(maxListIndent, Math.max(0, line.level + (out ? -1 : 1)));
    }
  }
}

function splitRun(run: Run, start: number, end: number, patch: (run: Run) => Run) {
  const changed: Run[] = [];
  if (start) {
    changed.push({ ...run, text: run.text.slice(0, start) });
  }

  changed.push(patch({ ...run, text: run.text.slice(start, end) }));
  if (end < run.text.length) {
    changed.push({ ...run, text: run.text.slice(end) });
  }

  return changed;
}

export function patchSelectedRuns(
  doc: DocumentText,
  selection: SelectionOffsets,
  patch: (run: Run) => Run,
) {
  const collapsed = selection.start === selection.end;
  let inserted = false;
  doc.lines.forEach((line, index) => {
    let at = doc.starts[index]!;
    const changed: Run[] = [];
    for (const run of line.runs) {
      const start = Math.max(0, selection.start - at);
      const end = Math.min(run.text.length, selection.end - at);
      const caretInRun = start <= run.text.length && at <= selection.start;
      if (collapsed && !inserted && caretInRun) {
        changed.push(...splitRun(run, start, start, patch));
        inserted = true;
      } else if (start < end) {
        changed.push(...splitRun(run, start, end, patch));
      } else {
        changed.push(run);
      }

      at += run.text.length;
    }

    if (!line.runs.length && collapsed && doc.starts[index] === selection.start) {
      changed.push(patch({ text: '' }));
      inserted = true;
    }

    line.runs = changed;
  });
}
