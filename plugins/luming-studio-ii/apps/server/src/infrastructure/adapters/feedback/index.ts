import type {
  FeedbackAnchorObject,
  FeedbackReader,
  FeedbackRepository,
} from '../../../modules/feedback/ports/index.js';
import type { SqliteConnection, SqliteDatabase } from '../../platform/index.js';
import { readBoardAccess } from '../authorization/index.js';
import { readContentSource } from './content-source.js';
import { getMessage, insertMessage, listReplies, updateMessage } from './messages.js';
import { getReceipt, saveReceipt } from './receipts.js';
import { feedbackSchema } from './schema.js';
import { readFinite, readText, readUnsigned } from './stored-values.js';
import { deleteThread, getThread, insertThread, listThreads, updateThread } from './threads.js';

function getBoardRevision(connection: SqliteConnection, boardId: string): bigint {
  const statement = connection.prepare('SELECT revision FROM boards WHERE board_id = ?');
  statement.setReadBigInts(true);

  return readUnsigned(statement.get(boardId)?.revision, 'revision');
}

function getObject(
  connection: SqliteConnection,
  boardId: string,
  objectId: string,
): FeedbackAnchorObject | undefined {
  const statement = connection.prepare(`
    SELECT o.kind, o.label, o.x, o.y, o.width, o.height, o.rotation, o.geometry_version,
           p.payload_version
    FROM board_objects AS o
    LEFT JOIN object_payloads AS p ON p.board_id = o.board_id AND p.object_id = o.object_id
    WHERE o.board_id = ? AND o.object_id = ?
  `);
  statement.setReadBigInts(true);
  const row = statement.get(boardId, objectId);
  if (!row) {
    return undefined;
  }

  return {
    objectId,
    kind: readText(row.kind, 'kind'),
    label: readText(row.label, 'label'),
    x: readFinite(row.x, 'x'),
    y: readFinite(row.y, 'y'),
    width: readFinite(row.width, 'width'),
    height: readFinite(row.height, 'height'),
    rotation: readFinite(row.rotation, 'rotation'),
    geometryVersion: readUnsigned(row.geometry_version, 'geometry_version'),
    payloadVersion:
      row.payload_version === null
        ? undefined
        : readUnsigned(row.payload_version, 'payload_version'),
  };
}

function allocateId(connection: SqliteConnection): string {
  const row = connection.prepare('SELECT lower(hex(randomblob(16))) AS id').get();

  return readText(row?.id, 'id');
}

function createReader(connection: SqliteConnection): FeedbackReader {
  return {
    getAccess: (boardId, actorId) => readBoardAccess(connection, boardId, actorId),
    getBoardRevision: (boardId) => getBoardRevision(connection, boardId),
    getObject: (boardId, objectId) => getObject(connection, boardId, objectId),
    getContentSource: (boardId, target) => readContentSource(connection, boardId, target),
    listThreads: (lookup) => listThreads(connection, lookup),
    getThread: (boardId, threadId) => getThread(connection, boardId, threadId),
    listReplies: (boardId, threadId, afterPosition, limit) =>
      listReplies(connection, boardId, threadId, afterPosition, limit),
    getMessage: (boardId, threadId, messageId) =>
      getMessage(connection, boardId, threadId, messageId),
    getReceipt: (boardId, actorId, commandId) =>
      getReceipt(connection, boardId, actorId, commandId),
  };
}

export function createFeedbackRepository(database: SqliteDatabase): FeedbackRepository {
  database.write((connection) => {
    connection.exec(feedbackSchema);
    const threadColumns = connection.prepare('PRAGMA table_info(feedback_threads)').all();
    for (const column of ['selection_json', 'attachment_json']) {
      if (!threadColumns.some(({ name }) => name === column)) {
        connection.exec(
          'ALTER TABLE feedback_threads ADD COLUMN ' +
            column +
            ' TEXT CHECK (json_valid(' +
            column +
            '))',
        );
      }
    }
    const columns = connection.prepare('PRAGMA table_info(feedback_messages)').all();
    if (!columns.some(({ name }) => name === 'author_name')) {
      connection.exec('ALTER TABLE feedback_messages ADD COLUMN author_name TEXT');
    }
  });

  return {
    read: (work) => database.read((connection) => work(createReader(connection))),
    write: (work) =>
      database.write((connection) =>
        work({
          ...createReader(connection),
          allocateId: () => allocateId(connection),
          insertThread: (boardId, thread) => insertThread(connection, boardId, thread),
          updateThread: (boardId, thread) => updateThread(connection, boardId, thread),
          insertReply: (boardId, threadId, position, message) =>
            insertMessage(connection, boardId, threadId, position, message),
          updateMessage: (boardId, threadId, message) =>
            updateMessage(connection, boardId, threadId, message),
          deleteThread: (boardId, threadId) => deleteThread(connection, boardId, threadId),
          saveReceipt: (actorId, stored) => saveReceipt(connection, actorId, stored),
        }),
      ),
  };
}
