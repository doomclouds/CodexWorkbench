import type {
  RoomTimer,
  StoredTimerReceipt,
  TimerCommandKey,
} from '../../../modules/rooms/ports/index.js';
import type { SqliteConnection } from '../../platform/index.js';

function readPhase(value: unknown): RoomTimer['phase'] {
  switch (value) {
    case 'idle':
    case 'running':
    case 'paused':
    case 'ended':
      return value;
    default:
      throw new Error('Invalid room timer receipt phase');
  }
}

export function readReceipt(
  connection: SqliteConnection,
  actorId: string,
  key: TimerCommandKey,
): StoredTimerReceipt | undefined {
  const query = connection.prepare(`
    SELECT signature, version, duration_ms, phase, deadline_ms, remaining_ms
    FROM board_room_timer_receipts
    WHERE board_id = ? AND actor_id = ? AND command_id = ?
  `);
  query.setReadBigInts(true);
  const row = query.get(key.boardId, actorId, key.commandId);
  if (!row) {
    return undefined;
  }

  const { signature, version, duration_ms: duration, remaining_ms: remaining } = row;
  const enoughData = typeof duration === 'bigint' && typeof remaining === 'bigint';
  if (typeof signature !== 'string' || typeof version !== 'bigint' || !enoughData) {
    throw new Error('Invalid saved room timer receipt');
  }

  const timer = {
    version,
    durationMs: Number(duration),
    phase: readPhase(row.phase),
    deadlineUnixMs: typeof row.deadline_ms === 'bigint' ? Number(row.deadline_ms) : undefined,
    remainingMs: Number(remaining),
  };

  return { signature, receipt: { ...key, outcome: { kind: 'applied', timer } } };
}

export function storeReceipt(
  connection: SqliteConnection,
  actorId: string,
  { receipt, signature }: StoredTimerReceipt,
): void {
  if (receipt.outcome.kind !== 'applied') {
    throw new Error('Only applied room timer receipts may be saved');
  }

  const {
    boardId,
    commandId,
    outcome: { timer },
  } = receipt;
  connection
    .prepare(`
    INSERT INTO board_room_timer_receipts
      (board_id, actor_id, command_id, signature, version, duration_ms, phase, deadline_ms, remaining_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .run(
      boardId,
      actorId,
      commandId,
      signature,
      timer.version,
      timer.durationMs,
      timer.phase,
      timer.deadlineUnixMs ?? null,
      timer.remainingMs,
    );
}
