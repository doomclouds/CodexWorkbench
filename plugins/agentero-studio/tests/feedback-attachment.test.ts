import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { StudioService } from '../src/core/service.js';
import type { Actor, Feedback } from '../src/contracts/studio.js';

const author: Actor = { id: 'author', name: '协作者', kind: 'human', role: 'commenter' };
let service: StudioService;
let directory: string;
let artifactId: string;
let feedbackId: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'studio-feedback-attachment-'));
  service = new StudioService({ dataRoot: directory });
  artifactId = (await service.execute('artifact_manage', { action: 'create' })).artifact.id;
  feedbackId = (
    await service.execute(
      'artifact_feedback',
      { artifactId, action: 'create', text: '请补充录制路径说明' },
      author,
    )
  ).contextId;
});
afterEach(async () => {
  await service.close();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) {
    throw new Error('Unexpected test directory');
  }

  await rm(directory, { recursive: true, force: true });
});

async function action(
  action: string,
  args: Record<string, unknown> = {},
  actor = author,
): Promise<Feedback> {
  return (
    await service.execute('artifact_feedback', { artifactId, feedbackId, action, ...args }, actor)
  ).feedback.find((item: Feedback) => item.id === feedbackId)!;
}

it('persists a pending attachment separately from the discussion and returns the same request on retry', async () => {
  const requested = await action('send');
  expect(requested.attachment).toMatchObject({
    requestId: expect.any(String),
    contentKey: expect.any(String),
    state: 'pending',
    requestedBy: author,
  });
  const before = await service.store.read(artifactId);
  const retried = await action('send');
  expect(retried.attachment).toEqual(requested.attachment);
  expect((await service.store.read(artifactId)).history).toEqual(before.history);
});

it('records the exact successful request and keeps resolve, reply and processing independent', async () => {
  const requested = await action('send');
  await action('resolve');
  const attached = await action(
    'attached',
    { requestId: requested.attachment!.requestId },
    service.owner,
  );
  expect(attached.status).toBe('resolved');
  expect(attached.attachment).toMatchObject({
    ...requested.attachment,
    state: 'attached',
    attachedBy: service.owner,
    attachedAt: expect.any(String),
  });
  const replied = await action('reply', { text: '补充一个例子', replyId: 'followup' });
  expect(replied.status).toBe('open');
  expect(replied.attachment?.state).toBe('attached');
  const processor = { ...service.owner, id: 'agent-a', kind: 'agent' as const };
  const processing = await action('processing', {}, processor);
  expect(processing.status).toBe('processing');
  expect(processing.attachment?.state).toBe('attached');
  const otherService = new StudioService({ dataRoot: directory });
  try {
    expect(
      (await otherService.execute('artifact_feedback', { artifactId, feedbackId, action: 'get' }))
        .feedback[0].attachment,
    ).toEqual(attached.attachment);
  } finally {
    await otherService.close();
  }
});

it('makes a successful receipt idempotent without changing its original timestamp or creating history', async () => {
  const requested = await action('send');
  const attached = await action(
    'attached',
    { requestId: requested.attachment!.requestId },
    service.owner,
  );
  const before = await service.store.read(artifactId);
  expect(
    (await action('attached', { requestId: requested.attachment!.requestId }, service.owner))
      .attachment,
  ).toEqual(attached.attachment);
  expect((await action('send')).attachment).toEqual(attached.attachment);
  expect((await service.store.read(artifactId)).history).toEqual(before.history);
});

it('starts a new request only for changed discussion content and rejects a stale success receipt', async () => {
  const first = await action('send');
  await action('reply', { text: '这是新补充', replyId: 'new-detail' });
  const second = await action('send');
  expect(second.attachment!.requestId).not.toBe(first.attachment!.requestId);
  expect(second.attachment!.contentKey).not.toBe(first.attachment!.contentKey);
  await expect(
    action('attached', { requestId: first.attachment!.requestId }, service.owner),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  expect((await action('get')).attachment).toEqual(second.attachment);
});

it('permits only a human owner to acknowledge a successful host attachment', async () => {
  const requested = await action('send');
  for (const actor of [
    author,
    { ...author, role: 'editor' as const },
    { ...service.owner, kind: 'agent' as const },
  ]) {
    await expect(
      action('attached', { requestId: requested.attachment!.requestId }, actor),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  }

  await expect(action('attached', {}, service.owner)).rejects.toMatchObject({
    code: 'INVALID_ARGUMENT',
  });
  expect((await action('get')).attachment?.state).toBe('pending');
});

it('normalizes an old pending request when the owner opens it without requiring a data migration', async () => {
  await service.store.transaction(artifactId, (state) => {
    state.feedback[0]!.status = 'pending';
  });
  const old = await action('get');
  expect(old.attachment).toBeUndefined();
  const normalized = await action('send', {}, service.owner);
  expect(normalized.attachment?.state).toBe('pending');
  expect((await action('send', {}, service.owner)).attachment).toEqual(normalized.attachment);
  expect(
    (await action('attached', { requestId: normalized.attachment!.requestId }, service.owner))
      .attachment?.state,
  ).toBe('attached');
});

it('keeps an active processor when a human requests attachment after changing the content', async () => {
  const first = await action('send');
  const processor: Actor = { ...service.owner, id: 'agent-a', name: 'Agent A', kind: 'agent' };
  await action('processing', {}, processor);
  await action('edit', { text: '请补充录制路径和文件名说明', expectedText: '请补充录制路径说明' });
  const requested = await action('send');
  expect(requested.attachment!.requestId).not.toBe(first.attachment!.requestId);
  expect(requested.attachment?.state).toBe('pending');
  expect(requested.status).toBe('processing');
  expect(requested.processingBy).toEqual(processor);
  expect((await action('get')).processingBy).toEqual(processor);
});

it('keeps a resolved discussion resolved when edited content is requested for attachment', async () => {
  const first = await action('send');
  await action('resolve');
  await action('edit', { text: '已核对的录制路径说明', expectedText: '请补充录制路径说明' });
  const requested = await action('send');
  expect(requested.attachment!.requestId).not.toBe(first.attachment!.requestId);
  expect(requested.attachment?.state).toBe('pending');
  expect(requested.status).toBe('resolved');
  expect((await action('get')).status).toBe('resolved');
});
