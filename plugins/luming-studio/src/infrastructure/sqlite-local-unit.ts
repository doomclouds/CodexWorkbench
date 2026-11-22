import type { BoardElement } from '../contracts/studio.js';
import { isBoardElementProjection } from '../contracts/board-shape.js';
import type {
  ArtifactState,
  LocalUnitMutation,
  LocalUnitMutationRequest,
  LocalUnitMutationWrite,
} from '../core/ports/studio-repository.js';
import { isRecord } from '../shared/is-record.js';
import { jsonEqual } from '../shared/safe-merge.js';

export const LOCAL_UNIT_BUDGET = 'local_unit_budget';
export const MAX_SAVED_OPERATIONS = 500;
const MAX_INLINE_HISTORY_ID_LENGTH = 128;

export interface LocalUnitBudget {
  revision: number;
  fieldsHash: string;
  bytes: number;
  elements: number;
  hasLockedArrow: boolean;
}

export function unitJsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

export function isLocalClock(value: unknown): value is LocalUnitMutation['clock'] {
  if (!isRecord(value)) {
    return false;
  }

  const { version, incarnationStart, sourceRevision } = value;

  return (
    positiveInteger(version) &&
    positiveInteger(incarnationStart) &&
    incarnationStart <= version &&
    (sourceRevision === undefined || positiveInteger(sourceRevision))
  );
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function validCurrentClock(element: unknown, clocks: Record<string, unknown>): boolean {
  if (!isRecord(element) || typeof element.id !== 'string' || !positiveInteger(element.version)) {
    return false;
  }

  const clock = clocks[element.id];
  if (!Object.hasOwn(clocks, element.id)) {
    return true;
  }

  return (
    isLocalClock(clock) &&
    clock.version <= element.version &&
    (element.type !== 'html' || (clock.sourceRevision ?? 0) <= Number(element.sourceRevision ?? 0))
  );
}

export function localOperationRecord(
  value: unknown,
): value is ArtifactState<unknown>['operations'][number] {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.fingerprint === 'string' &&
    typeof value.historyId === 'string' &&
    value.historyId.length <= MAX_INLINE_HISTORY_ID_LENGTH &&
    (value.receiptUnavailable === undefined || value.receiptUnavailable === true)
  );
}

export function captureLocalUnitBudget(
  state: ArtifactState<unknown>,
  fieldsHash: string,
): LocalUnitBudget | undefined {
  const { artifact, content, operations, unitClocks } = state;
  if (artifact.type !== 'whiteboard' || !isRecord(content) || !Array.isArray(content.elements)) {
    return;
  }

  const elements: unknown[] = content.elements;
  const validOperations =
    Array.isArray(operations) &&
    operations.length <= MAX_SAVED_OPERATIONS &&
    operations.every(localOperationRecord);

  if (!isRecord(unitClocks) || !validOperations) {
    return;
  }

  const validClocks = Object.values(unitClocks).every(isLocalClock);
  const synchronized = elements.every((element) => validCurrentClock(element, unitClocks));
  if (!validClocks || !synchronized) {
    return;
  }

  return {
    revision: artifact.revision,
    fieldsHash,
    bytes: unitJsonBytes(content),
    elements: elements.length,
    hasLockedArrow: elements.some(
      (element) => isRecord(element) && element.type === 'arrow' && Boolean(element.locked),
    ),
  };
}

export function parseLocalUnitBudget(value: unknown): LocalUnitBudget | undefined {
  if (typeof value !== 'string') {
    return;
  }

  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)) {
    return;
  }

  const { revision, bytes, fieldsHash, elements, hasLockedArrow } = parsed;
  const validRevision =
    typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0;
  const validDimensions = positiveInteger(bytes) && positiveInteger(elements);
  const validProjection = typeof fieldsHash === 'string' && typeof hasLockedArrow === 'boolean';
  if (!validRevision || !validDimensions || !validProjection) {
    return;
  }

  return { revision, bytes, fieldsHash, elements, hasLockedArrow };
}

function changedLocalUnitFields(before: BoardElement, after: BoardElement): boolean {
  const rest = (unit: BoardElement) => {
    const { x: _x, y: _y, text: _text, version: _version, ...unchanged } = unit;

    return unchanged;
  };

  return !jsonEqual(rest(before), rest(after));
}

export function validLocalUpdate(
  basis: LocalUnitMutation,
  update: LocalUnitMutationWrite,
  request: LocalUnitMutationRequest,
): boolean {
  const { artifact, entry, unit, clock, operation } = update;
  const before = basis.authorization.artifact;
  const moved = unit.x !== basis.unit.x || unit.y !== basis.unit.y;
  const protectedGeometry = moved && (basis.hasLockedArrow || basis.unit.locked);
  const supportedChange =
    isBoardElementProjection(unit) && !changedLocalUnitFields(basis.unit, unit);
  const nextVersion = unit.version === basis.unit.version + 1 && clock.version === unit.version;
  const compatibleClock =
    isLocalClock(clock) && clock.incarnationStart === basis.clock.incarnationStart;

  if (protectedGeometry || !supportedChange) {
    return false;
  }
  if (!nextVersion || !compatibleClock) {
    return false;
  }

  return (
    Number.isSafeInteger(artifact.revision) &&
    artifact.revision === before.revision + 1 &&
    jsonEqual(artifact, {
      ...before,
      revision: artifact.revision,
      updatedAt: artifact.updatedAt,
    }) &&
    entry.revision === artifact.revision &&
    entry.changedIds.length === 1 &&
    entry.changedIds[0] === request.id &&
    localOperationRecord(operation) &&
    operation.id === request.operationId &&
    operation.historyId === entry.id &&
    !operation.receiptUnavailable
  );
}
