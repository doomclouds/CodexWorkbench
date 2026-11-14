import { createHash, randomUUID } from 'node:crypto';
import type { Actor } from '../../contracts/studio.js';
import { assertAlive, copy, object, requireRole, safeId, StudioError, text } from './common.js';
import { makeHistory } from './history.js';
import type { ArtifactState, ContentOperation, FeedbackRecord, ProductAdapter } from './model.js';
import { feedbackVisible, visibleFeedback } from './proposals.js';

/** Feedback workflow is shared; the product captures its own immutable source context. */
export function updateFeedback<C, O extends ContentOperation, A, S>(state: ArtifactState<C, A, S>, args: Record<string, unknown>, actor: Actor, adapter: ProductAdapter<C, O, A, S>) {
  requireRole(actor, ['owner', 'editor', 'commenter']); assertAlive(state.artifact);
  const action = text(args.action, 'list'), now = new Date().toISOString(); let contextId: string | undefined, item: FeedbackRecord<A>;
  if (action === 'create') {
    const content = text(args.text).trim(); if (!content) throw new StudioError('INVALID_ARGUMENT', '备注内容不能为空。');
    const anchor = object(args.anchor) ? copy(args.anchor) : {};
    if (Buffer.byteLength(JSON.stringify(anchor)) > 32 * 1024) throw new StudioError('TOO_LARGE', '备注定位信息过大。');
    if (args.versions !== undefined && (!object(args.versions) || Object.values(args.versions).some(value => !Number.isInteger(value) || Number(value) < 1))) throw new StudioError('INVALID_ARGUMENT', '备注选区的对象版本无效。');
    const versions = args.versions === undefined ? undefined : copy(args.versions) as Record<string, number>;
    if (versions && Buffer.byteLength(JSON.stringify(versions)) > 32 * 1024) throw new StudioError('TOO_LARGE', '备注选区的版本信息过大。');
    const operationId = args.operationId === undefined ? undefined : safeId(args.operationId, '操作 ID');
    const fingerprint = createHash('sha256').update(JSON.stringify({ actor: actor.id, type: args.type === 'request' ? 'request' : 'comment', text: content, anchor, versions })).digest('hex');
    const deleted = operationId && state.deletedFeedbackReceipts?.find(receipt => receipt.operationId === operationId);
    if (deleted) {
      if (deleted.fingerprint !== fingerprint) throw new StudioError('OPERATION_REUSED', '同一个操作 ID 不能提交不同的备注。');
      throw new StudioError('NOT_FOUND', '该备注已被删除，不能通过重试重新创建。', { contextId: deleted.contextId });
    }
    const duplicate = operationId && state.feedback.find(entry => entry.creationReceipt?.operationId === operationId);
    if (duplicate) {
      if (duplicate.creationReceipt!.fingerprint !== fingerprint) throw new StudioError('OPERATION_REUSED', '同一个操作 ID 不能提交不同的备注。');
      return { feedback: visibleFeedback(state.feedback, actor), contextId: duplicate.id };
    }
    const id = randomUUID(), snapshot = adapter.snapshotFeedback(state.artifact.id, id, [state, ...state.history.slice().reverse()], anchor, versions);
    item = { id, artifactId: state.artifact.id, type: args.type === 'request' ? 'request' : 'comment', anchor: snapshot.anchor, author: copy(actor), text: content, status: 'open', createdAt: now, updatedAt: now, replies: [], versions: copy(snapshot.versions) };
    if (operationId) item.creationReceipt = { operationId, fingerprint };
    state.feedback.push(item); state.sources[id] = copy(snapshot.sources); contextId = id;
  } else {
    const found = state.feedback.find(entry => entry.id === args.feedbackId && feedbackVisible(entry, actor)); if (!found) throw new StudioError('NOT_FOUND', '备注不存在。'); item = found;
    if (item.proposal) throw new StudioError('INVALID_ARGUMENT', '建议请使用选择、撤回或清除操作。');
    if (action === 'reply') { const content = text(args.text).trim(); if (!content) throw new StudioError('INVALID_ARGUMENT', '回复内容不能为空。'); item.replies.push({ id: randomUUID(), author: copy(actor), text: content, createdAt: now }); if (item.status === 'processing' || item.status === 'resolved') { item.status = 'open'; delete item.processingBy; } }
    else if (action === 'edit') {
      const message = args.replyId === undefined ? item : item.replies.find(reply => reply.id === args.replyId);
      if (!message) throw new StudioError('NOT_FOUND', '回复不存在。');
      if (message.author.id !== actor.id) throw new StudioError('FORBIDDEN', '只能编辑自己撰写的消息。');
      const content = text(args.text).trim(); if (!content) throw new StudioError('INVALID_ARGUMENT', '消息内容不能为空。');
      message.text = content;
    }
    else if (action === 'delete') {
      if (actor.role !== 'owner' && item.author.id !== actor.id) throw new StudioError('FORBIDDEN', '只有所有者或备注作者可以删除整个讨论。');
      if (item.creationReceipt) state.deletedFeedbackReceipts = [...(state.deletedFeedbackReceipts ?? []), { ...item.creationReceipt, contextId: item.id }].slice(-500);
      state.feedback = state.feedback.filter(entry => entry.id !== item.id); delete state.sources[item.id];
    }
    else if (action === 'resolve' || action === 'reopen') { if (actor.role === 'commenter' && item.author.id !== actor.id) throw new StudioError('FORBIDDEN', '只能更改自己备注的状态。'); item.status = action === 'resolve' ? 'resolved' : 'open'; delete item.processingBy; }
    else if (action === 'send') { item.status = 'pending'; delete item.processingBy; if (typeof args.targetViewId === 'string') item.targetViewId = text(args.targetViewId, '', 120); contextId = item.id; }
    else if (action === 'processing') { requireRole(actor, ['owner']); item.status = 'processing'; item.processingBy = copy(actor); }
    else throw new StudioError('INVALID_ARGUMENT', '不支持的备注操作。');
    item.updatedAt = now;
  }
  makeHistory(state, actor, action === 'create' ? '添加备注' : action === 'delete' ? '删除备注讨论' : action === 'edit' ? '编辑备注消息' : action === 'send' ? '提交 Codex 请求（等待处理）' : '更新备注', [`$feedback:${item.id}`]);
  return { feedback: visibleFeedback(state.feedback, actor), ...(contextId ? { contextId } : {}) };
}
