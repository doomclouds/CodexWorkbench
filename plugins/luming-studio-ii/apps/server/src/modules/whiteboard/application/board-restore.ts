import {
  canAdvanceVersion,
  type BoardChanges,
  type BoardEditDecision,
  type BoardEditRejected,
  type BoardHeader,
  type BoardObject,
  type ExportBoardCommand,
  type PayloadRecord,
} from '../domain/index.js';
import type { BoardEditReader } from '../ports/index.js';

type ObjectsById = ReadonlyMap<string, BoardObject>;
type PayloadsById = ReadonlyMap<string, PayloadRecord>;

interface RestoreScope {
  readonly objects: readonly BoardObject[];
  readonly targets: ReadonlySet<string>;
}

interface RestoreDelta {
  readonly objects: BoardObject[];
  readonly payloads: PayloadRecord[];
  readonly removedPayloadObjectIds: string[];
}

interface RestorePayloads {
  readonly currentPayloads: PayloadsById;
  readonly savedPayloads: PayloadsById;
}

interface RestoreContext extends RestorePayloads {
  readonly revision: bigint;
  readonly currentObjects: ObjectsById;
  readonly protectedObjects: ReadonlySet<string>;
}

interface RestoredPayload {
  readonly changed: boolean;
  readonly version?: bigint;
  readonly row?: PayloadRecord;
}

const maxRestoreObjects = 20000;
const maxRestoreSelection = 500;
const maxRestorePayloadBytes = 32n * 1024n * 1024n;

