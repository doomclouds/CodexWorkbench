import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { StudioService } from '../src/core/service.js';
import type { Actor, Feedback } from '../src/contracts/studio.js';

const author: Actor = { id: 'author', kind: 'human', name: 'Author', role: 'commenter' };
const agentA: Actor = { id: 'agent-a', kind: 'agent', name: 'Agent A', role: 'owner' };
const agentB: Actor = { id: 'agent-b', kind: 'agent', name: 'Agent B', role: 'owner' };
let directory: string, service: StudioService, artifactId: string, thread: Feedback;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'studio-feedback-collaboration-'));
  service = new StudioService({ dataRoot: directory });
  artifactId = (await service.execute('artifact_manage', { action: 'create', elements: [{ id: 'html', type: 'html', html: '<p>Frozen source</p>' }] })).artifact.id;
  thread = (await action({ action: 'create', text: 'Original', anchor: { regionId: 'html' }, versions: { html: 1 } })).feedback[0]!;
});
afterEach(async () => { await service.close(); if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected test directory'); await rm(directory, { recursive: true, force: true }); });
function action(args: Record<string, unknown>, actor = author) { return service.execute('artifact_feedback', { artifactId, ...(thread ? { feedbackId: thread.id } : {}), ...args }, actor) as Promise<{ feedback: Feedback[] }> ; }

it('deduplicates concurrent stable reply IDs without reopening resolved threads or creating history on retry', async () => {
  const payload = { action: 'reply', replyId: 'stable-reply', text: 'Reply' };
  const results = await Promise.all([action(payload), action(payload)]);
  expect(results.map(result => result.feedback[0]!.replies.length)).toEqual([1, 1]);
  expect(results[0]!.feedback[0]!.replies[0]).toMatchObject({ id: 'stable-reply', text: 'Reply', author });
  await action({ action: 'resolve' });
  const before = await service.store.read(artifactId);
  const retry = await action(payload);
  expect(retry.feedback[0]!.status).toBe('resolved');
  const after = await service.store.read(artifactId);
  expect(after.artifact.revision).toBe(before.artifact.revision);
  expect(after.history).toEqual(before.history);
  expect(after.feedback[0]!.updatedAt).toBe(before.feedback[0]!.updatedAt);
  await expect(action({ ...payload, text: 'Changed' })).rejects.toMatchObject({ code: 'OPERATION_REUSED' });
  await expect(action(payload, { ...author, id: 'different' })).rejects.toMatchObject({ code: 'OPERATION_REUSED' });
  await expect(action(payload, { ...author, kind: 'agent' })).rejects.toMatchObject({ code: 'OPERATION_REUSED' });
});

it('does not restore an edited reply through an old reply retry or an actor-kind collision', async () => {
  const payload = { action: 'reply', replyId: 'stable-reply', text: 'Original reply' };
  await action(payload);
  await action({ action: 'edit', replyId: 'stable-reply', text: 'Edited reply', expectedText: 'Original reply' });
  await expect(action(payload)).rejects.toMatchObject({ code: 'OPERATION_REUSED' });
  await expect(action({ action: 'edit', replyId: 'stable-reply', text: 'Forged', expectedText: 'Edited reply' }, { ...author, kind: 'agent' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect((await service.store.read(artifactId)).feedback[0]!.replies[0]!.text).toBe('Edited reply');
});

it('serializes same-author edit compare-and-swap for both first messages and replies while retaining frozen sources', async () => {
  const source = await service.execute('artifact_read', { artifactId, mode: 'context', contextId: thread.id });
  const results = await Promise.allSettled([action({ action: 'edit', text: 'Window A', expectedText: 'Original' }), action({ action: 'edit', text: 'Window B', expectedText: 'Original' })]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'CONFLICT', details: { currentText: expect.stringMatching(/^Window [AB]$/) } });
  await action({ action: 'reply', replyId: 'reply', text: 'Reply base' });
  await action({ action: 'edit', replyId: 'reply', text: 'Reply A', expectedText: 'Reply base' });
  await expect(action({ action: 'edit', replyId: 'reply', text: 'Reply B', expectedText: 'Reply base' })).rejects.toMatchObject({ code: 'CONFLICT', details: { replyId: 'reply', currentText: 'Reply A' } });
  await action({ action: 'edit', replyId: 'reply', text: 'Legacy edit' });
  expect((await service.store.read(artifactId)).feedback[0]!.replies[0]!.text).toBe('Legacy edit');
  expect((await service.execute('artifact_read', { artifactId, mode: 'context', contextId: thread.id })).sources).toEqual(source.sources);
});

it('rejects the original author after a viewer downgrade for every mutating feedback action', async () => {
  for (const name of ['reply', 'edit', 'delete', 'resolve', 'reopen', 'send', 'processing']) await expect(action({ action: name, replyId: 'reply', text: 'Draft', expectedText: 'Original' }, { ...author, role: 'viewer' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect((await service.store.read(artifactId)).feedback[0]!.text).toBe('Original');
});

it('atomically claims processing for one distinct agent and does not release that claim on a human reply', async () => {
  const claims = await Promise.allSettled([action({ action: 'processing' }, agentA), action({ action: 'processing' }, agentB)]);
  expect(claims.filter(claim => claim.status === 'fulfilled')).toHaveLength(1);
  expect((claims.find(claim => claim.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'BUSY' });
  const current = (await service.store.read(artifactId)).feedback[0]!.processingBy!;
  const other = current.id === agentA.id ? agentB : agentA;
  const before = await service.store.read(artifactId);
  await action({ action: 'processing' }, current);
  expect((await service.store.read(artifactId)).history).toEqual(before.history);
  const replied = await action({ action: 'reply', replyId: 'human-followup', text: 'Additional detail' });
  expect(replied.feedback[0]).toMatchObject({ status: 'processing', processingBy: current });
  for (const name of ['send', 'reopen', 'resolve']) await expect(action({ action: name }, other)).rejects.toMatchObject({ code: 'BUSY' });
  await action({ action: 'reopen' }, service.owner);
  expect((await action({ action: 'processing' }, other)).feedback[0]).toMatchObject({ status: 'processing', processingBy: other });
  await action({ action: 'resolve' }, author);
  expect((await service.store.read(artifactId)).feedback[0]!.status).toBe('resolved');
});
