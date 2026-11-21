import { createHash, randomUUID } from 'node:crypto';
import type { Actor } from '../../contracts/studio.js';
import { assertAlive, copy, object, requireRole, safeId, StudioError, text } from './common.js';
import { makeHistory } from './history.js';
import type { ArtifactState, ContentOperation, FeedbackRecord, ProductAdapter } from './model.js';
import { feedbackVisible, visibleFeedback } from './proposals.js';

const historySummaries = new Map([
  ['create', '添加备注'],
  ['delete', '删除备注讨论'],
  ['edit', '编辑备注消息'],
  ['send', '请求附加到对话'],
  ['attached', '已附加到对话'],
]);

interface FeedbackChange {
  changed: boolean;
  contextId?: string;
}

function feedbackVersions(input: unknown): Record<string, number> | undefined {
  if (input === undefined) {
    return;
  }
  if (
    !object(input) ||
    Object.values(input).some((value) => !Number.isInteger(value) || Number(value) < 1)
  ) {
    throw new StudioError('INVALID_ARGUMENT', '备注选区的对象版本无效。');
  }

  const versions = copy(input) as Record<string, number>;
  if (Buffer.byteLength(JSON.stringify(versions)) > 32 * 1024) {
    throw new StudioError('TOO_LARGE', '备注选区的版本信息过大。');
  }

  return versions;
}

function sameAuthor(author: Actor, actor: Actor): boolean {
  return author.id === actor.id && author.kind === actor.kind;
}

function assertProcessingOwner(current: Actor, actor: Actor): void {
  if (!sameAuthor(current, actor)) {
    throw new StudioError('BUSY', '此讨论正在由其他协作者处理，请勿重复接管。', {
      processingBy: copy(current),
    });
  }
}

function createFeedback<C, O extends ContentOperation, A, S>(
  state: ArtifactState<C, A, S>,
  args: Record<string, unknown>,
  actor: Actor,
  adapter: ProductAdapter<C, O, A, S>,
  now: string,
): FeedbackChange & { contextId: string } {
  const content = text(args.text).trim();
  if (!content) {
    throw new StudioError('INVALID_ARGUMENT', '备注内容不能为空。');
  }

  const anchor = object(args.anchor) ? copy(args.anchor) : {};
  if (Buffer.byteLength(JSON.stringify(anchor)) > 32 * 1024) {
    throw new StudioError('TOO_LARGE', '备注定位信息过大。');
  }

  const versions = feedbackVersions(args.versions);
  const operationId =
    args.operationId === undefined ? undefined : safeId(args.operationId, '操作 ID');
  const type = args.type === 'request' ? 'request' : 'comment';
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ actor: actor.id, type, text: content, anchor, versions }))
    .digest('hex');
  const deleted =
    operationId &&
    state.deletedFeedbackReceipts?.find((receipt) => receipt.operationId === operationId);

  if (deleted) {
    if (deleted.fingerprint !== fingerprint) {
      throw new StudioError('OPERATION_REUSED', '同一个操作 ID 不能提交不同的备注。');
    }

    throw new StudioError('NOT_FOUND', '该备注已被删除，不能通过重试重新创建。', {
      contextId: deleted.contextId,
    });
  }

  const duplicate =
    operationId &&
    state.feedback.find((entry) => entry.creationReceipt?.operationId === operationId);

  if (duplicate) {
    if (duplicate.creationReceipt!.fingerprint !== fingerprint) {
      throw new StudioError('OPERATION_REUSED', '同一个操作 ID 不能提交不同的备注。');
    }

    return { changed: false, contextId: duplicate.id };
  }

  const id = randomUUID();
  const snapshot = adapter.snapshotFeedback(
    state.artifact.id,
    id,
    [state, ...state.history.slice().reverse()],
    anchor,
    versions,
    state.unitClocks,
  );
  const item: FeedbackRecord<A> = {
    id,
    artifactId: state.artifact.id,
    type,
    anchor: snapshot.anchor,
    author: copy(actor),
    text: content,
    status: 'open',
    createdAt: now,
    updatedAt: now,
    replies: [],
    versions: copy(snapshot.versions),
  };

  if (operationId) {
    item.creationReceipt = { operationId, fingerprint };
  }

  state.feedback.push(item);
  state.sources[id] = copy(snapshot.sources);

  return { changed: true, contextId: id };
}

