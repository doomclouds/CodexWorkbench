import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RoomTimer } from '../../contracts/studio.js';
import { atomicWrite, copy, object, safeId, StudioError } from './common.js';

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

export class RoomTimers {
  private values = new Map<string, RoomTimer | null>();
  constructor(private readonly dataRoot?: string) {}
  private file(id: string) {
    return join(this.dataRoot!, 'artifacts', safeId(id), 'room-timer.json');
  }
  private load(id: string): RoomTimer | null {
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

  get(id: string, reload = false): RoomTimer | null {
    if (this.dataRoot && (reload || !this.values.has(id))) {
      this.values.set(id, this.load(id));
    }

    const timer = this.values.get(id);
    if (!timer) {
      return null;
    }

    return copy({
      ...timer,
      remainingMs:
        timer.paused || timer.deadline === null
          ? timer.remainingMs
          : Math.max(0, timer.deadline - Date.now()),
    });
  }
  async set(id: string, timer: RoomTimer): Promise<void> {
    if (this.dataRoot) {
      await atomicWrite(this.file(id), JSON.stringify({ schemaVersion: 1, timer }));
    }

    this.values.set(id, copy(timer));
  }
  forget(id: string): void {
    this.values.delete(id);
  }
  close(): void {
    this.values.clear();
  }
}
