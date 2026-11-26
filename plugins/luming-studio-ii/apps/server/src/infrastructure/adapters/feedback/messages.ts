import type { FeedbackMessage } from '../../../modules/feedback/ports/index.js';
import type { SqliteConnection, SqliteRow } from '../../platform/index.js';
import { readText, readUnsigned } from './stored-values.js';

export const messageColumns = `
  m.message_id,
  m.author_actor_id,
  m.text,
  m.created_at_millis,
  m.updated_at_millis AS message_updated_at_millis,
  m.version AS message_version
`;

export function readMessage(row: SqliteRow): FeedbackMessage {
  return {
    messageId: readText(row.message_id, 'message_id'),
    authorActorId: readText(row.author_actor_id, 'author_actor_id'),
    text: readText(row.text, 'text'),
    createdAtMillis: readUnsigned(row.created_at_millis, 'created_at_millis'),
    updatedAtMillis: readUnsigned(row.message_updated_at_millis, 'message_updated_at_millis'),
    version: readUnsigned(row.message_version, 'message_version'),
  };
}

export function getMessage(
  connection: SqliteConnection,
  boardId: string,
  threadId: string,
  messageId: string,
): FeedbackMessage | undefined {
  const statement = connection.prepare(`
    SELECT ${messageColumns}
    FROM feedback_messages AS m
    WHERE m.board_id = ? AND m.thread_id = ? AND m.message_id = ?
  `);
  statement.setReadBigInts(true);
  const row = statement.get(boardId, threadId, messageId);

  return row && readMessage(row);
}

export function listReplies(
  connection: SqliteConnection,
  boardId: string,
  threadId: string,
  afterPosition: number,
  limit: number,
): readonly FeedbackMessage[] {
  const statement = connection.prepare(`
    SELECT ${messageColumns}
    FROM feedback_messages AS m
    WHERE m.board_id = ? AND m.thread_id = ? AND m.position > ?
    ORDER BY m.position ASC
    LIMIT ?
  `);
  statement.setReadBigInts(true);

  return statement.all(boardId, threadId, afterPosition, limit).map(readMessage);
}

export function insertMessage(
  connection: SqliteConnection,
  boardId: string,
  threadId: string,
  position: number,
  message: FeedbackMessage,
): void {
  const { messageId, authorActorId, text, createdAtMillis, updatedAtMillis, version } = message;
  connection
    .prepare(`
      INSERT INTO feedback_messages (
        board_id, thread_id, message_id, author_actor_id, text,
        created_at_millis, updated_at_millis, version, position
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      boardId,
      threadId,
      messageId,
      authorActorId,
      text,
      createdAtMillis,
      updatedAtMillis,
      version,
      position,
    );
}

export function updateMessage(
  connection: SqliteConnection,
  boardId: string,
  threadId: string,
  message: FeedbackMessage,
): void {
  const { messageId, text, updatedAtMillis, version } = message;
  connection
    .prepare(`
      UPDATE feedback_messages
      SET text = ?, updated_at_millis = ?, version = ?
      WHERE board_id = ? AND thread_id = ? AND message_id = ?
    `)
    .run(text, updatedAtMillis, version, boardId, threadId, messageId);
}
