import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RoomTimer } from '../contracts/studio.js';
import type { RoomTimerStore } from '../core/ports/room-timer-store.js';
import { isRecord as object } from '../shared/is-record.js';
import { safeId, StudioError } from '../shared/studio-error.js';
import { atomicWrite } from './filesystem/atomic-write.js';

function validTimerSource(source: unknown): boolean {
  if (!object(source) || typeof source.id !== 'string' || typeof source.name !== 'string') {
    return false;
  }

  return (
    ['human', 'agent'].includes(String(source.kind)) &&
    ['owner', 'editor', 'commenter', 'viewer'].includes(String(source.role))
  );
}

function parseTimer(raw: string): RoomTimer {
  const saved: unknown = JSON.parse(raw);
  const timer = object(saved) && saved.schemaVersion === 1 ? saved.timer : undefined;
  if (!object(timer)) {
    throw new Error('invalid timer');
  }

  const duration = timer.durationMs;
  if (!Number.isInteger(duration) || Number(duration) < 1000 || Number(duration) > 5_999_000) {
    throw new Error('invalid timer');
  }

  const remaining = timer.remainingMs;
  if (!Number.isFinite(remaining) || Number(remaining) < 0 || Number(remaining) > 5_999_000) {
    throw new Error('invalid timer');
  }

  const validDeadline = timer.deadline === null || Number.isFinite(timer.deadline);
  if (!validDeadline || typeof timer.paused !== 'boolean' || !validTimerSource(timer.source)) {
    throw new Error('invalid timer');
  }

  return timer as unknown as RoomTimer;
}

export class FileRoomTimerStore implements RoomTimerStore {
  constructor(private readonly dataRoot: string) {}

  private file(id: string) {
    return join(this.dataRoot, 'artifacts', safeId(id), 'room-timer.json');
  }

  read(id: string): RoomTimer | null {
    let raw: string;
    try {
      raw = readFileSync(this.file(id), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }

      return null;
    }

    try {
      return parseTimer(raw);
    } catch (error) {
      throw new StudioError(
        'CORRUPT_TIMER',
        '共享计时器记录无法读取，请保留原文件并从备份恢复。',
        undefined,
        { cause: error },
      );
    }
  }

  async write(id: string, timer: RoomTimer): Promise<void> {
    await atomicWrite(this.file(id), JSON.stringify({ schemaVersion: 1, timer }));
  }
}
