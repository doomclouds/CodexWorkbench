export const PAGE_PREFETCH_MARGIN = 1000;
interface IntersectionSnapshot { target: object; time: number; isIntersecting: boolean }
interface Bounds { left: number; top: number; right: number; bottom: number }

/** A callback can contain multiple observations for one target; do not keep an old first entry. */
export function latestPageIntersection<T extends IntersectionSnapshot>(entries: readonly T[], target: object, afterTime = -Infinity): T | null {
  let latest: T | null = null;
  for (const entry of entries) if (entry.target === target && entry.time >= afterTime && (!latest || entry.time >= latest.time)) latest = entry;
  return latest;
}
/** Match the observer's vertical prefetch margin against the current layout, not its queued snapshot. */
export function pageIsNearViewport(page: Bounds, viewport: Bounds, margin = PAGE_PREFETCH_MARGIN): boolean {
  if (![page.left, page.top, page.right, page.bottom, viewport.left, viewport.top, viewport.right, viewport.bottom].every(Number.isFinite)) return false;
  return page.right > page.left && page.bottom > page.top && viewport.right > viewport.left && viewport.bottom > viewport.top && page.right > viewport.left && page.left < viewport.right && page.bottom > viewport.top - margin && page.top < viewport.bottom + margin;
}
