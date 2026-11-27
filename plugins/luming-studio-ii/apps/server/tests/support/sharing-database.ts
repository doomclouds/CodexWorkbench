import { openSqliteDatabase } from '../../src/infrastructure/platform/index.js';

export function storedSharingCredentials(path: string) {
  const database = openSqliteDatabase(path);
  try {
    return database.read((connection) => ({
      browsers: connection.prepare('SELECT token_hash FROM sharing_browser_sessions').all(),
      invitations: connection
        .prepare('SELECT role, seed FROM board_sharing_invites ORDER BY role')
        .all(),
    }));
  } finally {
    database.close();
  }
}

export function rejectSharingReceipts(path: string) {
  const database = openSqliteDatabase(path);
  try {
    database.write((connection) => {
      connection.exec(`
        CREATE TRIGGER reject_sharing_receipts BEFORE INSERT ON board_sharing_receipts
        BEGIN
          SELECT RAISE(ABORT, 'Injected sharing receipt write failure');
        END
      `);
    });
  } finally {
    database.close();
  }
}
