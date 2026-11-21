import { createHash, randomUUID } from 'node:crypto';
import type { Actor, HistoryBatch, HistoryEntry } from '../../contracts/studio.js';
import {
  assertAlive,
  copy,
  object,
  requireRole,
  safeId,
  same,
  StudioError,
  text,
} from './common.js';
import type {
  ArtifactMetadata,
  ArtifactState,
  ContentChange,
  ContentOperation,
  MutationArguments,
  MutationResult,
  ProductAdapter,
  SavedVersion,
  StructuredMergeEvidence,
  UnitClock,
} from './model.js';
import { jsonEqual, mergeConflictDetails } from '../../shared/safe-merge.js';

export function initializeVersionClocks<C, O extends ContentOperation, A, S>(
  state: ArtifactState<C, A, S>,
  adapter: ProductAdapter<C, O, A, S>,
): void {
  if (!adapter.syncVersions) {
    return;
  }

  if (state.unitClocks === undefined) {
    state.unitClocks = {};
    let previous = state.history[0]?.content ?? state.content;
    for (const saved of state.history) {
      adapter.syncVersions(saved.content, previous, state.unitClocks, true);
      previous = saved.content;
    }

    adapter.syncVersions(state.content, previous, state.unitClocks, true);
  }

  for (const clock of Object.values(state.unitClocks)) {
    if (!validVersionClock(clock)) {
      throw new StudioError('CORRUPT_ARTIFACT', '作品对象版本时钟无效。');
    }
  }

  adapter.syncVersions(state.content, state.content, state.unitClocks);
}

function validVersionClock(clock: UnitClock): boolean {
  if (!object(clock) || !Number.isSafeInteger(clock.version) || clock.version < 1) {
    return false;
  }

  const { incarnationStart, sourceRevision } = clock;
  if (
    !Number.isSafeInteger(incarnationStart) ||
    incarnationStart < 1 ||
    incarnationStart > clock.version
  ) {
    return false;
  }

  return (
    sourceRevision === undefined || (Number.isSafeInteger(sourceRevision) && sourceRevision >= 1)
  );
}

export function createState<Content, Anchor = unknown, Source = unknown>(
  artifact: ArtifactMetadata,
  content: Content,
  actor: Actor,
  summary: string,
  changedIds: string[],
): ArtifactState<Content, Anchor, Source> {
  const entry: HistoryEntry = {
    id: randomUUID(),
    revision: artifact.revision,
    createdAt: artifact.createdAt,
    actor: copy(actor),
    summary,
    changedIds: [...new Set(changedIds)],
  };

  return {
    schemaVersion: 2,
    artifact: copy(artifact),
    content: copy(content),
    feedback: [],
    history: [{ entry, artifact: copy(artifact), content: copy(content) }],
    operations: [],
    sources: {},
    sharing: { enabled: false, generation: 0, tokens: {} },
    assets: {},
  };
}

export function version<Content>(
  state: { history: SavedVersion<Content>[] },
  value: unknown,
): SavedVersion<Content> {
  const found = state.history.find(
    (item) =>
      item.entry.id === value ||
      item.entry.revision === value ||
      String(item.entry.revision) === value,
  );

  if (!found) {
    throw new StudioError('NOT_FOUND', '历史版本不存在或已超过保留范围。');
  }

  return found;
}

export function historyBatches(history: readonly HistoryEntry[]): HistoryBatch[] {
  const batches: HistoryBatch[] = [];
  for (const [index, entry] of history.entries()) {
    const previous = batches.at(-1);
    const at = Date.parse(entry.createdAt);
    const joins =
      previous &&
      previous.firstRevision > 0 &&
      entry.revision > 0 &&
      previous.actor.id === entry.actor.id &&
      previous.actor.kind === entry.actor.kind &&
      !previous.restoredFrom &&
      !entry.restoredFrom &&
      at >= Date.parse(previous.createdAt) &&
      at - Date.parse(previous.createdAt) < 30_000 &&
      at - Date.parse(previous.firstCreatedAt) < 300_000;

    if (joins) {
      batches[batches.length - 1] = {
        ...previous,
        ...copy(entry),
        changedIds: [...new Set([...previous.changedIds, ...entry.changedIds])],
        versionIds: [...previous.versionIds, entry.id],
      };
    } else {
      batches.push({
        ...copy(entry),
        firstVersionId: entry.id,
        firstRevision: entry.revision,
        firstCreatedAt: entry.createdAt,
        ...(index ? { beforeVersionId: history[index - 1]!.id } : {}),
        versionIds: [entry.id],
      });
    }
  }

  return batches;
}

