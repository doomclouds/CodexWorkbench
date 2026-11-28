import type {
  BoardRoomEvent,
  BoardRoomObserver,
  BoardRoomParticipant,
  BoardRoomParticipantKey,
  BoardRoomSession,
  BoardRoomSessionOptions,
  BoardRoomState,
  BoardRoomTimer,
  BoardRoomTimerReply,
} from './contracts.js';
import type { BoardRoomAgentWorkspaceTarget } from './agent-workspaces.js';
import { createPresencePublisher } from './presence-publisher.js';
import { createRoomClock } from './room-clock.js';
import type { BoardRoomContentChange } from './room-message.js';

interface RoomStream {
  readonly controller: AbortController;
  instanceId?: string;
  sequence?: bigint;
}

interface RoomConnection {
  readonly observer: BoardRoomObserver;
  stream?: RoomStream;
  retry?: () => void;
  retryDelay: number;
}

type ParticipantEvent = Extract<BoardRoomEvent, { readonly kind: 'participants' }>;
type SnapshotEvent = Extract<BoardRoomEvent, { readonly kind: 'snapshot' }>;
type TimerRequest = (signal: AbortSignal) => Promise<BoardRoomTimerReply>;

const initialRetryMs = 500;
const maxRetryMs = 5000;

function initialRoom(viewId: string): BoardRoomState {
  return { status: 'connecting', viewId, canEdit: false, participants: [] };
}

function participantKey({ actorId, viewId }: BoardRoomParticipantKey): string {
  return JSON.stringify([actorId, viewId]);
}

function mergeParticipants(
  participants: readonly BoardRoomParticipant[],
  { removals, upserts }: ParticipantEvent,
): readonly BoardRoomParticipant[] {
  const map = new Map(
    participants.map((participant) => [participantKey(participant), participant]),
  );

  for (const removed of removals) {
    map.delete(participantKey(removed));
  }
  for (const updated of upserts) {
    const key = participantKey(updated);
    const current = map.get(key);
    if (!current || updated.sequence > current.sequence) {
      map.set(key, updated);
    }
  }

  return [...map.values()];
}

function roomNotice(error: unknown): string | undefined {
  return error instanceof Error && error.message ? error.message : undefined;
}

function discussionUpdateKey(instanceId: string, version: bigint | undefined) {
  return version === undefined ? undefined : instanceId + ':' + version;
}

