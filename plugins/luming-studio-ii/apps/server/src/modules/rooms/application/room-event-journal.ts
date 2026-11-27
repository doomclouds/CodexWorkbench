import type { RoomEvent } from '../domain/index.js';

export interface RoomEventCursor {
  readonly roomInstanceId: string;
  readonly sequence: bigint;
}

const maxReplayEvents = 32;
const maxReplayContentBytes = 256 * 1024;

function contentBytes(event: RoomEvent): number {
  const { payload } = event;
  if (payload.kind !== 'contentChanged') {
    return 0;
  }

  const { changedObjects, changedObjectIds, removedObjectIds } = payload.change;
  const metadata = changedObjects?.reduce((sum, value) => sum + value.byteLength, 0) ?? 0;
  const changedIds = changedObjectIds?.reduce((sum, id) => sum + id.length * 2, 0) ?? 0;
  const removedIds = removedObjectIds?.reduce((sum, id) => sum + id.length * 2, 0) ?? 0;

  return metadata + changedIds + removedIds;
}

export class RoomEventJournal {
  private readonly entries: { event: RoomEvent; bytes: number }[] = [];
  private bytes = 0;

  append(event: RoomEvent): void {
    const bytes = contentBytes(event);
    this.entries.push({ event, bytes });
    this.bytes += bytes;
    while (this.entries.length > maxReplayEvents || this.bytes > maxReplayContentBytes) {
      this.bytes -= this.entries.shift()?.bytes ?? 0;
    }
  }

  after(cursor: RoomEventCursor, head: RoomEventCursor): readonly RoomEvent[] | undefined {
    if (cursor.roomInstanceId !== head.roomInstanceId || cursor.sequence > head.sequence) {
      return;
    }
    if (cursor.sequence === head.sequence) {
      return [];
    }

    const start = this.entries.findIndex(({ event }) => event.sequence === cursor.sequence + 1n);
    if (start !== -1) {
      return this.entries.slice(start).map(({ event }) => event);
    }
  }
}
