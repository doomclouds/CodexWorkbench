import {
  boardWritePayloadLimit,
  canTranslate,
  type Actor,
  type BoardChanges,
  type BoardEditDecision,
  type BoardHeader,
  type BoardObject,
  type PayloadRecord,
} from '../domain/index.js';
import type { BoardEditReader, BoardEditWriter } from '../ports/index.js';
import { validateReversedScene } from './board-restore.js';
import { createMoveScope } from './move-scope.js';
import {
  nextObjectClock,
  reverseObjectFields,
  sameObjectContent,
  samePayloadContent,
} from './reverse-board-fields.js';
import { planReverseOrder } from './reverse-board-order.js';

export interface BoardReverseSource {
  readonly kind: 'move' | 'edit';
  readonly commandId: string;
}

interface ConfirmedChange {
  readonly revision: bigint;
  readonly targets: readonly string[];
  readonly ordered: boolean;
  readonly layerTargets?: readonly string[];
  readonly palette?: {
    readonly before: readonly string[];
    readonly after: readonly string[];
  };
}

interface ObjectChange {
  readonly objectId: string;
  readonly before?: BoardObject;
  readonly after?: BoardObject;
  readonly current?: BoardObject;
}

interface PayloadState {
  readonly before?: PayloadRecord;
  readonly after?: PayloadRecord;
  readonly current?: PayloadRecord;
}

type MutableChanges = {
  objects: BoardObject[];
  payloads: PayloadRecord[];
  removedObjectIds: string[];
  removedPayloadObjectIds: string[];
};

const maxTargets = 500;
const maxSceneObjects = 20_000;

function byId<T extends { readonly objectId: string }>(items: readonly T[]) {
  return new Map(items.map((item) => [item.objectId, item]));
}

function confirmedChange(
  reader: BoardEditReader,
  boardId: string,
  actorId: string,
  source: BoardReverseSource,
): ConfirmedChange | undefined {
  if (source.kind === 'move') {
    const result = reader.getReceipt(boardId, actorId, source.commandId)?.receipt.outcome;
    if (result?.kind === 'applied') {
      return {
        revision: result.boardRevision,
        targets: result.objects.map(({ objectId }) => objectId),
        ordered: false,
      };
    }

    return undefined;
  }

  const stored = reader.getEditReceipt(boardId, actorId, source.commandId);
  const result = stored?.receipt.outcome;
  if (!stored?.advancedRevision || result?.kind !== 'applied' || result.detailsExpired) {
    return undefined;
  }

  const { customColors: after, previousCustomColors: before } = result;
  if ((after === undefined) !== (before === undefined)) {
    return undefined;
  }

  return {
    revision: result.boardRevision,
    targets: [
      ...new Set([...result.objects.map(({ objectId }) => objectId), ...result.removedObjectIds]),
    ],
    ordered: result.order !== undefined,
    layerTargets: result.layerChangedObjectIds,
    palette: after && before ? { before, after } : undefined,
  };
}

function needsPayload({ before, after, current }: ObjectChange) {
  return before
    ? before.payloadVersion !== after?.payloadVersion
    : after?.payloadVersion !== current?.payloadVersion;
}

function readPayloadStates(
  reader: BoardEditReader,
  boardId: string,
  revision: bigint,
  ids: readonly string[],
) {
  if (!ids.length) {
    return new Map<string, PayloadState>();
  }

  const prior = revision - 1n;
  const beforeBytes = reader.payloadByteSize?.(boardId, ids, prior) ?? 0n;
  const afterBytes = reader.payloadByteSize?.(boardId, ids, revision) ?? 0n;
  const currentBytes = reader.payloadByteSize?.(boardId, ids) ?? 0n;
  if (beforeBytes + afterBytes + currentBytes > boardWritePayloadLimit) {
    return undefined;
  }

  const before = byId(reader.getVersionPayloads(boardId, prior, ids));
  const after = byId(reader.getVersionPayloads(boardId, revision, ids));
  const current = byId(reader.getPayloads(boardId, ids));

  return new Map(
    ids.map((id) => [
      id,
      { before: before.get(id), after: after.get(id), current: current.get(id) },
    ]),
  );
}

