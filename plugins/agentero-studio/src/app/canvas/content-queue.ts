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
}
export interface ContentReceipt { board: Board; historyEntry?: { id: string } }
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

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
  private histories = new Map<number, string>();
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
  historyId(revision: number) { return this.histories.get(revision); }
  setEnabled(enabled: boolean) { this.enabled = enabled; if (enabled) this.drain(); }
  enqueue(before: Board, operations: Operation[], summary: string, sources = before.elements, remember = true, stream?: string): Promise<ContentReceipt | null> {
    const keys = [...new Set(operations.flatMap(op => contentTargets(before, op)))];
    if (operations.some(op => ['style', 'layout', 'restore', 'motion'].includes(op.op))) keys.push('$board');
    const previous = this.tasks.findLast(task => task.keys.some(key => keys.includes(key) || key === '$board' || keys.includes('$board')));
    if (previous && equal(previous.operations, operations)) return this.promises.get(previous.id) ?? Promise.resolve(null);
    let sourceElements = keys.flatMap(id => { const source = sources.find(element => element.id === id) ?? before.elements.find(element => element.id === id); return source ? [source] : []; });
    if (stream) sourceElements = overlayContent(sourceElements, this.tasks.filter(task => task.stream === stream));
    const task: ContentTask = { id: newClientId('op'), keys, before: structuredClone({ ...before, elements: [] }), sources: structuredClone(sourceElements), operations: structuredClone(operations), summary, remember, stream, state: 'queued' };
    this.tasks.push(task);
    const completion = new Promise<ContentReceipt | null>(resolve => this.completions.set(task.id, resolve));
    this.promises.set(task.id, completion);
    this.changed(); this.drain(); return completion;
  }
  retry(id: string): Promise<ContentReceipt | null> { const task = this.tasks.find(item => item.id === id); if (task?.state === 'failed') { task.state = 'queued'; task.error = undefined; const promise = new Promise<ContentReceipt | null>(resolve => this.completions.set(id, resolve)); this.promises.set(id, promise); this.changed(); this.drain(); return promise; } return this.promises.get(id) ?? Promise.resolve(null); }
  restore(tasks: ContentTask[]) { this.tasks.push(...tasks.map(task => ({ ...task, state: 'failed' as const, error: '上次编辑尚未确认保存，请比较内容或重试。' }))); this.changed(); }
  discardFor(keys: string[]) { for (const task of [...this.tasks]) if (task.keys.some(key => keys.includes(key))) this.discard(task.id); }
  discard(id: string) { const index = this.tasks.findIndex(item => item.id === id && item.state !== 'inflight'); if (index < 0) return; this.tasks.splice(index, 1); this.completions.get(id)?.(null); this.completions.delete(id); this.changed(); this.drain(); }
  private drain() {
    if (!this.enabled) return;
    const blocked = new Set<string>();
    for (const task of this.tasks) {
      const occupied = task.keys.some(key => blocked.has(key) || this.running.has(key)) || this.running.has('$board') || task.keys.includes('$board') && (this.running.size > 0 || blocked.size > 0);
      task.keys.forEach(key => blocked.add(key));
      if (task.state !== 'queued' || occupied || blocked.has('$board') && !task.keys.includes('$board')) continue;
      task.state = 'inflight'; task.keys.forEach(key => this.running.add(key));
      void this.run(task);
    }
    this.changed();
  }
  private prepare(task: ContentTask): Record<string, unknown> {
    const versions: Record<string, number> = {};
    const operations = structuredClone(task.operations);
    task.appliedSources = [];
    for (const key of task.keys.filter(key => key !== '$board')) {
      let base = task.sources.find(element => element.id === key);
      const ack = this.acknowledged.get(key);
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
    return { artifactId: task.before.artifact.id, operationId: task.id, merge: 'safe', expectedVersions: versions,
      ...(task.keys.includes('$board') ? { expectedRevision: task.before.artifact.revision } : {}), operations, summary: task.summary };
  }
  private async run(task: ContentTask) {
    try {
      task.args ??= this.prepare(task);
      const receipt = await this.options.send(task.args);
      if (!receipt?.board) throw new Error('白板服务没有返回保存结果。');
      this.observe(receipt.board);
      if (receipt.historyEntry?.id) this.histories.set(receipt.board.artifact.revision, receipt.historyEntry.id);
      while (this.histories.size > 100) this.histories.delete(this.histories.keys().next().value!);
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
      this.completions.get(task.id)?.(receipt); this.completions.delete(task.id); this.promises.delete(task.id);
    } catch (error) {
      task.state = 'failed'; task.error = error instanceof Error ? error.message : String(error); task.failure = error;
      this.completions.get(task.id)?.(null); this.completions.delete(task.id); this.promises.delete(task.id);
    } finally {
      task.keys.forEach(key => this.running.delete(key)); this.changed(); this.drain();
    }
  }
}

export function overlayContent(elements: BoardElement[], tasks: ContentTask[]): BoardElement[] {
  let result = elements;
  for (const task of tasks) for (const op of task.operations) {
    if (op.op === 'update') result = result.map(element => { const base = task.sources.find(item => item.id === op.id); return element.id === op.id && base ? applyContentIntent(base, { ...base, ...op.changes }, element) as BoardElement : element; });
    else if (op.op === 'delete') { const ids = contentTargets({ ...task.before, elements: task.sources }, op); result = result.filter(element => !ids.includes(element.id)); }
    else if (op.op === 'add' && op.element?.id && !result.some(element => element.id === op.element?.id)) result = [...result, { ...op.element, version: 0 } as BoardElement];
  }
  return result;
}
