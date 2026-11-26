import { openSqliteDatabase } from '../../src/infrastructure/platform/index.js';
import { documentId, mainBoardId } from './whiteboard-database.js';

export function seedLargeHistoricalPayloads(path: string, changeRevision: bigint): void {
  const wideText = '界'.repeat(6 * 1024 * 1024);
  const body = {
    schemaVersion: 1,
    blocks: [{ blockId: 'paragraph-1', type: 'paragraph', content: wideText }],
  };
  const previous = JSON.stringify({ title: 'Previous document', ...body });
  const current = JSON.stringify({ title: 'Current document', ...body });
  const database = openSqliteDatabase(path);
  try {
    database.write((connection) => {
      connection
        .prepare(`
          INSERT INTO board_history_payloads
            (board_id, change_revision, object_id, payload_version, body_kind, body_json)
          SELECT board_id, ?, object_id, payload_version, body_kind, ?
          FROM object_payloads WHERE board_id = ? AND object_id = ?
        `)
        .run(changeRevision, previous, mainBoardId, documentId);
      connection
        .prepare(`
          UPDATE object_payloads SET payload_version = payload_version + 1, body_json = ?
          WHERE board_id = ? AND object_id = ?
        `)
        .run(current, mainBoardId, documentId);
    });
  } finally {
    database.close();
  }
}
