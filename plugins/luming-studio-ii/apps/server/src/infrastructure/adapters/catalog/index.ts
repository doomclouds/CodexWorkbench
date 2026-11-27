import type {
  CatalogBoardSummary,
  CatalogCreatedReceipt,
  CatalogDuplicateFailure,
  CatalogLookup,
  CatalogManagedBoard,
  CatalogOrder,
  CatalogPosition,
  CatalogRepository,
  CatalogTrashedBoard,
  StoredCatalogReceipt,
} from '../../../modules/catalog/ports/index.js';
import type { SqliteConnection, SqliteDatabase, SqliteRow } from '../../platform/index.js';
import { duplicateBoard } from './duplicate-board.js';
import { getManagementReceipt, saveManagementReceipt } from './management-receipts.js';
import { catalogSchema } from './schema.js';
import { readCatalogThumbnail } from './thumbnail.js';

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

const trashOrderings: Readonly<Record<CatalogOrder, CatalogOrdering>> = {
  recent: {
    columns: '-trashed_at_millis, board_id',
    parameters: '-?, ?',
    values: ({ trashedAtMillis, boardId }) => [trashedAtMillis ?? null, boardId],
  },
  title: {
    columns: 'lower(title), board_id',
    parameters: 'lower(?), ?',
    values: ({ title, boardId }) => [title, boardId],
  },
};

const catalogColumns = `
  b.board_id, b.title, c.updated_at_millis,
  COALESCE(c.pinned, 0) AS pinned,
  COALESCE(c.entry_version, 0) AS entry_version,
  COALESCE(l.owner_actor_id = m.actor_id, 0) AS can_manage,
  l.trashed_at_millis
`;
const catalogTables = `
  FROM board_members AS m
  JOIN boards AS b ON b.board_id = m.board_id
  LEFT JOIN catalog_entries AS c ON c.board_id = b.board_id
  LEFT JOIN board_lifecycle AS l ON l.board_id = b.board_id
`;
const activeBoards = 'l.trashed_at_millis IS NULL';
const activePinnedBoards = activeBoards + ' AND c.pinned = 1';
const ownedTrash = 'l.owner_actor_id = m.actor_id AND l.trashed_at_millis IS NOT NULL';

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
    can_manage: canManage,
  } = row;

  if (typeof boardId !== 'string' || typeof title !== 'string') {
    throw new Error('Invalid catalog board identity.');
  }
  if (pinned !== 0n && pinned !== 1n) {
    throw new Error('Invalid catalog pin state.');
  }
  if (canManage !== 0n && canManage !== 1n) {
    throw new Error('Invalid catalog management permission.');
  }

  return {
    boardId,
    title,
    updatedAtMillis:
      updatedAtMillis === null ? undefined : readUnsigned(updatedAtMillis, 'updated_at_millis'),
    pinned: pinned === 1n,
    entryVersion: readUnsigned(entryVersion, 'entry_version'),
    canManage: canManage === 1n,
  };
}

function readListSummary(row: SqliteRow): CatalogBoardSummary {
  return {
    ...readSummary(row),
    previewRevision: readUnsigned(row.preview_revision, 'preview_revision'),
  };
}

function listRows(
  connection: SqliteConnection,
  lookup: CatalogLookup,
  condition: string,
  ordering: CatalogOrdering,
): SqliteRow[] {
  const { actorId, query, limit, after } = lookup;
  const boundary = after ? `WHERE (${ordering.columns}) > (${ordering.parameters})` : '';
  const values = after ? ordering.values(after) : [];
  const statement = connection.prepare(`
    WITH visible AS (
      SELECT ${catalogColumns}, b.revision AS preview_revision
      ${catalogTables}
      WHERE m.actor_id = ? AND instr(lower(b.title), lower(?)) > 0 AND ${condition}
    )
    SELECT board_id, title, updated_at_millis, pinned, entry_version, can_manage,
      trashed_at_millis, preview_revision
    FROM visible
    ${boundary}
    ORDER BY ${ordering.columns}
    LIMIT ?
  `);
  statement.setReadBigInts(true);

  return statement.all(actorId, query, ...values, limit);
}

function listBoards(connection: SqliteConnection, lookup: CatalogLookup): CatalogBoardSummary[] {
  const condition = lookup.pinnedOnly ? activePinnedBoards : activeBoards;

  return listRows(connection, lookup, condition, catalogOrderings[lookup.order]).map(
    readListSummary,
  );
}

function listTrashedBoards(
  connection: SqliteConnection,
  lookup: CatalogLookup,
): CatalogTrashedBoard[] {
  return listRows(connection, lookup, ownedTrash, trashOrderings[lookup.order]).map((row) => ({
    board: readListSummary(row),
    trashedAtMillis: readUnsigned(row.trashed_at_millis, 'trashed_at_millis'),
  }));
}

