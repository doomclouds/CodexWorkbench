import type {
  FeedbackAnchor,
  FeedbackFrozenObject,
  FeedbackThread,
  FeedbackThreadLookup,
  FeedbackThreadStatus,
} from '../../../modules/feedback/ports/index.js';
import type { SqliteConnection, SqliteRow } from '../../platform/index.js';
import { decodeFeedbackContentUnit, encodeFeedbackContentUnit } from './content-source.js';
import { insertMessage, messageColumns, readMessage } from './messages.js';
import { readFinite, readText, readUnsigned } from './stored-values.js';

const selectThreads = `
  SELECT t.*, ${messageColumns}, live.object_id AS live_object_id,
         content.payload_version AS content_payload_version,
         content.unit_json AS content_unit_json, content.frozen_excerpt AS frozen_excerpt
  FROM feedback_threads AS t
  JOIN feedback_messages AS m
    ON m.board_id = t.board_id AND m.thread_id = t.thread_id AND m.position = 0
  LEFT JOIN board_objects AS live ON live.board_id = t.board_id AND live.object_id = t.object_id
  LEFT JOIN feedback_content_anchors AS content
    ON content.board_id = t.board_id AND content.thread_id = t.thread_id
`;

function readStatus(value: unknown): FeedbackThreadStatus {
  if (value === 'open' || value === 'resolved') {
    return value;
  }

  throw new Error('Invalid stored feedback status.');
}

function readFrozenObject(row: SqliteRow): FeedbackFrozenObject {
  return {
    kind: readText(row.object_kind, 'object_kind'),
    label: readText(row.object_label, 'object_label'),
    x: readFinite(row.object_x, 'object_x'),
    y: readFinite(row.object_y, 'object_y'),
    width: readFinite(row.object_width, 'object_width'),
    height: readFinite(row.object_height, 'object_height'),
    rotation: readFinite(row.object_rotation, 'object_rotation'),
  };
}

function readAnchor(row: SqliteRow): FeedbackAnchor {
  const sourceBoardRevision = readUnsigned(row.source_board_revision, 'source_board_revision');
  const frozenPoint = {
    x: readFinite(row.frozen_x, 'frozen_x'),
    y: readFinite(row.frozen_y, 'frozen_y'),
  };

  if (row.object_id === null) {
    return {
      target: { kind: 'board', point: frozenPoint },
      sourceBoardRevision,
      frozenPoint,
      targetMissing: false,
    };
  }

  const point = {
    objectId: readText(row.object_id, 'object_id'),
    u: readFinite(row.object_u, 'object_u'),
    v: readFinite(row.object_v, 'object_v'),
    geometryVersion: readUnsigned(row.object_geometry_version, 'object_geometry_version'),
  };
  const target: FeedbackAnchor['target'] =
    row.content_payload_version === null
      ? { ...point, kind: 'object' }
      : {
          ...point,
          kind: 'content',
          payloadVersion: readUnsigned(row.content_payload_version, 'content_payload_version'),
          content: decodeFeedbackContentUnit(row.content_unit_json),
        };

  return {
    target,
    sourceBoardRevision,
    frozenPoint,
    frozenObject: readFrozenObject(row),
    frozenExcerpt:
      row.frozen_excerpt === null ? undefined : readText(row.frozen_excerpt, 'frozen_excerpt'),
    targetMissing: row.live_object_id === null,
  };
}

function readThread(row: SqliteRow): FeedbackThread {
  return {
    threadId: readText(row.thread_id, 'thread_id'),
    status: readStatus(row.status),
    anchor: readAnchor(row),
    first: readMessage(row),
    version: readUnsigned(row.version, 'version'),
    updatedAtMillis: readUnsigned(row.updated_at_millis, 'updated_at_millis'),
    replyCount: Number(readUnsigned(row.reply_count, 'reply_count')),
  };
}

