import type {
  CatalogThumbnail,
  CatalogThumbnailLookup,
  CatalogThumbnailObject,
  CatalogThumbnailRead,
} from '../../../modules/catalog/ports/index.js';
import type { SqliteConnection, SqliteRow } from '../../platform/index.js';

const maximumObjects = 160;
const maximumDescriptorBytes = 8192;
const maximumMediaSourceBytes = 48 * 1024;
const maximumEmbeddedImageBytes = 24 * 1024;
const assetIdentifier = /^[A-Za-z0-9_-]{1,128}$/u;
const drawableMediaTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const activeCondition = 'l.trashed_at_millis IS NULL';
const trashCondition = 'l.trashed_at_millis IS NOT NULL AND l.owner_actor_id = m.actor_id';

function visibleRevision(
  connection: SqliteConnection,
  lookup: CatalogThumbnailLookup,
): bigint | undefined {
  const condition = lookup.trashed ? trashCondition : activeCondition;
  const statement = connection.prepare(`
    SELECT b.revision FROM board_members AS m
    JOIN boards AS b ON b.board_id = m.board_id
    LEFT JOIN board_lifecycle AS l ON l.board_id = b.board_id
    WHERE m.actor_id = ? AND m.board_id = ? AND ${condition}
  `);
  statement.setReadBigInts(true);
  const row = statement.get(lookup.actorId, lookup.boardId);

  return row && revisionValue(row.revision);
}

function revisionValue(value: unknown): bigint {
  if (typeof value !== 'bigint' || value < 0n) {
    throw new Error('The preview board revision is invalid.');
  }

  return value;
}

function coordinate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('The board preview contains invalid geometry.');
  }

  return value;
}

function label(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new Error('The board preview contains an invalid ' + name + '.');
  }

  return value;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readBounds(connection: SqliteConnection, boardId: string) {
  const row = connection
    .prepare(`
    SELECT COUNT(*) AS total,
      MIN(x - CASE WHEN rotation = 0 THEN 0.0 ELSE height / 2.0 END) AS left,
      MIN(y - CASE WHEN rotation = 0 THEN 0.0 ELSE width / 2.0 END) AS top,
      MAX(x + width + CASE WHEN rotation = 0 THEN 0.0 ELSE height / 2.0 END) AS right,
      MAX(y + height + CASE WHEN rotation = 0 THEN 0.0 ELSE width / 2.0 END) AS bottom
    FROM board_objects WHERE board_id = ?
  `)
    .get(boardId);

  if (!row || row.total === 0) {
    return undefined;
  }

  return {
    total: coordinate(row.total),
    left: coordinate(row.left),
    top: coordinate(row.top),
    right: coordinate(row.right),
    bottom: coordinate(row.bottom),
  };
}

function readRows(connection: SqliteConnection, boardId: string, total: number) {
  const count = Math.min(total, maximumObjects);

  return connection
    .prepare(`
      WITH RECURSIVE slots(slot) AS (
        VALUES(0)
        UNION ALL
        SELECT slot + 1 FROM slots WHERE slot + 1 < ?2
      ), ordered AS (
      SELECT *, ROW_NUMBER() OVER (ORDER BY layer_index, object_id) - 1 AS slot
      FROM board_objects WHERE board_id = ?1
    ), sampled AS (
        SELECT ordered.* FROM ordered JOIN slots
          ON ordered.slot = CAST(slots.slot * ?3 / ?2 AS INTEGER)
    )
    SELECT o.object_id, o.kind, SUBSTR(o.label, 1, 120) AS label,
      o.x, o.y, o.width, o.height, o.rotation,
      CASE WHEN length(CAST(o.appearance_json AS BLOB)) <= ?4 THEN o.appearance_json END AS appearance,
      CASE WHEN length(CAST(o.detail_json AS BLOB)) <= ?4 THEN o.detail_json END AS detail,
      CASE WHEN length(CAST(p.body_json AS BLOB)) <= ?5 THEN json_extract(p.body_json, '$.src') END AS image_source
    FROM sampled AS o LEFT JOIN object_payloads AS p
      ON p.board_id = ?1 AND p.object_id = o.object_id AND o.kind = 'image' AND p.body_kind = 'image'
    ORDER BY o.slot
  `)
    .all(boardId, count, total, maximumDescriptorBytes, maximumMediaSourceBytes);
}

function readImages(connection: SqliteConnection, boardId: string) {
  const prefix = '/studio-archive-assets/' + boardId + '/';
  let statement: ReturnType<SqliteConnection['prepare']> | undefined;
  let remaining = maximumEmbeddedImageBytes;

  return (source: unknown): string | undefined => {
    if (typeof source !== 'string' || remaining === 0 || !source.startsWith(prefix)) {
      return undefined;
    }

    const id = source.slice(prefix.length);
    if (!assetIdentifier.test(id)) {
      return undefined;
    }

    statement ??= connection.prepare(`
      SELECT mime_type, bytes FROM board_archive_assets
      WHERE board_id = ? AND asset_id = ? AND length(bytes) <= ?
    `);
    const asset = statement.get(boardId, id, remaining);
    if (!asset) {
      return undefined;
    }

    const { mime_type: mimeType, bytes } = asset;
    if (
      typeof mimeType !== 'string' ||
      !drawableMediaTypes.has(mimeType) ||
      !(bytes instanceof Uint8Array)
    ) {
      return undefined;
    }

    remaining -= bytes.byteLength;

    return 'data:' + mimeType + ';base64,' + Buffer.from(bytes).toString('base64');
  };
}

function readObject(row: SqliteRow, image: string | undefined): CatalogThumbnailObject {
  return {
    id: label(row.object_id, 'object identifier'),
    kind: label(row.kind, 'object kind'),
    label: label(row.label, 'object label'),
    x: coordinate(row.x),
    y: coordinate(row.y),
    width: coordinate(row.width),
    height: coordinate(row.height),
    rotation: coordinate(row.rotation),
    appearance: optionalText(row.appearance),
    detail: optionalText(row.detail),
    image,
  };
}

export function readCatalogThumbnail(
  connection: SqliteConnection,
  lookup: CatalogThumbnailLookup,
  cached?: CatalogThumbnail,
): CatalogThumbnailRead {
  const { boardId } = lookup;
  const revision = visibleRevision(connection, lookup);
  if (revision === undefined) {
    return { kind: 'forbidden' };
  }
  if (revision !== lookup.revision) {
    return { kind: 'unavailable' };
  }
  if (cached?.revision === revision) {
    return { kind: 'thumbnail', thumbnail: cached };
  }

  const bounds = readBounds(connection, boardId);
  if (!bounds) {
    return { kind: 'unavailable' };
  }

  const findImage = readImages(connection, boardId);
  const objects = readRows(connection, boardId, bounds.total).map((row) =>
    readObject(row, findImage(row.image_source)),
  );

  return {
    kind: 'scene',
    scene: { ...bounds, revision, objects },
  };
}
