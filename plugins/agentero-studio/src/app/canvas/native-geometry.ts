import type { BoardElement, Operation } from '../../contracts/studio.js';
import { arrowGeometry, arrowLabelBox } from '../../core/products/whiteboard-geometry.js';
import {
  boundsOf,
  contains,
  expandMoveIds,
  moveOperations,
  type Point,
  type Rect,
} from './canvas-model.js';

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export interface AlignmentGuide {
  axis: 'x' | 'y';
  at: number;
  from: number;
  to: number;
}
export interface ResizeOptions {
  aspect?: boolean;
  center?: boolean;
  minWidth?: number;
  minHeight?: number;
}

const turn = (point: Point, angle: number): Point => ({
  x: point.x * Math.cos(angle) - point.y * Math.sin(angle),
  y: point.x * Math.sin(angle) + point.y * Math.cos(angle),
});
const normalizedAngle = (angle: number) => ((((angle + 180) % 360) + 360) % 360) - 180;

export function geometryBounds(element: BoardElement, elements: readonly BoardElement[]): Rect {
  if (element.type === 'arrow') {
    const route = arrowGeometry(element, elements);
    const points = route.points;
    const x = Math.min(...points.map((point) => point.x));
    const y = Math.min(...points.map((point) => point.y));
    const path = {
      x,
      y,
      w: Math.max(1, Math.max(...points.map((point) => point.x)) - x),
      h: Math.max(1, Math.max(...points.map((point) => point.y)) - y),
    };
    const label = arrowLabelBox(element, route.label);

    return label ? boundsOf([path, label])! : path;
  }

  const angle = ((element.rotation ?? 0) * Math.PI) / 180;
  if (element.type === 'stroke' && element.points?.length) {
    const center = { x: element.x + element.w / 2, y: element.y + element.h / 2 };
    const points = element.points.flatMap((value, index) => {
      if (index % 2) {
        return [];
      }

      const relative = turn(
        { x: value - element.w / 2, y: element.points![index + 1]! - element.h / 2 },
        angle,
      );

      return [{ x: center.x + relative.x, y: center.y + relative.y }];
    });
    const padding = Number(element.strokeWidth ?? element.width ?? 3) / 2;
    const left = Math.min(...points.map((point) => point.x)) - padding;
    const top = Math.min(...points.map((point) => point.y)) - padding;

    return {
      x: left,
      y: top,
      w: Math.max(...points.map((point) => point.x)) + padding - left,
      h: Math.max(...points.map((point) => point.y)) + padding - top,
    };
  }

  const w = Math.abs(element.w * Math.cos(angle)) + Math.abs(element.h * Math.sin(angle));
  const h = Math.abs(element.w * Math.sin(angle)) + Math.abs(element.h * Math.cos(angle));

  return { x: element.x + (element.w - w) / 2, y: element.y + (element.h - h) / 2, w, h };
}

export function selectionBounds(
  elements: readonly BoardElement[],
  ids: readonly string[],
): Rect | null {
  const selected = new Set(ids);

  return boundsOf(
    elements
      .filter((element) => selected.has(element.id))
      .map((element) => geometryBounds(element, elements)),
  );
}

function resizeAxisDelta(delta: number, atStart: boolean, atEnd: boolean) {
  if (atEnd) {
    return delta;
  }

  return atStart ? -delta : 0;
}

function resizeAxisPosition(
  start: number,
  length: number,
  resized: number,
  position: {
    atStart: boolean;
    atEnd: boolean;
    centered?: boolean;
  },
) {
  if (position.centered || (!position.atStart && !position.atEnd)) {
    return start + length / 2 - resized / 2;
  }

  return position.atStart ? start + length - resized : start;
}

