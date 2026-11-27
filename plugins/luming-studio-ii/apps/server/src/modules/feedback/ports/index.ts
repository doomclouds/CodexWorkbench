import type {
  FeedbackAnchorObject,
  FeedbackBoardAccess,
  FeedbackContentSource,
  FeedbackContentTarget,
  FeedbackMessage,
  FeedbackStoredReceipt,
  FeedbackThread,
  FeedbackThreadLookup,
} from '../domain/index.js';

export type {
  FeedbackAnchor,
  FeedbackAnchorObject,
  FeedbackBoardAccess,
  FeedbackContentSource,
  FeedbackContentTarget,
  FeedbackContentUnit,
  FeedbackFrozenObject,
  FeedbackMessage,
  FeedbackOutcome,
  FeedbackPoint,
  FeedbackReceipt,
  FeedbackRejectionReason,
  FeedbackStoredReceipt,
  FeedbackThread,
  FeedbackThreadLookup,
  FeedbackThreadStatus,
} from '../domain/index.js';

export interface FeedbackReader {
  getAccess(boardId: string, actorId: string): FeedbackBoardAccess | undefined;
  getBoardRevision(boardId: string): bigint;
  getObject(boardId: string, objectId: string): FeedbackAnchorObject | undefined;
  getContentSource(
    boardId: string,
    target: FeedbackContentTarget,
  ): FeedbackContentSource | undefined;
  listThreads(lookup: FeedbackThreadLookup): readonly FeedbackThread[];
  getThread(boardId: string, threadId: string): FeedbackThread | undefined;
  listReplies(
    boardId: string,
    threadId: string,
    afterPosition: number,
    limit: number,
  ): readonly FeedbackMessage[];
  getMessage(boardId: string, threadId: string, messageId: string): FeedbackMessage | undefined;
  getReceipt(
    boardId: string,
    actorId: string,
    commandId: string,
  ): FeedbackStoredReceipt | undefined;
}

export interface FeedbackWriter extends FeedbackReader {
  allocateId(): string;
  insertThread(boardId: string, thread: FeedbackThread): void;
  updateThread(boardId: string, thread: FeedbackThread): void;
  insertReply(boardId: string, threadId: string, position: number, message: FeedbackMessage): void;
  updateMessage(boardId: string, threadId: string, message: FeedbackMessage): void;
  deleteThread(boardId: string, threadId: string): void;
  saveReceipt(actorId: string, stored: FeedbackStoredReceipt): void;
}

export interface FeedbackRepository {
  read<T>(work: (reader: FeedbackReader) => T): T;
  write<T>(work: (writer: FeedbackWriter) => T): T;
}
