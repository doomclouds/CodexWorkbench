import { exportConnector, geometryCorners } from './export-geometry.js';
import type { BoardArrange } from './geometry-parity.js';
import type { BoardObject, Geometry, MoveDelta, Point } from './model.js';
import { sectionContains } from './section.js';

interface LayoutUnit {
  readonly ids: readonly string[];
  readonly bounds: Geometry;
}

interface LayoutScope {
  readonly scene: ReadonlyMap<string, BoardObject>;
  readonly selected: readonly BoardObject[];
}

const gap = 24;
const sectionLabelHeight = 35.5;
const htmlLabelHeight = 32;
const notTidied = new Set(['connector', 'ink', 'section']);

function boundsOf(points: readonly Point[]): Geometry {
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);

  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y, rotation: 0 };
}

function objectPoints(
  object: BoardObject,
  scene: ReadonlyMap<string, BoardObject>,
  includeLabels: boolean,
): readonly Point[] {
  const { detail, kind } = object;
  if (detail?.kind === 'connector') {
    const connector = exportConnector(detail, scene);
    if (connector?.points.length) {
      return connector.points;
    }
  }

  const corners = geometryCorners(object.geometry);
  if (!includeLabels || (kind !== 'section' && kind !== 'html')) {
    return corners;
  }

  const { x, y } = boundsOf(corners);
  const titleHeight = kind === 'section' ? sectionLabelHeight : htmlLabelHeight;

  return [...corners, { x, y: y - titleHeight }];
}

export function selectionFrame({ scene, selected }: LayoutScope, includeLabels = false): Geometry {
  const span = boundsOf(selected.flatMap((object) => objectPoints(object, scene, includeLabels)));
  if (!includeLabels) {
    return span;
  }

  return {
    ...span,
    x: span.x - gap,
    y: span.y - gap,
    width: span.width + 2 * gap,
    height: span.height + 2 * gap,
  };
}

function rootOf(parents: ReadonlyMap<string, string>, id: string): string {
  let root = id;
  let parent = parents.get(root);
  while (parent !== undefined && parent !== root) {
    root = parent;
    parent = parents.get(root);
  }

  return root;
}

function layoutUnits({ scene, selected }: LayoutScope): readonly LayoutUnit[] {
  const parents = new Map(selected.map(({ objectId }) => [objectId, objectId]));
  for (const owner of selected) {
    for (const member of selected) {
      const grouped = owner.groupId !== undefined && owner.groupId === member.groupId;
      const enclosed = owner.kind === 'section' && sectionContains(owner.geometry, member.geometry);
      if (grouped || enclosed || member.parentId === owner.objectId) {
        parents.set(rootOf(parents, member.objectId), rootOf(parents, owner.objectId));
      }
    }
  }

  const members = new Map<string, BoardObject[]>();
  for (const object of selected) {
    const root = rootOf(parents, object.objectId);
    const group = members.get(root);
    if (group) {
      group.push(object);
    } else {
      members.set(root, [object]);
    }
  }

  return [...members.values()].map((objects) => ({
    ids: objects.map(({ objectId }) => objectId),
    bounds: selectionFrame({ scene, selected: objects }),
  }));
}

function alignDelta(
  target: Geometry,
  own: Geometry,
  preset: Exclude<BoardArrange, 'tidy'>,
): MoveDelta {
  switch (preset) {
    case 'left':
      return { dx: target.x - own.x, dy: 0 };
    case 'right':
      return { dx: target.x + target.width - own.x - own.width, dy: 0 };
    case 'hcenter':
      return { dx: target.x + (target.width - own.width) / 2 - own.x, dy: 0 };
    case 'top':
      return { dx: 0, dy: target.y - own.y };
    case 'bottom':
      return { dx: 0, dy: target.y + target.height - own.y - own.height };
    case 'vcenter':
      return { dx: 0, dy: target.y + (target.height - own.height) / 2 - own.y };
  }
}

function tidyUnits(units: readonly LayoutUnit[]) {
  const ordered = [...units].sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
  const columns = Math.ceil(Math.sqrt(ordered.length));
  const x = Math.min(...ordered.map((unit) => unit.bounds.x));
  const y = Math.min(...ordered.map((unit) => unit.bounds.y));
  const width = Math.max(...ordered.map((unit) => unit.bounds.width));
  const height = Math.max(...ordered.map((unit) => unit.bounds.height));

  return ordered.map(({ bounds, ids }, index) => ({
    ids,
    delta: {
      dx: x + (index % columns) * (width + gap) + (width - bounds.width) / 2 - bounds.x,
      dy: y + Math.floor(index / columns) * (height + gap) - bounds.y,
    },
  }));
}

export function arrangeSelection(
  selection: LayoutScope,
  movable: readonly BoardObject[],
  preset: BoardArrange,
): ReadonlyMap<string, MoveDelta> {
  const { scene } = selection;
  const grouped = layoutUnits({ scene, selected: movable });
  const units =
    preset === 'tidy'
      ? grouped.filter(({ ids }) => ids.some((id) => !notTidied.has(scene.get(id)?.kind ?? '')))
      : grouped;

  if (units.length < 2) {
    return new Map();
  }

  const target = selectionFrame(selection);
  const offsets =
    preset === 'tidy'
      ? tidyUnits(units)
      : units.map(({ bounds, ids }) => ({ ids, delta: alignDelta(target, bounds, preset) }));
  const result = new Map<string, MoveDelta>();
  for (const { ids, delta } of offsets) {
    if (delta.dx !== 0 || delta.dy !== 0) {
      for (const id of ids) {
        result.set(id, delta);
      }
    }
  }

  return result;
}
