import { createHash, randomUUID } from 'node:crypto';
import type { Actor, HistoryEntry } from '../../contracts/studio.js';
import type { Proposal, ProposalOption, ProposalOperation } from '../../contracts/proposals.js';
import { assertAlive, copy, object, requireRole, safeId, same, StudioError, text } from './common.js';
import { applyMutation } from './history.js';
import type { ArtifactState, ContentChange, ContentOperation, FeedbackRecord, MutationResult, ProductAdapter, Snapshot } from './model.js';

const LIFETIME = 30 * 60 * 1000;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unit = <C, O extends ContentOperation, A, S>(adapter: ProductAdapter<C, O, A, S>, content: C, id: string) => copy(adapter.readUnit(content, id) ?? null);
export function proposalExpired(item: { proposal?: Proposal }, now = Date.now()): boolean { return !!item.proposal && Date.parse(item.proposal.expiresAt) <= now; }
export function feedbackVisible(item: { proposal?: Proposal }, actor: Actor): boolean { return !item.proposal || actor.role === 'owner' && !proposalExpired(item); }
export function visibleFeedback<A>(items: FeedbackRecord<A>[], actor: Actor): FeedbackRecord<A>[] { return copy(items.filter(item => feedbackVisible(item, actor))); }
export function clearExpiredProposals<C, A, S>(state: ArtifactState<C, A, S>): void {
  for (const item of state.feedback) if (proposalExpired(item)) delete state.sources[item.id];
  state.feedback = state.feedback.filter(item => !proposalExpired(item));
}

function captureOption<C, O extends ContentOperation, A, S>(state: ArtifactState<C, A, S>, raw: unknown, args: Record<string, unknown>, adapter: ProductAdapter<C, O, A, S>): ProposalOption {
  if (!object(raw)) throw new StudioError('INVALID_ARGUMENT', '建议方案无效。');
  const label = text(raw.label, '', 60).trim(), description = text(raw.description, '', 160).trim();
  if (!label) throw new StudioError('INVALID_ARGUMENT', '每个建议方案需要明确名称。');
  if (!Array.isArray(raw.operations) || !raw.operations.length || raw.operations.length > 60 || raw.operations.some(op => !object(op) || typeof op.op !== 'string' || op.op === 'restore')) throw new StudioError('INVALID_ARGUMENT', '每个建议需要 1 至 60 个产品操作；历史恢复应直接操作版本历史。');
  if (Buffer.byteLength(JSON.stringify(raw.operations)) > 24 * 1024) throw new StudioError('TOO_LARGE', '单个建议方案超过 24 KB。');
  const operations = copy(raw.operations) as O[], draft = copy(state.content), explicitIds = new Set<string>(); let wholeContent = false;
  for (const operation of operations) {
    const targets = adapter.targets(draft, operation);
    if (targets === undefined) wholeContent = true; else for (const id of targets) explicitIds.add(id);
    adapter.apply(draft, operation);
  }
  adapter.validate(draft);
  const changes = adapter.diff(state.content, draft), targetIds = [...new Set([...explicitIds, ...changes.map(change => change.id)])];
  if (!changes.length) throw new StudioError('INVALID_ARGUMENT', '建议方案应产生可应用的内容变化。');
  // Stable product operations are necessary for preview, later application and mutual exclusion.
  const repeat = copy(state.content); for (const operation of operations) adapter.apply(repeat, operation);
  if (!same(draft, repeat)) throw new StudioError('INVALID_ARGUMENT', '建议中的新内容需要稳定 ID，不能在每次应用时随机生成。');
  const supplied = object(args.expectedVersions) ? args.expectedVersions : {};
  if (args.expectedRevision !== undefined && (!Number.isInteger(args.expectedRevision) || args.expectedRevision !== state.artifact.revision)) throw new StudioError('CONFLICT', '作品已被修改，请先读取当前作品再提供建议。', { revision: state.artifact.revision });
  if (wholeContent && args.expectedRevision === undefined) throw new StudioError('VERSION_REQUIRED', '整体建议需要提供刚读取的作品版本。');
  const versions: Record<string, number> = {}, baseline: Record<string, unknown> = {};
  for (const id of targetIds) {
    const current = adapter.versionOf(state.content, id), value = unit(adapter, state.content, id);
    if (current > 0 && (!Object.hasOwn(supplied, id) || supplied[id] !== current)) throw new StudioError(Object.hasOwn(supplied, id) ? 'CONFLICT' : 'VERSION_REQUIRED', '建议必须核对刚读取的全部目标对象版本。', { targetId: id, currentVersion: current });
    if (Object.hasOwn(supplied, id) && (!Number.isInteger(supplied[id]) || supplied[id] !== current)) throw new StudioError('CONFLICT', '建议目标已被修改，请重新读取后再建议。', { targetId: id, currentVersion: current });
    versions[id] = current; baseline[id] = value;
  }
  return { id: raw.id === undefined ? randomUUID() : safeId(raw.id, '方案 ID'), label, ...(description ? { description } : {}), operations: operations as unknown as ProposalOperation[], baselineRevision: state.artifact.revision, versions, baseline, wholeContent, targetIds, active: false };
}

