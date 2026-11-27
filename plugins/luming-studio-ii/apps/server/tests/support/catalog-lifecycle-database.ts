import { openSqliteDatabase } from '../../src/infrastructure/platform/index.js';

export const managementReceiptWriteFailure = 'Injected catalog management receipt write failure';

export function grantCatalogEditor(path: string, boardId: string, actorId: string): void {
  const database = openSqliteDatabase(path);
  try {
    database.write((connection) => {
      connection
        .prepare('INSERT INTO board_members (board_id, actor_id, can_edit) VALUES (?, ?, 1)')
        .run(boardId, actorId);
    });
  } finally {
    database.close();
  }
}

export function clearLifecycleRows(path: string, boardIds: readonly string[]): void {
  const database = openSqliteDatabase(path);
  try {
    database.write((connection) => {
      const erase = connection.prepare('DELETE FROM board_lifecycle WHERE board_id = ?');

      for (const boardId of boardIds) {
        erase.run(boardId);
      }
    });
  } finally {
    database.close();
  }
}

interface CatalogTrashTime {
  readonly boardId: string;
  readonly updatedAtMillis: number;
  readonly trashedAtMillis: number;
}

export function setCatalogTrashTimes(path: string, boards: readonly CatalogTrashTime[]): void {
  const database = openSqliteDatabase(path);
  try {
    database.write((connection) => {
      const update = connection.prepare(
        'UPDATE catalog_entries SET updated_at_millis = ? WHERE board_id = ?',
      );
      const trash = connection.prepare(
        'UPDATE board_lifecycle SET trashed_at_millis = ? WHERE board_id = ?',
      );

      for (const { boardId, updatedAtMillis, trashedAtMillis } of boards) {
        update.run(updatedAtMillis, boardId);
        trash.run(trashedAtMillis, boardId);
      }
    });
  } finally {
    database.close();
  }
}

export function rejectCatalogManagementReceiptInserts(path: string): void {
  const database = openSqliteDatabase(path);
  try {
    database.write((connection) => {
      connection.exec(
        `CREATE TRIGGER reject_catalog_management_receipt_inserts
         BEFORE INSERT ON catalog_management_receipts
         BEGIN
           SELECT RAISE(ABORT, '${managementReceiptWriteFailure}');
         END`,
      );
    });
  } finally {
    database.close();
  }
}

export function installLegacyBoardVersions(path: string, boardId: string, actorId: string): void {
  const database = openSqliteDatabase(path);
  try {
    database.write((connection) => {
      connection.exec(`
        DROP TABLE board_versions;
        CREATE TABLE board_versions (
          board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
          revision INTEGER NOT NULL CHECK (revision >= 0),
          title TEXT NOT NULL,
          actor_id TEXT,
          kind TEXT NOT NULL CHECK (kind IN ('baseline', 'geometry', 'content', 'image', 'restore')),
          saved_at_millis INTEGER CHECK (saved_at_millis >= 0),
          source_revision INTEGER CHECK (source_revision >= 0),
          changed_object_count INTEGER NOT NULL CHECK (changed_object_count >= 0),
          CHECK (kind = 'baseline' OR (actor_id IS NOT NULL AND saved_at_millis IS NOT NULL)),
          PRIMARY KEY (board_id, revision)
        ) STRICT;
      `);
      connection.prepare('UPDATE boards SET revision = 1 WHERE board_id = ?').run(boardId);
      connection
        .prepare(`
          INSERT INTO board_versions (
            board_id, revision, title, actor_id, kind, saved_at_millis, changed_object_count
          )
          SELECT board_id, 0, title, NULL, 'baseline', NULL, 0 FROM boards WHERE board_id = ?1
          UNION ALL
          SELECT board_id, 1, title, ?2, 'content', 10, 0 FROM boards WHERE board_id = ?1
        `)
        .run(boardId, actorId);
    });
  } finally {
    database.close();
  }
}

export function readLegacyBoardVersionKinds(path: string, boardId: string) {
  const database = openSqliteDatabase(path);
  try {
    return database.read((connection) =>
      connection
        .prepare('SELECT kind FROM board_versions WHERE board_id = ? ORDER BY revision DESC')
        .all(boardId)
        .map(({ kind }) => kind),
    );
  } finally {
    database.close();
  }
}
