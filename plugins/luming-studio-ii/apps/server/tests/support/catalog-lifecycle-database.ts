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
