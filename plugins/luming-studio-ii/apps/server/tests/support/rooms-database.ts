import { openSqliteDatabase } from '../../src/infrastructure/platform/index.js';
import { mainBoardId } from './whiteboard-database.js';

export function makeRoomMemberReadOnly(databasePath: string, actorId: string): void {
  const database = openSqliteDatabase(databasePath);
  try {
    database.write((connection) => {
      connection
        .prepare('UPDATE board_members SET can_edit = 0 WHERE board_id = ? AND actor_id = ?')
        .run(mainBoardId, actorId);
    });
  } finally {
    database.close();
  }
}

export function rejectRoomTimerReceipts(databasePath: string): void {
  const database = openSqliteDatabase(databasePath);
  try {
    database.write((connection) => {
      connection.exec(`
        CREATE TRIGGER reject_room_timer_receipt BEFORE INSERT ON board_room_timer_receipts
        BEGIN
          SELECT RAISE(ABORT, 'Injected timer receipt write failure');
        END
      `);
    });
  } finally {
    database.close();
  }
}
