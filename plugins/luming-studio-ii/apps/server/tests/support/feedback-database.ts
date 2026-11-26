import { openSqliteDatabase } from '../../src/infrastructure/platform/index.js';
import type { SqliteDatabase } from '../../src/infrastructure/platform/index.js';

function withDatabase<T>(path: string, work: (database: SqliteDatabase) => T): T {
  const database = openSqliteDatabase(path);
  try {
    return work(database);
  } finally {
    database.close();
  }
}

export function setFeedbackAnchorRotation(
  path: string,
  boardId: string,
  objectId: string,
  rotation: number,
): void {
  withDatabase(path, (database) =>
    database.write((connection) => {
      connection
        .prepare('UPDATE board_objects SET rotation = ? WHERE board_id = ? AND object_id = ?')
        .run(rotation, boardId, objectId);
    }),
  );
}

export function deleteFeedbackAnchorObject(path: string, boardId: string, objectId: string): void {
  withDatabase(path, (database) =>
    database.write((connection) => {
      connection
        .prepare('DELETE FROM board_objects WHERE board_id = ? AND object_id = ?')
        .run(boardId, objectId);
    }),
  );
}

export function removeFeedbackWritePermission(
  path: string,
  boardId: string,
  actorId: string,
): void {
  withDatabase(path, (database) =>
    database.write((connection) => {
      connection
        .prepare('UPDATE board_members SET can_edit = 0 WHERE board_id = ? AND actor_id = ?')
        .run(boardId, actorId);
    }),
  );
}

export function rejectFeedbackReceipts(path: string): void {
  withDatabase(path, (database) =>
    database.write((connection) => {
      connection.exec(`
        CREATE TRIGGER reject_feedback_receipts BEFORE INSERT ON feedback_command_receipts
        BEGIN SELECT RAISE(ABORT, 'Injected feedback receipt write failure'); END
      `);
    }),
  );
}

export function feedbackCounts(path: string, boardId: string) {
  return withDatabase(path, (database) =>
    database.read((connection) =>
      connection
        .prepare(`
          SELECT
            (SELECT COUNT(*) FROM feedback_threads WHERE board_id = ?) AS threads,
            (SELECT COUNT(*) FROM feedback_messages WHERE board_id = ?) AS messages,
            (SELECT COUNT(*) FROM feedback_command_receipts WHERE board_id = ?) AS receipts
        `)
        .get(boardId, boardId, boardId),
    ),
  );
}
