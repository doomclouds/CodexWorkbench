import type { RoomTimer } from '../../contracts/studio.js';
import type { RoomTimerStore } from '../ports/room-timer-store.js';
import { copy } from './common.js';

export class RoomTimers {
  private values = new Map<string, RoomTimer | null>();
  constructor(private readonly store?: RoomTimerStore) {}
  get(id: string, reload = false): RoomTimer | null {
    if (this.store && (reload || !this.values.has(id))) {
      this.values.set(id, this.store.read(id));
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
    if (this.store) {
      await this.store.write(id, timer);
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
