import {
  adjacentShapeConnector,
  advanceGeometry,
  boardWritePayloadLimit,
  canAdvanceVersion,
  connectorAttachmentIds,
  geometryInWorld,
  hasValidConnectorGeometry,
  initialGeometryPayload,
  supportsGeometryCreation,
  translateObject,
  validateCreatedObject,
  validNewObjectId,
  type BoardChanges,
  type BoardEditConflict,
  type BoardEditDecision,
  type BoardEditRejected,
  type BoardEditRejection,
  type BoardHeader,
  type BoardObject,
  type ConnectorEndpoint,
  type GeometryLayerDirection,
  type GeometryOperation,
  type MoveDelta,
  type MoveTarget,
  type PayloadRecord,
} from '../domain/index.js';
import type { BoardEditPlanningReader } from '../ports/index.js';
import { applyBoardStyle } from './edit-geometry-style.js';
import {
  arrangeGeometry,
  createSelectionSection,
  updateObjectGroups,
  type GeometryToolsScope,
} from './edit-geometry-tools.js';

type Create = Extract<GeometryOperation, { kind: 'create' }>;
type Transform = Extract<GeometryOperation, { kind: 'transform' }>;
type Lock = Extract<GeometryOperation, { kind: 'lock' }>;
type Reorder = Extract<GeometryOperation, { kind: 'reorder' }>;
type Duplicate = Extract<GeometryOperation, { kind: 'duplicate' }>;
type SelectionEdit = Extract<
  GeometryOperation,
  { kind: 'group' | 'ungroup' | 'createSection' | 'arrange' | 'style' }
>;

interface GeometryScope {
  readonly board: BoardHeader;
  readonly writer: BoardEditPlanningReader;
  readonly object: (objectId: string) => BoardObject | undefined;
  readonly objects: (objectIds: readonly string[]) => readonly BoardObject[];
}

interface GeometryTargets {
  readonly kind: 'targets';
  readonly objects: readonly BoardObject[];
}

type TargetResult = GeometryTargets | BoardEditConflict | BoardEditRejected;

const targetLimit = 512;
const derivedLimit = 2048;

function reject(reason: BoardEditRejection): BoardEditRejected {
  return { kind: 'rejected', reason };
}

function createGeometryScope(writer: BoardEditPlanningReader, board: BoardHeader): GeometryScope {
  const cache = new Map<string, BoardObject | undefined>();

  function objects(objectIds: readonly string[]): readonly BoardObject[] {
    const found = writer.getObjects(board.boardId, objectIds);
    for (const item of found) {
      cache.set(item.objectId, item);
    }

    return found;
  }

  function object(objectId: string): BoardObject | undefined {
    if (!cache.has(objectId)) {
      cache.set(objectId, objects([objectId])[0]);
    }

    return cache.get(objectId);
  }

  return { board, writer, object, objects };
}

function isLocked(scope: GeometryScope, object: BoardObject | undefined): boolean {
  const visited = new Set<string>();
  let current = object;
  while (current) {
    if (current.locked || visited.has(current.objectId)) {
      return true;
    }

    visited.add(current.objectId);
    current = current.parentId === undefined ? undefined : scope.object(current.parentId);
  }

  return false;
}

function lockedParent(scope: GeometryScope, object: BoardObject): boolean {
  return object.parentId !== undefined && isLocked(scope, scope.object(object.parentId));
}

function conflict(scope: GeometryScope, objects: readonly BoardObject[]): BoardEditConflict {
  return { kind: 'conflict', boardRevision: scope.board.revision, objects };
}

function readTargets(scope: GeometryScope, targets: readonly MoveTarget[]): TargetResult {
  if (targets.length === 0 || targets.length > targetLimit) {
    return reject(targets.length > targetLimit ? 'tooLarge' : 'invalidEdit');
  }

  const ids = new Set(targets.map(({ objectId }) => objectId));
  if (
    ids.size !== targets.length ||
    targets.some(
      ({ objectId, expectedGeometryVersion }) => !objectId.trim() || expectedGeometryVersion < 0n,
    )
  ) {
    return reject('invalidEdit');
  }

  const objects = scope.objects([...ids]);
  if (objects.length !== ids.size) {
    return conflict(scope, objects);
  }

  const versions = new Map(
    targets.map((target) => [target.objectId, target.expectedGeometryVersion]),
  );

  if (objects.some((object) => object.geometryVersion !== versions.get(object.objectId))) {
    return conflict(scope, objects);
  }

  return { kind: 'targets', objects };
}

