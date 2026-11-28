import type { ResolvedConnection } from '../connectors/geometry.js';
import { resolveConnection } from '../connectors/geometry.js';
import type {
  CanvasEditIntent,
  CanvasGeometry,
  CanvasObject,
  CanvasObjectChange,
  CanvasObjectExtension,
  CanvasObjectKind,
  CanvasObjectRegistry,
  CanvasRect,
} from '../contracts.js';
import { inkBounds } from '../ink/geometry.js';
import { getObjectBounds, rectContainsRect, rectsIntersect } from '../viewport/index.js';

interface SceneEntry {
  readonly projected: ProjectedCanvasObject;
  readonly bounds: CanvasRect;
  readonly layer: number;
}

interface SceneLeaf {
  readonly bounds: CanvasRect;
  readonly entries: readonly SceneEntry[];
}

interface SceneBranch {
  readonly bounds: CanvasRect;
  readonly left: SceneNode;
  readonly right: SceneNode;
}

type SceneNode = SceneLeaf | SceneBranch;

export interface SceneIndex {
  readonly objects: readonly CanvasObject[];
  readonly objectIds: readonly string[];
  readonly projectedObjects: readonly ProjectedCanvasObject[];
  fullyWithin(bounds: CanvasRect): boolean;
  get(id: string): CanvasObject | undefined;
  getEntry(id: string): SceneEntry | undefined;
  queryEntries(bounds: CanvasRect): SceneEntry[];
  groupMembers(id: string): readonly string[];
  childrenOf(id: string): readonly string[];
  connectorsTo(id: string): readonly string[];
}

export interface ProjectedCanvasObject {
  readonly object: CanvasObject;
  readonly geometry: CanvasGeometry;
  readonly connectorRoute?: ResolvedConnection;
  readonly geometryExtension?: ObjectGeometryExtension;
  readonly extensionBounds?: CanvasRect;
}

type ObjectGeometryExtension = Pick<CanvasObjectExtension, 'bounds' | 'hitTest'>;

interface SceneRelationships {
  readonly groups: Map<string, string[]>;
  readonly children: Map<string, string[]>;
  readonly connectors: Map<string, string[]>;
}

const leafCapacity = 16;

function boundsOf(entries: readonly SceneEntry[]): CanvasRect {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const { bounds } of entries) {
    left = Math.min(left, bounds.x);
    top = Math.min(top, bounds.y);
    right = Math.max(right, bounds.x + bounds.width);
    bottom = Math.max(bottom, bounds.y + bounds.height);
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
}

function buildNode(entries: SceneEntry[]): SceneNode {
  const bounds = boundsOf(entries);
  if (entries.length <= leafCapacity) {
    return { bounds, entries };
  }

  const center =
    bounds.width >= bounds.height
      ? (rect: CanvasRect) => rect.x + rect.width / 2
      : (rect: CanvasRect) => rect.y + rect.height / 2;
  entries.sort((left, right) => center(left.bounds) - center(right.bounds));

  const middle = Math.floor(entries.length / 2);

  return {
    bounds,
    left: buildNode(entries.slice(0, middle)),
    right: buildNode(entries.slice(middle)),
  };
}

function collectEntries(node: SceneNode, bounds: CanvasRect, entries: SceneEntry[]) {
  if (!rectsIntersect(node.bounds, bounds)) {
    return;
  }

  if ('entries' in node) {
    for (const entry of node.entries) {
      if (rectsIntersect(entry.bounds, bounds)) {
        entries.push(entry);
      }
    }

    return;
  }

  collectEntries(node.left, bounds, entries);
  collectEntries(node.right, bounds, entries);
}

function addRelation(index: Map<string, string[]>, id: string | undefined, objectId: string) {
  if (id === undefined) {
    return;
  }

  const related = index.get(id);
  if (related) {
    related.push(objectId);
    return;
  }

  index.set(id, [objectId]);
}