export function createBoardRoomSession({
  boardId,
  viewId,
  service,
  clock,
  observation,
}: BoardRoomSessionOptions): BoardRoomSession {
  let state = initialRoom(viewId);
  let active: RoomConnection | undefined;
  const listeners = new Set<() => void>();
  const roomClock = createRoomClock(clock);
  const presence = createPresencePublisher(clock, {
    update: (sequence, sample, signal) =>
      service.updatePresence(boardId, viewId, sequence, sample, signal),
    leave: (sequence) => service.leavePresence(boardId, viewId, sequence),
    onUnavailable: handlePresenceUnavailable,
    onLeaveFailure(error) {
      if (!active) {
        const detail = roomNotice(error);
        setState({
          ...state,
          notice: '离开的通知未送达。在线记录将自动到期。' + (detail ? ' ' + detail : ''),
        });
      }
    },
  });

  function setState(next: BoardRoomState) {
    state = next;
    for (const listener of listeners) {
      listener();
    }
  }

  function stopStream(connection: RoomConnection) {
    connection.stream?.controller.abort();
    connection.stream = undefined;
    presence.pause();
  }

  function dispose(connection: RoomConnection) {
    active = undefined;
    connection.retry?.();
    stopStream(connection);
    presence.leave();
    roomClock.reset();
    setState(initialRoom(viewId));
  }

  function loseAccess(connection: RoomConnection) {
    connection.retry?.();
    connection.retry = undefined;
    stopStream(connection);
    presence.clear();
    roomClock.reset();
    setState({ ...initialRoom(viewId), status: 'accessLost' });
    connection.observer.onAccessLost?.();
  }

  function reconnect(connection: RoomConnection, error?: unknown) {
    stopStream(connection);
    setState({ ...state, status: 'reconnecting', canEdit: false, notice: roomNotice(error) });
    connection.retry?.();
    const delay = connection.retryDelay;
    connection.retryDelay = Math.min(delay * 2, maxRetryMs);
    connection.retry = clock.schedule(delay, () => connect(connection));
  }

  function handlePresenceUnavailable(error: unknown) {
    const connection = active;
    if (connection?.stream) {
      reconnect(connection, error);
    }
  }

  function applyTimer(timer: BoardRoomTimer) {
    if (!state.timer || timer.version >= state.timer.version) {
      setState({ ...state, timer });
    }
  }

  function applyContent(connection: RoomConnection, change: BoardRoomContentChange) {
    if (state.boardRevision !== undefined && change.revision <= state.boardRevision) {
      return;
    }

    setState({ ...state, boardRevision: change.revision });
    connection.observer.onContentChanged?.(change);
  }

  function acceptSnapshot(connection: RoomConnection, stream: RoomStream, event: SnapshotEvent) {
    const priorRevision = state.boardRevision;
    stream.instanceId = event.instanceId;
    stream.sequence = event.sequence;
    connection.retryDelay = initialRetryMs;
    roomClock.sample(event.serverTimeUnixMs);
    setState({
      viewId,
      status: 'online',
      actorId: event.actorId,
      boardRevision: event.revision,
      canEdit: event.canEdit,
      participants: event.participants,
      timer: event.timer,
      agentWorkspaces: event.agentWorkspaces,
      canReleaseAgentActivity: event.canReleaseAgentActivity,
      feedbackUpdateKey: discussionUpdateKey(event.instanceId, event.feedbackVersion),
      suggestionsUpdateKey: discussionUpdateKey(event.instanceId, event.suggestionsVersion),
    });

    if (priorRevision !== event.revision) {
      connection.observer.onContentChanged?.({
        revision: event.revision,
        changedObjectIds: [],
        removedObjectIds: [],
        refreshScene: true,
      });
    }

    presence.resume(event.canEdit);
  }

  function acceptObservedSnapshot(
    connection: RoomConnection,
    stream: RoomStream,
    event: SnapshotEvent,
  ) {
    if (stream.instanceId === event.instanceId) {
      if (stream.sequence !== undefined && event.sequence < stream.sequence) {
        return;
      }

      const timer = state.timer;
      const next = timer && timer.version > event.timer.version ? { ...event, timer } : event;
      acceptSnapshot(connection, stream, next);
      return;
    }

    roomClock.reset();
    acceptSnapshot(connection, stream, event);
  }

  function acceptChange(connection: RoomConnection, event: Exclude<BoardRoomEvent, SnapshotEvent>) {
    roomClock.sample(event.serverTimeUnixMs);
    switch (event.kind) {
      case 'participants':
        setState({ ...state, participants: mergeParticipants(state.participants, event) });
        break;
      case 'timer':
        applyTimer(event.timer);
        break;
      case 'contentChanged':
        applyContent(connection, event.change);
        break;
      case 'feedbackChanged':
        setState({
          ...state,
          feedbackUpdateKey: discussionUpdateKey(event.instanceId, event.version),
        });
        break;
      case 'suggestionsChanged':
        setState({
          ...state,
          suggestionsUpdateKey: discussionUpdateKey(event.instanceId, event.version),
        });
        break;
      case 'agentWorkspaces':
        setState({ ...state, agentWorkspaces: event.workspaces });
        break;
      case 'accessLost':
        loseAccess(connection);
        break;
    }
  }

  function receiveEvent(connection: RoomConnection, stream: RoomStream, event: BoardRoomEvent) {
    if (active !== connection || connection.stream !== stream) {
      return;
    }

    if (event.boardId !== boardId) {
      reconnect(connection, new Error('房间事件属于另一块白板。'));
      return;
    }
    if (event.kind === 'accessLost') {
      loseAccess(connection);
      return;
    }
    if (observation === 'snapshot' && event.kind === 'snapshot') {
      acceptObservedSnapshot(connection, stream, event);
      return;
    }
    if (stream.sequence === undefined && event.kind === 'snapshot') {
      acceptSnapshot(connection, stream, event);
      return;
    }
    if (stream.instanceId !== event.instanceId || stream.sequence === undefined) {
      reconnect(connection, new Error('房间实例发生变化，正在重新获取在线状态。'));
      return;
    }
    if (event.sequence <= stream.sequence) {
      return;
    }

    if (event.kind === 'snapshot' || event.sequence !== stream.sequence + 1n) {
      reconnect(connection, new Error('房间事件未连续到达，正在重新同步。'));
      return;
    }

    stream.sequence = event.sequence;
    acceptChange(connection, event);
  }

  function connect(connection: RoomConnection) {
    if (active !== connection) {
      return;
    }

    connection.retry = undefined;
    const stream: RoomStream = { controller: new AbortController() };
    connection.stream = stream;
    try {
      service.subscribe(
        boardId,
        viewId,
        {
          onEvent: (event) => receiveEvent(connection, stream, event),
          onDisconnect(reason, error) {
            if (active !== connection || connection.stream !== stream) {
              return;
            }

            if (reason === 'accessLost') {
              loseAccess(connection);
            } else {
              reconnect(connection, error);
            }
          },
        },
        stream.controller.signal,
      );
    } catch (error) {
      reconnect(connection, error);
    }
  }

  function open(observer: BoardRoomObserver = {}) {
    if (active) {
      dispose(active);
    }

    const connection = { observer, retryDelay: initialRetryMs };
    active = connection;
    connect(connection);

    return () => {
      if (active === connection) {
        dispose(connection);
      }
    };
  }

  async function timerRequest(request: TimerRequest, signal?: AbortSignal) {
    const stream = active?.stream;
    if (!stream || state.status !== 'online') {
      throw new Error('房间尚未连接，当前无法提交或核对计时命令。');
    }

    const scope = stream.controller.signal;
    const requestSignal = signal ? AbortSignal.any([scope, signal]) : scope;
    const startedAt = clock.now();
    const instanceId = stream.instanceId;
    requestSignal.throwIfAborted();
    const result = await request(requestSignal);
    requestSignal.throwIfAborted();
    if (stream.instanceId !== instanceId) {
      throw new Error('房间实例已更新，请核对原计时命令。');
    }

    roomClock.sample(result.serverTimeUnixMs, startedAt);
    const { receipt } = result;
    if (receipt && receipt.kind !== 'rejected') {
      applyTimer(receipt.timer);
    }

    return receipt;
  }

  async function releaseAgentWorkspace(target: BoardRoomAgentWorkspaceTarget) {
    const stream = active?.stream;
    const canRelease = state.status === 'online' && state.canReleaseAgentActivity;
    if (!stream || !canRelease || typeof service.releaseAgentWorkspace !== 'function') {
      throw new Error('当前会话无法结束 Agent 工作区。');
    }

    const { signal } = stream.controller;
    await service.releaseAgentWorkspace(boardId, target, signal);
    signal.throwIfAborted();
  }

  return {
    open,
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    publishPresence(sample) {
      const mayEdit = state.status === 'online' && state.canEdit;
      presence.publish(
        mayEdit ? sample : { ...sample, editingObjectIds: undefined, gesture: undefined },
      );
    },
    async changeTimer(command, signal) {
      if (!state.canEdit) {
        throw new Error('当前房间会话不可编辑共享计时。');
      }

      const receipt = await timerRequest(
        (scope) => service.changeTimer(boardId, command, scope),
        signal,
      );

      if (!receipt) {
        throw new Error('房间服务未确认计时命令结果。');
      }

      return receipt;
    },
    getTimerReceipt: (commandId, signal) =>
      timerRequest((scope) => service.getTimerReceipt(boardId, commandId, scope), signal),
    now: roomClock.now,
    releaseAgentWorkspace:
      typeof service.releaseAgentWorkspace === 'function' ? releaseAgentWorkspace : undefined,
    schedule: clock.schedule,
  };
}
