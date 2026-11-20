import type { Board, BoardElement, Operation } from '../../contracts/studio.js';
import { newClientId } from '../shared/client-id.js';
import { jsonEqual, mergeJson } from '../../core/shared/safe-merge.js';

export interface ContentTask {
  id: string; keys: string[]; before: Board; operations: Operation[]; sources: BoardElement[];
  summary: string; remember: boolean; state: 'queued' | 'inflight' | 'failed'; error?: string;
  args?: Record<string, unknown>;
  failure?: unknown;
  appliedSources?: BoardElement[];
  stream?: string;
  strictVersions?: Record<string, number>;
  history?: {
    prepare: () => HistoryMutation | undefined;
    rejected: (failure: unknown) => void;
    accepted?: (receipt: ContentReceipt) => void;
  };
}
export interface ContentReceipt { board: Board; historyEntry?: { id: string; revision?: number } }
interface HistoryMutation {
  before: Board;
  operations: Operation[];
  summary: string;
  accepted: (receipt: ContentReceipt) => void;
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
// Older canvas sessions could persist a rejected Undo as though it were a draft.
export function isContentDraft(task: ContentTask): boolean {
  const operation = task.operations[0];
  return !task.history && !(task.remember === false && task.operations.length === 1 && operation?.op === 'restore' && operation.data?.mode === 'undo');
}

function rejectedByService(failure: unknown): boolean {
  return object(failure) && ['CONFLICT', 'FORBIDDEN', 'NOT_FOUND', 'INVALID_ARGUMENT', 'VERSION_REQUIRED', 'VERSION_EXHAUSTED',
    'VERSION_NOT_FOUND', 'OPERATION_REUSED', 'EDIT_IN_PROGRESS', 'LOCKED', 'TRASHED', 'UNAUTHORIZED', 'UNSUPPORTED_STORAGE'].includes(String(failure.code));
}

export function applyContentIntent(base: unknown, local: unknown, current: unknown): unknown {
  if (equal(base, local)) return current;
  if (object(base) && object(local) && object(current)) {
    const result = { ...current };
    for (const key of new Set([...Object.keys(base), ...Object.keys(local)])) if (!equal(base[key], local[key])) result[key] = applyContentIntent(base[key], local[key], current[key]);
    return result;
  }
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(current) && base.length === local.length && base.length === current.length) return local.map((value, index) => applyContentIntent(base[index], value, current[index]));
  // This is an optimistic local projection. Actual writes still require the conflict-free merge below.
  if (typeof base === 'string' && typeof local === 'string' && typeof current === 'string') return mergeJson(base, local, current).result;
  return local;
}

