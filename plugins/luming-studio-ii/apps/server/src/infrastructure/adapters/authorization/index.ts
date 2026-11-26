import type { SqliteConnection } from '../../platform/index.js';

interface BoardAccess {
  readonly canEdit: boolean;
  readonly isOwner: boolean;
}

function readFlag(value: unknown): boolean {
  if (value !== 0n && value !== 1n) {
    throw new Error('Invalid stored board access flag.');
  }

  return value === 1n;
}

export function readBoardAccess(
  connection: SqliteConnection,
  boardId: string,
  actorId: string,
): BoardAccess | undefined {
  const query = connection.prepare(`
    SELECT m.can_edit, COALESCE(l.owner_actor_id = m.actor_id, 0) AS is_owner
    FROM board_members AS m
    JOIN boards AS b ON b.board_id = m.board_id
    LEFT JOIN board_lifecycle AS l ON l.board_id = m.board_id
    WHERE m.board_id = ? AND m.actor_id = ? AND l.trashed_at_millis IS NULL
  `);
  query.setReadBigInts(true);
  const row = query.get(boardId, actorId);

  return row && { canEdit: readFlag(row.can_edit), isOwner: readFlag(row.is_owner) };
}
