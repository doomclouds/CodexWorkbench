import type {
  BoardHeader,
  BoardObject,
  BoardVersionCommit,
  BoardVersionSummary,
  PayloadRecord,
} from '../../modules/whiteboard/ports/index.js';
import type { SqliteConnection, SqliteRow } from '../platform/index.js';
import { decodeSceneObject } from './board-object-storage.js';
import { decodePayload, storedText, storedVersion } from './stored-values.js';

const retainedVersions = 200;
const defaultPageSize = 50;

export const boardHistorySchema = `
  CREATE TABLE IF NOT EXISTS board_versions (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    title TEXT NOT NULL,
    actor_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('baseline', 'geometry', 'content', 'image', 'restore')),
    saved_at_millis INTEGER CHECK (saved_at_millis >= 0),
    source_revision INTEGER CHECK (source_revision >= 0),
    changed_object_count INTEGER NOT NULL CHECK (changed_object_count >= 0),
    CHECK (kind = 'baseline' OR (actor_id IS NOT NULL AND saved_at_millis IS NOT NULL)),
    PRIMARY KEY (board_id, revision)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS board_history_objects (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    change_revision INTEGER NOT NULL CHECK (change_revision > 0),
    object_id TEXT NOT NULL,
    kind TEXT,
    label TEXT,
    layer_index INTEGER,
    x REAL,
    y REAL,
    width REAL,
    height REAL,
    rotation REAL,
    geometry_version INTEGER,
    locked INTEGER,
    parent_id TEXT,
    group_id TEXT,
    appearance_json TEXT CHECK (appearance_json IS NULL OR json_valid(appearance_json)),
    detail_json TEXT CHECK (detail_json IS NULL OR json_valid(detail_json)),
    PRIMARY KEY (board_id, object_id, change_revision)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS board_history_objects_by_revision
    ON board_history_objects (board_id, change_revision, object_id);

  CREATE TABLE IF NOT EXISTS board_history_payloads (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    change_revision INTEGER NOT NULL CHECK (change_revision > 0),
    object_id TEXT NOT NULL,
    payload_version INTEGER CHECK (payload_version >= 0),
    body_kind TEXT,
    body_json TEXT CHECK (body_json IS NULL OR json_valid(body_json)),
    PRIMARY KEY (board_id, object_id, change_revision),
    CHECK ((payload_version IS NULL AND body_kind IS NULL AND body_json IS NULL)
      OR (payload_version IS NOT NULL AND body_kind IS NOT NULL AND body_json IS NOT NULL))
  ) STRICT;

  CREATE INDEX IF NOT EXISTS board_history_payloads_by_revision
    ON board_history_payloads (board_id, change_revision, object_id);
`;

const objectColumns = [
  'kind',
  'label',
  'layer_index',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'geometry_version',
  'locked',
  'parent_id',
  'group_id',
  'appearance_json',
  'detail_json',
] as const;
const versionColumns =
  'revision, title, actor_id, kind, saved_at_millis, source_revision, changed_object_count';
const requestedObjects = 'requested AS (SELECT DISTINCT value AS object_id FROM json_each(?3))';
const requestedOnly = 'AND object_id IN (SELECT object_id FROM requested)';

function objectProjection(alias: string): string {
  return objectColumns.map((column) => `${alias}.${column}`).join(', ');
}

const captureObjects = `
  INSERT OR IGNORE INTO board_history_objects
    (board_id, change_revision, object_id, ${objectColumns.join(', ')})
  SELECT b.board_id, b.revision + 1, target.value, ${objectProjection('o')}
  FROM boards AS b
  CROSS JOIN json_each(?2) AS target
  LEFT JOIN board_objects AS o ON o.board_id = b.board_id AND o.object_id = target.value
  WHERE b.board_id = ?1
`;

const capturePayloads = `
  INSERT OR IGNORE INTO board_history_payloads
    (board_id, change_revision, object_id, payload_version, body_kind, body_json)
  SELECT b.board_id, b.revision + 1, target.value, p.payload_version, p.body_kind, p.body_json
  FROM boards AS b
  CROSS JOIN json_each(?2) AS target
  LEFT JOIN object_payloads AS p ON p.board_id = b.board_id AND p.object_id = target.value
  WHERE b.board_id = ?1
`;

export function recordObjectHistory(
  connection: SqliteConnection,
  boardId: string,
  objectIds: readonly string[],
): void {
  if (objectIds.length > 0) {
    connection.prepare(captureObjects).run(boardId, JSON.stringify(objectIds));
  }
}

export function recordPayloadHistory(
  connection: SqliteConnection,
  boardId: string,
  objectIds: readonly string[],
): void {
  if (objectIds.length > 0) {
    connection.prepare(capturePayloads).run(boardId, JSON.stringify(objectIds));
  }
}