function checkAttachments(
  scope: GeometryScope,
  object: BoardObject,
  newIds?: ReadonlySet<string>,
): BoardEditRejected | undefined {
  const { detail, objectId } = object;
  if (detail?.kind !== 'connector') {
    return undefined;
  }

  const ids = connectorAttachmentIds(detail);
  if (ids.includes(objectId)) {
    return reject('invalidEdit');
  }

  const existing = ids.filter((id) => !newIds?.has(id));
  if (existing.some((id) => scope.object(id) === undefined)) {
    return reject('objectNotFound');
  }
}

function linkedCreation(
  scope: GeometryScope,
  target: BoardObject,
  targetPayload: PayloadRecord,
  attachment: NonNullable<Create['attachment']>,
): BoardEditDecision {
  const { connectorId } = attachment;
  if (
    connectorId === target.objectId ||
    !validNewObjectId(connectorId) ||
    scope.writer.hasUsedObjectId(scope.board.boardId, connectorId)
  ) {
    return reject('invalidEdit');
  }

  const sources = readTargets(scope, [attachment.source]);
  if (sources.kind !== 'targets') {
    return sources;
  }

  const [source] = sources.objects;
  if (!source) {
    return reject('objectNotFound');
  }
  if (isLocked(scope, source)) {
    return reject('geometryLocked');
  }

  const connector = adjacentShapeConnector(source, target, attachment);
  if (!connector || !validateCreatedObject(connector)) {
    return reject('invalidEdit');
  }

  const connectorPayload = initialGeometryPayload(connector, undefined);
  if (!connectorPayload) {
    return reject('invalidEdit');
  }

  const appearance = {
    ...target.appearance,
    fill: target.appearance?.fill ?? source.appearance?.fill,
    stroke: target.appearance?.stroke ?? source.appearance?.stroke,
  };

  return {
    kind: 'changes',
    objects: [
      { ...target, appearance, payloadVersion: targetPayload.payloadVersion },
      { ...connector, payloadVersion: connectorPayload.payloadVersion },
    ],
    payloads: [targetPayload, connectorPayload],
  };
}

function createObject(
  scope: GeometryScope,
  { object, payload, attachment }: Create,
): BoardEditDecision {
  if (!supportsGeometryCreation(object.kind)) {
    return reject('unsupportedKind');
  }
  if (
    !validateCreatedObject(object) ||
    scope.writer.hasUsedObjectId(scope.board.boardId, object.objectId)
  ) {
    return reject('invalidEdit');
  }

  const parent = object.parentId === undefined ? undefined : scope.object(object.parentId);
  if (object.parentId !== undefined && parent?.kind !== 'section') {
    return reject('objectNotFound');
  }
  if (isLocked(scope, parent)) {
    return reject('geometryLocked');
  }

  const invalidAttachment = checkAttachments(scope, object);
  if (invalidAttachment) {
    return invalidAttachment;
  }

  const body = initialGeometryPayload(object, payload);
  if (!body) {
    return reject('invalidEdit');
  }
  if (attachment) {
    return linkedCreation(scope, object, body, attachment);
  }

  return {
    kind: 'changes',
    objects: [{ ...object, payloadVersion: body.payloadVersion }],
    payloads: [body],
  };
}

function changeTransforms(
  scope: GeometryScope,
  operation: Transform,
  objects: readonly BoardObject[],
): BoardEditDecision {
  const { transform } = operation;
  if (objects.some((object) => isLocked(scope, object))) {
    return reject('geometryLocked');
  }

  const existing = new Map(objects.map((object) => [object.objectId, object]));
  const changed: BoardObject[] = [];
  for (const change of operation.objects) {
    const object = existing.get(change.target.objectId);
    if (!object) {
      return reject('objectNotFound');
    }
    if (!canAdvanceVersion(object.geometryVersion)) {
      return reject('versionUnavailable');
    }

    const next = advanceGeometry(object, change, transform);
    if (!next) {
      return reject('invalidEdit');
    }

    const invalidAttachment = checkAttachments(scope, next);
    if (invalidAttachment) {
      return invalidAttachment;
    }

    changed.push(next);
  }

  return { kind: 'changes', objects: changed };
}

