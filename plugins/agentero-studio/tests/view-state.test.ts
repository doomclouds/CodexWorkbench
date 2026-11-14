import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StudioService } from '../src/core/service.js';
import { StudioCollaboration } from '../src/core/shared/collaboration.js';
import { LOCAL_ACTOR, type Actor, type Board } from '../src/contracts/studio.js';

const agent: Actor = { id: 'codex', name: 'Codex', kind: 'agent', role: 'owner' };
const editor: Actor = { id: 'editor', name: '同事', kind: 'human', role: 'editor' };
const viewer: Actor = { id: 'viewer', name: '旁观者', kind: 'human', role: 'viewer' };
let directory: string, service: StudioService;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'studio-view-state-')); service = new StudioService({ dataRoot: directory }); });
afterEach(async () => { vi.restoreAllMocks(); await service.close(); if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected test directory'); await rm(directory, { recursive: true, force: true }); });
async function create(): Promise<Board> { return (await service.execute('artifact_manage', { action: 'create', elements: [{ id: 'a', type: 'text', text: 'A' }, { id: 'b', type: 'text', text: 'B' }] })).board; }
function operation(board: Board, id = 'a') { return { artifactId: board.artifact.id, operationId: randomUUID(), expectedVersions: { [id]: board.elements.find(element => element.id === id)!.version }, operations: [{ op: 'update', id, changes: { text: '更新' } }] }; }

describe('live view activity and Agent coordination', () => {
  it('preserves each view selection and activity and limits its reported issues', async () => {
    const board = await create(), artifactId = board.artifact.id;
    await service.updatePresence(artifactId, { peerId: 'peer-a', context: { artifactId, viewId: 'view-a', selectedIds: ['a'], editingIds: ['a'], movingIds: [], dirty: true, issues: Array.from({ length: 7 }, (_, index) => ({ type: 'save', message: `保存失败 ${index}`, ids: ['a'] })) } }, editor);
    await service.updatePresence(artifactId, { peerId: 'peer-b', context: { artifactId, viewId: 'view-b', selectedIds: ['b'], editingIds: [], movingIds: ['b'], dirty: false } }, LOCAL_ACTOR);
    const result = await service.execute('artifact_read', { artifactId, mode: 'context', viewId: 'view-a' });
    expect(result.contexts).toHaveLength(1); expect(result.contexts[0]).toMatchObject({ viewId: 'view-a', selectedIds: ['a'], editingIds: ['a'], dirty: true });
    expect(result.contexts[0].issues).toHaveLength(5);
    await expect(service.updatePresence(artifactId, { peerId: 'bad-view', context: { artifactId: 'different', viewId: 'view', selectedIds: [] } }, editor)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
  it('blocks Agent targets being edited, while independent objects and human CAS remain usable', async () => {
    const board = await create(), artifactId = board.artifact.id;
    await service.updatePresence(artifactId, { peerId: 'peer-a', context: { artifactId, viewId: 'view-a', selectedIds: [], editingIds: ['a'] } }, editor);
    await expect(service.execute('artifact_apply', operation(board), agent)).rejects.toMatchObject({ code: 'EDIT_IN_PROGRESS', details: { ids: ['a'] } });
    const independent = await service.execute('artifact_apply', operation(board, 'b'), agent);
    expect(independent.board.elements.find((element: { id: string }) => element.id === 'b').text).toBe('更新');
    const human = await service.execute('artifact_apply', operation(board), LOCAL_ACTOR);
    expect(human.board.elements.find((element: { id: string }) => element.id === 'a').text).toBe('更新');
  });
  it('keeps successful retries idempotent and ignores departed views', async () => {
    const board = await create(), args = operation(board), artifactId = board.artifact.id;
    const first = await service.execute('artifact_apply', args, agent);
    await service.updatePresence(artifactId, { peerId: 'peer-a', context: { artifactId, viewId: 'view-a', selectedIds: [], editingIds: ['a'] } }, editor);
    expect(await service.execute('artifact_apply', args, agent)).toEqual(first);
    await service.updatePresence(artifactId, { peerId: 'peer-a', leave: true }, editor);
    expect(await service.execute('artifact_apply', operation(first.board), agent)).toHaveProperty('board');
  });
  it('does not treat a viewer selection as an editor lock and expires stale editing views', async () => {
    const board = await create(), artifactId = board.artifact.id;
    await service.updatePresence(artifactId, { peerId: 'viewer-a', context: { artifactId, viewId: 'viewer-view', selectedIds: ['a'], editingIds: ['a'] } }, viewer);
    const first = await service.execute('artifact_apply', operation(board), agent);
    await service.updatePresence(artifactId, { peerId: 'editor-a', context: { artifactId, viewId: 'editor-view', selectedIds: [], editingIds: ['a'] } }, editor);
    const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 46_000);
    expect(await service.execute('artifact_apply', operation(first.board), agent)).toHaveProperty('board');
  });
  it('records the processing actor and clears it when a reply or state transition finishes processing', async () => {
    const board = await create(), artifactId = board.artifact.id;
    const created = await service.execute('artifact_feedback', { artifactId, action: 'create', text: '请调整', anchor: { elementIds: ['a'] } });
    const feedbackId = created.feedback[0].id;
    const processing = await service.execute('artifact_feedback', { artifactId, feedbackId, action: 'processing' }, agent);
    expect(processing.feedback[0]).toMatchObject({ status: 'processing', processingBy: agent });
    const replied = await service.execute('artifact_feedback', { artifactId, feedbackId, action: 'reply', text: '已调整' }, agent);
    expect(replied.feedback[0].status).toBe('open'); expect(replied.feedback[0].processingBy).toBeUndefined();
    await service.execute('artifact_feedback', { artifactId, feedbackId, action: 'processing' }, agent);
    const resolved = await service.execute('artifact_feedback', { artifactId, feedbackId, action: 'resolve' }, agent);
    expect(resolved.feedback[0].status).toBe('resolved'); expect(resolved.feedback[0].processingBy).toBeUndefined();
  });
});

describe('shared session timer', () => {
  it('shares pause/resume/reset state without writing history or tying its life to a view', async () => {
    const board = await create(), artifactId = board.artifact.id, now = Date.now();
    const time = vi.spyOn(Date, 'now').mockReturnValue(now);
    const started = await service.updatePresence(artifactId, { peerId: 'timer-view', timer: { action: 'start', durationSeconds: 60 } }, editor);
    expect(started.timer).toMatchObject({ deadline: now + 60000, remainingMs: 60000, paused: false, source: editor });
    time.mockReturnValue(now + 10000);
    await service.updatePresence(artifactId, { peerId: 'timer-view', timer: { action: 'pause' } }, editor);
    time.mockReturnValue(now + 30000);
    expect(service.getTimer(artifactId)).toMatchObject({ deadline: null, remainingMs: 50000, paused: true });
    await service.updatePresence(artifactId, { peerId: 'timer-view', leave: true }, editor);
    expect((await service.execute('artifact_read', { artifactId, mode: 'context' })).timer.remainingMs).toBe(50000);
    const resumed = await service.updatePresence(artifactId, { timer: { action: 'resume' } }, LOCAL_ACTOR);
    expect(resumed.timer).toMatchObject({ deadline: now + 80000, remainingMs: 50000, paused: false });
    expect((await service.execute('artifact_read', { artifactId, mode: 'history' })).history).toHaveLength(1);
    await service.updatePresence(artifactId, { timer: { action: 'reset' } }, LOCAL_ACTOR);
    expect(service.getTimer(artifactId)).toMatchObject({ durationMs: 60000, deadline: null, remainingMs: 60000, paused: false });
  });
  it('restricts timer control and clears only session state on service closure', async () => {
    const board = await create(), artifactId = board.artifact.id;
    await expect(service.updatePresence(artifactId, { timer: { action: 'start', durationSeconds: 60 } }, viewer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.updatePresence(artifactId, { timer: { action: 'start', durationSeconds: 0 } }, editor)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const collaboration = new StudioCollaboration();
    collaboration.update(artifactId, { timer: { action: 'start', durationSeconds: 60 } }, editor);
    collaboration.close(); expect(collaboration.getTimer(artifactId)).toBeNull();
    expect((await service.execute('artifact_read', { artifactId })).elements).toHaveLength(2);
  });
});
