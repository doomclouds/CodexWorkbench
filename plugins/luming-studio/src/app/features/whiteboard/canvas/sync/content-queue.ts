import type { Board, BoardElement, Operation } from '../../../../../contracts/studio.js';
import { newClientId } from '../../../../shared/client-id.js';
import { jsonEqual, mergeJson } from '../../../../../shared/safe-merge.js';

export { jsonEqual as sameContentValue };

export interface ContentTask {
  id: string;
  keys: string[];
  before: Board;
  operations: Operation[];
  sources: BoardElement[];
  summary: string;
  remember: boolean;
  state: 'queued' | 'inflight' | 'failed';
  error?: string;
  args?: Record<string, unknown>;
  failure?: unknown;
  appliedSources?: BoardElement[];
  stream?: string;
  strictVersions?: Record<string, number>;
  recovered?: boolean;
  history?: {
    prepare: () => HistoryMutation | undefined;
    rejected: (failure: unknown) => void;
    accepted?: (receipt: ContentReceipt) => void;
  };
}
export interface ContentReceipt {
  board: Board;
  historyEntry?: { id: string; revision?: number };
}
interface HistoryMutation {
  before: Board;
  operations: Operation[];
  summary: string;
  accepted: (receipt: ContentReceipt) => void;
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function wireValue(value: unknown): unknown {
  const encoded = JSON.stringify(value);

  return encoded === undefined ? undefined : JSON.parse(encoded);
}

export function sameWireContentValue(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  const pending: [unknown, unknown][] = [[wireValue(left), wireValue(right)]];
  while (pending.length) {
    const [leftValue, rightValue] = pending.pop()!;
    if (leftValue === rightValue) {
      continue;
    }

    if (Array.isArray(leftValue)) {
      if (!Array.isArray(rightValue) || leftValue.length !== rightValue.length) {
        return false;
      }

      for (let index = 0; index < leftValue.length; index++) {
        pending.push([leftValue[index], rightValue[index]]);
      }
      continue;
    }
    if (!object(leftValue) || !object(rightValue)) {
      return false;
    }

    const keys = Object.keys(leftValue);
    if (keys.length !== Object.keys(rightValue).length) {
      return false;
    }

    for (const key of keys) {
      if (!Object.hasOwn(rightValue, key)) {
        return false;
      }

      pending.push([leftValue[key], rightValue[key]]);
    }
  }

  return true;
}

export function sameContentOperations(
  left: readonly Operation[],
  right: readonly Operation[],
): boolean {
  return left.length === right.length && sameWireContentValue(left, right);
}

export function isContentDraft(task: ContentTask): boolean {
  const operation = task.operations[0];
  const legacyUndo = task.remember === false && task.operations.length === 1;
  const restoresPreviousVersion = operation?.op === 'restore' && operation.data?.mode === 'undo';

  return !task.history && !(legacyUndo && restoresPreviousVersion);
}

function rejectedByService(failure: unknown): boolean {
  return (
    object(failure) &&
    [
      'CONFLICT',
      'FORBIDDEN',
      'NOT_FOUND',
      'INVALID_ARGUMENT',
      'VERSION_REQUIRED',
      'VERSION_EXHAUSTED',
      'VERSION_NOT_FOUND',
      'OPERATION_REUSED',
      'EDIT_IN_PROGRESS',
      'LOCKED',
      'TRASHED',
      'UNAUTHORIZED',
      'UNSUPPORTED_STORAGE',
    ].includes(String(failure.code))
  );
}

export function applyContentIntent(base: unknown, local: unknown, current: unknown): unknown {
  if (jsonEqual(base, local)) {
    return current;
  }

  if (object(base) && object(local) && object(current)) {
    const result = { ...current };
    for (const key of new Set([...Object.keys(base), ...Object.keys(local)])) {
      if (!jsonEqual(base[key], local[key])) {
        result[key] = applyContentIntent(base[key], local[key], current[key]);
      }
    }

    return result;
  }
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(current)) {
    if (base.length === local.length && base.length === current.length) {
      return local.map((value, index) => applyContentIntent(base[index], value, current[index]));
    }
  }