function transformObjects(scope: GeometryScope, operation: Transform): BoardEditDecision {
  const targets = readTargets(
    scope,
    operation.objects.map(({ target }) => target),
  );

  if (targets.kind !== 'targets') {
    return targets;
  }

  const { writer, board } = scope;
  const ids = targets.objects.map(({ objectId }) => objectId);
  const related =
    operation.transform === 'connect' ? [] : writer.listRelatedConnectors(board.boardId, ids);

  if (related.some((object) => isLocked(scope, object))) {
    return reject('geometryLocked');
  }

  return changeTransforms(scope, operation, targets.objects);
}

function changeLock(scope: GeometryScope, operation: Lock): BoardEditDecision {
  const targets = readTargets(scope, operation.targets);
  if (targets.kind !== 'targets') {
    return targets;
  }

  const objects = targets.objects.filter(({ locked }) => locked !== operation.locked);
  if (objects.length === 0) {
    return reject('invalidEdit');
  }
  if (objects.some((object) => lockedParent(scope, object))) {
    return reject('geometryLocked');
  }
  if (objects.some(({ geometryVersion }) => !canAdvanceVersion(geometryVersion))) {
    return reject('versionUnavailable');
  }

  return {
    kind: 'changes',
    objects: objects.map((object) => ({
      ...object,
      locked: operation.locked,
      geometryVersion: object.geometryVersion + 1n,
    })),
  };
}

function objectsRemovedByDeletion(
  scope: GeometryScope,
  targets: readonly BoardObject[],
): ReadonlyMap<string, BoardObject> | undefined {
  const { writer, board } = scope;
  const removed = new Map(targets.map((object) => [object.objectId, object]));
  let batch = [...removed.keys()];
  while (batch.length > 0) {
    const related = writer.listRelatedConnectors(board.boardId, batch);
    batch = [];
    for (const connector of related) {
      if (!removed.has(connector.objectId)) {
        removed.set(connector.objectId, connector);
        batch.push(connector.objectId);
      }
    }
    if (removed.size > derivedLimit) {
      return undefined;
    }
  }

  return removed;
}

function detachedChildren(
  scope: GeometryScope,
  removed: ReadonlyMap<string, BoardObject>,
): readonly BoardObject[] {
  const children: BoardObject[] = [];
  for (const { objectId } of removed.values()) {
    for (const child of scope.writer.listChildObjects(scope.board.boardId, objectId)) {
      if (!removed.has(child.objectId)) {
        children.push(child);
      }
    }
  }

  return children;
}

function deleteObjects(scope: GeometryScope, operation: readonly MoveTarget[]): BoardEditDecision {
  const targets = readTargets(scope, operation);
  if (targets.kind !== 'targets') {
    return targets;
  }

  const removed = objectsRemovedByDeletion(scope, targets.objects);
  if (!removed) {
    return reject('tooLarge');
  }

  const children = detachedChildren(scope, removed);
  if (children.length + removed.size > derivedLimit) {
    return reject('tooLarge');
  }
  if ([...removed.values(), ...children].some((object) => isLocked(scope, object))) {
    return reject('geometryLocked');
  }
  if (children.some(({ geometryVersion }) => !canAdvanceVersion(geometryVersion))) {
    return reject('versionUnavailable');
  }

  return {
    kind: 'changes',
    removedObjectIds: [...removed.keys()],
    objects: children.map((child) => ({
      ...child,
      parentId: undefined,
      geometryVersion: child.geometryVersion + 1n,
    })),
  };
}

function stepOrder(ids: readonly string[], selected: ReadonlySet<string>, forward: boolean) {
  const changed = [...ids];
  const start = forward ? changed.length - 2 : 1;
  const end = forward ? -1 : changed.length;
  const step = forward ? -1 : 1;
  for (let index = start; index !== end && index >= 0; index += step) {
    const neighbor = index - step;
    const currentId = changed[index];
    const neighborId = changed[neighbor];
    const hasNeighbors = currentId !== undefined && neighborId !== undefined;
    if (hasNeighbors && selected.has(currentId) && !selected.has(neighborId)) {
      changed[index] = neighborId;
      changed[neighbor] = currentId;
    }
  }

  return changed;
}

