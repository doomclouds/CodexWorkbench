import { describe, expect, test } from 'vitest';
import type { ReaderMark } from '../src/contracts/reader';
import { filterMarks, markGroupState, markHasComments, marksByPage, selectedMarkSummary, toggleMarkGroup } from '../src/app/pdf/mark-selection';

const mark = (id: string, page: number, fields: Partial<ReaderMark> = {}): ReaderMark => ({ id, page, kind: 'highlight', space: 'pt', rects: [{ x: 30, y: 50, w: 100, h: 12 }], quote: `quote ${id}`, note: '', ...fields });
const items = [mark('a', 7, { comment: 'architecture' }), mark('b', 7), mark('c', 8, { messages: [{ id: 'reply', role: 'user', content: 'important answer', createdAt: '' }] }), mark('d', 12, { kind: 'translate', result: 'translated architecture' })];

describe('batch mark selection', () => {
  test('selects noncontiguous physical pages and supports partial page selection', () => {
    const groups = marksByPage(items); let selected = toggleMarkGroup(new Set(), groups[0].marks);
    selected = toggleMarkGroup(selected, groups[2].marks);
    expect(selectedMarkSummary(items, selected).pages).toEqual([7, 12]);
    selected = toggleMarkGroup(selected, [items[1]]);
    expect(markGroupState(groups[0].marks, selected)).toBe('some');
    expect(selectedMarkSummary(items, selected).items.map(item => item.id)).toEqual(['a', 'd']);
    selected = toggleMarkGroup(selected, groups[0].marks);
    expect(markGroupState(groups[0].marks, selected)).toBe('all');
    expect(selected.has('d')).toBe(true);
  });
  test('filters never mutate selected IDs and commands only affect supplied results', () => {
    const selected = new Set(['b', 'd']);
    const filtered = filterMarks(items, { query: 'architecture', kind: 'highlight', commentsOnly: true }, selected);
    expect(filtered.map(item => item.id)).toEqual(['a']);
    expect([...selected]).toEqual(['b', 'd']);
    expect([...toggleMarkGroup(selected, filtered)]).toEqual(['b', 'd', 'a']);
    expect(filterMarks(items, { query: 'answer', kind: 'all', commentsOnly: true }, selected).map(item => item.id)).toEqual(['c']);
    expect(markHasComments(mark('translated', 8, { kind: 'translate', note: 'legacy translation text', result: 'legacy translation text' }))).toBe(false);
  });
  test('view selected is explicit and source summaries retain mark objects and exact pages', () => {
    const selected = new Set(['a', 'c', 'deleted']);
    expect(filterMarks(items, { query: '', kind: 'all', commentsOnly: false, selectedOnly: true }, selected)).toEqual([items[0], items[2]]);
    expect(selectedMarkSummary(items, selected)).toEqual({ items: [items[0], items[2]], pages: [7, 8] });
    expect(items[2].messages?.[0].content).toBe('important answer');
  });
});
