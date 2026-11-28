import type {
  BoardBackupActor,
  BoardBackupDetails,
  BoardBackupMetadata,
} from '../../modules/whiteboard/ports/index.js';
import type { SqliteConnection, SqliteRow } from '../platform/index.js';
import { readBoardAccess } from './authorization/index.js';

function millis(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid board catalog timestamp.');
  }

  return value;
}

function hasTable(connection: SqliteConnection, table: string): boolean {
  return (
    connection
      .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?")
      .get(table) !== undefined
  );
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

  const archived = hasTable(connection, 'board_archive_metadata')
    ? connection
        .prepare('SELECT created_at_millis FROM board_archive_metadata WHERE board_id = ?')
        .get(boardId)?.created_at_millis
    : undefined;
  const created = archived ?? row.created_at_millis;

  return {
    updatedAtMillis: millis(row.updated_at_millis),
    createdAtMillis: created === null ? undefined : millis(created),
    pinned: row.pinned === 1,
  };
}

function portableValue(value: SqliteRow[string]) {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value === null || typeof value === 'number' || typeof value === 'string') {
    return value;
  }

  throw new Error('Invalid stored backup metadata.');
}

const backupRows = {
  feedback_threads: {
    columns: `thread_id, status, source_board_revision, frozen_x, frozen_y,
      object_id, object_u, object_v, object_geometry_version, object_kind, object_label,
      object_x, object_y, object_width, object_height, object_rotation,
      version, updated_at_millis, reply_count, selection_json`,
    order: 'thread_id',
  },
  feedback_messages: {
    columns: `thread_id, message_id, author_actor_id, author_name, text,
      created_at_millis, updated_at_millis, version, position`,
    order: 'thread_id, position',
  },
  feedback_content_anchors: {
    columns: 'thread_id, payload_version, unit_json, frozen_excerpt',
    order: 'thread_id',
  },
  board_review_sources: {
    columns: 'source_id, owner_actor_id, board_revision, object_ids_json, feedback_thread_id',
    order: 'source_id',
  },
  board_review_target_snapshots: {
    columns: 'source_id, targets_board_revision, targets_json',
    order: 'source_id',
  },
} as const;

function readPortableRows(
  connection: SqliteConnection,
  boardId: string,
  table: keyof typeof backupRows,
) {
  if (!hasTable(connection, table)) {
    return [];
  }

  const { columns, order } = backupRows[table];
  const query = connection.prepare(
    `SELECT ${columns} FROM ${table} WHERE board_id = ? ORDER BY ${order}`,
  );
  query.setReadBigInts(true);

  return query
    .all(boardId)
    .map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([column, value]) => [column, portableValue(value)]),
      ),
    );
}

export function readBackupActors(
  connection: SqliteConnection,
  boardId: string,
  ownerDisplayName?: string,
) {
  const actors = new Map<string, BoardBackupActor>();
  const local = connection.prepare(`
    SELECT m.actor_id, m.can_edit, l.owner_actor_id
    FROM board_members AS m
    LEFT JOIN board_lifecycle AS l ON l.board_id = m.board_id
    WHERE m.board_id = ?
  `);

  for (const { actor_id: id, can_edit, owner_actor_id } of local.all(boardId)) {
    if (typeof id === 'string') {
      const memberRole = can_edit === 1 ? 'editor' : 'viewer';
      const role = id === owner_actor_id ? 'owner' : memberRole;
      const fallbackName = id === 'local' ? '我' : id;
      const name = (role === 'owner' && ownerDisplayName) || fallbackName;
      actors.set(id, { id, name, kind: 'human', role });
    }
  }

  function readNamedActors(
    table: 'board_sharing_members' | 'board_archive_actors',
    kindSql: string,
  ) {
    if (!hasTable(connection, table)) {
      return;
    }

    const query = connection.prepare(`
      SELECT actor_id, name, role, ${kindSql} AS kind FROM ${table} WHERE board_id = ?
    `);

    for (const { actor_id: id, name, kind, role } of query.all(boardId)) {
      const named = typeof id === 'string' && typeof name === 'string';
      const actorKind = kind === 'human' || kind === 'agent';
      const writingRole = role === 'owner' || role === 'editor';
      const readingRole = role === 'commenter' || role === 'viewer';
      const knownRole = writingRole || readingRole;
      if (named && actorKind && knownRole) {
        actors.set(id, { id, name, kind, role });
      }
    }
  }

  readNamedActors('board_archive_actors', 'kind');
  readNamedActors('board_sharing_members', "'human'");

  return actors;
}

export function retainBackupGuest(
  connection: SqliteConnection,
  boardId: string,
  actorId: string,
): void {
  const guest = actorId.startsWith('guest-') && hasTable(connection, 'board_sharing_members');
  if (!guest || !hasTable(connection, 'board_archive_actors')) {
    return;
  }

  connection
    .prepare(`
      INSERT OR IGNORE INTO board_archive_actors (board_id, actor_id, name, kind, role)
      SELECT board_id, actor_id, name, 'human', role
      FROM board_sharing_members WHERE board_id = ? AND actor_id = ?
    `)
    .run(boardId, actorId);
}

export function historyAgentName(actorId: string): string {
  return 'Agent · ' + actorId.slice(-8);
}

export function retainBackupAgent(
  connection: SqliteConnection,
  boardId: string,
  actorId: string,
): void {
  if (!hasTable(connection, 'board_archive_actors')) {
    return;
  }

  connection
    .prepare(`
      INSERT INTO board_archive_actors (board_id, actor_id, name, kind, role)
      VALUES (?, ?, ?, 'agent', 'editor')
      ON CONFLICT (board_id, actor_id) DO UPDATE SET name = excluded.name, kind = 'agent'
      WHERE board_archive_actors.kind <> 'agent'
    `)
    .run(boardId, actorId, historyAgentName(actorId));
}

export function readBackupDetails(
  connection: SqliteConnection,
  boardId: string,
): BoardBackupDetails {
  return {
    actors: readBackupActors(connection, boardId),
    feedback: {
      threads: readPortableRows(connection, boardId, 'feedback_threads'),
      messages: readPortableRows(connection, boardId, 'feedback_messages'),
      contentAnchors: readPortableRows(connection, boardId, 'feedback_content_anchors'),
    },
    reviewSources: {
      sources: readPortableRows(connection, boardId, 'board_review_sources'),
      targetSnapshots: readPortableRows(connection, boardId, 'board_review_target_snapshots'),
    },
  };
}