function indexRelationships(relationships: SceneRelationships, id: string, object: CanvasObject) {
  addRelation(relationships.groups, object.groupId, id);
  addRelation(relationships.children, object.parentId, id);
  if (object.kind !== 'connector') {
    return;
  }

  const start = object.connection.start.attachment?.objectId;
  const end = object.connection.end.attachment?.objectId;
  addRelation(relationships.connectors, start, id);
  if (end !== start) {
    addRelation(relationships.connectors, end, id);
  }
}

function project(
  object: CanvasObject,
  geometryForId: (id: string) => CanvasGeometry | undefined,
  change?: CanvasObjectChange,
  extension?: ObjectGeometryExtension,
): ProjectedCanvasObject {
  if (object.kind === 'connector') {
    const connection = change?.connection ?? object.connection;
    const connectorRoute = resolveConnection(connection, geometryForId, object.strokeWidth);

    return withGeometryExtension(
      {
        object: connection === object.connection ? object : { ...object, connection },
        geometry: connectorRoute.geometry,
        connectorRoute,
      },
      extension,
    );
  }

  const ink = change?.ink;

  return withGeometryExtension(
    {
      object: object.kind === 'ink' && ink && ink !== object.ink ? { ...object, ink } : object,
      geometry: change?.geometry ?? object.geometry,
    },
    extension,
  );
}

function isFiniteBounds({ x, y, width, height }: CanvasRect) {
  return (
    [x, y, width, height, x + width, y + height].every(Number.isFinite) &&
    Math.min(width, height) >= 0
  );
}

function withGeometryExtension(
  projected: ProjectedCanvasObject,
  extension?: ObjectGeometryExtension,
): ProjectedCanvasObject {
  if (!extension || (!extension.bounds && !extension.hitTest)) {
    return projected;
  }

  const bounds = extension.bounds?.({ object: projected.object, geometry: projected.geometry });
  const extensionBounds = bounds && isFiniteBounds(bounds) ? bounds : undefined;

  return { ...projected, geometryExtension: extension, extensionBounds };
}

export function projectedObjectBounds({
  object,
  geometry,
  extensionBounds,
}: ProjectedCanvasObject): CanvasRect {
  if (extensionBounds) {
    return extensionBounds;
  }

  return object.kind === 'ink' ? inkBounds(object.ink, geometry) : getObjectBounds(geometry);
}

export function createSceneIndex(
  source: readonly CanvasObject[],
  registry?: CanvasObjectRegistry,
): SceneIndex {
  const objects: CanvasObject[] = [];
  const layersById = new Map<string, number>();
  const relationships: SceneRelationships = {
    groups: new Map(),
    children: new Map(),
    connectors: new Map(),
  };
  const extensions = new Map<CanvasObjectKind, ObjectGeometryExtension | undefined>();

  for (const object of source) {
    const id = object.id;
    if (layersById.has(id)) {
      continue;
    }

    layersById.set(id, objects.length);
    objects.push(object);
    indexRelationships(relationships, id, object);
  }

  function getObject(id: string) {
    const layer = layersById.get(id);

    return layer === undefined ? undefined : objects[layer];
  }

  function anchorGeometry(id: string) {
    const object = getObject(id);

    return object?.kind === 'connector' ? undefined : object?.geometry;
  }

  function geometryExtension(kind: CanvasObjectKind) {
    if (!registry) {
      return undefined;
    }

    if (!extensions.has(kind)) {
      extensions.set(kind, registry.get(kind));
    }

    return extensions.get(kind);
  }

  const entries = objects.map((object, layer) => {
    const projected = project(object, anchorGeometry, undefined, geometryExtension(object.kind));

    return { projected, layer, bounds: projectedObjectBounds(projected) };
  });
  const root = entries.length ? buildNode(entries.slice()) : undefined;
  const validBounds = entries.every(({ bounds }) => rectsIntersect(bounds, bounds));

  return {
    objects,
    objectIds: [...layersById.keys()],
    projectedObjects: entries.map(({ projected }) => projected),
    fullyWithin: (bounds) => !root || (validBounds && rectContainsRect(bounds, root.bounds)),
    get: getObject,
    getEntry(id) {
      const layer = layersById.get(id);

      return layer === undefined ? undefined : entries[layer];
    },
    queryEntries(bounds) {
      const matches: SceneEntry[] = [];
      if (root) {
        collectEntries(root, bounds, matches);
      }

      return matches;
    },
    groupMembers: (id) => relationships.groups.get(id) ?? [],
    childrenOf: (id) => relationships.children.get(id) ?? [],
    connectorsTo: (id) => relationships.connectors.get(id) ?? [],
  };
}

