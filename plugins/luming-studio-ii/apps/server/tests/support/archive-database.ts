import { openSqliteDatabase } from '../../src/infrastructure/platform/index.js';

export const archiveReceiptWriteFailure = 'Injected archive receipt write failure';

export function replaceArchiveAssetBytes(
  path: string,
  boardId: string,
  assetId: string,
  byteLength: number,
): void {
  const database = openSqliteDatabase(path);
  try {
    database.write((connection) => {
      const update = connection
        .prepare(
          'UPDATE board_archive_assets SET bytes = zeroblob(?) WHERE board_id = ? AND asset_id = ?',
        )
        .run(byteLength, boardId, assetId);

      if (update.changes !== 1) {
        throw new Error('Expected an existing archive asset.');
      }
    });
  } finally {
    database.close();
  }
}

export function rejectArchiveReceiptInserts(path: string): void {
  const database = openSqliteDatabase(path);
  try {
    database.write((connection) => {
      connection.exec(
        `CREATE TRIGGER reject_archive_receipt_inserts BEFORE INSERT ON archive_import_receipts
         BEGIN
           SELECT RAISE(ABORT, '${archiveReceiptWriteFailure}');
         END`,
      );
    });
  } finally {
    database.close();
  }
}

export function archiveRowCounts(path: string) {
  const database = openSqliteDatabase(path);
  try {
    return database.read((connection) =>
      connection
        .prepare(
          `SELECT (SELECT count(*) FROM boards) AS boards,
                  (SELECT count(*) FROM board_members) AS members,
                  (SELECT count(*) FROM catalog_entries) AS catalog,
                  (SELECT count(*) FROM board_objects) AS objects,
                  (SELECT count(*) FROM object_payloads) AS payloads,
                  (SELECT count(*) FROM board_archive_assets) AS assets,
                  (SELECT count(*) FROM board_archive_source_chunks) AS source,
                  (SELECT count(*) FROM archive_import_receipts) AS receipts`,
        )
        .get(),
    );
  } finally {
    database.close();
  }
}

export function retainedArchiveChunks(path: string, boardId: string) {
  const database = openSqliteDatabase(path);
  try {
    return database.read((connection) =>
      connection
        .prepare(
          `SELECT bytes FROM board_archive_source_chunks WHERE board_id = ? ORDER BY chunk_index`,
        )
        .all(boardId)
        .map(({ bytes }) => {
          if (!(bytes instanceof Uint8Array)) {
            throw new TypeError('Expected an archive source chunk.');
          }

          return bytes;
        }),
    );
  } finally {
    database.close();
  }
}
