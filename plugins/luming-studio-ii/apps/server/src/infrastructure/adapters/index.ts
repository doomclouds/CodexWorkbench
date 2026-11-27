import type {
  BoardEditReader,
  BoardEditRepository,
  BoardEditWriter,
  BoardHeader,
  BoardObject,
  BoardEditPlanningReader,
  BoardSuggestionRepository,
  ExportAssetRead,
  PayloadRecord,
  StoredReceipt,
} from '../../modules/whiteboard/ports/index.js';
import type { SqliteConnection, SqliteDatabase } from '../platform/index.js';
import { readBoardAccess } from './authorization/index.js';
import {
  advanceBoardRevision,
  applyBoardChanges,
  boardEditSchema,
  hasUsedObjectId,
} from './board-edit-storage.js';
import { readEditReceipt, saveEditReceipt } from './board-edit-receipts.js';
import {
  boardHistorySchema,
  publishBoardVersion,
  readBoardVersion,
  readBoardVersions,
  readVersionObjects,
  readVersionPayloadByteSize,
  readVersionPayloads,
  recordObjectHistory,
} from './board-history-storage.js';
import { decodeReceiptObject, decodeSceneObject } from './board-object-storage.js';
import {
  decodeJson,
  decodePayload,
  storedArray,
  storedDecimalVersion,
  storedRecord,
  storedText,
  storedVersion,
} from './stored-values.js';
import { whiteboardSchema } from './whiteboard-schema.js';
import {
  boardSuggestionsSchema,
  createSuggestionMutations,
  createSuggestionQueries,
} from './board-suggestions.js';

const sceneFields = `
  SELECT o.object_id, o.kind, o.label, o.x, o.y, o.width, o.height, o.rotation,
         o.geometry_version, p.payload_version, o.locked, o.parent_id, o.group_id,
         o.appearance_json, o.detail_json
`;
const payloadVersionJoin = `
  LEFT JOIN object_payloads AS p INDEXED BY object_payloads_versions
    ON p.board_id = o.board_id AND p.object_id = o.object_id
`;
const sceneOrder = 'ORDER BY o.layer_index, o.object_id';
const scopedScene = `
  ${sceneFields}
  FROM board_objects AS o
  ${payloadVersionJoin}
  WHERE o.board_id = ?
`;
const listScene = `${scopedScene} ${sceneOrder}`;
const listGroup = `${scopedScene} AND o.group_id = ? ${sceneOrder}`;
const listChildren = `${scopedScene} AND o.parent_id = ? ${sceneOrder}`;
const listTargets = `
  ${sceneFields}
  FROM (SELECT DISTINCT value AS object_id FROM json_each(?)) AS target
  CROSS JOIN board_objects AS o ON o.board_id = ? AND o.object_id = target.object_id
  ${payloadVersionJoin}
  ${sceneOrder}
`;

function readObjects(
  connection: SqliteConnection,
  statement: string,
  ...params: (string | number)[]
): BoardObject[] {
  const query = connection.prepare(statement);
  query.setReadBigInts(true);

  return query.all(...params).map(decodeSceneObject);
}

function readBoard(connection: SqliteConnection, boardId: string): BoardHeader | undefined {
  const query = connection.prepare('SELECT title, revision FROM boards WHERE board_id = ?');
  query.setReadBigInts(true);
  const row = query.get(boardId);
  if (!row) {
    return undefined;
  }

  return {
    boardId,
    title: storedText(row.title, 'title'),
    revision: storedVersion(row.revision, 'revision'),
  };
}

function readPayloads(
  connection: SqliteConnection,
  boardId: string,
  objectIds: readonly string[],
): PayloadRecord[] {
  if (objectIds.length === 0) {
    return [];
  }

  const query = connection.prepare(`
    SELECT object_id, payload_version, body_kind, body_json
    FROM object_payloads
    WHERE board_id = ? AND object_id IN (SELECT value FROM json_each(?))
  `);
  query.setReadBigInts(true);

  return query.all(boardId, JSON.stringify(objectIds)).map((row) => ({
    objectId: storedText(row.object_id, 'object_id'),
    payloadVersion: storedVersion(row.payload_version, 'payload_version'),
    bodyKind: storedText(row.body_kind, 'body_kind'),
    data: decodePayload(row.body_json),
  }));
}

