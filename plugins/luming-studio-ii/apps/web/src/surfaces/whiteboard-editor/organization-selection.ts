import type { CanvasObject } from '../../ui/domain/canvas/index.js';

interface LockChange {
  readonly locked: boolean;
  readonly ids: readonly string[];
}

export interface SelectionLocks {
  readonly ids: ReadonlySet<string>;
  readonly change?: LockChange;
}

function lockedAncestors(
  object: CanvasObject,
  objectsById: ReadonlyMap<string, CanvasObject>,
): readonly string[] | undefined {
  const locked: string[] = [];
  const visited = new Set([object.id]);
  let id = object.parentId;
  while (id !== undefined) {
    if (visited.has(id)) {
      return undefined;
    }

    visited.add(id);
    const parent = objectsById.get(id);
    if (parent?.locked) {
      locked.push(id);
    }
    id = parent?.parentId;
  }

  return locked;
}

export function describeSelectionLocks(
  selection: readonly CanvasObject[],
  objectsById: ReadonlyMap<string, CanvasObject>,
): SelectionLocks {
  const selectedIds = new Set(selection.map(({ id }) => id));
  const objects = selection.map((object) => ({
    object,
    ancestors: lockedAncestors(object, objectsById),
  }));
  const ids = new Set(
    objects
      .filter(({ object, ancestors }) => object.locked || ancestors?.length !== 0)
      .map(({ object }) => object.id),
  );
  const locked = ids.size !== selection.length;
  const targets = objects
    .filter(({ object, ancestors }) => {
      if (!ancestors) {
        return false;
      }

      return locked
        ? !object.locked && ancestors.length === 0
        : object.locked && ancestors.every((id) => selectedIds.has(id));
    })
    .map(({ object }) => object.id);

  return { ids, change: targets.length ? { locked, ids: targets } : undefined };
}
