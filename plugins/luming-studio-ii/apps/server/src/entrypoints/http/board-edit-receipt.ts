import type { MessageInitShape } from '@bufbuild/protobuf';
import {
  BoardEditRejectionReason,
  type BoardEditReceiptSchema,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import type {
  BoardEditReceipt,
  BoardEditRejection,
  PayloadRecord,
} from '../../modules/whiteboard/application/index.js';
import { toPayloadResult } from './payload.js';
import { toObjectMetadata } from './scene.js';

const rejection: Readonly<Record<BoardEditRejection, BoardEditRejectionReason>> = {
  forbidden: BoardEditRejectionReason.FORBIDDEN,
  invalidEdit: BoardEditRejectionReason.INVALID_EDIT,
  objectNotFound: BoardEditRejectionReason.OBJECT_NOT_FOUND,
  geometryLocked: BoardEditRejectionReason.GEOMETRY_LOCKED,
  commandIdReuse: BoardEditRejectionReason.COMMAND_ID_REUSE,
  unsupportedKind: BoardEditRejectionReason.UNSUPPORTED_KIND,
  versionUnavailable: BoardEditRejectionReason.VERSION_UNAVAILABLE,
  tooLarge: BoardEditRejectionReason.TOO_LARGE,
  invalidImage: BoardEditRejectionReason.INVALID_IMAGE,
  invalidVideo: BoardEditRejectionReason.INVALID_VIDEO,
};

function encodePayload(payload: PayloadRecord) {
  return toPayloadResult({ kind: 'payload', payload });
}

export function toBoardEditReceipt({
  boardId,
  commandId,
  outcome,
}: BoardEditReceipt): MessageInitShape<typeof BoardEditReceiptSchema> {
  if (outcome.kind === 'rejected') {
    return {
      boardId,
      commandId,
      outcome: { case: 'rejected', value: { reason: rejection[outcome.reason] } },
    };
  }
  if (outcome.kind === 'conflict') {
    return {
      boardId,
      commandId,
      outcome: {
        case: 'conflict',
        value: {
          boardRevision: outcome.boardRevision,
          currentObjects: outcome.objects?.map(toObjectMetadata),
          currentPayloads: outcome.payloads?.map(encodePayload),
        },
      },
    };
  }

  const changedPayloads = outcome.payloads.map(encodePayload);
  for (const objectId of outcome.removedPayloadObjectIds ?? []) {
    changedPayloads.push(toPayloadResult({ kind: 'unavailable', objectId, reason: 'notFound' }));
  }

  return {
    boardId,
    commandId,
    outcome: {
      case: 'applied',
      value: {
        boardRevision: outcome.boardRevision,
        changedObjects: outcome.objects.map(toObjectMetadata),
        removedObjectIds: [...outcome.removedObjectIds],
        objectOrder: outcome.order ? [...outcome.order] : [],
        changedPayloads,
        detailsExpired: outcome.detailsExpired,
      },
    },
  };
}
