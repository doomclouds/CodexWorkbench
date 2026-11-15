import type { AgentTask, BoardElement, Presence } from '../../contracts/studio.js';
import type { StudioDocument } from '../products.js';
import { elementBounds } from '../canvas/canvas-model.js';

export interface ActivityBounds { x: number; y: number; w: number; h: number }
export function activeAgentTasks(peer: Presence, now: number): AgentTask[] {
  return peer.actor.kind === 'agent' ? (peer.context?.agentTasks ?? []).filter(task => task.expiresAt > now) : [];
}
export function documentElements(document?: StudioDocument | null): BoardElement[] {
  return document && 'elements' in document ? document.elements as BoardElement[] : [];
}
function union(boxes: ActivityBounds[]): ActivityBounds | undefined {
  if (!boxes.length) return;
  const x = Math.min(...boxes.map(box => box.x)), y = Math.min(...boxes.map(box => box.y));
  return { x, y, w: Math.max(...boxes.map(box => box.x + box.w)) - x, h: Math.max(...boxes.map(box => box.y + box.h)) - y };
}
export function agentTaskBounds(task: AgentTask, elements: BoardElement[]): ActivityBounds | undefined {
  const wanted = new Set(task.scope.ids ?? []);
  const boxes = elements.filter(element => wanted.has(element.id)).map(element => {
    const box = elementBounds(element, elements), angle = element.type === 'arrow' ? 0 : (element.rotation ?? 0) * Math.PI / 180;
    const w = Math.abs(box.w * Math.cos(angle)) + Math.abs(box.h * Math.sin(angle)), h = Math.abs(box.w * Math.sin(angle)) + Math.abs(box.h * Math.cos(angle));
    return { x: box.x + (box.w - w) / 2 - 12, y: box.y + (box.h - h) / 2 - 12, w: Math.max(1, w) + 24, h: Math.max(1, h) + 24 };
  });
  if (task.scope.rect) boxes.push(task.scope.rect);
  return union(boxes);
}
export function agentPeerBounds(peer: Presence, elements: BoardElement[], now: number): ActivityBounds | undefined {
  return union(activeAgentTasks(peer, now).flatMap(task => agentTaskBounds(task, elements) ?? []));
}
