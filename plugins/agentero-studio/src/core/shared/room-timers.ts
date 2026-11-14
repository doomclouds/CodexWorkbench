import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RoomTimer } from '../../contracts/studio.js';
import { atomicWrite, copy, object, safeId, StudioError } from './common.js';

/** Timer deadlines are durable; countdown ticks are computed without disk writes. */
export class RoomTimers {
  private values = new Map<string, RoomTimer | null>();
  constructor(private readonly dataRoot?: string) {}
  private file(id: string) { return join(this.dataRoot!, 'artifacts', safeId(id), 'room-timer.json'); }
  get(id: string, reload = false): RoomTimer | null {
    if (this.dataRoot && (reload || !this.values.has(id))) {
      let raw: string;
      try { raw = readFileSync(this.file(id), 'utf8'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; this.values.set(id, null); return null; }
      try {
        const saved: unknown = JSON.parse(raw), timer = object(saved) && saved.schemaVersion === 1 ? saved.timer : undefined;
        if (!object(timer) || !Number.isInteger(timer.durationMs) || Number(timer.durationMs) < 1000 || Number(timer.durationMs) > 5_999_000 || !Number.isFinite(timer.remainingMs) || Number(timer.remainingMs) < 0 || Number(timer.remainingMs) > 5_999_000 || timer.deadline !== null && !Number.isFinite(timer.deadline) || typeof timer.paused !== 'boolean' || !object(timer.source) || typeof timer.source.id !== 'string' || typeof timer.source.name !== 'string' || !['human', 'agent'].includes(String(timer.source.kind)) || !['owner', 'editor', 'commenter', 'viewer'].includes(String(timer.source.role))) throw new Error('invalid timer');
        this.values.set(id, timer as unknown as RoomTimer);
      } catch { throw new StudioError('CORRUPT_TIMER', '共享计时器记录无法读取，请保留原文件并从备份恢复。'); }
    }
    const timer = this.values.get(id); if (!timer) return null;
    return copy({ ...timer, remainingMs: timer.paused || timer.deadline === null ? timer.remainingMs : Math.max(0, timer.deadline - Date.now()) });
  }
  async set(id: string, timer: RoomTimer): Promise<void> {
    if (this.dataRoot) await atomicWrite(this.file(id), JSON.stringify({ schemaVersion: 1, timer }));
    this.values.set(id, copy(timer));
  }
  forget(id: string): void { this.values.delete(id); }
  close(): void { this.values.clear(); }
}