function readPayloadByteSize(
  connection: SqliteConnection,
  boardId: string,
  objectIds: readonly string[],
  revision?: bigint,
): bigint {
  if (revision !== undefined) {
    return readVersionPayloadByteSize(connection, boardId, revision, objectIds);
  }
  if (objectIds.length === 0) {
    return 0n;
  }

  const query = connection.prepare(`
    SELECT coalesce(sum(length(cast(body_json AS BLOB))), 0) AS total_bytes
    FROM object_payloads
    WHERE board_id = ? AND object_id IN (SELECT value FROM json_each(?))
  `);
  query.setReadBigInts(true);

  return storedVersion(query.get(boardId, JSON.stringify(objectIds))?.total_bytes, 'total_bytes');
}

function readExportAsset(
  connection: SqliteConnection,
  boardId: string,
  assetId: string,
  maximumBytes: number,
): ExportAssetRead | undefined {
  const row = connection
    .prepare(`
      SELECT mime_type, CASE WHEN length(bytes) <= ? THEN bytes END AS bytes
      FROM board_archive_assets
      WHERE board_id = ? AND asset_id = ?
    `)
    .get(maximumBytes, boardId, assetId);

  if (!row) {
    return undefined;
  }
  if (row.bytes === null) {
    return { kind: 'tooLarge' };
  }
  if (!(row.bytes instanceof Uint8Array)) {
    throw new Error('Invalid archived asset bytes.');
  }

  return {
    kind: 'asset',
    asset: {
      mimeType: storedText(row.mime_type, 'asset mime type'),
      byteLength: row.bytes.byteLength,
      base64: Buffer.from(row.bytes).toString('base64'),
    },
  };
}

function readReceipt(
  connection: SqliteConnection,
  boardId: string,
  actorId: string,
  commandId: string,
): StoredReceipt | undefined {
  const row = connection
    .prepare(`
    SELECT signature, receipt_json
    FROM command_receipts
    WHERE board_id = ? AND actor_id = ? AND command_id = ?
  `)
    .get(boardId, actorId, commandId);

  if (!row) {
    return undefined;
  }

  const data = storedRecord(decodeJson(row.receipt_json, 'receipt_json'), 'receipt_json');

  return {
    signature: storedText(row.signature, 'signature'),
    receipt: {
      boardId,
      commandId,
      outcome: {
        kind: 'applied',
        boardRevision: storedDecimalVersion(data.boardRevision, 'boardRevision'),
        objects: storedArray(data.objects, 'objects').map(decodeReceiptObject),
      },
    },
  };
}

function saveGeometry(
  connection: SqliteConnection,
  boardId: string,
  objects: readonly BoardObject[],
): void {
  recordObjectHistory(
    connection,
    boardId,
    objects.map(({ objectId }) => objectId),
  );
  const update = connection.prepare(`
    UPDATE board_objects
    SET x = ?, y = ?, detail_json = ?, geometry_version = ?
    WHERE board_id = ? AND object_id = ? AND geometry_version = ?
  `);
  update.setReadBigInts(true);

  for (const object of objects) {
    const { objectId, geometry, geometryVersion, detail } = object;
    const detailJson = detail === undefined ? null : JSON.stringify(detail);
    const result = update.run(
      geometry.x,
      geometry.y,
      detailJson,
      geometryVersion,
      boardId,
      objectId,
      geometryVersion - 1n,
    );

    if (result.changes !== 1n) {
      throw new Error('The object geometry changed before the transaction updated it.');
    }
  }
}

function saveReceipt(connection: SqliteConnection, actorId: string, stored: StoredReceipt): void {
  const { boardId, commandId, outcome } = stored.receipt;
  if (outcome.kind !== 'applied') {
    throw new Error('Only applied commands have a durable receipt.');
  }

  const receiptJson = JSON.stringify({
    boardRevision: outcome.boardRevision.toString(),
    objects: outcome.objects.map((object) => ({
      ...object,
      geometryVersion: object.geometryVersion.toString(),
      payloadVersion: object.payloadVersion?.toString(),
    })),
  });

  connection
    .prepare(`
    INSERT INTO command_receipts (board_id, actor_id, command_id, signature, receipt_json)
    VALUES (?, ?, ?, ?, ?)
  `)
    .run(boardId, actorId, commandId, stored.signature, receiptJson);
}

