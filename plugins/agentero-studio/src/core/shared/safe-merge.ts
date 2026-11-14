/*!
 * Line-diff implementation adapted from open-artifacts, MIT License.
 * Copyright (c) 2026 Jim Liu 宝玉
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const encoder = new TextEncoder(), decoder = new TextDecoder();

export function jsonEqual(left: unknown, right: unknown, depth = 0): boolean {
  if (left === right) return true;
  if (depth > 64) return false;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => jsonEqual(value, right[index], depth + 1));
  if (!object(left) || !object(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && jsonEqual(left[key], right[key], depth + 1));
}
interface Hunk { start: number; end: number; lines: string[]; local: boolean }
function hunks(base: string[], side: string[], local: boolean): Hunk[] | undefined {
  const limit = Math.min(base.length + side.length, 512), offset = limit + 1, v = new Int32Array(2 * limit + 3), trace: Int32Array[] = [];
  let found = -1;
  for (let distance = 0; distance <= limit; distance++) {
    trace.push(v.slice(offset - distance - 1, offset + distance + 2));
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      let x = diagonal === -distance || diagonal !== distance && v[offset + diagonal - 1]! < v[offset + diagonal + 1]! ? v[offset + diagonal + 1]! : v[offset + diagonal - 1]! + 1;
      let y = x - diagonal;
      while (x < base.length && y < side.length && base[x] === side[y]) { x++; y++; }
      v[offset + diagonal] = x;
      if (x >= base.length && y >= side.length) { found = distance; break; }
    }
    if (found >= 0) break;
  }
  if (found < 0) return;
  const ops: string[] = []; let x = base.length, y = side.length;
  for (let distance = found; distance > 0; distance--) {
    const previous = trace[distance]!, diagonal = x - y, at = (value: number) => previous[value + distance + 1]!;
    const previousDiagonal = diagonal === -distance || diagonal !== distance && at(diagonal - 1) < at(diagonal + 1) ? diagonal + 1 : diagonal - 1;
    const previousX = at(previousDiagonal), previousY = previousX - previousDiagonal;
    while (x > previousX && y > previousY) { ops.push('='); x--; y--; }
    ops.push(x === previousX ? '+' : '-'); x = previousX; y = previousY;
  }
  while (x > 0 && y > 0) { ops.push('='); x--; y--; }
  const result: Hunk[] = []; let open: Hunk | undefined, i = 0, j = 0;
  for (const op of ops.reverse()) {
    if (op === '=') { open = undefined; i++; j++; continue; }
    if (!open) { open = { start: i, end: i, lines: [], local }; result.push(open); }
    if (op === '-') open.end = ++i; else open.lines.push(side[j++]!);
  }
  return result.flatMap(hunk => hunk.end - hunk.start > 1 && hunk.lines.length === hunk.end - hunk.start
    ? hunk.lines.flatMap((line, index) => line === base[hunk.start + index] ? [] : [{ ...hunk, start: hunk.start + index, end: hunk.start + index + 1, lines: [line] }]) : [hunk]);
}
function applyHunks(base: string[], start: number, end: number, changes: Hunk[]): string[] {
  const result: string[] = []; let at = start;
  for (const change of changes) { result.push(...base.slice(at, change.start), ...change.lines); at = change.end; }
  result.push(...base.slice(at, end)); return result;
}
function mergeText(base: string, local: string, current: string, path: string, conflicts: string[]): string | undefined {
  const lines = base.split('\n'), mine = local.split('\n'), theirs = current.split('\n');
  if (Math.max(lines.length, mine.length, theirs.length) > 10_000) return;
  const a = hunks(lines, mine, true), b = hunks(lines, theirs, false); if (!a || !b) return;
  const all = [...a, ...b].sort((left, right) => left.start - right.start || left.end - right.end), result: string[] = []; let done = 0;
  for (let i = 0; i < all.length;) {
    const region = [all[i++]!], start = region[0]!.start; let end = region[0]!.end;
    for (; i < all.length; i++) {
      const next = all[i]!;
      if (!(next.start < end || next.start === next.end && start === end && next.start === start)) break;
      region.push(next); end = Math.max(end, next.end);
    }
    result.push(...lines.slice(done, start));
    if (region.every(change => change.local === region[0]!.local)) result.push(...applyHunks(lines, start, end, region));
    else {
      const l = applyHunks(lines, start, end, region.filter(change => change.local)), r = applyHunks(lines, start, end, region.filter(change => !change.local));
      if (!jsonEqual(l, r)) conflicts.push(`${path || '.'}@${start + 1}`);
      result.push(...l);
    }
    done = end;
  }
  result.push(...lines.slice(done)); return result.join('\n');
}
/** The caller must reject any conflicts; result is never an incoming-wins fallback. */
export function mergeJson(base: unknown, local: unknown, current: unknown, matrixPaths: readonly string[] = []): { result: unknown; conflicts: string[] } {
  const conflicts: string[] = [];
  const merge = (b: unknown, l: unknown, c: unknown, path: string, depth = 0): unknown => {
    if (depth > 64) { conflicts.push(path || '.'); return c; }
    if (jsonEqual(l, b)) return c;
    if (jsonEqual(c, b) || jsonEqual(l, c)) return l;
    if (object(b) && object(l) && object(c)) {
      const result: Record<string, unknown> = {};
      for (const key of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(c)])) {
        if (key === '__proto__') continue;
        const value = merge(b[key], l[key], c[key], path ? `${path}.${key}` : key, depth + 1);
        if (value !== undefined) result[key] = value;
      }
      return result;
    }
    if (matrixPaths.includes(path) && Array.isArray(b) && Array.isArray(l) && Array.isArray(c) && b.length === l.length && b.length === c.length && b.every((row, i) => Array.isArray(row) && Array.isArray(l[i]) && Array.isArray(c[i]) && row.length === l[i].length && row.length === c[i].length)) {
      return b.map((row: unknown[], i) => row.map((value, j) => merge(value, l[i][j], c[i][j], `${path}[${i}][${j}]`, depth + 1)));
    }
    if (typeof b === 'string' && typeof l === 'string' && typeof c === 'string') {
      const value = mergeText(b, l, c, path, conflicts); if (value !== undefined) return value;
    }
    conflicts.push(path || '.'); return c;
  };
  return { result: merge(base, local, current, ''), conflicts: [...new Set(conflicts)] };
}
/** Keep error responses bounded even when a conflict involves megabytes of HTML. */
export function mergeConflictDetails(base: unknown, local: unknown, current: unknown, paths: readonly string[]) {
  let truncated = paths.length > 32;
  const preview = (value: unknown) => {
    const encoded = JSON.stringify(value) ?? 'null';
    const bytes = encoder.encode(encoded);
    if (bytes.length <= 2048) return value ?? null;
    truncated = true; return { preview: decoder.decode(bytes.subarray(0, 1000)), truncated: true };
  };
  const values = { base: preview(base), local: preview(local), current: preview(current) };
  const boundedPaths = paths.slice(0, 32).map(path => {
    const bytes = encoder.encode(path);
    if (bytes.length <= 160) return path;
    truncated = true; return decoder.decode(bytes.subarray(0, 156)) + '…';
  });
  return { paths: boundedPaths, ...values, ...(truncated ? { truncated: true } : {}) };
}
