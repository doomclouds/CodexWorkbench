import type { MessageInitShape } from '@bufbuild/protobuf';
import {
  FeedbackRejectionReason,
  FeedbackService,
  FeedbackThreadStatus,
  type ApplyFeedbackRequest,
  type FeedbackAnchorSchema,
  type FeedbackAnchorTarget,
  type FeedbackContentPoint,
  type FeedbackContentPointSchema,
  type FeedbackReceiptSchema,
  type FeedbackThreadSchema,
  type GetFeedbackReceiptResponseSchema,
} from '@codexworkbench/luming-studio-ii-contracts/feedback/service';
import type {
  FeedbackAnchor,
  FeedbackAnchorTarget as AnchorTarget,
  FeedbackApplication,
  FeedbackContentUnit,
  FeedbackOperation,
  FeedbackReceipt,
  FeedbackRejectionReason as RejectionReason,
  FeedbackThreadStatus as ThreadStatus,
  FeedbackThreadView,
} from '../../modules/feedback/application/index.js';
import { HttpRequestError, requireId } from './request.js';
import { unaryRoute, type RouteEntry } from './unary-route.js';

const rejections: Record<RejectionReason, FeedbackRejectionReason> = {
  invalidText: FeedbackRejectionReason.INVALID_TEXT,
  invalidAnchor: FeedbackRejectionReason.INVALID_ANCHOR,
  targetChanged: FeedbackRejectionReason.TARGET_CHANGED,
  notFound: FeedbackRejectionReason.NOT_FOUND,
  forbidden: FeedbackRejectionReason.FORBIDDEN,
  versionChanged: FeedbackRejectionReason.VERSION_CHANGED,
  commandIdReuse: FeedbackRejectionReason.COMMAND_ID_REUSE,
};

function requireVersion(version: bigint | undefined): bigint {
  if (version === undefined) {
    throw new HttpRequestError(400, 'Feedback expected version is required.');
  }

  return version;
}

function readContent(content: FeedbackContentPoint['content']): FeedbackContentUnit {
  switch (content.case) {
    case 'document':
      return { kind: 'document', blockIds: content.value.blockIds };
    case 'todoItemId':
      return { kind: 'todo', itemId: requireId(content.value) };
    case 'html':
      return {
        kind: 'html',
        nodeIds: content.value.nodeIds,
        sourceRevision: requireVersion(content.value.sourceRevision),
      };
    case undefined:
      throw new HttpRequestError(400, 'Feedback content anchor unit is required.');
  }
}

function readTarget(anchor: FeedbackAnchorTarget | undefined): AnchorTarget {
  const target = anchor?.target;
  switch (target?.case) {
    case 'boardPoint':
      return {
        kind: 'board',
        point: { x: target.value.x, y: target.value.y },
      };
    case 'objectPoint': {
      const { objectId, u, v, geometryVersion } = target.value;

      return {
        kind: 'object',
        objectId: requireId(objectId),
        u,
        v,
        geometryVersion: requireVersion(geometryVersion),
      };
    }
    case 'contentPoint': {
      const { objectId, u, v, geometryVersion, payloadVersion, content } = target.value;

      return {
        kind: 'content',
        objectId: requireId(objectId),
        u,
        v,
        geometryVersion: requireVersion(geometryVersion),
        payloadVersion: requireVersion(payloadVersion),
        content: readContent(content),
      };
    }
    case undefined:
      throw new HttpRequestError(400, 'Feedback anchor target is required.');
  }
}

function readOperation(operation: ApplyFeedbackRequest['operation']): FeedbackOperation {
  switch (operation.case) {
    case 'create':
      return {
        kind: 'create',
        anchor: readTarget(operation.value.anchor),
        text: operation.value.text,
      };
    case 'reply':
      return {
        kind: 'reply',
        threadId: requireId(operation.value.threadId),
        text: operation.value.text,
      };
    case 'edit':
      return {
        kind: 'edit',
        threadId: requireId(operation.value.threadId),
        messageId: requireId(operation.value.messageId),
        expectedMessageVersion: requireVersion(operation.value.expectedMessageVersion),
        text: operation.value.text,
      };
    case 'resolve':
    case 'reopen':
    case 'delete':
      return {
        kind: operation.case,
        threadId: requireId(operation.value.threadId),
        expectedThreadVersion: requireVersion(operation.value.expectedThreadVersion),
      };
    case undefined:
      throw new HttpRequestError(400, 'Feedback operation is required.');
  }
}

