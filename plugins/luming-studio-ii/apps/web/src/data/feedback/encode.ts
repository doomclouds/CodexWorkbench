import type { MessageInitShape } from '@bufbuild/protobuf';
import type {
  ApplyFeedbackRequestSchema,
  FeedbackAnchorTargetSchema,
  FeedbackContentPointSchema,
} from '@codexworkbench/luming-studio-ii-contracts/feedback/service';
import type {
  FeedbackCommand,
  FeedbackContentUnit,
  FeedbackOperation,
  FeedbackTarget,
} from './contracts.js';

type SentOperation = MessageInitShape<typeof ApplyFeedbackRequestSchema>['operation'];

function encodeContent(
  unit: FeedbackContentUnit,
): MessageInitShape<typeof FeedbackContentPointSchema>['content'] {
  switch (unit.kind) {
    case 'document':
      return { case: 'document', value: { blockIds: [...unit.blockIds] } };
    case 'todo':
      return { case: 'todoItemId', value: unit.itemId };
    case 'html':
      return {
        case: 'html',
        value: { nodeIds: [...unit.nodeIds], sourceRevision: unit.sourceRevision },
      };
  }
}

function encodeTarget(target: FeedbackTarget): MessageInitShape<typeof FeedbackAnchorTargetSchema> {
  if (target.kind === 'board') {
    return { target: { case: 'boardPoint', value: target.point } };
  }

  if (target.kind === 'selection') {
    const { point, bounds, objects, expectedBoardRevision } = target;

    return {
      target: {
        case: 'selection',
        value: { point, bounds, objects: [...objects], expectedBoardRevision },
      },
    };
  }

  const { objectId, u, v, geometryVersion } = target;
  if (target.kind === 'content') {
    return {
      target: {
        case: 'contentPoint',
        value: {
          objectId,
          u,
          v,
          geometryVersion,
          payloadVersion: target.payloadVersion,
          content: encodeContent(target.content),
        },
      },
    };
  }

  return { target: { case: 'objectPoint', value: { objectId, u, v, geometryVersion } } };
}

function encodeOperation(operation: FeedbackOperation): SentOperation {
  switch (operation.kind) {
    case 'create':
      return {
        case: 'create',
        value: { anchor: encodeTarget(operation.anchor), text: operation.text },
      };
    case 'reply':
      return { case: 'reply', value: { threadId: operation.threadId, text: operation.text } };
    case 'edit': {
      const { threadId, messageId, expectedVersion, text } = operation;
      return {
        case: 'edit',
        value: { threadId, messageId, expectedMessageVersion: expectedVersion, text },
      };
    }
    case 'resolve':
    case 'reopen':
    case 'delete':
    case 'requestAttachment':
      return {
        case: operation.kind,
        value: { threadId: operation.threadId, expectedThreadVersion: operation.expectedVersion },
      };
    case 'claimAttachment':
    case 'resetAttachmentClaim':
      return {
        case: operation.kind,
        value: { threadId: operation.threadId, requestId: operation.requestId },
      };
    case 'confirmAttachment':
      return {
        case: operation.kind,
        value: {
          threadId: operation.threadId,
          requestId: operation.requestId,
          claimId: operation.claimId,
        },
      };
  }
}

export function encodeFeedbackCommand(
  command: FeedbackCommand,
): MessageInitShape<typeof ApplyFeedbackRequestSchema> {
  return {
    boardId: command.boardId,
    commandId: command.commandId,
    operation: encodeOperation(command.operation),
  };
}
