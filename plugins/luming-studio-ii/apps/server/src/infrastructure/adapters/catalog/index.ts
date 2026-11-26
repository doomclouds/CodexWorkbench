import type {
  CatalogBoardSummary,
  CatalogCreatedReceipt,
  CatalogLookup,
  CatalogOrder,
  CatalogPosition,
  CatalogRepository,
} from '../../../modules/catalog/ports/index.js';
import type { SqliteConnection, SqliteDatabase, SqliteRow } from '../../platform/index.js';
import { catalogSchema } from './schema.js';

type OrderingValue = bigint | number | string | null;

interface CatalogOrdering {
  readonly columns: string;
  readonly parameters: string;
  values(position: CatalogPosition): readonly OrderingValue[];
}

const catalogOrderings: Readonly<Record<CatalogOrder, CatalogOrdering>> = {
  recent: {
    columns: '-pinned, -COALESCE(updated_at_millis, -1), board_id',
    parameters: '-?, -COALESCE(?, -1), ?',
    values: ({ pinned, updatedAtMillis, boardId }) => [
      Number(pinned),
      updatedAtMillis ?? null,
      boardId,
    ],
  },
  title: {
    columns: '-pinned, lower(title), board_id',
    parameters: '-?, lower(?), ?',
    values: ({ pinned, title, boardId }) => [Number(pinned), title, boardId],
  },
};

const catalogSelection = `
  WITH visible AS (
    SELECT b.board_id, b.title, c.updated_at_millis,
           COALESCE(c.pinned, 0) AS pinned,
           COALESCE(c.entry_version, 0) AS entry_version
    FROM board_members AS m
    JOIN boards AS b ON b.board_id = m.board_id
    LEFT JOIN catalog_entries AS c ON c.board_id = b.board_id
    WHERE m.actor_id = ? AND instr(lower(b.title), lower(?)) > 0
  )
  SELECT board_id, title, updated_at_millis, pinned, entry_version
  FROM visible
`;

function readUnsigned(value: unknown, fieldName: string): bigint {
  if (typeof value !== 'bigint' || value < 0n) {
    throw new Error(`Invalid catalog integer for ${fieldName}.`);
  }

  return value;
}

function readSummary(row: SqliteRow): CatalogBoardSummary {
  const {
    board_id: boardId,
    title,
    updated_at_millis: updatedAtMillis,
    pinned,
    entry_version: entryVersion,
  } = row;

  if (typeof boardId !== 'string' || typeof title !== 'string') {
    throw new Error('Invalid catalog board identity.');
  }
  if (pinned !== 0n && pinned !== 1n) {
    throw new Error('Invalid catalog pin state.');
  }

  return {
    boardId,
    title,
    updatedAtMillis:
      updatedAtMillis === null ? undefined : readUnsigned(updatedAtMillis, 'updated_at_millis'),
    pinned: pinned === 1n,
    entryVersion: readUnsigned(entryVersion, 'entry_version'),
  };
}

function listBoards(connection: SqliteConnection, lookup: CatalogLookup): CatalogBoardSummary[] {
  const { actorId, query, order, limit, after } = lookup;
  const ordering = catalogOrderings[order];
  const boundary = after ? `WHERE (${ordering.columns}) > (${ordering.parameters})` : '';
  const values = after ? ordering.values(after) : [];
  const statement = connection.prepare(`
    ${catalogSelection}
    ${boundary}
    ORDER BY ${ordering.columns}
    LIMIT ?
  `);
  statement.setReadBigInts(true);

  return statement.all(actorId, query, ...values, limit).map(readSummary);
}

function getReceipt(
  connection: SqliteConnection,
  actorId: string,
  commandId: string,
): CatalogCreatedReceipt | undefined {
  const statement = connection.prepare(`
    SELECT board_id, title, updated_at_millis, pinned, entry_version
    FROM catalog_create_receipts
    WHERE actor_id = ? AND command_id = ?
  `);
  statement.setReadBigInts(true);
  const row = statement.get(actorId, commandId);

  return row ? { kind: 'created', commandId, board: readSummary(row) } : undefined;
}

function saveBoard(
  connection: SqliteConnection,
  actorId: string,
  receipt: CatalogCreatedReceipt,
): void {
  const { commandId, board } = receipt;
  const { boardId, title, updatedAtMillis, pinned, entryVersion } = board;
  if (updatedAtMillis === undefined) {
    throw new Error('New catalog entries require an update timestamp.');
  }

  const pinValue = Number(pinned);
  connection
    .prepare('INSERT INTO boards (board_id, title, revision) VALUES (?, ?, 0)')
    .run(boardId, title);
  connection
    .prepare('INSERT INTO board_members (board_id, actor_id, can_edit) VALUES (?, ?, 1)')
    .run(boardId, actorId);
  connection
    .prepare(`
    INSERT INTO catalog_entries (board_id, updated_at_millis, pinned, entry_version)
    VALUES (?, ?, ?, ?)
  `)
    .run(boardId, updatedAtMillis, pinValue, entryVersion);
  connection
    .prepare(`
    INSERT INTO catalog_create_receipts (
      actor_id, command_id, board_id, title, updated_at_millis, pinned, entry_version
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
    .run(actorId, commandId, boardId, title, updatedAtMillis, pinValue, entryVersion);
}

export function createCatalogRepository(database: SqliteDatabase): CatalogRepository {
  database.write((connection) => connection.exec(catalogSchema));

  return {
    listBoards: (lookup) => database.read((connection) => listBoards(connection, lookup)),
    getReceipt: (actorId, commandId) =>
      database.read((connection) => getReceipt(connection, actorId, commandId)),
    write: (work) =>
      database.write((connection) =>
        work({
          getReceipt: (actorId, commandId) => getReceipt(connection, actorId, commandId),
          saveBoard: (actorId, receipt) => saveBoard(connection, actorId, receipt),
        }),
      ),
  };
}
