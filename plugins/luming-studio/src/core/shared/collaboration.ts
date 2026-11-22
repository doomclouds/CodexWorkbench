import { createHash, randomUUID } from 'node:crypto';
import { debuglog } from 'node:util';
import {
  AGENT_TASK_FADE_MS,
  AGENT_TASK_LEASE_MS,
  type Actor,
  type AgentActivityScope,
  type AgentTask,
  type AgentTaskBinding,
  type AgentTaskOutcome,
  type BoardElement,
  type Presence,
  type RoomTimer,
  type StudioEvent,
  type SyncBatch,
} from '../../contracts/studio.js';
import type { RoomTimerStore } from '../ports/room-timer-store.js';
import { copy, finite, object, requireRole, safeId, StudioError } from './common.js';
import { CollaborationEvents } from './collaboration-events.js';
import { CollaborationRoom } from './collaboration-room.js';
import { RoomTimers } from './room-timers.js';
import {
  assertWorkspaceAvailable,
  sameTaskScope,
  taskBinding,
  type AgentWorkspace,
} from './agent-workspaces.js';

export interface SyncOptions {
  after?: string;
  wait?: number;
  signal?: AbortSignal;
  peerId?: string;
  peerEpoch?: string;
}
interface PeerState {
  actorId: string;
  epoch?: string;
  sequence: number;
  roomSequence: number;
  value?: Presence;
  departed?: boolean;
  leaseUntil: number;
  streams: number;
  disconnect?: ReturnType<typeof setTimeout>;
  retired: Set<string>;
  tokens: number;
  budgetAt: number;
}
interface Activity {
  actor: Actor;
  status: 'reading' | 'writing';
  editingIds?: string[];
  selectedIds?: string[];
  viewId?: string;
  binding?: AgentTaskBinding;
}
interface AgentTasks {
  artifactId: string;
  actor: Actor;
  tasks: Map<string, AgentTask>;
}
interface EndedTask extends AgentTaskBinding {
  endedAt: number;
  outcome: AgentTaskOutcome;
}
interface TaskResult {
  tasks: AgentTask[];
  ended?: EndedTask;
  endedTasks?: EndedTask[];
}

const LEASE_MS = 45_000;
const DISCONNECT_MS = 4000;
const AGENT_IDLE_MS = 20_000;
const MAX_AGENT_TASKS = 8;
const MAX_BOARD_TASKS = 64;
const MAX_CLOSED_TASKS = 512;
const MAX_PRESENCE_UPDATE_BYTES = 16 * 1024;
const MAX_VIEW_CONTEXT_BYTES = 6 * 1024;

const debug = debuglog('luming-studio');

function invalidPeerSequence(value: unknown): boolean {
  return value !== undefined && (!Number.isSafeInteger(value) || Number(value) < 0);
}

function checkPeerEpoch(
  peer: PeerState,
  epoch: string | undefined,
  registration: boolean,
  now: number,
): void {
  if (!epoch) {
    if (peer.epoch) {
      throw new StudioError('STALE_PEER', '页面协作代次已失效。');
    }

    return;
  }
  if (peer.retired.has(epoch)) {
    throw new StudioError('STALE_PEER', '页面协作代次已失效。');
  }
  if (peer.epoch === epoch) {
    return;
  }

  const stillActive = peer.streams > 0 || peer.leaseUntil > now;
  if (peer.epoch && (!registration || stillActive)) {
    throw new StudioError('STALE_PEER', '页面协作代次已失效。');
  }

  if (peer.epoch) {
    peer.retired.add(peer.epoch);
  }

  peer.epoch = epoch;
  peer.sequence = -1;
  peer.roomSequence = -1;
  peer.value = undefined;
  peer.departed = false;
}

function invalidPresenceObject(value: unknown): boolean {
  return value !== undefined && value !== null && !object(value);
}

function assertPresenceFields(input: Record<string, unknown>): void {
  if (Buffer.byteLength(JSON.stringify(input)) > MAX_PRESENCE_UPDATE_BYTES) {
    throw new StudioError('TOO_LARGE', '在线状态过大。');
  }

  const invalidFollowing =
    input.following !== undefined &&
    input.following !== null &&
    typeof input.following !== 'string';

  if (
    invalidPresenceObject(input.context) ||
    invalidPresenceObject(input.cursor) ||
    invalidFollowing
  ) {
    throw new StudioError('INVALID_ARGUMENT', '在线状态字段无效。');
  }
  if ((input.peerEpoch === undefined) !== (input.peerSeq === undefined)) {
    throw new StudioError('INVALID_ARGUMENT', '页面代次和状态序号必须一起提供。');
  }
  if (invalidPeerSequence(input.peerSeq)) {
    throw new StudioError('INVALID_ARGUMENT', '在线状态序号无效。');
  }
}

function validIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 200 &&
    value.every((id) => typeof id === 'string' && id.length <= 200)
  );
}

const editableContextFields = ['editingIds', 'savingIds', 'movingIds'] as const;

function normalizeContextIssues(issues: unknown) {
  if (!Array.isArray(issues)) {
    throw new StudioError('INVALID_ARGUMENT', '视图问题无效。');
  }

  return issues.slice(0, 5).map((issue: unknown) => {
    if (!object(issue) || typeof issue.type !== 'string' || typeof issue.message !== 'string') {
      throw new StudioError('INVALID_ARGUMENT', '视图问题无效。');
    }
    if (!validIds(issue.ids)) {
      throw new StudioError('INVALID_ARGUMENT', '视图问题无效。');
    }

    return {
      type: issue.type.slice(0, 80),
      message: issue.message.slice(0, 500),
      ids: issue.ids,
    };
  });
}

