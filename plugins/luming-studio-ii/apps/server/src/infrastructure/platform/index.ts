import { DatabaseSync } from 'node:sqlite';
import type { SQLOutputValue } from 'node:sqlite';

export { loadGuestWebAssets } from './guest-web-assets.js';
export { loadMcpRuntime } from './mcp-runtime.js';
export { createMcpSpool } from './mcp-spool.js';
export { renderSvgPng, renderSvgUpload } from './png-renderer.js';

export type SqliteConnection = Pick<DatabaseSync, 'exec' | 'prepare'>;
export type SqliteRow = Record<string, SQLOutputValue>;

export interface SqliteDatabase {
  read<T>(work: (connection: SqliteConnection) => T): T;
  write<T>(work: (connection: SqliteConnection) => T): T;
  close(): void;
}

function rollback(connection: DatabaseSync, error: unknown): never {
  if (!connection.isTransaction) {
    throw error;
  }

  try {
    connection.exec('ROLLBACK');
  } catch (rollbackError) {
    throw new AggregateError(
      [error, rollbackError],
      'Failed to roll back the SQLite transaction.',
      {
        cause: rollbackError,
      },
    );
  }

  throw error;
}

function transaction<T>(
  connection: DatabaseSync,
  begin: 'BEGIN' | 'BEGIN IMMEDIATE',
  work: (connection: SqliteConnection) => T,
): T {
  connection.exec(begin);

  try {
    const result = work(connection);
    connection.exec('COMMIT');

    return result;
  } catch (error) {
    return rollback(connection, error);
  }
}

export function openSqliteDatabase(filename: string): SqliteDatabase {
  const connection = new DatabaseSync(filename, { enableForeignKeyConstraints: true });

  return {
    read: (work) => transaction(connection, 'BEGIN', work),
    write: (work) => transaction(connection, 'BEGIN IMMEDIATE', work),
    close: () => connection.close(),
  };
}
