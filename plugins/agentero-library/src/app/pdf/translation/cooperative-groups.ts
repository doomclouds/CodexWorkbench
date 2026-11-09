// Reading-line behavior adapted from motif (Copyright (c) 2026 poco-ai, MIT).
// See MOTIF-LICENSE.txt. Cache medians and yield so page-wide grouping cannot monopolize the UI.
import { type Character, unionBoxes } from './types';

function insert(values: number[], value: number) { let a = 0; let b = values.length; while (a < b) { const m = (a + b) >>> 1; if (values[m] <= value) a = m + 1; else b = m; } values.splice(a, 0, value); }
function median(sorted: number[]) { const n = sorted.length; const m = n >>> 1; return n % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2; }

export async function cooperativeCharacterGroups(chars: readonly Character[], checkpoint: () => Promise<void>): Promise<Character[][]> {
  const ordered = chars.slice().sort((a, b) => a.box.y + a.box.h - b.box.y - b.box.h || a.box.x - b.box.x);
  const lines: { items: Character[]; bottoms: number[]; heights: number[] }[] = [];
  let steps = 0;
  for (const char of ordered) {
    let best: typeof lines[number] | undefined; let distance = Infinity; const bottom = char.box.y + char.box.h;
    for (const line of lines) {
      if (++steps % 128 === 0) await checkpoint();
      const delta = Math.abs(bottom - median(line.bottoms)); const height = Math.min(char.box.h, median(line.heights));
      if (delta <= Math.max(1.5, height * .45) && delta < distance) { best = line; distance = delta; }
    }
    if (best) { best.items.push(char); insert(best.bottoms, bottom); insert(best.heights, char.box.h); }
    else lines.push({ items: [char], bottoms: [bottom], heights: [char.box.h] });
    if (++steps % 128 === 0) await checkpoint();
  }
  const groups: Character[][] = [];
  for (const line of lines) {
    line.items.sort((a, b) => a.box.x - b.box.x); let group: Character[] = [];
    for (const char of line.items) {
      const previous = group.at(-1);
      if (previous && char.box.x - previous.box.x - previous.box.w > Math.max(previous.style.size, char.style.size) * 1.2) { groups.push(group); group = []; }
      group.push(char); if (++steps % 128 === 0) await checkpoint();
    }
    if (group.length) groups.push(group);
    await checkpoint();
  }
  return groups.filter(group => /\p{L}{2}/u.test(group.map(char => char.text).join('')) && unionBoxes(group.map(char => char.visualBox)).h > 0);
}
