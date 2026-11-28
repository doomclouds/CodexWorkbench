import { toBinary, type MessageInitShape } from '@bufbuild/protobuf';
import { BoardEditService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import {
  BoardSuggestionService,
  type BoardSuggestionOptionInput,
  type CreateBoardReviewSourceRequest,
  type PreviewBoardSuggestionResponseSchema,
} from '@codexworkbench/luming-studio-ii-contracts/suggestions/service';
import type {
  BoardEditReceipt,
  BoardReviewActor,
  BoardReviewOrigin,
  BoardReviewSource,
  BoardSuggestion,
  BoardSuggestionApplication,
  BoardSuggestionEdit,
  BoardSuggestionOptionDraft,
  BoardSuggestionPreview,
} from '../../modules/whiteboard/application/index.js';
import { toBoardEditReceipt } from './board-edit-receipt.js';
import { readContentOperation } from './content-edits.js';
import { readGeometryOperation } from './geometry-edits.js';
import { toPayloadResult } from './payload.js';
import { decodeRequest, HttpRequestError, requireId } from './request.js';
import { toObjectMetadata } from '../../infrastructure/adapters/scene-codec/index.js';
import { unaryRoute, type HttpActor, type RouteEntry } from './unary-route.js';

const {
  createBoardReviewSource,
  submitBoardSuggestion,
  listBoardSuggestions,
  previewBoardSuggestion,
  acceptBoardSuggestion,
  chooseAgentBoardSuggestion,
  rejectBoardSuggestion,
} = BoardSuggestionService.method;

const { editBoardGeometry, editObjectContent } = BoardEditService.method;

export const boardSuggestionSubmitPath =
  '/' + BoardSuggestionService.typeName + '/' + submitBoardSuggestion.name;
export const agentSuggestionChoosePath =
  '/' + BoardSuggestionService.typeName + '/' + chooseAgentBoardSuggestion.name;

const agentChoiceIdentifier = /^[A-Za-z0-9_.:-]{1,160}$/u;

function toAgentChoiceReceipt(receipt: BoardEditReceipt) {
  const { outcome } = receipt;
  if (outcome.kind === 'rejected') {
    return toBoardEditReceipt(receipt);
  }
  if (outcome.kind === 'conflict') {
    return toBoardEditReceipt({ ...receipt, outcome: { ...outcome, payloads: undefined } });
  }

  return toBoardEditReceipt({
    ...receipt,
    outcome: { ...outcome, payloads: [], removedPayloadObjectIds: undefined, order: undefined },
  });
}

function reviewActor(actor: HttpActor): BoardReviewActor {
  return { id: actor.id, kind: actor.kind ?? 'human' };
}

function readOrigin({ origin }: CreateBoardReviewSourceRequest): BoardReviewOrigin {
  switch (origin.case) {
    case 'selection':
      return { kind: 'selection', objectIds: origin.value.objectIds.map(requireId) };
    case 'feedbackThreadId':
      return { kind: 'feedback', threadId: requireId(origin.value) };
    case undefined:
      throw new HttpRequestError(400, 'An attached suggestion origin is required.');
  }
}

function toSource(source: BoardReviewSource) {
  return {
    boardId: source.boardId,
    sourceId: source.sourceId,
    capturedBoardRevision: source.capturedBoardRevision,
    objectIds: [...source.objectIds],
    feedbackThreadId: source.feedbackThreadId,
    targets: source.targets.map((target) => ({ ...target })),
    targetsBoardRevision: source.targetsBoardRevision,
  };
}

function toSuggestion(suggestion: BoardSuggestion) {
  return {
    ...suggestion,
    options: suggestion.options.map((option) => ({ ...option })),
    activeOptionIds: suggestion.activeOptionIds && [...suggestion.activeOptionIds],
  };
}

function requireInternalEditIdentity(request: {
  readonly boardId: string;
  readonly commandId: string;
}) {
  if (request.boardId || request.commandId) {
    throw new HttpRequestError(
      400,
      'A suggestion edit cannot set its own board or command identity.',
    );
  }
}

function encodeEdit({ edit }: Pick<BoardSuggestionOptionInput, 'edit'>): BoardSuggestionEdit {
  switch (edit.case) {
    case 'geometry': {
      requireInternalEditIdentity(edit.value);

      return { kind: edit.case, bytes: toBinary(editBoardGeometry.input, edit.value) };
    }
    case 'content': {
      requireInternalEditIdentity(edit.value);

      return { kind: edit.case, bytes: toBinary(editObjectContent.input, edit.value) };
    }
    case undefined:
      throw new HttpRequestError(400, 'A typed suggestion edit is required.');
  }
}

function decodeEdit(edit: BoardSuggestionEdit) {
  if (edit.kind === 'geometry') {
    const request = decodeRequest(editBoardGeometry.input, edit.bytes);
    requireInternalEditIdentity(request);

    return { kind: edit.kind, operation: readGeometryOperation(request) } as const;
  }

  const request = decodeRequest(editObjectContent.input, edit.bytes);
  requireInternalEditIdentity(request);

  return { kind: edit.kind, operation: readContentOperation(request) } as const;
}

function readOption(
  value: BoardSuggestionOptionInput,
  digest: (bytes: Uint8Array) => string,
): BoardSuggestionOptionDraft {
  if (value.operations.length && value.edit.case !== undefined) {
    throw new HttpRequestError(400, 'Choose the single edit or its ordered operations.');
  }

  const [edit, ...additionalEdits] = value.operations.length
    ? value.operations.map(encodeEdit)
    : [encodeEdit(value)];

  if (!edit) {
    throw new HttpRequestError(400, 'A typed suggestion edit is required.');
  }

  return {
    optionId: requireId(value.optionId),
    label: value.label,
    description: value.description,
    edit,
    additionalEdits,
    editFingerprint: [edit, ...additionalEdits]
      .map(({ kind, bytes }) => kind + ':' + digest(bytes))
      .join('|'),
  };
}

function compareVersion(value: bigint | undefined): bigint {
  if (value === undefined) {
    throw new HttpRequestError(400, 'An expected suggestion version is required.');
  }

  return value;
}

function toPreview(
  boardId: string,
  commandId: string,
  { decision, boardRevision }: BoardSuggestionPreview,
): MessageInitShape<typeof PreviewBoardSuggestionResponseSchema> {
  if (decision.kind === 'changes') {
    return {
      result: {
        case: 'preview',
        value: {
          boardRevision,
          changedObjects: decision.objects?.map(toObjectMetadata),
          changedPayloads: decision.payloads?.map((payload) =>
            toPayloadResult({ kind: 'payload', payload }),
          ),
          removedObjectIds: decision.removedObjectIds && [...decision.removedObjectIds],
          objectOrder: decision.order && [...decision.order],
        },
      },
    };
  }

  const { outcome } = toBoardEditReceipt({ boardId, commandId, outcome: decision });
  if (outcome?.case === 'conflict' || outcome?.case === 'rejected') {
    return { result: outcome };
  }

  throw new Error('A preview decision returned the wrong outcome.');
}

function listLimit(limit: number) {
  if (limit > 50) {
    throw new HttpRequestError(400, 'Suggest at most fifty proposals per page.');
  }

  return limit || 30;
}

export function createBoardSuggestionRoutes(
  application: BoardSuggestionApplication,
  digest: (value: Uint8Array) => string,
): readonly RouteEntry[] {
  return [
    unaryRoute(createBoardReviewSource, (actor, request) => ({
      source: toSource(
        application.createSource(reviewActor(actor), {
          boardId: requireId(request.boardId),
          commandId: requireId(request.commandId),
          expectedBoardRevision: request.expectedBoardRevision,
          origin: readOrigin(request),
          signature:
            'suggestion-source:' + digest(toBinary(createBoardReviewSource.input, request)),
        }),
      ),
    })),
    unaryRoute(submitBoardSuggestion, (actor, request) => ({
      suggestion: toSuggestion(
        application.submit(
          reviewActor(actor),
          {
            boardId: requireId(request.boardId),
            commandId: requireId(request.commandId),
            sourceId: requireId(request.sourceId),
            observation: request.observation,
            options: request.options.map((option) => readOption(option, digest)),
            signature:
              'suggestion-submit:' + digest(toBinary(submitBoardSuggestion.input, request)),
          },
          decodeEdit,
        ),
      ),
    })),
    unaryRoute(listBoardSuggestions, (actor, { boardId, limit, beforeProposalId }) => {
      const result = application.list(reviewActor(actor), {
        boardId: requireId(boardId),
        limit: listLimit(limit),
        beforeProposalId: beforeProposalId && requireId(beforeProposalId),
      });

      return {
        proposals: result.proposals.map(toSuggestion),
        nextBeforeProposalId: result.nextBeforeProposalId,
      };
    }),
    unaryRoute(previewBoardSuggestion, (actor, request) => {
      const { boardId, proposalId, optionId, expectedProposalVersion } = request;
      const preview = application.preview(
        reviewActor(actor),
        {
          boardId: requireId(boardId),
          proposalId: requireId(proposalId),
          optionId: requireId(optionId),
          expectedProposalVersion: compareVersion(expectedProposalVersion),
        },
        decodeEdit,
      );

      return toPreview(boardId, proposalId, preview);
    }),
    unaryRoute(acceptBoardSuggestion, (actor, request) => {
      const { boardId, commandId, proposalId, optionId, expectedProposalVersion } = request;
      const receipt = application.accept(
        reviewActor(actor),
        {
          boardId: requireId(boardId),
          commandId: requireId(commandId),
          proposalId: requireId(proposalId),
          optionId: requireId(optionId),
          expectedProposalVersion: compareVersion(expectedProposalVersion),
          signature: 'suggestion-accept:' + digest(toBinary(acceptBoardSuggestion.input, request)),
        },
        decodeEdit,
      );

      return { receipt: toBoardEditReceipt(receipt) };
    }),
    unaryRoute(chooseAgentBoardSuggestion, (actor, request) => {
      const {
        boardId,
        commandId,
        proposalId,
        optionId,
        expectedProposalVersion,
        agentId,
        taskId,
        generation,
      } = request;
      const validBinding = [agentId, taskId, generation].every((value) =>
        agentChoiceIdentifier.test(value),
      );

      if (!validBinding || !agentId.startsWith('agent-') || agentId === actor.id) {
        throw new HttpRequestError(400, 'A current Agent suggestion workspace is required.');
      }

      const receipt = application.acceptAgent(
        reviewActor(actor),
        {
          boardId: requireId(boardId),
          commandId: requireId(commandId),
          proposalId: requireId(proposalId),
          optionId: requireId(optionId),
          expectedProposalVersion: compareVersion(expectedProposalVersion),
          agentId,
          taskId,
          generation,
          signature:
            'agent-suggestion-choose:' +
            digest(toBinary(chooseAgentBoardSuggestion.input, request)),
        },
        decodeEdit,
      );

      return { receipt: toAgentChoiceReceipt(receipt) };
    }),
    unaryRoute(rejectBoardSuggestion, (actor, request) => ({
      suggestion: toSuggestion(
        application.reject(reviewActor(actor), {
          boardId: requireId(request.boardId),
          commandId: requireId(request.commandId),
          proposalId: requireId(request.proposalId),
          expectedProposalVersion: compareVersion(request.expectedProposalVersion),
          signature: 'suggestion-reject:' + digest(toBinary(rejectBoardSuggestion.input, request)),
        }),
      ),
    })),
  ];
}
