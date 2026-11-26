import { openSqliteDatabase } from '../../src/infrastructure/platform/index.js';

export function rejectImageReceipt(path: string): void {
  const database = openSqliteDatabase(path);
  try {
    database.write((connection) => {
      connection.exec(`
        CREATE TRIGGER reject_test_image_receipt BEFORE INSERT ON board_edit_receipts
        BEGIN
          SELECT RAISE(ABORT, 'Injected image receipt write failure');
        END
      `);
    });
  } finally {
    database.close();
  }
}
