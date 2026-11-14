export interface HistoryUnitDiff { id: string; before: unknown; after: unknown }
export type HistoryDiffLine = { kind: ' ' | '+' | '-' | '~'; text: string };
export interface HistoryTextDiff { added: number; removed: number; lines: HistoryDiffLine[]; tooLarge?: boolean; truncated?: boolean }

function clean(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['id', 'version', 'sourceRevision'].includes(key)));
}
function text(value: unknown): string { return value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2); }
/** Preserve source text, while keeping combined content/property edits visible. */
export function historyUnitText(change: HistoryUnitDiff): [string, string] {
  const before = clean(change.before), after = clean(change.after);
  const a = before && typeof before === 'object' && !Array.isArray(before) ? before as Record<string, unknown> : undefined;
  const b = after && typeof after === 'object' && !Array.isArray(after) ? after as Record<string, unknown> : undefined;
  const key = typeof a?.html === 'string' || typeof b?.html === 'string' ? 'html' : typeof a?.text === 'string' || typeof b?.text === 'string' ? 'text' : undefined;
  if (!key) return [text(before), text(after)];
  const withoutBody = (value?: Record<string, unknown>) => value && Object.fromEntries(Object.entries(value).filter(([field]) => field !== key));
  const propertiesEqual = JSON.stringify(withoutBody(a)) === JSON.stringify(withoutBody(b));
  if (!a || !b || propertiesEqual) return [text(a?.[key]), text(b?.[key])];
  if (a[key] === b[key]) return [text(withoutBody(a)), text(withoutBody(b))];
  return [text(before), text(after)];
}
export function historyUnitLabel(id: string): string { return id === '$style' ? '白板样式' : id === '$motion' ? '动画设置' : id === '$order' ? '对象层级' : `元素 · ${id}`; }
export function historyChangeKind(change: HistoryUnitDiff): '新增' | '删除' | '修改' { return change.before === null || change.before === undefined ? '新增' : change.after === null || change.after === undefined ? '删除' : '修改'; }

// Myers line diff, bounded like the reference editor to avoid blocking on large HTML.
function editScript(left: string[], right: string[]): ('=' | '+' | '-')[] | null {
  const limit = Math.min(left.length + right.length, 2000), offset = limit + 1;
  const frontier = new Int32Array(limit * 2 + 3), trace: Int32Array[] = [];
  let distance = -1;
  for (let depth = 0; depth <= limit; depth++) {
    trace.push(frontier.slice(offset - depth - 1, offset + depth + 2));
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      let x = diagonal === -depth || diagonal !== depth && frontier[offset + diagonal - 1]! < frontier[offset + diagonal + 1]! ? frontier[offset + diagonal + 1]! : frontier[offset + diagonal - 1]! + 1;
      let y = x - diagonal;
      while (x < left.length && y < right.length && left[x] === right[y]) { x++; y++; }
      frontier[offset + diagonal] = x;
      if (x >= left.length && y >= right.length) { distance = depth; break; }
    }
    if (distance >= 0) break;
  }
  if (distance < 0) return null;
  const result: ('=' | '+' | '-')[] = [];
  let x = left.length, y = right.length;
  for (let depth = distance; depth > 0; depth--) {
    const previous = trace[depth]!, at = (diagonal: number) => previous[diagonal + depth + 1]!;
    const diagonal = x - y, previousDiagonal = diagonal === -depth || diagonal !== depth && at(diagonal - 1) < at(diagonal + 1) ? diagonal + 1 : diagonal - 1;
    const previousX = at(previousDiagonal), previousY = previousX - previousDiagonal;
    while (x > previousX && y > previousY) { result.push('='); x--; y--; }
    result.push(x === previousX ? '+' : '-'); x = previousX; y = previousY;
  }
  while (x > 0 && y > 0) { result.push('='); x--; y--; }
  return result.reverse();
}
export function diffHistoryText(before: string, after: string): HistoryTextDiff {
  if (before.length > 1024 * 1024 || after.length > 1024 * 1024) return { added: 0, removed: 0, lines: [], tooLarge: true };
  const split = (value: string) => value ? value.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n') : [];
  const left = split(before), right = split(after);
  let head = 0, tail = 0;
  while (head < left.length && head < right.length && left[head] === right[head]) head++;
  while (tail < left.length - head && tail < right.length - head && left[left.length - tail - 1] === right[right.length - tail - 1]) tail++;
  const middle = editScript(left.slice(head, left.length - tail), right.slice(head, right.length - tail));
  if (!middle) return { added: 0, removed: 0, lines: [], tooLarge: true };
  const ops = [...Array<'='>(head).fill('='), ...middle, ...Array<'='>(tail).fill('=')];
  let a = 0, b = 0, added = 0, removed = 0;
  const all: HistoryDiffLine[] = ops.map(op => {
    const line = op === '-' ? left[a++]! : op === '+' ? right[b++]! : (a++, right[b++]!);
    if (op === '+') added++; if (op === '-') removed++;
    return { kind: op === '=' ? ' ' : op, text: line.length > 2000 ? `${line.slice(0, 2000)}…` : line };
  });
  const keep = new Uint8Array(all.length);
  all.forEach((line, index) => { if (line.kind !== ' ') for (let at = Math.max(0, index - 3); at <= Math.min(all.length - 1, index + 3); at++) keep[at] = 1; });
  const lines: HistoryDiffLine[] = []; let skipped = 0;
  for (let index = 0; index < all.length; index++) {
    if (!keep[index]) { skipped++; continue; }
    if (skipped) { lines.push({ kind: '~', text: String(skipped) }); skipped = 0; }
    if (lines.length >= 3000) return { added, removed, lines, truncated: true };
    lines.push(all[index]!);
  }
  if (skipped) lines.push({ kind: '~', text: String(skipped) });
  return { added, removed, lines };
}
