import {
  BoardRoomTimerPhase,
  BoardTimerRejection,
  type BoardRoomEvent as WireRoomEvent,
  type BoardRoomParticipant as WireParticipant,
  type BoardRoomParticipantKey as WireParticipantKey,
  type BoardRoomTimer as WireRoomTimer,
  type BoardRoomViewport as WireViewport,
  type BoardTimerReceipt as WireTimerReceipt,
} from '@codexworkbench/luming-studio-ii-contracts/rooms/service';
import { readObjects } from '../whiteboard/index.js';
import type { WhiteboardObject } from '../whiteboard/index.js';
import { readAgentWorkspaces, readOnlineAgentIds } from './agent-workspaces.js';
import type {
  BoardRoomEvent,
  BoardRoomParticipant,
  BoardRoomParticipantKey,
  BoardRoomPoint,
  BoardRoomTimer,
  BoardRoomTimerReceipt,
  BoardRoomViewport,
} from './contracts.js';
import { readRoomGesture } from './room-gesture.js';

export interface BoardRoomContentChange {
  readonly revision: bigint;
  readonly changedObjectIds: readonly string[];
  readonly removedObjectIds: readonly string[];
  readonly changedObjects?: readonly WhiteboardObject[];
  readonly refreshScene: boolean;
}

const timerPhases = new Map<BoardRoomTimerPhase, BoardRoomTimer['phase']>([
  [BoardRoomTimerPhase.IDLE, 'idle'],
  [BoardRoomTimerPhase.RUNNING, 'running'],
  [BoardRoomTimerPhase.PAUSED, 'paused'],
  [BoardRoomTimerPhase.ENDED, 'ended'],
]);

type Rejected = Extract<BoardRoomTimerReceipt, { readonly kind: 'rejected' }>;

const rejectionReasons = new Map<BoardTimerRejection, Rejected['reason']>([
  [BoardTimerRejection.FORBIDDEN, 'forbidden'],
  [BoardTimerRejection.INVALID_ACTION, 'invalidAction'],
  [BoardTimerRejection.COMMAND_ID_REUSE, 'commandIdReuse'],
]);

function required<Value>(value: Value | undefined, field: string): Value {
  if (value === undefined) {
    throw new Error('房间响应缺少' + field + '。');
  }

  return value;
}

function identity(value: string, field: string): string {
  if (!value.trim()) {
    throw new Error('房间响应缺少' + field + '。');
  }

  return value;
}

export function readServerTime(value: bigint | undefined): number {
  const time = Number(required(value, '服务端时间'));
  if (!Number.isSafeInteger(time)) {
    throw new Error('房间响应的服务端时间超出范围。');
  }

  return time;
}

function readPoint(point: BoardRoomPoint | undefined): BoardRoomPoint | undefined {
  if (!point) {
    return undefined;
  }
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error('房间响应包含无效坐标。');
  }

  return { x: point.x, y: point.y };
}

function readViewport(viewport: WireViewport | undefined): BoardRoomViewport | undefined {
  if (!viewport) {
    return undefined;
  }

  const { centerX, centerY, zoom, width, height } = viewport;
  const finite = [centerX, centerY, zoom, width, height].every(Number.isFinite);
  if (!finite || Math.min(width, height, zoom) <= 0) {
    throw new Error('房间响应包含无效视口。');
  }

  return { centerX, centerY, zoom, width, height };
}

function readKey(key: WireParticipantKey | undefined): BoardRoomParticipantKey {
  const participant = required(key, '参与者标识');

  return {
    actorId: identity(participant.actorId, '参与者身份'),
    viewId: identity(participant.viewId, '参与者视图'),
  };
}

function readParticipant(participant: WireParticipant): BoardRoomParticipant {
  const { editingObjectIds } = participant;
  return {
    ...readKey(participant.key),
    displayName: participant.displayName,
    role: participant.role,
    sequence: required(participant.sequence, '参与者序号'),
    expiresAtMillis: readServerTime(participant.expiresAtUnixMs),
    activityAtMillis:
      participant.activityAtUnixMs === undefined
        ? undefined
        : readServerTime(participant.activityAtUnixMs),
    cursor: readPoint(participant.cursor),
    viewport: readViewport(participant.viewport),
    following: participant.following,
    gesture: readRoomGesture(participant.gesture),
    gestureExpiresAtMillis:
      participant.gestureExpiresAtUnixMs === undefined
        ? undefined
        : readServerTime(participant.gestureExpiresAtUnixMs),
    ...(editingObjectIds.length ? { editingObjectIds } : {}),
  };
}

