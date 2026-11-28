import type { MessageInitShape } from '@bufbuild/protobuf';
import {
  FeedbackAttachmentState,
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
import { unaryRoute, type HttpActor, type RouteEntry } from './unary-route.js';

const { listThreads, getThread, applyFeedback, getFeedbackReceipt } = FeedbackService.method;
const agentFeedbackPaths = new Set(
  [listThreads, getThread, applyFeedback, getFeedbackReceipt].map(
    ({ parent, name }) => '/' + parent.typeName + '/' + name,
  ),
);

export function isAgentFeedbackRequest(path: string, actor: HttpActor): boolean {
  return actor.feedbackAuthorId !== undefined && agentFeedbackPaths.has(path);
}

function feedbackActor(actor: HttpActor) {
  if (actor.kind !== 'agent') {
    return actor;
  }

  const authorId = actor.feedbackAuthorId;
  if (!authorId || authorId === actor.id) {
    throw new HttpRequestError(403, 'Agent feedback requires a separate author identity.');
  }

  return { id: authorId, principalId: actor.id, kind: actor.kind };
}

const rejections: Record<RejectionReason, FeedbackRejectionReason> = {
  invalidText: FeedbackRejectionReason.INVALID_TEXT,
  invalidAnchor: FeedbackRejectionReason.INVALID_ANCHOR,
  targetChanged: FeedbackRejectionReason.TARGET_CHANGED,
  notFound: FeedbackRejectionReason.NOT_FOUND,
  forbidden: FeedbackRejectionReason.FORBIDDEN,
  versionChanged: FeedbackRejectionReason.VERSION_CHANGED,
  commandIdReuse: FeedbackRejectionReason.COMMAND_ID_REUSE,
  attachmentClaimed: FeedbackRejectionReason.ATTACHMENT_CLAIMED,
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
    case 'selection': {
      const { point, bounds, objects, expectedBoardRevision } = target.value;
      if (!point) {
        throw new HttpRequestError(400, 'Feedback selection point is required.');
      }

      return {
        kind: 'selection',
        point,
        bounds,
        objects: objects.map(({ objectId, geometryVersion, payloadVersion }) => ({
          objectId: requireId(objectId),
          geometryVersion: requireVersion(geometryVersion),
          payloadVersion,
        })),
        expectedBoardRevision: requireVersion(expectedBoardRevision),
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
    case 'requestAttachment':
      return {
        kind: operation.case,
        threadId: requireId(operation.value.threadId),
        expectedThreadVersion: requireVersion(operation.value.expectedThreadVersion),
      };
    case 'claimAttachment':
    case 'resetAttachmentClaim':
      return {
        kind: operation.case,
        threadId: requireId(operation.value.threadId),
        requestId: requireId(operation.value.requestId),
      };
    case 'confirmAttachment':
      return {
        kind: operation.case,
        threadId: requireId(operation.value.threadId),
        requestId: requireId(operation.value.requestId),
        claimId: requireId(operation.value.claimId),
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
  const { target, frozenTargets, ...data } = anchor;
  const source = { ...data, frozenTargets: frozenTargets ? [...frozenTargets] : [] };
  if (target.kind === 'board') {
    return {
      ...source,
      target: { target: { case: 'boardPoint', value: target.point } },
    };
  }

  if (target.kind === 'selection') {
    const { point, bounds, objects, expectedBoardRevision } = target;

    return {
      ...source,
      target: {
        target: {
          case: 'selection',
          value: { point, bounds, objects: [...objects], expectedBoardRevision },
        },
      },
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
  const attachments = {
    pending: FeedbackAttachmentState.PENDING,
    claimed: FeedbackAttachmentState.CLAIMED,
    attached: FeedbackAttachmentState.ATTACHED,
  };
  const { attachment } = thread;
  return {
    ...thread,
    attachment: attachment && { ...attachment, state: attachments[attachment.state] },
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
  return [
    unaryRoute(listThreads, (actor, request) => {
      const {
        boardId,
        pageSize,
        cursor,
        status,
        authorActorId,
        authoredByViewer,
        pendingAttachment,
      } = request;
      const author = feedbackActor(actor);
      const page = application.listThreads(author, requireId(boardId), {
        pageSize,
        cursor,
        status: readStatus(status),
        authorActorId: authoredByViewer ? author.id : authorActorId,
        pendingAttachment,
      });

      return { ...page, threads: page.threads.map(writeThread) };
    }),
    unaryRoute(getThread, (actor, request) => {
      const { boardId, threadId, pageSize, cursor } = request;
      const page = application.getThread(
        feedbackActor(actor),
        requireId(boardId),
        requireId(threadId),
        {
          pageSize,
          cursor,
        },
      );

      return { ...page, thread: writeThread(page.thread), replies: [...page.replies] };
    }),
    unaryRoute(applyFeedback, (actor, request) => {
      const receipt = application.applyFeedback(feedbackActor(actor), {
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
        const receipt = application.getReceipt(
          feedbackActor(actor),
          requireId(request.boardId),
          commandId,
        );

        if (!receipt) {
          return { result: { case: 'notRecorded', value: { commandId } } };
        }

        return { result: { case: 'receipt', value: writeReceipt(receipt) } };
      },
    ),
  ];
}
