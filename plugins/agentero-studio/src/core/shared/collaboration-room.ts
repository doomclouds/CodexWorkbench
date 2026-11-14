import type { Actor, Json, RoomMessage } from '../../contracts/studio.js';
import { copy, object, requireRole, StudioError } from './common.js';

interface Bucket { tokens: number; ends: number; updatedAt: number }
interface GestureOrder { sequence: number; ended: boolean; expiresAt: number }
interface RoomInput { topic: string; data: Record<string, Json> }
export const ROOM_TTL: Record<string, number> = { gesture: 10_000, upload: 90_000, chat: 5000, follow: 8000 };

/** Loss-tolerant room previews have their own budget and never enter content history. */
export class CollaborationRoom {
  private budgets = new Map<string, Bucket>();
  private sequences = new Map<string, number>();
  private order = new Map<string, GestureOrder>();
  static validate(input: unknown, actor: Actor): RoomInput[] {
    if (!Array.isArray(input) || input.length > 80 || Buffer.byteLength(JSON.stringify(input)) > 64 * 1024) throw new StudioError('TOO_LARGE', '临时协作消息超过预算。');
    for (const item of input) {
      if (!object(item) || typeof item.topic !== 'string' || !Object.hasOwn(ROOM_TTL, item.topic) || !object(item.data)) throw new StudioError('INVALID_ARGUMENT', '临时协作消息无效。');
      if (Buffer.byteLength(JSON.stringify(item.data)) > 4096) throw new StudioError('TOO_LARGE', '单条临时协作消息超过 4 KiB。');
      if (item.topic === 'gesture' || item.topic === 'upload') {
        requireRole(actor, ['owner', 'editor']);
        if (typeof item.data.id !== 'string' || item.data.id.length > 120 || !Number.isSafeInteger(item.data.seq) || Number(item.data.seq) < 0 || !['start', 'parts', 'step', 'end'].includes(String(item.data.phase))) throw new StudioError('INVALID_ARGUMENT', '临时手势的标识或序号无效。');
      }
    }
    return input as RoomInput[];
  }
  accept(peerId: string, input: RoomInput[], actor: Actor): { messages: RoomMessage[]; dropped: number; expiresAt: number } {
    const now = Date.now(), bucket = this.budgets.get(peerId) ?? { tokens: 80, ends: 8, updatedAt: now };
    bucket.tokens = Math.min(80, bucket.tokens + (now - bucket.updatedAt) * 40 / 1000); bucket.ends = Math.min(8, bucket.ends + (now - bucket.updatedAt) * 4 / 1000); bucket.updatedAt = now; this.budgets.set(peerId, bucket);
    for (const [key, value] of this.order) if (value.expiresAt <= now) this.order.delete(key);
    const messages: RoomMessage[] = []; let dropped = 0, expiresAt = now;
    // An end releases a remote preview even when ordinary steps have exhausted the burst.
    for (const item of input) {
      const topic = item.topic as string, data = item.data as Record<string, Json>, end = data.phase === 'end';
      const key = `${peerId}:${topic}:${typeof data.id === 'string' ? data.id : ''}`, previous = this.order.get(key);
      const seq = Number.isSafeInteger(data.seq) ? Number(data.seq) : undefined;
      if (seq !== undefined && previous && (seq < previous.sequence || seq === previous.sequence && (previous.ended || !end))) { dropped++; continue; }
      if (bucket.tokens < 1 && (!end || bucket.ends < 1)) { dropped++; continue; }
      if (bucket.tokens >= 1) bucket.tokens--; else bucket.ends--;
      if (seq !== undefined) this.order.set(key, { sequence: seq, ended: end, expiresAt: now + Math.max(30_000, ROOM_TTL[topic]!) });
      const sequence = (this.sequences.get(peerId) ?? 0) + 1; this.sequences.set(peerId, sequence);
      messages.push({ peerId, actor: copy(actor), seq: sequence, topic, data: copy(data), createdAt: new Date(now).toISOString() });
      expiresAt = Math.max(expiresAt, now + ROOM_TTL[topic]!);
    }
    return { messages, dropped, expiresAt };
  }
  forget(peerId: string): void {
    this.budgets.delete(peerId); this.sequences.delete(peerId);
    for (const key of this.order.keys()) if (key.startsWith(`${peerId}:`)) this.order.delete(key);
  }
  clear(): void { this.budgets.clear(); this.sequences.clear(); this.order.clear(); }
}