interface Acknowledged { element: BoardElement; projected: BoardElement }
function contentTargets(board: Board, operation: Operation): string[] {
  const ids = operation.ids ?? (operation.id ? [operation.id] : operation.element?.id ? [operation.element.id] : []);
  if (operation.op === 'delete') return [...ids, ...board.elements.filter(element => element.type === 'arrow' && (typeof element.from === 'string' && ids.includes(element.from) || typeof element.to === 'string' && ids.includes(element.to))).map(element => element.id)];
  if (operation.op === 'layout') return [...(operation.ids ?? board.elements.map(element => element.id)), ...(['front', 'back', 'forward', 'backward'].includes(operation.preset ?? '') ? ['$order'] : [])];
  return ids;
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
  private listeners = new Set<{ changed: () => void; accepted: (task: ContentTask, receipt: ContentReceipt) => void }>();
  constructor(private options: {
    send: (args: Record<string, unknown>) => Promise<ContentReceipt>;
    changed: () => void;
    accepted: (task: ContentTask, receipt: ContentReceipt) => void;
  }) {}
  subscribe(listener: { changed: () => void; accepted: (task: ContentTask, receipt: ContentReceipt) => void }) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() { this.options.changed(); for (const listener of this.listeners) listener.changed(); }
  observe(board: Board) {
    if (this.observed.has(board.artifact.revision)) return;
    this.observed.add(board.artifact.revision);
    for (const element of board.elements) { const key = `${element.id}@${element.version}`; if (!this.versions.has(key)) this.versions.set(key, structuredClone(element)); }
    while (this.versions.size > 5000) this.versions.delete(this.versions.keys().next().value!);
    while (this.observed.size > 100) this.observed.delete(this.observed.values().next().value!);
  }
  source(id: string, version: number) { return this.versions.get(`${id}@${version}`); }
  get drafts() { return this.tasks.filter(isContentDraft); }
  get unconfirmedHistory() { return this.tasks.find(task => task.history && task.state === 'failed'); }
  setEnabled(enabled: boolean) { this.enabled = enabled; if (enabled) this.drain(); }
  enqueue(before: Board, operations: Operation[], summary: string, sources = before.elements, remember = true, stream?: string, operationId?: string, strictVersions?: Record<string, number>): Promise<ContentReceipt | null> {
    // Read dependencies guard CAS; only write targets own drafts and block local edits.
    const keys = [...new Set(operations.flatMap(op => contentTargets(before, op)))];
    if (operations.some(op => ['style', 'layout', 'restore', 'motion'].includes(op.op))) keys.push('$board');
    const previous = this.tasks.findLast(task => !(task.history && task.state === 'failed') && task.keys.some(key => keys.includes(key) || key === '$board' || keys.includes('$board')));
    if (previous && equal(previous.operations, operations) && (!operationId || previous.id === operationId)) return this.promises.get(previous.id) ?? Promise.resolve(null);
    let sourceElements = keys.flatMap(id => { const source = sources.find(element => element.id === id) ?? before.elements.find(element => element.id === id); return source ? [source] : []; });
    if (stream) sourceElements = overlayContent(sourceElements, this.tasks.filter(task => task.stream === stream));
    const task: ContentTask = { id: operationId ?? newClientId('op'), keys, before: structuredClone({ ...before, elements: [] }), sources: structuredClone(sourceElements), operations: structuredClone(operations), summary, remember, stream, state: 'queued', ...(strictVersions ? { strictVersions: { ...strictVersions } } : {}) };
    this.tasks.push(task);
    const completion = new Promise<ContentReceipt | null>(resolve => this.completions.set(task.id, resolve));
    this.promises.set(task.id, completion);
    this.changed(); this.drain(); return completion;
  }
  enqueueHistory(before: Board, summary: string, history: NonNullable<ContentTask['history']>) {
    if (!this.enabled || this.unconfirmedHistory) return;
    // Resolve the next stack entry only after earlier writes have acknowledged.
    this.tasks.push({
      id: newClientId('op'), keys: ['$board'], before, sources: [], operations: [],
      summary, remember: false, state: 'queued', history,
    });
    this.drain();
  }
  retry(id: string): Promise<ContentReceipt | null> { const task = this.tasks.find(item => item.id === id); if (task?.state === 'failed') { task.state = 'queued'; task.error = undefined; const promise = new Promise<ContentReceipt | null>(resolve => this.completions.set(id, resolve)); this.promises.set(id, promise); this.changed(); this.drain(); return promise; } return this.promises.get(id) ?? Promise.resolve(null); }
  restore(tasks: ContentTask[]) { this.tasks.push(...tasks.filter(isContentDraft).map(task => ({ ...task, state: 'failed' as const, error: '上次编辑尚未确认保存，请比较内容或重试。' }))); this.changed(); }
  discardFor(keys: string[]) { for (const task of this.drafts) if (task.keys.some(key => keys.includes(key))) this.discard(task.id); }
  discard(id: string) { const index = this.tasks.findIndex(item => item.id === id && item.state !== 'inflight'); if (index < 0) return; this.tasks.splice(index, 1); this.completions.get(id)?.(null); this.completions.delete(id); this.changed(); this.drain(); }
  private drain() {
    if (!this.enabled) return;
    const blocked = new Set<string>();
    for (const task of this.tasks) {
      if (task.history && task.state === 'failed') continue;
      if (task.history && task.state === 'queued' && blocked.size && !this.running.size) {
        this.rejectHistory(task, new Error('请先处理前一次未保存的修改。'), false);
        this.drain(); return;
      }
      const occupied = task.keys.some(key => blocked.has(key) || this.running.has(key)) || this.running.has('$board') || task.keys.includes('$board') && (this.running.size > 0 || blocked.size > 0);
      task.keys.forEach(key => blocked.add(key));
      if (task.state !== 'queued' || occupied || blocked.has('$board') && !task.keys.includes('$board')) continue;
      task.state = 'inflight'; task.keys.forEach(key => this.running.add(key));
      if (task.history) queueMicrotask(() => void this.run(task));
      else void this.run(task);
    }
    this.changed();
  }
  private rejectHistory(task: ContentTask, failure: unknown, uncertain: boolean) {
    this.tasks = this.tasks.filter(item => item === task ? uncertain : !(item.history && item.state === 'queued'));
    if (uncertain) {
      task.state = 'failed';
      task.failure = failure;
    } else task.history?.rejected(failure);
  }
  private prepare(task: ContentTask): Record<string, unknown> {
    const versions: Record<string, number> = {};
    const operations = structuredClone(task.operations);
    task.appliedSources = [];
    for (const key of task.keys.filter(key => key !== '$board')) {
      let base = task.sources.find(element => element.id === key);
      // A geometry ACK may include someone else's paragraphs; block operations retain their original CAS.
      const documentEdit = task.operations.some(operation => operation.op === 'document' && operation.id === key);
      const ack = task.strictVersions || documentEdit ? undefined : this.acknowledged.get(key);
      if (base && ack && ack.element.version > base.version) {
        const originalBase = base;
        const operation = task.operations.find(op => op.id === key && op.op === 'update');
        const outgoing = operations.find(op => op.id === key && op.op === 'update');
        if (operation?.changes && outgoing) {
          const candidate = applyContentIntent(base, { ...base, ...operation.changes }, ack.projected) as BoardElement;
          if (base.type === 'table' && operation.changes.data && Object.hasOwn(operation.changes.data, 'rows') && ['rowIds', 'columnIds'].some(axis => !jsonEqual(originalBase.data?.[axis], ack.element.data?.[axis]) && !jsonEqual(operation.changes?.data?.[axis], ack.element.data?.[axis]))) throw new Error('表格的行列结构已被其他人修改，请比较后选择。');
          const matrix = base.type === 'table' && ['rowIds', 'columnIds'].every(axis => jsonEqual(ack.projected.data?.[axis], candidate.data?.[axis]) && jsonEqual(ack.projected.data?.[axis], ack.element.data?.[axis]));
          if (base.type === 'table' && operation.changes.data && Object.hasOwn(operation.changes.data, 'rows') && ['rowIds', 'columnIds'].some(axis => !jsonEqual(ack.projected.data?.[axis], ack.element.data?.[axis]))) throw new Error('表格的行列结构已被其他人修改，请比较后选择。');
          // An own ACK can include someone else's merged fields. Rebase only a conflict-free local delta.
          const merged = mergeJson(ack.projected, candidate, ack.element, matrix ? ['data.rows'] : []);
          if (merged.conflicts.length) throw new Error('此处有其他人的新修改，请比较双方内容后选择。');
          const local = merged.result as BoardElement;
          outgoing.changes = Object.fromEntries(Object.keys(operation.changes).map(field => [field, local[field]]));
        } else if (task.operations.some(op => op.op === 'delete' && contentTargets({ ...task.before, elements: task.sources }, op).includes(key))) {
          const fields = (element: BoardElement) => Object.fromEntries(Object.entries(element).filter(([field]) => !['version', 'sourceRevision'].includes(field)));
          if (!jsonEqual(fields(ack.projected), fields(ack.element))) throw new Error('此对象有其他人的新修改，请比较后再删除。');
        }
        base = ack.element;
      }
      versions[key] = key === '$order' ? task.before.orderVersion ?? 0 : base?.version ?? 0;
      if (base) task.appliedSources.push(structuredClone(base));
    }
    if (task.operations.some(op => op.op === 'layout' && ['front', 'back', 'forward', 'backward'].includes(op.preset ?? ''))) versions.$order = task.before.orderVersion ?? 0;
    return { artifactId: task.before.artifact.id, operationId: task.id, ...(!task.strictVersions ? { merge: 'safe' } : {}), expectedVersions: task.strictVersions ?? versions,
      ...(task.keys.includes('$board') ? { expectedRevision: task.before.artifact.revision } : {}), operations, summary: task.summary };
  }
  private async run(task: ContentTask) {
    let submitted = false;
    try {
      if (task.history && !task.args) {
        const intent = task.history.prepare();
        if (!intent) { this.tasks = this.tasks.filter(item => item !== task); return; }
        const ids = [...new Set(intent.operations.flatMap(operation => contentTargets(intent.before, operation)))];
        task.keys.push(...ids);
        task.before = { ...intent.before, elements: [] };
        task.operations = intent.operations;
        task.sources = intent.before.elements.filter(element => ids.includes(element.id));
        task.summary = intent.summary;
        task.history.accepted = intent.accepted;
      }
      task.args ??= this.prepare(task);
      submitted = true;
      const receipt = await this.options.send(task.args);
      if (!receipt?.board) throw new Error('白板服务没有返回保存结果。');
      this.observe(receipt.board);
      for (const op of task.operations) {
        const id = op.id ?? op.element?.id, element = receipt.board.elements.find(item => item.id === id);
        if (!id || !element) continue;
        const base = task.sources.find(item => item.id === id);
        const local = op.op === 'update' && base ? { ...base, ...op.changes } : op.element;
        const previous = this.acknowledged.get(id);
        const projected = base && local && previous ? applyContentIntent(base, local, previous.projected) : local ?? element;
        this.acknowledged.set(id, { element: structuredClone(element), projected: structuredClone(projected) as BoardElement });
      }
      this.tasks = this.tasks.filter(item => item !== task);
      this.options.accepted(task, receipt);
      for (const listener of this.listeners) listener.accepted(task, receipt);
      task.history?.accepted?.(receipt);
      this.completions.get(task.id)?.(receipt); this.completions.delete(task.id); this.promises.delete(task.id);
    } catch (error) {
      if (task.history) this.rejectHistory(task, error, submitted && !rejectedByService(error));
      else { task.state = 'failed'; task.error = error instanceof Error ? error.message : String(error); task.failure = error; }
      this.completions.get(task.id)?.(null); this.completions.delete(task.id); this.promises.delete(task.id);
    } finally {
      task.keys.forEach(key => this.running.delete(key)); this.changed(); this.drain();
    }
  }
}

export function overlayContent(elements: BoardElement[], tasks: ContentTask[]): BoardElement[] {
  let result = elements;
  for (const task of tasks.filter(isContentDraft)) for (const op of task.operations) {
    if (op.op === 'update') result = result.map(element => { const base = task.sources.find(item => item.id === op.id); return element.id === op.id && base ? applyContentIntent(base, { ...base, ...op.changes }, element) as BoardElement : element; });
    else if (op.op === 'delete') { const ids = contentTargets({ ...task.before, elements: task.sources }, op); result = result.filter(element => !ids.includes(element.id)); }
    else if (op.op === 'add' && op.element?.id && !result.some(element => element.id === op.element?.id)) result = [...result, { ...op.element, version: 0 } as BoardElement];
  }
  return result;
}
