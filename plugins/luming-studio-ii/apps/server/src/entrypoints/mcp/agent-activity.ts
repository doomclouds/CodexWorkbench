import { create, fromBinary, toBinary, type MessageInitShape } from '@bufbuild/protobuf';
import {
  AgentActivityEndReason,
  AgentActivityPhase,
  AgentActivityRejection,
  BoardRoomService,
  type ChangeAgentActivityResponse,
} from '@codexworkbench/luming-studio-ii-contracts/rooms/service';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeError, invalidArgument, tooLarge } from './errors.js';

const rpc = BoardRoomService.method.changeAgentActivity;
const maximumBytes = 32 * 1024;
const cleanupMillis = 2_000;
const coordinateLimit = 10_000_000;
const boardId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const identifier = z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/u);
const coordinates = z.number().min(-coordinateLimit).max(coordinateLimit);
const length = z.number().positive().max(coordinateLimit);
const objectIds = z.array(identifier).max(32);
const bounds = z.strictObject({ x: coordinates, y: coordinates, width: length, height: length });
const scope = z.union([
  z.strictObject({ objectIds: objectIds.min(1) }),
  z.strictObject({ bounds }),
]);
const phase = z.enum(['preparing', 'writing', 'verifying']);
const task = { boardId, taskId: identifier };
const begin = {
  scope,
  label: z.string().trim().min(1).max(80).optional(),
  previousGeneration: identifier.optional(),
};
const update = { generation: identifier, phase, activeObjectIds: objectIds };
const operations = z.discriminatedUnion('action', [
  z.strictObject({ ...task, action: z.literal('begin'), ...begin }),
  z.strictObject({ ...task, action: z.literal('update'), ...update }),
  z.strictObject({ ...task, action: z.literal('end'), generation: identifier }),
  z.strictObject({ ...task, action: z.literal('status') }),
]);
const inputSchema = z.strictObject({
  boardId: boardId.describe('目标白板 ID'),
  taskId: identifier.describe('当前 Agent 内稳定的任务 ID'),
  action: z.enum(['begin', 'update', 'end', 'status']),
  scope: scope.optional().describe('begin 必填。对象 ID 与世界坐标矩形二选一'),
  label: begin.label.describe('begin 的任务名称'),
  previousGeneration: begin.previousGeneration.describe('同一任务重开时携带上一代'),
  generation: identifier.optional().describe('仅 update 和 end 使用，且必须携带当前工作区代次'),
  phase: phase.optional().describe('update 必填。准备、处理或验证阶段'),
  activeObjectIds: objectIds.optional().describe('update 必填。当前工作区内正在处理的对象，可为空'),
});

type ActivityOperation = z.infer<typeof operations>;
type WireAction = MessageInitShape<typeof rpc.input>['action'];
type ActivityResult = ChangeAgentActivityResponse['result'];
type DispatchAgentActivity = (body: Uint8Array, signal: AbortSignal) => Promise<Response>;

interface ActivityOptions {
  readonly allocateId: () => string;
  readonly agentId?: string;
  readonly dispatch: DispatchAgentActivity;
  readonly reportError: (error: unknown) => void;
}

interface ActivityIdentity {
  readonly boardId: string;
  readonly taskId: string;
}

