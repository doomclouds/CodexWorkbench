import { randomUUID } from 'node:crypto';
import type { StudioEvent } from '../../contracts/studio.js';
import { copy } from './common.js';
import { ROOM_TTL } from './collaboration-room.js';

const MAX_EVENTS = 512, MAX_BYTES = 1024 * 1024;
interface LoggedEvent { sequence: number; bytes: number; event: StudioEvent }

/** A bounded replay window. A cursor outside it requires an authoritative read. */
export class CollaborationEvents {
  private readonly epoch = randomUUID();
  private sequence = 0;
  private floor = 0;
  private bytes = 0;
  private events: LoggedEvent[] = [];
  cursor(): string { return `${this.epoch}:${this.sequence}`; }
  append(input: StudioEvent): StudioEvent {
    const sequence = ++this.sequence;
    const event = copy({ ...input, cursor: this.cursor() });
    // Content units are an optimization; an invalidation remains valid at any size.
    if (Buffer.byteLength(JSON.stringify(event)) > 128 * 1024) delete event.units;
    const bytes = Buffer.byteLength(JSON.stringify(event));
    this.events.push({ sequence, bytes, event }); this.bytes += bytes;
    while (this.events.length > MAX_EVENTS || this.bytes > MAX_BYTES) {
      const removed = this.events.shift()!; this.bytes -= removed.bytes; this.floor = removed.sequence;
    }
    return copy(event);
  }
  read(artifactId: string, after?: string): { cursor: string; reset: boolean; events: StudioEvent[] } {
    const prefix = `${this.epoch}:`, tail = after?.startsWith(prefix) ? after.slice(prefix.length) : '';
    const sequence = /^(?:0|[1-9]\d*)$/.test(tail) ? Number(tail) : -1;
    const reset = !Number.isSafeInteger(sequence) || sequence < this.floor || sequence > this.sequence;
    const now = Date.now();
    const events = reset ? [] : this.events.filter(item => item.sequence > sequence && (!artifactId || item.event.artifactId === artifactId)).flatMap(item => {
      const event = item.event;
      if (event.type !== 'room') return [event];
      if (typeof event.expiresAt === 'number' && event.expiresAt <= now) return [];
      const messages = Array.isArray(event.events) ? event.events.filter(message => typeof message?.topic === 'string' && Date.parse(message.createdAt) + (ROOM_TTL[message.topic] ?? 0) > now) : [];
      return messages.length ? [{ ...event, events: messages }] : [];
    });
    return { cursor: this.cursor(), reset, events: copy(events) };
  }
  clear(): void { this.events = []; this.bytes = 0; this.floor = this.sequence; }
}