function createReader(connection: SqliteConnection): BoardEditReader {
  return {
    getAccess: (boardId, actorId) => {
      const access = readBoardAccess(connection, boardId, actorId);

      return access && { canEdit: access.canEdit };
    },
    getBoard: (boardId) => readBoard(connection, boardId),
    listObjects: (boardId, limit) =>
      limit === undefined
        ? readObjects(connection, listScene, boardId)
        : readObjects(connection, listScene + ' LIMIT ?', boardId, limit),
    getObjects: (boardId, objectIds) =>
      objectIds.length === 0
        ? []
        : readObjects(connection, listTargets, JSON.stringify(objectIds), boardId),
    getPayloads: (boardId, objectIds) => readPayloads(connection, boardId, objectIds),
    payloadByteSize: (boardId, ids, revision) =>
      readPayloadByteSize(connection, boardId, ids, revision),
    getExportAsset: (boardId, assetId, maximumBytes) =>
      readExportAsset(connection, boardId, assetId, maximumBytes),
    getReceipt: (boardId, actorId, commandId) =>
      readReceipt(connection, boardId, actorId, commandId),
    getEditReceipt: (boardId, actorId, commandId) =>
      readEditReceipt(connection, boardId, actorId, commandId),
    listVersions: (boardId, before, limit) => readBoardVersions(connection, boardId, before, limit),
    getVersion: (boardId, revision) => readBoardVersion(connection, boardId, revision),
    listVersionObjects: (boardId, revision, objectIds) =>
      readVersionObjects(connection, boardId, revision, objectIds),
    getVersionPayloads: (boardId, revision, objectIds) =>
      readVersionPayloads(connection, boardId, revision, objectIds),
  };
}

function readRelatedConnectors(
  connection: SqliteConnection,
  boardId: string,
  ids: readonly string[],
) {
  if (!ids.length) {
    return [];
  }

  const query = `
    WITH attached AS (
      SELECT connector.object_id
      FROM json_each(?) AS target
      CROSS JOIN board_objects AS connector INDEXED BY board_connector_start
        ON connector.board_id = ? AND connector.kind = 'connector'
        AND json_extract(connector.detail_json, '$.start.attachment.objectId') = target.value
      UNION
      SELECT connector.object_id
      FROM json_each(?) AS target
      CROSS JOIN board_objects AS connector INDEXED BY board_connector_end
        ON connector.board_id = ? AND connector.kind = 'connector'
        AND json_extract(connector.detail_json, '$.end.attachment.objectId') = target.value
    )
    ${sceneFields}
    FROM attached
    CROSS JOIN board_objects AS o ON o.board_id = ? AND o.object_id = attached.object_id
    ${payloadVersionJoin}
    ${sceneOrder}
  `;
  const targets = JSON.stringify(ids);

  return readObjects(connection, query, targets, boardId, targets, boardId, boardId);
}

function createPlanningReader(
  connection: SqliteConnection,
): BoardEditReader & BoardEditPlanningReader {
  const reader = createReader(connection);

  return {
    ...reader,
    listGroupObjects: (boardId, groupId) => readObjects(connection, listGroup, boardId, groupId),
    listChildObjects: (boardId, parentId) =>
      readObjects(connection, listChildren, boardId, parentId),
    hasUsedObjectId: (boardId, objectId) => hasUsedObjectId(connection, boardId, objectId),
    listRelatedConnectors: (boardId, ids) => readRelatedConnectors(connection, boardId, ids),
  };
}

function createWriter(connection: SqliteConnection): BoardEditWriter {
  const reader = createPlanningReader(connection);

  return {
    ...reader,
    saveGeometry: (boardId, objects) => saveGeometry(connection, boardId, objects),
    advanceBoardRevision(boardId, commit) {
      const before = commit ? readBoard(connection, boardId) : undefined;
      const revision = advanceBoardRevision(connection, boardId);
      if (before && commit) {
        publishBoardVersion(connection, before, revision, commit);
      }

      return revision;
    },
    saveReceipt: (actorId, stored) => saveReceipt(connection, actorId, stored),
    applyBoardChanges: (board, changes, commit) =>
      applyBoardChanges(connection, board, changes, commit, (ids) =>
        reader.getObjects(board.boardId, ids),
      ),
    saveEditReceipt: (actorId, stored) => saveEditReceipt(connection, actorId, stored),
  };
}

export function createWhiteboardRepository(database: SqliteDatabase): BoardEditRepository {
  database.write((connection) => {
    connection.exec(whiteboardSchema);
    connection.exec(boardEditSchema);
    connection.exec(boardHistorySchema);
  });

  return {
    read: (work) => database.read((connection) => work(createReader(connection))),
    write: (work) => database.write((connection) => work(createWriter(connection))),
  };
}

export function createBoardSuggestionRepository(
  database: SqliteDatabase,
): BoardSuggestionRepository {
  database.write((connection) => connection.exec(boardSuggestionsSchema));

  return {
    read: (work) =>
      database.read((connection) =>
        work({ ...createPlanningReader(connection), ...createSuggestionQueries(connection) }),
      ),
    write: (work) =>
      database.write((connection) =>
        work({
          ...createWriter(connection),
          ...createSuggestionQueries(connection),
          ...createSuggestionMutations(connection),
        }),
      ),
  };
}