const wirePhases = {
  preparing: AgentActivityPhase.PREPARING,
  writing: AgentActivityPhase.WRITING,
  verifying: AgentActivityPhase.VERIFYING,
} as const;
const phases = new Map<AgentActivityPhase, string>([
  [AgentActivityPhase.PREPARING, 'preparing'],
  [AgentActivityPhase.WRITING, 'writing'],
  [AgentActivityPhase.VERIFYING, 'verifying'],
]);
const endedReasons = new Map<AgentActivityEndReason, string>([
  [AgentActivityEndReason.COMPLETED, 'completed'],
  [AgentActivityEndReason.RELEASED, 'released'],
  [AgentActivityEndReason.EXPIRED, 'expired'],
]);
const rejections = new Map<AgentActivityRejection, readonly [string, string]>([
  [AgentActivityRejection.INVALID, ['INVALID_ARGUMENT', '工作区范围或当前焦点无效。']],
  [AgentActivityRejection.OVERLAP, ['WORKSPACE_OVERLAP', '范围与另一个 Agent 的活跃工作区重叠。']],
  [AgentActivityRejection.CAPACITY, ['WORKSPACE_CAPACITY', '当前白板的 Agent 工作区已满。']],
  [AgentActivityRejection.NOT_FOUND, ['WORKSPACE_NOT_FOUND', '没有找到当前任务的工作区。']],
  [
    AgentActivityRejection.GENERATION_CHANGED,
    ['GENERATION_CHANGED', '工作区代次已变化，请先查询状态。'],
  ],
  [
    AgentActivityRejection.WORKSPACE_RELEASED,
    ['WORKSPACE_RELEASED', '所有者已结束此任务的工作区。'],
  ],
] as const);

function toWireAction(operation: ActivityOperation): WireAction {
  switch (operation.action) {
    case 'begin': {
      const { scope: scopeValue, label, previousGeneration } = operation;
      const target =
        'objectIds' in scopeValue
          ? { case: 'objects' as const, value: scopeValue }
          : { case: 'area' as const, value: scopeValue.bounds };

      return {
        case: 'begin',
        value: { scope: { target }, label: label ?? '白板工作区', previousGeneration },
      };
    }
    case 'update':
      return {
        case: 'update',
        value: {
          generation: operation.generation,
          phase: wirePhases[operation.phase],
          activeObjectIds: operation.activeObjectIds,
        },
      };
    case 'end':
      return { case: 'end', value: { generation: operation.generation } };
    case 'status':
      return { case: 'status', value: {} };
  }
}

function activityError(code: string, message: string) {
  return { content: [], isError: true, structuredContent: { ok: false, error: { code, message } } };
}

function activitySuccess(data: ActivityIdentity & Readonly<Record<string, unknown>>) {
  return { content: [], structuredContent: { ok: true, data } };
}

function httpFailure(status: number) {
  if (status === 401 || status === 403 || status === 404) {
    return activityError('FORBIDDEN', '当前 Agent 没有访问此白板工作区的权限。');
  }
  if (status === 413) {
    return activityError('TOO_LARGE', '工作区请求超过体积限制。');
  }
  if (status >= 500) {
    return activityError('UNAVAILABLE', '白板工作区服务暂时不可用。');
  }

  return activityError('INVALID_ARGUMENT', '工作区请求无效。');
}

async function readActivityReply(response: Response): Promise<ActivityResult> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new BridgeError('UNAVAILABLE', '白板工作区服务没有返回结果。');
  }

  const bytes = new Uint8Array(maximumBytes);
  let size = 0;
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      if (size + chunk.value.byteLength > maximumBytes) {
        await reader.cancel();
        throw tooLarge('工作区结果超过体积限制。');
      }

      bytes.set(chunk.value, size);
      size += chunk.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  return fromBinary(rpc.output, bytes.subarray(0, size), { readUnknownFields: false }).result;
}

