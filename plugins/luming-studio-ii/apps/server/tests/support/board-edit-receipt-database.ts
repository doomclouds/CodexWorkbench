import { createWhiteboardRepository } from '../../src/infrastructure/adapters/index.js';
import { openSqliteDatabase } from '../../src/infrastructure/platform/index.js';

export const receiptBoardId = 'receipt-board';
export const receiptDocumentId = 'receipt-document';
export const stableDocumentId = 'stable-document';
export const receiptActor = { id: 'receipt-editor' };

export function openBoardEditReceiptDatabase() {
  const database = openSqliteDatabase(':memory:');
  try {
    const repository = createWhiteboardRepository(database);
    database.write((connection) => {
      connection
        .prepare('INSERT INTO boards (board_id, title) VALUES (?, ?)')
        .run(receiptBoardId, 'Receipt board');
      connection
        .prepare('INSERT INTO board_members (board_id, actor_id, can_edit) VALUES (?, ?, 1)')
        .run(receiptBoardId, receiptActor.id);

      const insertObject = connection.prepare(`
        INSERT INTO board_objects (board_id, object_id, kind, label, layer_index, x, y, width, height)
        VALUES (?, ?, 'document', ?, ?, 0, 0, 10, 10)
      `);
      const insertPayload = connection.prepare(`
        INSERT INTO object_payloads (board_id, object_id, payload_version, body_kind, body_json)
        VALUES (?, ?, 0, 'document', ?)
      `);

      for (const [layer, id] of [receiptDocumentId, stableDocumentId].entries()) {
        insertObject.run(receiptBoardId, id, id, layer);
        insertPayload.run(
          receiptBoardId,
          id,
          JSON.stringify({ title: id, schemaVersion: 1, blocks: [] }),
        );
      }
    });

    return {
      repository,
      close: () => database.close(),
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

export function countReceiptBytes(path: string, boardId: string) {
  const database = openSqliteDatabase(path);
  try {
    return database.read((connection) =>
      connection
        .prepare(`
        SELECT count(*) AS receipt_count, sum(length(CAST(receipt_json AS BLOB))) AS receipt_bytes
        FROM board_edit_receipts WHERE board_id = ?
      `)
        .get(boardId),
    );
  } finally {
    database.close();
  }
}
