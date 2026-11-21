import {
  isBoardElementFields,
  isBoardElementProjection,
  isBoardProjection,
} from '../../contracts/board-shape.js';
import type { BoardElement, Operation } from '../../contracts/studio.js';
import { isContentDraft, sameContentValue, type ContentTask } from './content-queue.js';
import type { NativeTableDraft } from './NativeTable.js';

export interface TextDraft {
  id: string;
  text: string;
  base?: BoardElement;
  initialText?: string;
}

export type PropertyDrafts = Record<string, { base: BoardElement; changes: Partial<BoardElement> }>;

export interface CanvasDraft {
  text?: TextDraft | null;
  properties?: PropertyDrafts;
  tables?: Record<string, NativeTableDraft>;
  tasks?: ContentTask[];
}

export interface CanvasDraftRecovery {
  draft: CanvasDraft | null;
  unreadableDraft?: string;
  retainedDrafts?: string[];
  error: string;
  discardEmpty: boolean;
}

type JsonRecord = Record<string, unknown>;
type FieldValidator = (value: unknown) => boolean;
type DraftEntry = { base: BoardElement; changes: Partial<BoardElement> };

const draftKinds: ReadonlySet<string> = new Set<Operation['op']>([
  'add',
  'update',
  'delete',
  'layout',
  'style',
  'restore',
  'motion',
  'document',
  'todo',
]);

function record(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === 'string';
}

function identifier(value: unknown): value is string {
  return text(value) && value.length > 0;
}

