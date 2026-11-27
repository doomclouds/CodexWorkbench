import type { SqliteConnection } from '../../platform/index.js';

interface BoardAccess {
  readonly canEdit: boolean;
  readonly canComment: boolean;
  readonly isOwner: boolean;
  readonly role: 'owner' | 'editor' | 'commenter' | 'viewer';
  readonly name?: string;
}

interface ActiveBoardGuest {
  readonly role: Exclude<BoardAccess['role'], 'owner'>;
  readonly name: string;
  readonly scope: 'local' | 'lan';
  readonly version: bigint;
}

function readFlag(value: unknown): boolean {
  if (value !== 0n && value !== 1n) {
    throw new Error('Invalid stored board access flag.');
  }

  return value === 1n;
}

function localAccess(
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

  if (row) {
    const canEdit = readFlag(row.can_edit);
    const isOwner = readFlag(row.is_owner);
    const memberRole = canEdit ? 'editor' : 'viewer';

    return { canEdit, canComment: canEdit, isOwner, role: isOwner ? 'owner' : memberRole };
  }
}

const guestActorId = /^guest-[a-f0-9-]{36}$/u;

export function readActiveBoardGuest(
  connection: SqliteConnection,
  boardId: string,
  actorId: string,
  now?: number,
): ActiveBoardGuest | undefined {
  if (!guestActorId.test(actorId)) {
    return undefined;
  }

  const query = connection.prepare(`
    SELECT m.role, m.name, s.scope, s.version
    FROM board_sharing_members AS m
    JOIN sharing_browser_sessions AS b ON b.actor_id = m.actor_id
    JOIN board_sharing AS s ON s.board_id = m.board_id AND s.enabled = 1
    JOIN board_sharing_invites AS i
      ON i.board_id = m.board_id AND i.role = m.role AND i.enabled = 1
      AND i.version = m.invitation_version
    LEFT JOIN board_lifecycle AS l ON l.board_id = m.board_id
    WHERE m.board_id = ? AND m.actor_id = ? AND m.removed = 0
      AND l.trashed_at_millis IS NULL
      AND b.expires_at_millis > COALESCE(?, CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER))
  `);
  query.setReadBigInts(true);
  const row = query.get(boardId, actorId, now ?? null);

  if (!row) {
    return undefined;
  }

  const { role, name, scope, version } = row;
  const validRole = role === 'editor' || role === 'commenter' || role === 'viewer';
  const validScope = scope === 'local' || scope === 'lan';
  const validMetadata = typeof name === 'string' && typeof version === 'bigint';
  if (!validRole || !validScope || !validMetadata) {
    throw new Error('Invalid stored guest access.');
  }

  return { role, name, scope, version };
}

export function readBoardAccess(
  connection: SqliteConnection,
  boardId: string,
  actorId: string,
): BoardAccess | undefined {
  const local = localAccess(connection, boardId, actorId);
  if (local) {
    return local;
  }

  const guest = readActiveBoardGuest(connection, boardId, actorId);
  if (guest) {
    const { role, name } = guest;

    return {
      canEdit: role === 'editor',
      canComment: role !== 'viewer',
      isOwner: false,
      role,
      name,
    };
  }
}
