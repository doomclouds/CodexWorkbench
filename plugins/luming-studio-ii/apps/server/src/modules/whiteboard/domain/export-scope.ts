import { exportConnector, geometryCorners } from './export-geometry.js';
import type {
  BoardExportRectangle,
  BoardExportRejection,
  BoardExportScope,
} from './export-types.js';
import type { BoardObject } from './model.js';
import { sectionContains } from './section.js';

const maxContainmentChecks = 1_000_000;

function indexByRelation(
  objects: readonly BoardObject[],
  field: 'parentId' | 'groupId',
): ReadonlyMap<string, readonly BoardObject[]> {
  const index = new Map<string, BoardObject[]>();

  for (const object of objects) {
    const relation = object[field];
    if (relation === undefined) {
      continue;
    }

    const bucket = index.get(relation);
    if (bucket) {
      bucket.push(object);
    } else {
      index.set(relation, [object]);
    }
  }

  return index;
}

function addObjects(ids: Set<string>, objects: readonly BoardObject[] | undefined) {
  for (const { objectId } of objects ?? []) {
    ids.add(objectId);
  }
}

function includeWithinSection(
  ids: Set<string>,
  objects: readonly BoardObject[],
  section: BoardObject,
) {
  for (const object of objects) {
    if (!ids.has(object.objectId) && sectionContains(section.geometry, object.geometry)) {
      ids.add(object.objectId);
    }
  }
}

function expandSelection(
  ids: Set<string>,
  objects: readonly BoardObject[],
  byId: ReadonlyMap<string, BoardObject>,
): BoardExportRejection | undefined {
  const byParent = indexByRelation(objects, 'parentId');
  const byGroup = indexByRelation(objects, 'groupId');
  const groups = new Set<string>();
  let checks = 0;

  for (const id of ids) {
    const entry = byId.get(id);
    if (!entry) {
      return { kind: 'rejected', reason: 'invalidSelection' };
    }

    addObjects(ids, byParent.get(id));
    if (entry.groupId !== undefined && !groups.has(entry.groupId)) {
      groups.add(entry.groupId);
      addObjects(ids, byGroup.get(entry.groupId));
    }

    if (entry.kind === 'section') {
      checks += objects.length;
      if (checks > maxContainmentChecks) {
        return { kind: 'rejected', reason: 'tooLarge' };
      }

      includeWithinSection(ids, objects, entry);
    }
  }
}

export function selectExportObjects(
  objects: readonly BoardObject[],
  byId: ReadonlyMap<string, BoardObject>,
  scope: BoardExportScope,
): readonly BoardObject[] | BoardExportRejection {
  if (scope.kind === 'whole') {
    return objects;
  }
  if (scope.objectIds.length === 0) {
    return { kind: 'rejected', reason: 'invalidSelection' };
  }

  const ids = new Set(scope.objectIds);
  const expansionFailure = expandSelection(ids, objects, byId);
  if (expansionFailure) {
    return expansionFailure;
  }

  return objects.filter(({ objectId }) => ids.has(objectId));
}

export function selectExportRectangle(
  objects: readonly BoardObject[],
  byId: ReadonlyMap<string, BoardObject>,
  { x, y, width, height }: BoardExportRectangle,
): readonly BoardObject[] | BoardExportRejection {
  const right = x + width;
  const bottom = y + height;
  const selected = objects.filter((object) => {
    const route = object.detail?.kind === 'connector' && exportConnector(object.detail, byId);
    const points = route ? [...route.points, route.label] : geometryCorners(object.geometry);
    const overlapsWidth =
      points.some((point) => point.x < right) && points.some((point) => point.x > x);
    const overlapsHeight =
      points.some((point) => point.y < bottom) && points.some((point) => point.y > y);

    return overlapsWidth && overlapsHeight;
  });

  return selected.length ? selected : { kind: 'rejected', reason: 'invalidSelection' };
}
