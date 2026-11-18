import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { StudioService } from '../src/core/service.js';
import { AGENT_TASK_LEASE_MS, AGENT_TASK_STALE_MS, LOCAL_ACTOR, type Actor, type AgentActivityScope, type AgentTask, type AgentTaskBinding, type Board, type Operation } from '../src/contracts/studio.js';

const first: Actor = { id: 'workspace-first', name: 'First agent', kind: 'agent', role: 'owner' };
const second: Actor = { id: 'workspace-second', name: 'Second agent', kind: 'agent', role: 'owner' };
let directory: string, service: StudioService, artifactId: string;
const services: StudioService[] = [];

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function until(check: () => boolean, label: string) {
  for (let attempt = 0; attempt < 100; attempt++) { if (check()) return; await delay(10); }
  throw new Error(`Timed out waiting for ${label}`);
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'studio-workspace-adversarial-'));
  service = new StudioService({ dataRoot: directory }); services.push(service);
  const created = await service.execute('artifact_manage', { action: 'create', elements: [
    { id: 'a', type: 'text', text: 'First', x: 10, y: 10, w: 100, h: 80 },
    { id: 'b', type: 'text', text: 'Second', x: 510, y: 10, w: 100, h: 80 },
    { id: 'html', type: 'html', html: '<p>Original</p>', x: 1010, y: 10, w: 200, h: 150 },
  ] }); artifactId = created.artifact.id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const current of services.splice(0)) await current.close();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected workspace fixture directory');
  await rm(directory, { recursive: true, force: true });
});
const read = () => service.execute('artifact_read', { artifactId }) as Promise<Board>;
const bytes = () => readFile(service.store.file(artifactId));
const binding = ({ taskId, generation }: AgentTaskBinding) => ({ taskId, generation });
async function begin(taskId: string, scope: AgentActivityScope, actor = first, extra: Record<string, unknown> = {}): Promise<AgentTask> {
  const result = await service.execute('artifact_activity', { artifactId, action: 'begin', taskId, phase: 'preparing', scope, ...extra }, actor);
  const task = (result.tasks as AgentTask[]).find(value => value.taskId === taskId);
  expect(task, 'begin must return its active task').toBeDefined(); return task!;
}
async function tasks(actor = first): Promise<AgentTask[]> { return (await service.execute('artifact_activity', { artifactId, action: 'status' }, actor)).tasks; }
const activity = (task: AgentTaskBinding, action: string, extra: Record<string, unknown> = {}, actor = first) => service.execute('artifact_activity', { artifactId, action, ...binding(task), ...extra }, actor);
const release = (task: AgentTaskBinding, actor = first) => service.execute('artifact_activity', { artifactId, action: 'release', targetActorId: actor.id, ...binding(task) }, LOCAL_ACTOR);
async function mutate(operations: Operation[], actor = LOCAL_ACTOR, extra: Record<string, unknown> = {}) {
  const current = await read();
  return service.execute('artifact_apply', { artifactId, operationId: randomUUID(), expectedRevision: current.artifact.revision, operations, ...extra }, actor);
}
const changeA: Operation[] = [{ op: 'update', id: 'a', changes: { text: 'Agent update' } }];

