import type { MessageInitShape } from '@bufbuild/protobuf';
import type {
  ApplyFeedbackRequestSchema,
  FeedbackAnchorTargetSchema,
} from '@codexworkbench/luming-studio-ii-contracts/feedback/service';
import type { FeedbackCommand, FeedbackOperation, FeedbackTarget } from './contracts.js';

type SentOperation = MessageInitShape<typeof ApplyFeedbackRequestSchema>['operation'];

function encodeTarget(target: FeedbackTarget): MessageInitShape<typeof FeedbackAnchorTargetSchema> {
  if (target.kind === 'board') {
    return { target: { case: 'boardPoint', value: target.point } };
  }

  const { objectId, u, v, geometryVersion } = target;

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
      return {
        case: operation.kind,
        value: { threadId: operation.threadId, expectedThreadVersion: operation.expectedVersion },
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
