import { describe, expect, test } from 'vitest';
import type { MarkList, ReaderMark } from '../src/contracts/reader';
import type { MarkEditorDraft } from '../src/app/pdf/ReaderPanels';
import {
  annotationDraftDirty, annotationDraftsDirty, buildAnnotationWorkspace, createAnnotationWorkspaceState,
  isCompleteAnnotationList, parseAnnotationPageRange, reconcileAnnotationIds,
} from '../src/app/pdf/annotation-workspace';
import { toggleMarkGroup } from '../src/app/pdf/mark-selection';

const mark = (id: string, page: number, fields: Partial<ReaderMark> = {}): ReaderMark => ({
  id, page, kind: 'highlight', space: 'pt', rects: [], quote: `quote ${id}`, note: '', ...fields,
});
const list = (items: ReaderMark[], fields: Partial<MarkList> = {}): MarkList => ({
  vaultId: 'vault', paperPath: 'paper.pdf', revision: 'revision', items, ...fields,
});

describe('annotation page ranges', () => {
  test('normalizes sorted inclusive ranges without expanding pages', () => {
    expect(parseAnnotationPageRange(' 18，9–12,07-9,8,13 ', 20)).toEqual({
      valid: true, ranges: [{ start: 7, end: 13 }, { start: 18, end: 18 }], normalized: '7–13,18',
    });
    expect(parseAnnotationPageRange('1–9000000', 9_000_000)).toEqual({
      valid: true, ranges: [{ start: 1, end: 9_000_000 }], normalized: '1–9000000',
    });
    expect(parseAnnotationPageRange(' ', 0)).toEqual({ valid: true, ranges: [], normalized: '' });
  });

  test.each(['0', '1,21', '12–7', '7,,12', '7,', '7–', '7.5', '1e2', '1;3', '9007199254740993'])('rejects invalid or out-of-bounds input %s as a whole', input => {
    expect(parseAnnotationPageRange(input, 20).valid).toBe(false);
  });

  test('bounds parser work and waits for a known page count', () => {
    expect(parseAnnotationPageRange('1'.repeat(1_001), 20).valid).toBe(false);
    expect(parseAnnotationPageRange(`${' '.repeat(1_000)}1`, 20).valid).toBe(false);
    expect(parseAnnotationPageRange(Array.from({ length: 101 }, () => '1').join(','), 20).valid).toBe(false);
    expect(parseAnnotationPageRange('1', 0).valid).toBe(false);
    expect(parseAnnotationPageRange('1', Number.POSITIVE_INFINITY).valid).toBe(false);
  });
});

