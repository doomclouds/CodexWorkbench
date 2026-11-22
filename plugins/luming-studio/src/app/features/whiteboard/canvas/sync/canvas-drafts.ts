import type { DraftSlot } from '../../draft-workspace.js';
import {
  isBoardElementFields,
  isBoardElementProjection,
  isBoardProjection,
} from '../../../../../contracts/board-shape.js';
import type {
  ArtifactReadRequest,
  BoardElement,
  Operation,
} from '../../../../../contracts/studio.js';
import { isContentDraft, sameContentValue, type ContentTask } from './content-queue.js';
import type { NativeTableDraft } from '../objects/table/NativeTable.js';

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

const packedDraftPrefix = 'studio-canvas-draft:1\n';
const htmlReference = '\0';
const escapedReferenceLength = JSON.stringify(htmlReference).length - 2;
const minimumSharedHtml = 1024;
const maximumSharedHtml = 16 * 1024 * 1024;
const maximumExpandedHtml = 64 * 1024 * 1024;

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

function sharedIndex(indexes: Map<string, number>, value: string): number {
  const existing = indexes.get(value);
  if (existing !== undefined) {
    return existing;
  }

  const index = indexes.size;
  indexes.set(value, index);

  return index;
}

function packDraft(value: JsonRecord): string {
  const htmlIndexes = new Map<string, number>();
  const lineIndexes = new Map<string, number>();
  let originalLengthDelta = 0;
  const payload = JSON.stringify(value, (key: string, item: unknown) => {
    if (!text(item)) {
      return item;
    }

    if (key === 'html' && item.length >= minimumSharedHtml && item.length <= maximumSharedHtml) {
      const index = String(sharedIndex(htmlIndexes, item));
      originalLengthDelta += item.length - index.length - escapedReferenceLength;

      return htmlReference + index;
    }
    if (!item.startsWith(htmlReference)) {
      return item;
    }

    originalLengthDelta -= escapedReferenceLength;

    return htmlReference + item;
  });

  const sources = [...htmlIndexes.keys()];
  if (!sources.length && !originalLengthDelta) {
    return payload;
  }

  const expandedLength = sources.reduce((length, source) => length + source.length, 0);
  if (!sources.length || expandedLength > maximumExpandedHtml) {
    return JSON.stringify(value);
  }

  const html = sources.map((source) =>
    source
      .split('\n')
      .map((line) => (line.length >= minimumSharedHtml ? sharedIndex(lineIndexes, line) : line)),
  );

  const packed =
    packedDraftPrefix + JSON.stringify({ payload, html, lines: [...lineIndexes.keys()] });
  const originalLengthFloor = payload.length + originalLengthDelta;

  return packed.length < originalLengthFloor ? packed : JSON.stringify(value);
}

function sharedValue(values: string[], index: unknown): string {
  if (!revision(index) || index >= values.length) {
    throw new SyntaxError('本机草稿的共享内容引用无效。');
  }

  return values[index]!;
}

function unpackHtml(value: unknown, lines: string[], remaining: number): string {
  if (!Array.isArray(value)) {
    throw new SyntaxError('本机草稿的 HTML 内容无效。');
  }

  const limit = Math.min(maximumSharedHtml, remaining);
  let length = 0;
  const fragments = value.map((part: unknown) => {
    const line = text(part) ? part : sharedValue(lines, part);
    length += line.length + 1;
    if (length > limit + 1) {
      throw new RangeError('本机草稿的 HTML 超出可恢复范围。');
    }

    return line;
  });

  return fragments.join('\n');
}

function parseDraft(raw: string): unknown {
  if (!raw.startsWith(packedDraftPrefix)) {
    return JSON.parse(raw);
  }

  const packed: unknown = JSON.parse(raw.slice(packedDraftPrefix.length));
  if (!record(packed)) {
    throw new SyntaxError('本机草稿的共享内容格式无效。');
  }

  const { payload, html, lines } = packed;
  if (!text(payload) || !arrayOf(lines, text) || !Array.isArray(html)) {
    throw new SyntaxError('本机草稿的共享内容格式无效。');
  }

  let remaining = maximumExpandedHtml;
  const sources = html.map((source: unknown) => {
    const restored = unpackHtml(source, lines, remaining);
    remaining -= restored.length;

    return restored;
  });

  return JSON.parse(payload, (key: string, value: unknown) => {
    if (!text(value) || !value.startsWith(htmlReference)) {
      return value;
    }

    const token = value.slice(htmlReference.length);
    if (token.startsWith(htmlReference)) {
      return token;
    }
    if (key !== 'html' || !/^\d+$/.test(token)) {
      throw new SyntaxError('本机草稿的 HTML 引用无效。');
    }

    return sharedValue(sources, Number(token));
  });
}

export function decodeCanvasDraft(raw: string, artifactId: string): CanvasDraftRecovery {
  try {
    const decoded = parseDraft(raw);
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
  const backups = active && draft ? [packDraft({ ...draft }), ...retainedDrafts] : retainedDrafts;
  if (!contents && unreadableDraft === undefined && !backups.length) {
    return null;
  }

  return packDraft({
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

export function storeCanvasDraft(
  slot: DraftSlot,
  active: CanvasDraft | null,
  recovery: CanvasDraftRecovery,
) {
  const raw = encodeCanvasDraft(active, recovery);
  if (raw === null) {
    slot.clear();
  } else {
    slot.write(raw);
  }
}

export function canvasDraftReceiptRequest(
  args: Record<string, unknown>,
): Extract<ArtifactReadRequest, { mode: 'operation-receipt' }> {
  const { artifactId, operationId, operations, summary, merge } = args;
  const validOperations = Array.isArray(operations) && operations.every(draftOperation);
  const validSummary = summary === undefined || typeof summary === 'string';
  const validMerge = merge === undefined || merge === 'safe' || merge === 'same-generation';
  if (!text(artifactId) || !text(operationId)) {
    throw new Error('原提交缺少有效的作品或操作标识。');
  }
  if (!validOperations || !validSummary || !validMerge) {
    throw new Error('原提交参数不完整，请保留草稿并比较当前内容。');
  }

  return {
    mode: 'operation-receipt' as const,
    artifactId,
    operationId,
    operations,
    summary,
    merge,
  };
}
