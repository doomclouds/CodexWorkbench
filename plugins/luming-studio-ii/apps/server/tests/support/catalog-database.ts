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
