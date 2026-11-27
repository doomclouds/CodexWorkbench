import { openSqliteDatabase } from '../../src/infrastructure/platform/index.js';

export function interruptSuggestionAcceptance(path: string): void {
  const database = openSqliteDatabase(path);
  try {
    database.write((connection) => {
      connection.exec(`
        CREATE TRIGGER reject_test_suggestion_update BEFORE UPDATE ON board_suggestions
        BEGIN
          SELECT RAISE(ABORT, 'Injected suggestion decision failure');
        END
      `);
    });
  } finally {
    database.close();
  }
}
