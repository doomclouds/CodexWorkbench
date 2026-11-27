import type {
  RoomAccess,
  RoomReader,
  RoomRepository,
  RoomTimerState,
  RoomWriter,
  StoredTimerReceipt,
  TimerCommandKey,
} from '../../../modules/rooms/ports/index.js';
import type { SqliteConnection, SqliteDatabase } from '../../platform/index.js';
import { readReceipt, storeReceipt } from './receipts.js';

const schema = `
  CREATE TABLE IF NOT EXISTS board_room_timers (
    board_id TEXT PRIMARY KEY REFERENCES boards (board_id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK (version >= 0),
    duration_ms INTEGER NOT NULL CHECK (duration_ms BETWEEN 1000 AND 5999000),
    deadline_ms INTEGER CHECK (deadline_ms >= 0),
    paused_ms INTEGER CHECK (paused_ms BETWEEN 0 AND 5999000),
    CHECK (deadline_ms IS NULL OR paused_ms IS NULL)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS board_room_timer_receipts (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    signature TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 0),
    duration_ms INTEGER NOT NULL CHECK (duration_ms BETWEEN 1000 AND 5999000),
    phase TEXT NOT NULL CHECK (phase IN ('idle', 'running', 'paused', 'ended')),
    deadline_ms INTEGER CHECK (deadline_ms >= 0),
    remaining_ms INTEGER NOT NULL CHECK (remaining_ms BETWEEN 0 AND 5999000),
    PRIMARY KEY (board_id, actor_id, command_id)
  ) STRICT;
`;

interface Membership {
  readonly canEdit: boolean;
  readonly isOwner: boolean;
  readonly role?: RoomAccess['role'];
  readonly name?: string;
}

export type LookupRoomMembership = (
  connection: SqliteConnection,
  boardId: string,
  actorId: string,
) => Membership | undefined;

function readAccess(
  connection: SqliteConnection,
  membership: LookupRoomMembership,
  boardId: string,
  actorId: string,
): RoomAccess | undefined {
  const authorized = membership(connection, boardId, actorId);
  if (!authorized) {
    return undefined;
  }

  const query = connection.prepare('SELECT revision FROM boards WHERE board_id = ?');
  query.setReadBigInts(true);
  const row = query.get(boardId);
  if (!row || typeof row.revision !== 'bigint') {
    return undefined;
  }

  const { canEdit, isOwner, role, name } = authorized;
  const fallbackRole = canEdit ? 'editor' : 'viewer';

  return {
    boardRevision: row.revision,
    canEdit,
    role: role ?? (isOwner ? 'owner' : fallbackRole),
    displayName: name?.trim() || (isOwner ? '所有者' : '协作者'),
  };
}

function readTimer(connection: SqliteConnection, boardId: string): RoomTimerState | undefined {
  const query = connection.prepare(`
    SELECT version, duration_ms, deadline_ms, paused_ms FROM board_room_timers WHERE board_id = ?
  `);
  query.setReadBigInts(true);
  const row = query.get(boardId);
  if (!row) {
    return undefined;
  }

  const { version, duration_ms: duration, deadline_ms: deadline, paused_ms: paused } = row;
  if (typeof version !== 'bigint' || typeof duration !== 'bigint') {
    throw new Error('Invalid saved room timer');
  }

  return {
    version,
    durationMs: Number(duration),
    deadlineUnixMs: typeof deadline === 'bigint' ? Number(deadline) : undefined,
    pausedRemainingMs: typeof paused === 'bigint' ? Number(paused) : undefined,
  };
}

function saveTimer(connection: SqliteConnection, boardId: string, state: RoomTimerState): void {
  connection
    .prepare(`
    INSERT INTO board_room_timers (board_id, version, duration_ms, deadline_ms, paused_ms)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(board_id) DO UPDATE SET
      version = excluded.version, duration_ms = excluded.duration_ms,
      deadline_ms = excluded.deadline_ms, paused_ms = excluded.paused_ms
  `)
    .run(
      boardId,
      state.version,
      state.durationMs,
      state.deadlineUnixMs ?? null,
      state.pausedRemainingMs ?? null,
    );
}

function reader(connection: SqliteConnection, membership: LookupRoomMembership): RoomReader {
  return {
    access: (boardId, actorId) => readAccess(connection, membership, boardId, actorId),
    timer: (boardId) => readTimer(connection, boardId),
    receipt: (actorId: string, key: TimerCommandKey) => readReceipt(connection, actorId, key),
  };
}

function writer(connection: SqliteConnection, membership: LookupRoomMembership): RoomWriter {
  return {
    ...reader(connection, membership),
    saveTimer: (boardId, state) => saveTimer(connection, boardId, state),
    saveReceipt: (actorId: string, stored: StoredTimerReceipt) =>
      storeReceipt(connection, actorId, stored),
  };
}

export function createRoomsRepository(
  database: SqliteDatabase,
  membership: LookupRoomMembership,
): RoomRepository {
  database.write((connection) => connection.exec(schema));

  return {
    read: (work) => database.read((connection) => work(reader(connection, membership))),
    write: (work) => database.write((connection) => work(writer(connection, membership))),
  };
}