interface LayerPlan {
  readonly order: readonly string[];
  readonly layerPlacement?: BoardChanges['layerPlacement'];
}

function reorder(
  ids: readonly string[],
  selected: ReadonlySet<string>,
  direction: GeometryLayerDirection,
): LayerPlan {
  if (direction === 'forward' || direction === 'backward') {
    return { order: stepOrder(ids, selected, direction === 'forward') };
  }

  const moving = ids.filter((id) => selected.has(id));
  const remaining = ids.filter((id) => !selected.has(id));

  return {
    order: direction === 'front' ? [...remaining, ...moving] : [...moving, ...remaining],
    layerPlacement: { position: direction, objectIds: moving },
  };
}

function reorderObjects(scope: GeometryScope, operation: Reorder): BoardEditDecision {
  const targets = readTargets(scope, operation.targets);
  if (targets.kind !== 'targets') {
    return targets;
  }
  if (scope.board.revision !== operation.expectedBoardRevision) {
    return conflict(scope, targets.objects);
  }
  if (targets.objects.some((object) => isLocked(scope, object))) {
    return reject('geometryLocked');
  }

  const order = scope.writer.listObjects(scope.board.boardId).map(({ objectId }) => objectId);
  const selected = new Set(targets.objects.map(({ objectId }) => objectId));
  const next = reorder(order, selected, operation.direction);

  return next.order.some((id, index) => order[index] !== id)
    ? { kind: 'changes', ...next }
    : reject('invalidEdit');
}

interface Duplication {
  readonly ids: ReadonlyMap<string, string>;
  readonly groups: ReadonlyMap<string, string>;
  readonly delta: MoveDelta;
}

function copiedEndpoint(
  endpoint: ConnectorEndpoint,
  { ids, delta }: Duplication,
): ConnectorEndpoint {
  if (!endpoint.attachment) {
    return endpoint;
  }

  const objectId = ids.get(endpoint.attachment.objectId);
  if (!objectId) {
    return endpoint;
  }

  return {
    point: { x: endpoint.point.x + delta.dx, y: endpoint.point.y + delta.dy },
    attachment: { ...endpoint.attachment, objectId },
  };
}

function duplicateObject(
  source: BoardObject,
  objectId: string,
  duplicate: Duplication,
): BoardObject | undefined {
  const moved = translateObject({ ...source, geometryVersion: 0n }, duplicate.delta);
  if (!moved || !geometryInWorld(moved.geometry)) {
    return undefined;
  }

  const { detail } = moved;
  const copy = {
    ...moved,
    objectId,
    geometryVersion: 0n,
    payloadVersion: source.payloadVersion === undefined ? undefined : 0n,
    parentId: source.parentId === undefined ? undefined : duplicate.ids.get(source.parentId),
    groupId: source.groupId === undefined ? undefined : duplicate.groups.get(source.groupId),
  };

  if (detail?.kind !== 'connector') {
    return copy;
  }

  const start = copiedEndpoint(detail.start, duplicate);
  const end = copiedEndpoint(detail.end, duplicate);
  const nextDetail = { ...detail, start, end };

  return hasValidConnectorGeometry(nextDetail) ? { ...copy, detail: nextDetail } : undefined;
}

