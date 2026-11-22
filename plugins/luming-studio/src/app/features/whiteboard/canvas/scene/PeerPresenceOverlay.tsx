import { useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  AGENT_TASK_FADE_MS,
  type AgentTaskReleaseTarget,
  type BoardElement,
  type Presence,
} from '../../../../../contracts/studio.js';
import { readableText } from '../../../../../shared/theme.js';
import { participantColor } from '../../../../shared/presence-members.js';
import { boundsOf, elementBounds } from './canvas-model.js';
import {
  visibleAgentTasks,
  agentTaskBounds,
  agentTaskDeadline,
  agentTaskEndedAt,
  agentTaskStale,
  agentWorkStatus,
  type ActivityBounds,
} from '../../../../shared/agent-activity.js';
import { AgentWorkingMark } from '../../../../shared/AgentWorkingMark.js';

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

const IDLE_AFTER = 60_000;
const EXPIRE_AFTER = 15 * 60_000;

function subscribeDeadline(
  deadline: number,
  clockOffsetMs: number,
  onElapsed: (stamp: number) => void,
) {
  const stamp = Date.now();
  const delay = deadline - (stamp + clockOffsetMs);
  if (delay <= 0) {
    onElapsed(stamp);

    return;
  }

  const timeout = setTimeout(() => onElapsed(Date.now()), delay);

  return () => clearTimeout(timeout);
}

type TargetState = 'editing' | 'moving' | 'saving';
type Cursor = NonNullable<Presence['cursor']>;
type PresenceCursor = { peer: Presence; at: number };
type PresenceTarget = { peer: Presence; element: BoardElement; state: TargetState };
type PresenceHint = { peer: Presence; elements: BoardElement[]; state: TargetState };

const targetPriority = { saving: 0, editing: 1, moving: 2 };

function activeBoardPeers(peers: Presence[], selfActorId: string, artifactId: string, now: number) {
  return peers.filter((peer) => {
    const visibleVisitor = peer.actor.id !== selfActorId && peer.visible !== false;
    const onBoard = !peer.context || peer.context.artifactId === artifactId;
    if (!visibleVisitor || !onBoard) {
      return false;
    }

    const expiry = Date.parse(peer.updatedAt) + EXPIRE_AFTER;

    return Number.isFinite(expiry) && expiry > now;
  });
}

function isBoardCursor(cursor: Presence['cursor']): cursor is Cursor {
  if (!cursor || (cursor.surface && cursor.surface !== 'board')) {
    return false;
  }

  return Number.isFinite(cursor.x) && Number.isFinite(cursor.y);
}

function latestBoardCursors(peers: Presence[], now: number) {
  const cursors = new Map<string, PresenceCursor>();
  for (const peer of peers) {
    const cursor = peer.cursor;
    if (!isBoardCursor(cursor)) {
      continue;
    }

    const at = cursor.t ?? Date.parse(peer.updatedAt);
    if (!Number.isFinite(at) || at + EXPIRE_AFTER <= now) {
      continue;
    }

    const previous = cursors.get(peer.actor.id);
    const newerAtSameTime = previous?.at === at && previous.peer.updatedAt < peer.updatedAt;
    if (!previous || previous.at < at || newerAtSameTime) {
      cursors.set(peer.actor.id, { peer, at });
    }
  }

  return cursors;
}

function taskBoxesChanged(
  previous: Map<string, ActivityBounds>,
  current: Map<string, ActivityBounds>,
) {
  return (
    current.size !== previous.size ||
    [...current].some(([key, box]) => {
      const oldBox = previous.get(key);
      if (!oldBox) {
        return true;
      }

      const positionChanged = !Object.is(oldBox.x, box.x) || !Object.is(oldBox.y, box.y);
      const sizeChanged = !Object.is(oldBox.w, box.w) || !Object.is(oldBox.h, box.h);

      return positionChanged || sizeChanged;
    })
  );
}

function prefersTarget(candidate: PresenceTarget, previous: PresenceTarget | undefined) {
  if (!previous) {
    return true;
  }

  const higherPriority = targetPriority[candidate.state] > targetPriority[previous.state];
  const newerAtSamePriority =
    candidate.state === previous.state && previous.peer.updatedAt < candidate.peer.updatedAt;

  return higherPriority || newerAtSamePriority;
}

function targetState(moving: boolean, editing: boolean): TargetState {
  if (moving) {
    return 'moving';
  }

  return editing ? 'editing' : 'saving';
}

