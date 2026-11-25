import { cleanText } from './editor-model.js';
import type { DocumentText, Line, Marks, Run, TextRecord } from './editor-model.js';
import { safeHttpLink } from './rich-text.js';

const blockTags = new Set(['DIV', 'P', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

function readMarks(node: HTMLElement, inherited: Marks): Marks {
  const marks = { ...inherited };
  const boldTag = node.tagName === 'STRONG' || node.tagName === 'B';
  const boldWeight = Number(node.style.fontWeight) >= 600 || node.style.fontWeight === 'bold';
  if (boldTag || boldWeight) {
    marks.bold = true;
  }
  if (node.tagName === 'EM' || node.tagName === 'I' || node.style.fontStyle === 'italic') {
    marks.italic = true;
  }
  if (node.tagName === 'CODE') {
    marks.code = true;
  }
  if (node.tagName === 'A') {
    marks.href = safeHttpLink(node.getAttribute('href') ?? undefined);
  }
  return marks;
}

export function readDocument(root: HTMLElement): DocumentText {
  function container(element: HTMLElement, list?: Line['list'], level = 0, order?: number): Line[] {
    const lines: Line[] = [];
    let runs: Run[] = [];
    const flush = (force = false) => {
      if (runs.length || force) {
        lines.push({ runs, list, level, order, element });
      }
      runs = [];
    };
    const visit = (node: Node, inherited: Marks = {}) => {
      if (node.nodeType === Node.TEXT_NODE) {
        runs.push({ ...inherited, text: cleanText(node.textContent ?? ''), node: node as Text });
        return;
      }
      if (!(node instanceof HTMLElement)) {
        return;
      }

      if (node.tagName === 'BR') {
        flush(true);
        return;
      }
      if (node.tagName === 'UL' || node.tagName === 'OL') {
        flush();
        const kind = node.tagName === 'OL' ? 'ordered' : 'bullet';
        const indent = Number(node.dataset.indent ?? (list ? level + 1 : level));
        const first = Number(node.getAttribute('start') ?? 1);
        [...node.children].forEach((child, index) =>
          lines.push(...container(child as HTMLElement, kind, indent, first + index)),
        );

        return;
      }
      if (blockTags.has(node.tagName)) {
        flush();
        lines.push(...container(node, list, level, order));
        return;
      }
      const marks = readMarks(node, inherited);
      node.childNodes.forEach((child) => visit(child, marks));
    };
    element.childNodes.forEach((node) => visit(node));
    flush();
    return lines.length ? lines : [{ runs: [], list, level, order, element }];
  }
  const lines = container(root);
  const records: TextRecord[] = [];
  const starts: number[] = [];
  let at = 0;
  lines.forEach((line, index) => {
    starts.push(at);
    for (const run of line.runs) {
      if (run.node) {
        records.push({ node: run.node, start: at, end: at + run.text.length });
      }
      at += run.text.length;
    }
    if (index < lines.length - 1) {
      at++;
    }
  });

  return { lines, records, starts, length: at };
}

function renderRun(document: Document, run: Run): Node {
  let outer: Node = document.createTextNode(run.text || '\u200b');
  const tags = [
    run.code ? 'code' : '',
    run.italic ? 'em' : '',
    run.bold ? 'strong' : '',
    run.href ? 'a' : '',
  ].filter(Boolean);

  for (const tag of tags) {
    const mark = document.createElement(tag);
    if (tag === 'a') {
      mark.setAttribute('href', run.href!);
      mark.setAttribute('rel', 'noopener noreferrer');
    }
    mark.append(outer);
    outer = mark;
  }
  return outer;
}

export function renderDocument(root: HTMLElement, lines: Line[]) {
  const document = root.ownerDocument;
  const fragment = document.createDocumentFragment();
  for (const line of lines) {
    let block: HTMLElement;
    if (line.list) {
      const list = document.createElement(line.list === 'ordered' ? 'ol' : 'ul');
      list.dataset.indent = String(line.level);
      if (line.list === 'ordered') {
        list.setAttribute('start', String(line.order ?? 1));
      }
      Object.assign(list.style, {
        margin: '0',
        marginInlineStart: `${line.level * 1.5}em`,
        paddingInlineStart: '1.4em',
      });
      block = document.createElement('li');
      list.append(block);
      fragment.append(list);
    } else {
      block = document.createElement('div');
      fragment.append(block);
    }
    block.dataset.editorLine = '';
    for (const run of line.runs) {
      block.append(renderRun(document, run));
    }
    if (!block.childNodes.length) {
      block.append(document.createElement('br'));
    }
  }
  root.replaceChildren(fragment);
}
