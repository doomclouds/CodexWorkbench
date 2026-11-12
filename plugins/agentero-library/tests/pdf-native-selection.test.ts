import { afterEach, expect, test, vi } from 'vitest';
import { textSelectionRects } from '../src/app/pdf/NativeSelectionLayer';
import { usefulRects } from '../src/app/pdf/geometry';

afterEach(() => vi.unstubAllGlobals());
test('native selection reads clipped leaf text ranges instead of overlapping parent span boxes', () => {
  const nodes = [{ id: 'before' }, { id: 'start' }, { id: 'end' }, { id: 'after' }]; let position = 0;
  const leafRanges: { node?: unknown; start?: number; end?: number; selectNodeContents(node: unknown): void; setStart(node: unknown, offset: number): void; setEnd(node: unknown, offset: number): void; getClientRects(): unknown[] }[] = [];
  const layer = {} as Element; const parentBoxes = vi.fn(() => { throw new Error('Parent range boxes must not be used'); });
  const range = { startContainer: nodes[1], startOffset: 3, endContainer: nodes[2], endOffset: 5, intersectsNode: (node: unknown) => node === nodes[1] || node === nodes[2], getClientRects: parentBoxes } as unknown as Range;
  const createTreeWalker = vi.fn(() => ({ nextNode: () => nodes[position++] ?? null }));
  vi.stubGlobal('NodeFilter', { SHOW_TEXT: 4 });
  vi.stubGlobal('document', { createTreeWalker, createRange: () => {
    const part = { node: undefined as unknown, start: undefined as number | undefined, end: undefined as number | undefined, selectNodeContents(node: unknown) { this.node = node; }, setStart(node: unknown, offset: number) { this.start = offset; }, setEnd(node: unknown, offset: number) { this.end = offset; }, getClientRects() { return [{ x: 10, y: 20, w: 100, h: 12 }, { x: 12, y: 20, w: 90, h: 12 }]; } };
    leafRanges.push(part); return part;
  } });
  const rects = textSelectionRects(range, layer);
  expect(createTreeWalker).toHaveBeenCalledWith(layer, 4); expect(leafRanges).toHaveLength(2);
  expect(leafRanges[0]).toMatchObject({ node: nodes[1], start: 3 }); expect(leafRanges[1]).toMatchObject({ node: nodes[2], end: 5 });
  expect(parentBoxes).not.toHaveBeenCalled(); expect(usefulRects(rects as unknown as { x: number; y: number; w: number; h: number }[])).toEqual([{ x: 10, y: 20, w: 100, h: 12 }]);
});
