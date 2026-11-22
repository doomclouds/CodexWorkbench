import { isBoardProjection } from '../../contracts/board-shape.js';
import type { Actor, Operation } from '../../contracts/studio.js';
import { isRecord } from '../../shared/is-record.js';
import { jsonEqual } from '../../shared/safe-merge.js';
import type {
  LocalUnitMutation,
  LocalUnitMutationRequest,
  LocalUnitMutationWrite,
} from '../ports/studio-repository.js';
import { applyMutation } from '../shared/history.js';
import type { ArtifactState, MutationArguments, Snapshot } from '../shared/model.js';
import {
  MAX_WHITEBOARD_BYTES,
  MAX_WHITEBOARD_ELEMENTS,
  whiteboardAdapter,
  type WhiteboardContent,
} from './whiteboard.js';

export interface LocalWhiteboardCommand {
  request: LocalUnitMutationRequest;
  mutation: MutationArguments<Operation>;
  position: boolean;
}

interface LocalWhiteboardResult {
  before: WhiteboardContent;
  after: Snapshot<WhiteboardContent>;
  write: LocalUnitMutationWrite;
}

function updateOperation(
  value: unknown,
): value is Operation & { id: string; changes: Record<string, unknown> } {
  return (
    isRecord(value) &&
    value.op === 'update' &&
    typeof value.id === 'string' &&
    isRecord(value.changes)
  );
}

function fieldsChanged(changes: Record<string, unknown>): 'text' | 'position' | undefined {
  const keys = Object.keys(changes);
  if (keys.length === 1 && keys[0] === 'text' && typeof changes.text === 'string') {
    return 'text';
  }
  if (
    keys.length &&
    keys.every((key) => (key === 'x' || key === 'y') && Number.isFinite(changes[key]))
  ) {
    return 'position';
  }
}

export function localWhiteboardCommand(
  args: Record<string, unknown>,
  actor: Actor,
): LocalWhiteboardCommand | undefined {
  const { operationId, operations, expectedRevision, expectedVersions, summary, merge } = args;
  const needsUnitReceipt = actor.kind === 'human' && args.receiptFormat === 'units-v1';
  if (!needsUnitReceipt || typeof operationId !== 'string' || !Array.isArray(operations)) {
    return;
  }
  if (operations.length !== 1 || (merge !== undefined && merge !== 'safe')) {
    return;
  }

  const operation: unknown = operations[0];
  if (!updateOperation(operation)) {
    return;
  }

  const fields = fieldsChanged(operation.changes);
  if (!fields) {
    return;
  }

  return {
    request: {
      id: operation.id,
      operationId,
      maximumElements: MAX_WHITEBOARD_ELEMENTS,
      maximumBytes: MAX_WHITEBOARD_BYTES,
    },
    mutation: {
      operationId,
      operations: [operation],
      expectedRevision,
      expectedVersions,
      summary,
      merge,
    },
    position: fields === 'position',
  };
}

function matchesCurrentUnit(basis: LocalUnitMutation, command: LocalWhiteboardCommand): boolean {
  const { expectedRevision, expectedVersions } = command.mutation;
  const revision = basis.authorization.artifact.revision;
  if (expectedRevision !== undefined && expectedRevision !== revision) {
    return false;
  }
  if (expectedVersions === undefined) {
    return expectedRevision === revision;
  }
  if (!isRecord(expectedVersions)) {
    return false;
  }

  const ids = Object.keys(expectedVersions);
  if (!ids.length) {
    return expectedRevision === revision;
  }

  const { unit, clock } = basis;
  return ids.length === 1 && ids[0] === unit.id && expectedVersions[unit.id] === clock.version;
}

export function applyLocalWhiteboardCommand(
  basis: LocalUnitMutation,
  command: LocalWhiteboardCommand,
  actor: Actor,
): LocalWhiteboardResult | undefined {
  const { unit, clock } = basis;
  const plainText = unit.type === 'text' && !unit.parentId && !unit.groupId;
  if (!plainText || unit.version !== clock.version || !matchesCurrentUnit(basis, command)) {
    return;
  }
  if (command.position && basis.hasLockedArrow) {
    return;
  }

  const board = { ...basis.fields, artifact: basis.authorization.artifact, elements: [unit] };
  if (!isBoardProjection(board)) {
    return;
  }

  const { artifact, ...before } = board;
  const state: ArtifactState<WhiteboardContent> = {
    ...basis.authorization,
    artifact,
    schemaVersion: 2,
    content: before,
    feedback: [],
    history: [],
    operations: [],
    unitClocks: { [unit.id]: clock },
    sources: {},
    assets: {},
  };
  const { snapshot, historyEntry } = applyMutation(
    state,
    command.mutation,
    actor,
    whiteboardAdapter,
    {
      transactionSnapshot: true,
    },
  );
  const { elements, ...fields } = snapshot.content;
  const [updated] = elements;
  const nextClock = state.unitClocks?.[unit.id];
  const [operation] = state.operations;
  const singleUnit = elements.length === 1 && updated?.id === unit.id;
  const sameScope =
    jsonEqual(historyEntry.changedIds, [unit.id]) && jsonEqual(fields, basis.fields);

  if (!singleUnit || !sameScope) {
    return;
  }
  if (!nextClock || !operation) {
    return;
  }

  return {
    before,
    after: snapshot,
    write: {
      artifact: snapshot.artifact,
      entry: historyEntry,
      unit: updated,
      clock: nextClock,
      operation,
    },
  };
}