  if (typeof base === 'string' && typeof local === 'string' && typeof current === 'string') {
    return mergeJson(base, local, current).result;
  }

  return local;
}

interface Acknowledged {
  element: BoardElement;
  projected: BoardElement;
}

function contentTargets(board: Board, operation: Operation): string[] {
  const id = operation.id || operation.element?.id;
  const ids = operation.ids ?? (id ? [id] : []);
  if (operation.op === 'delete') {
    return [
      ...ids,
      ...board.elements
        .filter(
          (element) =>
            element.type === 'arrow' &&
            ((typeof element.from === 'string' && ids.includes(element.from)) ||
              (typeof element.to === 'string' && ids.includes(element.to))),
        )
        .map((element) => element.id),
    ];
  }
  if (operation.op === 'layout') {
    return [
      ...(operation.ids ?? board.elements.map((element) => element.id)),
      ...(['front', 'back', 'forward', 'backward'].includes(operation.preset ?? '')
        ? ['$order']
        : []),
    ];
  }

  return ids;
}

const tableAxes = ['rowIds', 'columnIds'] as const;

function hasSameTableAxes(left: BoardElement, right: BoardElement) {
  return tableAxes.every((axis) => jsonEqual(left.data?.[axis], right.data?.[axis]));
}

function validateTableRowTargets(
  base: BoardElement,
  changes: Partial<BoardElement>,
  acknowledgment: Acknowledged,
) {
  const data = changes.data;
  if (base.type !== 'table' || !data || !Object.hasOwn(data, 'rows')) {
    return;
  }

  const targetsChanged = tableAxes.some((axis) => {
    const savedIds = acknowledgment.element.data?.[axis];

    return !jsonEqual(base.data?.[axis], savedIds) && !jsonEqual(data[axis], savedIds);
  });

  if (targetsChanged || !hasSameTableAxes(acknowledgment.projected, acknowledgment.element)) {
    throw new Error('表格的行列结构已被其他人修改，请比较后选择。');
  }
}

function rebaseUpdate(
  base: BoardElement,
  changes: Partial<BoardElement>,
  acknowledgment: Acknowledged,
): Partial<BoardElement> {
  validateTableRowTargets(base, changes, acknowledgment);
  const { projected, element } = acknowledgment;
  const candidate = applyContentIntent(base, { ...base, ...changes }, projected) as BoardElement;
  const stableTableAxes =
    base.type === 'table' &&
    hasSameTableAxes(projected, candidate) &&
    hasSameTableAxes(projected, element);
  const merged = mergeJson(projected, candidate, element, stableTableAxes ? ['data.rows'] : []);
  if (merged.conflicts.length) {
    throw new Error('此处有其他人的新修改，请比较双方内容后选择。');
  }

  const local = merged.result as BoardElement;

  return Object.fromEntries(Object.keys(changes).map((field) => [field, local[field]]));
}

function contentWithoutVersions(element: BoardElement) {
  return Object.fromEntries(
    Object.entries(element).filter(([field]) => !['version', 'sourceRevision'].includes(field)),
  );
}

function targetsDeletion(task: ContentTask, key: string) {
  const sources = { ...task.before, elements: task.sources };

  return task.operations.some(
    (operation) => operation.op === 'delete' && contentTargets(sources, operation).includes(key),
  );
}

function canRetryAsSameOperation(
  previous: ContentTask,
  operations: Operation[],
  operationId?: string,
) {
  return (
    (!operationId || previous.id === operationId) &&
    sameContentOperations(previous.operations, operations)
  );
}

function notifyContentListener(message: string, listener: () => void) {
  try {
    listener();
  } catch (cause) {
    console.error(message, cause);
  }
}

