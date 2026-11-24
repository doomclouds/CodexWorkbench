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

const screenTolerance = 6;

function anchors(bounds: CanvasRect, axis: SnapAxis) {
  const start = bounds[axis];
  const length = axis === 'x' ? bounds.width : bounds.height;

  return [start, start + length / 2, start + length];
}

function closestOffset(at: number, points: readonly number[], threshold: number) {
  let nearest: number | undefined;
  for (const point of points) {
    const offset = at - point;
    const distance = Math.abs(offset);
    if (distance <= threshold && distance < Math.abs(nearest ?? Infinity)) {
      nearest = offset;
    }
  }

  return nearest;
}

function nearestSnap(
  moving: CanvasRect,
  candidates: readonly CanvasRect[],
  axis: SnapAxis,
  threshold: number,
) {
  const movingAnchors = anchors(moving, axis);
  let nearest: AlignmentSnap | undefined;

  for (const target of candidates) {
    for (const at of anchors(target, axis)) {
      const offset = closestOffset(at, movingAnchors, threshold);
      if (offset !== undefined && Math.abs(offset) < Math.abs(nearest?.offset ?? Infinity)) {
        nearest = { at, offset, target };
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
  candidates: readonly CanvasRect[],
  zoom: number,
): { offset: CanvasPoint; guides: readonly AlignmentGuide[] } {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    return { offset: { x: 0, y: 0 }, guides: [] };
  }

  const threshold = screenTolerance / zoom;
  const horizontal = nearestSnap(bounds, candidates, 'x', threshold);
  const vertical = nearestSnap(bounds, candidates, 'y', threshold);
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
