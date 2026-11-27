import type {
  CatalogThumbnail,
  CatalogThumbnailLookup,
  CatalogThumbnailObject,
  CatalogThumbnailRead,
} from '../../../modules/catalog/ports/index.js';
import type { SqliteConnection, SqliteRow } from '../../platform/index.js';
import { sanitizeThumbnailHtml } from './thumbnail-html.js';

const maximumObjects = 160;
const maximumDetailedObjects = 32;
const maximumDescriptorBytes = 8192;
const maximumPayloadBytes = 96 * 1024;
const maximumEmbeddedImageBytes = 48 * 1024;
const assetIdentifier = /^[A-Za-z0-9_-]{1,128}$/u;
const drawableMediaTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const embeddedImage = /^data:image\/(?:png|jpeg|webp|gif);base64,([a-z\d+/]+={0,2})$/iu;
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
      SELECT object_id, ROW_NUMBER() OVER (ORDER BY layer_index, object_id) - 1 AS slot
      FROM board_objects WHERE board_id = ?1
    ), sampled AS (
        SELECT ordered.* FROM ordered JOIN slots
          ON ordered.slot = CAST(slots.slot * ?3 / ?2 AS INTEGER)
    )
    SELECT o.object_id, o.kind, SUBSTR(o.label, 1, 120) AS label,
      o.x, o.y, o.width, o.height, o.rotation,
      CASE WHEN length(CAST(o.appearance_json AS BLOB)) <= ?4 THEN o.appearance_json END AS appearance,
      CASE WHEN length(CAST(o.detail_json AS BLOB)) <= ?4 THEN o.detail_json END AS detail
    FROM sampled AS s JOIN board_objects AS o ON o.board_id = ?1 AND o.object_id = s.object_id
    ORDER BY s.slot
  `)
    .all(boardId, count, total, maximumDescriptorBytes);
}

function readImages(connection: SqliteConnection, boardId: string) {
  const prefix = '/studio-archive-assets/' + boardId + '/';
  let statement: ReturnType<SqliteConnection['prepare']> | undefined;
  let remaining = maximumEmbeddedImageBytes;

  return (source: unknown): string | undefined => {
    if (typeof source !== 'string' || remaining === 0) {
      return undefined;
    }

    if (!source.startsWith(prefix)) {
      const data = embeddedImage.exec(source)?.[1];
      if (data && Buffer.byteLength(data, 'base64') <= remaining) {
        remaining -= Buffer.byteLength(data, 'base64');

        return source;
      }

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

function readObject(row: SqliteRow): CatalogThumbnailObject {
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
  };
}

const payloadKinds = new Map([
  ['html', 'embed'],
  ['document', 'document'],
  ['todo', 'todo'],
  ['sticker', 'sticker'],
  ['image', 'image'],
  ['note', 'text'],
  ['text', 'text'],
]);

function readDetailedObjects(
  connection: SqliteConnection,
  boardId: string,
  objects: readonly CatalogThumbnailObject[],
) {
  const findImage = readImages(connection, boardId);
  const statement = connection.prepare(`
    SELECT body_json, length(CAST(body_json AS BLOB)) AS byte_length
    FROM object_payloads
    WHERE board_id = ? AND object_id = ? AND body_kind = ?
      AND length(CAST(body_json AS BLOB)) <= ?
  `);
  let remaining = maximumPayloadBytes;

  return objects.map((object, index) => {
    const bodyKind = payloadKinds.get(object.kind);
    if (!bodyKind || remaining === 0) {
      return object;
    }

    const row = statement.get(boardId, object.id, bodyKind, remaining);
    if (!row || typeof row.body_json !== 'string') {
      return object;
    }

    remaining -= coordinate(row.byte_length);
    const value: unknown = JSON.parse(row.body_json);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return object;
    }

    const data = value as Readonly<Record<string, unknown>>;
    const { html, src } = data;

    return {
      ...object,
      content: object.kind === 'html' ? undefined : data,
      html:
        object.kind === 'html' && typeof html === 'string'
          ? sanitizeThumbnailHtml(html, index)
          : undefined,
      image: object.kind === 'image' ? findImage(src) : undefined,
    };
  });
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
    return lookup.trashed
      ? {
          kind: 'scene',
          scene: { revision, left: 0, top: 0, right: 0, bottom: 0, objects: [] },
        }
      : { kind: 'unavailable' };
  }

  const objects = readRows(connection, boardId, bounds.total).map(readObject);

  return {
    kind: 'scene',
    scene: {
      ...bounds,
      revision,
      objects:
        bounds.total <= maximumDetailedObjects
          ? readDetailedObjects(connection, boardId, objects)
          : objects,
    },
  };
}
