import assert from 'node:assert/strict';
import { openSqliteDatabase } from '../../src/infrastructure/platform/index.js';
import { mainBoardId, shapeId } from './whiteboard-database.js';

interface RankFixture {
  readonly objectId: string;
  readonly rank: bigint;
}

export function seedLayerScale(path: string, total: number): void {
  const database = openSqliteDatabase(path);
  try {
    database.write((connection) => {
      const insert = connection.prepare(`
        INSERT INTO board_objects (board_id, object_id, kind, label, layer_index, x, y, width, height)
        VALUES (?, ?, 'shape', 'Layer fixture', ?, 0, 0, 100, 100)
      `);

      for (let layer = 3; layer < total; layer += 1) {
        insert.run(mainBoardId, 'layer-' + layer, layer);
      }
    });
  } finally {
    database.close();
  }
}

export function readLayerScale(path: string) {
  const database = openSqliteDatabase(path);
  try {
    return database.read((connection) => {
      const order = connection.prepare(`
        SELECT object_id, layer_index FROM board_objects
        WHERE board_id = ? ORDER BY layer_index, object_id
      `);
      order.setReadBigInts(true);
      const ranks = order.all(mainBoardId).map(({ object_id, layer_index }) => {
        assert.equal(typeof object_id, 'string');
        assert.equal(typeof layer_index, 'bigint');

        return { objectId: object_id, rank: layer_index };
      });
      const counts = connection
        .prepare(`
        SELECT
          (SELECT count(*) FROM board_history_objects WHERE board_id = ?) AS historyObjects,
          (SELECT sum(length(CAST(receipt_json AS BLOB))) FROM board_edit_receipts WHERE board_id = ?) AS receiptBytes
      `)
        .get(mainBoardId, mainBoardId);
      assert.ok(counts);

      return { ranks, counts };
    });
  } finally {
    database.close();
  }
}

export function setGeometryRanks(path: string, ranks: readonly RankFixture[]): void {
  const database = openSqliteDatabase(path);
  try {
    database.write((connection) => {
      const update = connection.prepare(
        'UPDATE board_objects SET layer_index = ? WHERE board_id = ? AND object_id = ?',
      );

      for (const { objectId, rank } of ranks) {
        update.run(rank, mainBoardId, objectId);
      }
    });
  } finally {
    database.close();
  }
}

export function seedOversizedCopyBody(path: string): void {
  const database = openSqliteDatabase(path);
  try {
    database.write((connection) => {
      const largeTextBytes = 32 * 1024 * 1024;
      const insert = connection.prepare(`
        INSERT INTO object_payloads (board_id, object_id, payload_version, body_kind, body_json)
        VALUES (?, ?, 0, 'text', json_quote(printf('%.*c', ?, 'x')))
      `);
      insert.run(mainBoardId, shapeId, largeTextBytes);
    });
  } finally {
    database.close();
  }
}
