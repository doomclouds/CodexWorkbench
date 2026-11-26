import {
  MoveConflictReason,
  MoveRejectionReason,
  type CommandReceipt,
  type GetCommandReceiptResponse,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import type { WhiteboardMoveCommand, WhiteboardMoveReceipt } from '../contracts.js';
import { readObjects } from './scene.js';
import { matchIdentity, requireField } from './values.js';

const conflictReasons = new Map<MoveConflictReason, string>([
  [MoveConflictReason.GEOMETRY_VERSION_CHANGED, 'geometryVersionChanged'],
  [MoveConflictReason.TARGETS_CHANGED, 'targetsChanged'],
]);
const rejectionReasons = new Map<MoveRejectionReason, string>([
  [MoveRejectionReason.FORBIDDEN, 'forbidden'],
  [MoveRejectionReason.GEOMETRY_LOCKED, 'geometryLocked'],
  [MoveRejectionReason.INVALID_MOVE, 'invalidMove'],
  [MoveRejectionReason.COMMAND_ID_REUSE, 'commandIdReuse'],
]);

function readReceipt(
  source: CommandReceipt | undefined,
  boardId: string,
  commandId: string,
): WhiteboardMoveReceipt {
  const receipt = requireField(source, 'command receipt');
  matchIdentity(receipt.boardId, boardId, 'board ID');
  matchIdentity(receipt.commandId, commandId, 'command ID');

  const identity = { boardId, commandId };
  const { case: kind, value } = receipt.outcome;

  switch (kind) {
    case 'applied':
      return {
        ...identity,
        kind,
        revision: requireField(value.boardRevision, 'applied board revision'),
        objects: readObjects(value.objects),
      };
    case 'conflict':
      return {
        ...identity,
        kind,
        revision: value.boardRevision,
        objects: readObjects(value.currentObjects),
        missingIds: value.missingObjectIds,
        reason: conflictReasons.get(value.reason) ?? 'unknown',
      };
    case 'rejected':
      return { ...identity, kind, reason: rejectionReasons.get(value.reason) ?? 'unknown' };
    case undefined:
      throw new Error('Whiteboard response is missing a command outcome.');
  }
}

export function readMoveReceipt(
  source: CommandReceipt | undefined,
  command: WhiteboardMoveCommand,
): WhiteboardMoveReceipt {
  const receipt = readReceipt(source, command.boardId, command.commandId);
  if (receipt.kind !== 'applied') {
    return receipt;
  }

  const targetIds = new Set(command.targets.map(({ id }) => id));
  if (
    receipt.objects.length !== targetIds.size ||
    receipt.objects.some(({ id }) => !targetIds.has(id))
  ) {
    throw new Error('Whiteboard response does not confirm the submitted move targets.');
  }

  return receipt;
}

export function readReceiptLookup(
  { result }: GetCommandReceiptResponse,
  boardId: string,
  commandId: string,
): WhiteboardMoveReceipt | undefined {
  switch (result.case) {
    case 'receipt':
      return readReceipt(result.value, boardId, commandId);
    case 'notRecorded':
      matchIdentity(result.value.boardId, boardId, 'board ID');
      matchIdentity(result.value.commandId, commandId, 'command ID');

      return undefined;
    case undefined:
      throw new Error('Whiteboard response is missing a receipt lookup result.');
  }
}