function presenceContextBytes(context: Record<string, unknown>, idLists: readonly string[][]) {
  let bytes = Buffer.byteLength(JSON.stringify(context));
  if (bytes <= MAX_VIEW_CONTEXT_BYTES) {
    return bytes;
  }

  const seen = new Set<string>();
  for (const ids of idLists) {
    for (const id of ids) {
      if (seen.has(id)) {
        bytes -= Buffer.byteLength(JSON.stringify(id).slice(1, -1));
      }

      seen.add(id);
    }
  }

  return bytes;
}

function presenceContext(
  artifactId: string,
  value: unknown,
  previous: Presence['context'],
  actor: Actor,
): Presence['context'] {
  if (value === null) {
    return;
  }

  const context = object(value) ? copy(value) : copy(previous);
  if (!context) {
    return;
  }
  if (context.artifactId !== artifactId || typeof context.viewId !== 'string') {
    throw new StudioError('INVALID_ARGUMENT', '视图上下文无效。');
  }
  if (context.viewId.length > 120 || !validIds(context.selectedIds)) {
    throw new StudioError('INVALID_ARGUMENT', '视图上下文无效。');
  }

  const idLists = [context.selectedIds];
  for (const field of editableContextFields) {
    const ids = context[field];
    if (ids === undefined) {
      continue;
    }
    if (!validIds(ids)) {
      throw new StudioError('INVALID_ARGUMENT', '视图上下文无效。');
    }

    idLists.push(ids);
  }

  if (context.dirty !== undefined && typeof context.dirty !== 'boolean') {
    throw new StudioError('INVALID_ARGUMENT', '视图上下文无效。');
  }

  if (context.issues !== undefined) {
    const issues = normalizeContextIssues(context.issues);
    context.issues = issues;
    idLists.push(...issues.map(({ ids }) => ids));
  }
  if (presenceContextBytes(context, idLists) > MAX_VIEW_CONTEXT_BYTES) {
    throw new StudioError('TOO_LARGE', '视图上下文超过 6 KiB。');
  }

  if (!['owner', 'editor'].includes(actor.role)) {
    for (const field of editableContextFields) {
      if (context[field] !== undefined) {
        context[field] = [];
      }
    }
  }

  return context as Presence['context'];
}

function presenceCursor(value: unknown, previous: Presence['cursor']): Presence['cursor'] {
  if (value === null) {
    return null;
  }
  if (!object(value)) {
    return previous;
  }

  return {
    x: finite(value.x, 0),
    y: finite(value.y, 0),
    ...(typeof value.surface === 'string' ? { surface: value.surface.slice(0, 120) } : {}),
    t: Date.now(),
  };
}

function presenceFollowing(value: unknown, previous: string | undefined): string | undefined {
  if (value === null) {
    return;
  }

  return typeof value === 'string' ? value.slice(0, 120) : previous;
}

function presenceDetails(
  artifactId: string,
  input: Record<string, unknown>,
  previous: Presence | undefined,
  actor: Actor,
) {
  const context = presenceContext(artifactId, input.context, previous?.context, actor);
  const cursor = presenceCursor(input.cursor, previous?.cursor);
  const following = presenceFollowing(input.following, previous?.following);
  if (
    input.color !== undefined &&
    (typeof input.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(input.color))
  ) {
    throw new StudioError('INVALID_ARGUMENT', '协作颜色无效。');
  }
  if (input.visible !== undefined && typeof input.visible !== 'boolean') {
    throw new StudioError('INVALID_ARGUMENT', '页面可见状态无效。');
  }

  const previousColor = previous?.color;
  const previousVisible = previous?.visible;

  return {
    ...(context ? { context } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
    ...(following !== undefined ? { following } : {}),
    ...(input.color !== undefined || previousColor ? { color: input.color ?? previousColor } : {}),
    ...(input.visible !== undefined || previousVisible !== undefined
      ? { visible: input.visible ?? previousVisible }
      : {}),
  };
}

function acceptPresenceBudget(
  peer: PeerState,
  input: Record<string, unknown>,
  now: number,
): boolean {
  peer.tokens = Math.min(80, peer.tokens + ((now - peer.budgetAt) * 40) / 1000);
  peer.budgetAt = now;
  if (input.leave === true || input.timer !== undefined) {
    return true;
  }
  if (peer.tokens < 1) {
    return false;
  }

  peer.tokens--;

  return true;
}

function timerDuration(input: unknown): number {
  const seconds = typeof input === 'number' ? input : NaN;
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 5999) {
    throw new StudioError('INVALID_ARGUMENT', '计时时长应为 1 秒至 99 分 59 秒。');
  }

  return seconds * 1000;
}

function runningTimer(timer: RoomTimer | null): timer is RoomTimer {
  return !!timer && timer.deadline !== null && !timer.paused && timer.remainingMs > 0;
}

function freshTimer(durationMs: number, actor: Actor): RoomTimer {
  return {
    durationMs,
    deadline: null,
    remainingMs: durationMs,
    paused: false,
    source: copy(actor),
  };
}

interface TaskSlot {
  key: string;
  taskId: string;
  group?: AgentTasks;
}

function requireTaskActor(action: unknown, actor: Actor): void {
  const release = action === 'release';
  const expectedKind = release ? 'human' : 'agent';
  if (actor.kind !== expectedKind || actor.role !== 'owner') {
    throw new StudioError(
      'FORBIDDEN',
      release
        ? '只有房主本人可以结束其他 Agent 的工作。'
        : '工作区域只能由已授权的所有者 Agent 声明。',
    );
  }
}

function readScopeIds(value: unknown): string[] | undefined {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value) || value.length > 200) {
    throw new StudioError('INVALID_ARGUMENT', '工作区域对象无效或超过 200 个。');
  }
  if (
    !value.every((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200)
  ) {
    throw new StudioError('INVALID_ARGUMENT', '工作区域对象无效或超过 200 个。');
  }

  return value.length ? [...new Set(value)] : undefined;
}

