import type {
  BoardChanges,
  BoardEditApplied,
  BoardObject,
  BoardVersionCommit,
  BoardHeader,
  PayloadRecord,
} from '../../modules/whiteboard/ports/index.js';
import type { SqliteConnection } from '../platform/index.js';
import {
  publishBoardVersion,
  recordObjectHistory,
  recordPayloadHistory,
} from './board-history-storage.js';
import { storedText, storedVersion } from './stored-values.js';

const minimumLayerRank = -(1n << 63n);
const maximumLayerRank = (1n << 63n) - 1n;
const layerSpacing = 1024n;

interface RankedObject {
  readonly objectId: string;
  readonly rank: bigint;
}

export const boardEditSchema = `
  CREATE TABLE IF NOT EXISTS board_used_object_ids (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    object_id TEXT NOT NULL,
    PRIMARY KEY (board_id, object_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS board_edit_receipts (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    signature TEXT NOT NULL,
    receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
    PRIMARY KEY (board_id, actor_id, command_id)
  ) STRICT;
`;

export function hasUsedObjectId(connection: SqliteConnection, boardId: string, objectId: string) {
  const query = connection.prepare(`
    SELECT 1 FROM board_objects WHERE board_id = ? AND object_id = ?
    UNION ALL
    SELECT 1 FROM board_used_object_ids WHERE board_id = ? AND object_id = ?
    LIMIT 1
  `);

  return query.get(boardId, objectId, boardId, objectId) !== undefined;
}

export function advanceBoardRevision(connection: SqliteConnection, boardId: string): bigint {
  const update = connection.prepare(`
    UPDATE boards SET revision = revision + 1
    WHERE board_id = ?
    RETURNING revision
  `);
  update.setReadBigInts(true);

  return storedVersion(update.get(boardId)?.revision, 'revision');
}

function recordUsedIds(connection: SqliteConnection, boardId: string, ids: readonly string[]) {
  if (!ids.length) {
    return;
  }

  connection
    .prepare(`
      INSERT OR IGNORE INTO board_used_object_ids (board_id, object_id)
      SELECT ?, value FROM json_each(?)
    `)
    .run(boardId, JSON.stringify(ids));
}

function removeObjects(
  connection: SqliteConnection,
  boardId: string,
  ids: readonly string[],
  table: 'board_objects' | 'object_payloads',
) {
  if (!ids.length) {
    return;
  }

  connection
    .prepare(
      `DELETE FROM ${table} WHERE board_id = ? AND object_id IN (SELECT value FROM json_each(?))`,
    )
    .run(boardId, JSON.stringify(ids));
}

function saveAssets(connection: SqliteConnection, boardId: string, assets: BoardChanges['assets']) {
  if (!assets?.length) {
    return;
  }

  const insert = connection.prepare(`
    INSERT INTO board_archive_assets (board_id, asset_id, mime_type, bytes) VALUES (?, ?, ?, ?)
  `);

  for (const asset of assets) {
    insert.run(boardId, asset.assetId, asset.mimeType, asset.bytes);
  }
}

function storeObjects(
  connection: SqliteConnection,
  boardId: string,
  objects: readonly BoardObject[],
): readonly string[] {
  if (!objects.length) {
    return [];
  }

  const { firstRank, normalizedIds } = reserveLayerRanks(connection, boardId, objects.length);
  const upsert = connection.prepare(`
    INSERT INTO board_objects (
      board_id, object_id, kind, label, layer_index, x, y, width, height, rotation,
      geometry_version, locked, parent_id, group_id, appearance_json, detail_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (board_id, object_id) DO UPDATE SET
      kind = excluded.kind, label = excluded.label, x = excluded.x, y = excluded.y,
      width = excluded.width, height = excluded.height, rotation = excluded.rotation,
      geometry_version = excluded.geometry_version, locked = excluded.locked,
      parent_id = excluded.parent_id, group_id = excluded.group_id,
      appearance_json = excluded.appearance_json, detail_json = excluded.detail_json
  `);

  let layer = firstRank;
  for (const object of objects) {
    const { geometry, objectId, kind, label, geometryVersion, locked } = object;
    upsert.run(
      boardId,
      objectId,
      kind,
      label,
      layer,
      geometry.x,
      geometry.y,
      geometry.width,
      geometry.height,
      geometry.rotation,
      geometryVersion,
      Number(locked),
      object.parentId ?? null,
      object.groupId ?? null,
      object.appearance ? JSON.stringify(object.appearance) : null,
      object.detail ? JSON.stringify(object.detail) : null,
    );
    layer += 1n;
  }

  return normalizedIds;
}

