import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_TASK_FADE_MS,
  AGENT_TASK_LEASE_MS,
  LOCAL_ACTOR,
  type Actor,
  type AgentTask,
} from '../src/contracts/studio.js';
import { StudioCollaboration } from '../src/core/shared/collaboration.js';

const agent: Actor = {
  id: 'workspace-agent',
  name: 'Workspace agent',
  kind: 'agent',
  role: 'owner',
};
const other: Actor = { ...agent, id: 'other-agent' };
const scope = { rect: { x: 100, y: 100, w: 400, h: 300 } };
const instances: StudioCollaboration[] = [];
const create = () => {
  const instance = new StudioCollaboration();
  instances.push(instance);

  return instance;
};

const begin = (
  collaboration: StudioCollaboration,
  taskId = 'task',
  actor = agent,
  nextScope = scope,
): AgentTask =>
  collaboration
    .activity('board', { action: 'begin', taskId, scope: nextScope }, actor)
    .tasks.find((task) => task.taskId === taskId)!;
const ref = (task: AgentTask) => ({ taskId: task.taskId, generation: task.generation });

afterEach(() => {
  for (const instance of instances.splice(0)) {
    instance.close();
  }

  vi.useRealTimers();
});

describe('generation-bound Agent workspaces', () => {
  it('starts a ten-minute task and distinguishes activity from genuine phase progress', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const collaboration = create();
    const task = begin(collaboration);
    expect(task).toMatchObject({
      phase: 'preparing',
      startedAt: 1000,
      lastActivityAt: 1000,
      lastProgressAt: 1000,
      expiresAt: 1000 + AGENT_TASK_LEASE_MS,
    });
    expect(task.generation).toEqual(expect.any(String));
    vi.advanceTimersByTime(61_000);
    expect(collaboration.getPresence('board')[0]!.context!.agentTasks).toHaveLength(1);
    const same = collaboration.activity(
      'board',
      { action: 'begin', taskId: task.taskId, scope },
      agent,
    ).tasks[0]!;
    expect(same.generation).toBe(task.generation);
    expect(same.startedAt).toBe(1000);
    expect(same.lastProgressAt).toBe(1000);
    expect(same.lastActivityAt).toBe(62_000);
    vi.advanceTimersByTime(1000);
    const phase = collaboration.activity(
      'board',
      { action: 'update', ...ref(task), phase: 'writing' },
      agent,
    ).tasks[0]!;
    expect(phase.lastProgressAt).toBe(63_000);
    vi.advanceTimersByTime(1000);
    const label = collaboration.activity(
      'board',
      { action: 'update', ...ref(task), phase: 'writing', label: 'Finish the diagram' },
      agent,
    ).tasks[0]!;
    expect(label.lastActivityAt).toBe(64_000);
    expect(label.lastProgressAt).toBe(63_000);
  });

  it('returns active status without keeping an otherwise inactive task alive', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const collaboration = create();
    const task = begin(collaboration);
    vi.advanceTimersByTime(AGENT_TASK_LEASE_MS - 1);
    expect(collaboration.activity('board', { action: 'status' }, agent).tasks[0]!.expiresAt).toBe(
      task.expiresAt,
    );
    vi.advanceTimersByTime(2);
    expect(collaboration.activity('board', { action: 'status' }, agent).tasks).toEqual([]);
    expect(() =>
      collaboration.activity('board', { action: 'update', ...ref(task) }, agent),
    ).toThrow(expect.objectContaining({ code: 'TASK_STALE' }));
    expect(
      collaboration.activity('board', { action: 'status', taskId: task.taskId }, agent),
    ).toMatchObject({ tasks: [], ended: { ...ref(task), outcome: 'expired' } });
    const recovered = collaboration.activity(
      'board',
      { action: 'begin', taskId: task.taskId, generation: task.generation, scope },
      agent,
    ).tasks[0]!;
    expect(recovered.generation).not.toBe(task.generation);
    expect(() => collaboration.activity('board', { action: 'end', ...ref(task) }, agent)).toThrow(
      expect.objectContaining({ code: 'TASK_STALE' }),
    );
    expect(collaboration.activity('board', { action: 'status' }, agent).tasks[0]!.generation).toBe(
      recovered.generation,
    );
  });

  it('keeps an ended display briefly but never returns it as active or reopens its logical task', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const collaboration = create();
    const task = begin(collaboration);
    expect(collaboration.activity('board', { action: 'end', ...ref(task) }, agent).tasks).toEqual(
      [],
    );
    expect(collaboration.getPresence('board')[0]!.context!.agentTasks).toEqual([
      expect.objectContaining({ ...ref(task), outcome: 'completed', endedAt: 1000 }),
    ]);
    expect(collaboration.activity('board', { action: 'end', ...ref(task) }, agent).tasks).toEqual(
      [],
    );
    expect(() => begin(collaboration)).toThrow(expect.objectContaining({ code: 'TASK_CLOSED' }));
    vi.advanceTimersByTime(AGENT_TASK_FADE_MS + 1);
    expect(collaboration.getPresence('board')[0]!.context!.agentTasks).toEqual([]);
    expect(() =>
      collaboration.activity('board', { action: 'update', ...ref(task) }, agent),
    ).toThrow(expect.objectContaining({ code: 'TASK_CLOSED' }));
    const reopened = collaboration.activity(
      'board',
      { action: 'begin', taskId: task.taskId, generation: task.generation, scope },
      agent,
    ).tasks[0]!;
    expect(reopened.generation).not.toBe(task.generation);
    expect(() => collaboration.activity('board', { action: 'end', ...ref(task) }, agent)).toThrow(
      expect.objectContaining({ code: 'TASK_STALE' }),
    );
  });

  it('allows only a human owner to release a specific Agent generation', () => {
    const collaboration = create();
    const task = begin(collaboration);
    for (const actor of [other, { ...LOCAL_ACTOR, role: 'editor' as const }]) {
      expect(() =>
        collaboration.activity(
          'board',
          { action: 'release', targetActorId: agent.id, ...ref(task) },
          actor,
        ),
      ).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    }

    expect(
      collaboration.activity(
        'board',
        { action: 'release', targetActorId: agent.id, ...ref(task) },
        LOCAL_ACTOR,
      ).tasks,
    ).toEqual([]);
    expect(
      collaboration.getPresence('board').find((peer) => peer.actor.id === agent.id)!.context!
        .agentTasks,
    ).toEqual([expect.objectContaining({ outcome: 'released' })]);
    expect(() => begin(collaboration)).toThrow(expect.objectContaining({ code: 'TASK_CLOSED' }));
  });

  it('retires only the ended generation tool activities and ignores its late completion', () => {
    const collaboration = create();
    const task = begin(collaboration);
    const second = begin(collaboration, 'second', agent, {
      rect: { x: 700, y: 100, w: 200, h: 200 },
    });
    const finishOld = collaboration.beginActivity('board', agent, {
      status: 'writing',
      editingIds: ['old'],
      binding: ref(task),
    });
    const finishSecond = collaboration.beginActivity('board', agent, {
      status: 'reading',
      selectedIds: ['second'],
      binding: ref(second),
    });
    collaboration.activity('board', { action: 'end', ...ref(task), outcome: 'cancelled' }, agent);
    const peer = collaboration.getPresence('board')[0]!;
    expect(peer.context!.editingIds).toEqual([]);
    expect(peer.context!.activity).toBe('reading');
    expect(
      peer.context!.agentTasks!.filter((item) => !item.outcome).map((item) => item.taskId),
    ).toEqual(['second']);
    finishOld();
    expect(collaboration.getPresence('board')[0]!.context!.editingIds).toEqual([]);
    finishSecond();
    expect(
      collaboration.activity('board', { action: 'status' }, agent).tasks.map((item) => item.taskId),
    ).toEqual(['second']);
  });

  it('rejects a scope change inside an active generation and overlapping Agent reservations', () => {
    const collaboration = create();
    const task = begin(collaboration);
    expect(() =>
      collaboration.activity(
        'board',
        { action: 'begin', taskId: task.taskId, scope: { rect: { x: 900, y: 900, w: 10, h: 10 } } },
        agent,
      ),
    ).toThrow(expect.objectContaining({ code: 'TASK_SCOPE' }));
    expect(() =>
      begin(collaboration, 'other', other, { rect: { x: 200, y: 200, w: 100, h: 100 } }),
    ).toThrow(expect.objectContaining({ code: 'TASK_SCOPE_CONFLICT' }));
    expect(
      begin(collaboration, 'other', other, { rect: { x: 700, y: 200, w: 100, h: 100 } }).generation,
    ).toEqual(expect.any(String));
  });

  it('does not equate an unrelated page leaving with an Agent task ending', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const collaboration = create();
    const task = begin(collaboration);
    await collaboration.update(
      'board',
      { peerId: 'human-page', peerEpoch: 'epoch', peerSeq: 0 },
      LOCAL_ACTOR,
    );
    const close = collaboration.connectPeer('board', 'human-page', 'epoch', LOCAL_ACTOR);
    close();
    vi.advanceTimersByTime(61_000);
    expect(collaboration.activity('board', { action: 'status' }, agent).tasks[0]!.generation).toBe(
      task.generation,
    );
  });
});