export function resizeBox(
  start: Rect,
  handle: ResizeHandle,
  delta: Point,
  options: ResizeOptions = {},
): Rect {
  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');
  const scale = options.center ? 2 : 1;
  let w = start.w + resizeAxisDelta(delta.x, west, east) * scale;
  let h = start.h + resizeAxisDelta(delta.y, north, south) * scale;
  const minWidth = options.minWidth ?? 24;
  const minHeight = options.minHeight ?? 24;
  if (options.aspect) {
    const ratio = Math.max(1, start.w) / Math.max(1, start.h);
    const horizontal = east || west;
    const vertical = north || south;
    if (
      horizontal &&
      (!vertical ||
        Math.abs(w / Math.max(1, start.w) - 1) >= Math.abs(h / Math.max(1, start.h) - 1))
    ) {
      h = w / ratio;
    } else {
      w = h * ratio;
    }

    w = Math.max(minWidth, minHeight * ratio, w);
    h = w / ratio;
  } else {
    w = Math.max(minWidth, w);
    h = Math.max(minHeight, h);
  }

  return {
    x: resizeAxisPosition(start.x, start.w, w, {
      atStart: west,
      atEnd: east,
      centered: options.center,
    }),
    y: resizeAxisPosition(start.y, start.h, h, {
      atStart: north,
      atEnd: south,
      centered: options.center,
    }),
    w,
    h,
  };
}

function scaledStroke(element: BoardElement, sx: number, sy: number): Partial<BoardElement> {
  return element.type === 'stroke'
    ? {
        points: element.points?.map((coordinate, index) => coordinate * (index % 2 ? sy : sx)),
        strokeWidth: Math.min(
          100,
          Math.max(
            0.1,
            (Number(element.strokeWidth ?? element.width ?? 3) * (Math.abs(sx) + Math.abs(sy))) / 2,
          ),
        ),
      }
    : {};
}

export function resizeElement(
  element: BoardElement,
  handle: ResizeHandle,
  worldDelta: Point,
  options: ResizeOptions = {},
): Operation[] {
  if (element.locked) {
    return [];
  }

  const angle = ((element.rotation ?? 0) * Math.PI) / 180;
  const delta = turn(worldDelta, -angle);
  const local = resizeBox({ x: 0, y: 0, w: element.w, h: element.h }, handle, delta, options);
  const shift = turn(
    { x: local.x + (local.w - element.w) / 2, y: local.y + (local.h - element.h) / 2 },
    angle,
  );

  return [
    {
      op: 'update',
      id: element.id,
      changes: {
        x: element.x + element.w / 2 + shift.x - local.w / 2,
        y: element.y + element.h / 2 + shift.y - local.h / 2,
        w: local.w,
        h: local.h,
        ...scaledStroke(
          element,
          local.w / Math.max(1, element.w),
          local.h / Math.max(1, element.h),
        ),
      },
    },
  ];
}

export function resizeSelection(
  elements: readonly BoardElement[],
  ids: readonly string[],
  start: Rect,
  next: Rect,
): Operation[] {
  const selected = new Set(ids);
  const sx = next.w / Math.max(1, start.w);
  const sy = next.h / Math.max(1, start.h);
  const transform = (point: Point): Point => ({
    x: next.x + (point.x - start.x) * sx,
    y: next.y + (point.y - start.y) * sy,
  });

  return elements
    .filter((element) => selected.has(element.id) && !element.locked)
    .map((element) => {
      const center = transform({ x: element.x + element.w / 2, y: element.y + element.h / 2 });
      const w = Math.max(1, element.w * sx);
      const h = Math.max(1, element.h * sy);
      const changes: Partial<BoardElement> = {
        x: center.x - w / 2,
        y: center.y - h / 2,
        w,
        h,
        ...scaledStroke(element, sx, sy),
      };

      if (element.type === 'arrow') {
        if (element.labelOffset) {
          changes.labelOffset = { x: element.labelOffset.x * sx, y: element.labelOffset.y * sy };
        }
        if (element.labelSize) {
          changes.labelSize = { ...element.labelSize };
        }

        for (const end of ['from', 'to'] as const) {
          if (Array.isArray(element[end])) {
            const point = transform({ x: element[end][0], y: element[end][1] });
            changes[end] = [point.x, point.y];
          }
        }

        if (element.bends?.[0] === 'h' || element.bends?.[0] === 'v') {
          const horizontal = element.bends[0] === 'h';
          changes.bends = [
            element.bends[0],
            ...element.bends
              .slice(1)
              .map((value, index) => Number(value) * (horizontal === (index % 2 === 0) ? sx : sy)),
          ];
        } else if (element.bends?.length) {
          const bends = element.bends as number[];
          changes.bends = bends.flatMap((value, index) => {
            if (index % 2) {
              return [];
            }

            const point = transform({ x: value, y: bends[index + 1]! });

            return [point.x, point.y];
          });
        }
      }

      return { op: 'update', id: element.id, changes };
    });
}

