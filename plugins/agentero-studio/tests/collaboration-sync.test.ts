import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import {
  AGENT_TASK_LEASE_MS,
  LOCAL_ACTOR,
  type Actor,
  type StudioEvent,
} from '../src/contracts/studio.js';
import { StudioCollaboration } from '../src/core/shared/collaboration.js';

const editor: Actor = { id: 'editor', name: 'Editor', kind: 'human', role: 'editor' };
const viewer: Actor = { id: 'viewer', name: 'Viewer', kind: 'human', role: 'viewer' };
const instances: StudioCollaboration[] = [];
const folders: string[] = [];
const create = (dataRoot?: string) => {
  const instance = new StudioCollaboration({ dataRoot });
  instances.push(instance);

  return instance;
};

describe('explicit Agent work areas', () => {
  const agent: Actor = { id: 'agent-builder', name: 'Builder', kind: 'agent', role: 'owner' };
  it('keeps an explicit task across tool completions and isolates parallel agents and tasks', () => {
    const collaboration = create();
    const task = collaboration.activity(
      'board-a',
      {
        action: 'begin',
        taskId: 'diagram',
        scope: { rect: { x: 100, y: 200, w: 600, h: 400 } },
        label: '扩展架构图',
      },
      agent,
    ).tasks[0]!;
    const done = collaboration.beginActivity('board-a', agent, {
      status: 'writing',
      editingIds: ['shape'],
    });
    done();
    expect(collaboration.getPresence('board-a')[0]!.context).toMatchObject({
      activity: 'working',
      editingIds: [],
      agentTasks: [{ taskId: 'diagram', label: '扩展架构图' }],
    });
    collaboration.activity(
      'board-a',
      { action: 'begin', taskId: 'second', scope: { ids: ['other'] } },
      agent,
    );
    const other = { ...agent, id: 'agent-other' };
    collaboration.activity(
      'board-a',
      { action: 'begin', taskId: 'diagram', scope: { ids: ['another'] } },
      other,
    );
    collaboration.activity(
      'board-a',
      { action: 'end', taskId: 'diagram', generation: task.generation },
      agent,
    );
    const peers = collaboration.getPresence('board-a');
    expect(
      peers
        .find((peer) => peer.actor.id === agent.id)!
        .context!.agentTasks!.filter((item) => !item.outcome),
    ).toEqual([expect.objectContaining({ taskId: 'second' })]);
    expect(peers.find((peer) => peer.actor.id === other.id)!.context!.agentTasks).toEqual([
      expect.objectContaining({ taskId: 'diagram' }),
    ]);
  });
  it('renews a bounded lease, expires the task without a final message, and rejects stale updates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const collaboration = create();
    const task = collaboration.activity(
      'board-a',
      { action: 'begin', taskId: 'work', scope: { ids: ['shape'] } },
      agent,
    ).tasks[0]!;
    vi.advanceTimersByTime(59_000);
    expect(
      collaboration.activity(
        'board-a',
        { action: 'update', taskId: 'work', generation: task.generation, label: '正在整理' },
        agent,
      ).tasks[0]!.expiresAt,
    ).toBe(60_000 + AGENT_TASK_LEASE_MS);
    vi.advanceTimersByTime(AGENT_TASK_LEASE_MS - 1);
    expect(collaboration.getPresence('board-a')[0]!.context!.agentTasks).toHaveLength(1);
    vi.advanceTimersByTime(1001);
    expect(collaboration.getPresence('board-a')[0]!.context).toMatchObject({
      activity: 'idle',
      editingIds: [],
      agentTasks: [],
    });
    expect(() =>
      collaboration.activity(
        'board-a',
        { action: 'update', taskId: 'work', generation: task.generation },
        agent,
      ),
    ).toThrow(expect.objectContaining({ code: 'TASK_STALE' }));
    expect(
      collaboration.activity(
        'board-a',
        { action: 'end', taskId: 'work', generation: task.generation },
        agent,
      ).tasks,
    ).toEqual([]);
    vi.advanceTimersByTime(20_000);
    expect(collaboration.getPresence('board-a')).toEqual([]);
  });
  it('accepts only owner Agents and valid nonempty scopes, with an explicit parallel-task bound', () => {
    const collaboration = create();
    for (const actor of [LOCAL_ACTOR, { ...agent, role: 'editor' as const }]) {
      expect(() =>
        collaboration.activity(
          'board-a',
          { action: 'begin', taskId: 'work', scope: { ids: ['shape'] } },
          actor,
        ),
      ).toThrow();
    }

    for (const scope of [
      {},
      { ids: [] },
      { rect: { x: 0, y: 0, w: 0, h: 100 } },
      { rect: { x: Infinity, y: 0, w: 100, h: 100 } },
    ]) {
      expect(() =>
        collaboration.activity('board-a', { action: 'begin', taskId: 'work', scope }, agent),
      ).toThrow();
    }

    for (let i = 0; i < 8; i++) {
      collaboration.activity(
        'board-a',
        { action: 'begin', taskId: `task-${i}`, scope: { ids: ['shape'] } },
        agent,
      );
    }

    expect(() =>
      collaboration.activity(
        'board-a',
        { action: 'begin', taskId: 'ninth', scope: { ids: ['shape'] } },
        agent,
      ),
    ).toThrow(/并行/);

    for (let n = 1; n < 8; n++) {
      for (let i = 0; i < 8; i++) {
        collaboration.activity(
          'board-a',
          { action: 'begin', taskId: `task-${i}`, scope: { ids: [`shape-${n}`] } },
          { ...agent, id: `agent-${n}` },
        );
      }
    }

    expect(() =>
      collaboration.activity(
        'board-a',
        { action: 'begin', taskId: 'overflow', scope: { ids: ['shape'] } },
        { ...agent, id: 'agent-overflow' },
      ),
    ).toThrow(/并行/);
    expect(collaboration.getPresence('board-a')).toHaveLength(8);
  });
  it('ending a task does not hide an in-flight tool, and forgetting the board prevents late completion resurrection', () => {
    const collaboration = create();
    const task = collaboration.activity(
      'board-a',
      { action: 'begin', taskId: 'work', scope: { ids: ['shape', 'shape'] } },
      agent,
    ).tasks[0]!;
    expect(collaboration.getPresence('board-a')[0]!.context!.agentTasks![0]!.scope.ids).toEqual([
      'shape',
    ]);
    const done = collaboration.beginActivity('board-a', agent, {
      status: 'writing',
      editingIds: ['shape'],
    });
    collaboration.activity(
      'board-a',
      { action: 'end', taskId: 'work', generation: task.generation },
      agent,
    );
    expect(collaboration.getPresence('board-a')[0]!.context).toMatchObject({
      activity: 'writing',
      editingIds: ['shape'],
      agentTasks: [expect.objectContaining({ outcome: 'completed' })],
    });
    collaboration.forget('board-a');
    done();
    expect(collaboration.getPresence('board-a')).toEqual([]);
  });
});
afterEach(async () => {
  for (const instance of instances.splice(0)) {
    instance.close();
  }

  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const folder of folders.splice(0)) {
    if (!resolve(folder).startsWith(resolve(tmpdir()) + sep)) {
      throw new Error('Unexpected test directory');
    }

    await rm(folder, { recursive: true, force: true });
  }
});