function reply<A>(
  item: FeedbackRecord<A>,
  args: Record<string, unknown>,
  actor: Actor,
  now: string,
): boolean {
  const content = text(args.text).trim();
  if (!content) {
    throw new StudioError('INVALID_ARGUMENT', '回复内容不能为空。');
  }

  const id = args.replyId === undefined ? randomUUID() : safeId(args.replyId, '回复 ID');
  const duplicate = item.replies.find((message) => message.id === id);
  if (duplicate) {
    if (!sameAuthor(duplicate.author, actor) || duplicate.text !== content) {
      throw new StudioError('OPERATION_REUSED', '同一个回复 ID 不能提交不同的作者或内容。');
    }

    return false;
  }

  item.replies.push({ id, author: copy(actor), text: content, createdAt: now });
  if (item.status === 'resolved') {
    item.status = 'open';
    delete item.processingBy;
  }

  return true;
}

function editMessage<A>(
  item: FeedbackRecord<A>,
  args: Record<string, unknown>,
  actor: Actor,
): void {
  const message =
    args.replyId === undefined ? item : item.replies.find((entry) => entry.id === args.replyId);

  if (!message) {
    throw new StudioError('NOT_FOUND', '回复不存在。');
  }
  if (!sameAuthor(message.author, actor)) {
    throw new StudioError('FORBIDDEN', '只能编辑自己撰写的消息。');
  }

  const content = text(args.text).trim();
  if (!content) {
    throw new StudioError('INVALID_ARGUMENT', '消息内容不能为空。');
  }
  if (args.expectedText !== undefined && message.text !== text(args.expectedText)) {
    throw new StudioError('CONFLICT', '消息已被其他窗口修改，请保留草稿并重新打开后比较。', {
      feedbackId: item.id,
      ...(args.replyId !== undefined ? { replyId: args.replyId } : {}),
      currentText: message.text,
    });
  }

  message.text = content;
}

function deleteFeedback<C, A, S>(
  state: ArtifactState<C, A, S>,
  item: FeedbackRecord<A>,
  actor: Actor,
): void {
  if (actor.role !== 'owner' && item.author.id !== actor.id) {
    throw new StudioError('FORBIDDEN', '只有所有者或备注作者可以删除整个讨论。');
  }

  if (item.creationReceipt) {
    state.deletedFeedbackReceipts = [
      ...(state.deletedFeedbackReceipts ?? []),
      { ...item.creationReceipt, contextId: item.id },
    ].slice(-500);
  }

  state.feedback = state.feedback.filter((entry) => entry.id !== item.id);
  delete state.sources[item.id];
}

function requestAttachment<A>(
  item: FeedbackRecord<A>,
  args: Record<string, unknown>,
  actor: Actor,
  now: string,
): boolean {
  const contentKey = createHash('sha256')
    .update(
      JSON.stringify({
        text: item.text,
        replies: item.replies,
        anchor: item.anchor,
        versions: item.versions,
      }),
    )
    .digest('hex');

  if (item.attachment?.contentKey === contentKey) {
    return false;
  }

  item.attachment = {
    requestId: randomUUID(),
    contentKey,
    state: 'pending',
    requestedAt: now,
    requestedBy: copy(actor),
  };

  if (item.status === 'open') {
    item.status = 'pending';
  }
  if (typeof args.targetViewId === 'string') {
    item.targetViewId = text(args.targetViewId, '', 120);
  }

  return true;
}

