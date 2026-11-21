import {
  AGENT_TASK_FADE_MS,
  AGENT_TASK_STALE_MS,
  type AgentTask,
  type BoardElement,
  type Presence,
} from '../../contracts/studio.js';
import type { StudioDocument } from '../products.js';
import { elementBounds } from '../canvas/canvas-model.js';

export interface ActivityBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function activeAgentTasks(peer: Presence, now: number): AgentTask[] {
  return peer.actor.kind === 'agent'
    ? (peer.context?.agentTasks ?? []).filter(
        (task) => !task.outcome && task.endedAt === undefined && task.expiresAt > now,
      )
    : [];
}

export function agentTaskEndedAt(task: AgentTask, now: number): number | undefined {
  if (task.outcome === 'expired') {
    return Math.min(task.endedAt ?? task.expiresAt, task.expiresAt);
  }

  return task.endedAt ?? (task.expiresAt <= now ? task.expiresAt : undefined);
}

export function visibleAgentTasks(peer: Presence, now: number): AgentTask[] {
  return peer.actor.kind === 'agent'
    ? (peer.context?.agentTasks ?? []).filter((task) => {
        const endedAt = agentTaskEndedAt(task, now);
        return endedAt === undefined ? !task.outcome : endedAt + AGENT_TASK_FADE_MS > now;
      })
    : [];
}

export function agentTaskStale(task: AgentTask, now: number): boolean {
  return (
    !task.outcome &&
    task.endedAt === undefined &&
    task.expiresAt > now &&
    task.lastProgressAt + AGENT_TASK_STALE_MS <= now
  );
}

export function agentTaskDeadline(task: AgentTask, now: number): number {
  const endedAt = agentTaskEndedAt(task, now);
  if (endedAt !== undefined) {
    return endedAt + AGENT_TASK_FADE_MS;
  }

  const staleAt = task.lastProgressAt + AGENT_TASK_STALE_MS;
  return Math.min(task.expiresAt, staleAt > now ? staleAt : Infinity);
}

export function agentWorkStatus(task: AgentTask, now: number): string {
  const action = (task.label ?? '')
    .trim()
    .replace(/^正在工作(?:\s*·\s*|$)/, '')
    .trim();
  const endedAt = agentTaskEndedAt(task, now);
  const phase =
    endedAt !== undefined
      ? {
          completed: '已完成',
          failed: '未完成',
          cancelled: '已取消',
          expired: '工作区已过期',
          released: '工作区已结束',
        }[task.outcome ?? 'expired']
      : { preparing: '准备中', writing: '修改中', verifying: '检查中' }[task.phase];

  return `${agentTaskStale(task, now) ? '暂未收到新进度 · ' : ''}${phase}${action ? ` · ${action}` : ''}`;
}

export function documentElements(document?: StudioDocument | null): BoardElement[] {
  return document && 'elements' in document ? (document.elements as BoardElement[]) : [];
}

function union(boxes: ActivityBounds[]): ActivityBounds | undefined {
  if (!boxes.length) {
    return;
  }

  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  return {
    x,
    y,
    w: Math.max(...boxes.map((box) => box.x + box.w)) - x,
    h: Math.max(...boxes.map((box) => box.y + box.h)) - y,
  };
}

export function agentTaskBounds(
  task: AgentTask,
  elements: BoardElement[],
): ActivityBounds | undefined {
  const wanted = new Set(task.scope.ids ?? []);
  const boxes = elements
    .filter((element) => wanted.has(element.id))
    .map((element) => {
      const box = elementBounds(element, elements);
      const angle = element.type === 'arrow' ? 0 : ((element.rotation ?? 0) * Math.PI) / 180;
      const w = Math.abs(box.w * Math.cos(angle)) + Math.abs(box.h * Math.sin(angle));
      const h = Math.abs(box.w * Math.sin(angle)) + Math.abs(box.h * Math.cos(angle));
      return {
        x: box.x + (box.w - w) / 2 - 12,
        y: box.y + (box.h - h) / 2 - 12,
        w: Math.max(1, w) + 24,
        h: Math.max(1, h) + 24,
      };
    });

  if (task.scope.rect) {
    boxes.push(task.scope.rect);
  }
  return union(boxes);
}

export function agentPeerBounds(
  peer: Presence,
  elements: BoardElement[],
  now: number,
): ActivityBounds | undefined {
  return union(
    activeAgentTasks(peer, now).flatMap((task) => agentTaskBounds(task, elements) ?? []),
  );
}
