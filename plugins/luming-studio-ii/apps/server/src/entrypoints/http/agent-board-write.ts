import { toBinary } from '@bufbuild/protobuf';
import {
  BoardAgentWriteService,
  type ApplyAgentBoardEditRequest,
} from '@codexworkbench/luming-studio-ii-contracts/agent-write/service';
import {
  maximumAgentBoardWriteOperations,
  WhiteboardAccessError,
  type BoardAgentWriteApplication,
  type BoardEditReceipt,
  type BoardSuggestionOperation,
} from '../../modules/whiteboard/application/index.js';
import { toBoardEditReceipt } from './board-edit-receipt.js';
import { readContentOperation } from './content-edits.js';
import { readGeometryOperation } from './geometry-edits.js';
import { HttpRequestError } from './request.js';
import { unaryRoute, type HttpActor } from './unary-route.js';

const { applyAgentBoardEdit, getAgentBoardEditReceipt } = BoardAgentWriteService.method;
const identifier = /^[A-Za-z0-9_.:-]{1,160}$/u;
const maximumReceiptDetails = 64;
const agentBoardPath = '/' + BoardAgentWriteService.typeName + '/';
export const agentBoardWritePath = agentBoardPath + applyAgentBoardEdit.name;
export const agentBoardReceiptPath = agentBoardPath + getAgentBoardEditReceipt.name;
export const agentBoardWriteRequestLimit = 256 * 1024;

function readIdentity(request: ApplyAgentBoardEditRequest, ownerId: string) {
  const { boardId, commandId, agentId, taskId, generation } = request;
  const validValues = [boardId, commandId, agentId, taskId, generation].every((id) =>
    identifier.test(id),
  );
  const agentSession = agentId.startsWith('agent-') && agentId !== ownerId;
  if (!validValues || !agentSession) {
    throw new HttpRequestError(
      400,
      'A board, an Agent session and a current workspace generation are required.',
    );
  }

  return { boardId, commandId, agentId, taskId, generation };
}

function readOperation({
  edit,
}: ApplyAgentBoardEditRequest['operations'][number]): BoardSuggestionOperation {
  if (!edit.case || edit.value.boardId || edit.value.commandId) {
    throw new HttpRequestError(
      400,
      'Each Agent edit must use the outer board and command identifiers.',
    );
  }

  return edit.case === 'geometry'
    ? { kind: 'geometry', operation: readGeometryOperation(edit.value) }
    : { kind: 'content', operation: readContentOperation(edit.value) };
}

function modelReceipt(receipt: BoardEditReceipt): {
  receipt: BoardEditReceipt;
  detailsOmitted: boolean;
} {
  const { outcome } = receipt;
  if (outcome.kind === 'rejected') {
    return { receipt, detailsOmitted: false };
  }

  const objects = outcome.objects?.slice(0, maximumReceiptDetails);
  if (outcome.kind === 'conflict') {
    const omittedObjects = (outcome.objects?.length ?? 0) > maximumReceiptDetails;
    return {
      receipt: { ...receipt, outcome: { ...outcome, objects, payloads: undefined } },
      detailsOmitted: omittedObjects || Boolean(outcome.payloads?.length),
    };
  }

  const removals = outcome.removedObjectIds.slice(0, maximumReceiptDetails);
  const omittedObjects = outcome.objects.length > maximumReceiptDetails;
  const omittedRemovals = outcome.removedObjectIds.length > maximumReceiptDetails;
  const omittedContent = Boolean(
    outcome.payloads.length || outcome.removedPayloadObjectIds?.length,
  );
  const omittedGeometry = omittedObjects || omittedRemovals || Boolean(outcome.order);

  return {
    receipt: {
      ...receipt,
      outcome: {
        ...outcome,
        objects: objects ?? [],
        removedObjectIds: removals,
        payloads: [],
        removedPayloadObjectIds: undefined,
        order: undefined,
      },
    },
    detailsOmitted: omittedGeometry || omittedContent,
  };
}

export function createAgentBoardWriteRoutes(
  application: BoardAgentWriteApplication,
  digest: (bytes: Uint8Array) => string,
) {
  function command(actor: HttpActor, request: ApplyAgentBoardEditRequest) {
    if (actor.kind !== 'agent' || actor.guestScope) {
      throw new WhiteboardAccessError();
    }

    const identity = readIdentity(request, actor.id);
    if (
      !request.operations.length ||
      request.operations.length > maximumAgentBoardWriteOperations
    ) {
      throw new HttpRequestError(
        400,
        'A scoped Agent edit requires between one and sixty operations.',
      );
    }

    return {
      ...identity,
      signature: 'agent-write:' + digest(toBinary(applyAgentBoardEdit.input, request)),
    };
  }

  function response(receipt: BoardEditReceipt) {
    const bounded = modelReceipt(receipt);

    return { receipt: toBoardEditReceipt(bounded.receipt), detailsOmitted: bounded.detailsOmitted };
  }

  return [
    unaryRoute(applyAgentBoardEdit, (actor, request) => {
      const receipt = application.apply(actor.id, {
        ...command(actor, request),
        operations: request.operations.map(readOperation),
      });

      return response(receipt);
    }),
    unaryRoute(getAgentBoardEditReceipt, (actor, { original }) => {
      if (!original) {
        throw new HttpRequestError(400, 'The original Agent edit is required.');
      }

      const receipt = application.getReceipt(actor.id, command(actor, original));
      if (receipt?.outcome.kind === 'rejected') {
        if (receipt.outcome.reason === 'forbidden') {
          throw new WhiteboardAccessError();
        }

        throw new HttpRequestError(409, 'The command does not match the original Agent edit.');
      }

      return receipt ? response(receipt) : {};
    }),
  ];
}
