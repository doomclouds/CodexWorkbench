import type {
  BoardAccess,
  BoardHeader,
  BoardObject,
  PayloadRecord,
  StoredReceipt,
  WhiteboardReader,
  WhiteboardRepository,
  WhiteboardWriter,
} from '../../modules/whiteboard/ports/index.js';
import type { SqliteConnection, SqliteDatabase } from '../platform/index.js';
import { decodeReceiptObject, decodeSceneObject } from './board-object-storage.js';
import {
  decodeJson,
  decodePayload,
  storedArray,
  storedDecimalVersion,
  storedRecord,
  storedSqliteBool,
  storedText,
  storedVersion,
} from './stored-values.js';
import { whiteboardSchema } from './whiteboard-schema.js';

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
  ...params: string[]
): BoardObject[] {
  const query = connection.prepare(statement);
  query.setReadBigInts(true);

  return query.all(...params).map(decodeSceneObject);
}

function readAccess(
  connection: SqliteConnection,
  boardId: string,
  actorId: string,
): BoardAccess | undefined {
  const query = connection.prepare(`
    SELECT m.can_edit
    FROM board_members AS m
    LEFT JOIN board_lifecycle AS l ON l.board_id = m.board_id
    WHERE m.board_id = ? AND m.actor_id = ? AND l.trashed_at_millis IS NULL
  `);
  query.setReadBigInts(true);
  const row = query.get(boardId, actorId);

  return row && { canEdit: storedSqliteBool(row.can_edit, 'can_edit') };
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

function advanceBoardRevision(connection: SqliteConnection, boardId: string): bigint {
  const update = connection.prepare(`
    UPDATE boards SET revision = revision + 1
    WHERE board_id = ?
    RETURNING revision
  `);
  update.setReadBigInts(true);
  const row = update.get(boardId);

  return storedVersion(row?.revision, 'revision');
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

function createReader(connection: SqliteConnection): WhiteboardReader {
  return {
    getAccess: (boardId, actorId) => readAccess(connection, boardId, actorId),
    getBoard: (boardId) => readBoard(connection, boardId),
    listObjects: (boardId) => readObjects(connection, listScene, boardId),
    getObjects: (boardId, objectIds) =>
      objectIds.length === 0
        ? []
        : readObjects(connection, listTargets, JSON.stringify(objectIds), boardId),
    getPayloads: (boardId, objectIds) => readPayloads(connection, boardId, objectIds),
    getReceipt: (boardId, actorId, commandId) =>
      readReceipt(connection, boardId, actorId, commandId),
  };
}

function createWriter(connection: SqliteConnection): WhiteboardWriter {
  return {
    ...createReader(connection),
    listGroupObjects: (boardId, groupId) => readObjects(connection, listGroup, boardId, groupId),
    listChildObjects: (boardId, parentId) =>
      readObjects(connection, listChildren, boardId, parentId),
    saveGeometry: (boardId, objects) => saveGeometry(connection, boardId, objects),
    advanceBoardRevision: (boardId) => advanceBoardRevision(connection, boardId),
    saveReceipt: (actorId, stored) => saveReceipt(connection, actorId, stored),
  };
}

export function createWhiteboardRepository(database: SqliteDatabase): WhiteboardRepository {
  database.write((connection) => connection.exec(whiteboardSchema));

  return {
    read: (work) => database.read((connection) => work(createReader(connection))),
    write: (work) => database.write((connection) => work(createWriter(connection))),
  };
}
