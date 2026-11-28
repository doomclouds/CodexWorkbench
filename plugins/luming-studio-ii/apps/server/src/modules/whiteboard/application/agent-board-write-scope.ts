import type { BoardChanges, BoardObject, Geometry } from '../domain/index.js';
import type { BoardEditPlanningReader } from '../ports/index.js';
import { suggestionWrittenIds } from './board-suggestion-plans.js';

export type AgentWriteBounds = Omit<Geometry, 'rotation'>;

export type AgentWriteScope =
  | { readonly kind: 'objects'; readonly objectIds: readonly string[] }
  | { readonly kind: 'area'; readonly bounds: AgentWriteBounds };

export interface AgentWriteWorkspace {
  readonly agentId: string;
  readonly taskId: string;
  readonly generation: string;
  readonly scope: AgentWriteScope;
}

interface WorkspaceFootprint {
  readonly ids: ReadonlySet<string>;
  readonly areas: readonly AgentWriteBounds[];
}

export function agentWriteBounds({ x, y, width, height, rotation }: Geometry): AgentWriteBounds {
  const angle = (rotation * Math.PI) / 180;
  const sine = Math.abs(Math.sin(angle));
  const cosine = Math.abs(Math.cos(angle));
  const wrappedWidth = Math.max(1, cosine * width + sine * height);
  const wrappedHeight = Math.max(1, sine * width + cosine * height);

  return {
    x: x + (width - wrappedWidth) / 2,
    y: y + (height - wrappedHeight) / 2,
    width: wrappedWidth,
    height: wrappedHeight,
  };
}

function contained(outer: AgentWriteBounds, inner: AgentWriteBounds): boolean {
  const epsilon = 1e-6;
  const fitsX =
    inner.x >= outer.x - epsilon && inner.x + inner.width <= outer.x + outer.width + epsilon;
  const fitsY =
    inner.y >= outer.y - epsilon && inner.y + inner.height <= outer.y + outer.height + epsilon;

  return fitsX && fitsY;
}

function overlaps(left: AgentWriteBounds, right: AgentWriteBounds): boolean {
  const crossesX = left.x < right.x + right.width && right.x < left.x + left.width;
  const crossesY = left.y < right.y + right.height && right.y < left.y + left.height;

  return crossesX && crossesY;
}

function footprint(
  reader: BoardEditPlanningReader,
  boardId: string,
  scope: AgentWriteScope,
): WorkspaceFootprint {
  return scope.kind === 'area'
    ? { ids: new Set<string>(), areas: [scope.bounds] }
    : {
        ids: new Set(scope.objectIds),
        areas: reader
          .getObjects(boardId, scope.objectIds)
          .map(({ geometry }) => agentWriteBounds(geometry)),
      };
}

export function agentWorkspacesDisjoint(
  reader: BoardEditPlanningReader,
  boardId: string,
  target: AgentWriteWorkspace,
  workspaces: readonly AgentWriteWorkspace[],
): boolean {
  const current = footprint(reader, boardId, target.scope);

  return workspaces.every((workspace) => {
    if (workspace === target) {
      return true;
    }

    const other = footprint(reader, boardId, workspace.scope);
    const sharedObject = [...other.ids].some((id) => current.ids.has(id));
    const overlapsArea = current.areas.some((area) =>
      other.areas.some((bound) => overlaps(bound, area)),
    );

    return !sharedObject && !overlapsArea;
  });
}

function ownsObject(scope: AgentWriteScope, object: BoardObject): boolean {
  return scope.kind === 'objects'
    ? scope.objectIds.includes(object.objectId)
    : contained(scope.bounds, agentWriteBounds(object.geometry));
}

export function agentOwnsTargets(
  reader: BoardEditPlanningReader,
  boardId: string,
  scope: AgentWriteScope,
  ids: readonly string[],
): boolean {
  if (scope.kind === 'objects') {
    return ids.every((id) => scope.objectIds.includes(id));
  }

  const unique = [...new Set(ids)];
  const objects = reader.getObjects(boardId, unique);

  return objects.length === unique.length && objects.every((object) => ownsObject(scope, object));
}

function reorderedIds(reader: BoardEditPlanningReader, boardId: string, order?: readonly string[]) {
  if (!order) {
    return [];
  }

  const current = reader.listObjects(boardId).map(({ objectId }) => objectId);
  const currentSet = new Set(current);
  const incomingSet = new Set(order);
  const before = current.filter((id) => incomingSet.has(id));
  const after = order.filter((id) => currentSet.has(id));

  return after.filter((id, index) => before[index] !== id);
}

function changedPosition(before: BoardObject | undefined, after: BoardObject | undefined) {
  if (!before) {
    return false;
  }
  if (!after) {
    return true;
  }

  const left = before.geometry;
  const right = after.geometry;
  const moved = left.x !== right.x || left.y !== right.y;
  const sized = left.width !== right.width || left.height !== right.height;
  const reshaped =
    before.detail?.kind === 'shape' &&
    after.detail?.kind === 'shape' &&
    before.detail.outline !== after.detail.outline;
  const geometryChanged = moved || sized || left.rotation !== right.rotation;

  return geometryChanged || reshaped;
}

function ownsChangedReferences(
  reader: BoardEditPlanningReader,
  boardId: string,
  scope: AgentWriteScope,
  before: BoardObject | undefined,
  after: BoardObject,
  changed: ReadonlyMap<string, BoardObject>,
): boolean {
  const { parentId, groupId } = after;
  if (parentId && before?.parentId !== parentId) {
    const parent = changed.get(parentId) ?? reader.getObjects(boardId, [parentId])[0];
    if (!parent || !ownsObject(scope, parent)) {
      return false;
    }
  }

  return (
    !groupId ||
    before?.groupId === groupId ||
    reader
      .listGroupObjects(boardId, groupId)
      .every((object) => ownsObject(scope, changed.get(object.objectId) ?? object))
  );
}

export function agentOwnsChanges(
  reader: BoardEditPlanningReader,
  boardId: string,
  scope: AgentWriteScope,
  changes: BoardChanges,
): boolean {
  if (changes.customColors || changes.assets?.length) {
    return false;
  }

  const affected = [
    ...suggestionWrittenIds(changes),
    ...reorderedIds(reader, boardId, changes.order),
  ];
  const current = new Map(
    reader.getObjects(boardId, affected).map((object) => [object.objectId, object]),
  );
  const changed = new Map((changes.objects ?? []).map((object) => [object.objectId, object]));
  const removed = new Set(changes.removedObjectIds);
  const moved = [...current.keys()].filter((id) =>
    changedPosition(
      current.get(id),
      removed.has(id) ? undefined : (changed.get(id) ?? current.get(id)),
    ),
  );
  const connectors = moved.length ? reader.listRelatedConnectors(boardId, moved) : [];
  if (connectors.some((line) => !ownsObject(scope, line))) {
    return false;
  }

  return affected.every((id) => {
    const before = current.get(id);
    const after = changed.get(id);
    const outsideBefore = before && !ownsObject(scope, before);
    const outsideAfter = after && !ownsObject(scope, after);
    const missing = !before && !after;
    if (outsideBefore || outsideAfter || missing) {
      return false;
    }

    return !after || ownsChangedReferences(reader, boardId, scope, before, after, changed);
  });
}
