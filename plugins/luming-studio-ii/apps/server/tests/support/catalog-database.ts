import { openSqliteDatabase } from '../../src/infrastructure/platform/index.js';

export const receiptInsertFailure = 'Injected catalog receipt write failure';

export function rejectCatalogReceiptInserts(path: string) {
  const database = openSqliteDatabase(path);
  try {
    database.write((connection) => {
      connection.exec(
        `CREATE TRIGGER reject_catalog_receipt_inserts BEFORE INSERT ON catalog_create_receipts
         BEGIN
           SELECT RAISE(ABORT, '${receiptInsertFailure}');
         END`,
      );
    });
  } finally {
    database.close();
  }
}

export function catalogRowCounts(path: string) {
  const database = openSqliteDatabase(path);
  try {
    return database.read((connection) =>
      connection
        .prepare(
          `SELECT (SELECT count(*) FROM boards) AS boards,
                  (SELECT count(*) FROM board_members) AS members,
                  (SELECT count(*) FROM catalog_entries) AS entries,
                  (SELECT count(*) FROM catalog_create_receipts) AS receipts`,
        )
        .get(),
    );
  } finally {
    database.close();
  }
}

export function seedPreviewScene(path: string, boardId: string, amount: number): void {
  const database = openSqliteDatabase(path);
  try {
    database.write((connection) => {
      const insert = connection.prepare(`
        INSERT INTO board_objects
          (board_id, object_id, kind, label, layer_index, x, y, width, height, detail_json)
        VALUES (?, ?, 'shape', ?, ?, ?, ?, 18, 18, '{"kind":"shape","outline":"ellipse"}')
      `);

      for (let index = 0; index < amount; index++) {
        insert.run(
          boardId,
          'preview-shape-' + index,
          'Shape ' + index,
          index,
          (index % 16) * 24,
          Math.floor(index / 16) * 24,
        );
      }

      connection.prepare('UPDATE boards SET revision = 1 WHERE board_id = ?').run(boardId);
    });
  } finally {
    database.close();
  }
}