export function registerAgentActivity(server: McpServer, options: ActivityOptions) {
  const { allocateId, dispatch, reportError } = options;
  const agentId = options.agentId ?? 'agent-' + allocateId();
  const lifetime = new AbortController();
  let joined = false;

  function activeResult(
    identity: ActivityIdentity,
    result: Extract<ActivityResult, { case: 'workspace' }>,
  ) {
    const { value } = result;
    const currentPhase = phases.get(value.phase);
    const expiresAtUnixMs = Number(value.expiresAtUnixMs);
    const matches = value.agentId === agentId && value.taskId === identity.taskId;
    const validTime = Number.isSafeInteger(expiresAtUnixMs) && expiresAtUnixMs > 0;
    const valid = identifier.safeParse(value.generation).success && validTime;
    if (!matches || !currentPhase || !valid) {
      throw new BridgeError('UNAVAILABLE', '白板工作区结果无法核对。');
    }

    const activity = { ...identity, generation: value.generation, expiresAtUnixMs };
    return activitySuccess({ ...activity, status: 'active', phase: currentPhase });
  }

  function presentResult(identity: ActivityIdentity, result: ActivityResult) {
    if (result.case === 'workspace') {
      return activeResult(identity, result);
    }

    if (result.case === 'ended') {
      const { generation } = result.value;
      const reason = endedReasons.get(result.value.reason);
      if (reason && identifier.safeParse(generation).success) {
        return activitySuccess({ ...identity, generation, status: 'ended', reason });
      }
    }
    if (result.case === 'rejected') {
      const rejection = rejections.get(result.value);
      if (rejection) {
        const [code, message] = rejection;

        return activityError(code, message);
      }
    }

    throw new BridgeError('UNAVAILABLE', '白板工作区服务没有返回有效状态。');
  }

  async function send(
    identity: { readonly boardId: string; readonly taskId?: string } | undefined,
    action: WireAction,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const bytes = toBinary(rpc.input, create(rpc.input, { ...identity, agentId, action }));

    if (bytes.byteLength > maximumBytes) {
      throw tooLarge('工作区请求超过体积限制。');
    }

    return dispatch(bytes, signal);
  }

  async function perform(operation: ActivityOperation, signal: AbortSignal) {
    const identity = { boardId: operation.boardId, taskId: operation.taskId };
    if (operation.action === 'begin') {
      joined = true;
    }
    const response = await send(identity, toWireAction(operation), signal);
    if (!response.ok) {
      await response.body?.cancel();

      return httpFailure(response.status);
    }

    const result = await readActivityReply(response);
    signal.throwIfAborted();

    return presentResult(identity, result);
  }

  server.registerTool(
    'artifact_activity',
    {
      title: '登记 Agent 白板工作区',
      description:
        '登记、更新、结束或查询当前 Agent 在指定白板的工作范围。begin 需要对象 ID 或世界坐标矩形。update 和 end 需要当前代次。status 只传 action、boardId 和 taskId。登记仅用于协作跟随。',
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { visibility: ['model'] } },
    },
    async (input, { signal }) => {
      try {
        const operation = operations.safeParse(input);
        if (!operation.success) {
          throw invalidArgument('请按所选动作填写工作区范围、阶段与代次。');
        }

        return await perform(operation.data, AbortSignal.any([signal, lifetime.signal]));
      } catch (error) {
        if (error instanceof BridgeError) {
          return activityError(error.code, error.message);
        }

        reportError(error);

        return activityError('UNAVAILABLE', '白板工作区服务暂时不可用。');
      }
    },
  );

  async function close() {
    lifetime.abort();
    if (!joined) {
      return;
    }

    joined = false;
    try {
      const response = await send(
        undefined,
        { case: 'disconnect', value: {} },
        AbortSignal.timeout(cleanupMillis),
      );
      await response.body?.cancel();
      if (!response.ok) {
        throw new Error('未能立即断开 Agent 房间会话。');
      }
    } catch (error) {
      reportError(error);
    }
  }

  async function publishRead(boardId: string, activityId: string, reading: boolean) {
    try {
      const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(cleanupMillis)]);
      const response = await send(
        { boardId },
        { case: 'readPresence', value: { activityId, reading } },
        signal,
      );
      await response.body?.cancel();

      return response.ok;
    } catch (error) {
      if (!lifetime.signal.aborted) {
        reportError(error);
      }

      return false;
    }
  }

  function startRead(boardId: string) {
    if (lifetime.signal.aborted) {
      return;
    }

    joined = true;
    const id = allocateId();
    const started = publishRead(boardId, id, true);

    return () => {
      started
        .then(async (accepted) => {
          if (accepted) {
            await publishRead(boardId, id, false);
          }
        })
        .catch(reportError);
    };
  }

  return { close, startRead };
}