export function getThread(
  connection: SqliteConnection,
  boardId: string,
  threadId: string,
): FeedbackThread | undefined {
  const statement = connection.prepare(`
    ${selectThreads}
    WHERE t.board_id = ? AND t.thread_id = ?
  `);
  statement.setReadBigInts(true);
  const row = statement.get(boardId, threadId);

  return row && readThread(row);
}

export function listThreads(
  connection: SqliteConnection,
  lookup: FeedbackThreadLookup,
): readonly FeedbackThread[] {
  const { boardId, limit, position, status, authorActorId } = lookup;
  const conditions = ['t.board_id = ?'];
  const args: (string | bigint | number)[] = [boardId];
  if (status) {
    conditions.push('t.status = ?');
    args.push(status);
  }
  if (authorActorId) {
    conditions.push('m.author_actor_id = ?');
    args.push(authorActorId);
  }
  if (position) {
    conditions.push('(t.updated_at_millis, t.thread_id) < (?, ?)');
    args.push(position.updatedAtMillis, position.threadId);
  }

  const statement = connection.prepare(`
    ${selectThreads}
    WHERE ${conditions.join(' AND ')}
    ORDER BY t.updated_at_millis DESC, t.thread_id DESC
    LIMIT ?
  `);
  statement.setReadBigInts(true);

  return statement.all(...args, limit).map(readThread);
}

function objectFields(anchor: FeedbackAnchor): readonly (string | number | bigint | null)[] {
  const { target, frozenObject } = anchor;
  if (target.kind === 'board') {
    return [null, null, null, null, null, null, null, null, null, null, null];
  }
  if (!frozenObject) {
    throw new Error('Object feedback requires frozen source geometry.');
  }

  const { kind, label, x, y, width, height, rotation } = frozenObject;

  return [
    target.objectId,
    target.u,
    target.v,
    target.geometryVersion,
    kind,
    label,
    x,
    y,
    width,
    height,
    rotation,
  ];
}

export function insertThread(
  connection: SqliteConnection,
  boardId: string,
  thread: FeedbackThread,
): void {
  const { threadId, status, anchor, updatedAtMillis, version, replyCount } = thread;
  const { frozenPoint, sourceBoardRevision } = anchor;
  connection
    .prepare(`
      INSERT INTO feedback_threads (
        board_id, thread_id, status, source_board_revision, frozen_x, frozen_y,
        object_id, object_u, object_v, object_geometry_version,
        object_kind, object_label, object_x, object_y, object_width, object_height, object_rotation,
        version, updated_at_millis, reply_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      boardId,
      threadId,
      status,
      sourceBoardRevision,
      frozenPoint.x,
      frozenPoint.y,
      ...objectFields(anchor),
      version,
      updatedAtMillis,
      replyCount,
    );
  insertMessage(connection, boardId, threadId, 0, thread.first);
  if (anchor.target.kind === 'content') {
    connection
      .prepare(`
      INSERT INTO feedback_content_anchors (board_id, thread_id, payload_version, unit_json, frozen_excerpt)
      VALUES (?, ?, ?, ?, ?)
    `)
      .run(
        boardId,
        threadId,
        anchor.target.payloadVersion,
        encodeFeedbackContentUnit(anchor.target.content),
        anchor.frozenExcerpt ?? null,
      );
  }
}

export function updateThread(
  connection: SqliteConnection,
  boardId: string,
  thread: FeedbackThread,
): void {
  const { threadId, status, updatedAtMillis, version, replyCount } = thread;
  connection
    .prepare(`
      UPDATE feedback_threads
      SET status = ?, version = ?, updated_at_millis = ?, reply_count = ?
      WHERE board_id = ? AND thread_id = ?
    `)
    .run(status, version, updatedAtMillis, replyCount, boardId, threadId);
}

export function deleteThread(
  connection: SqliteConnection,
  boardId: string,
  threadId: string,
): void {
  connection
    .prepare('DELETE FROM feedback_threads WHERE board_id = ? AND thread_id = ?')
    .run(boardId, threadId);
}