interface ProposalResult<C, A> { feedback: FeedbackRecord<A>[]; changed: boolean; snapshot?: Snapshot<C>; historyEntry?: HistoryEntry }

/** Preview uses a detached product document and never creates a history entry or receipt. */
export function previewProposal<C, O extends ContentOperation, A, S>(saved: ArtifactState<C, A, S>, args: Record<string, unknown>, actor: Actor, adapter: ProductAdapter<C, O, A, S>): Snapshot<C> {
  requireRole(actor, ['owner']); assertAlive(saved.artifact);
  const item = saved.feedback.find(entry => entry.id === args.feedbackId && entry.proposal);
  if (!item) throw new StudioError('NOT_FOUND', '私人建议不存在或已清除。');
  if (proposalExpired(item)) throw new StudioError('EXPIRED', '这组建议已过期，请根据当前内容重新提供建议。');
  const state = copy({ artifact: saved.artifact, content: saved.content }), proposal = copy(item.proposal!), option = proposal.options.find(entry => entry.id === args.optionId);
  if (!option) throw new StudioError('NOT_FOUND', '建议方案不存在。');
  if (option.active) return { artifact: state.artifact, content: state.content };
  for (const other of proposal.options.filter(candidate => candidate.active && (option.wholeContent || candidate.wholeContent || candidate.targetIds.some(id => option.targetIds.includes(id))))) {
    const application = other.application;
    if (!application) throw new StudioError('CONFLICT', '方案应用记录不完整，请根据当前内容重新提供建议。');
    for (const change of application.changes) if (!same(unit(adapter, state.content, change.id), change.after ?? null)) throw new StudioError('CONFLICT', '已应用方案后来被修改，无法安全预览互斥方案。', { targetId: change.id });
    for (const change of application.changes) adapter.restoreUnit(state.content, change);
    for (const change of application.changes) if (Object.hasOwn(option.baseline, change.id) && same(option.baseline[change.id], change.before ?? null)) { option.baseline[change.id] = unit(adapter, state.content, change.id); option.versions[change.id] = adapter.versionOf(state.content, change.id); }
    if (option.wholeContent && state.artifact.revision === application.revision) option.baselineRevision = state.artifact.revision;
  }
  if (option.wholeContent && option.baselineRevision !== state.artifact.revision) throw new StudioError('CONFLICT', '作品已被修改，请根据最新内容重新提供整体方案。');
  for (const id of option.targetIds) if (adapter.versionOf(state.content, id) !== option.versions[id] || !same(unit(adapter, state.content, id), option.baseline[id])) throw new StudioError('CONFLICT', '建议目标已被修改，请根据最新内容重新建议。', { targetId: id });
  for (const operation of option.operations) adapter.apply(state.content, operation as unknown as O);
  adapter.validate(state.content); return { artifact: state.artifact, content: state.content };
}