function peerTargets(
  peer: Presence,
  elements: Map<string, BoardElement>,
  geometryTargets: NonNullable<Props['geometryTargets']>,
) {
  const editing = new Set(peer.context?.editingIds ?? []);
  const moving = new Set(
    Array.isArray(peer.context?.movingIds) ? (peer.context.movingIds as string[]) : [],
  );
  const saving = peer.context?.savingIds ?? [];
  const previewing = new Set(
    geometryTargets
      .filter((target) => target.peerId === peer.peerId)
      .flatMap((target) => [...target.elementIds]),
  );
  const targets: PresenceTarget[] = [];
  for (const id of new Set([...editing, ...moving, ...saving])) {
    const element = elements.get(id);
    if (!element) {
      continue;
    }

    const alongsidePreview = moving.has(id) && previewing.has(id);
    if (alongsidePreview && !editing.has(id) && !saving.includes(id)) {
      continue;
    }

    const state = targetState(moving.has(id) && !previewing.has(id), editing.has(id));
    targets.push({ peer, element, state });
  }

  return targets;
}

function presenceHints(targets: Map<string, PresenceTarget>) {
  const hints = new Map<string, PresenceHint>();
  for (const { peer, element, state } of targets.values()) {
    const key = peer.peerId + ':' + state;
    const hint = hints.get(key);
    if (hint) {
      hint.elements.push(element);
    } else {
      hints.set(key, { peer, elements: [element], state });
    }
  }

  return hints;
}

function summarizeActivity(
  active: Presence[],
  cursors: Map<string, PresenceCursor>,
  elements: BoardElement[],
  geometryTargets: NonNullable<Props['geometryTargets']>,
  previousTaskBoxes: Map<string, ActivityBounds>,
  now: number,
) {
  const deadlines: number[] = [];
  const byId = new Map(elements.map((element) => [element.id, element]));
  const activeTasks = active.map((peer) => ({ peer, tasks: visibleAgentTasks(peer, now) }));
  const taskAreas = activeTasks.flatMap(({ peer, tasks }) =>
    tasks.flatMap((task) => {
      deadlines.push(agentTaskDeadline(task, now));
      const key = [peer.actor.id, task.taskId, task.generation].join('\0');
      const endedAt = agentTaskEndedAt(task, now);
      const previous = endedAt === undefined ? undefined : previousTaskBoxes.get(key);
      const box = agentTaskBounds(task, elements) ?? previous;

      return box ? [{ peer, task, box, key, endedAt }] : [];
    }),
  );
  const targets = new Map<string, PresenceTarget>();
  for (const { peer, tasks } of activeTasks) {
    if (tasks.length) {
      continue;
    }

    for (const candidate of peerTargets(peer, byId, geometryTargets)) {
      const key = peer.actor.id + ':' + candidate.element.id;
      if (prefersTarget(candidate, targets.get(key))) {
        targets.set(key, candidate);
      }

      deadlines.push(Date.parse(peer.updatedAt) + EXPIRE_AFTER);
    }
  }

  for (const { peer, at } of cursors.values()) {
    deadlines.push(at + IDLE_AFTER, at + EXPIRE_AFTER, Date.parse(peer.updatedAt) + EXPIRE_AFTER);
  }

  return {
    taskAreas,
    hints: presenceHints(targets),
    deadline: deadlines.reduce((next, at) => (at > now ? Math.min(next, at) : next), Infinity),
  };
}

function displayedTaskState(ending: boolean, stale: boolean, phase: string) {
  if (ending) {
    return 'ending';
  }

  return stale ? 'stale' : phase;
}

function targetAction(state: TargetState, actor: Presence['actor']) {
  if (state === 'saving') {
    return '正在保存';
  }

  return state === 'moving' || actor.kind === 'agent' ? '正在修改' : '正在编辑';
}

