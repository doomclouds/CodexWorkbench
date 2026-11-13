import type { MarkColor, MarkList, ReaderMark } from '../../contracts/reader';
import type { MarkEditorDraft } from './ReaderPanels';
import { filterMarks, markGroupState, marksByPage, selectedMarkSummary } from './mark-selection';

export const ANNOTATION_RENDER_BATCH = 100;

/** UI state belongs to the current App and paper, without persisting private content. */
export interface AnnotationWorkspaceState {
  query: string;
  kind: string;
  color: MarkColor | 'all';
  commentsOnly: boolean;
  selectedOnly: boolean;
  pageRange: string;
  currentPageOnly: boolean;
  collapsedPages: number[];
  listScrollTop: number;
  managerScrollTop: number;
  previewOpen: boolean;
  previewMarkId: string | null;
  filtersOpen: boolean;
  renderedLimit: number;
}

export function createAnnotationWorkspaceState(): AnnotationWorkspaceState {
  return {
    query: '', kind: 'all', color: 'all', commentsOnly: false, selectedOnly: false,
    pageRange: '', currentPageOnly: false, collapsedPages: [],
    listScrollTop: 0, managerScrollTop: 0, previewOpen: true, previewMarkId: null,
    filtersOpen: false, renderedLimit: ANNOTATION_RENDER_BATCH,
  };
}

export type AnnotationPageRange =
  | { valid: true; ranges: { start: number; end: number }[]; normalized: string }
  | { valid: false; error: string };

/** Keep inclusive intervals instead of expanding a potentially large PDF into page IDs. */
export function parseAnnotationPageRange(input: string, pageCount: number): AnnotationPageRange {
  if (input.length > 1_000) return { valid: false, error: '页码范围过长，请缩短到 1000 个字符以内。' };
  const text = input.trim();
  if (!text) return { valid: true, ranges: [], normalized: '' };
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) return { valid: false, error: 'PDF 页数尚未加载，暂时无法应用页码范围。' };
  const parts = text.split(/[,，]/);
  if (parts.length > 100) return { valid: false, error: '页码范围最多包含 100 段。' };
  const ranges: { start: number; end: number }[] = [];
  for (const part of parts) {
    const match = /^\s*(\d+)\s*(?:[-–—]\s*(\d+))?\s*$/.exec(part);
    if (!match) return { valid: false, error: '请输入有效页码范围，例如 7–12,18。' };
    const start = Number(match[1]); const end = Number(match[2] ?? match[1]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end > pageCount || start > end) {
      return { valid: false, error: `页码须在 1–${pageCount} 之间，起始页不能大于结束页。` };
    }
    ranges.push({ start, end });
  }
  ranges.sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: { start: number; end: number }[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + 1) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return {
    valid: true,
    ranges: merged,
    normalized: merged.map(range => range.start === range.end ? String(range.start) : `${range.start}–${range.end}`).join(','),
  };
}

/** Viewing selected marks suspends other filters without changing the saved filter state. */
export function buildAnnotationWorkspace(marks: ReaderMark[], state: AnnotationWorkspaceState, selected: ReadonlySet<string>, pageCount: number, currentPage: number) {
  const pageRange = parseAnnotationPageRange(state.pageRange, pageCount);
  const items = state.selectedOnly ? marks.filter(mark => selected.has(mark.id)) : pageRange.valid ? filterMarks(marks, state, selected).filter(mark =>
    (state.color === 'all' || (mark.color ?? 'yellow') === state.color)
    && (!state.currentPageOnly || mark.page === currentPage)
    && (!pageRange.ranges.length || pageRange.ranges.some(range => mark.page >= range.start && mark.page <= range.end)),
  ) : [];
  const groups = marksByPage(items).map(group => ({ ...group, state: markGroupState(group.marks, selected) }));
  const selection = selectedMarkSummary(marks, selected);
  const visibleSelected = items.filter(mark => selected.has(mark.id)).length;
  return {
    items, groups, pageRange,
    selection: { ...selection, hiddenCount: selection.items.length - visibleSelected },
    selectionState: markGroupState(items, selected),
  };
}

export function annotationDraftDirty(mark: ReaderMark, draft: MarkEditorDraft | undefined, commentDraft?: string): boolean {
  const savedText = mark.kind === 'translate' ? mark.result ?? mark.note : mark.comment ?? mark.note;
  const text = commentDraft ?? draft?.text;
  return text !== undefined && text !== savedText
    || draft?.color !== undefined && draft.color !== (mark.color ?? 'yellow')
    || Boolean(draft?.reply);
}

export function annotationDraftsDirty(marks: ReaderMark[], drafts: ReadonlyMap<string, MarkEditorDraft>, commentDrafts: ReadonlyMap<string, string> = new Map()): boolean {
  const byId = new Map(marks.map(mark => [mark.id, mark]));
  for (const id of new Set([...drafts.keys(), ...commentDrafts.keys()])) {
    const mark = byId.get(id); const draft = drafts.get(id);
    if (mark ? annotationDraftDirty(mark, draft, commentDrafts.get(id)) : commentDrafts.has(id) || draft?.text !== undefined || draft?.color !== undefined || Boolean(draft?.reply)) return true;
  }
  return false;
}

/** Partial or failed loads cannot establish that an absent mark was deleted. */
export function isCompleteAnnotationList(list: MarkList | null): list is MarkList {
  return Boolean(list && !list.truncated && !list.nextCursor
    && (list.total === undefined || Number.isSafeInteger(list.total) && list.total >= 0 && list.total === new Set(list.items.map(mark => mark.id)).size));
}

export function reconcileAnnotationIds(list: MarkList | null, checkedIds: ReadonlySet<string>, drafts: ReadonlyMap<string, MarkEditorDraft>, commentDrafts: ReadonlyMap<string, string> = new Map()) {
  const complete = isCompleteAnnotationList(list);
  const existing = new Set(list?.items.map(mark => mark.id));
  return {
    complete,
    checkedIds: new Set([...checkedIds].filter(id => !complete || existing.has(id))),
    drafts: new Map([...drafts].filter(([id]) => !complete || existing.has(id))),
    commentDrafts: new Map([...commentDrafts].filter(([id]) => !complete || existing.has(id))),
  };
}