function validPayloadSnapshot(change: ObjectChange, state: PayloadState) {
  const before = change.before?.payloadVersion === state.before?.payloadVersion;
  const after = change.after?.payloadVersion === state.after?.payloadVersion;
  const current = change.current?.payloadVersion === state.current?.payloadVersion;

  return before && after && current;
}

function reversePayload(
  board: BoardHeader,
  change: ObjectChange,
  state: PayloadState | undefined,
  delta: MutableChanges,
): boolean {
  if (!state) {
    return true;
  }
  if (!validPayloadSnapshot(change, state)) {
    return false;
  }
  if (samePayloadContent(state.before, state.after)) {
    return true;
  }
  if (!samePayloadContent(state.current, state.after)) {
    return false;
  }
  if (!change.before) {
    return true;
  }

  if (!state.before) {
    delta.removedPayloadObjectIds.push(change.objectId);

    return true;
  }

  const { payloadVersion } = state.before;
  const clock = nextObjectClock(board.revision, state.current?.payloadVersion, payloadVersion);
  if (clock === undefined) {
    return false;
  }

  delta.payloads.push({ ...state.before, payloadVersion: clock });

  return true;
}

function reverseObject(board: BoardHeader, change: ObjectChange, delta: MutableChanges): boolean {
  const { before, after, current, objectId } = change;
  if (!before && after) {
    if (!current || !sameObjectContent(current, after)) {
      return false;
    }

    delta.removedObjectIds.push(objectId);

    return true;
  }
  if (!before || Boolean(after) !== Boolean(current)) {
    return false;
  }

  const next = after && current ? reverseObjectFields(current, after, before) : before;
  if (!next) {
    return false;
  }
  if (current && sameObjectContent(next, current)) {
    return true;
  }

  const geometryVersion = nextObjectClock(
    board.revision,
    current?.geometryVersion,
    before.geometryVersion,
  );

  if (geometryVersion === undefined) {
    return false;
  }

  delta.objects.push({ ...next, geometryVersion });

  return true;
}

function buildChanges(
  board: BoardHeader,
  targets: readonly ObjectChange[],
  payloads: ReadonlyMap<string, PayloadState>,
): MutableChanges | undefined {
  const changes: MutableChanges = {
    objects: [],
    payloads: [],
    removedObjectIds: [],
    removedPayloadObjectIds: [],
  };

  for (const target of targets) {
    const payload = payloads.get(target.objectId);
    if (
      !reverseObject(board, target, changes) ||
      !reversePayload(board, target, payload, changes)
    ) {
      return undefined;
    }
  }

  return changes;
}

function reverseScene(
  reader: BoardEditReader,
  board: BoardHeader,
  source: ConfirmedChange,
  delta: MutableChanges,
): BoardEditDecision {
  const { boardId, revision } = board;
  const live = reader.listObjects(boardId, maxSceneObjects + 1);
  if (live.length > maxSceneObjects) {
    return { kind: 'rejected', reason: 'tooLarge' };
  }

  const current = byId(live);
  const next = new Map(current);
  for (const id of delta.removedObjectIds) {
    next.delete(id);
  }
  for (const object of delta.objects) {
    next.set(object.objectId, object);
  }

  const targets = new Set([...source.targets, ...(source.layerTargets ?? [])]);
  const needsOrder = source.ordered || delta.objects.some(({ objectId }) => !current.has(objectId));
  const order = needsOrder ? readReverseOrder(reader, boardId, source, current, next) : undefined;
  if (needsOrder && !order) {
    return { kind: 'conflict', boardRevision: revision };
  }

  const payloadIds = [
    ...delta.payloads.map(({ objectId }) => objectId),
    ...delta.removedPayloadObjectIds,
  ];
  const invalid = validateReversedScene(current, next, targets, order, payloadIds);
  if (invalid) {
    return invalid;
  }

  return { kind: 'changes', ...delta, order } satisfies BoardChanges;
}

function translationOnly({ before, after }: ObjectChange) {
  if (!before || !after || before.payloadVersion !== after.payloadVersion) {
    return false;
  }

  const { x, y } = after.geometry;

  return sameObjectContent({ ...before, geometry: { ...before.geometry, x, y } }, after);
}

