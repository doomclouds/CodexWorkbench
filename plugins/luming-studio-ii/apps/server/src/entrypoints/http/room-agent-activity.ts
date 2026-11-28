import type { MessageInitShape } from '@bufbuild/protobuf';
import {
  AgentActivityEndReason as WireEndReason,
  AgentActivityPhase as WirePhase,
  AgentActivityRejection as WireRejection,
  BoardRoomService,
  type AgentActivityScope as WireScope,
  type ChangeAgentActivityRequest,
  type ChangeAgentActivityResponseSchema,
  type RoomAgentWorkspaceSchema,
} from '@codexworkbench/luming-studio-ii-contracts/rooms/service';
import {
  RoomAccessError,
  RoomInputError,
  type AgentActivityEndReason,
  type AgentActivityOperation,
  type AgentActivityPhase,
  type AgentActivityResult,
  type AgentActivityScope,
  type AgentWorkspace,
  type RoomsApplication,
} from '../../modules/rooms/application/index.js';
import { requireId } from './request.js';
import { unaryRoute } from './unary-route.js';

const method = BoardRoomService.method.changeAgentActivity;
export const agentActivityPath = '/' + BoardRoomService.typeName + '/' + method.name;
export const agentActivityRequestLimit = 16 * 1024;
const agentIdentifier = /^agent-[\w.:-]{1,122}$/u;

const phases = {
  preparing: WirePhase.PREPARING,
  writing: WirePhase.WRITING,
  verifying: WirePhase.VERIFYING,
} satisfies Record<AgentActivityPhase, WirePhase>;
const phaseByWire = new Map<WirePhase, AgentActivityPhase>([
  [WirePhase.PREPARING, 'preparing'],
  [WirePhase.WRITING, 'writing'],
  [WirePhase.VERIFYING, 'verifying'],
]);
const endReasons = {
  completed: WireEndReason.COMPLETED,
  released: WireEndReason.RELEASED,
  expired: WireEndReason.EXPIRED,
} satisfies Record<AgentActivityEndReason, WireEndReason>;

type RejectedActivity = Extract<AgentActivityResult, { kind: 'rejected' }>;

const rejections = {
  invalid: WireRejection.INVALID,
  overlap: WireRejection.OVERLAP,
  capacity: WireRejection.CAPACITY,
  notFound: WireRejection.NOT_FOUND,
  generationChanged: WireRejection.GENERATION_CHANGED,
  workspaceReleased: WireRejection.WORKSPACE_RELEASED,
} satisfies Record<RejectedActivity['reason'], WireRejection>;

export function agentWorkspaceWire(
  workspace: AgentWorkspace,
): MessageInitShape<typeof RoomAgentWorkspaceSchema> {
  const {
    scope,
    phase,
    areas,
    expiresAtUnixMs,
    lastProgressAtUnixMs,
    endedAtUnixMs,
    endReason,
    ...key
  } = workspace;
  const target =
    scope.kind === 'area'
      ? { case: 'area' as const, value: scope.bounds }
      : { case: 'objects' as const, value: { objectIds: [...scope.objectIds] } };

  return {
    ...key,
    scope: { target },
    phase: phases[phase],
    areas: [...areas],
    expiresAtUnixMs: BigInt(expiresAtUnixMs),
    lastProgressAtUnixMs:
      lastProgressAtUnixMs === undefined ? undefined : BigInt(lastProgressAtUnixMs),
    endedAtUnixMs: endedAtUnixMs === undefined ? undefined : BigInt(endedAtUnixMs),
    endReason: endReason === undefined ? undefined : endReasons[endReason],
  };
}

function resultWire(
  result: AgentActivityResult,
): MessageInitShape<typeof ChangeAgentActivityResponseSchema> {
  switch (result.kind) {
    case 'active':
      return { result: { case: 'workspace', value: agentWorkspaceWire(result.workspace) } };
    case 'ended':
      return {
        result: {
          case: 'ended',
          value: { generation: result.generation, reason: endReasons[result.reason] },
        },
      };
    case 'rejected':
      return { result: { case: 'rejected', value: rejections[result.reason] } };
  }
}

type WireAction = ChangeAgentActivityRequest['action'];

function readScope(scope: WireScope | undefined): AgentActivityScope {
  const { target } = scope ?? {};
  if (target?.case === 'objects') {
    return { kind: 'objects', objectIds: target.value.objectIds };
  }

  if (target?.case === 'area') {
    const { x, y, width, height } = target.value;

    return { kind: 'area', bounds: { x, y, width, height } };
  }

  throw new RoomInputError('An Agent workspace scope is required.');
}

function readOperation(action: WireAction, taskId: string): AgentActivityOperation {
  switch (action.case) {
    case 'begin':
      return {
        kind: 'begin',
        taskId,
        label: action.value.label,
        scope: readScope(action.value.scope),
        previousGeneration: action.value.previousGeneration || undefined,
      };
    case 'update': {
      const phase = phaseByWire.get(action.value.phase);
      if (!phase) {
        throw new RoomInputError('An Agent workspace phase is required.');
      }

      return {
        kind: 'update',
        taskId,
        phase,
        generation: action.value.generation,
        activeObjectIds: action.value.activeObjectIds,
      };
    }
    case 'end':
      return { kind: 'end', taskId, generation: action.value.generation };
    case 'status':
      return { kind: 'status', taskId };
    case 'release':
    case 'disconnect':
    case 'readPresence':
    case undefined:
      throw new RoomInputError('An Agent workspace action is required.');
  }
}

export function agentActivityRoute(application: RoomsApplication) {
  return unaryRoute(method, (actor, request) => {
    const { action } = request;
    const { agentId, taskId } = request;
    const ownerId = actor.id;
    if (!agentIdentifier.test(agentId) || ownerId === agentId) {
      throw new RoomInputError('An independent Agent work session is required.');
    }

    if (action.case === 'disconnect') {
      if (actor.kind !== 'agent' || actor.guestScope) {
        throw new RoomAccessError('Closing an Agent session requires the Agent entrypoint.');
      }

      application.disconnectAgent(ownerId, agentId);

      return { result: { case: 'disconnected' as const, value: {} } };
    }

    const boardId = requireId(request.boardId);
    if (action.case === 'release') {
      if (actor.kind === 'agent' || actor.guestScope) {
        throw new RoomAccessError('Only the board owner can release an Agent workspace.');
      }

      return resultWire(
        application.releaseAgentActivity({
          boardId,
          ownerId,
          agentId,
          taskId,
          generation: action.value.generation,
        }),
      );
    }
    if (actor.kind !== 'agent') {
      throw new RoomAccessError('Agent workspace changes require the Agent entrypoint.');
    }

    if (action.case === 'readPresence') {
      const { activityId, reading } = action.value;
      application.setAgentReadPresence({ boardId, ownerId, agentId }, activityId, reading);

      return { result: { case: 'readPresence' as const, value: action.value } };
    }

    return resultWire(
      application.changeAgentActivity({ boardId, ownerId, agentId }, readOperation(action, taskId)),
    );
  });
}
