import { Buffer } from 'node:buffer';
import { openSqliteDatabase } from '../../src/infrastructure/platform/index.js';
import { mainBoardId } from './whiteboard-database.js';

export const tableId = 'native-table';
export const embedId = 'native-html';
export const chartId = 'native-chart';
export const stickerId = 'native-sticker';
export const legacyStickerId = 'native-symbol';
export const imageId = 'native-image';
export const lockedImageId = 'native-locked-image';
export const metadataConnectorId = 'metadata-only-connector';
export const metadataConnectorLabel = 'Imported connector label';
export const assetPath = '/studio-archive-assets/' + mainBoardId + '/crop-asset';

export function seedMetadataConnector(path: string) {
  const database = openSqliteDatabase(path);
  const detail = {
    kind: 'connector',
    start: { point: { x: 12, y: 28 } },
    end: { point: { x: 492, y: 28 } },
    bends: [],
  };

  try {
    database.write((connection) => {
      connection
        .prepare(`
          INSERT INTO board_objects (board_id, object_id, kind, label, layer_index, x, y, width, height, detail_json)
          VALUES (?, ?, 'connector', ?, 3, 12, 28, 480, 1, ?)
        `)
        .run(mainBoardId, metadataConnectorId, metadataConnectorLabel, JSON.stringify(detail));
    });
  } finally {
    database.close();
  }
}

export function seedNativeObjects(
  path: string,
  tableLocked: boolean,
  embedKind: 'html' | 'diagram' = 'html',
) {
  const database = openSqliteDatabase(path);
  try {
    database.write((connection) => {
      const insertObject = connection.prepare(`
        INSERT INTO board_objects (board_id, object_id, kind, label, layer_index, x, y, width, height, locked, parent_id)
        VALUES (?, ?, ?, ?, ?, 12, 28, 480, 120, ?, ?)
      `);
      const objects = [
        [tableId, 'table', 'Tasks', 3, tableLocked ? 1 : 0, null],
        [embedId, embedKind, 'Demo', 4, 0, null],
        [chartId, 'chart', 'Chart', 5, 0, null],
        [stickerId, 'sticker', '爱心', 6, 0, null],
        [imageId, 'image', 'Sample', 7, 0, null],
        ['native-lock', 'section', 'Hold', 8, 1, null],
        [lockedImageId, 'image', 'Locked sample', 9, 0, 'native-lock'],
        [legacyStickerId, 'sticker', '★', 10, 1, null],
      ] as const;

      for (const fields of objects) {
        insertObject.run(mainBoardId, ...fields);
      }

      const insertPayload = connection.prepare(`
        INSERT INTO object_payloads (board_id, object_id, payload_version, body_kind, body_json)
        VALUES (?, ?, 0, ?, ?)
      `);
      insertPayload.run(
        mainBoardId,
        tableId,
        'table',
        JSON.stringify({
          text: 'Tasks',
          grid: {
            rows: [{ cells: [{ text: 'Open' }, { nullValue: 'NULL_VALUE' }] }],
            rowIds: ['row-1'],
            columnIds: ['col-1', 'col-2'],
          },
        }),
      );
      const embed = { title: 'Demo', html: '<p>Original</p>', state: { step: 1 } };
      insertPayload.run(mainBoardId, embedId, 'embed', JSON.stringify(embed));
      insertPayload.run(mainBoardId, chartId, 'embed', JSON.stringify(embed));
      insertPayload.run(mainBoardId, stickerId, 'sticker', JSON.stringify({ stickerId: 'heart' }));
      insertPayload.run(mainBoardId, legacyStickerId, 'sticker', JSON.stringify({ fallback: '★' }));

      const image = { src: assetPath, href: 'https://example.test/gallery' };
      insertPayload.run(mainBoardId, imageId, 'image', JSON.stringify(image));
      insertPayload.run(mainBoardId, lockedImageId, 'image', JSON.stringify(image));

      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j/j8AAAAASUVORK5CYII=',
        'base64',
      );
      connection
        .prepare(`
        INSERT INTO board_archive_assets (board_id, asset_id, mime_type, bytes)
        VALUES (?, ?, 'image/png', ?)
      `)
        .run(mainBoardId, 'crop-asset', png);
    });
  } finally {
    database.close();
  }
}