function readScopeRect(value: unknown): AgentActivityScope['rect'] {
  if (value === undefined) {
    return;
  }
  if (!object(value) || !['x', 'y', 'w', 'h'].every((field) => typeof value[field] === 'number')) {
    throw new StudioError('INVALID_ARGUMENT', '工作区域坐标无效。');
  }

  const rect = {
    x: finite(value.x, 0),
    y: finite(value.y, 0),
    w: finite(value.w, 0),
    h: finite(value.h, 0),
  };
  const outOfBounds = Math.abs(rect.x + rect.w) > 1e7 || Math.abs(rect.y + rect.h) > 1e7;
  if (rect.w <= 0 || rect.h <= 0 || outOfBounds) {
    throw new StudioError('INVALID_ARGUMENT', '工作区域尺寸无效。');
  }

  return rect;
}

function readTaskScope(value: unknown): AgentActivityScope | undefined {
  if (value === undefined) {
    return;
  }
  if (!object(value)) {
    throw new StudioError('INVALID_ARGUMENT', '工作区域无效。');
  }

  const scope: AgentActivityScope = {};
  const ids = readScopeIds(value.ids);
  const rect = readScopeRect(value.rect);
  if (ids) {
    scope.ids = ids;
  }
  if (rect) {
    scope.rect = rect;
  }
  if (!scope.ids?.length && !scope.rect) {
    throw new StudioError('INVALID_ARGUMENT', '请选择工作对象或声明有效的空地区域。');
  }

  return scope;
}

function validateTaskInput(
  input: Record<string, unknown>,
  action: unknown,
  scope?: AgentActivityScope,
): void {
  if (
    input.label !== undefined &&
    (typeof input.label !== 'string' || [...input.label].length > 80)
  ) {
    throw new StudioError('INVALID_ARGUMENT', '工作描述最多 80 个字符。');
  }
  if (action === 'begin' && !scope) {
    throw new StudioError('INVALID_ARGUMENT', '开始任务时需要工作区域。');
  }
  if (
    input.phase !== undefined &&
    !['preparing', 'writing', 'verifying'].includes(String(input.phase))
  ) {
    throw new StudioError('INVALID_ARGUMENT', '工作任务阶段无效。');
  }
}

function assertTaskCanOpen(
  action: unknown,
  input: Record<string, unknown>,
  scope: AgentActivityScope | undefined,
  previous: AgentTask | undefined,
  closed: EndedTask | undefined,
): void {
  if (action === 'begin' && input.generation !== undefined) {
    const generation = safeId(input.generation, '任务代次');
    const latest = previous ? previous.generation : closed?.generation;
    if (latest !== generation) {
      throw new StudioError(
        'TASK_STALE',
        '旧任务代次不能重新开始工作，请读取最新内容后声明新的任务。',
      );
    }
  }
  if (previous && scope && !sameTaskScope(previous.scope, scope)) {
    throw new StudioError(
      'TASK_SCOPE',
      '活跃任务不能直接更换工作范围，请先结束并为新工作声明新任务。',
    );
  }

  if (!previous && closed) {
    const released = closed.outcome === 'released';
    if (released || input.generation !== closed.generation) {
      throw new StudioError(
        'TASK_CLOSED',
        released
          ? '房主已结束此任务，不能自动重新申请；收到新任务后请使用新的任务 ID。'
          : '该任务已经结束，请读取最新内容，并带上最近结束的代次明确重新申请。',
        { outcome: closed.outcome },
      );
    }
  }
}

function taskRecord(
  taskId: string,
  scope: AgentActivityScope,
  input: Record<string, unknown>,
  previous?: AgentTask,
): AgentTask {
  const now = Date.now();
  const phase = (input.phase as AgentTask['phase']) ?? previous?.phase ?? 'preparing';

  return {
    taskId,
    generation: previous?.generation ?? randomUUID(),
    scope: copy(scope),
    phase,
    label: input.label === undefined ? previous?.label : String(input.label).trim() || undefined,
    startedAt: previous?.startedAt ?? now,
    lastActivityAt: now,
    lastProgressAt: !previous || previous.phase !== phase ? now : previous.lastProgressAt,
    expiresAt: now + AGENT_TASK_LEASE_MS,
  };
}

function agentLeaseUntil(entries: Activity[], live: AgentTask[]): number {
  if (entries.length) {
    return Infinity;
  }

  return live.length ? Math.max(...live.map((task) => task.expiresAt)) : Date.now() + AGENT_IDLE_MS;
}

function agentActivity(entries: Activity[], live: AgentTask[]): string {
  if (entries.some((item) => item.status === 'writing')) {
    return 'writing';
  }
  if (entries.length) {
    return 'reading';
  }

  return live.length ? 'working' : 'idle';
}