export function restoreUnitIds(operation: ContentOperation): string[] | undefined {
  if (operation.id === undefined && operation.ids === undefined) {
    return;
  }

  const { id, ids } = operation;
  const conflictingSelection = id !== undefined && ids !== undefined;
  const invalidSelection = ids !== undefined && !validRestoreSelection(ids);
  if (conflictingSelection || invalidSelection) {
    throw new StudioError(
      'INVALID_ARGUMENT',
      '历史恢复请提供一个对象 ID，或 1 至 200 个对象 ID 的列表。',
    );
  }

  return [
    ...new Set(
      (operation.ids ?? [operation.id]).map((value) =>
        typeof value === 'string' && value.startsWith('$')
          ? `$${safeId(value.slice(1), '内容单元 ID')}`
          : safeId(value, '内容单元 ID'),
      ),
    ),
  ];
}

function validRestoreSelection(ids: unknown): boolean {
  return Array.isArray(ids) && ids.length > 0 && ids.length <= 200;
}

export function mutationTargets<C, O extends ContentOperation, A, S>(
  content: C,
  operation: O,
  adapter: ProductAdapter<C, O, A, S>,
): string[] | undefined {
  if (operation.op === 'restore' && !restoreUnitIds(operation)) {
    return;
  }

  return adapter.targets(content, operation);
}

function isUndo(operation: ContentOperation): boolean {
  return (
    operation.op === 'restore' &&
    (operation.data?.mode === 'undo' ||
      operation.data?.undo === true ||
      operation.preset === 'undo')
  );
}

const isAuthor = (entry: HistoryEntry, actor: Actor) =>
  entry.actor.id === actor.id && entry.actor.kind === actor.kind;
const unitVersion = (unit: unknown) => (object(unit) ? unit.version : undefined);

export function makeHistory<Content>(
  state: { artifact: ArtifactMetadata; content: Content; history: SavedVersion<Content>[] },
  actor: Actor,
  summary: string,
  changedIds: string[],
  restore: Pick<HistoryEntry, 'restoredFrom' | 'restoreMode'> = {},
): HistoryEntry {
  const now = new Date().toISOString();
  state.artifact.revision++;
  state.artifact.updatedAt = now;
  const entry: HistoryEntry = {
    id: randomUUID(),
    revision: state.artifact.revision,
    createdAt: now,
    actor: copy(actor),
    summary: summary.slice(0, 500),
    changedIds: [...new Set(changedIds)],
    ...restore,
  };
  state.history.push({ entry, artifact: copy(state.artifact), content: copy(state.content) });
  if (state.history.length > 200) {
    state.history.splice(0, state.history.length - 200);
  }

  return entry;
}

function ownChangesWereReversed<C>(
  history: readonly SavedVersion<C>[],
  target: number,
  currentRevision: number,
  actor: Actor,
  read: (content: C) => unknown,
  current: unknown,
  didChange: (before: unknown, after: unknown) => boolean,
): boolean {
  const pending: HistoryEntry[] = [];
  let previous = read(history[target]!.content);
  let revision = history[target]!.entry.revision;
  let reversed = false;
  for (const { entry, content } of history.slice(target + 1)) {
    if (entry.revision !== ++revision) {
      return false;
    }

    const value = read(content);
    if (didChange(previous, value)) {
      const candidate = pending.at(-1);
      const reversesCandidate =
        candidate && entry.restoreMode === 'undo' && entry.restoredFrom === candidate.id;

      if (reversesCandidate && isAuthor(entry, actor) && isAuthor(candidate, actor)) {
        pending.pop();
        reversed = true;
      } else {
        pending.push(entry);
      }
    }

    previous = value;
  }

  return (
    reversed && !pending.length && currentRevision === revision && !didChange(previous, current)
  );
}