describe('agent workspace adversarial service boundaries', () => {
  it('rejects an unbound content write without creating history or receipts', async () => {
    const before = await bytes();
    await expect(mutate(changeA, first)).rejects.toMatchObject({ code: 'TASK_REQUIRED' });
    expect(await bytes()).toEqual(before);
  });

  it('revokes a queued generation before the real artifact lock opens and confirms only after the barrier', async () => {
    const task = await begin('queued', { ids: ['a'] }), before = await bytes();
    const entered = deferred(), unlock = deferred();
    const held = service.store.withProjectionLock(artifactId, state => state.artifact.id, async () => { entered.resolve(); await unlock.promise; });
    await entered.promise;
    const queued = mutate(changeA, first, binding(task)).then(value => ({ value }), error => ({ error }));
    let released = false;
    try {
      await until(() => service.getPresence(artifactId).some(peer => peer.actor.id === first.id && (peer.context?.editingIds?.includes('a') || peer.context?.activity === 'writing')), 'the queued agent write');
      const ending = release(task).then(value => { released = true; return { value }; }, error => ({ error }));
      await until(() => !service.getPresence(artifactId).some(peer => peer.context?.agentTasks?.some(value => value.generation === task.generation && value.endedAt === undefined)), 'generation revocation');
      expect(released, 'release must wait for the ordinary store lock').toBe(false);
      unlock.resolve(); await held; expect(await ending).not.toHaveProperty('error');
      expect(await queued).toMatchObject({ error: { code: 'TASK_CLOSED' } });
      expect(await bytes()).toEqual(before);
      await expect(mutate(changeA, first, binding(task))).rejects.toMatchObject({ code: 'TASK_CLOSED' });
      expect(await bytes()).toEqual(before);
    } finally { unlock.resolve(); await held; await queued; }
  });

  it('waits for a save already inside the commit lock before acknowledging human release', async () => {
    const task = await begin('committing', { ids: ['a'] }), entered = deferred(), save = deferred();
    const transaction = service.store.transaction.bind(service.store);
    vi.spyOn(service.store, 'transaction').mockImplementationOnce((id, run) => transaction(id, async state => {
      const result = await run(state);
      entered.resolve(); await save.promise;
      return result;
    }));
    const committing = mutate(changeA, first, binding(task)).then(value => ({ value }), error => ({ error }));
    await entered.promise;
    let acknowledged = false;
    const ending = release(task).then(value => { acknowledged = true; return { value }; }, error => ({ error }));
    try {
      await until(() => !service.getPresence(artifactId).some(peer => peer.context?.agentTasks?.some(value => value.generation === task.generation && value.endedAt === undefined)), 'in-flight generation revocation');
      expect(acknowledged).toBe(false);
      save.resolve(); expect(await committing).not.toHaveProperty('error'); expect(await ending).not.toHaveProperty('error');
      expect((await read()).elements.find(value => value.id === 'a')?.text).toBe('Agent update');
      const confirmed = await bytes();
      await expect(mutate(changeA, first, binding(task))).rejects.toMatchObject({ code: 'TASK_CLOSED' });
      expect(await bytes()).toEqual(confirmed);
    } finally { save.resolve(); await committing.catch(() => {}); await ending.catch(() => {}); }
  });

  it('separates expired generations from old end, update and content packets', async () => {
    const now = Date.now(), time = vi.spyOn(Date, 'now').mockReturnValue(now);
    const old = await begin('expiry-renewal', { ids: ['a'] });
    time.mockReturnValue(now + AGENT_TASK_LEASE_MS + 1);
    await service.execute('artifact_read', { artifactId }, first);
    const current = await begin(old.taskId, { ids: ['a'] }, first, { generation: old.generation });
    expect(current.generation).toEqual(expect.any(String)); expect(current.generation).not.toBe(old.generation);
    for (const action of ['end', 'update']) await expect(activity(old, action)).rejects.toMatchObject({ code: 'TASK_STALE' });
    await expect(mutate(changeA, first, binding(old))).rejects.toMatchObject({ code: 'TASK_STALE' });
    expect(await tasks()).toEqual([current]);
    await mutate(changeA, first, binding(current));
  });

  it('ends one same-actor task without clearing the other and rejects late begin resurrection', async () => {
    const a = await begin('parallel-a', { ids: ['a'] }), b = await begin('parallel-b', { ids: ['b'] });
    await activity(a, 'end', { outcome: 'completed' });
    expect(await tasks()).toEqual([b]);
    await expect(begin(a.taskId, a.scope)).rejects.toMatchObject({ code: 'TASK_CLOSED' });
    await mutate([{ op: 'update', id: 'b', changes: { text: 'Still authorized' } }], first, binding(b));
    expect((await tasks()).map(value => value.taskId)).toEqual([b.taskId]);
    await service.execute('artifact_read', { artifactId }, first);
    const resumed = await begin(a.taskId, a.scope, first, { generation: a.generation });
    expect(resumed.generation).not.toBe(a.generation);
    for (const action of ['end', 'update']) await expect(activity(a, action)).rejects.toMatchObject({ code: 'TASK_STALE' });
    expect((await tasks()).map(value => value.taskId).sort()).toEqual([b.taskId, resumed.taskId].sort());
  });

  it('does not let a late read completion refresh a replacement generation', async () => {
    const now = Date.now(), time = vi.spyOn(Date, 'now').mockReturnValue(now);
    const old = await begin('late-read', { ids: ['a'] }), entered = deferred(), finish = deferred();
    const realRead = service.store.readProjection.bind(service.store);
    vi.spyOn(service.store, 'readProjection').mockImplementationOnce(realRead).mockImplementationOnce(async (id, pick, options) => {
      entered.resolve(); await finish.promise;
      return realRead(id, pick, options);
    });
    const reading = service.execute('artifact_read', { artifactId, ...binding(old) }, first).then(value => ({ value }), error => ({ error }));
    await entered.promise;
    try {
      expect(service.getPresence(artifactId).find(peer => peer.actor.id === first.id)?.context?.activity).toBe('reading');
      time.mockReturnValue(now + AGENT_TASK_LEASE_MS + 1);
      await service.execute('artifact_read', { artifactId }, first);
      const current = await begin(old.taskId, old.scope, first, { generation: old.generation });
      time.mockReturnValue(now + AGENT_TASK_LEASE_MS + 60_000);
      finish.resolve(); await reading;
      expect(await tasks()).toEqual([current]);
      expect(service.getPresence(artifactId).find(peer => peer.actor.id === first.id)?.context?.agentTasks).toContainEqual(current);
    } finally { finish.resolve(); await reading; }
  });

  it('cannot authorize an old generation after a service restart or use its end against the new one', async () => {
    const old = await begin('restart', { ids: ['a'] }); await service.close();
    service = new StudioService({ dataRoot: directory }); services.push(service);
    await expect(mutate(changeA, first, binding(old))).rejects.toMatchObject({ code: 'TASK_STALE' });
    await expect(begin(old.taskId, old.scope, first, { generation: old.generation })).rejects.toMatchObject({ code: 'TASK_STALE' });
    await service.execute('artifact_read', { artifactId }, first);
    const current = await begin(`${old.taskId}-new`, old.scope);
    expect(current.generation).not.toBe(old.generation);
    await expect(activity(old, 'end')).rejects.toMatchObject({ code: 'TASK_STALE' });
    expect(await tasks()).toEqual([current]);
  });

  it('keeps work for more than 60 seconds and renews relevant reads without fabricating progress', async () => {
    const now = Date.now(), time = vi.spyOn(Date, 'now').mockReturnValue(now);
    const task = await begin('time-boundaries', { ids: ['a'] });
    expect(task).toMatchObject({ phase: 'preparing', startedAt: now, lastActivityAt: now, lastProgressAt: now, expiresAt: now + AGENT_TASK_LEASE_MS });
    time.mockReturnValue(now + 60_001); expect(await tasks()).toEqual([task]);
    time.mockReturnValue(now + AGENT_TASK_STALE_MS + 1);
    await service.execute('artifact_read', { artifactId, mode: 'units', ids: ['a'], atRevision: 0, ...binding(task) }, first);
    const renewed = (await tasks())[0]!;
    expect(renewed).toMatchObject({ generation: task.generation, lastActivityAt: now + AGENT_TASK_STALE_MS + 1, lastProgressAt: now, expiresAt: now + AGENT_TASK_STALE_MS + 1 + AGENT_TASK_LEASE_MS });
    time.mockReturnValue(now + AGENT_TASK_STALE_MS + 2);
    await service.execute('artifact_read', { artifactId }, first);
    expect(await tasks()).toEqual([renewed]);
    await service.execute('artifact_read', { artifactId, mode: 'units', ids: ['b'], atRevision: 0, ...binding(task) }, first);
    expect(await tasks()).toEqual([renewed]);
    time.mockReturnValue(renewed.expiresAt); expect(await tasks()).toEqual([]);
    const before = await bytes();
    await expect(mutate(changeA, first, binding(task))).rejects.toMatchObject({ code: 'TASK_STALE' }); expect(await bytes()).toEqual(before);
  });

  it('counts a real phase transition as progress while an unchanged update only renews activity', async () => {
    const now = Date.now(), time = vi.spyOn(Date, 'now').mockReturnValue(now), task = await begin('phase', { ids: ['a'] });
    time.mockReturnValue(now + 1000); await activity(task, 'update', { phase: 'preparing' });
    expect((await tasks())[0]).toMatchObject({ lastActivityAt: now + 1000, lastProgressAt: now });
    time.mockReturnValue(now + 2000); await activity(task, 'update', { phase: 'writing' });
    expect((await tasks())[0]).toMatchObject({ phase: 'writing', lastActivityAt: now + 2000, lastProgressAt: now + 2000 });
    time.mockReturnValue(now + 3000); await activity(task, 'update', { phase: 'writing' });
    expect((await tasks())[0]).toMatchObject({ lastActivityAt: now + 3000, lastProgressAt: now + 2000 });
    time.mockReturnValue(now + 4000); await mutate(changeA, first, binding(task));
    expect((await tasks())[0]).toMatchObject({ lastActivityAt: now + 4000, lastProgressAt: now + 4000 });
  });

  it.each([
    [{ ids: ['a'] }, { ids: ['a'] }],
    [{ ids: ['a'] }, { rect: { x: 0, y: 0, w: 200, h: 200 } }],
    [{ rect: { x: 0, y: 0, w: 200, h: 200 } }, { rect: { x: 100, y: 100, w: 200, h: 200 } }],
    [{ ids: ['html'] }, { ids: ['html'] }],
  ] satisfies [AgentActivityScope, AgentActivityScope][])('rejects intersecting task reservations %#', async (left, right) => {
    await begin('left', left);
    await expect(begin('right', right, second)).rejects.toMatchObject({ code: 'TASK_SCOPE_CONFLICT' });
  });

  it('permits independent work in the unclaimed gap between two explicitly owned objects', async () => {
    await begin('separated-ids', { ids: ['a', 'html'] });
    const task = await begin('unclaimed-gap', { ids: ['b'] }, second);
    await mutate([{ op: 'update', id: 'b', changes: { text: 'Independent gap work' } }], second, binding(task));
    expect((await read()).elements.find(value => value.id === 'b')?.text).toBe('Independent gap work');
  });

  it('checks current geometry after a human moves an owned object into another task', async () => {
    const task = await begin('moving-a', { ids: ['a'] }); await begin('reserved-b', { ids: ['b'] }, second);
    await mutate([{ op: 'update', id: 'a', changes: { x: 510 } }]);
    const before = await bytes();
    await expect(mutate(changeA, first, binding(task))).rejects.toMatchObject({ code: 'TASK_SCOPE_CONFLICT' });
    expect(await bytes()).toEqual(before);
  });

  it.each([
    { id: 'ink', type: 'stroke', x: 10, y: 10, w: 5, h: 5, points: [0, 0, 600, 0] },
    { id: 'connector', type: 'arrow', x: 10, y: 10, w: 5, h: 5, from: [10, 10], to: [190, 10], bends: [100, 600] },
  ] as const)('checks the actual $type path instead of its declared box', async element => {
    const task = await begin('path', { rect: { x: 0, y: 0, w: 200, h: 200 } }), before = await bytes();
    await expect(mutate([{ op: 'add', element: structuredClone(element) as unknown as Operation['element'] }], first, binding(task))).rejects.toMatchObject({ code: 'TASK_SCOPE' });
    expect(await bytes()).toEqual(before);
  });

  it('does not let a parent or group field authorize a new object outside explicit ids', async () => {
    const task = await begin('explicit-id', { ids: ['a'] }), before = await bytes();
    await expect(mutate([{ op: 'add', element: { id: 'child', type: 'text', x: 800, y: 800, w: 50, h: 50, parentId: 'a', groupId: 'a' } }], first, binding(task))).rejects.toMatchObject({ code: 'TASK_SCOPE' });
    expect(await bytes()).toEqual(before);
  });

  it('checks cascaded descendants of a delete instead of only its explicit target', async () => {
    await mutate([{ op: 'add', element: { id: 'child', type: 'text', parentId: 'a', x: 800, y: 800, w: 50, h: 50 } }]);
    const task = await begin('parent-delete', { ids: ['a'] }), before = await bytes();
    await expect(mutate([{ op: 'delete', id: 'a' }], first, binding(task))).rejects.toMatchObject({ code: 'TASK_SCOPE' });
    expect(await bytes()).toEqual(before);
  });

  it('includes implicitly changed bound-arrow geometry when moving an endpoint', async () => {
    await mutate([{ op: 'add', element: { id: 'connector', type: 'arrow', from: 'a', to: 'b', x: 0, y: 0, w: 1, h: 1 } }]);
    const task = await begin('endpoint-only', { ids: ['a'] }), before = await bytes();
    const move: Operation[] = [{ op: 'update', id: 'a', changes: { x: 30 } }];
    await expect(mutate(move, first, binding(task))).rejects.toMatchObject({ code: 'TASK_SCOPE' });
    expect(await bytes()).toEqual(before);
    await activity(task, 'end');
    const complete = await begin('endpoint-and-arrow', { ids: ['a', 'connector'] });
    await mutate(move, first, binding(complete));
    expect((await read()).elements.find(value => value.id === 'a')?.x).toBe(30);
  });

  it('rejects a whole batch when one added node escapes the rectangle', async () => {
    const task = await begin('batch', { rect: { x: 0, y: 0, w: 200, h: 200 } }), before = await bytes();
    await expect(mutate([
      { op: 'add', element: { id: 'inside', type: 'text', x: 120, y: 120, w: 20, h: 20 } },
      { op: 'add', element: { id: 'outside', type: 'text', x: 900, y: 900, w: 20, h: 20 } },
    ], first, binding(task))).rejects.toMatchObject({ code: 'TASK_SCOPE' });
    expect(await bytes()).toEqual(before);
    await mutate([{ op: 'add', element: { id: 'inside', type: 'text', x: 120, y: 120, w: 20, h: 20 } }], first, binding(task));
    expect((await read()).elements.find(value => value.id === 'inside')).toMatchObject({ x: 120, y: 120, w: 20, h: 20 });
  });

  it('does not infer whole-board authority from a global operation with no object targets', async () => {
    const task = await begin('local-style', { ids: ['a'] }), before = await bytes();
    await expect(mutate([{ op: 'style', style: { accent: '#ff0000' } }], first, binding(task))).rejects.toMatchObject({ code: 'TASK_SCOPE' });
    expect(await bytes()).toEqual(before);
  });

  it('does not let restoring the order unit reorder objects outside an explicit task', async () => {
    const initial = (await service.execute('artifact_read', { artifactId, mode: 'history' })).history[0].id;
    await mutate([{ op: 'layout', preset: 'front', ids: ['b'] }]);
    const current = await read(), task = await begin('local-order-restore', { ids: ['a'] }), before = await bytes();
    expect(current.elements.map(value => value.id)).toEqual(['a', 'html', 'b']);
    const operations: Operation[] = [{ op: 'restore', versionId: initial, id: '$order' }];
    await expect(mutate(operations, first, { ...binding(task), expectedVersions: { $order: current.orderVersion ?? 0 } })).rejects.toMatchObject({ code: 'TASK_SCOPE' });
    expect(await bytes()).toEqual(before);
    await activity(task, 'end');
    const full = await begin('full-order-restore', { ids: ['a', 'b', 'html'] });
    await mutate(operations, first, { ...binding(full), expectedVersions: { $order: current.orderVersion ?? 0 } });
    expect((await read()).elements.map(value => value.id)).toEqual(['a', 'b', 'html']);
  });

  it('rejects layering an undeclared object while retaining real object and order CAS', async () => {
    artifactId = (await service.execute('artifact_manage', { action: 'create', elements: [
      { id: 'b', type: 'shape', x: 510, y: 10, w: 100, h: 80 },
      { id: 'a', type: 'text', text: 'Owned object', x: 10, y: 10, w: 100, h: 80 },
    ] })).artifact.id;
    const current = await read(), task = await begin('layer-own-a', { ids: ['a'] }), before = await bytes();
    expect(current.elements.map(value => value.id)).toEqual(['b', 'a']);
    const operations: Operation[] = [{ op: 'layout', ids: ['b'], preset: 'front' }];
    const versions = { b: current.elements.find(value => value.id === 'b')!.version, $order: current.orderVersion ?? 0 };
    await expect(mutate(operations, first, { ...binding(task), expectedVersions: versions })).rejects.toMatchObject({ code: 'TASK_SCOPE' });
    expect(await bytes()).toEqual(before);
    await activity(task, 'end');
    const declared = await begin('layer-own-b', { ids: ['b'] });
    const accepted = await mutate(operations, first, { ...binding(declared), expectedVersions: versions });
    expect(accepted.board.elements.map((value: { id: string }) => value.id)).toEqual(['a', 'b']);
    expect(accepted.board.elements.find((value: { id: string }) => value.id === 'b').version).toBe(versions.b + 1);
    expect(accepted.board.orderVersion).toBe(versions.$order + 1);
  });

  it('keeps scope authorization independent of object-version CAS', async () => {
    const task = await begin('cas', { ids: ['a'] });
    await mutate([{ op: 'update', id: 'a', changes: { text: 'Human revision' } }]);
    const before = await bytes();
    await expect(mutate(changeA, first, { ...binding(task), expectedVersions: { a: 1 }, expectedRevision: undefined })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await bytes()).toEqual(before);
    await expect(mutate([{ op: 'update', id: 'b', changes: { text: 'Out of scope' } }], first, { ...binding(task), expectedVersions: { b: 1 } })).rejects.toMatchObject({ code: 'TASK_SCOPE' });
    expect(await bytes()).toEqual(before);
  });

  it('returns an ended lease receipt verbatim without a write or renewal and rejects altered reuse', async () => {
    const task = await begin('receipt', { ids: ['a'] });
    const args = { artifactId, operationId: randomUUID(), expectedVersions: { a: 1 }, operations: changeA, ...binding(task) };
    const original = await service.execute('artifact_apply', args, first); await activity(task, 'end');
    const before = await bytes();
    const writes = vi.spyOn(service.store, 'transaction');
    expect(await service.execute('artifact_apply', args, first)).toEqual(original);
    expect(await bytes()).toEqual(before); expect(await tasks()).toEqual([]); expect(writes).not.toHaveBeenCalled();
    await expect(service.execute('artifact_apply', { ...args, operations: [{ op: 'update', id: 'a', changes: { text: 'Altered payload' } }] }, first)).rejects.toMatchObject({ code: 'OPERATION_REUSED' });
    expect(await bytes()).toEqual(before); expect(writes).not.toHaveBeenCalled();
  });

  it('enforces lease authority for proposal choice and active-option withdrawal content writes', async () => {
    const suggested = await service.execute('artifact_feedback', { artifactId, action: 'suggest', text: 'Private title alternatives', expectedVersions: { html: 1 }, anchor: { regionId: 'html' }, options: [
      { id: 'one', label: 'First', operations: [{ op: 'update', id: 'html', changes: { html: '<h1>First</h1>' } }] },
      { id: 'two', label: 'Second', operations: [{ op: 'update', id: 'html', changes: { html: '<h1>Second</h1>' } }] },
    ] }, first);
    const feedbackId = suggested.feedback[0].id, task = await begin('proposal', { ids: ['html'] });
    const choose = { artifactId, action: 'choose', feedbackId, optionId: 'one', operationId: randomUUID() };
    let before = await bytes();
    await expect(service.execute('artifact_feedback', choose, first)).rejects.toMatchObject({ code: 'TASK_REQUIRED' }); expect(await bytes()).toEqual(before);
    await service.execute('artifact_feedback', { ...choose, ...binding(task) }, first);
    await release(task); before = await bytes();
    for (const action of ['choose', 'withdraw']) await expect(service.execute('artifact_feedback', { artifactId, action, feedbackId, optionId: 'one', operationId: randomUUID(), ...binding(task) }, first)).rejects.toMatchObject({ code: 'TASK_CLOSED' });
    expect(await bytes()).toEqual(before); expect((await read()).elements.find(value => value.id === 'html')?.html).toBe('<h1>First</h1>');
  });

  it.each(['style', 'motion'] as const)('checks whole-board %s authority through proposal choose and withdrawal', async kind => {
    const operation = (variant: number): Operation => kind === 'style' ? { op: 'style', style: { accent: variant === 1 ? '#ff0000' : '#0000ff' } } : { op: 'motion', data: { enabled: variant === 1 } };
    const suggestion = await service.execute('artifact_feedback', { artifactId, action: 'suggest', text: 'Global alternatives', expectedRevision: 0, options: [
      { id: 'one', label: 'First global', operations: [operation(1)] },
      { id: 'two', label: 'Second global', operations: [operation(2)] },
    ] }, first);
    const feedbackId = suggestion.feedback[0].id, task = await begin('local-global-proposal', { ids: ['a'] });
    const choose = { artifactId, action: 'choose', feedbackId, optionId: 'one', operationId: randomUUID() };
    let before = await bytes();
    await expect(service.execute('artifact_feedback', { ...choose, ...binding(task) }, first)).rejects.toMatchObject({ code: 'TASK_SCOPE' });
    expect(await bytes()).toEqual(before);
    await activity(task, 'end');
    const full = await begin('full-global-proposal', { ids: ['a', 'b', 'html'] });
    await service.execute('artifact_feedback', { ...choose, ...binding(full) }, first); await activity(full, 'end');
    const withdraw = await begin('local-global-withdrawal', { ids: ['a'] }); before = await bytes();
    await expect(service.execute('artifact_feedback', { artifactId, action: 'withdraw', feedbackId, optionId: 'one', operationId: randomUUID(), ...binding(withdraw) }, first)).rejects.toMatchObject({ code: 'TASK_SCOPE' });
    expect(await bytes()).toEqual(before);
  });

  it('allows human editing inside a reserved agent region but prevents an agent from releasing another', async () => {
    const task = await begin('human-access', { ids: ['a'] });
    await mutate([{ op: 'update', id: 'a', changes: { text: 'Human edit inside workspace' } }]);
    expect((await read()).elements.find(value => value.id === 'a')?.text).toBe('Human edit inside workspace');
    await expect(service.execute('artifact_activity', { artifactId, action: 'release', targetActorId: first.id, ...binding(task) }, second)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await tasks()).toHaveLength(1);
    await release(task); await service.execute('artifact_read', { artifactId }, first);
    await expect(begin(task.taskId, task.scope)).rejects.toMatchObject({ code: 'TASK_CLOSED' });
    await expect(begin(task.taskId, task.scope, first, { generation: task.generation })).rejects.toMatchObject({ code: 'TASK_CLOSED' });
  });
});
