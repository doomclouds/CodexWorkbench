import { create, type MessageInitShape } from '@bufbuild/protobuf';
import {
  CommandReceiptSchema,
  MoveConflictReason,
  MoveRejectionReason,
  type CommandReceipt as WireCommandReceipt,
  type MoveObjectsRequest,
  type MoveTarget,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import type {
  CommandReceipt,
  MoveCommand,
  MoveRejectionReason as DomainMoveRejectionReason,
} from '../../modules/whiteboard/application/index.js';
import { HttpRequestError, requireId } from './request.js';
import { toObjectMetadata } from '../../infrastructure/adapters/scene-codec/index.js';

const REJECTION_REASONS: Record<DomainMoveRejectionReason, MoveRejectionReason> = {
  forbidden: MoveRejectionReason.FORBIDDEN,
  geometryLocked: MoveRejectionReason.GEOMETRY_LOCKED,
  invalidMove: MoveRejectionReason.INVALID_MOVE,
  commandIdReuse: MoveRejectionReason.COMMAND_ID_REUSE,
};

type CommandTarget = MoveCommand['targets'][number];
type ReceiptOutcome = CommandReceipt['outcome'];
type ReceiptOutcomeInit = MessageInitShape<typeof CommandReceiptSchema>['outcome'];

function toCommandTarget(target: MoveTarget): CommandTarget {
  const { objectId, expectedGeometryVersion } = target;
  if (expectedGeometryVersion === undefined) {
    throw new HttpRequestError(400, 'Expected geometry version is required');
  }

  return { objectId, expectedGeometryVersion };
}

export function toMoveCommand(request: MoveObjectsRequest): MoveCommand {
  const { boardId, commandId, delta, targets } = request;
  if (!delta) {
    throw new HttpRequestError(400, 'Move delta is required');
  }

  return {
    boardId: requireId(boardId),
    commandId: requireId(commandId),
    delta: { dx: delta.dx, dy: delta.dy },
    targets: targets.map(toCommandTarget),
  };
}

function toOutcome(outcome: ReceiptOutcome): ReceiptOutcomeInit {
  switch (outcome.kind) {
    case 'applied':
      return {
        case: 'applied',
        value: {
          boardRevision: outcome.boardRevision,
          objects: outcome.objects.map(toObjectMetadata),
        },
      };
    case 'conflict':
      return {
        case: 'conflict',
        value: {
          reason:
            outcome.reason === 'targetsChanged'
              ? MoveConflictReason.TARGETS_CHANGED
              : MoveConflictReason.GEOMETRY_VERSION_CHANGED,
          boardRevision: outcome.boardRevision,
          currentObjects: outcome.currentObjects.map(toObjectMetadata),
          missingObjectIds: [...outcome.missingObjectIds],
        },
      };
    case 'rejected':
      return { case: 'rejected', value: { reason: REJECTION_REASONS[outcome.reason] } };
  }
}

export function toCommandReceipt(receipt: CommandReceipt): WireCommandReceipt {
  return create(CommandReceiptSchema, {
    boardId: receipt.boardId,
    commandId: receipt.commandId,
    outcome: toOutcome(receipt.outcome),
  });
}