export function restoreVersion<C, O extends ContentOperation, A, S>(
  state: ArtifactState<C, A, S>,
  saved: SavedVersion<C>,
  actor: Actor,
  adapter: ProductAdapter<C, O, A, S>,
  undo = false,
  ids?: string[],
  baseline = state.content,
): string[] {
  const current = state.content;
  const history = state.history.map((item) => item.content);
  if (ids && undo) {
    throw new StudioError('INVALID_ARGUMENT', '安全撤回事务不能同时指定局部恢复对象。');
  }

  if (ids) {
    const restored = copy(current);

    for (const id of [
      ...ids.filter((id) => !id.startsWith('$')),
      ...ids.filter((id) => id.startsWith('$')),
    ]) {
      const before = adapter.readUnit(saved.content, id);
      const after = adapter.readUnit(current, id);
      if (before == null && after == null) {
        throw new StudioError('NOT_FOUND', '该内容单元在当前作品和所选版本中均不存在。', { id });
      }

      adapter.restoreUnit(restored, { id, before, after }, history);
    }

    adapter.validateRestore?.(current, restored, baseline);
    const changedIds = adapter.diff(current, restored).map((change) => change.id);
    state.content = restored;

    return changedIds;
  }
  if (!undo) {
    const restored = adapter.restore(current, saved.content, history);
    adapter.validateRestore?.(current, restored, baseline);
    const changedIds = adapter.diff(current, restored).map((change) => change.id);
    state.content = restored;
    state.artifact.title = saved.artifact.title;

    return changedIds;
  }

  return undoSavedVersion(state, saved, actor, adapter, history, baseline);
}

function changedUnitIncarnation(clock: UnitClock | undefined, change: ContentChange): boolean {
  if (!clock) {
    return false;
  }

  const after = unitVersion(change.after);
  if (typeof after === 'number' && after < clock.incarnationStart) {
    return true;
  }

  const before = unitVersion(change.before);

  return change.after == null && typeof before === 'number' && before < clock.version;
}

function undoSavedVersion<C, O extends ContentOperation, A, S>(
  state: ArtifactState<C, A, S>,
  saved: SavedVersion<C>,
  actor: Actor,
  adapter: ProductAdapter<C, O, A, S>,
  history: C[],
  baseline: C,
): string[] {
  const current = state.content;
  const index = state.history.indexOf(saved);
  const before = state.history[index - 1];
  if (!isAuthor(saved.entry, actor)) {
    throw new StudioError('FORBIDDEN', '只能撤回自己提交的内容修改。');
  }
  if (!before || before.entry.revision !== saved.entry.revision - 1) {
    throw new StudioError('NOT_FOUND', '此操作的原始版本已超出可撤销范围。');
  }

  const differences = adapter.diff(before.content, saved.content);

  const restored = copy(current);
  for (const difference of differences) {
    const readUnit = (content: C) => adapter.readUnit(content, difference.id);
    const currentUnit = readUnit(current);
    const changesWereReversed = (didChange: (before: unknown, after: unknown) => boolean) =>
      ownChangesWereReversed(
        state.history,
        index,
        state.artifact.revision,
        actor,
        readUnit,
        currentUnit,
        didChange,
      );
    const changedIncarnation = changedUnitIncarnation(
      state.unitClocks?.[difference.id],
      difference,
    );

    if (changedIncarnation && !changesWereReversed((a, b) => unitVersion(a) !== unitVersion(b))) {
      throw new StudioError('CONFLICT', '此对象已删除并重建，不能撤回旧对象的事务。', {
        elementId: difference.id,
        currentVersion: adapter.versionOf(current, difference.id),
      });
    }

    if (adapter.undoUnit) {
      adapter.undoUnit(restored, difference, history, {
        current: currentUnit,
        changesWereReversed,
      });
    } else {
      if (!same(adapter.readUnit(restored, difference.id), difference.after)) {
        throw new StudioError('CONFLICT', '后来有人修改了这项内容，不能直接撤回。', {
          elementId: difference.id,
        });
      }

      adapter.restoreUnit(restored, difference, history);
    }
  }

  adapter.validateRestore?.(current, restored, baseline, 'undo');
  state.content = restored;

  return differences.map((change) => change.id);
}

export function applyMutation<C, O extends ContentOperation, A, S>(
  state: ArtifactState<C, A, S>,
  args: MutationArguments<O>,
  actor: Actor,
  adapter: ProductAdapter<C, O, A, S>,
): MutationResult<C> {
  const working = {
    ...state,
    artifact: copy(state.artifact),
    content: copy(state.content),
    history: [...state.history],
    operations: [...state.operations],
    ...(state.unitClocks ? { unitClocks: copy(state.unitClocks) } : {}),
  };
  const result = applyWorkingMutation(working, args, actor, adapter);
  Object.assign(state, working);

  return result;
}

function assertMutationOperations(operations: unknown): asserts operations is ContentOperation[] {
  if (!Array.isArray(operations) || !operations.length || operations.length > 200) {
    throw new StudioError('INVALID_ARGUMENT', '每次提交应包含 1 至 200 个操作。');
  }
  if (operations.some((operation) => !object(operation))) {
    throw new StudioError('INVALID_ARGUMENT', '作品操作无效。');
  }
}