export class StudioCollaboration {
  private listeners = new Map<string, Set<(event: StudioEvent) => void>>();
  private peers = new Map<string, Map<string, PeerState>>();
  private readonly timers: RoomTimers;
  private readonly events = new CollaborationEvents();
  private rooms = new Map<string, CollaborationRoom>();
  private queues = new Map<string, Promise<unknown>>();
  private activities = new Map<string, Map<string, Activity>>();
  private agentTasks = new Map<string, AgentTasks>();
  private closedTasks = new Map<string, EndedTask>();
  private terminalTasks = new Map<string, { artifactId: string; actor: Actor; task: AgentTask }>();
  private taskDeadline?: ReturnType<typeof setTimeout>;
  private readonly expiry: ReturnType<typeof setInterval>;
  constructor(timerStore?: RoomTimerStore) {
    this.timers = new RoomTimers(timerStore);
    this.expiry = setInterval(() => this.expire(), 1000);
    this.expiry.unref();
  }
  subscribe(artifactId: string, listener: (event: StudioEvent) => void): () => void {
    const key = artifactId || '*';
    const group = this.listeners.get(key) ?? new Set();
    group.add(listener);
    this.listeners.set(key, group);

    return () => {
      group.delete(listener);
      if (!group.size) {
        this.listeners.delete(key);
      }
    };
  }
  emit(event: StudioEvent): void {
    const published = this.events.append(event);
    for (const listener of [
      ...(this.listeners.get(event.artifactId) ?? []),
      ...(this.listeners.get('*') ?? []),
    ]) {
      try {
        listener(copy(published));
      } catch (error) {
        debug('Collaboration listener failed: %o', error);
      }
    }
  }
  cursor(): string {
    return this.events.cursor();
  }
  private group(artifactId: string) {
    let group = this.peers.get(artifactId);
    if (!group) {
      group = new Map();
      this.peers.set(artifactId, group);
    }

    return group;
  }
  private peer(
    artifactId: string,
    input: Record<string, unknown>,
    actor: Actor,
    registration = false,
  ): { peerId: string; peer: PeerState } {
    if (artifactId) {
      this.getTimer(artifactId);
    }

    const peerId = safeId(input.peerId ?? actor.id, '参与者 ID');
    const group = this.group(artifactId);
    const now = Date.now();
    if (peerId.startsWith('agent-')) {
      throw new StudioError('FORBIDDEN', '代理页面状态只能由服务端登记。');
    }

    const epoch = input.peerEpoch === undefined ? undefined : safeId(input.peerEpoch, '页面代次');
    let peer = group.get(peerId);
    if (peer) {
      if (peer.actorId !== actor.id) {
        throw new StudioError('FORBIDDEN', '不能更新其他参与者的状态。');
      }

      checkPeerEpoch(peer, epoch, registration, now);
    } else {
      if (group.size >= 128) {
        throw new StudioError('BUSY', '当前作品的在线页面过多。');
      }

      peer = {
        actorId: actor.id,
        ...(epoch ? { epoch } : {}),
        sequence: -1,
        roomSequence: -1,
        leaseUntil: now + LEASE_MS,
        streams: 0,
        retired: new Set(),
        tokens: 80,
        budgetAt: now,
      };
      group.set(peerId, peer);
    }
    if (peer.disconnect) {
      clearTimeout(peer.disconnect);
      peer.disconnect = undefined;
    }

    peer.leaseUntil = now + LEASE_MS;
    if (registration && !peer.value && !peer.departed) {
      peer.value = {
        peerId,
        actor: copy(actor),
        ...(epoch ? { peerEpoch: epoch } : {}),
        updatedAt: new Date(now).toISOString(),
      };
      this.publishPresence(artifactId);
    }

    return { peerId, peer };
  }
  connectPeer(
    artifactId: string,
    peerId: string,
    peerEpoch: string | undefined,
    actor: Actor,
  ): () => void {
    const { peer } = this.peer(
      artifactId,
      { peerId, ...(peerEpoch ? { peerEpoch } : {}) },
      actor,
      true,
    );
    peer.streams++;
    let closed = false;

    return () => {
      if (closed) {
        return;
      }

      closed = true;
      peer.streams--;
      if (!peer.streams && this.peers.get(artifactId)?.get(peerId) === peer) {
        peer.disconnect = setTimeout(() => {
          peer.disconnect = undefined;
          if (!peer.streams && this.peers.get(artifactId)?.get(peerId) === peer) {
            peer.value = undefined;
            peer.leaseUntil = Date.now();
            this.publishPresence(artifactId);
          }
        }, DISCONNECT_MS);
        peer.disconnect.unref();
      }
    };
  }
  async sync(artifactId: string, options: SyncOptions, actor: Actor): Promise<SyncBatch> {
    const wait = options.wait ?? 0;
    if (!Number.isInteger(wait) || wait < 0 || wait > 20_000) {
      throw new StudioError('INVALID_ARGUMENT', '同步等待时间应为 0 至 20000 毫秒。');
    }
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new DOMException('Aborted', 'AbortError');
    }

    if (options.peerId) {
      this.peer(
        artifactId,
        { peerId: options.peerId, ...(options.peerEpoch ? { peerEpoch: options.peerEpoch } : {}) },
        actor,
        true,
      );
    }

    const read = (): SyncBatch => ({
      ...this.events.read(artifactId, options.after),
      peers: this.getPresence(artifactId),
      timer: artifactId ? this.getTimer(artifactId) : null,
      serverTime: Date.now(),
    });
    const initial = read();
    if (!wait || initial.reset || initial.events.length) {
      return initial;
    }