function confirmAttachment<A>(
  item: FeedbackRecord<A>,
  args: Record<string, unknown>,
  actor: Actor,
  now: string,
): boolean {
  requireRole(actor, ['owner']);
  if (actor.kind !== 'human') {
    throw new StudioError('FORBIDDEN', '只有房主界面可以确认已附加到对话。');
  }

  const requestId = safeId(args.requestId, '附加请求 ID');
  if (!item.attachment || item.attachment.requestId !== requestId) {
    throw new StudioError('CONFLICT', '附加请求已更新，请重新查看当前备注。');
  }
  if (item.attachment.state === 'attached') {
    return false;
  }

  item.attachment = {
    ...item.attachment,
    state: 'attached',
    attachedAt: now,
    attachedBy: copy(actor),
  };

  return true;
}

function applyAction<C, A, S>(
  state: ArtifactState<C, A, S>,
  item: FeedbackRecord<A>,
  action: string,
  args: Record<string, unknown>,
  actor: Actor,
  now: string,
): FeedbackChange {
  const processingBy = item.status === 'processing' ? item.processingBy : undefined;
  if (actor.kind === 'agent' && processingBy && ['resolve', 'reopen', 'send'].includes(action)) {
    assertProcessingOwner(processingBy, actor);
  }

  switch (action) {
    case 'reply':
      return { changed: reply(item, args, actor, now) };
    case 'edit':
      editMessage(item, args, actor);
      break;
    case 'delete':
      deleteFeedback(state, item, actor);
      break;
    case 'resolve':
    case 'reopen':
      if (actor.role === 'commenter' && item.author.id !== actor.id) {
        throw new StudioError('FORBIDDEN', '只能更改自己备注的状态。');
      }

      item.status = action === 'resolve' ? 'resolved' : 'open';
      delete item.processingBy;
      break;
    case 'send':
      return { changed: requestAttachment(item, args, actor, now), contextId: item.id };
    case 'attached':
      return { changed: confirmAttachment(item, args, actor, now) };
    case 'processing':
      requireRole(actor, ['owner']);
      if (processingBy) {
        assertProcessingOwner(processingBy, actor);

        return { changed: false };
      }

      item.status = 'processing';
      item.processingBy = copy(actor);
      break;
    default:
      throw new StudioError('INVALID_ARGUMENT', '不支持的备注操作。');
  }

  return { changed: true };
}

export function updateFeedback<C, O extends ContentOperation, A, S>(
  state: ArtifactState<C, A, S>,
  args: Record<string, unknown>,
  actor: Actor,
  adapter: ProductAdapter<C, O, A, S>,
) {
  requireRole(actor, ['owner', 'editor', 'commenter']);
  assertAlive(state.artifact);
  const action = text(args.action, 'list');
  const now = new Date().toISOString();
  const summary = historySummaries.get(action) ?? '更新备注';
  if (action === 'create') {
    const { changed, contextId } = createFeedback(state, args, actor, adapter, now);
    if (changed) {
      makeHistory(state, actor, summary, [`$feedback:${contextId}`]);
    }

    return { feedback: visibleFeedback(state.feedback, actor), contextId };
  }

  const item = state.feedback.find(
    (entry) => entry.id === args.feedbackId && feedbackVisible(entry, actor),
  );

  if (!item) {
    throw new StudioError('NOT_FOUND', '备注不存在。');
  }
  if (item.proposal) {
    throw new StudioError('INVALID_ARGUMENT', '建议请使用选择、撤回或清除操作。');
  }

  const { changed, contextId } = applyAction(state, item, action, args, actor, now);
  if (changed) {
    item.updatedAt = now;
    makeHistory(state, actor, summary, [`$feedback:${item.id}`]);
  }

  return { feedback: visibleFeedback(state.feedback, actor), ...(contextId ? { contextId } : {}) };
}
