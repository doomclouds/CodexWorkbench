import type { SharingRepository, SharingWriter } from '../../../modules/sharing/ports/index.js';
import type { SqliteConnection, SqliteDatabase } from '../../platform/index.js';
import { createSharingReader } from './reader.js';
import { sharingSchema } from './schema.js';

function createSharingWriter(connection: SqliteConnection): SharingWriter {
  return {
    ...createSharingReader(connection),
    saveSettings(boardId, { enabled, scope, version }) {
      connection
        .prepare(`
        INSERT INTO board_sharing (board_id, enabled, scope, version) VALUES (?, ?, ?, ?)
        ON CONFLICT (board_id) DO UPDATE SET
          enabled = excluded.enabled, scope = excluded.scope, version = excluded.version
      `)
        .run(boardId, Number(enabled), scope, version);
    },
    saveInvitation(boardId, { role, enabled, version, seed }) {
      connection
        .prepare(`
        INSERT INTO board_sharing_invites (board_id, role, enabled, version, seed)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (board_id, role) DO UPDATE SET enabled = excluded.enabled,
          version = excluded.version, seed = excluded.seed
      `)
        .run(boardId, role, Number(enabled), version, seed);
    },
    saveMember(
      boardId,
      { actorId, name, nameKey, role, invitationVersion, removed, lastSeenAtMillis },
    ) {
      connection
        .prepare(`
        INSERT INTO board_sharing_members (
          board_id, actor_id, name, name_key, role, invitation_version, removed, last_seen_at_millis
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (board_id, actor_id) DO UPDATE SET name = excluded.name, name_key = excluded.name_key,
          role = excluded.role, invitation_version = excluded.invitation_version, removed = excluded.removed,
          last_seen_at_millis = COALESCE(excluded.last_seen_at_millis, board_sharing_members.last_seen_at_millis)
      `)
        .run(
          boardId,
          actorId,
          name,
          nameKey,
          role,
          invitationVersion,
          Number(removed),
          lastSeenAtMillis ?? null,
        );
    },
    touchMember(boardId, actorId, now) {
      connection
        .prepare(`
        UPDATE board_sharing_members SET last_seen_at_millis = ?
        WHERE board_id = ? AND actor_id = ? AND removed = 0
          AND (last_seen_at_millis IS NULL OR last_seen_at_millis < ?)
      `)
        .run(now, boardId, actorId, now);
    },
    deleteMember(boardId, actorId) {
      connection
        .prepare('DELETE FROM board_sharing_members WHERE board_id = ? AND actor_id = ?')
        .run(boardId, actorId);
    },
    saveBrowserSession(tokenHash, { actorId, expiresAt }) {
      connection
        .prepare(`
        INSERT INTO sharing_browser_sessions (token_hash, actor_id, expires_at_millis) VALUES (?, ?, ?)
      `)
        .run(tokenHash, actorId, expiresAt);
    },
    saveReceipt(actorId, { signature, receipt }) {
      const { boardId, commandId, outcome } = receipt;
      if (outcome.kind !== 'applied') {
        throw new Error('Only applied sharing commands have durable receipts.');
      }

      connection
        .prepare(`
        INSERT INTO board_sharing_receipts (board_id, actor_id, command_id, signature, version)
        VALUES (?, ?, ?, ?, ?)
      `)
        .run(boardId, actorId, commandId, signature, outcome.version);
    },
  };
}

export function createSharingRepository(database: SqliteDatabase): SharingRepository {
  database.write((connection) => {
    connection.exec(sharingSchema);
    const columns = connection.prepare('PRAGMA table_info(board_sharing_members)').all();
    if (!columns.some(({ name }) => name === 'last_seen_at_millis')) {
      connection.exec('ALTER TABLE board_sharing_members ADD COLUMN last_seen_at_millis INTEGER');
    }
  });

  return {
    read: (work) => database.read((connection) => work(createSharingReader(connection))),
    write: (work) => database.write((connection) => work(createSharingWriter(connection))),
  };
}