    return new Promise<SyncBatch>((resolve, reject) => {
      let done = false;
      const finish = (error?: unknown) => {
        if (done) {
          return;
        }

        done = true;
        unsubscribe();
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
        if (error) {
          reject(error);
        } else {
          resolve(read());
        }
      };

      const abort = () =>
        finish(options.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
      const unsubscribe = this.subscribe(artifactId, () => finish());
      const timer = setTimeout(() => finish(), wait);
      timer.unref();
      options.signal?.addEventListener('abort', abort, { once: true });

      const current = this.events.read(artifactId, options.after);
      if (current.reset || current.events.length) {
        finish();
      }
    });
  }
  private serialized<T>(artifactId: string, run: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(artifactId) ?? Promise.resolve();
    const runNext = () => run();
    const task = previous.then(runNext, runNext);
    this.queues.set(artifactId, task);
    const release = () => {
      if (this.queues.get(artifactId) === task) {
        this.queues.delete(artifactId);
      }
    };

    void task.then(release, release);

    return task;
  }
  update(
    artifactId: string,
    input: Record<string, unknown>,
    actor: Actor,
    validateActor?: () => Promise<Actor>,
  ) {
    return this.serialized(artifactId, async () =>
      this.updateNow(artifactId, input, validateActor ? await validateActor() : actor),
    );
  }
  private async updateNow(artifactId: string, input: Record<string, unknown>, actor: Actor) {
    assertPresenceFields(input);
    const peerId = safeId(input.peerId ?? actor.id, '参与者 ID');
    const previous = this.peers.get(artifactId)?.get(peerId)?.value;
    const details = presenceDetails(artifactId, input, previous, actor);
    let nextTimer: RoomTimer | undefined;
    if (input.timer !== undefined) {
      requireRole(actor, ['owner', 'editor']);
      this.timers.get(artifactId, true);
      nextTimer = this.timerAction(artifactId, input.timer, actor);
    }

    const { peer } = this.peer(artifactId, input, actor);
    const sequence = input.peerSeq === undefined ? peer.sequence + 1 : Number(input.peerSeq);
    const result = (accepted: boolean) => ({
      peers: this.getPresence(artifactId),
      timer: this.getTimer(artifactId),
      cursor: this.cursor(),
      serverTime: Date.now(),
      ...(peer.epoch ? { peerEpoch: peer.epoch } : {}),
      peerSeq: peer.sequence,
      accepted,
    });

    if (sequence <= peer.sequence) {
      return result(false);
    }

    const now = Date.now();
    if (!acceptPresenceBudget(peer, input, now)) {
      return result(false);
    }

    const next: Presence | undefined =
      input.leave === true
        ? undefined
        : {
            peerId,
            actor: copy(actor),
            ...(peer.epoch ? { peerEpoch: peer.epoch, peerSeq: sequence } : {}),
            ...details,
            updatedAt: new Date(now).toISOString(),
          };

    if (nextTimer) {
      await this.timers.set(artifactId, nextTimer);
    }

    peer.value = next;
    peer.sequence = sequence;
    peer.departed = input.leave === true;
    this.publishPresence(artifactId);

    return result(true);
  }

  private timerAction(artifactId: string, input: unknown, actor: Actor): RoomTimer {
    requireRole(actor, ['owner', 'editor']);
    if (!object(input)) {
      throw new StudioError('INVALID_ARGUMENT', '计时器操作无效。');
    }

    const current = this.getTimer(artifactId);
    const now = Date.now();
    switch (input.action) {
      case 'reset':
        return freshTimer(current?.durationMs ?? 300_000, actor);
      case 'set-duration':
        if (runningTimer(current)) {
          throw new StudioError('INVALID_ARGUMENT', '请先暂停计时器再设置时长。');
        }

        return freshTimer(timerDuration(input.durationSeconds), actor);
      case 'start': {
        const reusedTimer = input.durationSeconds === undefined ? current : null;
        const durationMs = reusedTimer
          ? reusedTimer.durationMs
          : timerDuration(input.durationSeconds);
        const remainingMs =
          reusedTimer && reusedTimer.remainingMs > 0 ? reusedTimer.remainingMs : durationMs;

        return {
          durationMs,
          deadline: now + remainingMs,
          remainingMs,
          paused: false,
          source: copy(actor),
        };
      }

      case 'adjust':
        return this.adjustTimer(current, input.deltaSeconds, actor, now);
      case 'pause':
      case 'resume':
        break;
      default:
        throw new StudioError('INVALID_ARGUMENT', '计时器操作无效。');
    }

    if (!current) {
      throw new StudioError('INVALID_ARGUMENT', '请先启动计时器。');
    }
    if (input.action === 'pause') {
      return { ...current, deadline: null, paused: true, source: copy(actor) };
    }

    const remainingMs = current.remainingMs > 0 ? current.remainingMs : current.durationMs;

    return {
      ...current,
      deadline: now + remainingMs,
      remainingMs,
      paused: false,
      source: copy(actor),
    };
  }

