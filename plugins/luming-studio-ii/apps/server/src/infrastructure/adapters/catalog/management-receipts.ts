import type {
  CatalogBoardSummary,
  CatalogManagementReceipt,
  CatalogRejectionReason,
  StoredCatalogReceipt,
} from '../../../modules/catalog/ports/index.js';
import type { SqliteConnection } from '../../platform/index.js';

type ReceiptRecord = Readonly<Record<string, unknown>>;

function text(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Invalid stored catalog receipt text.');
  }

  return value;
}

function record(value: unknown): ReceiptRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid stored catalog receipt object.');
  }

  return value as ReceiptRecord;
}

function unsigned(value: unknown): bigint {
  const decoded = BigInt(text(value));
  if (decoded < 0n) {
    throw new Error('Invalid stored catalog receipt version.');
  }

  return decoded;
}

function readBoard(value: unknown): CatalogBoardSummary {
  const { boardId, title, updatedAtMillis, pinned, entryVersion, canManage } = record(value);
  if (typeof pinned !== 'boolean' || typeof canManage !== 'boolean') {
    throw new Error('Invalid stored catalog receipt flags.');
  }

  return {
    boardId: text(boardId),
    title: text(title),
    updatedAtMillis: updatedAtMillis === undefined ? undefined : unsigned(updatedAtMillis),
    pinned,
    entryVersion: unsigned(entryVersion),
    canManage,
  };
}

function readReason(value: unknown): CatalogRejectionReason {
  switch (value) {
    case 'invalidTitle':
    case 'commandIdReuse':
    case 'forbidden':
    case 'entryVersionChanged':
    case 'stateChanged':
    case 'invalidCommand':
      return value;
    default:
      throw new Error('Invalid stored catalog rejection reason.');
  }
}

function readReceipt(json: string): CatalogManagementReceipt {
  const decoded: unknown = JSON.parse(json);
  const value = record(decoded);
  const commandId = text(value.commandId);
  switch (value.kind) {
    case 'changed':
      return { kind: 'changed', commandId, board: readBoard(value.board) };
    case 'purged': {
      if (!Array.isArray(value.items)) {
        throw new Error('Invalid stored catalog purge items.');
      }

      return { kind: 'purged', commandId, items: value.items.map(readPurgeItem) };
    }
    case 'rejected':
      return { kind: 'rejected', commandId, reason: readReason(value.reason) };
    default:
      throw new Error('Invalid stored catalog receipt kind.');
  }
}

function readPurgeItem(value: unknown) {
  const item = record(value);
  const boardId = text(item.boardId);
  if (typeof item.deleted !== 'boolean') {
    throw new Error('Invalid stored catalog purge result.');
  }

  return item.deleted
    ? { boardId, deleted: true as const }
    : { boardId, deleted: false as const, reason: readReason(item.reason) };
}

export function getManagementReceipt(
  connection: SqliteConnection,
  actorId: string,
  commandId: string,
): StoredCatalogReceipt | undefined {
  const row = connection
    .prepare(`
      SELECT signature, receipt_json
      FROM catalog_management_receipts
      WHERE actor_id = ? AND command_id = ?
    `)
    .get(actorId, commandId);

  return row && { signature: text(row.signature), receipt: readReceipt(text(row.receipt_json)) };
}

export function saveManagementReceipt(
  connection: SqliteConnection,
  actorId: string,
  signature: string,
  receipt: CatalogManagementReceipt,
): void {
  const json = JSON.stringify(receipt, (_, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
  connection
    .prepare(`
      INSERT INTO catalog_management_receipts (actor_id, command_id, signature, receipt_json)
      VALUES (?, ?, ?, ?)
    `)
    .run(actorId, receipt.commandId, signature, json);
}
