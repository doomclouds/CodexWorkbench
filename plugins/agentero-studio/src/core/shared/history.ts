import { createHash, randomUUID } from 'node:crypto';
import type { Actor, HistoryBatch, HistoryEntry } from '../../contracts/studio.js';
import { assertAlive, copy, object, requireRole, safeId, same, StudioError, text } from './common.js';
import type { ArtifactMetadata, ArtifactState, ContentOperation, MutationArguments, MutationResult, ProductAdapter, SavedVersion } from './model.js';
import { jsonEqual, mergeConflictDetails } from './safe-merge.js';

export function initializeVersionClocks<C, O extends ContentOperation, A, S>(state: ArtifactState<C, A, S>, adapter: ProductAdapter<C, O, A, S>): void {
  if (!adapter.syncVersions) return;
  if (state.unitClocks === undefined) {
    state.unitClocks = {};
    let previous = state.history[0]?.content ?? state.content;
    for (const saved of state.history) { adapter.syncVersions(saved.content, previous, state.unitClocks, true); previous = saved.content; }
    adapter.syncVersions(state.content, previous, state.unitClocks, true);
  }
  for (const clock of Object.values(state.unitClocks)) if (!object(clock) || !Number.isSafeInteger(clock.version) || clock.version < 1 || !Number.isSafeInteger(clock.incarnationStart) || clock.incarnationStart < 1 || clock.incarnationStart > clock.version || clock.sourceRevision !== undefined && (!Number.isSafeInteger(clock.sourceRevision) || clock.sourceRevision < 1)) throw new StudioError('CORRUPT_ARTIFACT', '作品对象版本时钟无效。');
  adapter.syncVersions(state.content, state.content, state.unitClocks);
}

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
  // Apply to detached content so any unit conflict leaves the whole transaction intact.
  const restored = copy(current);
  for (const difference of differences) {
    const clock = state.unitClocks?.[difference.id], savedAfter = object(difference.after) ? difference.after.version : undefined, savedBefore = object(difference.before) ? difference.before.version : undefined;
    if (clock && (typeof savedAfter === 'number' && savedAfter < clock.incarnationStart || difference.after == null && typeof savedBefore === 'number' && savedBefore < clock.version)) throw new StudioError('CONFLICT', '此对象已删除并重建，不能撤回旧对象的事务。', { elementId: difference.id, currentVersion: adapter.versionOf(current, difference.id) });
    if (adapter.undoUnit) adapter.undoUnit(restored, difference, history);
    else {
      if (!same(adapter.readUnit(restored, difference.id), difference.after)) throw new StudioError('CONFLICT', '后来有人修改了这项内容，不能直接撤回。', { elementId: difference.id });
      adapter.restoreUnit(restored, difference, history);
    }
  }
  adapter.validateRestore?.(current, restored, baseline); state.content = restored;
  return differences.map(change => change.id);
}
/** Common idempotency, object CAS and history transaction policy, used by every product. */
export function applyMutation<C, O extends ContentOperation, A, S>(state: ArtifactState<C, A, S>, args: MutationArguments<O>, actor: Actor, adapter: ProductAdapter<C, O, A, S>): MutationResult<C> {
  // Pure callers receive the same all-or-nothing behavior as locked file transactions.
  const working = { ...state, artifact: copy(state.artifact), content: copy(state.content), history: [...state.history], operations: [...state.operations], ...(state.unitClocks ? { unitClocks: copy(state.unitClocks) } : {}) };
  const result = applyWorkingMutation(working, args, actor, adapter);
  Object.assign(state, working); return result;
}
function applyWorkingMutation<C, O extends ContentOperation, A, S>(state: ArtifactState<C, A, S>, args: MutationArguments<O>, actor: Actor, adapter: ProductAdapter<C, O, A, S>): MutationResult<C> {
  requireRole(actor, ['owner', 'editor']); assertAlive(state.artifact);
  if (args.merge !== undefined && args.merge !== 'safe') throw new StudioError('INVALID_ARGUMENT', 'merge 仅支持 safe。');
  const operationId = safeId(args.operationId ?? randomUUID(), '操作 ID'), operations = args.operations;
  if (!Array.isArray(operations) || !operations.length || operations.length > 200) throw new StudioError('INVALID_ARGUMENT', '每次提交应包含 1 至 200 个操作。');
  if (operations.some(operation => !object(operation))) throw new StudioError('INVALID_ARGUMENT', '作品操作无效。');
  const fingerprint = createHash('sha256').update(JSON.stringify({ operations, actor: actor.id, summary: args.summary })).digest('hex');
  const duplicate = state.operations.find(item => item.id === operationId);
  if (duplicate) {
    if (duplicate.fingerprint !== fingerprint) throw new StudioError('OPERATION_REUSED', '同一个操作 ID 不能提交不同的修改。');
    const saved = version(state, duplicate.historyId); return { snapshot: copy({ artifact: saved.artifact, content: saved.content }), historyEntry: copy(saved.entry), changed: false };
  }
  initializeVersionClocks(state, adapter);
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
  const bases = new Map<string, unknown>();
  for (const [id, expectedVersion] of Object.entries(expected ?? {})) {
    if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 0) throw new StudioError('INVALID_ARGUMENT', '预期对象版本无效。');
    const currentVersion = adapter.versionOf(state.content, id);
    if (currentVersion !== expectedVersion) {
      const details = { elementId: id, expectedVersion, currentVersion, revision: state.artifact.revision };
      const targetOperations = operations.filter(operation => mutationTargets(state.content, operation, adapter)?.includes(id));
      if (args.merge !== 'safe' || !adapter.rebaseUpdate || !targetOperations.length || targetOperations.some(operation => operation.op !== 'update') || id.startsWith('$') || Number(expectedVersion) < (state.unitClocks?.[id]?.incarnationStart ?? 1) || !currentVersion) throw new StudioError('CONFLICT', '目标对象已被修改，未覆盖他人的编辑。', { ...details, ...mergeConflictDetails(null, null, adapter.readUnit(state.content, id), ['.']) });
      const candidates = state.history.filter(saved => adapter.versionOf(saved.content, id) === expectedVersion).map(saved => adapter.readUnit(saved.content, id));
      const base = candidates[0];
      if (base == null || candidates.some(candidate => !jsonEqual(candidate, base))) throw new StudioError('CONFLICT', '原对象版本已不可用，请保留本地修改并比较最新内容。', { ...details, ...mergeConflictDetails(null, null, adapter.readUnit(state.content, id), ['.']) });
      bases.set(id, copy(base));
    }
  }
  const baseline = copy(state.content), changedIds: string[] = []; let restoredFrom: string | undefined;
  for (let operation of operations) {
    if (!object(operation)) throw new StudioError('INVALID_ARGUMENT', '作品操作无效。');
    const previous = copy(state.content);
    if (operation.op === 'update' && operation.id && bases.has(operation.id)) {
      const id = operation.id;
      try {
        const rebased = adapter.rebaseUpdate!(operation, bases.get(id), adapter.readUnit(state.content, id));
        bases.set(id, rebased.local); operation = rebased.operation;
      } catch (error) {
        if (error instanceof StudioError && error.code === 'CONFLICT') throw new StudioError('CONFLICT', error.message, { ...(object(error.details) ? error.details : {}), elementId: id, expectedVersion: expected?.[id], currentVersion: adapter.versionOf(state.content, id), revision: state.artifact.revision });
        throw error;
      }
    }
    if (operation.op === 'restore') {
      const saved = version(state, operation.versionId);
      changedIds.push(...restoreVersion(state, saved, actor, adapter, operation.data?.mode === 'undo' || operation.data?.undo === true || operation.preset === 'undo', restoreUnitIds(operation), baseline));
      restoredFrom = saved.entry.id;
    } else changedIds.push(...adapter.apply(state.content, operation, baseline));
    if (adapter.syncVersions) adapter.syncVersions(state.content, previous, state.unitClocks!);
  }
  adapter.validate(state.content);
  const historyEntry = makeHistory(state, actor, text(args.summary, restoredFrom ? '恢复作品内容' : '修改作品', 500), changedIds, restoredFrom);
  state.operations.push({ id: operationId, fingerprint, historyId: historyEntry.id });
  state.operations = state.operations.filter(item => state.history.some(saved => saved.entry.id === item.historyId)).slice(-500);
  return { snapshot: copy({ artifact: state.artifact, content: state.content }), historyEntry: copy(historyEntry), changed: true };
}