function getCreatedReceipt(
  connection: SqliteConnection,
  actorId: string,
  commandId: string,
): StoredCatalogReceipt | undefined {
  const statement = connection.prepare(`
    SELECT c.board_id, c.title, c.updated_at_millis, c.pinned, c.entry_version,
      1 AS can_manage, d.source_board_id
    FROM catalog_create_receipts AS c
    LEFT JOIN catalog_duplicate_sources AS d
      ON d.actor_id = c.actor_id AND d.command_id = c.command_id
    WHERE c.actor_id = ? AND c.command_id = ?
  `);
  statement.setReadBigInts(true);
  const row = statement.get(actorId, commandId);

  if (!row) {
    return undefined;
  }

  const { source_board_id: sourceBoardId } = row;
  if (sourceBoardId !== null && typeof sourceBoardId !== 'string') {
    throw new Error('Invalid stored catalogue duplicate source.');
  }

  return {
    receipt: { kind: 'created', commandId, board: readSummary(row) },
    duplicateSourceId: sourceBoardId ?? undefined,
  };
}

function getReceipt(
  connection: SqliteConnection,
  actorId: string,
  commandId: string,
): StoredCatalogReceipt | undefined {
  return (
    getCreatedReceipt(connection, actorId, commandId) ??
    getManagementReceipt(connection, actorId, commandId)
  );
}

function getManagedBoard(
  connection: SqliteConnection,
  actorId: string,
  boardId: string,
): CatalogManagedBoard | undefined {
  const statement = connection.prepare(`
    SELECT ${catalogColumns}
    ${catalogTables}
    WHERE m.actor_id = ? AND b.board_id = ? AND l.owner_actor_id = m.actor_id
  `);
  statement.setReadBigInts(true);
  const row = statement.get(actorId, boardId);
  if (!row) {
    return undefined;
  }

  return {
    board: readSummary(row),
    trashedAtMillis:
      row.trashed_at_millis === null
        ? undefined
        : readUnsigned(row.trashed_at_millis, 'trashed_at_millis'),
  };
}

function changeBoard(connection: SqliteConnection, change: CatalogManagedBoard): void {
  const { board, trashedAtMillis } = change;
  const { boardId, title, updatedAtMillis, entryVersion, pinned } = board;
  if (updatedAtMillis === undefined) {
    throw new Error('Catalog changes require an update timestamp.');
  }

  connection.prepare('UPDATE boards SET title = ? WHERE board_id = ?').run(title, boardId);
  connection
    .prepare(`
      INSERT INTO catalog_entries (board_id, updated_at_millis, pinned, entry_version)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (board_id) DO UPDATE SET
        updated_at_millis = excluded.updated_at_millis,
        pinned = excluded.pinned,
        entry_version = excluded.entry_version
    `)
    .run(boardId, updatedAtMillis, Number(pinned), entryVersion);
  connection
    .prepare('UPDATE board_lifecycle SET trashed_at_millis = ? WHERE board_id = ?')
    .run(trashedAtMillis ?? null, boardId);
}

function deleteBoard(connection: SqliteConnection, boardId: string): void {
  connection.prepare('DELETE FROM boards WHERE board_id = ?').run(boardId);
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

function saveDuplicatedBoard(
  connection: SqliteConnection,
  actorId: string,
  sourceBoardId: string,
  receipt: CatalogCreatedReceipt,
): CatalogDuplicateFailure | undefined {
  const rejected = duplicateBoard(connection, sourceBoardId, receipt.board.boardId, () =>
    saveBoard(connection, actorId, receipt),
  );

  if (rejected) {
    return rejected;
  }

  connection
    .prepare(
      'INSERT INTO catalog_duplicate_sources (actor_id, command_id, source_board_id) VALUES (?, ?, ?)',
    )
    .run(actorId, receipt.commandId, sourceBoardId);

  return undefined;
}

export function createCatalogRepository(database: SqliteDatabase): CatalogRepository {
  database.write((connection) => connection.exec(catalogSchema));

  return {
    listBoards: (lookup) => database.read((connection) => listBoards(connection, lookup)),
    listTrashedBoards: (lookup) =>
      database.read((connection) => listTrashedBoards(connection, lookup)),
    readThumbnail: (lookup, cached) =>
      database.read((connection) => readCatalogThumbnail(connection, lookup, cached)),
    getReceipt: (actorId, commandId) =>
      database.read((connection) => getReceipt(connection, actorId, commandId)?.receipt),
    write: (work) =>
      database.write((connection) =>
        work({
          getReceipt: (actorId, commandId) => getReceipt(connection, actorId, commandId),
          saveBoard: (actorId, receipt) => saveBoard(connection, actorId, receipt),
          duplicateBoard: (actorId, sourceBoardId, receipt) =>
            saveDuplicatedBoard(connection, actorId, sourceBoardId, receipt),
          getManagedBoard: (actorId, boardId) => getManagedBoard(connection, actorId, boardId),
          changeBoard: (board) => changeBoard(connection, board),
          deleteBoard: (boardId) => deleteBoard(connection, boardId),
          saveManagementReceipt: (actorId, signature, receipt) =>
            saveManagementReceipt(connection, actorId, signature, receipt),
        }),
      ),
  };
}