function mutationFingerprint(
  operations: readonly ContentOperation[],
  actor: Actor,
  summary: unknown,
  merge: unknown,
) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        operations,
        actor: actor.id,
        summary,
        ...(merge === 'same-generation' ? { merge } : {}),
      }),
    )
    .digest('hex');
}

function matchingOperation(
  state: Pick<ArtifactState<unknown>, 'operations'>,
  operationId: string,
  fingerprint: string,
) {
  const saved = state.operations.find((item) => item.id === operationId);
  if (saved && saved.fingerprint !== fingerprint) {
    throw new StudioError('OPERATION_REUSED', '同一个操作 ID 不能提交不同的修改。');
  }

  return saved;
}

export function readMutationReceipt<C>(
  state: Pick<ArtifactState<C>, 'artifact' | 'history' | 'operations'>,
  args: Record<string, unknown>,
  actor: Actor,
) {
  requireRole(actor, ['owner', 'editor']);
  assertAlive(state.artifact);

  const operationId = safeId(args.operationId, '操作 ID');
  const operations = args.operations;
  assertMutationOperations(operations);
  const record = matchingOperation(
    state,
    operationId,
    mutationFingerprint(operations, actor, args.summary, args.merge),
  );
  const saved = record && state.history.find((item) => item.entry.id === record.historyId);
  const matchesArtifact =
    saved &&
    saved.artifact.id === state.artifact.id &&
    saved.artifact.revision === saved.entry.revision;

  if (!saved || !matchesArtifact || !isAuthor(saved.entry, actor)) {
    throw new StudioError(
      'COMMIT_RESULT_UNKNOWN',
      '无法确认上次保存结果，请保留草稿并比较当前内容。',
    );
  }

  return {
    operationId,
    snapshot: { artifact: saved.artifact, content: saved.content },
    historyEntry: saved.entry,
  };
}

function applyWorkingMutation<C, O extends ContentOperation, A, S>(
  state: ArtifactState<C, A, S>,
  args: MutationArguments<O>,
  actor: Actor,
  adapter: ProductAdapter<C, O, A, S>,
): MutationResult<C> {
  requireRole(actor, ['owner', 'editor']);
  assertAlive(state.artifact);
  if (args.merge !== undefined && args.merge !== 'safe' && args.merge !== 'same-generation') {
    throw new StudioError('INVALID_ARGUMENT', 'merge 仅支持 safe 或 same-generation。');
  }

  const operationId = safeId(args.operationId ?? randomUUID(), '操作 ID');
  const operations = args.operations;
  assertMutationOperations(operations);

  const first = operations[0]!;
  const hasRestoreSelection = first.id !== undefined || first.ids !== undefined;
  const standaloneUndo = operations.length === 1 && isUndo(first) && !hasRestoreSelection;
  const fingerprint = mutationFingerprint(operations, actor, args.summary, args.merge);
  const duplicate = matchingOperation(state, operationId, fingerprint);
  if (duplicate) {
    const saved = version(state, duplicate.historyId);

    return {
      snapshot: copy({ artifact: saved.artifact, content: saved.content }),
      historyEntry: copy(saved.entry),
      changed: false,
    };
  }

  initializeVersionClocks(state, adapter);
  const expected = object(args.expectedVersions) ? args.expectedVersions : undefined;
  validateMutationRevision(state, args, operations, expected, standaloneUndo, adapter);
  validateStructuredMerge(args, expected, adapter);
  const bases = resolveMutationBases(state, operations, expected, args.merge, adapter);
  const { changedIds, restoredFrom } = applyMutationOperations(
    state,
    operations,
    actor,
    adapter,
    bases,
    expected,
  );
  adapter.validate(state.content);
  const historyEntry = makeHistory(
    state,
    actor,
    text(args.summary, restoredFrom ? '恢复作品内容' : '修改作品', 500),
    changedIds,
    {
      ...(restoredFrom ? { restoredFrom } : {}),
      ...(standaloneUndo ? { restoreMode: 'undo' } : {}),
    },
  );
  state.operations.push({ id: operationId, fingerprint, historyId: historyEntry.id });
  state.operations = state.operations
    .filter((item) => state.history.some((saved) => saved.entry.id === item.historyId))
    .slice(-500);

  return {
    snapshot: copy({ artifact: state.artifact, content: state.content }),
    historyEntry: copy(historyEntry),
    changed: true,
  };
}

