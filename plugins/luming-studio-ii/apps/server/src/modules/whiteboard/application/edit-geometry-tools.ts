import {
  arrangeSelection,
  canAdvanceVersion,
  geometryInWorld,
  selectionFrame,
  translateObject,
  validNewObjectId,
  validateCreatedObject,
  type BoardEditDecision,
  type BoardHeader,
  type BoardObject,
  type GeometryOperation,
  type MoveTarget,
} from '../domain/index.js';
import type { BoardEditPlanningReader } from '../ports/index.js';
import { createMoveScope } from './move-scope.js';

type Grouping = Extract<GeometryOperation, { kind: 'group' | 'ungroup' }>;
type Section = Extract<GeometryOperation, { kind: 'createSection' }>;
type Arrange = Extract<GeometryOperation, { kind: 'arrange' }>;

export interface GeometryToolsScope {
  readonly board: BoardHeader;
  readonly writer: BoardEditPlanningReader;
  readonly object: (id: string) => BoardObject | undefined;
  readonly locked: (object: BoardObject) => boolean;
}

const maximumDerivedObjects = 2048;

export function updateObjectGroups(
  scope: GeometryToolsScope,
  selected: readonly BoardObject[],
  operation: Grouping,
): BoardEditDecision {
  const groupId = operation.kind === 'group' ? operation.groupId : undefined;
  if (groupId !== undefined) {
    if (selected.length < 2 || !validNewObjectId(groupId)) {
      return { kind: 'rejected', reason: 'invalidEdit' };
    }
    if (scope.writer.listGroupObjects(scope.board.boardId, groupId).length) {
      return { kind: 'rejected', reason: 'invalidEdit' };
    }
  }

  const touched = selected.filter((object) => object.groupId !== groupId);
  if (!touched.length) {
    return { kind: 'rejected', reason: 'invalidEdit' };
  }
  if (touched.some(scope.locked)) {
    return { kind: 'rejected', reason: 'geometryLocked' };
  }
  if (touched.some(({ geometryVersion }) => !canAdvanceVersion(geometryVersion))) {
    return { kind: 'rejected', reason: 'versionUnavailable' };
  }

  return {
    kind: 'changes',
    objects: touched.map((object) => ({
      ...object,
      groupId,
      geometryVersion: object.geometryVersion + 1n,
    })),
  };
}

function selectedAncestor(
  scope: GeometryToolsScope,
  id: string | undefined,
  selected: ReadonlySet<string>,
): boolean {
  let parentId = id;
  const visited = new Set<string>();
  while (parentId !== undefined && !visited.has(parentId)) {
    if (selected.has(parentId)) {
      return true;
    }

    visited.add(parentId);
    parentId = scope.object(parentId)?.parentId;
  }

  return false;
}

function commonParent(objects: readonly BoardObject[]): string | undefined {
  const parentId = objects[0]?.parentId;

  return objects.every((object) => object.parentId === parentId) ? parentId : undefined;
}

function orderWithSection(
  objects: readonly BoardObject[],
  selected: ReadonlySet<string>,
  sectionId: string,
): readonly string[] {
  const ids = objects.map(({ objectId }) => objectId);
  const before = ids.findIndex((id) => selected.has(id));
  ids.splice(before < 0 ? 0 : before, 0, sectionId);

  return ids;
}

export function createSelectionSection(
  scope: GeometryToolsScope,
  selected: readonly BoardObject[],
  { sectionId, title }: Section,
): BoardEditDecision {
  const { boardId } = scope.board;
  const parentsValid =
    validNewObjectId(sectionId) && !scope.writer.hasUsedObjectId(boardId, sectionId);

  if (selected.length < 2 || !parentsValid) {
    return { kind: 'rejected', reason: 'invalidEdit' };
  }

  const ids = new Set(selected.map(({ objectId }) => objectId));
  const roots = selected.filter(({ parentId }) => !selectedAncestor(scope, parentId, ids));
  const writable = roots.filter((object) => !scope.locked(object));
  if (
    !roots.length ||
    writable.some(({ geometryVersion }) => !canAdvanceVersion(geometryVersion))
  ) {
    return { kind: 'rejected', reason: 'versionUnavailable' };
  }

  const ordered = scope.writer.listObjects(boardId);
  const scene = new Map(ordered.map((object) => [object.objectId, object]));
  const geometry = selectionFrame({ scene, selected }, true);
  const label = title?.trim() || '分区';
  const parentId = commonParent(writable);
  const section: BoardObject = {
    objectId: sectionId,
    kind: 'section',
    label,
    geometry,
    geometryVersion: 0n,
    payloadVersion: 0n,
    parentId,
    locked: false,
    appearance: { fill: 'transparent' },
    detail: { kind: 'section', transparent: true },
  };

  if (!validateCreatedObject(section)) {
    return { kind: 'rejected', reason: 'invalidEdit' };
  }

  const children = writable.map((object) => ({
    ...object,
    parentId: sectionId,
    geometryVersion: object.geometryVersion + 1n,
  }));

  return {
    kind: 'changes',
    objects: [section, ...children],
    payloads: [
      { objectId: sectionId, payloadVersion: 0n, bodyKind: 'text', data: { text: label } },
    ],
    order: orderWithSection(ordered, ids, sectionId),
  };
}

function requiredLayoutObjects(
  scope: GeometryToolsScope,
  targets: readonly MoveTarget[],
  movable: readonly BoardObject[],
) {
  const moves = createMoveScope(scope.writer, scope.board.boardId, targets);

  return moves.requiredObjects(movable);
}

export function arrangeGeometry(
  scope: GeometryToolsScope,
  selected: readonly BoardObject[],
  operation: Arrange,
): BoardEditDecision {
  const { boardId, revision } = scope.board;
  const movable = selected.filter((object) => !scope.locked(object));
  if (movable.length < 2) {
    return { kind: 'rejected', reason: 'invalidEdit' };
  }

  const required = requiredLayoutObjects(scope, operation.targets, movable);
  if (required.length > maximumDerivedObjects) {
    return { kind: 'rejected', reason: 'tooLarge' };
  }

  const ids = new Set(selected.map(({ objectId }) => objectId));
  if (required.some(({ objectId }) => !ids.has(objectId))) {
    return { kind: 'conflict', boardRevision: revision, objects: required };
  }

  const scene = new Map(
    scope.writer.listObjects(boardId).map((object) => [object.objectId, object]),
  );
  const offsets = arrangeSelection({ scene, selected }, movable, operation.preset);
  if (!offsets.size) {
    return { kind: 'rejected', reason: 'invalidEdit' };
  }
  if (scope.writer.listRelatedConnectors(boardId, [...offsets.keys()]).some(scope.locked)) {
    return { kind: 'rejected', reason: 'geometryLocked' };
  }

  const objects: BoardObject[] = [];
  for (const object of movable) {
    const delta = offsets.get(object.objectId);
    if (!delta) {
      continue;
    }

    const moved = translateObject(object, delta);
    if (!moved || !geometryInWorld(moved.geometry)) {
      return { kind: 'rejected', reason: 'invalidEdit' };
    }

    objects.push(moved);
  }

  return { kind: 'changes', objects };
}
