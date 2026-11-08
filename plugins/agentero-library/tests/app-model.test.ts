import { describe, expect, it } from 'vitest';
import type { PdfChunk } from '../src/contracts/types';
import { noteReference, readPdfChunks, safeNotePath } from '../src/app/model';

const chunk = (offset: number, value: string, totalBytes: number, eof: boolean, revision = 'r1'): PdfChunk => ({
  base64: btoa(value), offset, nextOffset: offset + value.length, totalBytes, eof, revision,
});

describe('MCP PDF chunk assembly', () => {
  it('assembles bytes and pins the first revision for subsequent requests', async () => {
    const calls: { offset: number; revision?: string }[] = [];
    const bytes = await readPdfChunks(async (offset, revision) => {
      calls.push({ offset, revision });
      return offset === 0 ? chunk(0, '%PDF', 7, false) : chunk(4, '-ok', 7, true);
    });
    expect(new TextDecoder().decode(bytes)).toBe('%PDF-ok');
    expect(calls).toEqual([{ offset: 0, revision: undefined }, { offset: 4, revision: 'r1' }]);
  });
  it('refuses a changed file rather than mixing revisions', async () => {
    await expect(readPdfChunks(async offset => offset === 0 ? chunk(0, '%PDF', 7, false) : chunk(4, '-ok', 7, true, 'r2'))).rejects.toThrow('发生变化');
  });
  it('refuses incomplete or out-of-order replies', async () => {
    await expect(readPdfChunks(async () => chunk(0, '%PDF', 7, true))).rejects.toThrow('尚未读取完整');
    await expect(readPdfChunks(async () => chunk(1, '%PDF', 5, true))).rejects.toThrow('分块响应不完整');
  });
  it('stops when the view is cancelled before the next read', async () => {
    const controller = new AbortController(); let calls = 0;
    await expect(readPdfChunks(async () => { calls += 1; controller.abort(); return chunk(0, '%PDF', 7, false); }, { signal: controller.signal })).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

describe('note references', () => {
  it('routes paper NOTES through the paper-note operation', () => {
    expect(noteReference('papers/group/demo/NOTES.md')).toEqual({ paperPath: 'papers/group/demo' });
    expect(noteReference('notes/reading.md')).toEqual({ path: 'notes/reading.md' });
  });
  it('accepts normal Unicode notes while refusing traversal and unrelated roots', () => {
    expect(safeNotePath('notes/阅读记录.md')).toBe('notes/阅读记录.md');
    expect(safeNotePath('notes/../paper.md')).toBeNull();
    expect(safeNotePath('/notes/read.md')).toBeNull();
    expect(safeNotePath('papers/demo/NOTES.md')).toBeNull();
  });
});