export class NativeContentQueue {
  tasks: ContentTask[] = [];
  private enabled = true;
  private running = new Set<string>();
  private acknowledged = new Map<string, Acknowledged>();
  private completions = new Map<string, (receipt: ContentReceipt | null) => void>();
  private promises = new Map<string, Promise<ContentReceipt | null>>();
  private versions = new Map<string, BoardElement>();
  private observed = new Set<number>();
  private listeners = new Set<{
    changed: () => void;
    accepted: (task: ContentTask, receipt: ContentReceipt) => void;
  }>();
  constructor(
    private options: {
      send: (args: Record<string, unknown>) => Promise<ContentReceipt>;
      confirm?: (args: Record<string, unknown>) => Promise<ContentReceipt>;
      changed: () => void;
      accepted: (task: ContentTask, receipt: ContentReceipt) => void;
    },
  ) {}
  setSender(
    send: (args: Record<string, unknown>) => Promise<ContentReceipt>,
    confirm = this.options.confirm,
  ) {
    this.options = { ...this.options, send, confirm };
  }
  subscribe(listener: {
    changed: () => void;
    accepted: (task: ContentTask, receipt: ContentReceipt) => void;
  }) {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }
  private changed() {
    notifyContentListener('白板保存状态通知失败。', () => this.options.changed());
    for (const listener of this.listeners) {
      notifyContentListener('白板保存状态订阅通知失败。', () => listener.changed());
    }
  }
  observe(board: Board) {
    if (this.observed.has(board.artifact.revision)) {
      return;
    }

    this.observed.add(board.artifact.revision);
    for (const element of board.elements) {
      const key = `${element.id}@${element.version}`;
      if (!this.versions.has(key)) {
        this.versions.set(key, structuredClone(element));
      }
    }

    while (this.versions.size > 5000) {
      this.versions.delete(this.versions.keys().next().value!);
    }

    while (this.observed.size > 100) {
      this.observed.delete(this.observed.values().next().value!);
    }
  }
  source(id: string, version: number) {
    return this.versions.get(`${id}@${version}`);
  }
  get drafts() {
    return this.tasks.filter(isContentDraft);
  }
  get unconfirmedHistory() {
    return this.tasks.find((task) => task.history && task.state === 'failed');
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (enabled) {
      this.drain();
    }
  }
  enqueue(
    before: Board,
    operations: Operation[],
    summary: string,
    sources = before.elements,
    remember = true,
    stream?: string,
    operationId?: string,
    strictVersions?: Record<string, number>,
  ): Promise<ContentReceipt | null> {
    const keys = [...new Set(operations.flatMap((op) => contentTargets(before, op)))];
    if (
      operations.some(
        (op) =>
          ['style', 'layout', 'restore', 'motion'].includes(op.op) ||
          (op.op === 'add' && op.data?.beforeId !== undefined),
      )
    ) {
      keys.push('$board');
    }

    const previous = this.tasks.findLast(
      (task) =>
        !(task.history && task.state === 'failed') &&
        task.keys.some((key) => keys.includes(key) || key === '$board' || keys.includes('$board')),
    );

    if (previous && canRetryAsSameOperation(previous, operations, operationId)) {
      return this.promises.get(previous.id) ?? Promise.resolve(null);
    }

    let sourceElements = keys.flatMap((id) => {
      const source =
        sources.find((element) => element.id === id) ??
        before.elements.find((element) => element.id === id);

      return source ? [source] : [];
    });

    if (stream) {
      sourceElements = overlayContent(
        sourceElements,
        this.tasks.filter((task) => task.stream === stream),
      );
    }

    const task: ContentTask = {
      id: operationId ?? newClientId('op'),
      keys,
      before: structuredClone({ ...before, elements: [] }),
      sources: structuredClone(sourceElements),
      operations: structuredClone(operations),
      summary,
      remember,
      stream,
      state: 'queued',
      ...(strictVersions ? { strictVersions: { ...strictVersions } } : {}),
    };
    this.tasks.push(task);
    const completion = new Promise<ContentReceipt | null>((resolve) => {
      this.completions.set(task.id, resolve);
    });
    this.promises.set(task.id, completion);
    this.changed();
    this.drain();

    return completion;
  }
  enqueueHistory(before: Board, summary: string, history: NonNullable<ContentTask['history']>) {
    if (!this.enabled || this.unconfirmedHistory) {
      return;
    }

    this.tasks.push({
      id: newClientId('op'),
      keys: ['$board'],
      before,
      sources: [],
      operations: [],
      summary,
      remember: false,
      state: 'queued',
      history,
    });
    this.drain();
  }
  retry(id: string): Promise<ContentReceipt | null> {
    const task = this.tasks.find((item) => item.id === id);
    if (task?.state === 'failed') {
      task.state = 'queued';
      task.error = undefined;
      const promise = new Promise<ContentReceipt | null>((resolve) => {
        this.completions.set(id, resolve);
      });
      this.promises.set(id, promise);
      this.changed();
      this.drain();

      return promise;
    }

    return this.promises.get(id) ?? Promise.resolve(null);
  }
  restore(tasks: ContentTask[]) {
    this.tasks.push(
      ...tasks.filter(isContentDraft).map((task) => ({
        ...task,
        state: 'failed' as const,
        recovered: true,
        error: '上次编辑尚未确认保存，请比较内容或核对保存结果。',
      })),
    );
    this.changed();
  }
  discardFor(keys: string[]) {
    for (const task of this.drafts) {
      if (task.keys.some((key) => keys.includes(key))) {
        this.discard(task.id);
      }
    }
  }
  discard(id: string) {
    const index = this.tasks.findIndex((item) => item.id === id && item.state !== 'inflight');
    if (index < 0) {
      return;
    }

    this.tasks.splice(index, 1);
    this.completions.get(id)?.(null);
    this.completions.delete(id);
    this.changed();
    this.drain();
  }
  private drain() {
    if (!this.enabled) {
      return;
    }

    const blocked = new Set<string>();
    for (const task of this.tasks) {
      if (task.history && task.state === 'failed') {
        continue;
      }

      const waitingHistory = task.history && task.state === 'queued';
      const waitingForDraft = blocked.size && !this.running.size;
      if (waitingHistory && waitingForDraft) {
        this.rejectHistory(task, new Error('请先处理前一次未保存的修改。'), false);
        this.drain();

        return;
      }

      const occupied =
        task.keys.some((key) => blocked.has(key) || this.running.has(key)) ||
        this.running.has('$board') ||
        (task.keys.includes('$board') && (this.running.size > 0 || blocked.size > 0));
      task.keys.forEach((key) => blocked.add(key));
      const waitingForBoard = blocked.has('$board') && !task.keys.includes('$board');
      if (task.state !== 'queued' || occupied || waitingForBoard) {
        continue;
      }

      task.state = 'inflight';
      task.keys.forEach((key) => this.running.add(key));
      if (task.history) {
        queueMicrotask(() => this.startTask(task));
      } else {
        this.startTask(task);
      }
    }

    this.changed();
  }
  private startTask(task: ContentTask) {
    this.run(task).catch((error: unknown) => {
      queueMicrotask(() => {
        throw error;
      });
    });
  }
  private rejectHistory(task: ContentTask, failure: unknown, uncertain: boolean) {
    this.tasks = this.tasks.filter((item) =>
      item === task ? uncertain : !(item.history && item.state === 'queued'),
    );

    if (uncertain) {
      task.state = 'failed';
      task.failure = failure;
    } else if (task.history) {
      notifyContentListener('白板历史操作的失败通知未送达。', () =>
        task.history?.rejected(failure),
      );
    }
  }
  private prepare(task: ContentTask): Record<string, unknown> {
    const versions: Record<string, number> = {};
    const operations = structuredClone(task.operations);
    const nativeSections =
      operations.length > 0 &&
      operations.every((operation) => operation.op === 'document' || operation.op === 'todo');
    task.appliedSources = [];
    for (const key of task.keys.filter((key) => key !== '$board')) {
      const base = this.rebaseTarget(task, operations, key, nativeSections);
      versions[key] = key === '$order' ? (task.before.orderVersion ?? 0) : (base?.version ?? 0);
      if (base) {
        task.appliedSources.push(structuredClone(base));
      }
    }

    if (
      task.operations.some(
        (op) =>
          op.op === 'layout' && ['front', 'back', 'forward', 'backward'].includes(op.preset ?? ''),
      )
    ) {
      versions.$order = task.before.orderVersion ?? 0;
    }

    const matchingVersions =
      nativeSections &&
      operations.every(
        (operation) => typeof operation.id === 'string' && (versions[operation.id] ?? 0) > 0,
      );
    const merge = matchingVersions ? 'same-generation' : 'safe';
    return {
      artifactId: task.before.artifact.id,
      operationId: task.id,
      ...(!task.strictVersions ? { merge } : {}),
      expectedVersions: task.strictVersions ?? versions,
      ...(task.keys.includes('$board') ? { expectedRevision: task.before.artifact.revision } : {}),
      operations,
      summary: task.summary,
    };
  }
  private rebaseTarget(
    task: ContentTask,
    operations: Operation[],
    key: string,
    nativeSections: boolean,
  ) {
    const base = task.sources.find((element) => element.id === key);
    const documentEdit = task.operations.some(
      (operation) => operation.op === 'document' && operation.id === key,
    );
    const acknowledgment =
      task.strictVersions || documentEdit || nativeSections
        ? undefined
        : this.acknowledged.get(key);

    if (!base || !acknowledgment || acknowledgment.element.version <= base.version) {
      return base;
    }

    const original = task.operations.find((op) => op.id === key && op.op === 'update');
    const outgoing = operations.find((op) => op.id === key && op.op === 'update');
    if (original?.changes && outgoing) {
      outgoing.changes = rebaseUpdate(base, original.changes, acknowledgment);

      return acknowledgment.element;
    }
    if (
      targetsDeletion(task, key) &&
      !jsonEqual(
        contentWithoutVersions(acknowledgment.projected),
        contentWithoutVersions(acknowledgment.element),
      )
    ) {
      throw new Error('此对象有其他人的新修改，请比较后再删除。');
    }

    return acknowledgment.element;
  }
  private rememberAcknowledgment(task: ContentTask, receipt: ContentReceipt) {
    this.observe(receipt.board);
    for (const op of task.operations) {
      const id = op.id ?? op.element?.id;
      const element = receipt.board.elements.find((item) => item.id === id);
      if (!id || !element) {
        continue;
      }

      const base = task.sources.find((item) => item.id === id);
      const local = op.op === 'update' && base ? { ...base, ...op.changes } : op.element;
      const previous = this.acknowledged.get(id);
      const projected =
        base && local && previous
          ? applyContentIntent(base, local, previous.projected)
          : (local ?? element);
      this.acknowledged.set(id, {
        element: structuredClone(element),
        projected: structuredClone(projected) as BoardElement,
      });
    }
  }
  private prepareHistory(task: ContentTask): boolean {
    if (!task.history || task.args) {
      return true;
    }

    const intent = task.history.prepare();
    if (!intent) {
      this.tasks = this.tasks.filter((item) => item !== task);

      return false;
    }

    const ids = [
      ...new Set(
        intent.operations.flatMap((operation) => contentTargets(intent.before, operation)),
      ),
    ];
    task.keys.push(...ids);
    task.before = { ...intent.before, elements: [] };
    task.operations = intent.operations;
    task.sources = intent.before.elements.filter((element) => ids.includes(element.id));
    task.summary = intent.summary;
    task.history.accepted = intent.accepted;

    return true;
  }
  private takeCompletion(id: string) {
    const complete = this.completions.get(id);
    this.completions.delete(id);
    this.promises.delete(id);

    return complete;
  }
  private acceptTask(task: ContentTask, receipt: ContentReceipt) {
    const complete = this.takeCompletion(task.id);
    this.tasks = this.tasks.filter((item) => item !== task);
    notifyContentListener('白板保存成功通知失败。', () => this.options.accepted(task, receipt));
    for (const listener of this.listeners) {
      notifyContentListener('白板保存回执订阅通知失败。', () => listener.accepted(task, receipt));
    }
    if (task.history?.accepted) {
      notifyContentListener('白板历史操作的成功通知未送达。', () =>
        task.history?.accepted?.(receipt),
      );
    }
    complete?.(receipt);
  }
  private rejectTask(task: ContentTask, error: unknown, submitted: boolean) {
    const complete = this.takeCompletion(task.id);
    if (submitted && object(error) && error.code === 'COMMIT_RESULT_UNKNOWN') {
      task.recovered = true;
    }
    if (task.history) {
      const uncertain = task.recovered || (submitted && !rejectedByService(error));
      this.rejectHistory(task, error, uncertain);
    } else {
      task.state = 'failed';
      task.error = error instanceof Error ? error.message : String(error);
      task.failure = error;
    }
    complete?.(null);
  }
  private confirmRecovered(task: ContentTask) {
    if (!task.args || !this.options.confirm) {
      throw new Error('缺少可查证的原提交，请保留草稿并比较当前内容。');
    }

    return this.options.confirm(task.args);
  }
  private async run(task: ContentTask) {
    let submitted = false;
    try {
      let receipt: ContentReceipt;
      try {
        if (!this.prepareHistory(task)) {
          return;
        }

        if (task.recovered) {
          receipt = await this.confirmRecovered(task);
        } else {
          task.args ??= this.prepare(task);
          submitted = true;
          receipt = await this.options.send(task.args);
        }
        if (!receipt?.board) {
          throw new Error('白板服务没有返回保存结果。');
        }

        this.rememberAcknowledgment(task, receipt);
      } catch (error) {
        this.rejectTask(task, error, submitted);

        return;
      }

      this.acceptTask(task, receipt);
    } finally {
      task.keys.forEach((key) => this.running.delete(key));
      this.changed();
      this.drain();
    }
  }
}