function duplicateGroups(
  scope: GeometryScope,
  sources: readonly BoardObject[],
  ids: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> | undefined {
  const groups = new Map<string, string>();
  for (const { objectId, groupId } of sources) {
    const replacement = ids.get(objectId);
    if (groupId === undefined || !replacement || groups.has(groupId)) {
      continue;
    }

    const newGroupId = 'group:' + replacement;
    if (scope.writer.listGroupObjects(scope.board.boardId, newGroupId).length > 0) {
      return undefined;
    }

    groups.set(groupId, newGroupId);
  }

  return groups;
}

function duplicatePayloads(
  scope: GeometryScope,
  sources: readonly BoardObject[],
  ids: ReadonlyMap<string, string>,
): readonly PayloadRecord[] | undefined {
  const bodies = scope.writer.getPayloads(
    scope.board.boardId,
    sources.map(({ objectId }) => objectId),
  );
  const byId = new Map(bodies.map((body) => [body.objectId, body]));
  const copied: PayloadRecord[] = [];
  for (const source of sources) {
    const body = byId.get(source.objectId);
    const objectId = ids.get(source.objectId);
    if (!body || !objectId || body.payloadVersion !== source.payloadVersion) {
      return undefined;
    }

    copied.push({ ...body, objectId, payloadVersion: 0n });
  }

  return copied;
}

function duplicateChanges(
  scope: GeometryScope,
  sources: readonly BoardObject[],
  duplicate: Duplication,
): BoardChanges | BoardEditRejected {
  const newIds = new Set(duplicate.ids.values());
  const objects: BoardObject[] = [];
  for (const source of sources) {
    const objectId = duplicate.ids.get(source.objectId);
    const next = objectId && duplicateObject(source, objectId, duplicate);
    if (!next) {
      return reject('invalidEdit');
    }

    const invalidAttachment = checkAttachments(scope, next, newIds);
    if (invalidAttachment) {
      return invalidAttachment;
    }

    objects.push(next);
  }

  const sourcesWithPayload = sources.filter(({ payloadVersion }) => payloadVersion !== undefined);
  const payloadBytes = scope.writer.payloadByteSize?.(
    scope.board.boardId,
    sourcesWithPayload.map(({ objectId }) => objectId),
  );

  if (payloadBytes !== undefined && payloadBytes > boardWritePayloadLimit) {
    return reject('tooLarge');
  }

  const payloads = duplicatePayloads(scope, sourcesWithPayload, duplicate.ids);

  return payloads ? { kind: 'changes', objects, payloads } : reject('objectNotFound');
}

function duplicateObjects(scope: GeometryScope, operation: Duplicate): BoardEditDecision {
  const targets = readTargets(
    scope,
    operation.targets.map(({ source }) => source),
  );

  if (targets.kind !== 'targets') {
    return targets;
  }

  const ids = new Map(
    operation.targets.map(({ source, newObjectId }) => [source.objectId, newObjectId]),
  );
  const newIds = new Set(ids.values());
  if (
    newIds.size !== ids.size ||
    [...newIds].some(
      (id) => !validNewObjectId(id) || scope.writer.hasUsedObjectId(scope.board.boardId, id),
    )
  ) {
    return reject('invalidEdit');
  }

  const groups = duplicateGroups(scope, targets.objects, ids);
  if (!groups) {
    return reject('invalidEdit');
  }

  return duplicateChanges(scope, targets.objects, { ids, groups, delta: operation.delta });
}

function planSelectionEdit(scope: GeometryScope, operation: SelectionEdit): BoardEditDecision {
  const requested =
    operation.kind === 'style' ? operation.targets.map(({ target }) => target) : operation.targets;
  const targets = readTargets(scope, requested);
  if (targets.kind !== 'targets') {
    return targets;
  }

  const tools: GeometryToolsScope = {
    board: scope.board,
    writer: scope.writer,
    object: scope.object,
    locked: (object) => isLocked(scope, object),
  };

  switch (operation.kind) {
    case 'group':
    case 'ungroup':
      return updateObjectGroups(tools, targets.objects, operation);
    case 'createSection':
      return createSelectionSection(tools, targets.objects, operation);
    case 'arrange':
      return arrangeGeometry(tools, targets.objects, operation);
    case 'style':
      return applyBoardStyle(tools, targets.objects, operation);
  }
}

export function planGeometryEdit(
  writer: BoardEditPlanningReader,
  board: BoardHeader,
  operation: GeometryOperation,
): BoardEditDecision {
  const scope = createGeometryScope(writer, board);

  switch (operation.kind) {
    case 'create':
      return createObject(scope, operation);
    case 'transform':
      return transformObjects(scope, operation);
    case 'lock':
      return changeLock(scope, operation);
    case 'delete':
      return deleteObjects(scope, operation.targets);
    case 'reorder':
      return reorderObjects(scope, operation);
    case 'duplicate':
      return duplicateObjects(scope, operation);
    case 'group':
    case 'ungroup':
    case 'createSection':
    case 'arrange':
    case 'style':
      return planSelectionEdit(scope, operation);
    case 'paste':
      return reject('unsupportedKind');
  }
}
