export interface Marks {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  href?: string;
}
export interface Run extends Marks {
  text: string;
  node?: Text;
}
export interface Line {
  runs: Run[];
  list?: 'bullet' | 'ordered';
  level: number;
  order?: number;
  element?: HTMLElement;
}
export interface TextRecord {
  node: Text;
  start: number;
  end: number;
}
export interface DocumentText {
  lines: Line[];
  records: TextRecord[];
  starts: number[];
  length: number;
}
export interface SelectionOffsets {
  start: number;
  end: number;
}
export interface EditSnapshot {
  lines: Line[];
  selection: SelectionOffsets;
}

export function cleanText(text: string) {
  return text.replace(/\u200b/g, '').replace(/\u00a0/g, ' ');
}

export function lineText(line: Line) {
  return line.runs.map((run) => run.text).join('');
}

export function snapshotLines(lines: Line[]): Line[] {
  return lines.map(({ list, level, order, runs }) => ({
    list,
    level,
    order,
    runs: runs.map(({ text, bold, italic, code, href }) => ({ text, bold, italic, code, href })),
  }));
}

function sameRun(left: Run, right: Run | undefined) {
  return (
    right &&
    left.text === right.text &&
    left.bold === right.bold &&
    left.italic === right.italic &&
    left.code === right.code &&
    left.href === right.href
  );
}

function sameLine(left: Line, right: Line | undefined) {
  return (
    right &&
    left.list === right.list &&
    left.level === right.level &&
    left.order === right.order &&
    left.runs.length === right.runs.length &&
    left.runs.every((run, index) => sameRun(run, right.runs[index]))
  );
}

export function sameEditLines(left: Line[], right: Line[] | undefined) {
  return (
    right &&
    left.length === right.length &&
    left.every((line, index) => sameLine(line, right[index]))
  );
}