function number(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function revision(value: unknown): value is number {
  return number(value) && Number.isSafeInteger(value) && value >= 0;
}

function boolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function someOf<T extends string>(...values: T[]) {
  const allowed: ReadonlySet<string> = new Set(values);

  return (value: unknown): value is T => text(value) && allowed.has(value);
}

function arrayOf<T>(value: unknown, accepts: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(accepts);
}

function optionalFields(value: JsonRecord, validators: Record<string, FieldValidator>) {
  return Object.entries(validators).every(
    ([key, accepts]) => !Object.hasOwn(value, key) || accepts(value[key]),
  );
}

function stringRecord(value: unknown) {
  return record(value) && Object.values(value).every(text);
}

function draftOperation(value: unknown): value is Operation {
  if (!record(value) || !text(value.op) || !draftKinds.has(value.op)) {
    return false;
  }

  return optionalFields(value, {
    id: identifier,
    ids: (ids) => arrayOf(ids, identifier),
    element: isBoardElementFields,
    changes: isBoardElementFields,
    data: record,
    preset: text,
    style: stringRecord,
    versionId: identifier,
  });
}

function versions(value: unknown): value is Record<string, number> {
  return record(value) && Object.values(value).every(revision);
}

function operationTargetsMatch(prepared: Operation, original: Operation) {
  const typeAndIdMatch = prepared.op === original.op && prepared.id === original.id;
  const elementMatches = prepared.element?.id === original.element?.id;

  return typeAndIdMatch && elementMatches && sameContentValue(prepared.ids, original.ids);
}

function belongsToTask(args: unknown, id: string, artifactId: string, operations: Operation[]) {
  if (!record(args) || args.operationId !== id || args.artifactId !== artifactId) {
    return false;
  }
  if (!arrayOf(args.operations, draftOperation) || args.operations.length !== operations.length) {
    return false;
  }

  return (
    args.operations.every((prepared, index) =>
      operationTargetsMatch(prepared, operations[index]!),
    ) &&
    optionalFields(args, {
      expectedVersions: versions,
      expectedRevision: revision,
      summary: text,
    })
  );
}

function contentTask(value: unknown, artifactId: string): value is ContentTask {
  if (!record(value) || !identifier(value.id) || !isBoardProjection(value.before)) {
    return false;
  }
  if (
    value.before.artifact.id !== artifactId ||
    !arrayOf(value.keys, identifier) ||
    !arrayOf(value.sources, isBoardElementProjection)
  ) {
    return false;
  }
  if (
    !arrayOf(value.operations, draftOperation) ||
    !text(value.summary) ||
    !boolean(value.remember)
  ) {
    return false;
  }
  if (
    value.args !== undefined &&
    !belongsToTask(value.args, value.id, artifactId, value.operations)
  ) {
    return false;
  }

  return (
    someOf('failed', 'queued', 'inflight')(value.state) &&
    optionalFields(value, {
      strictVersions: versions,
      appliedSources: (sources) => arrayOf(sources, isBoardElementProjection),
      error: text,
      stream: identifier,
    })
  );
}

function textDraft(value: unknown): value is TextDraft {
  if (!record(value) || !identifier(value.id) || !text(value.text)) {
    return false;
  }

  return optionalFields(value, {
    initialText: text,
    base: (base) => isBoardElementProjection(base) && base.id === value.id,
  });
}

function draftEntry(value: unknown, id: string): value is DraftEntry {
  if (!record(value) || !isBoardElementProjection(value.base) || value.base.id !== id) {
    return false;
  }

  return isBoardElementFields(value.changes);
}

function decodeDraftEntries(entries: unknown, tableOnly = false) {
  const pairs: [string, DraftEntry][] = [];
  if (!record(entries)) {
    return { values: {}, unreadable: entries !== undefined };
  }

  let unreadable = false;
  for (const [id, value] of Object.entries(entries)) {
    if (draftEntry(value, id) && (!tableOnly || value.base.type === 'table')) {
      pairs.push([id, value]);
    } else {
      unreadable = true;
    }
  }

  return { values: Object.fromEntries(pairs), unreadable };
}

function decodeTasks(tasks: unknown, artifactId: string) {
  const values: ContentTask[] = [];
  if (!Array.isArray(tasks)) {
    return { values, unreadable: tasks !== undefined };
  }

  let unreadable = false;
  for (const task of tasks) {
    if (contentTask(task, artifactId)) {
      if (isContentDraft(task)) {
        values.push(task);
      }
    } else {
      unreadable = true;
    }
  }

  return { values, unreadable };
}

function unreadableDraft(raw: string): CanvasDraftRecovery {
  return { draft: null, unreadableDraft: raw, error: '', discardEmpty: false };
}

export function decodeCanvasDraft(raw: string, artifactId: string): CanvasDraftRecovery {
  try {
    const decoded: unknown = JSON.parse(raw);
    if (!record(decoded)) {
      return unreadableDraft(raw);
    }

    const recoveredText = textDraft(decoded.text) ? decoded.text : undefined;
    const properties = decodeDraftEntries(decoded.properties);
    const tables = decodeDraftEntries(decoded.tables, true);
    const tasks = decodeTasks(decoded.tasks, artifactId);
    const unreadableText = decoded.text !== undefined && decoded.text !== null && !recoveredText;
    const invalidBackup = decoded.unreadableDraft !== undefined && !text(decoded.unreadableDraft);
    const retainedDrafts = arrayOf(decoded.retainedDrafts, text)
      ? decoded.retainedDrafts
      : undefined;
    const invalidRetained = decoded.retainedDrafts !== undefined && !retainedDrafts;
    const recognizedKeys = [
      'text',
      'properties',
      'tables',
      'tasks',
      'unreadableDraft',
      'retainedDrafts',
    ];
    const unknownKeys = Object.keys(decoded).some((key) => !recognizedKeys.includes(key));
    const hasUnreadable = [
      unreadableText,
      properties.unreadable,
      tables.unreadable,
      tasks.unreadable,
      invalidBackup,
      invalidRetained,
      unknownKeys,
    ].some(Boolean);
    const savedRaw = hasUnreadable ? raw : decoded.unreadableDraft;
    const hasDraft =
      recoveredText ||
      Object.keys(properties.values).length ||
      Object.keys(tables.values).length ||
      tasks.values.length;

    return {
      draft: hasDraft
        ? {
            text: recoveredText,
            properties: properties.values,
            tables: tables.values,
            tasks: tasks.values,
          }
        : null,
      unreadableDraft: text(savedRaw) ? savedRaw : undefined,
      retainedDrafts,
      error: '',
      discardEmpty: !hasDraft && savedRaw === undefined && !retainedDrafts?.length,
    };
  } catch (failure) {
    if (!(failure instanceof SyntaxError) && !(failure instanceof RangeError)) {
      throw failure;
    }

    return unreadableDraft(raw);
  }
}

export function canvasDraftForStorage(
  editing: TextDraft | null,
  textDirty: boolean,
  properties: PropertyDrafts,
  tables: Record<string, NativeTableDraft>,
  tasks: ContentTask[],
): CanvasDraft | null {
  const dirty =
    textDirty ||
    Object.keys(properties).length > 0 ||
    Object.keys(tables).length > 0 ||
    tasks.length > 0;

  return dirty ? { text: textDirty ? editing : undefined, properties, tables, tasks } : null;
}

export function encodeCanvasDraft(
  active: CanvasDraft | null,
  recovery: CanvasDraftRecovery,
): string | null {
  const { draft, unreadableDraft, retainedDrafts = [] } = recovery;
  const contents = active ?? draft;
  const backups = active && draft ? [JSON.stringify(draft), ...retainedDrafts] : retainedDrafts;
  if (!contents && unreadableDraft === undefined && !backups.length) {
    return null;
  }

  return JSON.stringify({
    ...contents,
    unreadableDraft,
    retainedDrafts: backups.length ? backups : undefined,
  });
}

export function promoteCanvasDraft(
  recovery: CanvasDraftRecovery,
  artifactId: string,
): CanvasDraftRecovery {
  const [next, ...remaining] = recovery.retainedDrafts ?? [];
  if (recovery.draft || recovery.unreadableDraft !== undefined || next === undefined) {
    return recovery;
  }

  const decoded = decodeCanvasDraft(next, artifactId);
  const unreadableDraft = recovery.unreadableDraft ?? decoded.unreadableDraft;

  return {
    ...decoded,
    unreadableDraft,
    retainedDrafts: [...(decoded.retainedDrafts ?? []), ...remaining],
    discardEmpty: false,
  };
}

export function readCanvasDraft(
  key: string,
  artifactId: string,
  preview?: boolean,
): CanvasDraftRecovery {
  if (preview) {
    return { draft: null, error: '', discardEmpty: false };
  }

  try {
    const raw = localStorage.getItem(key);

    return raw === null
      ? { draft: null, error: '', discardEmpty: false }
      : decodeCanvasDraft(raw, artifactId);
  } catch (failure) {
    const detail = failure instanceof Error ? failure.message : String(failure);

    return {
      draft: null,
      error: `无法读取本机草稿，请在关闭前复制重要内容。${detail}`,
      discardEmpty: false,
    };
  }
}

export function storeCanvasDraft(
  key: string,
  active: CanvasDraft | null,
  recovery: CanvasDraftRecovery,
) {
  const raw = encodeCanvasDraft(active, recovery);
  if (raw === null) {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, raw);
  }
}
