export const MAX_MOUNTED_PAGES = 8;
export interface PageSize { width: number; height: number }
export interface PageSlot { top: number; height: number; width: number }
export interface PageAnchor { page: number; ratio: number; sequence: number; kind: 'navigate' | 'layout' }
/** Explicit navigation supersedes pending layout preservation; stale callbacks cannot consume it. */
export class PageAnchorCoordinator {
  private sequence = 0;
  pending: PageAnchor | null = null;
  navigate(page: number, ratio = 0): PageAnchor { return this.pending = { page, ratio, sequence: ++this.sequence, kind: 'navigate' }; }
  remember(page: number, ratio: number): PageAnchor { return this.pending ??= { page, ratio, sequence: ++this.sequence, kind: 'layout' }; }
  settle(sequence: number) { if (this.pending?.sequence === sequence) this.pending = null; }
  clear() { this.pending = null; this.sequence++; }
}
export function pageSlots(total: number, sizes: ReadonlyMap<number, PageSize>, estimate: PageSize, rotation: number, scale: number, fitWidth: number | undefined, gutter: number): PageSlot[] {
  let top = 0;
  return Array.from({ length: total }, (_, index) => {
    const base = sizes.get(index + 1) ?? estimate;
    const width = rotation % 180 ? base.height : base.width; const height = rotation % 180 ? base.width : base.height;
    const actualScale = fitWidth === undefined ? scale : Math.max(.001, Math.min(3, fitWidth / width));
    const slot = { top, height: height * actualScale, width: width * actualScale + gutter }; top += slot.height + 24; return slot;
  });
}
export function pageAtOffset(slots: readonly PageSlot[], offset: number): number {
  let low = 0; let high = slots.length - 1;
  while (low < high) { const middle = (low + high) >>> 1; if (slots[middle].top + slots[middle].height < offset) low = middle + 1; else high = middle; }
  return Math.max(0, low);
}
export function pageWindow(slots: readonly PageSlot[], scrollTop: number, viewportHeight: number, max = MAX_MOUNTED_PAGES) {
  if (!slots.length) return { start: 0, end: -1 };
  const first = pageAtOffset(slots, scrollTop); const last = pageAtOffset(slots, scrollTop + viewportHeight);
  let start = Math.max(0, first - 2); let end = Math.min(slots.length - 1, last + 2);
  if (end - start + 1 > max) { start = Math.max(0, Math.min(first - 1, slots.length - max)); end = Math.min(slots.length - 1, start + max - 1); }
  return { start, end };
}
