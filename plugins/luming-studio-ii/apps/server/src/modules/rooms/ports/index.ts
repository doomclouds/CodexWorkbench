import type {
  RoomAccess,
  RoomTimerState,
  StoredTimerReceipt,
  TimerCommandKey,
} from '../domain/index.js';

export type {
  RoomAccess,
  RoomTimer,
  RoomTimerState,
  StoredTimerReceipt,
  TimerCommandKey,
} from '../domain/index.js';

export interface RoomReader {
  access(boardId: string, actorId: string): RoomAccess | undefined;
  timer(boardId: string): RoomTimerState | undefined;
  receipt(actorId: string, key: TimerCommandKey): StoredTimerReceipt | undefined;
}

export interface RoomWriter extends RoomReader {
  saveTimer(boardId: string, state: RoomTimerState): void;
  saveReceipt(actorId: string, stored: StoredTimerReceipt): void;
}

export interface RoomRepository {
  read<T>(work: (reader: RoomReader) => T): T;
  write<T>(work: (writer: RoomWriter) => T): T;
}

export interface RoomClock {
  nowMillis(): number;
}
