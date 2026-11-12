import type { ReaderMark } from '../../contracts/reader';

export interface MarkFilters { query: string; kind: string; commentsOnly: boolean; selectedOnly?: boolean }
export function markHasComments(mark: ReaderMark) { return Boolean(mark.comment?.trim() || (mark.kind !== 'translate' && mark.note?.trim()) || mark.question?.trim() || mark.messages?.length); }
export function filterMarks(marks: ReaderMark[], filters: MarkFilters, selected: ReadonlySet<string>): ReaderMark[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return marks.filter(mark => (filters.kind === 'all' || mark.kind === filters.kind) && (!filters.commentsOnly || markHasComments(mark)) && (!filters.selectedOnly || selected.has(mark.id)) && `${mark.quote} ${mark.comment ?? ''} ${mark.question ?? ''} ${mark.result ?? ''} ${mark.note} ${(mark.messages ?? []).map(message => message.content).join(' ')}`.toLocaleLowerCase().includes(query));
}
export function marksByPage(marks: ReaderMark[]): { page: number; marks: ReaderMark[] }[] {
  const pages = new Map<number, ReaderMark[]>();
  for (const mark of marks) { const items = pages.get(mark.page) ?? []; items.push(mark); pages.set(mark.page, items); }
  return [...pages].sort(([a], [b]) => a - b).map(([page, marks]) => ({ page, marks }));
}
export function markGroupState(marks: ReaderMark[], selected: ReadonlySet<string>): 'none' | 'some' | 'all' {
  const count = marks.filter(mark => selected.has(mark.id)).length;
  return !count ? 'none' : count === marks.length ? 'all' : 'some';
}
export function toggleMarkGroup(selected: ReadonlySet<string>, marks: ReaderMark[]): Set<string> {
  const next = new Set(selected); const remove = markGroupState(marks, selected) === 'all';
  for (const mark of marks) { if (remove) next.delete(mark.id); else next.add(mark.id); }
  return next;
}
export function selectedMarkSummary(marks: ReaderMark[], selected: ReadonlySet<string>) {
  const items = marks.filter(mark => selected.has(mark.id));
  return { items, pages: [...new Set(items.map(mark => mark.page))].sort((a, b) => a - b) };
}
