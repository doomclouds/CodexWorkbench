import { createHash, randomUUID } from 'node:crypto';
import type { Actor, Presence, RoomTimer, StudioEvent, SyncBatch } from '../../contracts/studio.js';
import { copy, finite, object, requireRole, safeId, StudioError } from './common.js';
import { CollaborationEvents } from './collaboration-events.js';
import { CollaborationRoom } from './collaboration-room.js';
import { RoomTimers } from './room-timers.js';

export interface SyncOptions { after?: string; wait?: number; signal?: AbortSignal; peerId?: string; peerEpoch?: string }
interface PeerState { actorId: string; epoch?: string; sequence: number; roomSequence: number; value?: Presence; departed?: boolean; leaseUntil: number; streams: number; disconnect?: ReturnType<typeof setTimeout>; retired: Set<string>; tokens: number; budgetAt: number }
interface Activity { actor: Actor; status: 'reading' | 'writing'; editingIds?: string[]; selectedIds?: string[]; viewId?: string }
const LEASE_MS = 45_000, DISCONNECT_MS = 4000, AGENT_IDLE_MS = 20_000;

/** Ephemeral view state and notifications never become product content or history. */
export class StudioCollaboration {
  private listeners = new Map<string, Set<(event: StudioEvent) => void>>();
  private peers = new Map<string, Map<string, PeerState>>();
  private readonly timers: RoomTimers;
  private readonly events = new CollaborationEvents();
  private rooms = new Map<string, CollaborationRoom>();
  private queues = new Map<string, Promise<unknown>>();
  private activities = new Map<string, Map<string, Activity>>();
  private readonly expiry: ReturnType<typeof setInterval>;
  constructor(options: { dataRoot?: string } = {}) { this.timers = new RoomTimers(options.dataRoot); this.expiry = setInterval(() => this.expire(), 1000); this.expiry.unref(); }
  subscribe(artifactId: string, listener: (event: StudioEvent) => void): () => void {
    const key = artifactId || '*', group = this.listeners.get(key) ?? new Set(); group.add(listener); this.listeners.set(key, group);
    return () => { group.delete(listener); if (!group.size) this.listeners.delete(key); };
  }
  emit(event: StudioEvent): void {
    const published = this.events.append(event);
    for (const listener of [...(this.listeners.get(event.artifactId) ?? []), ...(this.listeners.get('*') ?? [])]) { try { listener(copy(published)); } catch { /* A disconnected view cannot interrupt a commit. */ } }
  }
  cursor(): string { return this.events.cursor(); }
  private group(artifactId: string) { let group = this.peers.get(artifactId); if (!group) { group = new Map(); this.peers.set(artifactId, group); } return group; }
  private peer(artifactId: string, input: Record<string, unknown>, actor: Actor, registration = false): { peerId: string; peer: PeerState } {
    // Validate durable room state before publishing a peer or scheduling its expiry.
    if (artifactId) this.getTimer(artifactId);
    const peerId = safeId(input.peerId ?? actor.id, '参与者 ID'), group = this.group(artifactId), now = Date.now();
    if (peerId.startsWith('agent-')) throw new StudioError('FORBIDDEN', '代理页面状态只能由服务端登记。');
    const epoch = input.peerEpoch === undefined ? undefined : safeId(input.peerEpoch, '页面代次');
    let peer = group.get(peerId);
    if (peer && peer.actorId !== actor.id) throw new StudioError('FORBIDDEN', '不能更新其他参与者的状态。');
    if (peer?.epoch && !epoch || peer && epoch && peer.retired.has(epoch)) throw new StudioError('STALE_PEER', '页面协作代次已失效。');
    if (peer && epoch && peer.epoch !== epoch) {
      if (peer.epoch && (!registration || peer.streams > 0 || peer.leaseUntil > now)) throw new StudioError('STALE_PEER', '页面协作代次已失效。');
      if (peer.epoch) peer.retired.add(peer.epoch);
      peer.epoch = epoch; peer.sequence = -1; peer.roomSequence = -1; peer.value = undefined; peer.departed = false;
    }
    if (!peer) {
      if (group.size >= 128) throw new StudioError('BUSY', '当前作品的在线页面过多。');
      peer = { actorId: actor.id, ...(epoch ? { epoch } : {}), sequence: -1, roomSequence: -1, leaseUntil: now + LEASE_MS, streams: 0, retired: new Set(), tokens: 80, budgetAt: now }; group.set(peerId, peer);
    }
    if (peer.disconnect) { clearTimeout(peer.disconnect); peer.disconnect = undefined; }
    peer.leaseUntil = now + LEASE_MS;
    if (registration && !peer.value && !peer.departed) {
      peer.value = { peerId, actor: copy(actor), ...(epoch ? { peerEpoch: epoch } : {}), updatedAt: new Date(now).toISOString() };
      this.publishPresence(artifactId);
    }
    return { peerId, peer };
  }
  connectPeer(artifactId: string, peerId: string, peerEpoch: string | undefined, actor: Actor): () => void {
    const { peer } = this.peer(artifactId, { peerId, ...(peerEpoch ? { peerEpoch } : {}) }, actor, true); peer.streams++;
    let closed = false;
    return () => {
      if (closed) return; closed = true; peer.streams--;
      if (!peer.streams && this.peers.get(artifactId)?.get(peerId) === peer) { peer.disconnect = setTimeout(() => { peer.disconnect = undefined; if (!peer.streams && this.peers.get(artifactId)?.get(peerId) === peer) { peer.value = undefined; peer.leaseUntil = Date.now(); this.publishPresence(artifactId); } }, DISCONNECT_MS); peer.disconnect.unref(); }
    };
  }
  async sync(artifactId: string, options: SyncOptions, actor: Actor): Promise<SyncBatch> {
    const wait = options.wait ?? 0;
    if (!Number.isInteger(wait) || wait < 0 || wait > 20_000) throw new StudioError('INVALID_ARGUMENT', '同步等待时间应为 0 至 20000 毫秒。');
    if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Aborted', 'AbortError');
    if (options.peerId) this.peer(artifactId, { peerId: options.peerId, ...(options.peerEpoch ? { peerEpoch: options.peerEpoch } : {}) }, actor, true);
    const read = (): SyncBatch => ({ ...this.events.read(artifactId, options.after), peers: this.getPresence(artifactId), timer: artifactId ? this.getTimer(artifactId) : null, serverTime: Date.now() });
    const initial = read();
    if (!wait || initial.reset || initial.events.length) return initial;
    return new Promise<SyncBatch>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined, done = false;
      const finish = (error?: unknown) => { if (done) return; done = true; unsubscribe(); if (timer) clearTimeout(timer); options.signal?.removeEventListener('abort', abort); if (error) reject(error); else resolve(read()); };
      const abort = () => finish(options.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
      const unsubscribe = this.subscribe(artifactId, () => finish());
      timer = setTimeout(() => finish(), wait); timer.unref(); options.signal?.addEventListener('abort', abort, { once: true });
      // Subscribe before rechecking: a change between the first read and wait is replayed.
      const current = this.events.read(artifactId, options.after); if (current.reset || current.events.length) finish();
    });
  }
  private serialized<T>(artifactId: string, run: () => Promise<T>): Promise<T> {
    const task = (this.queues.get(artifactId) ?? Promise.resolve()).catch(() => {}).then(run);
    this.queues.set(artifactId, task); void task.finally(() => { if (this.queues.get(artifactId) === task) this.queues.delete(artifactId); }).catch(() => {}); return task;
  }
  update(artifactId: string, input: Record<string, unknown>, actor: Actor, validateActor?: () => Promise<Actor>) {
    return this.serialized(artifactId, async () => this.updateNow(artifactId, input, validateActor ? await validateActor() : actor));
  }
  private async updateNow(artifactId: string, input: Record<string, unknown>, actor: Actor) {
    if (Buffer.byteLength(JSON.stringify(input)) > 16 * 1024) throw new StudioError('TOO_LARGE', '在线状态过大。');
    if (input.context !== undefined && input.context !== null && !object(input.context) || input.cursor !== undefined && input.cursor !== null && !object(input.cursor) || input.following !== undefined && input.following !== null && typeof input.following !== 'string' || input.chat !== undefined && input.chat !== null && typeof input.chat !== 'string') throw new StudioError('INVALID_ARGUMENT', '在线状态字段无效。');
    if ((input.peerEpoch === undefined) !== (input.peerSeq === undefined)) throw new StudioError('INVALID_ARGUMENT', '页面代次和状态序号必须一起提供。');
    if (input.peerSeq !== undefined && (!Number.isSafeInteger(input.peerSeq) || Number(input.peerSeq) < 0)) throw new StudioError('INVALID_ARGUMENT', '在线状态序号无效。');
    const peerId = safeId(input.peerId ?? actor.id, '参与者 ID'), previous = this.peers.get(artifactId)?.get(peerId)?.value;
    const context = input.context === null ? undefined : object(input.context) ? copy(input.context) : copy(previous?.context);
    const ids = (value: unknown) => Array.isArray(value) && value.length <= 200 && value.every(id => typeof id === 'string' && id.length <= 200);
    if (context && (context.artifactId !== artifactId || typeof context.viewId !== 'string' || context.viewId.length > 120 || !ids(context.selectedIds) || context.editingIds !== undefined && !ids(context.editingIds) || context.movingIds !== undefined && !ids(context.movingIds) || context.dirty !== undefined && typeof context.dirty !== 'boolean')) throw new StudioError('INVALID_ARGUMENT', '视图上下文无效。');
    if (context && context.issues !== undefined) {
      if (!Array.isArray(context.issues)) throw new StudioError('INVALID_ARGUMENT', '视图问题无效。');
      context.issues = context.issues.slice(0, 5).map(issue => {
        if (!object(issue) || typeof issue.type !== 'string' || typeof issue.message !== 'string' || !ids(issue.ids)) throw new StudioError('INVALID_ARGUMENT', '视图问题无效。');
        return { type: issue.type.slice(0, 80), message: issue.message.slice(0, 500), ids: issue.ids };
      });
    }
    if (context && Buffer.byteLength(JSON.stringify(context)) > 6144) throw new StudioError('TOO_LARGE', '视图上下文超过 6 KiB。');
    const cursor = input.cursor === null ? null : object(input.cursor) ? { x: finite(input.cursor.x, 0), y: finite(input.cursor.y, 0), ...(typeof input.cursor.surface === 'string' ? { surface: input.cursor.surface.slice(0, 120) } : {}), t: Date.now() } : previous?.cursor;
    const following = input.following === null ? undefined : typeof input.following === 'string' ? input.following.slice(0, 120) : previous?.following;
    const chat = input.chat === null ? undefined : typeof input.chat === 'string' ? [...input.chat].slice(0, 50).join('') : previous?.chat;
    if (input.color !== undefined && (typeof input.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(input.color))) throw new StudioError('INVALID_ARGUMENT', '协作颜色无效。');
    if (input.visible !== undefined && typeof input.visible !== 'boolean') throw new StudioError('INVALID_ARGUMENT', '页面可见状态无效。');
    let nextTimer: RoomTimer | undefined;
    if (input.timer !== undefined) { requireRole(actor, ['owner', 'editor']); this.timers.get(artifactId, true); nextTimer = this.timerAction(artifactId, input.timer, actor); }
    // All caller-controlled fields are checked before reserving a bounded peer slot.
    const { peer } = this.peer(artifactId, input, actor);
    const sequence = input.peerSeq === undefined ? peer.sequence + 1 : Number(input.peerSeq);
    const result = (accepted: boolean) => ({ peers: this.getPresence(artifactId), timer: this.getTimer(artifactId), cursor: this.cursor(), serverTime: Date.now(), ...(peer.epoch ? { peerEpoch: peer.epoch } : {}), peerSeq: peer.sequence, accepted });
    if (sequence <= peer.sequence) return result(false);
    const now = Date.now(); peer.tokens = Math.min(80, peer.tokens + (now - peer.budgetAt) * 40 / 1000); peer.budgetAt = now;
    if (input.leave !== true && input.timer === undefined && peer.tokens < 1) return result(false);
    if (input.leave !== true && input.timer === undefined) peer.tokens--;
    const next: Presence | undefined = input.leave === true ? undefined : { peerId, actor: copy(actor), ...(peer.epoch ? { peerEpoch: peer.epoch, peerSeq: sequence } : {}), ...(context ? { context: context as Presence['context'] } : {}), ...(cursor !== undefined ? { cursor } : {}), ...(following !== undefined ? { following } : {}), ...(chat !== undefined ? { chat, chatExpiresAt: input.chat === undefined ? previous?.chatExpiresAt : Date.now() + 5000 } : {}), ...(input.color !== undefined || previous?.color ? { color: input.color as string | undefined ?? previous?.color } : {}), ...(input.visible !== undefined || previous?.visible !== undefined ? { visible: input.visible as boolean | undefined ?? previous?.visible } : {}), updatedAt: new Date(now).toISOString() };
    if (nextTimer) await this.timers.set(artifactId, nextTimer);
    peer.value = next; peer.sequence = sequence; peer.departed = input.leave === true; this.publishPresence(artifactId); return result(true);
  }
  private timerAction(artifactId: string, input: unknown, actor: Actor): RoomTimer {
    requireRole(actor, ['owner', 'editor']);
    if (!object(input)) throw new StudioError('INVALID_ARGUMENT', '计时器操作无效。');
    const current = this.getTimer(artifactId), now = Date.now();
    const duration = () => {
      if (!Number.isInteger(input.durationSeconds) || Number(input.durationSeconds) < 1 || Number(input.durationSeconds) > 5999) throw new StudioError('INVALID_ARGUMENT', '计时时长应为 1 秒至 99 分 59 秒。');
      return Number(input.durationSeconds) * 1000;
    };
    if (input.action === 'reset') { const durationMs = current?.durationMs ?? 300_000; return { durationMs, deadline: null, remainingMs: durationMs, paused: false, source: copy(actor) }; }
    if (input.action === 'set-duration') {
      if (current && current.deadline !== null && !current.paused && current.remainingMs > 0) throw new StudioError('INVALID_ARGUMENT', '请先暂停计时器再设置时长。');
      const durationMs = duration();
      return { durationMs, deadline: null, remainingMs: durationMs, paused: false, source: copy(actor) };
    }
    if (input.action === 'start') {
      const durationMs = input.durationSeconds === undefined && current ? current.durationMs : duration();
      const remainingMs = input.durationSeconds === undefined && current && current.remainingMs > 0 ? current.remainingMs : durationMs;
      return { durationMs, deadline: now + remainingMs, remainingMs, paused: false, source: copy(actor) };
    }
    if (input.action === 'adjust') {
      if (input.deltaSeconds !== 60 && input.deltaSeconds !== -60) throw new StudioError('INVALID_ARGUMENT', '运行中每次只能增加或减少 1 分钟。');
      if (!current || current.deadline === null || current.paused || current.remainingMs <= 0) throw new StudioError('INVALID_ARGUMENT', '只能调整运行中的计时器。');
      const remainingMs = current.remainingMs + Number(input.deltaSeconds) * 1000;
      if (remainingMs < 1000 || remainingMs > 5_999_000) throw new StudioError('INVALID_ARGUMENT', '调整后的剩余时间须为 1 秒至 99 分 59 秒。');
      return { ...current, deadline: now + remainingMs, remainingMs, source: copy(actor) };
    }
    if (input.action !== 'pause' && input.action !== 'resume') throw new StudioError('INVALID_ARGUMENT', '计时器操作无效。');
    if (!current) throw new StudioError('INVALID_ARGUMENT', '请先启动计时器。');
    if (input.action === 'pause') return { ...current, deadline: null, paused: true, source: copy(actor) };
    const remainingMs = current.remainingMs > 0 ? current.remainingMs : current.durationMs;
    return { ...current, deadline: now + remainingMs, remainingMs, paused: false, source: copy(actor) };
  }
  getTimer(artifactId: string): RoomTimer | null {
    return this.timers.get(artifactId);
  }
  getPresence(artifactId: string): Presence[] {
    const group = this.peers.get(artifactId); if (!group) return [];
    const now = Date.now();
    return copy([...group.values()].flatMap(peer => {
      if (!peer.value || !peer.streams && peer.leaseUntil <= now) return [];
      const value = copy(peer.value); if (value.chatExpiresAt !== undefined && value.chatExpiresAt <= now) { delete value.chat; delete value.chatExpiresAt; }
      return [value];
    }));
  }
  private publishPresence(artifactId: string): void { this.emit({ type: 'presence', artifactId, peers: this.getPresence(artifactId), timer: this.getTimer(artifactId), serverTime: Date.now() }); }
  private expire(): void {
    const now = Date.now();
    for (const [artifactId, group] of this.peers) {
      let changed = false;
      for (const [peerId, peer] of group) {
        if (!peer.streams && peer.leaseUntil <= now && peer.value) { peer.value = undefined; changed = true; }
        if (peerId.startsWith('agent-') && !peer.streams && peer.leaseUntil <= now) { group.delete(peerId); continue; }
        // Retain short-lived tombstones so delayed leave packets cannot resurrect a peer.
        if (!peer.streams && now - peer.leaseUntil > 15 * 60_000) { group.delete(peerId); this.rooms.get(artifactId)?.forget(peerId); }
      }
      if (changed) this.publishPresence(artifactId);
      if (!group.size) this.peers.delete(artifactId);
    }
  }
  room(artifactId: string, input: Record<string, unknown>, actor: Actor) {
    if ((input.peerEpoch === undefined) !== (input.peerSeq === undefined) || input.peerSeq !== undefined && (!Number.isSafeInteger(input.peerSeq) || Number(input.peerSeq) < 0)) throw new StudioError('INVALID_ARGUMENT', '临时协作的页面代次或序号无效。');
    const messages = CollaborationRoom.validate(input.events, actor);
    const { peerId, peer } = this.peer(artifactId, input, actor);
    if (input.peerSeq !== undefined && Number(input.peerSeq) <= peer.roomSequence) return { accepted: 0, dropped: Array.isArray(input.events) ? input.events.length : 0, cursor: this.cursor(), serverTime: Date.now() };
    let room = this.rooms.get(artifactId); if (!room) { room = new CollaborationRoom(); this.rooms.set(artifactId, room); }
    const result = room.accept(peerId, messages, actor);
    if (input.peerSeq !== undefined) peer.roomSequence = Number(input.peerSeq);
    if (result.messages.length) this.emit({ type: 'room', artifactId, events: result.messages, expiresAt: result.expiresAt });
    return { accepted: result.messages.length, dropped: result.dropped, cursor: this.cursor(), serverTime: Date.now() };
  }
  beginActivity(artifactId: string, actor: Actor, input: Omit<Activity, 'actor'>): () => void {
    if (actor.kind !== 'agent') throw new StudioError('FORBIDDEN', '代理活动必须由服务端登记。');
    this.getTimer(artifactId);
    const activityId = randomUUID(), key = `${artifactId}:${actor.id}`, group = this.activities.get(key) ?? new Map<string, Activity>();
    group.set(activityId, { actor: copy(actor), ...copy(input) }); this.activities.set(key, group);
    const peerId = `agent-${createHash('sha256').update(actor.id).digest('hex').slice(0, 24)}`;
    const publish = () => {
      if (this.activities.get(key) !== group) return;
      const entries = [...group.values()], peers = this.group(artifactId); let peer = peers.get(peerId);
      if (!entries.length) {
        if (peer?.value) {
          peer.leaseUntil = Date.now() + AGENT_IDLE_MS;
          peer.value = { ...peer.value, context: { ...peer.value.context!, editingIds: [], movingIds: [], activity: 'idle', lastActivity: input.status }, updatedAt: new Date().toISOString() };
        }
        this.activities.delete(key); this.publishPresence(artifactId); return;
      }
      if (!peer) { peer = { actorId: actor.id, sequence: 0, roomSequence: -1, leaseUntil: Number.POSITIVE_INFINITY, streams: 0, retired: new Set(), tokens: 80, budgetAt: Date.now() }; peers.set(peerId, peer); }
      peer.leaseUntil = Number.POSITIVE_INFINITY;
      peer.value = { peerId, actor: copy(actor), context: { artifactId, viewId: input.viewId ?? peerId, selectedIds: [...new Set(entries.flatMap(item => item.selectedIds ?? []))], editingIds: [...new Set(entries.flatMap(item => item.editingIds ?? []))], activity: entries.some(item => item.status === 'writing') ? 'writing' : 'reading' }, updatedAt: new Date().toISOString() };
      this.publishPresence(artifactId);
    };
    publish(); let done = false; return () => { if (done) return; done = true; group.delete(activityId); publish(); };
  }
  revokeMembers(artifactId: string, memberIds: readonly string[]): void {
    const group = this.peers.get(artifactId), revoked = new Set(memberIds); if (!group) return;
    for (const [peerId, peer] of group) if (revoked.has(peer.actorId)) { if (peer.disconnect) clearTimeout(peer.disconnect); group.delete(peerId); }
    this.publishPresence(artifactId);
  }
  forget(artifactId: string): void { for (const peer of this.peers.get(artifactId)?.values() ?? []) if (peer.disconnect) clearTimeout(peer.disconnect); this.peers.delete(artifactId); this.timers.forget(artifactId); this.rooms.delete(artifactId); for (const key of this.activities.keys()) if (key.startsWith(`${artifactId}:`)) this.activities.delete(key); }
  close(): void { clearInterval(this.expiry); for (const id of this.peers.keys()) this.forget(id); this.listeners.clear(); this.activities.clear(); this.timers.close(); this.events.clear(); }
}
