import type { ArtifactDiffUnit } from '../../../contracts/studio';

export type HistoryUnitDiff = ArtifactDiffUnit;
export type HistoryDiffLine = { kind: ' ' | '+' | '-' | '~'; text: string };
export interface HistoryTextDiff {
  added: number;
  removed: number;
  lines: HistoryDiffLine[];
  tooLarge?: boolean;
  truncated?: boolean;
}

function fields(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return;
  }

  return value as Record<string, unknown>;
}

function clean(value: unknown): unknown {
  const source = fields(value);
  if (!source) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(source).filter(([key]) => !['id', 'version', 'sourceRevision'].includes(key)),
  );
}

function text(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function bodyField(a: ReturnType<typeof fields>, b: ReturnType<typeof fields>) {
  if (typeof a?.html === 'string' || typeof b?.html === 'string') {
    return 'html';
  }
  if (typeof a?.text === 'string' || typeof b?.text === 'string') {
    return 'text';
  }
}

export function historyUnitText(change: HistoryUnitDiff): [string, string] {
  const before = clean(change.before);
  const after = clean(change.after);
  const a = fields(before);
  const b = fields(after);
  const key = bodyField(a, b);
  if (!key) {
    return [text(before), text(after)];
  }

  const withoutBody = (value?: Record<string, unknown>) =>
    value && Object.fromEntries(Object.entries(value).filter(([field]) => field !== key));
  const propertiesEqual = JSON.stringify(withoutBody(a)) === JSON.stringify(withoutBody(b));
  if (!a || !b || propertiesEqual) {
    return [text(a?.[key]), text(b?.[key])];
  }
  if (a[key] === b[key]) {
    return [text(withoutBody(a)), text(withoutBody(b))];
  }

  return [text(before), text(after)];
}

export function historyUnitLabel(id: string): string {
  switch (id) {
    case '$style':
      return '白板样式';
    case '$motion':
      return '动画设置';
    case '$order':
      return '对象层级';
    default:
      return `元素 · ${id}`;
  }
}

export function historyChangeKind(change: HistoryUnitDiff): '新增' | '删除' | '修改' {
  if (change.before === null || change.before === undefined) {
    return '新增';
  }

  return change.after === null || change.after === undefined ? '删除' : '修改';
}

function preferInsertion(diagonal: number, depth: number, deletionX: number, insertionX: number) {
  return diagonal === -depth || (diagonal !== depth && deletionX < insertionX);
}

function editScript(left: string[], right: string[]): ('=' | '+' | '-')[] | null {
  const limit = Math.min(left.length + right.length, 2000);
  const offset = limit + 1;
  const frontier = new Int32Array(limit * 2 + 3);
  const trace: Int32Array[] = [];
  let distance = -1;
  for (let depth = 0; depth <= limit; depth++) {
    trace.push(frontier.slice(offset - depth - 1, offset + depth + 2));
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      let x = preferInsertion(
        diagonal,
        depth,
        frontier[offset + diagonal - 1]!,
        frontier[offset + diagonal + 1]!,
      )
        ? frontier[offset + diagonal + 1]!
        : frontier[offset + diagonal - 1]! + 1;
      let y = x - diagonal;
      while (x < left.length && y < right.length && left[x] === right[y]) {
        x++;
        y++;
      }

      frontier[offset + diagonal] = x;
      if (x >= left.length && y >= right.length) {
        distance = depth;
        break;
      }
    }

    if (distance >= 0) {
      break;
    }
  }

  if (distance < 0) {
    return null;
  }

  const result: ('=' | '+' | '-')[] = [];
  let x = left.length;
  let y = right.length;
  for (let depth = distance; depth > 0; depth--) {
    const previous = trace[depth]!;
    const at = (diagonal: number) => previous[diagonal + depth + 1]!;
    const diagonal = x - y;
    const previousDiagonal = preferInsertion(diagonal, depth, at(diagonal - 1), at(diagonal + 1))
      ? diagonal + 1
      : diagonal - 1;
    const previousX = at(previousDiagonal);
    const previousY = previousX - previousDiagonal;
    while (x > previousX && y > previousY) {
      result.push('=');
      x--;
      y--;
    }

    result.push(x === previousX ? '+' : '-');
    x = previousX;
    y = previousY;
  }

  while (x > 0 && y > 0) {
    result.push('=');
    x--;
    y--;
  }

  return result.reverse();
}

export function diffHistoryText(before: string, after: string): HistoryTextDiff {
  if (before.length > 1024 * 1024 || after.length > 1024 * 1024) {
    return { added: 0, removed: 0, lines: [], tooLarge: true };
  }

  const split = (value: string) =>
    value ? value.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n') : [];
  const left = split(before);
  const right = split(after);
  let head = 0;
  let tail = 0;
  while (head < left.length && head < right.length && left[head] === right[head]) {
    head++;
  }

  while (
    tail < left.length - head &&
    tail < right.length - head &&
    left[left.length - tail - 1] === right[right.length - tail - 1]
  ) {
    tail++;
  }

  const middle = editScript(
    left.slice(head, left.length - tail),
    right.slice(head, right.length - tail),
  );

  if (!middle) {
    return { added: 0, removed: 0, lines: [], tooLarge: true };
  }

  const ops = [...Array<'='>(head).fill('='), ...middle, ...Array<'='>(tail).fill('=')];
  let a = 0;
  let b = 0;
  let added = 0;
  let removed = 0;
  const all: HistoryDiffLine[] = ops.map((op) => {
    if (op === '=') {
      a++;
    }

    const line = op === '-' ? left[a++]! : right[b++]!;
    if (op === '+') {
      added++;
    }
    if (op === '-') {
      removed++;
    }

    return {
      kind: op === '=' ? ' ' : op,
      text: line.length > 2000 ? `${line.slice(0, 2000)}…` : line,
    };
  });
  const keep = new Uint8Array(all.length);
  all.forEach((line, index) => {
    if (line.kind !== ' ') {
      for (let at = Math.max(0, index - 3); at <= Math.min(all.length - 1, index + 3); at++) {
        keep[at] = 1;
      }
    }
  });
  const lines: HistoryDiffLine[] = [];
  let skipped = 0;
  for (let index = 0; index < all.length; index++) {
    if (!keep[index]) {
      skipped++;
      continue;
    }
    if (skipped) {
      lines.push({ kind: '~', text: String(skipped) });
      skipped = 0;
    }
    if (lines.length >= 3000) {
      return { added, removed, lines, truncated: true };
    }

    lines.push(all[index]!);
  }

  if (skipped) {
    lines.push({ kind: '~', text: String(skipped) });
  }

  return { added, removed, lines };
}