function readTimer(timer: WireRoomTimer | undefined): BoardRoomTimer {
  const value = required(timer, '共享计时');
  const phase = required(timerPhases.get(value.phase), '计时阶段');
  const deadlineUnixMs =
    value.deadlineUnixMs === undefined ? undefined : readServerTime(value.deadlineUnixMs);

  if (phase === 'running' && deadlineUnixMs === undefined) {
    throw new Error('房间响应缺少计时截止时间。');
  }

  return {
    version: required(value.version, '计时版本'),
    phase,
    deadlineUnixMs,
    durationMs: value.durationMs,
    remainingMs: value.remainingMs,
  };
}

export function readRoomEvent(event: WireRoomEvent | undefined, boardId: string): BoardRoomEvent {
  const {
    boardId: sourceId,
    roomInstanceId,
    sequence,
    serverTimeUnixMs,
    payload,
  } = required(event, '房间事件');

  if (sourceId !== boardId) {
    throw new Error('房间事件属于另一块白板。');
  }

  const header = {
    boardId,
    instanceId: identity(roomInstanceId, '房间实例'),
    sequence: required(sequence, '事件序号'),
    serverTimeUnixMs: readServerTime(serverTimeUnixMs),
  };

  switch (payload.case) {
    case 'snapshot': {
      const {
        actorId,
        canEdit,
        boardRevision,
        participants,
        timer,
        agentWorkspaces,
        onlineAgents,
        canReleaseAgentActivity,
        feedbackVersion,
        suggestionsVersion,
      } = payload.value;

      return {
        ...header,
        kind: 'snapshot',
        actorId: identity(actorId, '当前身份'),
        canEdit,
        revision: required(boardRevision, '白板版次'),
        participants: participants.map(readParticipant),
        timer: readTimer(timer),
        agentWorkspaces: readAgentWorkspaces(agentWorkspaces),
        onlineAgentIds: readOnlineAgentIds(onlineAgents?.agentIds),
        readingAgentIds: readOnlineAgentIds(onlineAgents?.readingAgentIds),
        canReleaseAgentActivity,
        feedbackVersion,
        suggestionsVersion,
      };
    }
    case 'participants':
      return {
        ...header,
        kind: 'participants',
        upserts: payload.value.upserts.map(readParticipant),
        removals: payload.value.removals.map(readKey),
      };
    case 'timer':
      return { ...header, kind: 'timer', timer: readTimer(payload.value) };
    case 'agentWorkspaces':
      return {
        ...header,
        kind: 'agentWorkspaces',
        workspaces: readAgentWorkspaces(payload.value.workspaces),
        onlineAgentIds: readOnlineAgentIds(payload.value.onlineAgents?.agentIds),
        readingAgentIds: readOnlineAgentIds(payload.value.onlineAgents?.readingAgentIds),
      };
    case 'contentChanged':
      return {
        ...header,
        kind: 'contentChanged',
        change: {
          revision: required(payload.value.boardRevision, '白板版次'),
          changedObjectIds: payload.value.changedObjectIds,
          removedObjectIds: payload.value.removedObjectIds,
          changedObjects: readObjects(payload.value.changedObjects),
          refreshScene: payload.value.refreshScene,
        },
      };
    case 'accessLost':
      return { ...header, kind: 'accessLost' };
    case 'feedbackChanged':
    case 'suggestionsChanged':
      return {
        ...header,
        kind: payload.case,
        version: required(payload.value.version, '讨论版本'),
      };
    case undefined:
      throw new Error('房间响应缺少事件内容。');
  }
}

export function readTimerReceipt(
  receipt: WireTimerReceipt | undefined,
  boardId: string,
  commandId: string,
): BoardRoomTimerReceipt | undefined {
  if (!receipt) {
    return undefined;
  }
  if (receipt.boardId !== boardId || receipt.commandId !== commandId) {
    throw new Error('房间响应的计时回执与原命令不一致。');
  }

  const { case: kind, value } = receipt.outcome;
  switch (kind) {
    case 'applied':
    case 'conflict':
      return { commandId, kind, timer: readTimer(value.timer) };
    case 'rejected':
      return {
        commandId,
        kind,
        reason: required(rejectionReasons.get(value.reason), '计时失败原因'),
      };
    case undefined:
      throw new Error('房间响应缺少计时结果。');
  }
}