function validateMutationRevision<C, O extends ContentOperation, A, S>(
  state: ArtifactState<C, A, S>,
  args: MutationArguments<O>,
  operations: O[],
  expected: Record<string, unknown> | undefined,
  standaloneUndo: boolean,
  adapter: ProductAdapter<C, O, A, S>,
): void {
  const expectedRevision = args.expectedRevision;
  const revision = state.artifact.revision;
  if (expectedRevision === undefined) {
    for (const operation of operations) {
      const targets = mutationTargets(state.content, operation, adapter);
      if (!targets || targets.some((id) => !expected || !Object.hasOwn(expected, id))) {
        throw new StudioError(
          'VERSION_REQUIRED',
          '修改已有内容前，请提供作品版本或全部目标对象的版本。',
        );
      }
    }

    return;
  }
  if (!Number.isInteger(expectedRevision) || Number(expectedRevision) < 0) {
    throw new StudioError('INVALID_ARGUMENT', '预期作品版本无效。');
  }
  if (expectedRevision === revision) {
    return;
  }

  if (standaloneUndo) {
    const target = version(state, operations[0]!.versionId);
    if (Number(expectedRevision) < target.entry.revision || Number(expectedRevision) > revision) {
      throw new StudioError('CONFLICT', '请读取包含所选操作的作品版本后再撤销。', { revision });
    }

    return;
  }
  if (!expected || !Object.keys(expected).length) {
    throw new StudioError('CONFLICT', '作品已被修改，请读取最新版本后重试。', { revision });
  }

  for (const operation of operations) {
    const targets = mutationTargets(state.content, operation, adapter);
    if (!targets) {
      throw new StudioError('CONFLICT', '整体操作需要读取最新版本后重试。', { revision });
    }
    if (targets.some((id) => typeof id !== 'string' || !Object.hasOwn(expected, id))) {
      throw new StudioError('CONFLICT', '过期提交必须核对所有目标对象的版本。', { revision });
    }
  }
}

interface MutationBase {
  unit: unknown;
  evidence?: StructuredMergeEvidence;
}

function structuredIncarnations(
  clock: UnitClock | undefined,
  expectedVersion: number,
  currentVersion: number,
) {
  const children = clock?.children;
  if (!children || children.throughVersion !== currentVersion) {
    return;
  }

  const { sinceVersion, inserted } = children;
  if (!Number.isSafeInteger(sinceVersion) || sinceVersion < 1 || sinceVersion > expectedVersion) {
    return;
  }
  if (!object(inserted)) {
    return;
  }

  const validBirths = Object.values(inserted).every(
    (version) =>
      Number.isSafeInteger(version) && version > sinceVersion && version <= currentVersion,
  );

  return validBirths ? children : undefined;
}

function validateStructuredMerge<C, O extends ContentOperation, A, S>(
  args: MutationArguments<O>,
  expected: Record<string, unknown> | undefined,
  adapter: ProductAdapter<C, O, A, S>,
) {
  if (args.merge !== 'same-generation') {
    return;
  }
  if (
    !adapter.rebaseStructured ||
    !args.operations.every((operation) => adapter.supportsStructuredMerge?.(operation))
  ) {
    throw new StudioError('INVALID_ARGUMENT', '同代合并只适用于原生文档块或清单行操作。');
  }

  const areBased = args.operations.every(
    (operation) => operation.id && expected && Object.hasOwn(expected, operation.id),
  );

  if (!areBased) {
    throw new StudioError('VERSION_REQUIRED', '同代合并需要每个目标区域的原始版本。');
  }
}

function validExpectedVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function sameUnitIncarnation(
  id: string,
  expectedVersion: number,
  currentVersion: number,
  clock: UnitClock | undefined,
) {
  return (
    !id.startsWith('$') &&
    expectedVersion >= (clock?.incarnationStart ?? 1) &&
    Boolean(currentVersion)
  );
}