describe('bounded collaboration replay and peer ordering', () => {
  it('replays each change after a watermark, resets expired/foreign cursors and drops expired room messages', async () => {
    const collaboration = create();
    const first = collaboration.cursor();
    collaboration.emit({
      type: 'board',
      artifactId: 'board-a',
      revision: 2,
      units: [{ id: 'one', after: { text: 'two' } }],
    });
    const batch = await collaboration.sync('board-a', { after: first }, LOCAL_ACTOR);
    expect(batch.reset).toBe(false);
    expect(batch.events).toHaveLength(1);
    expect(batch.events[0]).toMatchObject({
      revision: 2,
      cursor: batch.cursor,
      units: [{ id: 'one', after: { text: 'two' } }],
    });
    expect((await collaboration.sync('board-b', { after: first }, LOCAL_ACTOR)).events).toEqual([]);
    expect(
      (await collaboration.sync('board-a', { after: 'another-process:0' }, LOCAL_ACTOR)).reset,
    ).toBe(true);

    for (let index = 0; index < 513; index++) {
      collaboration.emit({ type: 'feedback', artifactId: 'board-a' });
    }

    expect((await collaboration.sync('board-a', { after: first }, LOCAL_ACTOR)).reset).toBe(true);
    const watermark = collaboration.cursor();
    collaboration.emit({
      type: 'room',
      artifactId: 'board-a',
      expiresAt: Date.now() - 1,
      events: [],
    });
    expect((await collaboration.sync('board-a', { after: watermark }, LOCAL_ACTOR)).events).toEqual(
      [],
    );
  });

  it('wakes bounded waits on a change, returns an empty timeout and removes aborted waits', async () => {
    const collaboration = create();
    const after = collaboration.cursor();
    const waiting = collaboration.sync('board-a', { after, wait: 1000 }, LOCAL_ACTOR);
    collaboration.emit({ type: 'feedback', artifactId: 'board-a' });
    expect((await waiting).events).toHaveLength(1);
    expect(
      (await collaboration.sync('board-a', { after: collaboration.cursor(), wait: 5 }, LOCAL_ACTOR))
        .events,
    ).toEqual([]);
    const abort = new AbortController();
    const pending = collaboration.sync(
      'board-a',
      { after: collaboration.cursor(), wait: 20_000, signal: abort.signal },
      LOCAL_ACTOR,
    );
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      collaboration.sync('board-a', { wait: 20_001 }, LOCAL_ACTOR),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('also bounds replay by bytes and leaves oversized content as an invalidation', async () => {
    const collaboration = create();
    const after = collaboration.cursor();
    for (let index = 0; index < 20; index++) {
      collaboration.emit({
        type: 'board',
        artifactId: 'board-a',
        units: [{ id: 'item', after: { text: 'x'.repeat(70_000) } }],
      });
    }

    expect((await collaboration.sync('board-a', { after }, LOCAL_ACTOR)).reset).toBe(true);
    const cursor = collaboration.cursor();
    collaboration.emit({
      type: 'board',
      artifactId: 'board-a',
      revision: 30,
      units: [{ id: 'item', after: { text: 'x'.repeat(150_000) } }],
    });
    const batch = await collaboration.sync('board-a', { after: cursor }, LOCAL_ACTOR);
    expect(batch.events).toHaveLength(1);
    expect(batch.events[0]).toMatchObject({
      type: 'board',
      revision: 30,
      invalidation: true,
      changedIds: ['item'],
    });
    expect(batch.events[0]!.units).toBeUndefined();
    const patchCursor = collaboration.cursor();
    collaboration.emit({
      type: 'board',
      artifactId: 'board-a',
      revision: 31,
      units: [
        {
          id: 'item',
          patch: {
            baseVersion: 1,
            version: 2,
            changes: { html: 'h'.repeat(150_000) },
            removedKeys: [],
          },
        },
      ],
    });
    const patched = await collaboration.sync('board-a', { after: patchCursor }, LOCAL_ACTOR);
    expect(patched.events[0]).toMatchObject({
      revision: 31,
      invalidation: true,
      changedIds: ['item'],
    });
    expect(patched.events[0]!.units).toBeUndefined();
  });

  it('keeps modern peer state monotonic and cursor:null clears only the cursor', async () => {
    const collaboration = create();
    const base = { peerId: 'tab-a', peerEpoch: 'epoch-a' };
    await collaboration.update(
      'board-a',
      { ...base, peerSeq: 2, cursor: { x: 20, y: 30, t: Date.now() + 1_000_000 }, actor: viewer },
      editor,
    );
    const stale = await collaboration.update(
      'board-a',
      { ...base, peerSeq: 1, cursor: { x: 1, y: 1 } },
      editor,
    );
    expect(stale.accepted).toBe(false);
    expect(stale.peers[0]).toMatchObject({ actor: editor, cursor: { x: 20, y: 30 }, peerSeq: 2 });
    expect(stale.peers[0]!.cursor!.t).toBeLessThanOrEqual(Date.now());
    await expect(
      collaboration.update('board-a', { peerId: 'tab-a', cursor: { x: 0, y: 0 } }, editor),
    ).rejects.toMatchObject({ code: 'STALE_PEER' });
    await expect(
      collaboration.update('board-a', { ...base, peerSeq: 3 }, viewer),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await collaboration.update(
      'board-a',
      { ...base, peerSeq: 3, cursor: null, visible: false },
      editor,
    );
    expect(collaboration.getPresence('board-a')).toMatchObject([
      { peerId: 'tab-a', actor: editor, cursor: null, visible: false },
    ]);
    await collaboration.update(
      'board-a',
      { peerId: 'tab-b', peerEpoch: 'epoch-b', peerSeq: 0 },
      editor,
    );
    expect(collaboration.getPresence('board-a')).toHaveLength(2);
  });

  it.each(['viewer', 'commenter', 'editor', 'owner'] as const)(
    'normalizes advertised edit activity using the server %s role while retaining ordinary presence',
    async (role) => {
      const collaboration = create();
      const actor: Actor = { id: `role-${role}`, name: role, kind: 'human', role };
      const context = {
        artifactId: 'board-a',
        viewId: 'role-page',
        selectedIds: ['shape'],
        editingIds: ['shape'],
        movingIds: ['shape'],
        savingIds: ['shape'],
        dirty: true,
        viewport: { x: 1, y: 2, zoom: 1 },
      };
      const result = await collaboration.update(
        'board-a',
        {
          peerId: 'role-page',
          context,
          cursor: { x: 20, y: 30 },
          actor: { ...actor, role: 'owner' },
        },
        actor,
      );
      const allowed = ['editor', 'owner'].includes(role);
      const ids = allowed ? ['shape'] : [];
      expect(result.peers[0]).toMatchObject({
        actor,
        context: { ...context, editingIds: ids, movingIds: ids, savingIds: ids },
        cursor: { x: 20, y: 30 },
      });
      expect(context.editingIds).toEqual(['shape']);
    },
  );

  it.each(['viewer', 'commenter'] as const)(
    'drops inherited editor activity after fresh %s authorization even on a cursor-only update',
    async (role) => {
      const collaboration = create();
      const actor: Actor = { ...editor, id: 'downgraded-member' };
      await collaboration.update(
        'board-a',
        {
          peerId: 'retained-page',
          context: {
            artifactId: 'board-a',
            viewId: 'retained-page',
            selectedIds: ['shape'],
            editingIds: ['shape'],
            movingIds: ['shape'],
            savingIds: ['shape'],
          },
        },
        actor,
      );
      const result = await collaboration.update(
        'board-a',
        { peerId: 'retained-page', cursor: { x: 40, y: 50 } },
        actor,
        async () => ({ ...actor, role }),
      );
      expect(result.peers[0]).toMatchObject({
        actor: { id: actor.id, role },
        context: { selectedIds: ['shape'], editingIds: [], movingIds: [], savingIds: [] },
        cursor: { x: 40, y: 50 },
      });
    },
  );

  it('validates read-only edit activity fields before normalizing them', async () => {
    const collaboration = create();
    for (const field of ['editingIds', 'movingIds', 'savingIds']) {
      await expect(
        collaboration.update(
          'board-a',
          {
            peerId: `invalid-${field}`,
            context: {
              artifactId: 'board-a',
              viewId: 'invalid',
              selectedIds: [],
              [field]: 'not-an-array',
            },
          },
          viewer,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }

    expect(collaboration.getPresence('board-a')).toEqual([]);
  });

  it('retains all selected, moving and saving IDs when one view repeats a large selection', async () => {
    const collaboration = create();
    const ids = Array.from({ length: 87 }, (_, index) => `architecture-fixture-${index}`);
    const context = {
      artifactId: 'board-a',
      viewId: 'bulk-page',
      selectedIds: ids,
      movingIds: ids,
      savingIds: ids,
      issues: [{ type: 'saving', message: '等待保存确认。', ids }],
    };

    expect(Buffer.byteLength(JSON.stringify(context))).toBeGreaterThan(8 * 1024);

    const result = await collaboration.update('board-a', { peerId: 'bulk-page', context }, editor);
    expect(result.peers[0]?.context).toEqual(context);
    expect(collaboration.getPresence('board-a')[0]?.context).toEqual(context);
  });

  it('rejects excess distinct context data and oversized repeated requests without replacing presence', async () => {
    const collaboration = create();
    const context = { artifactId: 'board-a', viewId: 'bulk-page', selectedIds: ['original'] };
    await collaboration.update('board-a', { peerId: 'bulk-page', context }, editor);

    const distinctIds = Array.from({ length: 87 }, (_, index) => `unit-${index}-${'a'.repeat(80)}`);
    await expect(
      collaboration.update(
        'board-a',
        { peerId: 'bulk-page', context: { ...context, movingIds: distinctIds } },
        editor,
      ),
    ).rejects.toMatchObject({ code: 'TOO_LARGE', message: '视图上下文超过 6 KiB。' });

    const repeatedIds = Array.from({ length: 87 }, (_, index) => `architecture-fixture-${index}`);
    await expect(
      collaboration.update(
        'board-a',
        {
          peerId: 'bulk-page',
          context: {
            ...context,
            selectedIds: repeatedIds,
            movingIds: repeatedIds,
            savingIds: repeatedIds,
            issues: Array.from({ length: 5 }, () => ({
              type: 'saving',
              message: '等待保存确认。',
              ids: repeatedIds,
            })),
          },
        },
        editor,
      ),
    ).rejects.toMatchObject({ code: 'TOO_LARGE', message: '在线状态过大。' });

    expect(collaboration.getPresence('board-a')[0]?.context).toEqual(context);
  });

  it('gives disconnected streams a grace period, renews RPC leases and rejects old-epoch leave', async () => {
    vi.useFakeTimers();
    const collaboration = create();
    const base = { peerId: 'tab-a', peerEpoch: 'epoch-a', peerSeq: 0 };
    await collaboration.update('board-a', base, editor);
    const release = collaboration.connectPeer('board-a', 'tab-a', 'epoch-a', editor);
    release();
    await vi.advanceTimersByTimeAsync(3999);
    expect(collaboration.getPresence('board-a')).toHaveLength(1);
    await collaboration.sync('board-a', { peerId: 'tab-a', peerEpoch: 'epoch-a' }, editor);
    await vi.advanceTimersByTimeAsync(2);
    expect(collaboration.getPresence('board-a')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(collaboration.getPresence('board-a')).toEqual([]);
    await collaboration.sync('board-a', { peerId: 'tab-a', peerEpoch: 'epoch-new' }, editor);
    await collaboration.update('board-a', { ...base, peerEpoch: 'epoch-new', peerSeq: 0 }, editor);
    await expect(
      collaboration.update('board-a', { ...base, peerSeq: 1, leave: true }, editor),
    ).rejects.toMatchObject({ code: 'STALE_PEER' });
    expect(collaboration.getPresence('board-a')).toMatchObject([{ peerEpoch: 'epoch-new' }]);
    const events: StudioEvent[] = [];
    collaboration.subscribe('board-a', (event) => events.push(event));
    const close = collaboration.connectPeer('board-a', 'tab-a', 'epoch-new', editor);
    close();
    await vi.advanceTimersByTimeAsync(4000);
    expect(collaboration.getPresence('board-a')).toEqual([]);
    expect(events.at(-1)).toMatchObject({ type: 'presence', peers: [] });
  });

  it('bounds room traffic, preserves ordered parts, prioritizes end and enforces roles without touching content', () => {
    const collaboration = create();
    const events: StudioEvent[] = [];
    collaboration.subscribe('board-a', (event) => events.push(event));
    const base = { peerId: 'tab-a', peerEpoch: 'epoch-a' };
    const frame = (seq: number, phase = 'parts') => ({
      topic: 'gesture',
      data: { id: 'drag-a', seq, phase, atoms: [] },
    });
    expect(
      collaboration.room(
        'board-a',
        { ...base, peerSeq: 0, events: [frame(1, 'start'), frame(2), frame(3), frame(4, 'end')] },
        editor,
      ).accepted,
    ).toBe(4);
    expect(
      (events[0]!.events as { data: { seq: number } }[]).map((event) => event.data.seq),
    ).toEqual([1, 2, 3, 4]);
    expect(
      collaboration.room('board-a', { ...base, peerSeq: 1, events: [frame(3, 'step')] }, editor)
        .accepted,
    ).toBe(0);
    expect(
      collaboration.room('board-a', { ...base, peerSeq: 0, events: [frame(100, 'end')] }, editor)
        .accepted,
    ).toBe(0);
    expect(() =>
      collaboration.room('board-a', { peerId: 'view', events: [frame(1)] }, viewer),
    ).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(
      collaboration.room(
        'board-a',
        { peerId: 'view', events: [{ topic: 'follow', data: { of: 'tab-a' } }] },
        viewer,
      ).accepted,
    ).toBe(1);
    const many = Array.from({ length: 80 }, (_, index) => ({
      topic: 'gesture',
      data: { id: 'drag-b', seq: index, phase: 'step' },
    }));
    const overloaded = collaboration.room('board-a', { ...base, peerSeq: 2, events: many }, editor);
    expect(overloaded.dropped).toBeGreaterThan(0);
    expect(
      collaboration.room(
        'board-a',
        {
          ...base,
          peerSeq: 3,
          events: [{ topic: 'gesture', data: { id: 'drag-b', seq: 100, phase: 'end' } }],
        },
        editor,
      ).accepted,
    ).toBe(1);
  });

  it.each(['room', 'presence'])(
    'does not reserve peer capacity for rejected %s input',
    async (kind) => {
      const collaboration = create();
      for (let index = 0; index < 128; index++) {
        const peerId = `rejected-${index}`;
        if (kind === 'room') {
          expect(() =>
            collaboration.room(
              'board-a',
              {
                peerId,
                events: [{ topic: 'gesture', data: { id: 'drag-a', seq: 0, phase: 'start' } }],
              },
              viewer,
            ),
          ).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
        } else {
          await expect(
            collaboration.update(
              'board-a',
              { peerId, context: { artifactId: 'other-board', viewId: peerId, selectedIds: [] } },
              viewer,
            ),
          ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
        }
      }

      expect(collaboration.getPresence('board-a')).toEqual([]);
      expect(
        (await collaboration.update('board-a', { peerId: 'owner' }, LOCAL_ACTOR)).accepted,
      ).toBe(true);
    },
  );

  it('aggregates independent server-registered agents and cannot create their peers through public presence', async () => {
    vi.useFakeTimers();
    const collaboration = create();
    const agent = { ...LOCAL_ACTOR, id: 'model-one', kind: 'agent' as const };
    const endRead = collaboration.beginActivity('board-a', agent, {
      status: 'reading',
      selectedIds: ['a'],
    });
    const endWrite = collaboration.beginActivity('board-a', agent, {
      status: 'writing',
      editingIds: ['b'],
    });
    collaboration.beginActivity('board-a', { ...agent, id: 'model-two' }, { status: 'reading' });
    expect(collaboration.getPresence('board-a')).toHaveLength(2);
    expect(collaboration.getPresence('board-a')[0]).toMatchObject({
      actor: agent,
      context: { activity: 'writing', editingIds: ['b'], selectedIds: ['a'] },
    });
    endRead();
    expect(collaboration.getPresence('board-a')[0]).toMatchObject({
      context: { activity: 'writing' },
    });
    endWrite();
    expect(collaboration.getPresence('board-a')).toHaveLength(2);
    expect(collaboration.getPresence('board-a')[0]).toMatchObject({
      context: { activity: 'idle', lastActivity: 'writing', editingIds: [], movingIds: [] },
    });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(collaboration.getPresence('board-a')).toHaveLength(2);
    const endNew = collaboration.beginActivity('board-a', agent, {
      status: 'writing',
      editingIds: ['c'],
    });
    endWrite();
    await vi.advanceTimersByTimeAsync(20_001);
    expect(collaboration.getPresence('board-a')[0]).toMatchObject({
      context: { activity: 'writing', editingIds: ['c'] },
    });
    endNew();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(collaboration.getPresence('board-a')).toHaveLength(1);
    await expect(
      collaboration.update('board-a', { peerId: 'agent-model-two' }, LOCAL_ACTOR),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('releases bounded room capacity after finished agent idle leases expire', async () => {
    vi.useFakeTimers();
    const collaboration = create();
    for (let index = 0; index < 128; index++) {
      collaboration.beginActivity(
        'board-a',
        { ...LOCAL_ACTOR, id: `model-${index}`, kind: 'agent' },
        { status: 'reading' },
      )();
    }

    expect(collaboration.getPresence('board-a')).toHaveLength(128);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(collaboration.getPresence('board-a')).toEqual([]);
    expect((await collaboration.update('board-a', { peerId: 'human' }, editor)).accepted).toBe(
      true,
    );
  });
});

describe('durable server-computed room timers', () => {
  it('keeps a corrupt timer observable without publishing a peer that would later fail in a background expiry', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studio-room-timer-corrupt-'));
    folders.push(directory);
    const folder = join(directory, 'artifacts', 'board-a');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'room-timer.json'), '{broken');
    vi.useFakeTimers();
    const collaboration = create(directory);
    await expect(
      collaboration.update('board-a', { peerId: 'tab-a' }, editor),
    ).rejects.toMatchObject({ code: 'CORRUPT_TIMER' });
    expect(collaboration.getPresence('board-a')).toEqual([]);
    await vi.advanceTimersByTimeAsync(46_000);
    expect(await readFile(join(folder, 'room-timer.json'), 'utf8')).toBe('{broken');
  });

  it('persists actions, accumulates simultaneous adjustments and restores the absolute deadline after restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studio-room-timer-'));
    folders.push(directory);
    const collaboration = create(directory);
    const now = Date.now();
    const time = vi.spyOn(Date, 'now').mockReturnValue(now);
    await collaboration.update(
      'board-a',
      { timer: { action: 'start', durationSeconds: 60 } },
      editor,
    );
    await Promise.all([
      collaboration.update('board-a', { timer: { action: 'adjust', deltaSeconds: 60 } }, editor),
      collaboration.update('board-a', { timer: { action: 'adjust', deltaSeconds: 60 } }, editor),
    ]);
    expect(collaboration.getTimer('board-a')).toMatchObject({
      deadline: now + 180_000,
      remainingMs: 180_000,
    });
    const persisted = await readFile(
      join(directory, 'artifacts', 'board-a', 'room-timer.json'),
      'utf8',
    );
    collaboration.close();
    time.mockReturnValue(now + 30_000);
    const restarted = create(directory);
    expect(restarted.getTimer('board-a')).toMatchObject({
      deadline: now + 180_000,
      remainingMs: 150_000,
    });
    time.mockReturnValue(now + 40_000);
    restarted.getTimer('board-a');
    expect(await readFile(join(directory, 'artifacts', 'board-a', 'room-timer.json'), 'utf8')).toBe(
      persisted,
    );
    await expect(
      restarted.update('board-a', { timer: { action: 'pause' } }, viewer),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(restarted.getTimer('board-a')).toMatchObject({ deadline: now + 180_000 });
  });
});
