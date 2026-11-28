import type {
  BoardAssetImport,
  BoardAssetPage,
  BoardAssetReference,
  BoardAssetRemoval,
  ImportedArchiveAsset,
} from '../../../modules/archives/ports/index.js';
import type { SqliteConnection, SqliteRow } from '../../platform/index.js';
import { readBoardAccess } from '../authorization/index.js';
import { publicMimeType } from './publication.js';

function assetSource(boardId: string, assetId: string): string {
  return '/studio-archive-assets/' + boardId + '/' + assetId;
}

function reference(boardId: string, row: SqliteRow): BoardAssetReference {
  const { asset_id: assetId, mime_type: mimeType, byte_length: byteLength } = row;
  if (
    typeof assetId !== 'string' ||
    typeof mimeType !== 'string' ||
    typeof byteLength !== 'number'
  ) {
    throw new TypeError('Invalid board asset metadata.');
  }

  return {
    assetId,
    src: assetSource(boardId, assetId),
    mediaType: publicMimeType(mimeType),
    byteLength,
  };
}

export function isActiveBoardOwner(
  connection: SqliteConnection,
  actorId: string,
  boardId: string,
): boolean {
  return readBoardAccess(connection, boardId, actorId)?.isOwner === true;
}

export function listBoardAssets(
  connection: SqliteConnection,
  actorId: string,
  boardId: string,
  cursor: string,
  limit: number,
): BoardAssetPage | undefined {
  if (!isActiveBoardOwner(connection, actorId, boardId)) {
    return undefined;
  }

  const rows = connection
    .prepare(`
    SELECT asset_id, mime_type, length(bytes) AS byte_length
    FROM board_archive_assets
    WHERE board_id = ? AND asset_id > ?
    ORDER BY asset_id
    LIMIT ?
  `)
    .all(boardId, cursor, limit + 1);
  const assets = rows.slice(0, limit).map((row) => reference(boardId, row));

  return { assets, nextCursor: rows.length > limit ? assets.at(-1)?.assetId : undefined };
}

function readRemoved(connection: SqliteConnection, boardId: string, assetId: string): boolean {
  return (
    connection
      .prepare(`
    SELECT 1 FROM board_removed_assets WHERE board_id = ? AND asset_id = ?
  `)
      .get(boardId, assetId) !== undefined
  );
}

export function importBoardAsset(
  connection: SqliteConnection,
  actorId: string,
  boardId: string,
  assetId: string,
  signature: string,
  asset: ImportedArchiveAsset,
): BoardAssetImport | undefined {
  if (!isActiveBoardOwner(connection, actorId, boardId)) {
    return undefined;
  }

  const prior = connection
    .prepare('SELECT signature FROM board_asset_imports WHERE board_id = ? AND asset_id = ?')
    .get(boardId, assetId);

  if (prior && prior.signature !== signature) {
    return { kind: 'rejected', reason: 'commandIdReuse' };
  }

  if (!prior) {
    if (readRemoved(connection, boardId, assetId)) {
      return { kind: 'rejected', reason: 'commandIdReuse' };
    }

    const inserted = connection
      .prepare(`
        INSERT INTO board_archive_assets (board_id, asset_id, mime_type, bytes)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (board_id, asset_id) DO NOTHING
      `)
      .run(boardId, assetId, asset.mimeType, asset.bytes);

    if (Number(inserted.changes) !== 1) {
      return { kind: 'rejected', reason: 'commandIdReuse' };
    }

    connection
      .prepare('INSERT INTO board_asset_imports (board_id, asset_id, signature) VALUES (?, ?, ?)')
      .run(boardId, assetId, signature);
  }

  const existing = connection
    .prepare(`
    SELECT asset_id, mime_type, length(bytes) AS byte_length
    FROM board_archive_assets
    WHERE board_id = ? AND asset_id = ?
  `)
    .get(boardId, assetId);

  return existing
    ? { kind: 'asset', asset: reference(boardId, existing) }
    : { kind: 'rejected', reason: 'notFound' };
}

function hasReference(connection: SqliteConnection, boardId: string, assetId: string): boolean {
  const src = assetSource(boardId, assetId);
  const match = connection
    .prepare(`
    SELECT 1 FROM object_payloads WHERE board_id = ?1 AND instr(body_json, ?2) > 0
    UNION ALL
    SELECT 1 FROM board_history_payloads WHERE board_id = ?1 AND instr(body_json, ?2) > 0
    UNION ALL
    SELECT 1 FROM board_objects
      WHERE board_id = ?1 AND (instr(label, ?2) > 0 OR instr(appearance_json, ?2) > 0 OR instr(detail_json, ?2) > 0)
    UNION ALL
    SELECT 1 FROM board_history_objects
      WHERE board_id = ?1 AND (instr(label, ?2) > 0 OR instr(appearance_json, ?2) > 0 OR instr(detail_json, ?2) > 0)
    UNION ALL
    SELECT 1 FROM feedback_threads
      WHERE board_id = ?1 AND (instr(object_label, ?2) > 0 OR instr(selection_json, ?2) > 0)
    UNION ALL
    SELECT 1 FROM feedback_content_anchors
      WHERE board_id = ?1 AND (instr(unit_json, ?2) > 0 OR instr(frozen_excerpt, ?2) > 0)
    UNION ALL
    SELECT 1 FROM feedback_messages WHERE board_id = ?1 AND instr(text, ?2) > 0
    UNION ALL
    SELECT 1 FROM board_review_target_snapshots WHERE board_id = ?1 AND instr(targets_json, ?2) > 0
    UNION ALL
    SELECT 1 FROM board_suggestion_options
      WHERE board_id = ?1 AND instr(CAST(edit_bytes AS TEXT), ?2) > 0
    UNION ALL
    SELECT 1 FROM board_suggestion_option_plans WHERE board_id = ?1 AND instr(plan_json, ?2) > 0
    UNION ALL
    SELECT 1 FROM board_edit_receipts WHERE board_id = ?1 AND instr(receipt_json, ?2) > 0
    LIMIT 1
  `)
    .get(boardId, src);

  return match !== undefined;
}

export function deleteBoardAsset(
  connection: SqliteConnection,
  actorId: string,
  boardId: string,
  assetId: string,
): BoardAssetRemoval | undefined {
  if (!isActiveBoardOwner(connection, actorId, boardId)) {
    return undefined;
  }

  const existing = connection
    .prepare(`
    SELECT 1 FROM board_archive_assets WHERE board_id = ? AND asset_id = ?
  `)
    .get(boardId, assetId);

  if (!existing) {
    return readRemoved(connection, boardId, assetId)
      ? { kind: 'removed', assetId }
      : { kind: 'rejected', reason: 'notFound' };
  }
  if (hasReference(connection, boardId, assetId)) {
    return { kind: 'rejected', reason: 'referenceInUse' };
  }

  connection
    .prepare(`
    INSERT INTO board_removed_assets (board_id, asset_id, mime_type, bytes)
    SELECT board_id, asset_id, mime_type, bytes FROM board_archive_assets
    WHERE board_id = ? AND asset_id = ?
    ON CONFLICT (board_id, asset_id) DO UPDATE SET mime_type = excluded.mime_type, bytes = excluded.bytes
  `)
    .run(boardId, assetId);
  connection
    .prepare(`
    DELETE FROM board_archive_assets WHERE board_id = ? AND asset_id = ?
  `)
    .run(boardId, assetId);

  return { kind: 'removed', assetId };
}