function resolveMutationBases<C, O extends ContentOperation, A, S>(
  state: ArtifactState<C, A, S>,
  operations: O[],
  expected: Record<string, unknown> | undefined,
  merge: MutationArguments<O>['merge'],
  adapter: ProductAdapter<C, O, A, S>,
): Map<string, MutationBase> {
  const bases = new Map<string, MutationBase>();
  for (const [id, expectedVersion] of Object.entries(expected ?? {})) {
    if (!validExpectedVersion(expectedVersion)) {
      throw new StudioError('INVALID_ARGUMENT', '预期对象版本无效。');
    }

    const currentVersion = adapter.versionOf(state.content, id);
    if (currentVersion === expectedVersion) {
      continue;
    }

    const details = {
      elementId: id,
      expectedVersion,
      currentVersion,
      revision: state.artifact.revision,
    };
    const targetOperations = operations.filter((operation) =>
      mutationTargets(state.content, operation, adapter)?.includes(id),
    );
    const clock = state.unitClocks?.[id];
    const canRebaseUnit = sameUnitIncarnation(id, expectedVersion, currentVersion, clock);
    const permittedUpdates =
      merge === 'safe' &&
      Boolean(adapter.rebaseUpdate) &&
      targetOperations.every((operation) => operation.op === 'update');
    const incarnations =
      merge === 'same-generation'
        ? structuredIncarnations(clock, expectedVersion, currentVersion)
        : undefined;
    const permitsRebase = permittedUpdates || Boolean(incarnations);
    if (!canRebaseUnit || !targetOperations.length || !permitsRebase) {
      throw new StudioError('CONFLICT', '目标对象已被修改，未覆盖他人的编辑。', {
        ...details,
        ...mergeConflictDetails(null, null, adapter.readUnit(state.content, id), ['.']),
      });
    }

    const candidates = state.history
      .filter((saved) => adapter.versionOf(saved.content, id) === expectedVersion)
      .map((saved) => adapter.readUnit(saved.content, id));
    const base = candidates[0];
    if (base == null || candidates.some((candidate) => !jsonEqual(candidate, base))) {
      throw new StudioError('CONFLICT', '原对象版本已不可用，请保留本地修改并比较最新内容。', {
        ...details,
        ...mergeConflictDetails(null, null, adapter.readUnit(state.content, id), ['.']),
      });
    }

    const evidence = incarnations && { original: base, expectedVersion, incarnations };
    bases.set(id, { unit: copy(base), ...(evidence ? { evidence } : {}) });
  }

  return bases;
}

function rebaseMutationOperation<C, O extends ContentOperation, A, S>(
  state: ArtifactState<C, A, S>,
  operation: O,
  bases: Map<string, MutationBase>,
  expected: Record<string, unknown> | undefined,
  adapter: ProductAdapter<C, O, A, S>,
): O {
  const id = operation.id;
  if (!id) {
    return operation;
  }

  const base = bases.get(id);
  if (!base || (!base.evidence && operation.op !== 'update')) {
    return operation;
  }

  try {
    const current = adapter.readUnit(state.content, id);
    const rebased = base.evidence
      ? adapter.rebaseStructured!(operation, base.unit, current, base.evidence)
      : adapter.rebaseUpdate!(operation, base.unit, current);
    base.unit = rebased.local;

    return rebased.operation;
  } catch (error) {
    if (error instanceof StudioError && error.code === 'CONFLICT') {
      throw new StudioError(
        'CONFLICT',
        error.message,
        {
          ...(object(error.details) ? error.details : {}),
          elementId: id,
          expectedVersion: expected?.[id],
          currentVersion: adapter.versionOf(state.content, id),
          revision: state.artifact.revision,
        },
        { cause: error },
      );
    }

    throw error;
  }
}

function applyMutationOperations<C, O extends ContentOperation, A, S>(
  state: ArtifactState<C, A, S>,
  operations: O[],
  actor: Actor,
  adapter: ProductAdapter<C, O, A, S>,
  bases: Map<string, MutationBase>,
  expected: Record<string, unknown> | undefined,
): { changedIds: string[]; restoredFrom?: string } {
  const snapshot = (content: C) => adapter.snapshotMutationContent?.(content) ?? copy(content);
  const baseline = snapshot(state.content);
  const changedIds: string[] = [];
  let restoredFrom: string | undefined;
  for (const requested of operations) {
    const previous = snapshot(state.content);
    const operation = rebaseMutationOperation(state, requested, bases, expected, adapter);
    if (operation.op === 'restore') {
      const saved = version(state, operation.versionId);
      changedIds.push(
        ...restoreVersion(
          state,
          saved,
          actor,
          adapter,
          isUndo(operation),
          restoreUnitIds(operation),
          baseline,
        ),
      );
      restoredFrom = saved.entry.id;
    } else {
      changedIds.push(...adapter.apply(state.content, operation, baseline));
    }

    adapter.syncVersions?.(state.content, previous, state.unitClocks!, false, operation);
  }

  return { changedIds, restoredFrom };
}
