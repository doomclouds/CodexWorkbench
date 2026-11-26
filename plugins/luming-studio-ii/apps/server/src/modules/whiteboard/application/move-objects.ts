import type {
  Actor,
  BoardHeader,
  BoardObject,
  CommandReceipt,
  MoveCommand,
  MoveConflict,
  MoveOutcome,
} from '../domain/index.js';
import {
  canAdvanceVersion,
  canTranslate,
  commandSignature,
  hasValidMoveInput,
  translateObject,
} from '../domain/index.js';
import type { WhiteboardWriter } from '../ports/index.js';
import { createMoveScope } from './move-scope.js';

function receiptFor({ boardId, commandId }: MoveCommand, outcome: MoveOutcome): CommandReceipt {
  return { boardId, commandId, outcome };
}

function conflict(
  reason: MoveConflict['reason'],
  boardRevision: bigint,
  currentObjects: readonly BoardObject[],
  missingObjectIds: readonly string[] = [],
): MoveConflict {
  return { kind: 'conflict', reason, boardRevision, currentObjects, missingObjectIds };
}

function translatedObjects(
  current: readonly BoardObject[],
  delta: MoveCommand['delta'],
): readonly BoardObject[] | undefined {
  const translated: BoardObject[] = [];
  for (const object of current) {
    const next = translateObject(object, delta);
    if (!next) {
      return undefined;
    }

    translated.push(next);
  }

  return translated;
}

function applyMove(
  writer: WhiteboardWriter,
  board: BoardHeader,
  command: MoveCommand,
): MoveOutcome {
  const { boardId, revision } = board;
  const scope = createMoveScope(writer, boardId, command.targets);
  const current: BoardObject[] = [];
  const missing: string[] = [];
  for (const [id, object] of scope.targets) {
    if (!object) {
      missing.push(id);
      continue;
    }

    current.push(object);
  }
  if (missing.length) {
    return conflict('targetsChanged', revision, current, missing);
  }
  if (current.some((object) => scope.isLocked(object))) {
    return { kind: 'rejected', reason: 'geometryLocked' };
  }

  const changed = command.targets.some(
    ({ objectId, expectedGeometryVersion }) =>
      scope.targets.get(objectId)?.geometryVersion !== expectedGeometryVersion,
  );

  if (changed) {
    return conflict('geometryVersionChanged', revision, current);
  }
  if (!current.every(canTranslate) || !canAdvanceVersion(revision)) {
    return { kind: 'rejected', reason: 'invalidMove' };
  }

  const required = scope.requiredObjects(current);
  if (required.length !== current.length) {
    return conflict('targetsChanged', revision, required);
  }

  const objects = translatedObjects(current, command.delta);
  if (!objects) {
    return { kind: 'rejected', reason: 'invalidMove' };
  }

  writer.saveGeometry(boardId, objects);

  return { kind: 'applied', boardRevision: writer.advanceBoardRevision(boardId), objects };
}

export function executeMove(
  writer: WhiteboardWriter,
  actor: Actor,
  command: MoveCommand,
): CommandReceipt {
  const { boardId, commandId } = command;
  const access = writer.getAccess(boardId, actor.id);
  const board = access && writer.getBoard(boardId);
  if (!access || !board) {
    return receiptFor(command, { kind: 'rejected', reason: 'forbidden' });
  }

  const stored = writer.getReceipt(boardId, actor.id, commandId);
  if (stored) {
    return stored.signature === commandSignature(command)
      ? stored.receipt
      : receiptFor(command, { kind: 'rejected', reason: 'commandIdReuse' });
  }
  if (!access.canEdit) {
    return receiptFor(command, { kind: 'rejected', reason: 'forbidden' });
  }
  if (!hasValidMoveInput(command)) {
    return receiptFor(command, { kind: 'rejected', reason: 'invalidMove' });
  }

  const outcome = applyMove(writer, board, command);
  const receipt = receiptFor(command, outcome);
  if (outcome.kind === 'applied') {
    writer.saveReceipt(actor.id, { signature: commandSignature(command), receipt });
  }

  return receipt;
}