function byObjectId<T extends { readonly objectId: string }>(objects: readonly T[]) {
  return new Map(objects.map((object) => [object.objectId, object]));
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameGeometry(left: BoardObject, right: BoardObject): boolean {
  return (
    left.kind === right.kind &&
    left.parentId === right.parentId &&
    left.groupId === right.groupId &&
    same(left.geometry, right.geometry) &&
    same(left.detail, right.detail)
  );
}

function selectedRestore(
  current: ObjectsById,
  historical: readonly BoardObject[],
  targets: ReadonlySet<string>,
): readonly BoardObject[] {
  const head: BoardObject[] = [];
  const insertions = new Map<string, BoardObject[]>();
  const selected: BoardObject[] = [];
  let anchor: string | undefined;

  for (const saved of historical) {
    const { objectId } = saved;
    if (current.has(objectId)) {
      anchor = objectId;
      if (targets.has(objectId)) {
        selected.push(saved);
      }
    } else if (targets.has(objectId)) {
      appendRestoredObject(saved, anchor, head, insertions);
    }
  }

  const inOrder = selected.values();
  const next = [...head];
  for (const object of current.values()) {
    const replacement = targets.has(object.objectId) ? inOrder.next().value : object;
    if (replacement) {
      next.push(replacement, ...(insertions.get(replacement.objectId) ?? []));
    }
  }

  return next;
}

function appendRestoredObject(
  object: BoardObject,
  anchor: string | undefined,
  head: BoardObject[],
  insertions: Map<string, BoardObject[]>,
) {
  if (anchor === undefined) {
    head.push(object);

    return;
  }

  const siblings = insertions.get(anchor) ?? [];
  siblings.push(object);
  insertions.set(anchor, siblings);
}

function planScope(
  current: ObjectsById,
  historical: readonly BoardObject[],
  scope: ExportBoardCommand['scope'],
): RestoreScope | BoardEditRejected {
  if (scope.kind === 'whole') {
    return { objects: historical, targets: new Set(historical.map(({ objectId }) => objectId)) };
  }

  const targets = new Set(scope.objectIds);
  if (targets.size === 0 || targets.size !== scope.objectIds.length || targets.has('')) {
    return { kind: 'rejected', reason: 'invalidEdit' };
  }
  if (targets.size > maxRestoreSelection) {
    return { kind: 'rejected', reason: 'tooLarge' };
  }

  const historicalIds = new Set(historical.map(({ objectId }) => objectId));
  if (scope.objectIds.some((id) => !historicalIds.has(id))) {
    return { kind: 'rejected', reason: 'objectNotFound' };
  }

  return { objects: selectedRestore(current, historical, targets), targets };
}

function attachedIds(object: BoardObject): readonly string[] {
  if (object.detail?.kind !== 'connector') {
    return [];
  }

  return [object.detail.start, object.detail.end].flatMap(({ attachment }) =>
    attachment ? [attachment.objectId] : [],
  );
}

function validParentChain(
  object: BoardObject,
  objects: ObjectsById,
  verified: Set<string>,
): boolean {
  const path = new Set<string>();
  let node = object;
  while (!verified.has(node.objectId)) {
    if (path.has(node.objectId)) {
      return false;
    }

    path.add(node.objectId);
    if (node.parentId === undefined) {
      break;
    }

    const parent = objects.get(node.parentId);
    if (!parent) {
      return false;
    }

    node = parent;
  }

  for (const id of path) {
    verified.add(id);
  }

  return true;
}

function validRelations(objects: ObjectsById): boolean {
  const verified = new Set<string>();
  for (const object of objects.values()) {
    const connected = attachedIds(object).every((id) => id !== object.objectId && objects.has(id));
    if (!connected || !validParentChain(object, objects, verified)) {
      return false;
    }
  }

  return true;
}

function protectedObjectIds(
  objects: ObjectsById,
  isLocked: (object: BoardObject) => boolean = (object) => object.locked,
): ReadonlySet<string> {
  const visited = new Set<string>();
  const protectedObjects = new Set<string>();
  for (const object of objects.values()) {
    const path: string[] = [];
    let current: BoardObject | undefined = object;
    while (current && !visited.has(current.objectId)) {
      visited.add(current.objectId);
      path.push(current.objectId);
      if (isLocked(current)) {
        protectedObjects.add(current.objectId);
        break;
      }

      current = current.parentId === undefined ? undefined : objects.get(current.parentId);
    }
    if (current && protectedObjects.has(current.objectId)) {
      for (const id of path) {
        protectedObjects.add(id);
      }
    }
  }

  return protectedObjects;
}

function changesProtectedGeometry(before: BoardObject, after: BoardObject | undefined): boolean {
  return !after || (before.locked && !after.locked) || !sameGeometry(before, after);
}

function movedLockedAttachment(
  object: BoardObject,
  current: ObjectsById,
  next: ObjectsById,
): boolean {
  return attachedIds(object).some((id) => !same(current.get(id)?.geometry, next.get(id)?.geometry));
}

function changesLockedLayout(
  current: ObjectsById,
  next: ObjectsById,
  protectedObjects: ReadonlySet<string>,
): boolean {
  for (const [id, before] of current) {
    const after = next.get(id);
    if (!protectedObjects.has(id)) {
      continue;
    }
    if (changesProtectedGeometry(before, after) || movedLockedAttachment(before, current, next)) {
      return true;
    }
  }

  return false;
}

function addsToProtectedParent(
  current: ObjectsById,
  next: ObjectsById,
  protectedObjects: ReadonlySet<string>,
): boolean {
  if (protectedObjects.size === 0) {
    return false;
  }

  const newParents = [...next.values()].flatMap(({ objectId, parentId }) =>
    parentId !== undefined && current.get(objectId)?.parentId !== parentId ? [parentId] : [],
  );

  if (newParents.length === 0) {
    return false;
  }

  const protectedInNext = protectedObjectIds(
    next,
    ({ objectId }) => current.get(objectId)?.locked === true,
  );

  return newParents.some((id) => protectedInNext.has(id));
}

export function validateReversedScene(
  current: ObjectsById,
  next: ObjectsById,
  targets: ReadonlySet<string>,
  order: readonly string[] = [...next.keys()],
  payloadTargetIds: readonly string[] = [],
): BoardEditRejected | undefined {
  const protectedObjects = protectedObjectIds(current, (object) => {
    const unlockedByReversal =
      targets.has(object.objectId) && next.get(object.objectId)?.locked === false;

    return object.locked && !unlockedByReversal;
  });
  const protectedPayload = payloadTargetIds.some((id) => {
    const kind = current.get(id)?.kind;

    return protectedObjects.has(id) && (kind === 'ink' || kind === 'image');
  });
  const protectedLayout =
    changesLockedLayout(current, next, protectedObjects) ||
    lockedLayerMoved(current, order, targets, protectedObjects) ||
    addsToProtectedParent(current, next, protectedObjects);

  if (protectedLayout || protectedPayload) {
    return { kind: 'rejected', reason: 'geometryLocked' };
  }
  if (!validRelations(next)) {
    return { kind: 'rejected', reason: 'invalidEdit' };
  }

  return undefined;
}

function lockedLayerMoved(
  current: ObjectsById,
  order: readonly string[],
  targets: ReadonlySet<string>,
  protectedObjects: ReadonlySet<string>,
) {
  const result = new Set(order);
  const surviving = [...current.keys()].filter((id) => result.has(id));
  const before = new Map(surviving.map((id, rank) => [id, rank]));
  let highestSeen = -1;
  let rank = 0;

  for (const id of order) {
    const originalRank = before.get(id);
    if (originalRank === undefined) {
      continue;
    }

    const orderingChanged = originalRank !== rank || highestSeen >= originalRank;
    if (targets.has(id) && protectedObjects.has(id) && orderingChanged) {
      return true;
    }

    highestSeen = Math.max(highestSeen, originalRank);
    rank++;
  }

  return false;
}

function samePayload(left: PayloadRecord | undefined, right: PayloadRecord | undefined): boolean {
  return left?.bodyKind === right?.bodyKind && same(left?.data, right?.data);
}

function changesLockedPayload(
  object: BoardObject,
  current: PayloadRecord | undefined,
  saved: PayloadRecord | undefined,
): boolean {
  if (object.kind === 'ink') {
    return !samePayload(current, saved);
  }

  return object.kind === 'image' && !same(current?.data.crop, saved?.data.crop);
}

function advanceVersion(revision: bigint, ...versions: readonly (bigint | undefined)[]) {
  const latest = versions.reduce<bigint>(
    (maximum, version) => (version !== undefined && version > maximum ? version : maximum),
    revision,
  );

  return canAdvanceVersion(latest) ? latest + 1n : undefined;
}

function planRestoredPayload(
  context: RestoreContext,
  before: BoardObject | undefined,
  source: BoardObject,
): RestoredPayload | BoardEditRejected {
  const { objectId } = source;
  const previousVersion = before?.payloadVersion;
  if (previousVersion === source.payloadVersion) {
    return { changed: false, version: previousVersion };
  }

  const current = context.currentPayloads.get(objectId);
  const saved = context.savedPayloads.get(objectId);
  if (source.payloadVersion !== undefined && !saved) {
    return { kind: 'rejected', reason: 'versionUnavailable' };
  }
  if (samePayload(current, saved)) {
    return { changed: false, version: previousVersion };
  }

  const locked = context.protectedObjects.has(objectId);
  if (before && locked && changesLockedPayload(before, current, saved)) {
    return { kind: 'rejected', reason: 'geometryLocked' };
  }
  if (!saved) {
    return { changed: true };
  }

  const version = advanceVersion(context.revision, previousVersion, saved.payloadVersion);

  return version === undefined
    ? { kind: 'rejected', reason: 'invalidEdit' }
    : { changed: true, version, row: { ...saved, payloadVersion: version } };
}

function restoredObject(
  context: RestoreContext,
  source: BoardObject,
  delta: RestoreDelta,
): BoardEditRejected | undefined {
  const { objectId } = source;
  const before = context.currentObjects.get(objectId);
  const payload = planRestoredPayload(context, before, source);
  if ('kind' in payload) {
    return payload;
  }

  const geometryChanged =
    !before ||
    !sameGeometry(before, source) ||
    !same([before.locked, before.appearance], [source.locked, source.appearance]);
  const geometryVersion = geometryChanged
    ? advanceVersion(context.revision, before?.geometryVersion, source.geometryVersion)
    : before?.geometryVersion;

  if (geometryVersion === undefined) {
    return { kind: 'rejected', reason: 'invalidEdit' };
  }

  if (payload.changed || geometryChanged || before?.label !== source.label) {
    delta.objects.push({ ...source, geometryVersion, payloadVersion: payload.version });
  }
  if (payload.row) {
    delta.payloads.push(payload.row);
  } else if (payload.changed) {
    delta.removedPayloadObjectIds.push(objectId);
  }

  return undefined;
}

function collectRestoredChanges(
  context: RestoreContext,
  scope: RestoreScope,
  removedObjectIds: readonly string[],
  order: readonly string[],
): BoardChanges | BoardEditRejected {
  const delta: RestoreDelta = { objects: [], payloads: [], removedPayloadObjectIds: [] };
  for (const object of scope.objects) {
    const rejection = scope.targets.has(object.objectId)
      ? restoredObject(context, object, delta)
      : undefined;

    if (rejection) {
      return rejection;
    }
  }

  const previous = [...context.currentObjects.keys()];

  return {
    kind: 'changes',
    ...delta,
    removedObjectIds,
    order: same(previous, order) ? undefined : order,
  };
}

function readRestorePayloads(
  reader: BoardEditReader,
  boardId: string,
  revision: bigint,
  changed: readonly string[],
  removed: readonly string[],
): RestorePayloads | BoardEditRejected {
  const live = [...changed, ...removed];
  const liveBytes = live.length === 0 ? 0n : (reader.payloadByteSize?.(boardId, live) ?? 0n);
  if (liveBytes > maxRestorePayloadBytes) {
    return { kind: 'rejected', reason: 'tooLarge' };
  }
  if (changed.length === 0) {
    return { currentPayloads: new Map(), savedPayloads: new Map() };
  }

  const savedBytes = reader.payloadByteSize?.(boardId, changed, revision) ?? 0n;
  if (liveBytes + savedBytes > maxRestorePayloadBytes) {
    return { kind: 'rejected', reason: 'tooLarge' };
  }

  return {
    currentPayloads: byObjectId(reader.getPayloads(boardId, changed)),
    savedPayloads: byObjectId(reader.getVersionPayloads(boardId, revision, changed)),
  };
}

export function planBoardRestore(
  reader: BoardEditReader,
  board: BoardHeader,
  revision: bigint,
  scope: ExportBoardCommand['scope'],
): BoardEditDecision {
  const live = reader.listObjects(board.boardId, maxRestoreObjects + 1);
  const historical = reader.listVersionObjects(board.boardId, revision);
  if (Math.max(live.length, historical.length) > maxRestoreObjects) {
    return { kind: 'rejected', reason: 'tooLarge' };
  }

  const current = byObjectId(live);
  const restore = planScope(current, historical, scope);
  if ('kind' in restore) {
    return restore;
  }

  const next = byObjectId(restore.objects);
  const order = [...next.keys()];
  const protectedObjects = protectedObjectIds(current);
  if (
    changesLockedLayout(current, next, protectedObjects) ||
    lockedLayerMoved(current, order, restore.targets, protectedObjects) ||
    addsToProtectedParent(current, next, protectedObjects)
  ) {
    return { kind: 'rejected', reason: 'geometryLocked' };
  }
  if (!validRelations(next)) {
    return { kind: 'rejected', reason: 'invalidEdit' };
  }

  const payloadIds = [...restore.targets].filter(
    (id) => current.get(id)?.payloadVersion !== next.get(id)?.payloadVersion,
  );
  const removedObjectIds = [...current.keys()].filter((id) => !next.has(id));
  const removedPayloadIds = removedObjectIds.filter(
    (id) => current.get(id)?.payloadVersion !== undefined,
  );
  const payloads = readRestorePayloads(
    reader,
    board.boardId,
    revision,
    payloadIds,
    removedPayloadIds,
  );

  if ('kind' in payloads) {
    return payloads;
  }

  const context = {
    revision: board.revision,
    currentObjects: current,
    protectedObjects,
    ...payloads,
  };

  return collectRestoredChanges(context, restore, removedObjectIds, order);
}
