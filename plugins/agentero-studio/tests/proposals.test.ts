import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StudioService } from '../src/core/service.js';
import { LOCAL_ACTOR, type Actor, type Board, type Feedback, type Operation } from '../src/contracts/studio.js';

const agent: Actor = { id: 'codex', name: 'Codex', kind: 'agent', role: 'owner' };
const editor: Actor = { id: 'guest-editor', name: '协作者', kind: 'human', role: 'editor' };
let root: string, service: StudioService, artifactId: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'studio-proposals-')); service = new StudioService({ dataRoot: root });
  const created = await service.execute('artifact_manage', { action: 'create' }); artifactId = created.artifact.id;
  await mutate([{ op: 'add', element: { id: 'a', type: 'html', html: '<h1>初稿</h1>' } }, { op: 'add', element: { id: 'b', type: 'text', text: '其他内容' } }]);
});
afterEach(async () => { await service.close(); if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected test directory'); await rm(root, { recursive: true, force: true }); });
const read = () => service.execute('artifact_read', { artifactId }) as Promise<Board>;
async function mutate(operations: Operation[], actor = LOCAL_ACTOR) { const current = await read(); return service.execute('artifact_apply', { artifactId, expectedRevision: current.artifact.revision, operationId: randomUUID(), operations }, actor); }
async function suggest(extra: Record<string, unknown> = {}): Promise<Feedback> {
  const result = await service.execute('artifact_feedback', { action: 'suggest', artifactId, text: '可以用两种方式呈现标题。', anchor: { regionId: 'a', sourceRevision: 1 }, expectedVersions: { a: 1 }, options: [
    { id: 'short', label: '简洁标题', operations: [{ op: 'update', id: 'a', changes: { html: '<h1>简洁</h1>' } }] },
    { id: 'detailed', label: '增加解释', operations: [{ op: 'update', id: 'a', changes: { html: '<h1>详细</h1>' } }, { op: 'add', element: { id: 'detail', type: 'text', text: '解释' } }] },
  ], ...extra }, agent);
  return result.feedback.find((item: Feedback) => item.proposal)!;
}
const choose = (feedbackId: string, optionId: string, operationId = randomUUID()) => service.execute('artifact_feedback', { action: 'choose', artifactId, feedbackId, optionId, operationId });

describe('private suggestion application and conflict safety', () => {
  it('requires the model-read versions and leaves the artifact untouched when suggesting', async () => {
    const before = await read(); await suggest(); expect(await read()).toEqual(before);
    await mutate([{ op: 'update', id: 'a', changes: { html: '<h1>协作者的新稿</h1>' } }], editor);
    await expect(suggest()).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(suggest({ expectedVersions: {} })).rejects.toMatchObject({ code: 'VERSION_REQUIRED' });
  });
  it('switches mutually exclusive options atomically, retries idempotently, and safely toggles off', async () => {
    const item = await suggest(), operationId = randomUUID();
    const before = await read(), events: unknown[] = [], stop = service.subscribe(artifactId, event => events.push(event));
    const preview = await service.execute('artifact_feedback', { action: 'preview', artifactId, feedbackId: item.id, optionId: 'detailed' });
    expect(preview.document.elements.some((element: { id: string }) => element.id === 'detail')).toBe(true);
    expect(await read()).toEqual(before); expect(events).toEqual([]); stop();
    await choose(item.id, 'detailed', operationId); await choose(item.id, 'detailed', operationId);
    expect((await read()).elements.filter(element => element.id === 'detail')).toHaveLength(1);
    const alternative = await service.execute('artifact_feedback', { action: 'preview', artifactId, feedbackId: item.id, optionId: 'short' });
    expect(alternative.document.elements.some((element: { id: string }) => element.id === 'detail')).toBe(false);
    const switched = await choose(item.id, 'short'); expect(switched.board.elements.find((element: { id: string }) => element.id === 'a').html).toBe('<h1>简洁</h1>');
    expect(switched.board.elements.some((element: { id: string }) => element.id === 'detail')).toBe(false);
    await choose(item.id, 'short'); expect((await read()).elements.find(element => element.id === 'a')!.html).toBe('<h1>初稿</h1>');
    await choose(item.id, 'detailed'); expect((await read()).elements.some(element => element.id === 'detail')).toBe(true);
  });
  it('preserves independent edits and refuses to undo or switch over a later edit', async () => {
    const item = await suggest(); await choose(item.id, 'detailed');
    await mutate([{ op: 'update', id: 'b', changes: { text: '保留协作者内容' } }], editor);
    await choose(item.id, 'detailed'); expect((await read()).elements.find(element => element.id === 'b')!.text).toBe('保留协作者内容');
    await choose(item.id, 'short');
    await mutate([{ op: 'update', id: 'a', changes: { html: '<h2>后来编辑</h2>' } }], editor);
    const before = await read(); await expect(choose(item.id, 'detailed')).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(choose(item.id, 'short')).rejects.toMatchObject({ code: 'CONFLICT' }); expect(await read()).toEqual(before);
  });
  it('serializes choice versus a collaborator edit across service instances', async () => {
    const item = await suggest(), other = new StudioService({ dataRoot: root });
    try {
      const results = await Promise.allSettled([
        choose(item.id, 'short'),
        other.execute('artifact_apply', { artifactId, operationId: randomUUID(), expectedVersions: { a: 1 }, operations: [{ op: 'update', id: 'a', changes: { html: '<h1>协作者</h1>' } }] }, editor),
      ]);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    } finally { await other.close(); }
  });
  it('hides private options and frozen sources from visitors and shared SSE, while allowing the local owner', async () => {
    const events: unknown[] = [], stop = service.subscribe(artifactId, event => events.push(event));
    const item = await suggest();
    expect((await service.execute('artifact_feedback', { artifactId, action: 'list' })).feedback[0].id).toBe(item.id);
    expect((await service.execute('artifact_feedback', { artifactId, action: 'list' }, editor)).feedback).toEqual([]);
    for (const mode of ['context', 'source']) await expect(service.execute('artifact_read', { artifactId, mode, feedbackId: item.id, regionId: 'a' }, editor)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const context = await service.execute('artifact_read', { artifactId, mode: 'context', feedbackId: item.id }); expect(context.feedback.proposal.audience).toBe('owner');
    expect(JSON.stringify(events)).not.toContain('简洁标题');
    await choose(item.id, 'short');
    await service.execute('artifact_feedback', { artifactId, action: 'withdraw', feedbackId: item.id });
    expect((await read()).elements.find(element => element.id === 'a')!.html).toBe('<h1>简洁</h1>');
    stop();
  });
});