function reverseTranslation(
  writer: BoardEditWriter,
  board: BoardHeader,
  live: readonly BoardObject[],
  changes: MutableChanges,
): BoardEditDecision {
  const targets = live.map(({ objectId, geometryVersion }) => ({
    objectId,
    expectedGeometryVersion: geometryVersion,
  }));
  const { boardId, revision } = board;
  const scope = createMoveScope(writer, boardId, targets);
  const related = writer.listRelatedConnectors(
    boardId,
    targets.map(({ objectId }) => objectId),
  );

  if ([...live, ...related].some((object) => scope.isLocked(object))) {
    return { kind: 'rejected', reason: 'geometryLocked' };
  }
  if (!live.every(canTranslate) || scope.requiredObjects(live).length !== live.length) {
    return { kind: 'conflict', boardRevision: revision, objects: live };
  }

  return { kind: 'changes', ...changes };
}

function readReverseOrder(
  reader: BoardEditReader,
  boardId: string,
  source: ConfirmedChange,
  current: ReadonlyMap<string, BoardObject>,
  next: ReadonlyMap<string, BoardObject>,
) {
  const idsAt = (revision: bigint) =>
    reader.listVersionObjects(boardId, revision).map(({ objectId }) => objectId);
  const desired = idsAt(source.revision - 1n);
  const expected = source.ordered ? idsAt(source.revision) : undefined;
  const order = planReverseOrder({
    current: [...current.keys()],
    desired,
    expected,
    existing: new Set(next.keys()),
  });

  return order && new Set(order).size === next.size ? order : undefined;
}

function samePalette(current: readonly string[], expected: readonly string[]) {
  return (
    current.length === expected.length && current.every((color, index) => color === expected[index])
  );
}

export function planBoardReverse(
  reader: BoardEditWriter,
  board: BoardHeader,
  actor: Actor,
  command: BoardReverseSource,
): BoardEditDecision {
  const { boardId } = board;
  const source = confirmedChange(reader, boardId, actor.id, command);
  if (!source || source.revision === 0n) {
    return { kind: 'rejected', reason: 'versionUnavailable' };
  }

  const version = reader.getVersion(boardId, source.revision);
  const prior = source.revision - 1n;
  if (
    version?.actorId !== actor.id ||
    version.kind === 'restore' ||
    !reader.getVersion(boardId, prior)
  ) {
    return { kind: 'rejected', reason: 'versionUnavailable' };
  }
  if (source.targets.length > maxTargets) {
    return { kind: 'rejected', reason: 'tooLarge' };
  }

  const { palette } = source;
  if (palette && !samePalette(reader.getBoardCustomColors(boardId), palette.after)) {
    return { kind: 'conflict', boardRevision: board.revision };
  }
  if (palette && !source.ordered && source.targets.length === 0) {
    return { kind: 'changes', customColors: palette.before };
  }

  const before = byId(reader.listVersionObjects(boardId, prior, source.targets));
  const after = byId(reader.listVersionObjects(boardId, source.revision, source.targets));
  const live = byId(reader.getObjects(boardId, source.targets));
  const targets = source.targets.map((objectId) => ({
    objectId,
    before: before.get(objectId),
    after: after.get(objectId),
    current: live.get(objectId),
  }));
  const ids = targets.filter(needsPayload).map(({ objectId }) => objectId);
  const payloads = readPayloadStates(reader, boardId, source.revision, ids);
  if (!payloads) {
    return { kind: 'rejected', reason: 'tooLarge' };
  }

  const changes = buildChanges(board, targets, payloads);
  if (!changes) {
    return { kind: 'conflict', boardRevision: board.revision, objects: [...live.values()] };
  }

  const translation = !source.ordered && targets.length > 0 && targets.every(translationOnly);
  const decision = translation
    ? reverseTranslation(reader, board, [...live.values()], changes)
    : reverseScene(reader, board, source, changes);

  return decision.kind === 'changes' && palette
    ? { ...decision, customColors: palette.before }
    : decision;
}
