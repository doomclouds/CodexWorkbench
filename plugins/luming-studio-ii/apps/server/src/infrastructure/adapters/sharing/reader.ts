import type {
  BrowserSession,
  GuestRole,
  Invitation,
  ShareSettings,
  SharingMember,
  SharingReader,
} from '../../../modules/sharing/ports/index.js';
import type { SqliteConnection, SqliteRow } from '../../platform/index.js';
import { readActiveBoardGuest, readBoardAccess } from '../authorization/index.js';

type SqlValue = string | number | bigint;

function findRows(connection: SqliteConnection, sql: string, ...args: readonly SqlValue[]) {
  const query = connection.prepare(sql);
  query.setReadBigInts(true);

  return query.all(...args);
}

function findRow(connection: SqliteConnection, sql: string, ...args: readonly SqlValue[]) {
  const query = connection.prepare(sql);
  query.setReadBigInts(true);

  return query.get(...args);
}

function readText(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error('Invalid stored sharing text for ' + field + '.');
  }

  return value;
}

function readVersion(value: unknown, field: string): bigint {
  if (typeof value !== 'bigint' || value < 0n) {
    throw new Error('Invalid stored sharing version for ' + field + '.');
  }

  return value;
}

function readFlag(value: unknown, field: string): boolean {
  if (value !== 0n && value !== 1n) {
    throw new Error('Invalid stored sharing flag for ' + field + '.');
  }

  return value === 1n;
}

function readRole(value: unknown): GuestRole {
  if (value === 'editor' || value === 'commenter' || value === 'viewer') {
    return value;
  }

  throw new Error('Invalid stored guest role.');
}

function readScope(value: unknown): ShareSettings['scope'] {
  if (value === 'local' || value === 'lan') {
    return value;
  }

  throw new Error('Invalid stored sharing scope.');
}

function readSettings(row: SqliteRow): ShareSettings {
  return {
    enabled: readFlag(row.enabled, 'enabled'),
    scope: readScope(row.scope),
    version: readVersion(row.version, 'version'),
  };
}

function readInvitation(row: SqliteRow): Invitation {
  return {
    role: readRole(row.role),
    seed: readText(row.seed, 'seed'),
    enabled: readFlag(row.enabled, 'enabled'),
    version: readVersion(row.version, 'version'),
  };
}

function readMember(row: SqliteRow): SharingMember {
  return {
    actorId: readText(row.actor_id, 'actor_id'),
    name: readText(row.name, 'name'),
    nameKey: readText(row.name_key, 'name_key'),
    role: readRole(row.role),
    invitationVersion: readVersion(row.invitation_version, 'invitation_version'),
    removed: readFlag(row.removed, 'removed'),
    lastSeenAtMillis:
      row.last_seen_at_millis === null
        ? undefined
        : Number(readVersion(row.last_seen_at_millis, 'last_seen_at_millis')),
  };
}

function readSession(row: SqliteRow): BrowserSession {
  const expiresAt = Number(readVersion(row.expires_at_millis, 'expires_at_millis'));
  if (!Number.isSafeInteger(expiresAt)) {
    throw new Error('Invalid browser session expiry.');
  }

  return { actorId: readText(row.actor_id, 'actor_id'), expiresAt };
}

const inviteColumns = 'role, seed, enabled, version';
const memberColumns =
  'actor_id, name, name_key, role, invitation_version, removed, last_seen_at_millis';

export function createSharingReader(connection: SqliteConnection): SharingReader {
  return {
    activeSharingScopes() {
      return findRows(
        connection,
        `
        SELECT DISTINCT s.scope
        FROM board_sharing AS s
        JOIN board_lifecycle AS l ON l.board_id = s.board_id
        JOIN board_members AS m ON m.board_id = s.board_id AND m.actor_id = l.owner_actor_id
        WHERE s.enabled = 1 AND l.trashed_at_millis IS NULL
        ORDER BY s.scope
      `,
      ).map(({ scope }) => readScope(scope));
    },
    getBoard(boardId) {
      const row = findRow(
        connection,
        `
        SELECT b.title FROM boards AS b
        LEFT JOIN board_lifecycle AS l ON l.board_id = b.board_id
        WHERE b.board_id = ? AND l.trashed_at_millis IS NULL
      `,
        boardId,
      );

      return row && { boardId, title: readText(row.title, 'title') };
    },
    ownsBoard(boardId, actorId) {
      return readBoardAccess(connection, boardId, actorId)?.isOwner === true;
    },
    getSettings(boardId) {
      const row = findRow(
        connection,
        'SELECT enabled, scope, version FROM board_sharing WHERE board_id = ?',
        boardId,
      );

      return row && readSettings(row);
    },
    listInvitations(boardId) {
      return findRows(
        connection,
        'SELECT ' + inviteColumns + ' FROM board_sharing_invites WHERE board_id = ?',
        boardId,
      ).map(readInvitation);
    },
    listMembers(boardId) {
      return findRows(
        connection,
        'SELECT ' +
          memberColumns +
          ' FROM board_sharing_members WHERE board_id = ? ORDER BY name_key, actor_id',
        boardId,
      ).map(readMember);
    },
    getMember(boardId, actorId) {
      const row = findRow(
        connection,
        'SELECT ' +
          memberColumns +
          ' FROM board_sharing_members WHERE board_id = ? AND actor_id = ?',
        boardId,
        actorId,
      );

      return row && readMember(row);
    },
    getInvitation(boardId, role) {
      const row = findRow(
        connection,
        'SELECT ' + inviteColumns + ' FROM board_sharing_invites WHERE board_id = ? AND role = ?',
        boardId,
        role,
      );

      return row && readInvitation(row);
    },
    findMemberByName(boardId, nameKey) {
      const row = findRow(
        connection,
        'SELECT ' +
          memberColumns +
          ' FROM board_sharing_members WHERE board_id = ? AND name_key = ?',
        boardId,
        nameKey,
      );

      return row && readMember(row);
    },
    getBrowserSession(tokenHash) {
      const row = findRow(
        connection,
        'SELECT actor_id, expires_at_millis FROM sharing_browser_sessions WHERE token_hash = ?',
        tokenHash,
      );

      return row && readSession(row);
    },
    getActiveGuest: (boardId, actorId, now) =>
      readActiveBoardGuest(connection, boardId, actorId, now),
    actorSessionIsActive(actorId, now) {
      return (
        findRow(
          connection,
          'SELECT 1 FROM sharing_browser_sessions WHERE actor_id = ? AND expires_at_millis > ?',
          actorId,
          now,
        ) !== undefined
      );
    },
    getReceipt(boardId, actorId, commandId) {
      const row = findRow(
        connection,
        `
        SELECT signature, version FROM board_sharing_receipts
        WHERE board_id = ? AND actor_id = ? AND command_id = ?
      `,
        boardId,
        actorId,
        commandId,
      );

      if (row) {
        return {
          signature: readText(row.signature, 'signature'),
          receipt: {
            boardId,
            commandId,
            outcome: { kind: 'applied', version: readVersion(row.version, 'version') },
          },
        };
      }
    },
  };
}