function savePayloads(
  connection: SqliteConnection,
  boardId: string,
  payloads: readonly PayloadRecord[],
) {
  if (!payloads.length) {
    return;
  }

  const upsert = connection.prepare(`
    INSERT INTO object_payloads (board_id, object_id, payload_version, body_kind, body_json)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (board_id, object_id) DO UPDATE SET
      payload_version = excluded.payload_version,
      body_kind = excluded.body_kind,
      body_json = excluded.body_json
  `);

  for (const payload of payloads) {
    upsert.run(
      boardId,
      payload.objectId,
      payload.payloadVersion,
      payload.bodyKind,
      JSON.stringify(payload.data),
    );
  }
}

function decodeLayerRank(value: unknown): bigint {
  if (typeof value !== 'bigint') {
    throw new Error('Invalid stored object layer rank.');
  }

  return value;
}

function readLayerRanks(connection: SqliteConnection, boardId: string): readonly RankedObject[] {
  const query = connection.prepare(`
    SELECT object_id, layer_index FROM board_objects WHERE board_id = ?
    ORDER BY layer_index, object_id
  `);
  query.setReadBigInts(true);

  return query.all(boardId).map((row) => ({
    objectId: storedText(row.object_id, 'object_id'),
    rank: decodeLayerRank(row.layer_index),
  }));
}

function writeLayerRanks(
  connection: SqliteConnection,
  boardId: string,
  changes: readonly RankedObject[],
): readonly string[] {
  if (changes.length === 0) {
    return [];
  }

  const ids = changes.map(({ objectId }) => objectId);
  recordObjectHistory(connection, boardId, ids);
  const update = connection.prepare(`
    UPDATE board_objects SET layer_index = ? WHERE board_id = ? AND object_id = ?
  `);

  for (const { objectId, rank } of changes) {
    update.run(rank, boardId, objectId);
  }

  return ids;
}

function layerChanges(
  order: readonly string[],
  positions: ReadonlyMap<string, bigint>,
  rankAt: (index: number) => bigint | undefined,
): readonly RankedObject[] {
  const changes: RankedObject[] = [];
  for (const [index, objectId] of order.entries()) {
    const rank = rankAt(index);
    if (rank === undefined) {
      throw new Error('Missing target layer rank.');
    }

    if (positions.get(objectId) !== rank) {
      changes.push({ objectId, rank });
    }
  }

  return changes;
}

function reserveLayerRanks(connection: SqliteConnection, boardId: string, count: number) {
  const query = connection.prepare(
    'SELECT MAX(layer_index) AS top_rank FROM board_objects WHERE board_id = ?',
  );
  query.setReadBigInts(true);
  const topRank = query.get(boardId)?.top_rank;
  const firstRank = topRank === null ? 0n : decodeLayerRank(topRank) + 1n;
  if (firstRank + BigInt(count - 1) <= maximumLayerRank) {
    return { firstRank, normalizedIds: [] };
  }

  const ranks = readLayerRanks(connection, boardId);
  const positions = new Map(ranks.map(({ objectId, rank }) => [objectId, rank]));
  const changes = layerChanges(
    ranks.map(({ objectId }) => objectId),
    positions,
    BigInt,
  );

  return {
    firstRank: BigInt(ranks.length),
    normalizedIds: writeLayerRanks(connection, boardId, changes),
  };
}

function validLayerOrder(
  order: readonly string[],
  positions: ReadonlyMap<string, bigint>,
): boolean {
  if (
    positions.size !== order.length ||
    new Set(order).size !== positions.size ||
    !order.every((id) => positions.has(id))
  ) {
    return false;
  }

  return true;
}