export function isObjectLocked(index: SceneIndex, id: string): boolean {
  const visited = new Set<string>();
  let current = index.get(id);
  while (current && !visited.has(current.id)) {
    if (current.locked) {
      return true;
    }

    visited.add(current.id);
    current = current.parentId === undefined ? undefined : index.get(current.parentId);
  }

  return false;
}

function applicableChange(index: SceneIndex, id: string, change?: CanvasObjectChange) {
  if (!change || index.get(id)?.version !== change.expectedVersion || isObjectLocked(index, id)) {
    return undefined;
  }

  return change;
}

export function buildPendingEdits(
  index: SceneIndex,
  edits: readonly CanvasEditIntent[],
): ReadonlyMap<string, CanvasObjectChange> {
  const pending = new Map<string, CanvasObjectChange>();

  for (const edit of edits) {
    if (!('changes' in edit)) {
      continue;
    }

    for (const change of edit.changes) {
      if (applicableChange(index, change.id, change)) {
        pending.set(change.id, change);
      }
    }
  }

  return pending;
}

function anchorChanged(object: CanvasObject, changes: ReadonlyMap<string, CanvasObjectChange>) {
  if (object.kind !== 'connector') {
    return false;
  }

  const start = object.connection.start.attachment?.objectId;
  const end = object.connection.end.attachment?.objectId;

  return (start !== undefined && changes.has(start)) || (end !== undefined && changes.has(end));
}

export function projectObject(
  index: SceneIndex,
  changes: ReadonlyMap<string, CanvasObjectChange>,
  id: string,
): ProjectedCanvasObject | undefined {
  const entry = index.getEntry(id);
  if (!entry) {
    return undefined;
  }

  const { object, geometryExtension } = entry.projected;
  const change = applicableChange(index, id, changes.get(id));
  if (!change && !anchorChanged(object, changes)) {
    return entry.projected;
  }

  return project(object, anchorGeometry, change, geometryExtension);

  function anchorGeometry(anchorId: string) {
    const anchor = index.get(anchorId);
    if (!anchor || anchor.kind === 'connector') {
      return undefined;
    }

    return applicableChange(index, anchorId, changes.get(anchorId))?.geometry ?? anchor.geometry;
  }
}

function affectedEntries(index: SceneIndex, changes: ReadonlyMap<string, CanvasObjectChange>) {
  const affected = new Set(changes.keys());
  for (const id of changes.keys()) {
    for (const connector of index.connectorsTo(id)) {
      affected.add(connector);
    }
  }

  return affected;
}

export function queryScene(
  index: SceneIndex,
  bounds: CanvasRect,
  changes: ReadonlyMap<string, CanvasObjectChange>,
): readonly ProjectedCanvasObject[] {
  if (changes.size === 0 && index.fullyWithin(bounds)) {
    return index.projectedObjects;
  }

  const affected = affectedEntries(index, changes);
  const matches = index
    .queryEntries(bounds)
    .filter(({ projected }) => !affected.has(projected.object.id));

  for (const id of affected) {
    const entry = index.getEntry(id);
    const projected = projectObject(index, changes, id);
    if (!entry || !projected) {
      continue;
    }

    const currentBounds =
      projected === entry.projected ? entry.bounds : projectedObjectBounds(projected);

    if (rectsIntersect(currentBounds, bounds)) {
      matches.push({ projected, layer: entry.layer, bounds: currentBounds });
    }
  }

  return matches.sort((left, right) => left.layer - right.layer).map(({ projected }) => projected);
}
