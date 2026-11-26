import { Buffer } from 'node:buffer';
import { openSqliteDatabase } from '../../src/infrastructure/platform/index.js';
import { mainBoardId } from './whiteboard-database.js';

export const todoObjectId = 'content-todo';
export const noteObjectId = 'content-note';
export const imageAssetId = 'content-image';

export function seedEditableContent(databasePath: string) {
  const database = openSqliteDatabase(databasePath);
  try {
    database.write((connection) => {
      const addObject = connection.prepare(`
        INSERT INTO board_objects (board_id, object_id, kind, label, layer_index, x, y, width, height, locked)
        VALUES (?, ?, ?, ?, ?, 12, 28, 200, 120, ?)
      `);
      addObject.run(mainBoardId, todoObjectId, 'todo', 'Tasks', 3, 0);
      addObject.run(mainBoardId, noteObjectId, 'note', 'Pinned note', 4, 1);

      const addPayload = connection.prepare(`
        INSERT INTO object_payloads (board_id, object_id, payload_version, body_kind, body_json)
        VALUES (?, ?, 0, ?, ?)
      `);
      addPayload.run(
        mainBoardId,
        todoObjectId,
        'todo',
        JSON.stringify({
          title: 'Tasks',
          items: [{ itemId: 'initial-row', text: 'Inspect design', checked: true }],
        }),
      );
      addPayload.run(
        mainBoardId,
        noteObjectId,
        'text',
        JSON.stringify({
          text: 'Pinned note',
          color: '#2d3142',
          fontSize: 24,
          align: 'TEXT_ALIGNMENT_CENTER',
        }),
      );

      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j/j8AAAAASUVORK5CYII=',
        'base64',
      );
      connection
        .prepare(`
          INSERT INTO board_archive_assets (board_id, asset_id, mime_type, bytes) VALUES (?, ?, ?, ?)
        `)
        .run(mainBoardId, imageAssetId, 'image/png', png);
    });
  } finally {
    database.close();
  }
}
