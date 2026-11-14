import type { Actor, Presence, RoomTimer, StudioEvent } from '../../contracts/studio.js';
import { copy, finite, object, requireRole, safeId, StudioError } from './common.js';

/** Ephemeral view state and notifications never become product content or history. */
export class StudioCollaboration {
  private listeners = new Map<string, Set<(event: StudioEvent) => void>>();
  private peers = new Map<string, Map<string, Presence>>();
  private timers = new Map<string, RoomTimer>();
  subscribe(artifactId: string, listener: (event: StudioEvent) => void): () => void {
    const key = artifactId || '*', group = this.listeners.get(key) ?? new Set(); group.add(listener); this.listeners.set(key, group);
    return () => { group.delete(listener); if (!group.size) this.listeners.delete(key); };
  }
  emit(event: StudioEvent): void {
    for (const listener of [...(this.listeners.get(event.artifactId) ?? []), ...(this.listeners.get('*') ?? [])]) { try { listener(copy(event)); } catch { /* A disconnected view cannot interrupt a commit. */ } }
  }
  update(artifactId: string, input: Record<string, unknown>, actor: Actor) {
    const peerId = safeId(input.peerId ?? actor.id, '参与者 ID'), group = this.peers.get(artifactId) ?? new Map<string, Presence>();
    const previous = group.get(peerId); if (previous && previous.actor.id !== actor.id) throw new StudioError('FORBIDDEN', '不能更新其他参与者的状态。');
    if (Buffer.byteLength(JSON.stringify(input)) > 16 * 1024) throw new StudioError('TOO_LARGE', '在线状态过大。');
    const nextTimer = input.timer === undefined ? undefined : this.timerAction(artifactId, input.timer, actor);
    if (input.leave === true) group.delete(peerId);
    else {
      const now = new Date().toISOString(), context = object(input.context) ? copy(input.context) : previous?.context;
      const ids = (value: unknown) => Array.isArray(value) && value.length <= 200 && value.every(id => typeof id === 'string' && id.length <= 200);
      if (context && (context.artifactId !== artifactId || typeof context.viewId !== 'string' || context.viewId.length > 120 || !ids(context.selectedIds) || context.editingIds !== undefined && !ids(context.editingIds) || context.movingIds !== undefined && !ids(context.movingIds) || context.dirty !== undefined && typeof context.dirty !== 'boolean')) throw new StudioError('INVALID_ARGUMENT', '视图上下文无效。');
      if (context && context.issues !== undefined) {
        if (!Array.isArray(context.issues)) throw new StudioError('INVALID_ARGUMENT', '视图问题无效。');
        context.issues = context.issues.slice(0, 5).map(issue => {
          if (!object(issue) || typeof issue.type !== 'string' || typeof issue.message !== 'string' || !ids(issue.ids)) throw new StudioError('INVALID_ARGUMENT', '视图问题无效。');
          return { type: issue.type.slice(0, 80), message: issue.message.slice(0, 500), ids: issue.ids };
        });
      }
      const displayActor = { ...copy(actor), ...(typeof input.name === 'string' ? { name: input.name.slice(0, 60) } : {}) };
      const cursor = object(input.cursor) ? { x: finite(input.cursor.x, 0), y: finite(input.cursor.y, 0) } : previous?.cursor;
      const following = typeof input.following === 'string' ? input.following.slice(0, 120) : previous?.following;
      const chat = typeof input.chat === 'string' ? input.chat.slice(0, 240) : previous?.chat;
      group.set(peerId, { peerId, actor: displayActor, ...(context ? { context: context as Presence['context'] } : {}), ...(cursor ? { cursor } : {}), ...(following !== undefined ? { following } : {}), ...(chat !== undefined ? { chat } : {}), updatedAt: now });
    }
    if (nextTimer === null) this.timers.delete(artifactId); else if (nextTimer) this.timers.set(artifactId, nextTimer);
    this.peers.set(artifactId, group); const peers = this.getPresence(artifactId), timer = this.getTimer(artifactId); this.emit({ type: 'presence', artifactId, peers, timer }); return { peers, timer };
  }
  private timerAction(artifactId: string, input: unknown, actor: Actor): RoomTimer | null {
    requireRole(actor, ['owner', 'editor']);
    if (!object(input)) throw new StudioError('INVALID_ARGUMENT', '计时器操作无效。');
    const current = this.getTimer(artifactId), now = Date.now();
    if (input.action === 'reset') return null;
    if (input.action === 'start') {
      if (!Number.isInteger(input.durationSeconds) || Number(input.durationSeconds) < 1 || Number(input.durationSeconds) > 86400) throw new StudioError('INVALID_ARGUMENT', '计时时长应为 1 秒至 24 小时。');
      const remainingMs = Number(input.durationSeconds) * 1000;
      return { deadline: now + remainingMs, remainingMs, paused: false, source: copy(actor) };
    }
    if (input.action !== 'pause' && input.action !== 'resume') throw new StudioError('INVALID_ARGUMENT', '计时器操作无效。');
    if (!current) throw new StudioError('INVALID_ARGUMENT', '请先启动计时器。');
    if (input.action === 'pause') return { ...current, deadline: null, paused: true, source: copy(actor) };
    return { ...current, deadline: now + current.remainingMs, paused: false, source: copy(actor) };
  }
  getTimer(artifactId: string): RoomTimer | null {
    const timer = this.timers.get(artifactId); if (!timer) return null;
    return copy({ ...timer, remainingMs: timer.paused || timer.deadline === null ? timer.remainingMs : Math.max(0, timer.deadline - Date.now()) });
  }
  getPresence(artifactId: string): Presence[] {
    const group = this.peers.get(artifactId); if (!group) return [];
    const cutoff = Date.now() - 45_000; for (const [key, peer] of group) if (Date.parse(peer.updatedAt) < cutoff) group.delete(key);
    return copy([...group.values()]);
  }
  close(): void { this.listeners.clear(); this.peers.clear(); this.timers.clear(); }
}
