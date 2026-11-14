import { createHash, randomUUID } from 'node:crypto';
import type { Actor, HistoryBatch, HistoryEntry } from '../../contracts/studio.js';
import { assertAlive, copy, object, requireRole, safeId, same, StudioError, text } from './common.js';
import type { ArtifactMetadata, ArtifactState, ContentOperation, MutationArguments, MutationResult, ProductAdapter, SavedVersion } from './model.js';

export function createState<Content, Anchor = unknown, Source = unknown>(artifact: ArtifactMetadata, content: Content, actor: Actor, summary: string, changedIds: string[]): ArtifactState<Content, Anchor, Source> {
  const entry: HistoryEntry = { id: randomUUID(), revision: artifact.revision, createdAt: artifact.createdAt, actor: copy(actor), summary, changedIds: [...new Set(changedIds)] };
  return { schemaVersion: 2, artifact: copy(artifact), content: copy(content), feedback: [], history: [{ entry, artifact: copy(artifact), content: copy(content) }], operations: [], sources: {}, sharing: { enabled: false, generation: 0, tokens: {} }, assets: {} };
}
export function version<Content>(state: { history: SavedVersion<Content>[] }, value: unknown): SavedVersion<Content> {
  const found = state.history.find(item => item.entry.id === value || item.entry.revision === value || String(item.entry.revision) === value);
  if (!found) throw new StudioError('NOT_FOUND', '历史版本不存在或已超过保留范围。');
  return found;
}
/** Match the reference's idle/span batches without merging immutable revisions. */
export function historyBatches(history: readonly HistoryEntry[]): HistoryBatch[] {
  const batches: HistoryBatch[] = [];
  for (const [index, entry] of history.entries()) {
    const previous = batches.at(-1), at = Date.parse(entry.createdAt);
    const joins = previous && previous.firstRevision > 0 && entry.revision > 0 && previous.actor.id === entry.actor.id && previous.actor.kind === entry.actor.kind && !previous.restoredFrom && !entry.restoredFrom && at >= Date.parse(previous.createdAt) && at - Date.parse(previous.createdAt) < 30_000 && at - Date.parse(previous.firstCreatedAt) < 300_000;
    if (joins) {
      batches[batches.length - 1] = { ...previous, ...copy(entry), changedIds: [...new Set([...previous.changedIds, ...entry.changedIds])], versionIds: [...previous.versionIds, entry.id] };
    } else batches.push({ ...copy(entry), firstVersionId: entry.id, firstRevision: entry.revision, firstCreatedAt: entry.createdAt, ...(index ? { beforeVersionId: history[index - 1]!.id } : {}), versionIds: [entry.id] });
  }
  return batches;
}
export function restoreUnitIds(operation: ContentOperation): string[] | undefined {
  if (operation.id === undefined && operation.ids === undefined) return;
  if (operation.id !== undefined && operation.ids !== undefined || operation.ids !== undefined && (!Array.isArray(operation.ids) || !operation.ids.length || operation.ids.length > 200)) throw new StudioError('INVALID_ARGUMENT', '历史恢复请提供一个对象 ID，或 1 至 200 个对象 ID 的列表。');
  return [...new Set((operation.ids ?? [operation.id]).map(value => typeof value === 'string' && value.startsWith('$') ? `$${safeId(value.slice(1), '内容单元 ID')}` : safeId(value, '内容单元 ID')))];
}
export function mutationTargets<C, O extends ContentOperation, A, S>(content: C, operation: O, adapter: ProductAdapter<C, O, A, S>): string[] | undefined {
  if (operation.op === 'restore' && !restoreUnitIds(operation)) return;
  return adapter.targets(content, operation);
}
export function makeHistory<Content>(state: { artifact: ArtifactMetadata; content: Content; history: SavedVersion<Content>[] }, actor: Actor, summary: string, changedIds: string[], restoredFrom?: string): HistoryEntry {
  const now = new Date().toISOString(); state.artifact.revision++; state.artifact.updatedAt = now;
  const entry: HistoryEntry = { id: randomUUID(), revision: state.artifact.revision, createdAt: now, actor: copy(actor), summary: summary.slice(0, 500), changedIds: [...new Set(changedIds)], ...(restoredFrom ? { restoredFrom } : {}) };
  state.history.push({ entry, artifact: copy(state.artifact), content: copy(state.content) });
  if (state.history.length > 200) state.history.splice(0, state.history.length - 200);
  return entry;
}
export function restoreVersion<C, O extends ContentOperation, A, S>(state: ArtifactState<C, A, S>, saved: SavedVersion<C>, actor: Actor, adapter: ProductAdapter<C, O, A, S>, undo = false, ids?: string[], baseline = state.content): string[] {
  const current = state.content, history = state.history.map(item => item.content);
  if (ids && undo) throw new StudioError('INVALID_ARGUMENT', '安全撤回事务不能同时指定局部恢复对象。');
  if (ids) {
    const restored = copy(current);
    // Derived/global units can depend on membership restored by ordinary units.
    for (const id of [...ids.filter(id => !id.startsWith('$')), ...ids.filter(id => id.startsWith('$'))]) {
      const before = adapter.readUnit(saved.content, id), after = adapter.readUnit(current, id);
      if (before == null && after == null) throw new StudioError('NOT_FOUND', '该内容单元在当前作品和所选版本中均不存在。', { id });
      adapter.restoreUnit(restored, { id, before, after }, history);
    }
    adapter.validateRestore?.(current, restored, baseline);
    const changedIds = adapter.diff(current, restored).map(change => change.id);
    state.content = restored; return changedIds;
  }
  if (!undo) {
    const restored = adapter.restore(current, saved.content, history);
    adapter.validateRestore?.(current, restored, baseline);
    const changedIds = adapter.diff(current, restored).map(change => change.id);
    state.content = restored; state.artifact.title = saved.artifact.title;
    return changedIds;
  }
  const before = state.history[state.history.indexOf(saved) - 1];
  if (saved.entry.actor.id !== actor.id || !before) throw new StudioError('FORBIDDEN', '只能撤回自己提交的内容修改。');
  const differences = adapter.diff(before.content, saved.content);
  // Check the complete change set before mutating any unit, including product-global units.
  for (const difference of differences) if (!same(adapter.readUnit(state.content, difference.id), difference.after)) throw new StudioError('CONFLICT', '后来有人修改了这项内容，不能直接撤回。', { elementId: difference.id });
  const restored = copy(current);
  for (const difference of differences) adapter.restoreUnit(restored, difference, history);
  adapter.validateRestore?.(current, restored, baseline); state.content = restored;
  return differences.map(change => change.id);
}
/** Common idempotency, object CAS and history transaction policy, used by every product. */
export function applyMutation<C, O extends ContentOperation, A, S>(state: ArtifactState<C, A, S>, args: MutationArguments<O>, actor: Actor, adapter: ProductAdapter<C, O, A, S>): MutationResult<C> {
  requireRole(actor, ['owner', 'editor']); assertAlive(state.artifact);
  const operationId = safeId(args.operationId ?? randomUUID(), '操作 ID'), operations = args.operations;
  if (!Array.isArray(operations) || !operations.length || operations.length > 200) throw new StudioError('INVALID_ARGUMENT', '每次提交应包含 1 至 200 个操作。');
  const fingerprint = createHash('sha256').update(JSON.stringify({ operations, actor: actor.id, summary: args.summary })).digest('hex');
  const duplicate = state.operations.find(item => item.id === operationId);
  if (duplicate) {
    if (duplicate.fingerprint !== fingerprint) throw new StudioError('OPERATION_REUSED', '同一个操作 ID 不能提交不同的修改。');
    const saved = version(state, duplicate.historyId); return { snapshot: copy({ artifact: saved.artifact, content: saved.content }), historyEntry: copy(saved.entry), changed: false };
  }
  const expected = object(args.expectedVersions) ? args.expectedVersions : undefined;
  if (args.expectedRevision !== undefined && (!Number.isInteger(args.expectedRevision) || Number(args.expectedRevision) < 0)) throw new StudioError('INVALID_ARGUMENT', '预期作品版本无效。');
  if (args.expectedRevision === undefined) {
    for (const operation of operations) {
      if (!object(operation)) throw new StudioError('INVALID_ARGUMENT', '作品操作无效。');
      const targets = mutationTargets(state.content, operation, adapter);
      if (!targets || targets.some(id => !expected || !Object.hasOwn(expected, id))) throw new StudioError('VERSION_REQUIRED', '修改已有内容前，请提供作品版本或全部目标对象的版本。');
    }
  }
  if (args.expectedRevision !== undefined && args.expectedRevision !== state.artifact.revision) {
    if (!expected || !Object.keys(expected).length) throw new StudioError('CONFLICT', '作品已被修改，请读取最新版本后重试。', { revision: state.artifact.revision });
    for (const operation of operations) {
      if (!object(operation)) throw new StudioError('INVALID_ARGUMENT', '作品操作无效。');
      const targets = mutationTargets(state.content, operation, adapter);
      if (!targets) throw new StudioError('CONFLICT', '整体操作需要读取最新版本后重试。', { revision: state.artifact.revision });
      if (targets.some(id => typeof id !== 'string' || !Object.hasOwn(expected, id))) throw new StudioError('CONFLICT', '过期提交必须核对所有目标对象的版本。', { revision: state.artifact.revision });
    }
  }
  for (const [id, expectedVersion] of Object.entries(expected ?? {})) {
    if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 0) throw new StudioError('INVALID_ARGUMENT', '预期对象版本无效。');
    const currentVersion = adapter.versionOf(state.content, id);
    if (currentVersion !== expectedVersion) throw new StudioError('CONFLICT', '目标对象已被修改，未覆盖他人的编辑。', { elementId: id, expectedVersion, currentVersion, revision: state.artifact.revision });
  }
  const baseline = copy(state.content), changedIds: string[] = []; let restoredFrom: string | undefined;
  for (const operation of operations) {
    if (!object(operation)) throw new StudioError('INVALID_ARGUMENT', '作品操作无效。');
    if (operation.op === 'restore') {
      const saved = version(state, operation.versionId);
      changedIds.push(...restoreVersion(state, saved, actor, adapter, operation.data?.mode === 'undo' || operation.data?.undo === true || operation.preset === 'undo', restoreUnitIds(operation), baseline));
      restoredFrom = saved.entry.id;
    } else changedIds.push(...adapter.apply(state.content, operation, baseline));
  }
  adapter.validate(state.content);
  const historyEntry = makeHistory(state, actor, text(args.summary, restoredFrom ? '恢复作品内容' : '修改作品', 500), changedIds, restoredFrom);
  state.operations.push({ id: operationId, fingerprint, historyId: historyEntry.id });
  state.operations = state.operations.filter(item => state.history.some(saved => saved.entry.id === item.historyId)).slice(-500);
  return { snapshot: copy({ artifact: state.artifact, content: state.content }), historyEntry: copy(historyEntry), changed: true };
}