describe('annotation workspace selection', () => {
  const items = [
    mark('a', 7, { comment: 'architecture' }), mark('b', 7, { color: 'green' }),
    mark('c', 8, { comment: 'architecture', color: 'green' }), mark('d', 12, { kind: 'translate', result: 'architecture' }),
    mark('e', 18, { messages: [{ id: 'reply', role: 'user', content: 'architecture answer', createdAt: '' }] }),
  ];

  test('all parent states use identical filtered children and account for hidden selections', () => {
    const state = { ...createAnnotationWorkspaceState(), pageRange: '7–12' };
    const checked = new Set(['a', 'c', 'e', 'deleted']);
    const result = buildAnnotationWorkspace(items, state, checked, 20, 7);
    expect(result.items.map(item => item.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(result.groups.map(group => [group.page, group.state])).toEqual([[7, 'some'], [8, 'all'], [12, 'none']]);
    expect(result.selectionState).toBe('some');
    expect(result.selection.items.map(item => item.id)).toEqual(['a', 'c', 'e']);
    expect(result.selection.pages).toEqual([7, 8, 18]);
    expect(result.selection.hiddenCount).toBe(1);
    const selectedPage = toggleMarkGroup(checked, result.groups[0].marks);
    expect(selectedPage.has('e')).toBe(true);
    expect(buildAnnotationWorkspace(items, state, selectedPage, 20, 7).groups[0].state).toBe('all');
    expect([...checked]).toEqual(['a', 'c', 'e', 'deleted']);
  });

  test('combines query, kind, color, comments, selected, current page and range filters', () => {
    const state = {
      ...createAnnotationWorkspaceState(), query: 'architecture', kind: 'highlight', color: 'green' as const,
      commentsOnly: true, selectedOnly: true, pageRange: '7–12', currentPageOnly: true,
    };
    const checked = new Set(['a', 'c', 'e']);
    expect(buildAnnotationWorkspace(items, state, checked, 20, 8).items.map(item => item.id)).toEqual(['c']);
    expect(buildAnnotationWorkspace(items, state, checked, 20, 7).items).toEqual([]);
    const defaultColor = buildAnnotationWorkspace(items, { ...createAnnotationWorkspaceState(), color: 'yellow' }, checked, 20, 7);
    expect(defaultColor.items.map(item => item.id)).toEqual(['a', 'd', 'e']);
  });

  test('invalid ranges never fall back to all marks or discard selected IDs', () => {
    const selected = new Set(['a', 'e']);
    const result = buildAnnotationWorkspace(items, { ...createAnnotationWorkspaceState(), pageRange: '7,invalid' }, selected, 20, 7);
    expect(result.pageRange.valid).toBe(false);
    expect(result.items).toEqual([]);
    expect(result.groups).toEqual([]);
    expect(result.selectionState).toBe('none');
    expect(result.selection.hiddenCount).toBe(2);
    expect([...selected]).toEqual(['a', 'e']);
  });

  test('selects every filtered result even when render batches and folded pages hide rows', () => {
    const many = Array.from({ length: 250 }, (_, index) => mark(`m${index}`, 1 + Math.floor(index / 10)));
    const state = { ...createAnnotationWorkspaceState(), renderedLimit: 20, collapsedPages: [3, 4], pageRange: '2–24' };
    const result = buildAnnotationWorkspace(many, state, new Set(['m0']), 25, 1);
    expect(result.items).toHaveLength(230);
    expect(result.groups).toHaveLength(23);
    const checked = toggleMarkGroup(new Set(['m0']), result.items);
    const selected = buildAnnotationWorkspace(many, state, checked, 25, 1);
    expect(checked.size).toBe(231);
    expect(selected.selectionState).toBe('all');
    expect(selected.groups.every(group => group.state === 'all')).toBe(true);
    expect(selected.selection.hiddenCount).toBe(1);
  });
});

describe('annotation draft lifetime', () => {
  test('reply-only and color-only changes are dirty alongside text and legacy comment drafts', () => {
    const item = mark('a', 1, { comment: 'saved' });
    expect(annotationDraftDirty(item, undefined)).toBe(false);
    expect(annotationDraftDirty(item, { text: 'saved', color: 'yellow', reply: '' })).toBe(false);
    expect(annotationDraftDirty(item, { reply: 'pending reply' })).toBe(true);
    expect(annotationDraftDirty(item, { reply: ' ' })).toBe(true);
    expect(annotationDraftDirty(item, { color: 'blue' })).toBe(true);
    expect(annotationDraftDirty(item, { text: '' })).toBe(true);
    expect(annotationDraftDirty(item, undefined, 'legacy pending')).toBe(true);
    expect(annotationDraftDirty(mark('translation', 1, { kind: 'translate', note: 'legacy', result: 'saved result' }), { text: 'saved result' })).toBe(false);
    expect(annotationDraftsDirty([item], new Map([['a', { reply: 'pending' }]]))).toBe(true);
    expect(annotationDraftsDirty([item], new Map([['a', { color: 'yellow' }]]), new Map([['a', 'saved']]))).toBe(false);
  });

  test('unknown draft IDs remain dirty until a complete successful load can reconcile them', () => {
    expect(annotationDraftsDirty([], new Map([['unloaded', { color: 'blue' }]]))).toBe(true);
    expect(annotationDraftsDirty([], new Map(), new Map([['unloaded', '']]))).toBe(true);
    expect(annotationDraftsDirty([], new Map([['unloaded', {}]]))).toBe(false);
  });

  test('partial, failed and inconsistent loads preserve all selection and draft IDs', () => {
    const checked = new Set(['a', 'missing']);
    const drafts = new Map<string, MarkEditorDraft>([['missing', { reply: 'pending reply' }]]);
    const comments = new Map([['missing', 'pending comment']]);
    const incomplete = [null, list([mark('a', 1)], { truncated: true }), list([mark('a', 1)], { nextCursor: 'next' }), list([mark('a', 1)], { total: 2 }), list([mark('a', 1)], { total: 0 }), list([mark('a', 1)], { total: -1 })];
    for (const loaded of incomplete) {
      const result = reconcileAnnotationIds(loaded, checked, drafts, comments);
      expect(result.complete).toBe(false);
      expect(result.checkedIds).toEqual(checked);
      expect(result.drafts).toEqual(drafts);
      expect(result.commentDrafts).toEqual(comments);
    }
  });

  test('only a complete list prunes deleted IDs without mutating inputs or losing surviving drafts', () => {
    const checked = new Set(['a', 'deleted']);
    const drafts = new Map<string, MarkEditorDraft>([['a', { color: 'blue' }], ['deleted', { reply: 'pending' }]]);
    const comments = new Map([['a', 'pending'], ['deleted', 'other']]);
    const complete = list([mark('a', 1)], { total: 1, nextCursor: null, truncated: false });
    expect(isCompleteAnnotationList(complete)).toBe(true);
    const result = reconcileAnnotationIds(complete, checked, drafts, comments);
    expect(result.complete).toBe(true);
    expect([...result.checkedIds]).toEqual(['a']);
    expect([...result.drafts]).toEqual([['a', { color: 'blue' }]]);
    expect([...result.commentDrafts]).toEqual([['a', 'pending']]);
    expect(checked.has('deleted')).toBe(true);
    expect(drafts.has('deleted')).toBe(true);
    expect(comments.has('deleted')).toBe(true);
    expect(reconcileAnnotationIds(list([]), checked, drafts, comments).checkedIds.size).toBe(0);
  });
});
