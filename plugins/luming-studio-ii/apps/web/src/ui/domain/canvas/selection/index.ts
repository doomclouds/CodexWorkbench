import { connectionHitRadius, hitConnection } from '../connectors/geometry.js';
import type { CanvasObjectChange, CanvasPoint, CanvasRect } from '../contracts.js';
import { hitInk } from '../ink/geometry.js';
import type { ProjectedCanvasObject, SceneIndex } from '../scene/index.js';
import {
  isObjectLocked,
  projectedObjectBounds,
  projectObject,
  queryScene,
} from '../scene/index.js';
import { containsPoint, rectsIntersect } from '../viewport/index.js';
import { crossesSectionEdge, hitsSectionEdge, withinSection } from './geometry.js';

export function canvasHitBounds(point: CanvasPoint, zoom: number): CanvasRect {
  const radius = connectionHitRadius(zoom);

  return {
    x: point.x - radius,
    y: point.y - radius,
    width: radius * 2,
    height: radius * 2,
  };
}

function hitsObject(
  { object, geometry, connectorRoute }: ProjectedCanvasObject,
  point: CanvasPoint,
  zoom: number,
) {
  if (object.kind === 'ink') {
    return hitInk(object.ink, geometry, point, zoom);
  }
  if (object.kind === 'connector') {
    return connectorRoute !== undefined && hitConnection(connectorRoute, point, zoom);
  }
  if (object.kind === 'section' && object.transparent) {
    return hitsSectionEdge(point, geometry, zoom);
  }

  return containsPoint(point, geometry);
}

export function hitTest(
  objects: readonly ProjectedCanvasObject[],
  point: CanvasPoint,
  zoom = 1,
): string | undefined {
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const entry = objects[index];
    if (entry && hitsObject(entry, point, zoom)) {
      return entry.object.id;
    }
  }

  return undefined;
}

function marqueeHits(entry: ProjectedCanvasObject, rect: CanvasRect) {
  const { object, geometry } = entry;
  if (object.kind === 'connector' || !rectsIntersect(projectedObjectBounds(entry), rect)) {
    return false;
  }
  if (object.kind === 'section' && object.transparent) {
    return crossesSectionEdge(geometry, rect);
  }

  return true;
}

export function marqueeSelection(
  objects: readonly ProjectedCanvasObject[],
  rect: CanvasRect,
  initialSelection?: readonly string[],
): readonly string[] {
  const selected = new Set(initialSelection);
  for (const entry of objects) {
    if (marqueeHits(entry, rect)) {
      selected.add(entry.object.id);
    }
  }

  return [...selected];
}

export function selectObject(
  selection: readonly string[],
  id: string,
  toggle: boolean,
  index?: SceneIndex,
): readonly string[] {
  const groupId = index?.get(id)?.groupId;
  const members = groupId === undefined ? [id] : (index?.groupMembers(groupId) ?? [id]);
  if (!toggle) {
    return members;
  }

  const selected = new Set(selection);
  const remove = selected.has(id);
  for (const member of members) {
    if (remove) {
      selected.delete(member);
    } else {
      selected.add(member);
    }
  }

  return [...selected];
}

export function expandMoveIds(
  index: SceneIndex,
  selection: readonly string[],
  changes: ReadonlyMap<string, CanvasObjectChange> = new Map(),
): readonly string[] {
  const pending = new Set(selection);
  const seenGroups = new Set<string>();
  const movable: string[] = [];
  for (const id of pending) {
    const entry = projectObject(index, changes, id);
    if (!entry || isObjectLocked(index, id)) {
      continue;
    }

    movable.push(id);
    addIds(index.childrenOf(id));
    const { groupId, kind } = entry.object;
    if (groupId !== undefined && !seenGroups.has(groupId)) {
      seenGroups.add(groupId);
      addIds(index.groupMembers(groupId));
    }
    if (kind !== 'section') {
      continue;
    }

    for (const candidate of queryScene(index, projectedObjectBounds(entry), changes)) {
      if (!pending.has(candidate.object.id) && withinSection(candidate, entry.geometry)) {
        pending.add(candidate.object.id);
      }
    }
  }

  return movable;

  function addIds(ids: readonly string[]) {
    for (const id of ids) {
      pending.add(id);
    }
  }
}