  private adjustTimer(
    current: RoomTimer | null,
    delta: unknown,
    actor: Actor,
    now: number,
  ): RoomTimer {
    if (delta !== 60 && delta !== -60) {
      throw new StudioError('INVALID_ARGUMENT', '运行中每次只能增加或减少 1 分钟。');
    }
    if (!runningTimer(current)) {
      throw new StudioError('INVALID_ARGUMENT', '只能调整运行中的计时器。');
    }

    const remainingMs = current.remainingMs + delta * 1000;
    if (remainingMs < 1000 || remainingMs > 5_999_000) {
      throw new StudioError('INVALID_ARGUMENT', '调整后的剩余时间须为 1 秒至 99 分 59 秒。');
    }

    return { ...current, deadline: now + remainingMs, remainingMs, source: copy(actor) };
  }
  getTimer(artifactId: string): RoomTimer | null {
    return this.timers.get(artifactId);
  }
  getPresence(artifactId: string): Presence[] {
    const group = this.peers.get(artifactId);
    if (!group) {
      return [];
    }

    const now = Date.now();

    return copy(
      [...group.values()].flatMap((peer) => {
        if (!peer.value || (!peer.streams && peer.leaseUntil <= now)) {
          return [];
        }

        const value = copy(peer.value);
        if (value.context?.agentTasks) {
          value.context.agentTasks = value.context.agentTasks.filter((task) =>
            task.outcome ? task.endedAt! + AGENT_TASK_FADE_MS > now : task.expiresAt > now,
          );
        }

        return [value];
      }),
    );
  }
  private publishPresence(artifactId: string): void {
    this.emit({
      type: 'presence',
      artifactId,
      peers: this.getPresence(artifactId),
      timer: this.getTimer(artifactId),
      serverTime: Date.now(),
    });
  }
  private expire(): void {
    const now = Date.now();
    this.expireTasks(now);
    for (const [artifactId, group] of this.peers) {
      let changed = false;
      for (const [peerId, peer] of group) {
        if (!peer.streams && peer.leaseUntil <= now && peer.value) {
          peer.value = undefined;
          changed = true;
        }
        if (peerId.startsWith('agent-') && !peer.streams && peer.leaseUntil <= now) {
          group.delete(peerId);
          continue;
        }

        if (!peer.streams && now - peer.leaseUntil > 15 * 60_000) {
          group.delete(peerId);
          this.rooms.get(artifactId)?.forget(peerId);
        }
      }

      if (changed) {
        this.publishPresence(artifactId);
      }
      if (!group.size) {
        this.peers.delete(artifactId);
      }
    }
  }
  private expireTasks(now: number): void {
    const changed = new Map<string, { artifactId: string; actor: Actor }>();
    for (const [key, group] of this.agentTasks) {
      for (const task of [...group.tasks.values()]) {
        if (task.expiresAt <= now) {
          this.retireTask(group.artifactId, group.actor, task, 'expired', now);
          changed.set(key, group);
        }
      }
    }

    for (const [key, terminal] of this.terminalTasks) {
      if (terminal.task.endedAt! + AGENT_TASK_FADE_MS <= now) {
        this.terminalTasks.delete(key);
        changed.set(`${terminal.artifactId}:${terminal.actor.id}`, terminal);
      }
    }

    for (const item of changed.values()) {
      this.publishAgent(item.artifactId, item.actor);
    }

    this.scheduleTaskDeadline();
  }
  private scheduleTaskDeadline(): void {
    if (this.taskDeadline) {
      clearTimeout(this.taskDeadline);
    }

    const times = [...this.agentTasks.values()].flatMap((group) =>
      [...group.tasks.values()].map((task) => task.expiresAt),
    );
    times.push(
      ...[...this.terminalTasks.values()].map((item) => item.task.endedAt! + AGENT_TASK_FADE_MS),
    );
    this.taskDeadline = times.length
      ? setTimeout(() => this.expireTasks(Date.now()), Math.max(0, Math.min(...times) - Date.now()))
      : undefined;
    this.taskDeadline?.unref();
  }
  private retireTask(
    artifactId: string,
    actor: Actor,
    task: AgentTask,
    outcome: AgentTaskOutcome,
    endedAt = Date.now(),
  ): EndedTask {
    const key = `${artifactId}:${actor.id}`;
    const group = this.agentTasks.get(key);
    group?.tasks.delete(task.taskId);
    if (!group?.tasks.size) {
      this.agentTasks.delete(key);
    }

    const ended = { taskId: task.taskId, generation: task.generation, endedAt, outcome };
    const closedKey = `${key}:${task.taskId}`;
    this.closedTasks.delete(closedKey);
    this.closedTasks.set(closedKey, ended);
    while (this.closedTasks.size > MAX_CLOSED_TASKS) {
      this.closedTasks.delete(this.closedTasks.keys().next().value!);
    }

    this.terminalTasks.set(`${closedKey}:${task.generation}`, {
      artifactId,
      actor: copy(actor),
      task: { ...copy(task), endedAt, outcome },
    });

    for (const [id, activity] of this.activities.get(key) ?? []) {
      if (
        activity.binding?.taskId === task.taskId &&
        activity.binding.generation === task.generation
      ) {
        this.activities.get(key)!.delete(id);
      }
    }

    if (!this.activities.get(key)?.size) {
      this.activities.delete(key);
    }

    this.scheduleTaskDeadline();

    return ended;
  }
  workspaces(
    artifactId: string,
    except?: { actorId: string; binding: AgentTaskBinding },
  ): AgentWorkspace[] {
    this.expireTasks(Date.now());

    return [...this.agentTasks.values()]
      .filter((group) => group.artifactId === artifactId)
      .flatMap((group) =>
        [...group.tasks.values()]
          .filter(
            (task) =>
              !except ||
              group.actor.id !== except.actorId ||
              task.taskId !== except.binding.taskId ||
              task.generation !== except.binding.generation,
          )
          .map((task) => ({ actorId: group.actor.id, task: copy(task) })),
      );
  }
  assertTask(artifactId: string, actor: Actor, binding: AgentTaskBinding): AgentTask {
    this.expireTasks(Date.now());
    const task = this.agentTasks.get(`${artifactId}:${actor.id}`)?.tasks.get(binding.taskId);
    if (!task || task.generation !== binding.generation) {
      const ended = this.closedTasks.get(`${artifactId}:${actor.id}:${binding.taskId}`);
      if (!task && ended?.generation === binding.generation && ended.outcome !== 'expired') {
        throw new StudioError('TASK_CLOSED', '工作任务已经结束，原代次不能继续修改白板。', {
          outcome: ended.outcome,
        });
      }

      throw new StudioError(
        'TASK_STALE',
        '工作任务已过期或来自旧服务，请查询当前任务状态后重新安排。',
        { ...binding },
      );
    }

    return copy(task);
  }
  touchTask(
    artifactId: string,
    actor: Actor,
    binding: AgentTaskBinding,
    progress = false,
  ): boolean {
    this.expireTasks(Date.now());
    const task = this.agentTasks.get(`${artifactId}:${actor.id}`)?.tasks.get(binding.taskId);
    if (!task || task.generation !== binding.generation) {
      return false;
    }

    const now = Date.now();
    task.lastActivityAt = now;
    task.expiresAt = now + AGENT_TASK_LEASE_MS;
    if (progress) {
      task.lastProgressAt = now;
    }

    this.scheduleTaskDeadline();
    this.publishAgent(artifactId, actor);

    return true;
  }

  activity(
    artifactId: string,
    input: Record<string, unknown>,
    actor: Actor,
    elements: readonly BoardElement[] = [],
  ): TaskResult {
    const action = input.action;
    if (!['begin', 'update', 'end', 'status', 'release'].includes(String(action))) {
      throw new StudioError('INVALID_ARGUMENT', '工作区域动作无效。');
    }

    requireTaskActor(action, actor);
    this.getTimer(artifactId);
    this.expireTasks(Date.now());
    const targetActorId =
      action === 'release' ? safeId(input.targetActorId, '目标 Agent ID') : actor.id;
    const key = `${artifactId}:${targetActorId}`;
    const group = this.agentTasks.get(key);
    if (action === 'status') {
      return this.taskStatus(key, input, group);
    }

    const taskId = safeId(input.taskId, '任务 ID');
    const slot = { key, taskId, group };
    if (action === 'end' || action === 'release') {
      return this.endTask(artifactId, slot, action, input);
    }

    return this.openTask(artifactId, slot, action, input, actor, elements);
  }

