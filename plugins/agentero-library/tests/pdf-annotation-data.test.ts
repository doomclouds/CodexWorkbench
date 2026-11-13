import { expect, it, vi } from 'vitest';
import type { MarkList, ReaderMark } from '../src/contracts/reader';
import { readAllAnnotations } from '../src/app/pdf/annotation-data';

const mark = (id: string): ReaderMark => ({ id, kind: 'highlight', page: 1, space: 'pt', rects: [], quote: id, note: '' });
const page = (ids: string[], nextCursor: string | null, total: number): MarkList => ({ vaultId: 'owned', paperPath: 'papers/one', revision: 'r1', items: ids.map(mark), nextCursor, total, truncated: Boolean(nextCursor) });

it('loads a whole revision past the first page without truncating selection scope', async () => {
  const read = vi.fn(async (cursor?: string) => cursor ? page(['b', 'c'], null, 3) : page(['a'], 'next', 3));
  const result = await readAllAnnotations(read);
  expect(result.items.map(value => value.id)).toEqual(['a', 'b', 'c']);
  expect(result).toMatchObject({ total: 3, nextCursor: null, truncated: false });
  expect(read.mock.calls).toEqual([[undefined], ['next']]);
});

it('rejects a changed revision and failed trailing page rather than returning a partial view', async () => {
  await expect(readAllAnnotations(async cursor => cursor ? { ...page(['b'], null, 2), revision: 'r2' } : page(['a'], 'next', 2))).rejects.toThrow('批注已变化');
  await expect(readAllAnnotations(async cursor => { if (cursor) throw new Error('offline'); return page(['a'], 'next', 2); })).rejects.toThrow('offline');
});

it('rejects repeated cursors, duplicate IDs, and an incomplete terminal page', async () => {
  await expect(readAllAnnotations(async cursor => page([cursor ? 'b' : 'a'], 'next', 3))).rejects.toThrow('未能继续');
  await expect(readAllAnnotations(async cursor => page(['a'], cursor ? null : 'next', 2))).rejects.toThrow('重复');
  await expect(readAllAnnotations(async () => page(['a'], null, 2))).rejects.toThrow('尚未完整');
});

it('checks cancellation before and after async reads', async () => {
  const read = vi.fn(async () => page(['a'], null, 1));
  await expect(readAllAnnotations(read, () => true)).rejects.toThrow('取消'); expect(read).not.toHaveBeenCalled();
  let cancelled = false;
  await expect(readAllAnnotations(async () => { cancelled = true; return page(['a'], null, 1); }, () => cancelled)).rejects.toThrow('取消');
});
