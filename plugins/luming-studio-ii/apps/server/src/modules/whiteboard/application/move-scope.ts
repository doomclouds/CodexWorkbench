import type { BoardObject, MoveTarget } from '../domain/index.js';
import { canTranslate, sectionContains } from '../domain/index.js';
import type { WhiteboardWriter } from '../ports/index.js';

type MoveReader = Pick<
  WhiteboardWriter,
  'getObjects' | 'listGroupObjects' | 'listChildObjects' | 'listObjects'
>;

interface MoveScope {
  readonly targets: ReadonlyMap<string, BoardObject | undefined>;
  isLocked(object: BoardObject): boolean;
  requiredObjects(objects: readonly BoardObject[]): readonly BoardObject[];
}

function ancestorsLocked(object: BoardObject, getObject: (id: string) => BoardObject | undefined) {
  const visited = new Set<string>();
  let current: BoardObject | undefined = object;
  while (current && !visited.has(current.objectId)) {
    if (current.locked) {
      return true;
    }

    visited.add(current.objectId);
    current = current.parentId === undefined ? undefined : getObject(current.parentId);
  }

  return false;
}

function collectObjects(
  initial: readonly BoardObject[],
  getRelated: (object: BoardObject) => readonly BoardObject[],
  isLocked: (object: BoardObject) => boolean,
): readonly BoardObject[] {
  const pending = new Map(initial.map((object) => [object.objectId, object]));
  for (const object of pending.values()) {
    for (const candidate of getRelated(object)) {
      if (!pending.has(candidate.objectId) && !isLocked(candidate)) {
        pending.set(candidate.objectId, candidate);
      }
    }
  }

  return [...pending.values()].filter(canTranslate);
}

export function createMoveScope(
  writer: MoveReader,
  boardId: string,
  targets: readonly MoveTarget[],
): MoveScope {
  const objectIds = targets.map(({ objectId }) => objectId);
  const cachedObjects = new Map<string, BoardObject | undefined>(
    objectIds.map((id) => [id, undefined]),
  );
  remember(writer.getObjects(boardId, objectIds));
  const visitedGroups = new Set<string>();
  let scene: readonly BoardObject[] | undefined;

  function remember(objects: readonly BoardObject[]) {
    for (const object of objects) {
      cachedObjects.set(object.objectId, object);
    }

    return objects;
  }

  function getObject(id: string) {
    if (!cachedObjects.has(id) && scene === undefined) {
      cachedObjects.set(id, writer.getObjects(boardId, [id])[0]);
    }

    return cachedObjects.get(id);
  }

  function groupMembers(groupId?: string) {
    if (groupId === undefined || visitedGroups.has(groupId)) {
      return [];
    }

    visitedGroups.add(groupId);

    return remember(writer.listGroupObjects(boardId, groupId));
  }

  function sectionMembers(object: BoardObject) {
    if (object.kind !== 'section') {
      return [];
    }

    scene ??= remember(writer.listObjects(boardId));

    return scene.filter((member) => sectionContains(object.geometry, member.geometry));
  }

  function getRelated(object: BoardObject) {
    const children = remember(writer.listChildObjects(boardId, object.objectId));

    return [...children, ...groupMembers(object.groupId), ...sectionMembers(object)];
  }

  function isLocked(object: BoardObject) {
    return ancestorsLocked(object, getObject);
  }

  return {
    targets: new Map(objectIds.map((id) => [id, getObject(id)])),
    isLocked,
    requiredObjects: (objects) => collectObjects(objects, getRelated, isLocked),
  };
}
