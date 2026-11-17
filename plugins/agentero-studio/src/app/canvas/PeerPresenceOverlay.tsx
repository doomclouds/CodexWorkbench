import { useEffect, useRef, useState } from 'react';
import { AGENT_TASK_FADE_MS, type AgentTaskReleaseTarget, type BoardElement, type Presence } from '../../contracts/studio.js';
import { readableText } from '../../core/theme.js';
import { participantColor } from '../shared/presence-members.js';
import { boundsOf, elementBounds } from './canvas-model.js';
import { visibleAgentTasks, agentTaskBounds, agentTaskDeadline, agentTaskEndedAt, agentTaskStale, agentWorkStatus, type ActivityBounds } from '../shared/agent-activity.js';
import { AgentWorkingMark } from '../shared/AgentWorkingMark.js';

interface Props {
  peers: Presence[];
  elements: BoardElement[];
  artifactId: string;
  selfActorId: string;
  zoom: number;
  clockOffsetMs?: number;
  preview?: boolean;
  geometryTargets?: readonly { peerId: string; elementIds: readonly string[] }[];
  onReleaseAgentTask?: (target: AgentTaskReleaseTarget) => Promise<void>;
}
const IDLE_AFTER = 60_000, EXPIRE_AFTER = 15 * 60_000;