function readStatus(status: FeedbackThreadStatus): ThreadStatus | undefined {
  switch (status) {
    case FeedbackThreadStatus.UNSPECIFIED:
      return undefined;
    case FeedbackThreadStatus.OPEN:
      return 'open';
    case FeedbackThreadStatus.RESOLVED:
      return 'resolved';
    default:
      throw new HttpRequestError(400, 'Feedback status filter is invalid.');
  }
}

function writeContent(
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

function writeAnchor(anchor: FeedbackAnchor): MessageInitShape<typeof FeedbackAnchorSchema> {
  const { target, ...source } = anchor;
  if (target.kind === 'board') {
    return {
      ...source,
      target: { target: { case: 'boardPoint', value: target.point } },
    };
  }

  const { objectId, u, v, geometryVersion } = target;
  if (target.kind === 'content') {
    return {
      ...source,
      target: {
        target: {
          case: 'contentPoint',
          value: {
            objectId,
            u,
            v,
            geometryVersion,
            payloadVersion: target.payloadVersion,
            content: writeContent(target.content),
          },
        },
      },
    };
  }

  return {
    ...source,
    target: { target: { case: 'objectPoint', value: { objectId, u, v, geometryVersion } } },
  };
}

function writeThread(thread: FeedbackThreadView): MessageInitShape<typeof FeedbackThreadSchema> {
  return {
    ...thread,
    status: thread.status === 'open' ? FeedbackThreadStatus.OPEN : FeedbackThreadStatus.RESOLVED,
    anchor: writeAnchor(thread.anchor),
  };
}

function writeReceipt(receipt: FeedbackReceipt): MessageInitShape<typeof FeedbackReceiptSchema> {
  const { boardId, commandId, outcome } = receipt;
  if (outcome.kind === 'applied') {
    const { threadId, threadVersion, messageId, messageVersion, deleted } = outcome;

    return {
      boardId,
      commandId,
      outcome: {
        case: 'applied',
        value: { threadId, threadVersion, messageId, messageVersion, deleted },
      },
    };
  }

  return {
    boardId,
    commandId,
    outcome: {
      case: 'rejected',
      value: { reason: rejections[outcome.reason], currentVersion: outcome.currentVersion },
    },
  };
}

export function createFeedbackRoutes(application: FeedbackApplication): readonly RouteEntry[] {
  const { listThreads, getThread, applyFeedback, getFeedbackReceipt } = FeedbackService.method;

  return [
    unaryRoute(listThreads, (actor, request) => {
      const { boardId, pageSize, cursor, status, authorActorId } = request;
      const page = application.listThreads(actor, requireId(boardId), {
        pageSize,
        cursor,
        status: readStatus(status),
        authorActorId,
      });

      return { ...page, threads: page.threads.map(writeThread) };
    }),
    unaryRoute(getThread, (actor, request) => {
      const { boardId, threadId, pageSize, cursor } = request;
      const page = application.getThread(actor, requireId(boardId), requireId(threadId), {
        pageSize,
        cursor,
      });

      return { ...page, thread: writeThread(page.thread), replies: [...page.replies] };
    }),
    unaryRoute(applyFeedback, (actor, request) => {
      const receipt = application.applyFeedback(actor, {
        boardId: requireId(request.boardId),
        commandId: requireId(request.commandId),
        operation: readOperation(request.operation),
      });

      return { receipt: writeReceipt(receipt) };
    }),
    unaryRoute(
      getFeedbackReceipt,
      (actor, request): MessageInitShape<typeof GetFeedbackReceiptResponseSchema> => {
        const commandId = requireId(request.commandId);
        const receipt = application.getReceipt(actor, requireId(request.boardId), commandId);
        if (!receipt) {
          return { result: { case: 'notRecorded', value: { commandId } } };
        }

        return { result: { case: 'receipt', value: writeReceipt(receipt) } };
      },
    ),
  ];
}