export default function PeerPresenceOverlay({
  peers,
  elements,
  artifactId,
  selfActorId,
  zoom,
  clockOffsetMs = 0,
  preview = false,
  geometryTargets = [],
  onReleaseAgentTask,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  const [clock, setClock] = useState(Date.now);
  const [lastTaskBoxes, setLastTaskBoxes] = useState(() => new Map<string, ActivityBounds>());
  const pending = useRef(new Set<string>());
  const [releasing, setReleasing] = useState(new Set<string>());
  const [releaseError, setReleaseError] = useState<{ key: string; message: string }>();
  useEffect(() => {
    const update = () => {
      setVisible(document.visibilityState !== 'hidden' && !root.current?.closest('[hidden]'));
      setClock(Date.now());
    };

    update();
    const observer = new MutationObserver(update);
    for (let node = root.current?.parentElement; node; node = node.parentElement) {
      observer.observe(node, { attributes: true, attributeFilter: ['hidden'] });
    }

    document.addEventListener('visibilitychange', update);

    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  const now = clock + clockOffsetMs;
  const active = preview || !visible ? [] : activeBoardPeers(peers, selfActorId, artifactId, now);
  const cursors = latestBoardCursors(active, now);
  const { taskAreas, hints, deadline } = summarizeActivity(
    active,
    cursors,
    elements,
    geometryTargets,
    lastTaskBoxes,
    now,
  );
  const nextTaskBoxes = new Map(taskAreas.map(({ key, box }) => [key, box]));
  if (taskBoxesChanged(lastTaskBoxes, nextTaskBoxes)) {
    setLastTaskBoxes(nextTaskBoxes);
  }

  useEffect(() => {
    if (!visible || preview || !Number.isFinite(deadline)) {
      return;
    }

    return subscribeDeadline(deadline, clockOffsetMs, setClock);
  }, [deadline, clockOffsetMs, visible, preview]);

  const release = async (target: AgentTaskReleaseTarget, key: string) => {
    if (!onReleaseAgentTask || preview || pending.current.has(key)) {
      return;
    }

    pending.current.add(key);
    setReleasing(new Set(pending.current));
    setReleaseError(undefined);
    try {
      await onReleaseAgentTask(target);
    } catch (error) {
      setReleaseError({
        key,
        message: `结束工作区失败：${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      pending.current.delete(key);
      setReleasing(new Set(pending.current));
    }
  };

  function handleTaskRelease(
    event: MouseEvent<HTMLButtonElement>,
    target: AgentTaskReleaseTarget,
    key: string,
  ) {
    event.stopPropagation();
    release(target, key).catch((error: unknown) => {
      setReleaseError({ key, message: '结束工作区失败：' + String(error) });
    });
  }

  const slots = new Map<string, number>();
  const targetCounts = new Map<string, number>();
  for (const hint of hints.values()) {
    const key = hint.elements
      .map((element) => element.id)
      .sort()
      .join('\0');
    targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1);
  }

  return (
    <div
      ref={root}
      className="studio-peer-presence-overlay"
      aria-label="协作者在画布上的位置"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      {taskAreas.map(({ peer, task, box, key, endedAt }) => {
        const color = participantColor(peer.actor, peer.color);
        const label = agentWorkStatus(task, now);
        const stale = agentTaskStale(task, now);
        const ending = endedAt !== undefined;
        const displayColor =
          stale || ending ? 'var(--canvas-ui-muted, var(--studio-muted, #737b86))' : color;

        return (
          <div
            key={key}
            className={`studio-agent-task-area${stale ? ' is-stale' : ''}${ending ? ' is-ending' : ''}`}
            data-agent-task={task.taskId}
            data-agent-generation={task.generation}
            data-agent-phase={task.phase}
            data-agent-state={displayedTaskState(ending, stale, task.phase)}
            data-peer-actor={peer.actor.id}
            role="status"
            aria-label={`${peer.actor.name} · ${label}，工作区域提示`}
            style={
              {
                left: box.x,
                top: box.y,
                width: box.w,
                height: box.h,
                pointerEvents: 'none',
                opacity: ending ? 0 : 1,
                '--agent-work-color': displayColor,
                '--agent-work-stroke': `${1.5 / zoom}px`,
                '--agent-work-radius': `${8 / zoom}px`,
                '--agent-work-gap': `${4 / zoom}px`,
                '--agent-work-scale': 1 / zoom,
                '--agent-work-play-state': stale || ending ? 'paused' : 'running',
                '--agent-work-fade': `${ending ? Math.max(0, endedAt + AGENT_TASK_FADE_MS - now) : AGENT_TASK_FADE_MS}ms`,
              } as React.CSSProperties
            }
          >
            <div
              className="studio-agent-task-label"
              style={{
                background: displayColor,
                color:
                  stale || ending
                    ? 'var(--canvas-ui, var(--studio-surface, #fff))'
                    : readableText(color),
              }}
            >
              <AgentWorkingMark />
              <span>
                {peer.actor.name} · {label}
              </span>
              <i>.</i>
              <i>.</i>
              <i>.</i>
              {!ending && onReleaseAgentTask && (
                <button
                  type="button"
                  data-native-interactive="true"
                  data-agent-task-release={task.taskId}
                  aria-label={`结束此工作区：${task.label || task.taskId}`}
                  title="结束此工作区并撤销后续写入，不会停止模型运行"
                  disabled={releasing.has(key)}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) =>
                    handleTaskRelease(
                      event,
                      {
                        artifactId,
                        targetActorId: peer.actor.id,
                        taskId: task.taskId,
                        generation: task.generation,
                      },
                      key,
                    )
                  }
                >
                  {releasing.has(key) ? '正在结束…' : '结束此工作区'}
                </button>
              )}
            </div>
            {releaseError?.key === key && (
              <div
                className="studio-agent-task-error"
                role="alert"
                style={{ transform: `scale(${1 / zoom})` }}
              >
                {releaseError.message}
              </div>
            )}
          </div>
        );
      })}
      {[...hints.entries()].map(([key, { peer, elements: changed, state }]) => {
        const first = changed[0]!;
        const ids = changed.map((element) => element.id).sort();
        const targetKey = ids.join('\0');
        const box =
          changed.length === 1
            ? elementBounds(first, elements)
            : boundsOf(
                changed.map((element) => {
                  const bounds = elementBounds(element, elements);
                  const angle =
                    element.type === 'arrow' ? 0 : ((element.rotation ?? 0) * Math.PI) / 180;
                  const w =
                    Math.abs(bounds.w * Math.cos(angle)) + Math.abs(bounds.h * Math.sin(angle));
                  const h =
                    Math.abs(bounds.w * Math.sin(angle)) + Math.abs(bounds.h * Math.cos(angle));

                  return {
                    x: bounds.x + (bounds.w - w) / 2,
                    y: bounds.y + (bounds.h - h) / 2,
                    w,
                    h,
                  };
                }),
              )!;
        const color = participantColor(peer.actor, peer.color);
        const slot = slots.get(targetKey) ?? 0;
        const moving = state === 'moving';
        slots.set(targetKey, slot + 1);
        if (slot >= 3) {
          return null;
        }

        const extra = slot === 2 ? (targetCounts.get(targetKey) ?? 0) - 3 : 0;
        const padding = (3 + slot * 3) / zoom;
        const rotation = changed.length === 1 && first.type !== 'arrow' ? (first.rotation ?? 0) : 0;
        const action = targetAction(state, peer.actor);

        return (
          <div
            key={key}
            data-peer-target={changed.length === 1 ? first.id : undefined}
            data-peer-targets={ids.join(' ')}
            data-peer-state={state}
            data-peer-actor={peer.actor.id}
            data-peer-id={peer.peerId}
            role="status"
            aria-label={`${peer.actor.name} ${action}${changed.length === 1 ? '此对象' : ` ${changed.length} 个对象`}`}
            style={{
              position: 'absolute',
              left: box.x - padding,
              top: box.y - padding,
              width: box.w + 2 * padding,
              height: box.h + 2 * padding,
              border: `${1.5 / zoom}px ${moving ? 'dashed' : 'solid'} ${color}`,
              borderRadius: 5 / zoom,
              transform: rotation ? `rotate(${rotation}deg)` : undefined,
              pointerEvents: 'none',
              zIndex: 72,
            }}
          >
            <span
              style={{
                position: 'absolute',
                left: 0,
                bottom: `calc(100% + ${(4 + slot * 20) / zoom}px)`,
                padding: '3px 6px',
                borderRadius: 4,
                background: color,
                color: readableText(color),
                font: '11px/1.4 Arial,"Microsoft YaHei",sans-serif',
                whiteSpace: 'nowrap',
                maxWidth: 240,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                transform: `scale(${1 / zoom})${rotation ? ` rotate(${-rotation}deg)` : ''}`,
                transformOrigin: 'left bottom',
              }}
            >
              {peer.actor.name} · {action}
              {changed.length > 1 && ` · ${changed.length} 个对象`}
              {extra > 0 && ` · 另 ${extra} 人`}
            </span>
          </div>
        );
      })}
      {[...cursors.values()].map(({ peer, at }) => {
        const color = participantColor(peer.actor, peer.color);
        const idle = now >= at + IDLE_AFTER;

        return (
          <div
            key={peer.actor.id}
            className={`studio-remote-cursor${idle ? ' is-idle' : ''}`}
            data-peer-actor={peer.actor.id}
            data-peer-id={peer.peerId}
            style={{
              left: peer.cursor!.x,
              top: peer.cursor!.y,
              opacity: idle ? 0.35 : 1,
              transform: `scale(${1 / zoom})`,
              pointerEvents: 'none',
            }}
          >
            <svg width="18" height="23" viewBox="0 0 18 23" aria-hidden="true">
              <path d="M2 1 16 14 10 15 7 21 2 1Z" fill={color} stroke="#fff" strokeWidth="1.4" />
            </svg>
            <span style={{ background: color, color: readableText(color) }}>{peer.actor.name}</span>
          </div>
        );
      })}
    </div>
  );
}
