import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import type { DescMessage, DescMethodUnary, MessageInitShape } from '@bufbuild/protobuf';
import {
  FeedbackService,
  FeedbackThreadStatus,
} from '@codexworkbench/luming-studio-ii-contracts/feedback/service';
import type { BoardFeedbackService, FeedbackPost } from './contracts.js';
import { readFeedbackMessage, readFeedbackReceipt, readFeedbackThread } from './decode.js';
import { encodeFeedbackCommand } from './encode.js';

export type {
  BoardFeedbackService,
  FeedbackAnchor,
  FeedbackCommand,
  FeedbackContentTarget,
  FeedbackContentUnit,
  FeedbackListRequest,
  FeedbackMessage,
  FeedbackObjectTarget,
  FeedbackOperation,
  FeedbackPage,
  FeedbackPoint,
  FeedbackPost,
  FeedbackReceipt,
  FeedbackRejection,
  FeedbackStatus,
  FeedbackTarget,
  FeedbackThread,
  FeedbackThreadPage,
  FeedbackThreadRequest,
  FrozenFeedbackObject,
} from './contracts.js';

const threadStatus = {
  open: FeedbackThreadStatus.OPEN,
  resolved: FeedbackThreadStatus.RESOLVED,
};

async function request<Input extends DescMessage, Output extends DescMessage>(
  post: FeedbackPost,
  method: DescMethodUnary<Input, Output>,
  input: MessageInitShape<Input>,
  signal?: AbortSignal,
) {
  const path = '/' + method.parent.typeName + '/' + method.name;
  const body = toBinary(method.input, create(method.input, input));
  const response = await post(path, body, signal);

  return fromBinary(method.output, response, { readUnknownFields: false });
}

export function createBoardFeedbackService(post: FeedbackPost): BoardFeedbackService {
  const { listThreads, getThread, applyFeedback, getFeedbackReceipt } = FeedbackService.method;

  return {
    async listThreads({ boardId, pageSize, cursor, status, authorId, authoredByViewer }, signal) {
      const response = await request(
        post,
        listThreads,
        {
          boardId,
          pageSize,
          cursor,
          status: status ? threadStatus[status] : undefined,
          authorActorId: authorId,
          authoredByViewer,
        },
        signal,
      );

      return {
        items: response.threads.map(readFeedbackThread),
        nextCursor: response.nextCursor,
        canWrite: response.canWrite,
      };
    },
    async getThread(query, signal) {
      const response = await request(post, getThread, query, signal);
      if (response.thread?.threadId !== query.threadId) {
        throw new Error('备注服务返回了不同的讨论。');
      }

      return {
        thread: readFeedbackThread(response.thread),
        items: response.replies.map(readFeedbackMessage),
        nextCursor: response.nextCursor,
        canWrite: response.canWrite,
      };
    },
    async apply(command, signal) {
      const response = await request(post, applyFeedback, encodeFeedbackCommand(command), signal);

      return readFeedbackReceipt(response.receipt, command.boardId, command.commandId);
    },
    async getReceipt(boardId, commandId, signal) {
      const { result } = await request(post, getFeedbackReceipt, { boardId, commandId }, signal);
      if (result.case === 'receipt') {
        return readFeedbackReceipt(result.value, boardId, commandId);
      }
      if (result.case === 'notRecorded' && result.value.commandId === commandId) {
        return undefined;
      }

      throw new Error('备注回执查询未返回匹配的结果。');
    },
  };
}
