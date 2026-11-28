import type { CanvasPoint, CanvasRect } from '../contracts.js';

type SnapAxis = 'x' | 'y';

export interface AlignmentGuide {
  readonly axis: SnapAxis;
  readonly at: number;
  readonly from: number;
  readonly to: number;
}

interface AlignmentSnap {
  readonly offset: number;
  readonly at: number;
  readonly target: CanvasRect;
}

interface SnapAnchor {
  readonly at: number;
  readonly target: CanvasRect;
  readonly order: number;
}

export interface SnapCandidates {
  readonly x: readonly SnapAnchor[];
  readonly y: readonly SnapAnchor[];
}

const screenTolerance = 6;

function anchors(bounds: CanvasRect, axis: SnapAxis) {
  const start = bounds[axis];
  const length = axis === 'x' ? bounds.width : bounds.height;

  return [start, start + length / 2, start + length];
}

function sortedAnchors(targets: readonly CanvasRect[], axis: SnapAxis) {
  const ordered = targets.flatMap((target, index) =>
    anchors(target, axis).map((at, offset) => ({ at, target, order: index * 3 + offset })),
  );

  return ordered
    .filter(({ at }) => Number.isFinite(at))
    .sort((left, right) => left.at - right.at || left.order - right.order)
    .filter(({ at }, index, sorted) => at !== sorted[index - 1]?.at);
}

export function prepareSnapCandidates(targets: readonly CanvasRect[]): SnapCandidates {
  return { x: sortedAnchors(targets, 'x'), y: sortedAnchors(targets, 'y') };
}

function lowerBound(candidates: readonly SnapAnchor[], point: number) {
  let low = 0;
  let high = candidates.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((candidates[middle]?.at ?? Infinity) < point) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function nearestSnap(
  moving: CanvasRect,
  candidates: readonly SnapAnchor[],
  axis: SnapAxis,
  threshold: number,
) {
  let nearest: (AlignmentSnap & { order: number }) | undefined;
  for (const point of anchors(moving, axis)) {
    const right = lowerBound(candidates, point);
    for (const candidate of candidates.slice(Math.max(0, right - 1), right + 1)) {
      const offset = candidate.at - point;
      const distance = Math.abs(offset);
      const best = Math.abs(nearest?.offset ?? Infinity);
      const first = distance === best && candidate.order < (nearest?.order ?? Infinity);
      if (distance <= threshold && (distance < best || first)) {
        nearest = { ...candidate, offset };
      }
    }
  }

  return nearest;
}

function alignmentGuide(axis: SnapAxis, moving: CanvasRect, snap: AlignmentSnap): AlignmentGuide {
  const { at, target } = snap;
  const across = axis === 'x' ? 'y' : 'x';
  const extent = axis === 'x' ? 'height' : 'width';

  return {
    axis,
    at,
    from: Math.min(moving[across], target[across]),
    to: Math.max(moving[across] + moving[extent], target[across] + target[extent]),
  };
}

export function snapMove(
  bounds: CanvasRect,
  candidates: SnapCandidates,
  zoom: number,
): { offset: CanvasPoint; guides: readonly AlignmentGuide[] } {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    return { offset: { x: 0, y: 0 }, guides: [] };
  }

  const threshold = screenTolerance / zoom;
  const horizontal = nearestSnap(bounds, candidates.x, 'x', threshold);
  const vertical = nearestSnap(bounds, candidates.y, 'y', threshold);
  const offset = { x: horizontal?.offset ?? 0, y: vertical?.offset ?? 0 };
  const snapped = { ...bounds, x: bounds.x + offset.x, y: bounds.y + offset.y };
  const guides: AlignmentGuide[] = [];
  if (horizontal) {
    guides.push(alignmentGuide('x', snapped, horizontal));
  }
  if (vertical) {
    guides.push(alignmentGuide('y', snapped, vertical));
  }

  return { offset, guides };
}