function overlayAddedElement(elements: BoardElement[], operation: Operation): BoardElement[] {
  const element = operation.element;
  if (!element?.id || elements.some((current) => current.id === element.id)) {
    return elements;
  }

  const beforeId = operation.data?.beforeId;
  const index =
    beforeId === undefined
      ? elements.length
      : elements.findIndex((current) => current.id === beforeId);

  if (index < 0) {
    return elements;
  }

  return [
    ...elements.slice(0, index),
    { ...element, version: 0 } as BoardElement,
    ...elements.slice(index),
  ];
}

export function overlayContent(elements: BoardElement[], tasks: ContentTask[]): BoardElement[] {
  let result = elements;
  for (const task of tasks.filter(isContentDraft)) {
    for (const op of task.operations) {
      if (op.op === 'update') {
        result = result.map((element) => {
          const base = task.sources.find((item) => item.id === op.id);

          return element.id === op.id && base
            ? (applyContentIntent(base, { ...base, ...op.changes }, element) as BoardElement)
            : element;
        });
      } else if (op.op === 'delete') {
        const ids = contentTargets({ ...task.before, elements: task.sources }, op);
        result = result.filter((element) => !ids.includes(element.id));
      } else if (op.op === 'add') {
        result = overlayAddedElement(result, op);
      }
    }
  }

  return result;
}