export default function PeerPresenceOverlay({ peers, elements, artifactId, selfActorId, zoom, clockOffsetMs = 0, preview = false, geometryTargets = [], onReleaseAgentTask }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  const [, tick] = useState(0);
  const lastTaskBoxes = useRef(new Map<string, ActivityBounds>()), pending = useRef(new Set<string>());
  const [releasing, setReleasing] = useState(new Set<string>()), [releaseError, setReleaseError] = useState<{ key: string; message: string }>();
  useEffect(() => {
    const update = () => { setVisible(document.visibilityState !== 'hidden' && !root.current?.closest('[hidden]')); tick(value => value + 1); };
    update();
    const observer = new MutationObserver(update);
    for (let node = root.current?.parentElement; node; node = node.parentElement) observer.observe(node, { attributes: true, attributeFilter: ['hidden'] });
    document.addEventListener('visibilitychange', update);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, []);
  const now = Date.now() + clockOffsetMs;
  let deadline = Infinity;
  const schedule = (at: number) => { if (at > now) deadline = Math.min(deadline, at); };
  const active = preview || !visible ? [] : peers.filter(peer => {
    if (peer.actor.id === selfActorId || peer.visible === false || peer.context && peer.context.artifactId !== artifactId) return false;
    const expiry = Date.parse(peer.updatedAt) + EXPIRE_AFTER;
    if (!Number.isFinite(expiry) || expiry <= now) return false;
    return true;
  });
  const cursors = new Map<string, { peer: Presence; at: number }>();
  for (const peer of active) {
    const cursor = peer.cursor;
    if (!cursor || cursor.surface && cursor.surface !== 'board' || !Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) continue;
    const at = cursor.t ?? Date.parse(peer.updatedAt);
    if (!Number.isFinite(at) || at + EXPIRE_AFTER <= now) continue;
    const previous = cursors.get(peer.actor.id);
    if (!previous || previous.at < at || previous.at === at && previous.peer.updatedAt < peer.updatedAt) cursors.set(peer.actor.id, { peer, at });
  }
  const byId = new Map(elements.map(element => [element.id, element]));
  const taskAreas = active.flatMap(peer => visibleAgentTasks(peer, now).flatMap(task => {
    schedule(agentTaskDeadline(task, now));
    const key = `${peer.actor.id}\0${task.taskId}\0${task.generation}`, endedAt = agentTaskEndedAt(task, now);
    const box = agentTaskBounds(task, elements) ?? (endedAt === undefined ? undefined : lastTaskBoxes.current.get(key));
    return box ? [{ peer, task, box, key, endedAt }] : [];
  }));
  useEffect(() => { lastTaskBoxes.current = new Map(taskAreas.map(({ key, box }) => [key, box])); });
  type TargetState = 'editing' | 'moving' | 'saving';
  const priority = { saving: 0, editing: 1, moving: 2 };
  const targets = new Map<string, { peer: Presence; element: BoardElement; state: TargetState }>();
  for (const peer of active) {
    if (visibleAgentTasks(peer, now).length) continue;
    const editing = new Set(peer.context?.editingIds ?? []), moving = new Set(Array.isArray(peer.context?.movingIds) ? peer.context.movingIds as string[] : []), saving = peer.context?.savingIds ?? [];
    const previewing = new Set(geometryTargets.filter(target => target.peerId === peer.peerId).flatMap(target => [...target.elementIds]));
    for (const id of new Set([...editing, ...moving, ...saving])) {
      const element = byId.get(id);
      if (!element) continue;
      if (moving.has(id) && previewing.has(id) && !editing.has(id) && !saving.includes(id)) continue;
      const key = `${peer.actor.id}:${id}`, previous = targets.get(key), state = moving.has(id) && !previewing.has(id) ? 'moving' : editing.has(id) ? 'editing' : 'saving';
      if (!previous || priority[state] > priority[previous.state] || state === previous.state && previous.peer.updatedAt < peer.updatedAt) targets.set(key, { peer, element, state });
      schedule(Date.parse(peer.updatedAt) + EXPIRE_AFTER);
    }
  }
  const hints = new Map<string, { peer: Presence; elements: BoardElement[]; state: TargetState }>();
  for (const { peer, element, state } of targets.values()) {
    const key = `${peer.peerId}:${state}`, hint = hints.get(key);
    if (hint) hint.elements.push(element); else hints.set(key, { peer, elements: [element], state });
  }
  for (const { peer, at } of cursors.values()) {
    schedule(at + IDLE_AFTER); schedule(at + EXPIRE_AFTER); schedule(Date.parse(peer.updatedAt) + EXPIRE_AFTER);
  }
  useEffect(() => {
    if (!visible || preview || !Number.isFinite(deadline)) return;
    const timeout = setTimeout(() => tick(value => value + 1), Math.max(1, deadline - (Date.now() + clockOffsetMs)));
    return () => clearTimeout(timeout);
  }, [deadline, clockOffsetMs, visible, preview]);

  const release = async (target: AgentTaskReleaseTarget, key: string) => {
    if (!onReleaseAgentTask || preview || pending.current.has(key)) return;
    pending.current.add(key); setReleasing(new Set(pending.current)); setReleaseError(undefined);
    try { await onReleaseAgentTask(target); }
    catch (error) { setReleaseError({ key, message: `结束工作区失败：${error instanceof Error ? error.message : String(error)}` }); }
    finally { pending.current.delete(key); setReleasing(new Set(pending.current)); }
  };

  const slots = new Map<string, number>();
  const targetCounts = new Map<string, number>();
  for (const hint of hints.values()) { const key = hint.elements.map(element => element.id).sort().join('\0'); targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1); }
  return <div ref={root} className="studio-peer-presence-overlay" aria-label="协作者在画布上的位置" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
    {taskAreas.map(({ peer, task, box, key, endedAt }) => {
      const color = participantColor(peer.actor, peer.color), label = agentWorkStatus(task, now), stale = agentTaskStale(task, now), ending = endedAt !== undefined;
      const displayColor = stale || ending ? 'var(--canvas-ui-muted, var(--studio-muted, #737b86))' : color;
      return <div key={key} className={`studio-agent-task-area${stale ? ' is-stale' : ''}${ending ? ' is-ending' : ''}`} data-agent-task={task.taskId} data-agent-generation={task.generation} data-agent-phase={task.phase} data-agent-state={ending ? 'ending' : stale ? 'stale' : task.phase} data-peer-actor={peer.actor.id} role="status" aria-label={`${peer.actor.name} · ${label}，工作区域提示`} style={{ left: box.x, top: box.y, width: box.w, height: box.h, pointerEvents: 'none', opacity: ending ? 0 : 1, '--agent-work-color': displayColor, '--agent-work-stroke': `${1.5 / zoom}px`, '--agent-work-radius': `${8 / zoom}px`, '--agent-work-gap': `${4 / zoom}px`, '--agent-work-scale': 1 / zoom, '--agent-work-play-state': stale || ending ? 'paused' : 'running', '--agent-work-fade': `${ending ? Math.max(0, endedAt + AGENT_TASK_FADE_MS - now) : AGENT_TASK_FADE_MS}ms` } as React.CSSProperties}><div className="studio-agent-task-label" style={{ background: displayColor, color: stale || ending ? 'var(--canvas-ui, var(--studio-surface, #fff))' : readableText(color) }}><AgentWorkingMark /><span>{peer.actor.name} · {label}</span><i>.</i><i>.</i><i>.</i>{!ending && onReleaseAgentTask && <button type="button" data-native-interactive="true" data-agent-task-release={task.taskId} aria-label={`结束此工作区：${task.label || task.taskId}`} title="结束此工作区并撤销后续写入，不会停止模型运行" disabled={releasing.has(key)} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); void release({ artifactId, targetActorId: peer.actor.id, taskId: task.taskId, generation: task.generation }, key); }}>{releasing.has(key) ? '正在结束…' : '结束此工作区'}</button>}</div>{releaseError?.key === key && <div className="studio-agent-task-error" role="alert" style={{ transform: `scale(${1 / zoom})` }}>{releaseError.message}</div>}</div>;
    })}
    {[...hints.entries()].map(([key, { peer, elements: changed, state }]) => {
      const first = changed[0]!, ids = changed.map(element => element.id).sort(), targetKey = ids.join('\0');
      const box = changed.length === 1 ? elementBounds(first, elements) : boundsOf(changed.map(element => {
        const bounds = elementBounds(element, elements), angle = element.type === 'arrow' ? 0 : (element.rotation ?? 0) * Math.PI / 180;
        const w = Math.abs(bounds.w * Math.cos(angle)) + Math.abs(bounds.h * Math.sin(angle)), h = Math.abs(bounds.w * Math.sin(angle)) + Math.abs(bounds.h * Math.cos(angle));
        return { x: bounds.x + (bounds.w - w) / 2, y: bounds.y + (bounds.h - h) / 2, w, h };
      }))!;
      const color = participantColor(peer.actor, peer.color), slot = slots.get(targetKey) ?? 0, moving = state === 'moving';
      slots.set(targetKey, slot + 1);
      if (slot >= 3) return null;
      const extra = slot === 2 ? (targetCounts.get(targetKey) ?? 0) - 3 : 0;
      const padding = (3 + slot * 3) / zoom, rotation = changed.length === 1 && first.type !== 'arrow' ? first.rotation ?? 0 : 0;
      const action = state === 'saving' ? '正在保存' : moving || peer.actor.kind === 'agent' ? '正在修改' : '正在编辑';
      return <div key={key} data-peer-target={changed.length === 1 ? first.id : undefined} data-peer-targets={ids.join(' ')} data-peer-state={state} data-peer-actor={peer.actor.id} data-peer-id={peer.peerId} role="status" aria-label={`${peer.actor.name} ${action}${changed.length === 1 ? '此对象' : ` ${changed.length} 个对象`}`} style={{ position: 'absolute', left: box.x - padding, top: box.y - padding, width: box.w + 2 * padding, height: box.h + 2 * padding, border: `${1.5 / zoom}px ${moving ? 'dashed' : 'solid'} ${color}`, borderRadius: 5 / zoom, transform: rotation ? `rotate(${rotation}deg)` : undefined, pointerEvents: 'none', zIndex: 72 }}>
        <span style={{ position: 'absolute', left: 0, bottom: `calc(100% + ${(4 + slot * 20) / zoom}px)`, padding: '3px 6px', borderRadius: 4, background: color, color: readableText(color), font: '11px/1.4 Arial,"Microsoft YaHei",sans-serif', whiteSpace: 'nowrap', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', transform: `scale(${1 / zoom})${rotation ? ` rotate(${-rotation}deg)` : ''}`, transformOrigin: 'left bottom' }}>{peer.actor.name} · {action}{changed.length > 1 && ` · ${changed.length} 个对象`}{extra > 0 && ` · 另 ${extra} 人`}</span>
      </div>;
    })}
    {[...cursors.values()].map(({ peer, at }) => {
      const color = participantColor(peer.actor, peer.color), idle = now >= at + IDLE_AFTER;
      return <div key={peer.actor.id} className={`studio-remote-cursor${idle ? ' is-idle' : ''}`} data-peer-actor={peer.actor.id} data-peer-id={peer.peerId} style={{ left: peer.cursor!.x, top: peer.cursor!.y, opacity: idle ? .35 : 1, transform: `scale(${1 / zoom})`, pointerEvents: 'none' }}><svg width="18" height="23" viewBox="0 0 18 23" aria-hidden="true"><path d="M2 1 16 14 10 15 7 21 2 1Z" fill={color} stroke="#fff" strokeWidth="1.4" /></svg><span style={{ background: color, color: readableText(color) }}>{peer.actor.name}</span></div>;
    })}
  </div>;
}
