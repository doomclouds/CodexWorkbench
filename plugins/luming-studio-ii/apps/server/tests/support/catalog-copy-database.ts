import {
  openSqliteDatabase,
  type SqliteDatabase,
} from '../../src/infrastructure/platform/index.js';

export const htmlObjectId = 'duplicate-embed';
export const documentObjectId = 'release-document';
export const todoObjectId = 'release-checklist';
export const imageObjectId = 'release-image';
export const foreignSource = 'foreign-board';

export function externalAssetLinks(boardId: string) {
  const localLookingPath = `/studio-archive-assets/${boardId}/missing-in-example`;

  return {
    query: `https://example.test/?next=${localLookingPath}`,
    fragment: `https://example.test/#${localLookingPath}`,
  };
}

export function mixedCopyMarkup(assetPath: string, boardId: string): string {
  const { query, fragment } = externalAssetLinks(boardId);

  return [
    `<img src=${assetPath}>`,
    `<a href="${query}">Query</a><a href='${fragment}'>Fragment</a>`,
    `<div style="background-image: url('${assetPath}')"></div>`,
    `<style>.external{background-image:url("${query}")}.local{background-image:url(${assetPath})}</style>`,
    `<script>const local = '${assetPath}'; const external = "${fragment}";</script>`,
  ].join('');
}

function withDatabase<T>(path: string, work: (database: SqliteDatabase) => T): T {
  const database = openSqliteDatabase(path);
  try {
    return work(database);
  } finally {
    database.close();
  }
}

export function seedCopyReferences(path: string, boardId: string, assetPath: string): void {
  withDatabase(path, (database) =>
    database.write((connection) => {
      const sourceRef = {
        boardId,
        objectId: documentObjectId,
        blockId: 'copy-image',
        version: '6',
      };
      const imageBlock = {
        blockId: 'copy-image',
        type: 'image',
        props: { url: assetPath },
        content: `Open ${assetPath} or /assets/docs/manual. External ${externalAssetLinks(boardId).query}.`,
      };
      connection
        .prepare(`
          UPDATE object_payloads
          SET body_json = json_insert(body_json, '$.blocks[#]', json(?)), payload_version = 6
          WHERE board_id = ? AND object_id = ?
        `)
        .run(JSON.stringify(imageBlock), boardId, documentObjectId);
      const rows = [
        { itemId: 'local-source', checked: false, text: 'Local source', sourceRef },
        {
          itemId: 'foreign-source',
          checked: false,
          text: 'Foreign source',
          sourceRef: { ...sourceRef, boardId: foreignSource },
        },
      ];
      connection
        .prepare(`
          UPDATE object_payloads
          SET body_json = json_set(body_json, '$.items', json(?)), payload_version = 2
          WHERE board_id = ? AND object_id = ?
        `)
        .run(JSON.stringify(rows), boardId, todoObjectId);
      connection
        .prepare(`
          INSERT INTO board_objects
            (board_id, object_id, kind, label, layer_index, x, y, width, height, geometry_version, locked)
          VALUES (?, ?, 'html', 'Copy embed', 15, 40, 23, 600, 400, 3, 1)
        `)
        .run(boardId, htmlObjectId);
      const body = {
        html: mixedCopyMarkup(assetPath, boardId),
        state: { image: `Use ${assetPath} here` },
      };
      connection
        .prepare(`
          INSERT INTO object_payloads (board_id, object_id, payload_version, body_kind, body_json)
          VALUES (?, ?, 8, 'embed', ?)
        `)
        .run(boardId, htmlObjectId, JSON.stringify(body));
      connection
        .prepare(`
          INSERT INTO board_archive_assets (board_id, asset_id, mime_type, bytes)
          VALUES (?, 'unreferenced', 'image/png', zeroblob(3))
        `)
        .run(boardId);
    }),
  );
}

export function grantCopyViewer(path: string, boardId: string, actorId: string): void {
  withDatabase(path, (database) =>
    database.write((connection) => {
      connection
        .prepare('INSERT INTO board_members (board_id, actor_id, can_edit) VALUES (?, ?, 0)')
        .run(boardId, actorId);
    }),
  );
}

export function removeCopyAssets(path: string, boardId: string): void {
  withDatabase(path, (database) =>
    database.write((connection) => {
      connection.prepare('DELETE FROM board_archive_assets WHERE board_id = ?').run(boardId);
    }),
  );
}

type CopyFailure = 'asset' | 'receipt';

export function failCopyWrite(path: string, stage: CopyFailure): void {
  const table = stage === 'asset' ? 'board_archive_assets' : 'catalog_duplicate_sources';
  withDatabase(path, (database) =>
    database.write((connection) => {
      connection.exec(`
        CREATE TRIGGER reject_copy BEFORE INSERT ON ${table}
        BEGIN SELECT RAISE(ABORT, 'Injected copy write failure'); END
      `);
    }),
  );
}

export function copyCounts(path: string) {
  return withDatabase(path, (database) =>
    database.read((connection) =>
      connection
        .prepare(`
          SELECT (SELECT count(*) FROM boards) AS boards,
            (SELECT count(*) FROM board_members) AS members,
            (SELECT count(*) FROM board_lifecycle) AS lifecycle,
            (SELECT count(*) FROM catalog_entries) AS catalog,
            (SELECT count(*) FROM board_objects) AS objects,
            (SELECT count(*) FROM object_payloads) AS payloads,
            (SELECT count(*) FROM board_archive_assets) AS assets,
            (SELECT count(*) FROM catalog_create_receipts) AS receipts,
            (SELECT count(*) FROM catalog_duplicate_sources) AS duplicate_sources
        `)
        .get(),
    ),
  );
}
