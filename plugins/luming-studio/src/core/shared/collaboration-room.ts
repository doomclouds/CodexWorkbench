import type { Actor, Json, RoomMessage } from '../../contracts/studio.js';
import { copy, object, requireRole, StudioError } from './common.js';

interface Bucket {
  tokens: number;
  ends: number;
  updatedAt: number;
}
interface GestureOrder {
  sequence: number;
  ended: boolean;
  expiresAt: number;
}
interface RoomInput {
  topic: string;
  data: Record<string, Json>;
}

export const ROOM_TTL: Record<string, number> = { gesture: 10_000, upload: 90_000, follow: 8000 };

function validGesture(data: Record<string, unknown>): boolean {
  if (typeof data.id !== 'string' || data.id.length > 120) {
    return false;
  }
  if (!Number.isSafeInteger(data.seq) || Number(data.seq) < 0) {
    return false;
  }

  return ['start', 'parts', 'step', 'end'].includes(String(data.phase));
}

function outdatedGesture(sequence: number, previous: GestureOrder, ending: boolean): boolean {
  if (sequence !== previous.sequence) {
    return sequence < previous.sequence;
  }

  return previous.ended || !ending;
}

export class CollaborationRoom {
  private budgets = new Map<string, Bucket>();
  private sequences = new Map<string, number>();
  private order = new Map<string, GestureOrder>();
  static validate(input: unknown, actor: Actor): RoomInput[] {
    if (
      !Array.isArray(input) ||
      input.length > 80 ||
      Buffer.byteLength(JSON.stringify(input)) > 64 * 1024
    ) {
      throw new StudioError('TOO_LARGE', '临时协作消息超过预算。');
    }

    for (const item of input) {
      if (!object(item) || typeof item.topic !== 'string') {
        throw new StudioError('INVALID_ARGUMENT', '临时协作消息无效。');
      }
      if (!Object.hasOwn(ROOM_TTL, item.topic) || !object(item.data)) {
        throw new StudioError('INVALID_ARGUMENT', '临时协作消息无效。');
      }
      if (Buffer.byteLength(JSON.stringify(item.data)) > 4096) {
        throw new StudioError('TOO_LARGE', '单条临时协作消息超过 4 KiB。');
      }

      if (item.topic === 'gesture' || item.topic === 'upload') {
        requireRole(actor, ['owner', 'editor']);
        if (!validGesture(item.data)) {
          throw new StudioError('INVALID_ARGUMENT', '临时手势的标识或序号无效。');
        }
      }
    }

    return input as RoomInput[];
  }
  accept(
    peerId: string,
    input: RoomInput[],
    actor: Actor,
  ): { messages: RoomMessage[]; dropped: number; expiresAt: number } {
    const now = Date.now();
    const bucket = this.budgets.get(peerId) ?? { tokens: 80, ends: 8, updatedAt: now };
    bucket.tokens = Math.min(80, bucket.tokens + ((now - bucket.updatedAt) * 40) / 1000);
    bucket.ends = Math.min(8, bucket.ends + ((now - bucket.updatedAt) * 4) / 1000);
    bucket.updatedAt = now;
    this.budgets.set(peerId, bucket);
    for (const [key, value] of this.order) {
      if (value.expiresAt <= now) {
        this.order.delete(key);
      }
    }

    const messages: RoomMessage[] = [];
    let dropped = 0;
    let expiresAt = now;

    for (const item of input) {
      const topic = item.topic as string;
      const data = item.data as Record<string, Json>;
      const end = data.phase === 'end';
      const key = `${peerId}:${topic}:${typeof data.id === 'string' ? data.id : ''}`;
      const previous = this.order.get(key);
      const seq = Number.isSafeInteger(data.seq) ? Number(data.seq) : undefined;
      if (seq !== undefined && previous && outdatedGesture(seq, previous, end)) {
        dropped++;
        continue;
      }
      if (bucket.tokens < 1 && (!end || bucket.ends < 1)) {
        dropped++;
        continue;
      }
      if (bucket.tokens >= 1) {
        bucket.tokens--;
      } else {
        bucket.ends--;
      }
      if (seq !== undefined) {
        this.order.set(key, {
          sequence: seq,
          ended: end,
          expiresAt: now + Math.max(30_000, ROOM_TTL[topic]!),
        });
      }

      const sequence = (this.sequences.get(peerId) ?? 0) + 1;
      this.sequences.set(peerId, sequence);
      messages.push({
        peerId,
        actor: copy(actor),
        seq: sequence,
        topic,
        data: copy(data),
        createdAt: new Date(now).toISOString(),
      });
      expiresAt = Math.max(expiresAt, now + ROOM_TTL[topic]!);
    }

    return { messages, dropped, expiresAt };
  }
  forget(peerId: string): void {
    this.budgets.delete(peerId);
    this.sequences.delete(peerId);
    for (const key of this.order.keys()) {
      if (key.startsWith(`${peerId}:`)) {
        this.order.delete(key);
      }
    }
  }
  clear(): void {
    this.budgets.clear();
    this.sequences.clear();
    this.order.clear();
  }
}
