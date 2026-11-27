import {
  AgentActivityEndReason,
  AgentActivityPhase,
  AgentActivityRejection,
  type ChangeAgentActivityResponse,
  type RoomAgentWorkspace as WireWorkspace,
  type RoomAgentWorkspaceArea as WireArea,
} from '@codexworkbench/luming-studio-ii-contracts/rooms/service';

export interface BoardRoomAgentWorkspaceTarget {
  readonly agentId: string;
  readonly taskId: string;
  readonly generation: string;
}

interface WorkspaceBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface WorkspaceArea {
  readonly id: string;
  readonly bounds: WorkspaceBounds;
  readonly active: boolean;
}

export interface BoardRoomAgentWorkspace extends BoardRoomAgentWorkspaceTarget {
  readonly label: string;
  readonly phase: 'preparing' | 'writing' | 'verifying';
  readonly areas: readonly WorkspaceArea[];
  readonly expiresAtUnixMs: number;
}

const phases = new Map<AgentActivityPhase, BoardRoomAgentWorkspace['phase']>([
  [AgentActivityPhase.PREPARING, 'preparing'],
  [AgentActivityPhase.WRITING, 'writing'],
  [AgentActivityPhase.VERIFYING, 'verifying'],
]);
const maxWorkspaces = 12;
const maxWorkspaceAreas = 25;
const keyPattern = /^[\w.:-]{1,128}$/u;

function readArea({ id, bounds, active }: WireArea): WorkspaceArea {
  if (!id || !bounds) {
    throw new Error('工作区缺少区域标识和范围。');
  }

  const { x, y, width, height } = bounds;
  if (![x, y, width, height].every(Number.isFinite) || Math.min(width, height) <= 0) {
    throw new Error('工作区包含无效范围。');
  }

  return { id, bounds: { x, y, width, height }, active };
}

function readWorkspace(source: WireWorkspace): BoardRoomAgentWorkspace {
  const { agentId, taskId, generation, label, areas } = source;
  const phase = phases.get(source.phase);
  const expiresAtUnixMs = Number(source.expiresAtUnixMs);
  if (!phase || !Number.isSafeInteger(expiresAtUnixMs) || areas.length > maxWorkspaceAreas) {
    throw new Error('工作区包含无效的阶段、租约或范围数量。');
  }
  if (
    !agentId.startsWith('agent-') ||
    ![agentId, taskId, generation].every((key) => keyPattern.test(key))
  ) {
    throw new Error('工作区缺少有效的 Agent 标识。');
  }

  return { agentId, taskId, generation, label, phase, expiresAtUnixMs, areas: areas.map(readArea) };
}

export function readAgentWorkspaces(source: readonly WireWorkspace[]) {
  if (source.length > maxWorkspaces) {
    throw new Error('房间工作区数量超出范围。');
  }

  return source.map(readWorkspace);
}

export function checkWorkspaceRelease(response: ChangeAgentActivityResponse, generation: string) {
  const { result } = response;
  if (result.case === 'ended' && result.value.generation === generation) {
    if (result.value.reason !== AgentActivityEndReason.UNSPECIFIED) {
      return;
    }
  }
  if (result.case === 'rejected' && result.value === AgentActivityRejection.GENERATION_CHANGED) {
    throw new Error('工作区已更新，请重新确认要结束的任务。');
  }

  throw new Error('服务未确认结束此 Agent 工作区。');
}