/** Private suggestions share the canonical envelope, lock and applyMutation history policy. */
export function updateProposal<C, O extends ContentOperation, A, S>(state: ArtifactState<C, A, S>, args: Record<string, unknown>, actor: Actor, adapter: ProductAdapter<C, O, A, S>): ProposalResult<C, A> {
  requireRole(actor, ['owner']); assertAlive(state.artifact);
  const action = text(args.action), now = new Date().toISOString();
  const result = (mutation?: MutationResult<C>) => ({ feedback: visibleFeedback(state.feedback, actor), ...(mutation ? { snapshot: copy({ artifact: state.artifact, content: state.content }), historyEntry: copy(mutation.historyEntry), changed: mutation.changed } : { changed: false }) });
  if (action === 'suggest') {
    const message = text(args.text, '', 160).trim(); if (!message) throw new StudioError('INVALID_ARGUMENT', '建议需要一句简短的观察。');
    if (!Array.isArray(args.options) || args.options.length < 2 || args.options.length > 4) throw new StudioError('INVALID_ARGUMENT', '建议应包含 2 至 4 个不同方案。');
    const creationId = args.operationId === undefined ? undefined : safeId(args.operationId, '操作 ID');
    const fingerprint = digest({ text: args.text, anchor: args.anchor, options: args.options, expectedVersions: args.expectedVersions, expectedRevision: args.expectedRevision });
    const duplicate = creationId ? state.feedback.find(item => item.proposal?.creationId === creationId) : undefined;
    if (duplicate) { if (duplicate.proposal!.fingerprint !== fingerprint) throw new StudioError('OPERATION_REUSED', '同一个操作 ID 不能创建不同建议。'); return result(); }
    const options = args.options.map(option => captureOption(state, option, args, adapter));
    if (new Set(options.map(option => option.id)).size !== options.length || new Set(options.map(option => option.label)).size !== options.length || new Set(options.map(option => digest(option.operations))).size !== options.length) throw new StudioError('INVALID_ARGUMENT', '建议方案的 ID、名称和内容必须各不相同。');
    const id = randomUUID(), anchor = object(args.anchor) ? copy(args.anchor) : {};
    if (Buffer.byteLength(JSON.stringify(anchor)) > 32 * 1024) throw new StudioError('TOO_LARGE', '建议定位信息过大。');
    const frozen = adapter.snapshotFeedback(state.artifact.id, id, [state, ...state.history.slice().reverse()], anchor);
    const proposal: Proposal = { audience: 'owner', expiresAt: new Date(Date.now() + LIFETIME).toISOString(), options, ...(creationId ? { creationId } : {}), fingerprint, receipts: [] };
    if (Buffer.byteLength(JSON.stringify(proposal)) > 256 * 1024) throw new StudioError('TOO_LARGE', '建议及目标快照超过 256 KB，请缩小建议范围。');
    state.feedback.push({ id, artifactId: state.artifact.id, type: 'comment', anchor: frozen.anchor, author: copy(actor), text: message, status: 'open', createdAt: now, updatedAt: now, replies: [], versions: copy(frozen.versions), proposal });
    state.sources[id] = copy(frozen.sources); return result();
  }
  const item = state.feedback.find(entry => entry.id === args.feedbackId && entry.proposal);
  if (!item) throw new StudioError('NOT_FOUND', '私人建议不存在或已清除。');
  const proposal = item.proposal!;
  if (action === 'withdraw' && args.optionId === undefined) {
    state.feedback = state.feedback.filter(entry => entry !== item); delete state.sources[item.id]; return result();
  }
  if (proposalExpired(item)) throw new StudioError('EXPIRED', '这组建议已过期，请根据当前内容重新提供建议。');
  const option = proposal.options.find(entry => entry.id === args.optionId);
  if (!option) throw new StudioError('NOT_FOUND', '建议方案不存在。');
  if (!['choose', 'withdraw'].includes(action)) throw new StudioError('INVALID_ARGUMENT', '不支持的建议操作。');
  const operationId = safeId(args.operationId ?? randomUUID(), '操作 ID'), fingerprint = digest({ action, feedbackId: item.id, optionId: option.id });
  const previous = proposal.receipts.find(receipt => receipt.id === operationId);
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new StudioError('OPERATION_REUSED', '同一个操作 ID 不能执行不同建议操作。');
    const historyEntry = state.history.find(saved => saved.entry.id === previous.historyId)?.entry;
    return { ...result(), snapshot: copy({ artifact: state.artifact, content: state.content }), ...(historyEntry ? { historyEntry: copy(historyEntry) } : {}) };
  }
  let mutation: MutationResult<C> | undefined;
  const reverse = (active: ProposalOption, suffix: string) => {
    if (!active.active || !active.application) return;
    const application = active.application, revisionBefore = state.artifact.revision;
    for (const change of application.changes) if (!same(unit(adapter, state.content, change.id), change.after ?? null)) throw new StudioError('CONFLICT', '方案内容后来已被修改，不能直接撤回；已保留当前内容。', { targetId: change.id });
    const undo: ContentOperation = { op: '$proposal-withdraw' }, wrapper: ProductAdapter<C, ContentOperation, A, S> = {
      ...adapter,
      targets: () => application.changes.map(change => change.id),
      apply(content) { for (const change of application.changes) adapter.restoreUnit(content, change); return application.changes.map(change => change.id); },
    };
    mutation = applyMutation(state, { operationId: `proposal-${digest({ operationId, suffix })}`, operations: [undo], expectedRevision: state.artifact.revision, expectedVersions: Object.fromEntries(application.changes.map(change => [change.id, adapter.versionOf(state.content, change.id)])), summary: `撤回建议：${active.label}` }, actor, wrapper);
    // Restoring our own option advances product versions. Rebase only units proven to be
    // the original baseline; edits made by another actor never enter this path.
    for (const candidate of proposal.options) {
      for (const change of application.changes) if (Object.hasOwn(candidate.baseline, change.id) && same(candidate.baseline[change.id], change.before ?? null)) { candidate.baseline[change.id] = unit(adapter, state.content, change.id); candidate.versions[change.id] = adapter.versionOf(state.content, change.id); }
      if (candidate.wholeContent && revisionBefore === application.revision) candidate.baselineRevision = state.artifact.revision;
    }
    active.active = false; delete active.application;
  };
  if (action === 'withdraw' || option.active) reverse(option, '-withdraw');
  else {
    const conflicting = proposal.options.filter(other => other.active && (option.wholeContent || other.wholeContent || other.targetIds.some(id => option.targetIds.includes(id))));
    conflicting.forEach((other, index) => reverse(other, `-undo-${index}`));
    if (option.wholeContent && option.baselineRevision !== state.artifact.revision) throw new StudioError('CONFLICT', '作品已被修改，整体方案需要根据最新内容重新提供。');
    for (const id of option.targetIds) if (adapter.versionOf(state.content, id) !== option.versions[id] || !same(unit(adapter, state.content, id), option.baseline[id])) throw new StudioError('CONFLICT', '建议目标已被修改，未覆盖后来的编辑。请根据最新内容重新建议。', { targetId: id });
    const before = copy(state.content);
    mutation = applyMutation(state, { operationId, operations: option.operations as unknown as O[], expectedRevision: option.wholeContent ? option.baselineRevision : undefined, expectedVersions: option.versions, summary: `应用建议：${option.label}` }, actor, adapter);
    const changes: ContentChange[] = adapter.diff(before, state.content);
    option.active = true; option.application = { historyId: mutation.historyEntry.id, revision: state.artifact.revision, changes: copy(changes) };
  }
  item.updatedAt = now;
  proposal.receipts.push({ id: operationId, fingerprint, ...(mutation ? { historyId: mutation.historyEntry.id } : {}) });
  proposal.receipts = proposal.receipts.slice(-200);
  return result(mutation);
}
