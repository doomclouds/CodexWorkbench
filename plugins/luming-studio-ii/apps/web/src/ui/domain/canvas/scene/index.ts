import type {
  CanvasEditIntent,
  CanvasGeometry,
  CanvasObject,
  CanvasObjectChange,
  CanvasRect,
} from '../contracts.js';
import { getObjectBounds, rectsIntersect } from '../viewport/index.js';

interface SceneEntry {
  readonly object: CanvasObject;
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
  get(id: string): CanvasObject | undefined;
  getEntry(id: string): SceneEntry | undefined;
  queryEntries(bounds: CanvasRect): SceneEntry[];
}

export interface ProjectedCanvasObject {
  readonly object: CanvasObject;
  readonly geometry: CanvasGeometry;
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

export function createSceneIndex(objects: readonly CanvasObject[]): SceneIndex {
  const entries = objects.map((object, layer) => ({
    object,
    layer,
    bounds: getObjectBounds(object.geometry),
  }));
  const byId = new Map(entries.map((entry) => [entry.object.id, entry]));
  const root = entries.length ? buildNode(entries) : undefined;

  return {
    objects,
    get: (id) => byId.get(id)?.object,
    getEntry: (id) => byId.get(id),
    queryEntries(bounds) {
      const matches: SceneEntry[] = [];
      if (root) {
        collectEntries(root, bounds, matches);
      }

      return matches;
    },
  };
}

function canApply(object: CanvasObject | undefined, change: CanvasObjectChange): boolean {
  return object !== undefined && !object.locked && object.version === change.expectedVersion;
}

export function buildPendingEdits(
  index: SceneIndex,
  edits: readonly CanvasEditIntent[],
): ReadonlyMap<string, CanvasObjectChange> {
  const pending = new Map<string, CanvasObjectChange>();

  for (const edit of edits) {
    for (const change of edit.changes) {
      if (canApply(index.get(change.id), change)) {
        pending.set(change.id, change);
      }
    }
  }

  return pending;
}

function geometryFor(object: CanvasObject, change: CanvasObjectChange | undefined): CanvasGeometry {
  return change && canApply(object, change) ? change.geometry : object.geometry;
}

export function projectObject(
  index: SceneIndex,
  changes: ReadonlyMap<string, CanvasObjectChange>,
  id: string,
): ProjectedCanvasObject | undefined {
  const object = index.get(id);
  if (object) {
    return { object, geometry: geometryFor(object, changes.get(id)) };
  }
}

export function queryScene(
  index: SceneIndex,
  bounds: CanvasRect,
  changes: ReadonlyMap<string, CanvasObjectChange>,
): ProjectedCanvasObject[] {
  const matches = index.queryEntries(bounds).filter(({ object }) => !changes.has(object.id));

  for (const [id, change] of changes) {
    const entry = index.getEntry(id);
    if (!entry) {
      continue;
    }

    const geometry = geometryFor(entry.object, change);
    const projectedBounds =
      geometry === entry.object.geometry ? entry.bounds : getObjectBounds(geometry);

    if (rectsIntersect(projectedBounds, bounds)) {
      matches.push(entry);
    }
  }

  return matches
    .sort((left, right) => left.layer - right.layer)
    .map(({ object }) => ({ object, geometry: geometryFor(object, changes.get(object.id)) }));
}