  private snapshotTasks(key: string): AgentTask[] {
    return copy([...(this.agentTasks.get(key)?.tasks.values() ?? [])]);
  }

  private taskStatus(key: string, input: Record<string, unknown>, group?: AgentTasks): TaskResult {
    if (input.generation === undefined) {
      if (input.taskId !== undefined) {
        const requested = safeId(input.taskId, '任务 ID');
        const ended = this.closedTasks.get(`${key}:${requested}`);

        return {
          tasks: this.snapshotTasks(key).filter((task) => task.taskId === requested),
          ...(ended ? { ended: copy(ended) } : {}),
        };
      }

      const endedTasks = [...this.closedTasks]
        .filter(([closedKey]) => closedKey.startsWith(`${key}:`))
        .slice(-MAX_AGENT_TASKS)
        .map(([, ended]) => copy(ended));

      return { tasks: this.snapshotTasks(key), endedTasks };
    }

    const binding = taskBinding(input, true)!;
    const task = group?.tasks.get(binding.taskId);
    const ended = this.closedTasks.get(`${key}:${binding.taskId}`);
    if (task?.generation === binding.generation) {
      return { tasks: this.snapshotTasks(key) };
    }
    if (!task && ended?.generation === binding.generation) {
      return { tasks: this.snapshotTasks(key), ended: copy(ended) };
    }

    throw new StudioError('TASK_STALE', '工作任务代次已失效，请查询当前任务状态。');
  }

  private endTask(
    artifactId: string,
    { key, taskId, group }: TaskSlot,
    action: 'end' | 'release',
    input: Record<string, unknown>,
  ): TaskResult {
    const previous = group?.tasks.get(taskId);
    const binding = taskBinding(input, true)!;
    const ended = this.closedTasks.get(`${key}:${taskId}`);
    if (!group || !previous) {
      if (ended?.generation === binding.generation) {
        return { tasks: this.snapshotTasks(key), ended: copy(ended) };
      }

      throw new StudioError('TASK_STALE', '工作任务已结束或代次已失效，请查询当前任务状态。');
    }
    if (previous.generation !== binding.generation) {
      throw new StudioError('TASK_STALE', '旧任务代次不能结束当前工作。');
    }
    if (
      input.outcome !== undefined &&
      !['completed', 'failed', 'cancelled'].includes(String(input.outcome))
    ) {
      throw new StudioError('INVALID_ARGUMENT', '任务结束状态无效。');
    }

    const outcome =
      action === 'release' ? 'released' : ((input.outcome as AgentTaskOutcome) ?? 'completed');
    const result = this.retireTask(artifactId, group.actor, previous, outcome);
    this.publishAgent(artifactId, group.actor);

    return { tasks: this.snapshotTasks(key), ended: result };
  }

  private assertTaskCapacity(artifactId: string, group?: AgentTasks): void {
    const boardTaskCount = [...this.agentTasks.values()]
      .filter((entry) => entry.artifactId === artifactId)
      .reduce((sum, entry) => sum + entry.tasks.size, 0);

    if ((group?.tasks.size ?? 0) >= MAX_AGENT_TASKS || boardTaskCount >= MAX_BOARD_TASKS) {
      throw new StudioError('BUSY', '并行工作任务过多，请先结束已有任务。');
    }
  }

