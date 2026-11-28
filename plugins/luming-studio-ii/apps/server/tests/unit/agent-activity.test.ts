import { expect, test } from 'vitest';
import { createAgentActivity } from '../../src/modules/rooms/application/index.js';
import type { AgentActivityResult } from '../../src/modules/rooms/domain/index.js';

const principal = { boardId: 'board', ownerId: 'owner', agentId: 'agent-1' };
const otherAgent = { ...principal, agentId: 'agent-2' };
const west = { x: 0, y: 0, width: 100, height: 100 };
const east = { x: 100, y: 0, width: 100, height: 100 };
const taskId = 'architecture';
const start = {
  kind: 'begin',
  taskId,
  label: '绘制架构',
  scope: { kind: 'objects', objectIds: ['left', 'right'] },
} as const;

function fixture() {
  let now = 1_000;
  let reads = 0;
  let generation = 0;
  const metadata = new Map([
    ['left', west],
    ['right', east],
  ]);
  const activity = createAgentActivity({
    now: () => now,
    mintGeneration: () => 'generation-' + ++generation,
    resolveScope(boardId, ownerId, scope) {
      reads++;
      if (boardId !== principal.boardId || ownerId !== principal.ownerId) {
        return undefined;
      }
      if (scope.kind === 'area') {
        return [];
      }

      return scope.objectIds.flatMap((id) => {
        const bounds = metadata.get(id);

        return bounds ? [{ id, bounds }] : [];
      });
    },
  });

  return {
    activity,
    reads: () => reads,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

function workspace(result: AgentActivityResult) {
  if (result.kind !== 'active') {
    throw new Error('Expected an active workspace');
  }

  return result.workspace;
}

test('keeps idle Agent presence for twenty seconds independently of the ending workspace', () => {
  const { activity, advance } = fixture();
  const boardId = principal.boardId;
  expect(activity.onlineAgentIds(boardId)).toEqual([]);
  const { generation } = workspace(activity.change(principal, start));
  expect(activity.onlineAgentIds(boardId)).toEqual([principal.agentId]);
  activity.change(principal, { kind: 'end', taskId, generation });
  advance(19_999);
  expect(activity.visibleSnapshot(boardId)).toEqual([]);
  expect(activity.onlineAgentIds(boardId)).toEqual([principal.agentId]);
  advance(1);
  expect(activity.onlineAgentIds(boardId)).toEqual([]);
});

test('disconnecting one Agent clears its own idle presence and workspaces without removing its peer', () => {
  const { activity } = fixture();
  const boardId = principal.boardId;
  const first = workspace(
    activity.change(principal, { ...start, scope: { kind: 'objects', objectIds: ['left'] } }),
  );
  activity.change(principal, { kind: 'end', taskId, generation: first.generation });
  const second = workspace(
    activity.change(otherAgent, { ...start, scope: { kind: 'objects', objectIds: ['right'] } }),
  );
  expect(activity.onlineAgentIds(boardId)).toEqual([principal.agentId, otherAgent.agentId]);
  expect(activity.withdraw({ ownerId: 'outsider', agentId: principal.agentId })).toEqual([]);
  expect(activity.withdraw(principal)).toEqual([boardId]);
  expect(activity.onlineAgentIds(boardId)).toEqual([otherAgent.agentId]);
  expect(activity.change(principal, { ...start, taskId: 'late' })).toEqual({
    kind: 'rejected',
    reason: 'workspaceReleased',
  });
  expect(activity.snapshot(boardId)).toEqual([second]);
  expect(activity.withdraw(otherAgent)).toEqual([boardId]);
  expect(activity.onlineAgentIds(boardId)).toEqual([]);
  expect(activity.snapshot(boardId)).toEqual([]);
});

test('keeps concurrent reads active until the last finishes without opening an editing scope', () => {
  const { activity, advance } = fixture();
  const boardId = principal.boardId;
  activity.setReadPresence(principal, 'read-one', true);
  activity.setReadPresence(principal, 'read-two', true);
  activity.setReadPresence(principal, 'read-one', false);
  expect(activity.onlineAgentIds(boardId)).toEqual([principal.agentId]);
  expect(activity.readingAgentIds(boardId)).toEqual([principal.agentId]);
  expect(activity.snapshot(boardId)).toEqual([]);

  activity.setReadPresence(principal, 'read-two', false);
  advance(19_999);
  expect(activity.readingAgentIds(boardId)).toEqual([]);
  expect(activity.onlineAgentIds(boardId)).toEqual([principal.agentId]);
  advance(1);
  expect(activity.onlineAgentIds(boardId)).toEqual([]);
});

test('keeps duplicate begin and no-op progress on the same generation and deadline', () => {
  const { activity, advance, reads } = fixture();
  const first = workspace(activity.change(principal, start));
  expect(first.lastProgressAtUnixMs).toBe(1000);
  advance(250);

  const retry = { ...start, scope: { kind: 'objects', objectIds: ['right', 'left'] } } as const;
  expect(workspace(activity.change(principal, retry))).toBe(first);
  expect(activity.snapshot(principal.boardId)[0]).toBe(first);
  expect(reads()).toBe(1);

  const progress = {
    kind: 'update',
    taskId,
    generation: first.generation,
    phase: 'writing',
    activeObjectIds: ['right'],
  } as const;
  const next = workspace(activity.change(principal, progress));
  expect(next.expiresAtUnixMs).toBe(first.expiresAtUnixMs + 250);
  expect(next.lastProgressAtUnixMs).toBe(1250);
  expect(next.areas.find(({ id }) => id === 'right')).toMatchObject({ active: true });
  expect(next.areas.find(({ id }) => id === 'left')).toMatchObject({ active: false });
  advance(100);
  expect(workspace(activity.change(principal, progress))).toBe(next);
  expect(reads()).toBe(2);
});

test('requires the expired generation to restart and never lets an old generation mutate it', () => {
  const { activity, advance } = fixture();
  const first = workspace(activity.change(principal, start));
  advance(600_000);
  expect(activity.snapshot(principal.boardId)).toEqual([]);
  expect(activity.visibleSnapshot(principal.boardId)[0]).toMatchObject({
    generation: first.generation,
    endReason: 'expired',
    endedAtUnixMs: first.expiresAtUnixMs,
  });
  expect(activity.change(principal, { kind: 'status', taskId })).toEqual({
    kind: 'ended',
    generation: first.generation,
    reason: 'expired',
  });
  expect(activity.change(principal, start)).toMatchObject({
    kind: 'rejected',
    reason: 'generationChanged',
  });

  const renewal = { ...start, previousGeneration: first.generation };
  const second = workspace(activity.change(principal, renewal));
  expect(second.generation).not.toBe(first.generation);
  expect(workspace(activity.change(principal, renewal))).toBe(second);
  expect(
    activity.change(principal, { kind: 'end', taskId, generation: first.generation }),
  ).toMatchObject({
    kind: 'rejected',
    reason: 'generationChanged',
  });
  expect(activity.snapshot(principal.boardId)).toEqual([second]);
});

test('binds release to board, owner, Agent and generation and remembers the owner decision', () => {
  const { activity, advance } = fixture();
  const first = workspace(activity.change(principal, start));
  const release = { ...principal, taskId, generation: first.generation };
  const wrongTargets = [
    { ...release, boardId: 'other-board' },
    { ...release, ownerId: 'other-owner' },
    { ...release, agentId: 'other-agent' },
    { ...release, generation: 'old-generation' },
  ];

  for (const target of wrongTargets) {
    expect(activity.release(target).kind).toBe('rejected');
  }

  expect(activity.snapshot(principal.boardId, 'other-owner')).toEqual([]);
  expect(activity.change(otherAgent, { kind: 'status', taskId })).toMatchObject({
    kind: 'rejected',
    reason: 'notFound',
  });
  const ended = activity.release(release);
  expect(ended).toEqual({ kind: 'ended', generation: first.generation, reason: 'released' });
  expect(activity.release(release)).toEqual(ended);
  expect(activity.snapshot(principal.boardId)).toEqual([]);
  expect(activity.visibleSnapshot(principal.boardId)[0]).toMatchObject({
    generation: first.generation,
    endReason: 'released',
    endedAtUnixMs: 1000,
  });

  advance(86_400_000);
  expect(
    activity.change(principal, { ...start, previousGeneration: first.generation }),
  ).toMatchObject({
    kind: 'rejected',
    reason: 'workspaceReleased',
  });
});

test('shows a completed lease briefly without keeping its editing grant', () => {
  const { activity, advance } = fixture();
  const first = workspace(activity.change(principal, start));
  advance(200);
  const end = { kind: 'end', taskId, generation: first.generation } as const;
  expect(activity.change(principal, end)).toEqual({
    kind: 'ended',
    generation: first.generation,
    reason: 'completed',
  });
  expect(activity.snapshot(principal.boardId, principal.ownerId)).toEqual([]);
  expect(activity.visibleSnapshot(principal.boardId)).toEqual([
    { ...first, endedAtUnixMs: 1200, endReason: 'completed' },
  ]);
  advance(4_000);
  expect(activity.visibleSnapshot(principal.boardId)).toEqual([]);
  expect(activity.change(principal, end)).toMatchObject({ kind: 'ended', reason: 'completed' });
});

test('resolves rectangle focus through board metadata and rejects outside objects or overlapping leases', () => {
  const { activity } = fixture();
  const first = workspace(
    activity.change(principal, { ...start, scope: { kind: 'area', bounds: west } }),
  );
  const other = { ...start, scope: { kind: 'area', bounds: east } } as const;
  expect(activity.change(otherAgent, other).kind).toBe('active');
  expect(activity.change({ ...principal, agentId: 'agent-3' }, start)).toMatchObject({
    kind: 'rejected',
    reason: 'overlap',
  });

  const update = {
    kind: 'update',
    taskId,
    generation: first.generation,
    phase: 'writing',
  } as const;
  expect(activity.change(principal, { ...update, activeObjectIds: ['right'] })).toMatchObject({
    kind: 'rejected',
    reason: 'invalid',
  });
  expect(activity.snapshot(principal.boardId)[0]).toBe(first);
  const focused = workspace(activity.change(principal, { ...update, activeObjectIds: ['left'] }));
  expect(focused.areas).toEqual([
    { id: '@area', bounds: west, active: false },
    { id: 'left', bounds: west, active: true },
  ]);
});

test('rejects invalid or unresolvable scope and bounds concurrent leases by Agent and board', () => {
  const { activity } = fixture();
  const missing = { ...start, scope: { kind: 'objects', objectIds: ['left', 'missing'] } } as const;
  const oversize = {
    ...start,
    scope: {
      kind: 'objects',
      objectIds: Array.from({ length: 25 }, (_, index) => 'shape-' + index),
    },
  } as const;
  expect(activity.change(principal, missing)).toMatchObject({
    kind: 'rejected',
    reason: 'invalid',
  });
  expect(activity.change(principal, oversize)).toMatchObject({
    kind: 'rejected',
    reason: 'invalid',
  });

  for (const agent of [principal, otherAgent]) {
    for (let index = 0; index < 6; index++) {
      const x = index * 100 + (agent === principal ? 0 : 1_000);
      const operation = {
        ...start,
        taskId: 'task-' + index,
        scope: { kind: 'area', bounds: { ...west, x } },
      } as const;
      expect(activity.change(agent, operation).kind).toBe('active');
    }
  }

  const additional = { ...start, scope: { kind: 'area', bounds: { ...west, x: 2_000 } } } as const;
  expect(activity.change({ ...principal, agentId: 'agent-3' }, additional)).toMatchObject({
    kind: 'rejected',
    reason: 'capacity',
  });
  expect(activity.withdraw({ ownerId: principal.ownerId, agentId: principal.agentId })).toEqual([
    principal.boardId,
  ]);
  expect(activity.snapshot(principal.boardId)).toHaveLength(6);
  expect(activity.change({ ...principal, agentId: 'agent-3' }, additional).kind).toBe('active');
});