function pruneBoardVersions(connection: SqliteConnection, boardId: string): void {
  const query = connection.prepare(`
    SELECT revision FROM board_versions
    WHERE board_id = ? ORDER BY revision DESC LIMIT 1 OFFSET ?
  `);
  query.setReadBigInts(true);
  const floor = query.get(boardId, retainedVersions - 1)?.revision;
  if (floor === undefined) {
    return;
  }

  const revision = storedVersion(floor, 'revision');
  connection
    .prepare('DELETE FROM board_versions WHERE board_id = ? AND revision < ?')
    .run(boardId, revision);
  connection
    .prepare('DELETE FROM board_history_objects WHERE board_id = ? AND change_revision <= ?')
    .run(boardId, revision);
  connection
    .prepare('DELETE FROM board_history_payloads WHERE board_id = ? AND change_revision <= ?')
    .run(boardId, revision);
}

export function publishBoardVersion(
  connection: SqliteConnection,
  before: BoardHeader,
  after: bigint,
  commit: BoardVersionCommit,
): void {
  if (after !== before.revision + 1n) {
    throw new Error('A board version must advance by one.');
  }

  const { boardId, title } = before;
  const { actorId, kind, savedAtMillis, sourceRevision, changedObjectCount } = commit;
  connection
    .prepare(`
    INSERT INTO board_versions (board_id, ${versionColumns})
      SELECT ?1, ?2, ?3, NULL, 'baseline', NULL, NULL, 0
    WHERE NOT EXISTS (SELECT 1 FROM board_versions WHERE board_id = ?1)
  `)
    .run(boardId, before.revision, title);
  connection
    .prepare(`
    INSERT INTO board_versions (board_id, ${versionColumns})
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .run(
      boardId,
      after,
      title,
      actorId,
      kind,
      savedAtMillis,
      sourceRevision ?? null,
      changedObjectCount,
    );
  pruneBoardVersions(connection, boardId);
}

function versionKind(value: unknown): BoardVersionSummary['kind'] {
  switch (value) {
    case 'baseline':
    case 'geometry':
    case 'content':
    case 'image':
    case 'restore':
      return value;
    default:
      throw new Error('Invalid stored board version kind.');
  }
}

function safeVersionNumber(value: unknown, field: string): number {
  const number = Number(storedVersion(value, field));
  if (!Number.isSafeInteger(number)) {
    throw new Error(`Invalid stored number for ${field}.`);
  }

  return number;
}

function decodeVersion(row: SqliteRow): BoardVersionSummary {
  return {
    revision: storedVersion(row.revision, 'revision'),
    title: storedText(row.title, 'title'),
    actorId: row.actor_id === null ? undefined : storedText(row.actor_id, 'actor_id'),
    kind: versionKind(row.kind),
    savedAtMillis:
      row.saved_at_millis === null
        ? undefined
        : safeVersionNumber(row.saved_at_millis, 'saved_at_millis'),
    sourceRevision:
      row.source_revision === null
        ? undefined
        : storedVersion(row.source_revision, 'source_revision'),
    changedObjectCount: safeVersionNumber(row.changed_object_count, 'changed_object_count'),
  };
}

function readCreationVersion(
  connection: SqliteConnection,
  boardId: string,
): BoardVersionSummary | undefined {
  const schema = connection
    .prepare(`
    SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'catalog_create_receipts'
  `)
    .get();

  if (!schema) {
    return undefined;
  }

  const query = connection.prepare(`
    SELECT title, actor_id, updated_at_millis FROM catalog_create_receipts
    WHERE board_id = ?
    ORDER BY updated_at_millis, actor_id, command_id LIMIT 1
  `);
  query.setReadBigInts(true);
  const created = query.get(boardId);
  if (created) {
    return {
      revision: 0n,
      title: storedText(created.title, 'title'),
      actorId: storedText(created.actor_id, 'actor_id'),
      kind: 'baseline',
      savedAtMillis: safeVersionNumber(created.updated_at_millis, 'updated_at_millis'),
      changedObjectCount: 0,
    };
  }
}

function withCreationVersion(connection: SqliteConnection, boardId: string, row: SqliteRow) {
  const version = decodeVersion(row);
  if (version.kind === 'baseline' && version.revision === 0n) {
    return readCreationVersion(connection, boardId) ?? version;
  }

  return version;
}

export function readBoardVersions(
  connection: SqliteConnection,
  boardId: string,
  before?: bigint,
  limit = defaultPageSize,
): readonly BoardVersionSummary[] {
  const cutoff = before === undefined ? '' : 'AND revision < ?3';
  const query = connection.prepare(`
    SELECT ${versionColumns} FROM board_versions
    WHERE board_id = ?1 ${cutoff} ORDER BY revision DESC LIMIT ?2
  `);
  query.setReadBigInts(true);
  const rows = before === undefined ? query.all(boardId, limit) : query.all(boardId, limit, before);

  return rows.map((row) => withCreationVersion(connection, boardId, row));
}

export function readBoardVersion(
  connection: SqliteConnection,
  boardId: string,
  revision: bigint,
): BoardVersionSummary | undefined {
  const query = connection.prepare(`
    SELECT ${versionColumns} FROM board_versions WHERE board_id = ? AND revision = ?
  `);
  query.setReadBigInts(true);
  const row = query.get(boardId, revision);
  if (row) {
    return withCreationVersion(connection, boardId, row);
  }

  if (revision === 0n) {
    const initial = connection
      .prepare('SELECT 1 FROM boards WHERE board_id = ? AND revision = 0')
      .get(boardId);

    return initial && readCreationVersion(connection, boardId);
  }
}

function payloadHistoryJoin(source: string): string {
  return `
    LEFT JOIN board_history_payloads AS prior
      ON prior.board_id = ?1 AND prior.object_id = ${source}.object_id
      AND prior.change_revision = (
        SELECT MIN(change_revision) FROM board_history_payloads
        WHERE board_id = ?1 AND object_id = ${source}.object_id AND change_revision > ?2
      )
  `;
}

function payloadValue(column: string): string {
  return `CASE WHEN prior.change_revision IS NULL THEN p.${column} ELSE prior.${column} END`;
}

const historyPayloadSelection = `
  WITH ${requestedObjects}, history_payloads AS (
    SELECT target.object_id, ${payloadValue('payload_version')} AS payload_version,
      ${payloadValue('body_kind')} AS body_kind, ${payloadValue('body_json')} AS body_json
    FROM requested AS target
    LEFT JOIN object_payloads AS p ON p.board_id = ?1 AND p.object_id = target.object_id
    ${payloadHistoryJoin('target')}
  )
`;

export function readVersionObjects(
  connection: SqliteConnection,
  boardId: string,
  revision: bigint,
  objectIds?: readonly string[],
): readonly BoardObject[] {
  const request = objectIds === undefined ? '' : `${requestedObjects},`;
  const scope = objectIds === undefined ? '' : requestedOnly;
  const query = connection.prepare(`
    WITH ${request} first_change AS (
      SELECT object_id, MIN(change_revision) AS change_revision
      FROM board_history_objects WHERE board_id = ?1 AND change_revision > ?2 ${scope}
      GROUP BY object_id
    ), history_scene AS (
      SELECT o.object_id, ${objectProjection('o')}
      FROM board_objects AS o
      WHERE board_id = ?1 ${scope} AND o.object_id NOT IN (SELECT object_id FROM first_change)
      UNION ALL
      SELECT h.object_id, ${objectProjection('h')}
      FROM first_change AS change
      JOIN board_history_objects AS h ON h.board_id = ?1 AND h.object_id = change.object_id
        AND h.change_revision = change.change_revision
      WHERE h.kind IS NOT NULL
    )
    SELECT geometry.*, ${payloadValue('payload_version')} AS payload_version
    FROM history_scene AS geometry
    LEFT JOIN object_payloads AS p INDEXED BY object_payloads_versions
      ON p.board_id = ?1 AND p.object_id = geometry.object_id
    ${payloadHistoryJoin('geometry')}
    ORDER BY geometry.layer_index, geometry.object_id
  `);
  query.setReadBigInts(true);
  const rows =
    objectIds === undefined
      ? query.all(boardId, revision)
      : query.all(boardId, revision, JSON.stringify(objectIds));

  return rows.map(decodeSceneObject);
}

export function readVersionPayloads(
  connection: SqliteConnection,
  boardId: string,
  revision: bigint,
  objectIds: readonly string[],
): readonly PayloadRecord[] {
  if (objectIds.length === 0) {
    return [];
  }

  const query = connection.prepare(`
    ${historyPayloadSelection}
    SELECT * FROM history_payloads WHERE payload_version IS NOT NULL
  `);
  query.setReadBigInts(true);

  return query.all(boardId, revision, JSON.stringify(objectIds)).map((row) => ({
    objectId: storedText(row.object_id, 'object_id'),
    payloadVersion: storedVersion(row.payload_version, 'payload_version'),
    bodyKind: storedText(row.body_kind, 'body_kind'),
    data: decodePayload(row.body_json),
  }));
}

export function readVersionPayloadByteSize(
  connection: SqliteConnection,
  boardId: string,
  revision: bigint,
  objectIds: readonly string[],
): bigint {
  if (objectIds.length === 0) {
    return 0n;
  }

  const query = connection.prepare(`
    ${historyPayloadSelection}
    SELECT COALESCE(SUM(length(CAST(body_json AS BLOB))), 0) AS byte_size
    FROM history_payloads WHERE payload_version IS NOT NULL
  `);
  query.setReadBigInts(true);
  const row = query.get(boardId, revision, JSON.stringify(objectIds));

  return storedVersion(row?.byte_size, 'byte_size');
}