  private openTask(
    artifactId: string,
    { key, taskId, group }: TaskSlot,
    action: unknown,
    input: Record<string, unknown>,
    actor: Actor,
    elements: readonly BoardElement[],
  ): TaskResult {
    const previous = group?.tasks.get(taskId);
    const scope = readTaskScope(input.scope);
    validateTaskInput(input, action, scope);
    if (action === 'update') {
      this.assertTask(artifactId, actor, taskBinding(input, true)!);
    }

    const closed = this.closedTasks.get(`${key}:${taskId}`);
    assertTaskCanOpen(action, input, scope, previous, closed);
    if (!previous) {
      this.assertTaskCapacity(artifactId, group);
    }

    const current = group ?? {
      artifactId,
      actor: copy(actor),
      tasks: new Map<string, AgentTask>(),
    };
    current.actor = copy(actor);
    const nextScope = scope ?? previous!.scope;
    assertWorkspaceAvailable(nextScope, actor.id, this.workspaces(artifactId), elements);
    if (previous && this.agentTasks.get(key)?.tasks.get(taskId) !== previous) {
      throw new StudioError('TASK_STALE', '任务在重新申请前已过期，请查询最近代次后明确重新申请。');
    }

    current.tasks.set(taskId, taskRecord(taskId, nextScope, input, previous));
    this.agentTasks.set(key, current);
    this.publishAgent(artifactId, actor);
    this.scheduleTaskDeadline();

    return { tasks: copy([...current.tasks.values()]) };
  }
  private publishAgent(artifactId: string, actor: Actor, lastActivity?: string): void {
    const key = `${artifactId}:${actor.id}`;
    const live = [...(this.agentTasks.get(key)?.tasks.values() ?? [])];
    const entries = [...(this.activities.get(key)?.values() ?? [])].filter(
      (entry) =>
        !entry.binding ||
        live.some(
          (task) =>
            task.taskId === entry.binding!.taskId && task.generation === entry.binding!.generation,
        ),
    );
    const terminal = [...this.terminalTasks.values()]
      .filter(
        (item) =>
          item.artifactId === artifactId &&
          item.actor.id === actor.id &&
          item.task.endedAt! + AGENT_TASK_FADE_MS > Date.now(),
      )
      .map((item) => item.task);
    const tasks = [...live, ...terminal];
    const peers = this.group(artifactId);
    const peerId = `agent-${createHash('sha256').update(actor.id).digest('hex').slice(0, 24)}`;
    let peer = peers.get(peerId);
    if (!entries.length && !tasks.length) {
      if (!peer?.value) {
        return;
      }

      peer.leaseUntil = Date.now() + AGENT_IDLE_MS;
      peer.value = {
        ...peer.value,
        context: {
          ...peer.value.context!,
          editingIds: [],
          movingIds: [],
          agentTasks: [],
          activity: 'idle',
          lastActivity: lastActivity ?? peer.value.context?.activity,
        },
        updatedAt: new Date().toISOString(),
      };
    } else {
      if (!peer) {
        peer = {
          actorId: actor.id,
          sequence: 0,
          roomSequence: -1,
          leaseUntil: 0,
          streams: 0,
          retired: new Set(),
          tokens: 80,
          budgetAt: Date.now(),
        };
        peers.set(peerId, peer);
      }

      peer.leaseUntil = agentLeaseUntil(entries, live);
      peer.value = {
        peerId,
        actor: copy(actor),
        context: {
          artifactId,
          viewId: entries[0]?.viewId ?? peerId,
          selectedIds: [...new Set(entries.flatMap((item) => item.selectedIds ?? []))],
          editingIds: [...new Set(entries.flatMap((item) => item.editingIds ?? []))],
          agentTasks: copy(tasks),
          activity: agentActivity(entries, live),
        },
        updatedAt: new Date().toISOString(),
      };
    }

    this.publishPresence(artifactId);
  }
  room(artifactId: string, input: Record<string, unknown>, actor: Actor) {
    if (
      (input.peerEpoch === undefined) !== (input.peerSeq === undefined) ||
      invalidPeerSequence(input.peerSeq)
    ) {
      throw new StudioError('INVALID_ARGUMENT', '临时协作的页面代次或序号无效。');
    }

    const messages = CollaborationRoom.validate(input.events, actor);
    const { peerId, peer } = this.peer(artifactId, input, actor);
    if (input.peerSeq !== undefined && Number(input.peerSeq) <= peer.roomSequence) {
      return {
        accepted: 0,
        dropped: Array.isArray(input.events) ? input.events.length : 0,
        cursor: this.cursor(),
        serverTime: Date.now(),
      };
    }

    let room = this.rooms.get(artifactId);
    if (!room) {
      room = new CollaborationRoom();
      this.rooms.set(artifactId, room);
    }

    const result = room.accept(peerId, messages, actor);
    if (input.peerSeq !== undefined) {
      peer.roomSequence = Number(input.peerSeq);
    }
    if (result.messages.length) {
      this.emit({ type: 'room', artifactId, events: result.messages, expiresAt: result.expiresAt });
    }

    return {
      accepted: result.messages.length,
      dropped: result.dropped,
      cursor: this.cursor(),
      serverTime: Date.now(),
    };
  }
  beginActivity(artifactId: string, actor: Actor, input: Omit<Activity, 'actor'>): () => void {
    if (actor.kind !== 'agent') {
      throw new StudioError('FORBIDDEN', '代理活动必须由服务端登记。');
    }

    if (input.binding) {
      this.assertTask(artifactId, actor, input.binding);
    }

    this.getTimer(artifactId);
    const activityId = randomUUID();
    const key = `${artifactId}:${actor.id}`;
    const group = this.activities.get(key) ?? new Map<string, Activity>();
    group.set(activityId, { actor: copy(actor), ...copy(input) });
    this.activities.set(key, group);
    this.publishAgent(artifactId, actor);
    let done = false;

    return () => {
      if (done || this.activities.get(key) !== group) {
        return;
      }

      done = true;
      group.delete(activityId);
      if (!group.size) {
        this.activities.delete(key);
      }

      this.publishAgent(artifactId, actor, input.status);
    };
  }
  revokeMembers(artifactId: string, memberIds: readonly string[]): void {
    const group = this.peers.get(artifactId);
    const revoked = new Set(memberIds);
    if (!group) {
      return;
    }

    for (const [peerId, peer] of group) {
      if (revoked.has(peer.actorId)) {
        if (peer.disconnect) {
          clearTimeout(peer.disconnect);
        }

        group.delete(peerId);
      }
    }

    this.publishPresence(artifactId);
  }
  forget(artifactId: string): void {
    for (const peer of this.peers.get(artifactId)?.values() ?? []) {
      if (peer.disconnect) {
        clearTimeout(peer.disconnect);
      }
    }

    this.peers.delete(artifactId);
    this.timers.forget(artifactId);
    this.rooms.delete(artifactId);
    for (const key of this.activities.keys()) {
      if (key.startsWith(`${artifactId}:`)) {
        this.activities.delete(key);
      }
    }

    for (const key of this.agentTasks.keys()) {
      if (key.startsWith(`${artifactId}:`)) {
        this.agentTasks.delete(key);
      }
    }

    for (const key of this.closedTasks.keys()) {
      if (key.startsWith(`${artifactId}:`)) {
        this.closedTasks.delete(key);
      }
    }

    for (const [key, task] of this.terminalTasks) {
      if (task.artifactId === artifactId) {
        this.terminalTasks.delete(key);
      }
    }

    this.scheduleTaskDeadline();
  }
  close(): void {
    clearInterval(this.expiry);
    for (const id of this.peers.keys()) {
      this.forget(id);
    }

    this.listeners.clear();
    this.activities.clear();
    this.agentTasks.clear();
    this.closedTasks.clear();
    this.terminalTasks.clear();
    if (this.taskDeadline) {
      clearTimeout(this.taskDeadline);
    }

    this.timers.close();
    this.events.clear();
  }
}