function boundaryLayerChanges(
  current: readonly RankedObject[],
  order: readonly string[],
  positions: ReadonlyMap<string, bigint>,
  placement: NonNullable<BoardChanges['layerPlacement']>,
): readonly RankedObject[] | undefined {
  const selected = new Set(placement.objectIds);
  const rest = current.filter(({ objectId }) => !selected.has(objectId));
  const atFront = placement.position === 'front';
  const firstSelected = atFront ? rest.length : 0;
  const restStart = atFront ? 0 : selected.size;
  const movedMatch = placement.objectIds.every((id, index) => id === order[firstSelected + index]);
  const restMatch = rest.every(({ objectId }, index) => objectId === order[restStart + index]);
  if (!movedMatch || !restMatch || rest.length + selected.size !== current.length) {
    throw new Error('Layer placement does not match the updated order.');
  }

  const edge = atFront ? rest.at(-1) : rest[0];
  if (!edge) {
    return undefined;
  }

  const count = BigInt(placement.objectIds.length);
  const start = atFront ? edge.rank + layerSpacing : edge.rank - count * layerSpacing;
  const end = start + (count - 1n) * layerSpacing;
  if (start < minimumLayerRank || end > maximumLayerRank) {
    return undefined;
  }

  return layerChanges(
    placement.objectIds,
    positions,
    (index) => start + BigInt(index) * layerSpacing,
  );
}

function writeLayerOrder(
  connection: SqliteConnection,
  boardId: string,
  order: BoardChanges['order'],
  placement: BoardChanges['layerPlacement'],
): readonly string[] {
  if (!order) {
    return [];
  }

  const current = readLayerRanks(connection, boardId);
  const positions = new Map(current.map(({ objectId, rank }) => [objectId, rank]));
  if (!validLayerOrder(order, positions)) {
    throw new Error('Updated layer order must describe exactly the objects in the board.');
  }
  if (order.every((id, index) => current[index]?.objectId === id)) {
    return [];
  }

  const hasUniqueRanks = new Set(positions.values()).size === positions.size;
  const sparse =
    placement && hasUniqueRanks
      ? boundaryLayerChanges(current, order, positions, placement)
      : undefined;
  const canReuseRanks = !placement && hasUniqueRanks;
  const rankAt = canReuseRanks ? (index: number) => current[index]?.rank : BigInt;
  const changes = sparse ?? layerChanges(order, positions, rankAt);

  return writeLayerRanks(connection, boardId, changes);
}

interface ChangeLists {
  readonly objects: readonly BoardObject[];
  readonly removedObjectIds: readonly string[];
  readonly payloads: readonly PayloadRecord[];
  readonly removedPayloadObjectIds: readonly string[];
}

function persistChanges(connection: SqliteConnection, boardId: string, change: ChangeLists) {
  const { objects, removedObjectIds, payloads, removedPayloadObjectIds } = change;
  const objectIds = [...new Set([...objects.map(({ objectId }) => objectId), ...removedObjectIds])];
  const payloadIds = [
    ...new Set([
      ...payloads.map(({ objectId }) => objectId),
      ...removedPayloadObjectIds,
      ...removedObjectIds,
    ]),
  ];

  recordObjectHistory(connection, boardId, objectIds);
  recordPayloadHistory(connection, boardId, payloadIds);
  recordUsedIds(connection, boardId, objectIds);
  removeObjects(connection, boardId, removedObjectIds, 'board_objects');
  removeObjects(connection, boardId, removedPayloadObjectIds, 'object_payloads');
  const normalizedLayerIds = storeObjects(connection, boardId, objects);
  savePayloads(connection, boardId, payloads);

  return { metadataIds: [...new Set([...objectIds, ...payloadIds])], normalizedLayerIds };
}

export function applyBoardChanges(
  connection: SqliteConnection,
  board: BoardHeader,
  changes: BoardChanges,
  commit: Omit<BoardVersionCommit, 'changedObjectCount'>,
  getObjects: (ids: readonly string[]) => readonly BoardObject[],
): BoardEditApplied {
  const { boardId } = board;
  const {
    objects = [],
    removedObjectIds = [],
    payloads = [],
    removedPayloadObjectIds = [],
    order,
    layerPlacement,
    assets,
  } = changes;

  saveAssets(connection, boardId, assets);
  const { metadataIds, normalizedLayerIds } = persistChanges(connection, boardId, {
    objects,
    removedObjectIds,
    payloads,
    removedPayloadObjectIds,
  });
  const orderedIds = writeLayerOrder(connection, boardId, order, layerPlacement);
  const changed = new Set([...metadataIds, ...normalizedLayerIds, ...orderedIds]);
  let boardRevision = board.revision;
  if (changed.size) {
    boardRevision = advanceBoardRevision(connection, boardId);
    publishBoardVersion(connection, board, boardRevision, {
      ...commit,
      changedObjectCount: changed.size,
    });
  }

  return {
    kind: 'applied',
    boardRevision,
    objects: metadataIds.length ? getObjects(metadataIds) : [],
    removedObjectIds,
    payloads,
    removedPayloadObjectIds,
    order,
  };
}
