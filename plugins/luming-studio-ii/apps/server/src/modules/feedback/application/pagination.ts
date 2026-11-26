import type { FeedbackThreadPosition, FeedbackThreadStatus } from '../domain/index.js';
import { FeedbackQueryError } from './errors.js';

const defaultPageSize = 20;
const maximumPageSize = 50;
const maximumReplyPosition = 4_294_967_295;
const maximumSqliteInteger = 9_223_372_036_854_775_807n;
const threadPositionPattern = /^(0|[1-9][0-9]{0,18}):([a-f0-9]{32})$/u;
const replyPositionPattern = /^(?:0|[1-9][0-9]{0,9})$/u;

export interface FeedbackPageQuery {
  readonly pageSize: number;
  readonly cursor?: string;
}

export interface FeedbackListQuery extends FeedbackPageQuery {
  readonly status?: FeedbackThreadStatus;
  readonly authorActorId?: string;
}

export function pageLimit(pageSize: number): number {
  if (!Number.isSafeInteger(pageSize) || pageSize < 0) {
    throw new FeedbackQueryError('Feedback page size is invalid.');
  }

  return Math.min(maximumPageSize, pageSize || defaultPageSize);
}

export function readThreadPosition(cursor: string | undefined): FeedbackThreadPosition | undefined {
  if (cursor === undefined) {
    return undefined;
  }

  const match = threadPositionPattern.exec(cursor);
  if (!match) {
    throw new FeedbackQueryError('Feedback thread cursor is invalid.');
  }

  const [, time, threadId] = match;
  if (!time || !threadId) {
    throw new FeedbackQueryError('Feedback thread cursor is invalid.');
  }

  const updatedAtMillis = BigInt(time);
  if (updatedAtMillis > maximumSqliteInteger) {
    throw new FeedbackQueryError('Feedback thread cursor is invalid.');
  }

  return { updatedAtMillis, threadId };
}

export function writeThreadPosition(position: FeedbackThreadPosition): string {
  return `${position.updatedAtMillis}:${position.threadId}`;
}

export function readReplyPosition(cursor: string | undefined): number {
  if (cursor === undefined) {
    return 0;
  }
  if (!replyPositionPattern.test(cursor)) {
    throw new FeedbackQueryError('Feedback reply cursor is invalid.');
  }

  const position = Number(cursor);
  if (position > maximumReplyPosition) {
    throw new FeedbackQueryError('Feedback reply cursor is invalid.');
  }

  return position;
}
