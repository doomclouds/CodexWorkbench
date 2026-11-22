import type { RoomTimer } from '../../contracts/studio.js';

export interface RoomTimerStore {
  read(id: string): RoomTimer | null;
  write(id: string, timer: RoomTimer): Promise<void>;
}