export function rotateSelection(
  elements: readonly BoardElement[],
  ids: readonly string[],
  angle: number,
  pivot?: Point,
): Operation[] {
  const selected = new Set(ids);
  const bounds = selectionBounds(elements, ids);
  if (!bounds) {
    return [];
  }

  const center = pivot ?? { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
  const radians = (angle * Math.PI) / 180;
  const transform = (point: Point) => {
    const relative = turn({ x: point.x - center.x, y: point.y - center.y }, radians);

    return { x: center.x + relative.x, y: center.y + relative.y };
  };

  return elements
    .filter((element) => selected.has(element.id) && !element.locked)
    .map((element) => {
      const at = transform({ x: element.x + element.w / 2, y: element.y + element.h / 2 });
      const changes: Partial<BoardElement> = { x: at.x - element.w / 2, y: at.y - element.h / 2 };
      if (element.type === 'arrow') {
        if (element.labelOffset) {
          changes.labelOffset = turn(element.labelOffset, radians);
        }
        if (element.labelSize) {
          changes.labelSize = { ...element.labelSize };
        }

        for (const end of ['from', 'to'] as const) {
          if (Array.isArray(element[end])) {
            const point = transform({ x: element[end][0], y: element[end][1] });
            changes[end] = [point.x, point.y];
          }
        }

        if (element.bends?.length) {
          changes.bends = arrowGeometry(element, elements)
            .points.slice(1, -1)
            .flatMap((point) => {
              const at = transform(point);

              return [at.x, at.y];
            });
        }
      } else {
        changes.rotation = normalizedAngle(Number(element.rotation ?? 0) + angle);
      }

      return { op: 'update', id: element.id, changes };
    });
}

type SnapAxis = 'x' | 'y';
interface SnapCandidate {
  shift: number;
  at: number;
  box: Rect;
}

function snapAnchors(bounds: Rect, axis: SnapAxis) {
  const origin = bounds[axis];
  const length = axis === 'x' ? bounds.w : bounds.h;

  return [origin, origin + length / 2, origin + length];
}

function closestSnap(
  dragged: Rect,
  target: Rect,
  axis: SnapAxis,
  threshold: number,
  initial?: SnapCandidate,
) {
  let nearest = initial;
  const draggedAnchors = snapAnchors(dragged, axis);
  for (const at of snapAnchors(target, axis)) {
    for (const point of draggedAnchors) {
      const shift = at - point;
      if (Math.abs(shift) <= threshold && (!nearest || Math.abs(shift) < Math.abs(nearest.shift))) {
        nearest = { shift, at, box: target };
      }
    }
  }

  return nearest;
}

export function snapMove(
  elements: readonly BoardElement[],
  ids: readonly string[],
  delta: Point,
  zoom = 1,
): { delta: Point; guides: AlignmentGuide[] } {
  const movable = ids.filter((id) => !elements.find((element) => element.id === id)?.locked);
  const moved = new Set(
    expandMoveIds(elements, movable).filter(
      (id) => !elements.find((element) => element.id === id)?.locked,
    ),
  );
  const before = selectionBounds(elements, [...moved]);
  if (!before) {
    return { delta, guides: [] };
  }

  const box = { ...before, x: before.x + delta.x, y: before.y + delta.y };
  const threshold = 6 / zoom;
  const candidates: Partial<Record<SnapAxis, SnapCandidate>> = {};
  for (const element of elements) {
    if (moved.has(element.id) || ['arrow', 'stroke'].includes(element.type)) {
      continue;
    }

    const target = geometryBounds(element, elements);
    for (const axis of ['x', 'y'] as const) {
      candidates[axis] = closestSnap(box, target, axis, threshold, candidates[axis]);
    }
  }

  const snapped = {
    x: delta.x + (candidates.x?.shift ?? 0),
    y: delta.y + (candidates.y?.shift ?? 0),
  };
  const guides = (['x', 'y'] as const).flatMap((axis) => {
    const target = candidates[axis];
    if (!target) {
      return [];
    }

    return [
      {
        axis,
        at: target.at,
        from:
          axis === 'x'
            ? Math.min(before.y + snapped.y, target.box.y)
            : Math.min(before.x + snapped.x, target.box.x),
        to:
          axis === 'x'
            ? Math.max(before.y + snapped.y + before.h, target.box.y + target.box.h)
            : Math.max(before.x + snapped.x + before.w, target.box.x + target.box.w),
      },
    ];
  });

  return { delta: snapped, guides };
}

interface SelectionUnit {
  ids: string[];
  bounds: Rect;
}

function unitsFor(elements: readonly BoardElement[], ids: readonly string[]): SelectionUnit[] {
  const selected = elements.filter((element) => ids.includes(element.id) && !element.locked);
  const parent = new Map(selected.map((element) => [element.id, element.id]));
  const root = (id: string): string => (parent.get(id) === id ? id : root(parent.get(id)!));
  for (const a of selected) {
    for (const b of selected) {
      const sameGroup = a.groupId && a.groupId === b.groupId;
      const containsMember = a.type === 'container' && (b.parentId === a.id || contains(a, b));
      if (sameGroup || containsMember) {
        parent.set(root(b.id), root(a.id));
      }
    }
  }

  const groups = new Map<string, string[]>();
  for (const element of selected) {
    const key = root(element.id);
    groups.set(key, [...(groups.get(key) ?? []), element.id]);
  }

  return [...groups.values()].map((ids) => {
    const members = expandMoveIds(elements, ids).filter(
      (id) => !elements.find((element) => element.id === id)?.locked,
    );

    return { ids: members, bounds: selectionBounds(elements, members)! };
  });
}

function alignmentDelta(bounds: Rect, own: Rect, edge: AlignEdge): Point {
  switch (edge) {
    case 'left':
      return { x: bounds.x - own.x, y: 0 };
    case 'right':
      return { x: bounds.x + bounds.w - own.x - own.w, y: 0 };
    case 'hcenter':
      return { x: bounds.x + bounds.w / 2 - own.x - own.w / 2, y: 0 };
    case 'top':
      return { x: 0, y: bounds.y - own.y };
    case 'bottom':
      return { x: 0, y: bounds.y + bounds.h - own.y - own.h };
    case 'vcenter':
      return { x: 0, y: bounds.y + bounds.h / 2 - own.y - own.h / 2 };
  }
}

export function alignSelection(
  elements: readonly BoardElement[],
  ids: readonly string[],
  edge: AlignEdge,
): Operation[] {
  const bounds = selectionBounds(elements, ids);
  if (!bounds) {
    return [];
  }

  return unitsFor(elements, ids).flatMap((unit) => {
    const delta = alignmentDelta(bounds, unit.bounds, edge);

    return delta.x || delta.y ? moveOperations(elements, unit.ids, delta) : [];
  });
}

export function tidySelection(
  elements: readonly BoardElement[],
  ids: readonly string[],
  gap = 24,
): Operation[] {
  const units = unitsFor(
    elements,
    ids.filter(
      (id) =>
        !['arrow', 'stroke', 'container'].includes(
          elements.find((element) => element.id === id)?.type ?? '',
        ),
    ),
  ).sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);

  if (units.length < 2) {
    return [];
  }

  const bounds = boundsOf(units.map((unit) => unit.bounds))!;
  const columns = Math.ceil(Math.sqrt(units.length));
  const width = Math.max(...units.map((unit) => unit.bounds.w));
  const height = Math.max(...units.map((unit) => unit.bounds.h));

  return units.flatMap((unit, index) =>
    moveOperations(elements, unit.ids, {
      x: bounds.x + (index % columns) * (width + gap) + (width - unit.bounds.w) / 2 - unit.bounds.x,
      y: bounds.y + Math.floor(index / columns) * (height + gap) - unit.bounds.y,
    }),
  );
}
