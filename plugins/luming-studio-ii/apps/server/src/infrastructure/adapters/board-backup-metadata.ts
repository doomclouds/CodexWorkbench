import type { BoardBackupMetadata } from '../../modules/whiteboard/ports/index.js';
import type { SqliteConnection } from '../platform/index.js';
import { readBoardAccess } from './authorization/index.js';

function millis(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid board catalog timestamp.');
  }

  return value;
}

export function readBackupMetadata(
  connection: SqliteConnection,
  boardId: string,
  actorId: string,
): BoardBackupMetadata | undefined {
  if (!readBoardAccess(connection, boardId, actorId)?.isOwner) {
    return undefined;
  }

  const row = connection
    .prepare(`
    SELECT entry.updated_at_millis, entry.pinned,
      (SELECT MIN(created.updated_at_millis) FROM catalog_create_receipts AS created WHERE created.board_id = entry.board_id) AS created_at_millis
    FROM catalog_entries AS entry WHERE entry.board_id = ?
  `)
    .get(boardId);

  if (!row) {
    throw new Error('The whiteboard has no catalog entry.');
  }

  return {
    updatedAtMillis: millis(row.updated_at_millis),
    createdAtMillis: row.created_at_millis === null ? undefined : millis(row.created_at_millis),
    pinned: row.pinned === 1,
  };
}
