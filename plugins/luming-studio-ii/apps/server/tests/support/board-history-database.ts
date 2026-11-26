import { createWhiteboardRepository } from '../../src/infrastructure/adapters/index.js';
import { openSqliteDatabase } from '../../src/infrastructure/platform/index.js';

export function openHistoryStorage(path: string) {
  const database = openSqliteDatabase(path);
  try {
    const repository = createWhiteboardRepository(database);

    return {
      repository,
      close: () => database.close(),
      counts: (boardId: string) =>
        database.read((connection) =>
          connection
            .prepare(`
              SELECT (SELECT count(*) FROM board_versions WHERE board_id = ?) AS versions,
                (SELECT count(*) FROM board_history_objects WHERE board_id = ?) AS objects,
                (SELECT count(*) FROM board_history_payloads WHERE board_id = ?) AS payloads
            `)
            .get(boardId, boardId, boardId),
        ),
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
