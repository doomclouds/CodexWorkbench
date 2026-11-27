import type {
  BoardEditApplied,
  PayloadRecord,
  StoredBoardEditReceipt,
} from '../../modules/whiteboard/ports/index.js';
import type { SqliteConnection } from '../platform/index.js';
import { readVersionObjects, readVersionPayloads } from './board-history-storage.js';
import { decodeReceiptObject } from './board-object-storage.js';
import {
  decodeJson,
  decodePayload,
  storedArray,
  storedBool,
  storedDecimalVersion,
  storedRecord,
  storedText,
  storedVersion,
} from './stored-values.js';

interface PayloadReference {
  readonly objectId: string;
  readonly payloadVersion: bigint;
}

type ReceiptDetails = Pick<BoardEditApplied, 'payloads' | 'order' | 'detailsExpired'>;

function payloadReference(raw: unknown): PayloadReference {
  const value = storedRecord(raw, 'receipt payload reference');

  return {
    objectId: storedText(value.objectId, 'objectId'),
    payloadVersion: storedDecimalVersion(value.payloadVersion, 'payloadVersion'),
  };
}

function serializedReference({ objectId, payloadVersion }: PayloadReference) {
  return { objectId, payloadVersion: payloadVersion.toString() };
}

function hasVersion(connection: SqliteConnection, boardId: string, revision: bigint): boolean {
  const available = connection
    .prepare(`
    SELECT 1 FROM board_versions WHERE board_id = ?1 AND revision = ?2
    UNION ALL
    SELECT 1 FROM boards WHERE board_id = ?1 AND revision = ?2
    LIMIT 1
  `)
    .get(boardId, revision);

  return available !== undefined;
}

function readMatchingCurrentPayloads(
  connection: SqliteConnection,
  boardId: string,
  references: readonly PayloadReference[],
): readonly PayloadRecord[] {
  if (!references.length) {
    return [];
  }

  const query = connection.prepare(`
    SELECT p.object_id, p.payload_version, p.body_kind, p.body_json
    FROM json_each(?) AS expected
    CROSS JOIN object_payloads AS p
      ON p.board_id = ? AND p.object_id = json_extract(expected.value, '$.objectId')
        AND p.payload_version = CAST(json_extract(expected.value, '$.payloadVersion') AS INTEGER)
  `);
  query.setReadBigInts(true);

  return query.all(JSON.stringify(references.map(serializedReference)), boardId).map((row) => ({
    objectId: storedText(row.object_id, 'object_id'),
    payloadVersion: storedVersion(row.payload_version, 'payload_version'),
    bodyKind: storedText(row.body_kind, 'body_kind'),
    data: decodePayload(row.body_json),
  }));
}

function readReceiptDetails(
  connection: SqliteConnection,
  boardId: string,
  revision: bigint,
  snapshot: Record<string, unknown>,
): ReceiptDetails {
  const references = storedArray(snapshot.payloads, 'payloads').map(payloadReference);
  const hasOrder =
    snapshot.hasOrder === undefined
      ? snapshot.order !== undefined
      : storedBool(snapshot.hasOrder, 'hasOrder');

  if (!references.length && !hasOrder) {
    return { payloads: [] };
  }

  const available = hasVersion(connection, boardId, revision);
  const found = available
    ? readVersionPayloads(
        connection,
        boardId,
        revision,
        references.map(({ objectId }) => objectId),
      )
    : readMatchingCurrentPayloads(connection, boardId, references);
  const byId = new Map(found.map((payload) => [payload.objectId, payload]));
  const payloads = references.flatMap(({ objectId, payloadVersion }) => {
    const payload = byId.get(objectId);

    return payload?.payloadVersion === payloadVersion ? [payload] : [];
  });
  const order =
    hasOrder && available
      ? readVersionObjects(connection, boardId, revision).map(({ objectId }) => objectId)
      : undefined;
  const missingDetails = payloads.length !== references.length || (hasOrder && order === undefined);

  return { payloads, order, detailsExpired: missingDetails || undefined };
}

function storedIds(raw: unknown, field: string): readonly string[] {
  return storedArray(raw, field).map((id) => storedText(id, field));
}

export function readEditReceipt(
  connection: SqliteConnection,
  boardId: string,
  actorId: string,
  commandId: string,
): StoredBoardEditReceipt | undefined {
  const row = connection
    .prepare(`
    SELECT signature, receipt_json FROM board_edit_receipts
    WHERE board_id = ? AND actor_id = ? AND command_id = ?
  `)
    .get(boardId, actorId, commandId);

  if (!row) {
    return undefined;
  }

  const value = storedRecord(decodeJson(row.receipt_json, 'receipt_json'), 'receipt_json');
  const boardRevision = storedDecimalVersion(value.boardRevision, 'boardRevision');

  return {
    signature: storedText(row.signature, 'signature'),
    advancedRevision: value.advancedRevision === true || undefined,
    receipt: {
      boardId,
      commandId,
      outcome: {
        kind: 'applied',
        boardRevision,
        objects: storedArray(value.objects, 'objects').map(decodeReceiptObject),
        ...readReceiptDetails(connection, boardId, boardRevision, value),
        removedObjectIds: storedIds(value.removedObjectIds, 'removedObjectIds'),
        layerChangedObjectIds:
          value.layerChangedObjectIds === undefined
            ? undefined
            : storedIds(value.layerChangedObjectIds, 'layerChangedObjectIds'),
        removedPayloadObjectIds: storedIds(
          value.removedPayloadObjectIds,
          'removedPayloadObjectIds',
        ),
      },
    },
  };
}

export function saveEditReceipt(
  connection: SqliteConnection,
  actorId: string,
  { signature, receipt, advancedRevision }: StoredBoardEditReceipt,
) {
  const { boardId, commandId, outcome } = receipt;
  if (outcome.kind !== 'applied') {
    throw new Error('Only applied board changes have a durable receipt.');
  }

  const snapshot = JSON.stringify({
    advancedRevision,
    boardRevision: outcome.boardRevision.toString(),
    objects: outcome.objects.map((object) => ({
      ...object,
      geometryVersion: object.geometryVersion.toString(),
      payloadVersion: object.payloadVersion?.toString(),
    })),
    payloads: outcome.payloads.map(serializedReference),
    removedObjectIds: outcome.removedObjectIds,
    removedPayloadObjectIds: outcome.removedPayloadObjectIds ?? [],
    hasOrder: outcome.order !== undefined,
    layerChangedObjectIds: outcome.layerChangedObjectIds,
  });

  connection
    .prepare(`
    INSERT INTO board_edit_receipts (board_id, actor_id, command_id, signature, receipt_json)
    VALUES (?, ?, ?, ?, ?)
  `)
    .run(boardId, actorId, commandId, signature, snapshot);
}
