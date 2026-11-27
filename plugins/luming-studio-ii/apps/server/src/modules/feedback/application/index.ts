import type {
  FeedbackActor,
  FeedbackMessageView,
  FeedbackReceipt,
  FeedbackThreadView,
} from '../domain/index.js';
import type { FeedbackRepository } from '../ports/index.js';
import {
  permitsFeedback,
  requireAccess,
  requireWriteAccess,
  viewMessage,
  viewThread,
} from './access.js';
import { applyFeedback, type FeedbackCommand, type FeedbackServices } from './commands.js';
import { FeedbackThreadNotFoundError } from './errors.js';
import {
  pageLimit,
  readReplyPosition,
  readThreadPosition,
  writeThreadPosition,
  type FeedbackListQuery,
  type FeedbackPageQuery,
} from './pagination.js';

export type {
  FeedbackAnchor,
  FeedbackAnchorTarget,
  FeedbackMessageView,
  FeedbackOperation,
  FeedbackReceipt,
  FeedbackRejectionReason,
  FeedbackThreadStatus,
  FeedbackThreadView,
} from '../domain/index.js';
export { FeedbackAccessError, FeedbackQueryError, FeedbackThreadNotFoundError } from './errors.js';

interface FeedbackList {
  readonly threads: readonly FeedbackThreadView[];
  readonly nextCursor?: string;
  readonly canWrite: boolean;
}

interface FeedbackDetail {
  readonly thread: FeedbackThreadView;
  readonly replies: readonly FeedbackMessageView[];
  readonly nextCursor?: string;
  readonly canWrite: boolean;
}

export interface FeedbackApplication {
  listThreads(actor: FeedbackActor, boardId: string, query: FeedbackListQuery): FeedbackList;
  getThread(
    actor: FeedbackActor,
    boardId: string,
    threadId: string,
    query: FeedbackPageQuery,
  ): FeedbackDetail;
  applyFeedback(actor: FeedbackActor, command: FeedbackCommand): FeedbackReceipt;
  getReceipt(actor: FeedbackActor, boardId: string, commandId: string): FeedbackReceipt | undefined;
}

export function createFeedbackApplication(
  repository: FeedbackRepository,
  services: FeedbackServices,
): FeedbackApplication {
  return {
    listThreads: (actor, boardId, query) =>
      repository.read((reader) => {
        const access = requireAccess(reader, actor, boardId);
        const { cursor, status, authorActorId } = query;
        const limit = pageLimit(query.pageSize);
        const position = readThreadPosition(cursor);
        const rows = reader.listThreads({
          boardId,
          limit: limit + 1,
          position,
          status,
          authorActorId,
        });
        const page = rows.slice(0, limit);
        const last = page.at(-1);

        return {
          threads: page.map((thread) => viewThread(actor, access, thread)),
          nextCursor: last && rows.length > limit ? writeThreadPosition(last) : undefined,
          canWrite: permitsFeedback(access),
        };
      }),
    getThread: (actor, boardId, threadId, query) =>
      repository.read((reader) => {
        const access = requireAccess(reader, actor, boardId);
        const thread = reader.getThread(boardId, threadId);
        if (!thread) {
          throw new FeedbackThreadNotFoundError();
        }

        const limit = pageLimit(query.pageSize);
        const position = readReplyPosition(query.cursor);
        const replies = reader.listReplies(boardId, threadId, position, limit + 1);

        return {
          thread: viewThread(actor, access, thread),
          replies: replies.slice(0, limit).map((reply) => viewMessage(actor, access, reply)),
          nextCursor: replies.length > limit ? String(position + limit) : undefined,
          canWrite: permitsFeedback(access),
        };
      }),
    applyFeedback: (actor, command) => applyFeedback(repository, services, actor, command),
    getReceipt: (actor, boardId, commandId) =>
      repository.read((reader) => {
        requireWriteAccess(reader, actor, boardId);

        return reader.getReceipt(boardId, actor.id, commandId)?.receipt;
      }),
  };
}
