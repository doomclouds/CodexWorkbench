import { randomUUID } from 'node:crypto';
import {
  DEFAULT_STYLE,
  type Anchor,
  type Board,
  type BoardElement,
  type Operation,
} from '../../contracts/studio.js';
import { copy, finite, object, safeId, same, StudioError } from '../shared/common.js';
import type {
  ArtifactState,
  ContentChange,
  ProductAdapter,
  Snapshot,
  UnitClock,
} from '../shared/model.js';
import { jsonEqual, mergeConflictDetails, mergeJson } from '../../shared/safe-merge.js';
import type { ProductDefinition } from '../shared/products.js';
import { arrowGeometry } from '../../shared/whiteboard-geometry.js';
import { htmlSource, snapshotFeedback } from './whiteboard-feedback.js';
import { advanceChildIncarnations, documentInsertedIds } from './child-incarnations.js';
import { rebaseNativeContent } from './native-content-merge.js';
import { whiteboardThumbnail } from './whiteboard-thumbnail.js';

export { htmlSource } from './whiteboard-feedback.js';
import { inlineExportAssets } from '../../shared/serialization.js';
import {
  applyDocumentOperations,
  defaultDocument,
  documentPlainText,
  flattenDocumentBlocks,
  normalizeDocument,
  type DocumentBlockOperation,
} from '../../contracts/document.js';
import {
  applyTodoOperations,
  isTodoId,
  normalizeTodoItems,
  TODO_ITEM_LIMIT,
  TODO_TEXT_BYTES,
  type TodoOperation,
} from '../../contracts/todo.js';

export type WhiteboardContent = Omit<Board, 'artifact'>;
export type SourceSnapshot = {
  version: number;
  artifactId: string;
  feedbackId?: string;
  element?: BoardElement;
} & (
  | { html: string; regionId: string; sourceRevision: number }
  | {
      elementId: string;
      element: BoardElement;
      html?: never;
      regionId?: never;
      sourceRevision?: never;
    }
);
export type WhiteboardState = ArtifactState<WhiteboardContent, Anchor, SourceSnapshot>;

export function boardView(snapshot: Snapshot<WhiteboardContent>): Board {
  return { artifact: snapshot.artifact, ...snapshot.content };
}

export function validateWhiteboardAsset(mimeType: string): void {
  if (!/^(image\/(png|jpeg|gif|webp|svg\+xml)|video\/(mp4|webm|quicktime))$/.test(mimeType)) {
    throw new StudioError('INVALID_ARGUMENT', '白板仅接收图片和视频资源。');
  }
}

const TYPES = new Set([
  'shape',
  'container',
  'text',
  'stroke',
  'arrow',
  'image',
  'html',
  'document',
  'table',
  'link',
  'note',
  'sticker',
  'diagram',
  'chart',
  'todo',
]);

function validateLayoutLabel(element: BoardElement): void {
  const offset = element.labelOffset;
  const size = element.labelSize;
  if (
    offset !== undefined &&
    (!object(offset) ||
      !['x', 'y'].every(
        (key) =>
          typeof offset[key as 'x' | 'y'] === 'number' &&
          Number.isFinite(offset[key as 'x' | 'y']) &&
          Math.abs(offset[key as 'x' | 'y']) <= 10_000_000,
      ))
  ) {
    throw new StudioError('INVALID_ARGUMENT', '连接线标签偏移无效。');
  }
  if (
    size !== undefined &&
    (!object(size) ||
      !['w', 'h'].every(
        (key) =>
          typeof size[key as 'w' | 'h'] === 'number' &&
          Number.isFinite(size[key as 'w' | 'h']) &&
          size[key as 'w' | 'h'] > 0 &&
          size[key as 'w' | 'h'] <= 10000,
      ))
  ) {
    throw new StudioError('INVALID_ARGUMENT', '连接线标签尺寸无效。');
  }
}

export function normalizeElement(input: Partial<BoardElement>, id?: string): BoardElement {
  if (!object(input) || !TYPES.has(input.type ?? '')) {
    throw new StudioError('INVALID_ARGUMENT', '白板元素类型无效。');
  }

  const result: BoardElement = {
    ...copy(input),
    id: safeId(id ?? input.id ?? randomUUID(), '元素 ID'),
    type: input.type!,
    x: finite(input.x, 0),
    y: finite(input.y, 0),
    w: finite(input.w, 220),
    h: finite(input.h, 120),
    version: 1,
  };

  if (result.w < 0 || result.h < 0) {
    throw new StudioError('INVALID_ARGUMENT', '元素尺寸不能为负数。');
  }
  if (
    result.html !== undefined &&
    (typeof result.html !== 'string' || result.html.length > 2 * 1024 * 1024)
  ) {
    throw new StudioError('INVALID_ARGUMENT', 'HTML 内容无效或超过 2 MB。');
  }

  if (result.type === 'html') {
    result.sourceRevision = typeof input.sourceRevision === 'number' ? input.sourceRevision : 1;
  }

  validateElementAppearance(result);
  if (result.type === 'arrow') {
    validateArrow(result);
  }
  if (result.crop !== undefined) {
    validateCrop(result.crop);
  }
  if (result.type === 'table') {
    result.data = tableIdentity(result.id, result.data);
  }
  if (result.type === 'document') {
    result.document = normalizeDocument(input.document ?? defaultDocument());
    if (result.html !== undefined) {
      throw new StudioError('INVALID_ARGUMENT', '文档使用块 JSON 保存，不能同时包含 HTML 源。');
    }
  }
  if (result.type === 'todo') {
    result.data = todoData(result);
  }

  return result;
}

function validateElementAppearance(result: BoardElement): void {
  if (result.points !== undefined) {
    const points = result.points;
    if (
      !Array.isArray(points) ||
      points.length > 40_000 ||
      points.some((n) => !validCoordinate(n))
    ) {
      throw new StudioError('INVALID_ARGUMENT', '笔迹坐标无效。');
    }
  }
  if (
    result.type === 'shape' &&
    result.kind !== undefined &&
    ![
      'rect',
      'rounded',
      'ellipse',
      'diamond',
      'pill',
      'hexagon',
      'parallelogram',
      'database',
      'queue',
      'document',
      'cloud',
      'person',
    ].includes(result.kind)
  ) {
    throw new StudioError('INVALID_ARGUMENT', '不支持此原生形状类型。');
  }
  if (result.locked !== undefined && typeof result.locked !== 'boolean') {
    throw new StudioError('INVALID_ARGUMENT', 'locked 必须是布尔值。');
  }

  for (const key of ['hollow', 'dash'] as const) {
    if (result[key] !== undefined && typeof result[key] !== 'boolean') {
      throw new StudioError('INVALID_ARGUMENT', `${key} 必须是布尔值。`);
    }
  }

  for (const key of ['strokeWidth', 'width'] as const) {
    const width = result[key];
    if (width === undefined) {
      continue;
    }
    if (!validCoordinate(width) || width <= 0 || width > 100) {
      throw new StudioError('INVALID_ARGUMENT', '线条宽度须大于 0 且不超过 100。');
    }
  }
}

function validCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateArrow(result: BoardElement): void {
  if (result.head !== undefined && !['end', 'both', 'none'].includes(result.head)) {
    throw new StudioError('INVALID_ARGUMENT', '连接线箭头须为 end、both 或 none。');
  }

  if (result.heads !== undefined) {
    const heads = result.heads;
    if (
      !Array.isArray(heads) ||
      heads.length !== 2 ||
      heads.some((head) => !['none', 'arrow', 'circle'].includes(head))
    ) {
      throw new StudioError('INVALID_ARGUMENT', '连接线两端须为 none、arrow 或 circle。');
    }
  }

  for (const side of [result.fromSide, result.toSide]) {
    if (side !== undefined && !['top', 'right', 'bottom', 'left'].includes(side)) {
      throw new StudioError('INVALID_ARGUMENT', '连接线吸附方向无效。');
    }
  }

  validateLayoutLabel(result);
  if (result.bends !== undefined) {
    const bends = result.bends;
    const native =
      Array.isArray(bends) &&
      ['h', 'v'].includes(String(bends[0])) &&
      bends.length <= 13 &&
      bends.slice(1).every(validCoordinate);
    const points =
      Array.isArray(bends) &&
      bends.length % 2 === 0 &&
      bends.length <= 24 &&
      bends.every(validCoordinate);

    if (!native && !points) {
      throw new StudioError(
        'INVALID_ARGUMENT',
        '连接线路径须为 h/v 加最多 12 个相对偏移，或有效坐标点对。',
      );
    }
  }
}

function validateCrop(crop: NonNullable<BoardElement['crop']>): void {
  const validZoom = object(crop) && validCoordinate(crop.zoom) && crop.zoom >= 1;
  const validPosition = (value: unknown) => validCoordinate(value) && value >= 0 && value <= 1;
  if (!validZoom || !validPosition(crop.x) || !validPosition(crop.y)) {
    throw new StudioError(
      'INVALID_ARGUMENT',
      '图片裁剪缩放须至少为 1，位置 x/y 须在 0 到 1 之间。',
    );
  }
}

function todoData(element: BoardElement): Record<string, unknown> {
  const invalidData = element.data !== undefined && !object(element.data);
  if (invalidData || element.html !== undefined || element.document !== undefined) {
    throw new StudioError('INVALID_ARGUMENT', '任务清单须使用 data.items 保存任务行。');
  }
  if (
    element.text !== undefined &&
    (typeof element.text !== 'string' || Buffer.byteLength(element.text) > TODO_TEXT_BYTES)
  ) {
    throw new StudioError('INVALID_ARGUMENT', '任务清单标题无效或过长。');
  }

  return { ...element.data, items: normalizeTodoItems(element.data?.items) };
}

function tableIdentity(id: string, value: unknown): Record<string, unknown> {
  const data = object(value) ? copy(value) : {};
  const rows = data.rows;
  if (!Array.isArray(rows) || !rows.every(Array.isArray)) {
    return data;
  }

  const columns = Math.max(0, ...rows.map((row) => row.length));
  const keys = (value: unknown, length: number, axis: string) => {
    if (value === undefined) {
      return Array.from({ length }, (_, index) => `${id}:${axis}:${index}`);
    }

    const correctLength = Array.isArray(value) && value.length === length;
    const validKey = (key: unknown) =>
      typeof key === 'string' && key.length > 0 && key.length <= 160;

    if (!correctLength || !value.every(validKey) || new Set(value).size !== length) {
      throw new StudioError('INVALID_ARGUMENT', '表格行列标识必须唯一并匹配当前结构。');
    }

    return value;
  };

  return {
    ...data,
    rowIds: keys(data.rowIds, rows.length, 'row'),
    columnIds: keys(data.columnIds, columns, 'col'),
  };
}

function mergeFields(value: unknown): Record<string, unknown> {
  if (!object(value)) {
    return {};
  }

  const { id: _id, version: _version, sourceRevision: _sourceRevision, ...fields } = value;

  return fields;
}

function safeElementMerge(base: BoardElement, local: BoardElement, current: BoardElement) {
  const b = mergeFields(base);
  const l = mergeFields(local);
  const c = mergeFields(current);
  const matrices: string[] = [];
  if (base.type === 'table' && local.type === 'table' && current.type === 'table') {
    b.data = tableIdentity(base.id, b.data);
    l.data = tableIdentity(local.id, l.data);
    c.data = tableIdentity(current.id, c.data);
    const bd = b.data as Record<string, unknown>;
    const ld = l.data as Record<string, unknown>;
    const cd = c.data as Record<string, unknown>;
    const sameRowIds = jsonEqual(bd.rowIds, ld.rowIds) && jsonEqual(bd.rowIds, cd.rowIds);
    const sameColumnIds =
      jsonEqual(bd.columnIds, ld.columnIds) && jsonEqual(bd.columnIds, cd.columnIds);

    if (sameRowIds && sameColumnIds) {
      matrices.push('data.rows');
    } else if (!jsonEqual(bd.rows, ld.rows) && !jsonEqual(bd.rows, cd.rows)) {
      return { result: c, conflicts: ['data.rows', 'data.rowIds', 'data.columnIds'] };
    }
  }
  if (base.type === 'todo' && local.type === 'todo' && current.type === 'todo') {
    const original = normalizeTodoItems(base.data?.items);
    const incoming = normalizeTodoItems(local.data?.items);
    const saved = normalizeTodoItems(current.data?.items);
    if (
      original.length === incoming.length &&
      original.length === saved.length &&
      original.every(
        (item, index) => item.id === incoming[index]!.id && item.id === saved[index]!.id,
      )
    ) {
      const conflicts: string[] = [];
      const items = original.map((item, index) => {
        const next = incoming[index]!;
        const existing = saved[index]!;
        if (jsonEqual(item, next)) {
          return existing;
        }
        if (jsonEqual(item, existing) || jsonEqual(next, existing)) {
          return next;
        }

        conflicts.push('data.items.' + item.id);

        return existing;
      });

      if (conflicts.length) {
        return { result: c, conflicts };
      }

      b.data = { ...base.data, items };
      l.data = { ...local.data, items };
      c.data = { ...current.data, items };
    }
  }

  return mergeJson(b, l, c, matrices);
}

function initializeClock(
  element: BoardElement,
  old: BoardElement | undefined,
  clock: UnitClock | undefined,
): UnitClock {
  const recreated = !old && clock;
  const incarnationStart = recreated
    ? Math.max(clock.version + 1, element.version)
    : (clock?.incarnationStart ?? element.version);
  const sourceRevision = Math.max(
    clock?.sourceRevision ?? 0,
    Number(element.sourceRevision ?? 0),
    recreated && element.type === 'html' ? (clock.sourceRevision ?? 0) + 1 : 0,
  );

  return {
    version: Math.max(clock?.version ?? 0, element.version, incarnationStart),
    incarnationStart,
    ...(sourceRevision ? { sourceRevision } : {}),
  };
}

function htmlSourceVersion(
  element: BoardElement,
  old: BoardElement | undefined,
  clock?: UnitClock,
): number {
  if (old?.type === 'html' && old.html === element.html) {
    return old.sourceRevision ?? 1;
  }

  return Math.max(Number(element.sourceRevision ?? 1), (clock?.sourceRevision ?? 0) + 1);
}

function advanceElementClock(
  element: BoardElement,
  old: BoardElement | undefined,
  clock: UnitClock | undefined,
  operation: Operation | undefined,
): UnitClock {
  element.version = Math.max(element.version, (clock?.version ?? old?.version ?? 0) + 1);
  if (element.type === 'html') {
    element.sourceRevision = htmlSourceVersion(element, old, clock);
  }

  const safeSource =
    element.sourceRevision === undefined || Number.isSafeInteger(element.sourceRevision);

  if (!Number.isSafeInteger(element.version) || !safeSource) {
    throw new StudioError('VERSION_EXHAUSTED', '对象版本已超过可安全表示的范围。');
  }

  const children = advanceChildIncarnations(element, old, clock, operation);
  return {
    version: element.version,
    ...(children ? { children } : {}),
    incarnationStart: old ? (clock?.incarnationStart ?? old.version) : element.version,
    ...(element.sourceRevision || clock?.sourceRevision
      ? {
          sourceRevision: Math.max(clock?.sourceRevision ?? 0, Number(element.sourceRevision ?? 0)),
        }
      : {}),
  };
}

function syncElementVersions(
  content: WhiteboardContent,
  previous: WhiteboardContent,
  clocks: Record<string, UnitClock>,
  initialize = false,
  operation?: Operation,
): void {
  const before = new Map(previous.elements.map((element) => [element.id, element]));
  for (const [index, element] of content.elements.entries()) {
    const old = before.get(element.id);
    const clock = Object.hasOwn(clocks, element.id) ? clocks[element.id] : undefined;
    if (initialize) {
      clocks[element.id] = initializeClock(element, old, clock);
      continue;
    }
    if (!jsonEqual(old, element)) {
      const next = { ...element };
      clocks[element.id] = advanceElementClock(next, old, clock, operation);
      content.elements[index] = next;
      continue;
    }
    if (!clock) {
      continue;
    }

    const version = Math.max(element.version, clock.version);
    const sourceRevision =
      element.type === 'html'
        ? Math.max(Number(element.sourceRevision ?? 1), clock.sourceRevision ?? 1)
        : element.sourceRevision;

    if (version !== element.version || sourceRevision !== element.sourceRevision) {
      const next = { ...element, version };
      if (element.type === 'html') {
        next.sourceRevision = sourceRevision;
      }

      content.elements[index] = next;
    }
  }
}

export function initialWhiteboard(elements: unknown, base?: WhiteboardContent): WhiteboardContent {
  return {
    elements: (base?.elements ?? (Array.isArray(elements) ? elements : [])).map((item) =>
      normalizeElement(item as BoardElement),
    ),
    style: copy(base?.style ?? DEFAULT_STYLE),
    orderVersion: 0,
    ...(base?.motion ? { motion: copy(base.motion) } : {}),
  };
}

function elementChanges(before: WhiteboardContent, after: WhiteboardContent): ContentChange[] {
  const a = new Map(before.elements.map((item) => [item.id, item]));
  const b = new Map(after.elements.map((item) => [item.id, item]));

  return [...new Set([...a.keys(), ...b.keys()])].flatMap((id) =>
    same(a.get(id), b.get(id)) ? [] : [{ id, before: a.get(id) ?? null, after: b.get(id) ?? null }],
  );
}

function orderUnit(content: WhiteboardContent) {
  return { version: content.orderVersion ?? 0, ids: content.elements.map((element) => element.id) };
}

function orderChanged(before: WhiteboardContent, after: WhiteboardContent): boolean {
  const a = new Set(before.elements.map((element) => element.id));
  const b = new Set(after.elements.map((element) => element.id));

  return !same(
    before.elements.filter((element) => b.has(element.id)).map((element) => element.id),
    after.elements.filter((element) => a.has(element.id)).map((element) => element.id),
  );
}

export function compareBoards(before: Board, after: Board) {
  return elementChanges(before, after);
}

function restoredElement(
  saved: BoardElement,
  current?: BoardElement,
  historical?: Pick<BoardElement, 'version' | 'sourceRevision'>,
): BoardElement {
  const restored = {
    ...copy(saved),
    version: Math.max(current?.version ?? 0, historical?.version ?? 0, saved.version) + 1,
  };

  if (restored.type === 'html') {
    restored.sourceRevision =
      current && current.html === restored.html
        ? (current.sourceRevision ?? 1)
        : Math.max(
            Number(current?.sourceRevision ?? 0),
            Number(historical?.sourceRevision ?? 0),
            Number(saved.sourceRevision ?? 0),
          ) + 1;
  }

  return restored;
}

function deletedIds(content: WhiteboardContent, operation: Operation): string[] {
  const ids = operation.ids ?? [safeId(operation.id, '元素 ID')];
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    throw new StudioError('INVALID_ARGUMENT', '元素 ID 列表无效。');
  }

  return content.elements
    .filter(
      (element) =>
        ids.includes(element.id) ||
        (element.type === 'arrow' &&
          ((typeof element.from === 'string' && ids.includes(element.from)) ||
            (typeof element.to === 'string' && ids.includes(element.to)))),
    )
    .map((element) => element.id);
}

const LOCKED_GEOMETRY = [
  'type',
  'x',
  'y',
  'w',
  'h',
  'rotation',
  'parentId',
  'groupId',
  'from',
  'to',
  'fromSide',
  'toSide',
  'points',
  'bends',
  'labelOffset',
  'labelSize',
  'crop',
] as const;

function assertLockedGeometry(
  before: WhiteboardContent,
  after: WhiteboardContent,
  baseline: WhiteboardContent,
) {
  const protectedIds = new Set(
    [...baseline.elements, ...before.elements]
      .filter((element) => element.locked)
      .map((element) => element.id),
  );

  if (!protectedIds.size) {
    return;
  }

  const beforeById = new Map(before.elements.map((element) => [element.id, element]));
  const afterById = new Map(after.elements.map((element) => [element.id, element]));
  const bounds = (element: BoardElement | undefined) =>
    element && [element.x, element.y, element.w, element.h, element.rotation];

  for (const current of before.elements) {
    if (!protectedIds.has(current.id)) {
      continue;
    }

    const next = afterById.get(current.id);
    const removedParent =
      current.parentId && beforeById.has(current.parentId) && !afterById.has(current.parentId);
    const endpointMoved =
      current.type === 'arrow' &&
      [current.from, current.to].some(
        (id) =>
          typeof id === 'string' && !same(bounds(beforeById.get(id)), bounds(afterById.get(id))),
      );

    if (next && !removedParent && LOCKED_GEOMETRY.every((key) => same(current[key], next[key]))) {
      if (!endpointMoved) {
        continue;
      }
      if (
        same(
          arrowGeometry(current, before.elements).points,
          arrowGeometry(next, after.elements).points,
        )
      ) {
        continue;
      }
    }

    throw new StudioError('LOCKED', '对象的位置与尺寸已锁定，请先单独解锁后修改几何或删除。', {
      elementId: current.id,
    });
  }
}

function hasUnidentifiedTableRows(data: unknown): boolean {
  if (!object(data) || !Object.hasOwn(data, 'rows')) {
    return false;
  }

  return !Array.isArray(data.rowIds) || !Array.isArray(data.columnIds);
}

function addElement(
  content: WhiteboardContent,
  operation: Operation,
  baseline: WhiteboardContent,
): string[] {
  const element = normalizeElement(operation.element ?? {}, operation.id ?? operation.element?.id);
  if (element.type === 'html') {
    element.sourceRevision = 1;
  }
  if (content.elements.some((item) => item.id === element.id)) {
    throw new StudioError('CONFLICT', '元素 ID 已存在。', { elementId: element.id });
  }

  assertLockedGeometry(content, { ...content, elements: [...content.elements, element] }, baseline);
  const beforeId = operation.data?.beforeId;
  if (beforeId === undefined) {
    content.elements.push(element);
  } else {
    if (element.type !== 'container') {
      throw new StudioError('INVALID_ARGUMENT', '仅可为新增分区指定层级锚点。');
    }

    const anchor = safeId(beforeId, '层级锚点 ID');
    const index = content.elements.findIndex((item) => item.id === anchor);
    if (index < 0) {
      throw new StudioError('NOT_FOUND', '分区的层级锚点已不存在。', { elementId: anchor });
    }

    content.elements.splice(index, 0, element);
  }

  content.orderVersion = (content.orderVersion ?? 0) + 1;

  return [element.id];
}

function updateElement(
  content: WhiteboardContent,
  operation: Operation,
  baseline: WhiteboardContent,
): string[] {
  const id = safeId(operation.id, '元素 ID');
  const index = content.elements.findIndex((item) => item.id === id);
  const current = content.elements[index];
  if (!current) {
    throw new StudioError('NOT_FOUND', '要修改的元素不存在。');
  }
  if (!object(operation.changes)) {
    throw new StudioError('INVALID_ARGUMENT', '修改字段必须是对象。');
  }
  if (Object.hasOwn(operation.changes, 'locked') && typeof operation.changes.locked !== 'boolean') {
    throw new StudioError('INVALID_ARGUMENT', 'locked 必须是布尔值。');
  }
  if (
    current.locked &&
    operation.changes.locked === false &&
    Object.keys(operation.changes).length !== 1
  ) {
    throw new StudioError('LOCKED', '请通过单独的锁定操作明确解锁。', { elementId: id });
  }

  const { id: _id, version: _version, ...changes } = copy(operation.changes);
  const changesType = changes.type !== undefined && changes.type !== current.type;
  const involvesTodo = current.type === 'todo' || changes.type === 'todo';
  if (changesType && involvesTodo) {
    throw new StudioError('INVALID_ARGUMENT', '请单独创建任务清单，不能直接转换已有对象的类型。');
  }

  if (current.type === 'todo' && Object.hasOwn(changes, 'data')) {
    preserveTodoRows(current, changes);
  }
  if (current.type === 'arrow') {
    resetArrowLabelPlacement(current, changes);
  }
  if (current.type === 'table') {
    identifyUpdatedTableRows(current, changes.data);
  }

  const next = normalizeElement({ ...current, ...copy(changes) }, id);
  next.version = current.version + 1;
  if (next.type === 'html') {
    next.sourceRevision =
      current.html === next.html
        ? (current.sourceRevision ?? 1)
        : Number(current.sourceRevision ?? 0) + 1;
  }

  assertLockedGeometry(
    content,
    {
      ...content,
      elements: content.elements.map((element) => (element.id === id ? next : element)),
    },
    baseline,
  );
  content.elements[index] = next;

  return [id];
}

function preserveTodoRows(current: BoardElement, changes: Partial<BoardElement>): void {
  if (!object(changes.data)) {
    throw new StudioError('INVALID_ARGUMENT', '任务清单属性无效。');
  }

  const items = normalizeTodoItems(current.data?.items);
  if (
    Object.hasOwn(changes.data, 'items') &&
    !jsonEqual(normalizeTodoItems(changes.data.items), items)
  ) {
    throw new StudioError('INVALID_ARGUMENT', '任务内容请使用 todo 逐行修改。');
  }

  changes.data = { ...current.data, ...changes.data, items };
}

function resetArrowLabelPlacement(current: BoardElement, changes: Partial<BoardElement>): void {
  const triggers = ['from', 'to', 'fromSide', 'toSide', 'bends'];
  if (!current.locked) {
    triggers.push('label');
  }

  const moved = triggers.some(
    (key) => Object.hasOwn(changes, key) && !same(changes[key], current[key]),
  );

  if (!moved) {
    return;
  }

  if (!Object.hasOwn(changes, 'labelOffset')) {
    changes.labelOffset = undefined;
  }
  if (!Object.hasOwn(changes, 'labelSize')) {
    changes.labelSize = undefined;
  }
}

function identifyUpdatedTableRows(current: BoardElement, data: unknown): void {
  if (!object(data) || !Object.hasOwn(data, 'rows')) {
    return;
  }

  const rows = Array.isArray(data.rows) ? data.rows : [];
  if (!Object.hasOwn(data, 'rowIds')) {
    data.rowIds = rows.map((_, index) => `${current.id}:row:v${current.version + 1}:${index}`);
  }
  if (!Object.hasOwn(data, 'columnIds')) {
    const columns = Math.max(0, ...rows.filter(Array.isArray).map((row) => row.length));
    data.columnIds = Array.from(
      { length: columns },
      (_, index) => `${current.id}:col:v${current.version + 1}:${index}`,
    );
  }
}

function applyDocumentEdit(content: WhiteboardContent, operation: Operation): string[] {
  const id = safeId(operation.id, '文档 ID');
  const index = content.elements.findIndex((element) => element.id === id);
  const current = content.elements[index];
  if (!current || current.type !== 'document' || !current.document) {
    throw new StudioError('NOT_FOUND', '文档区域不存在。');
  }

  const operations = operation.data?.operations as DocumentBlockOperation[];
  const document = applyDocumentOperations(current.document, operations);
  if (same(document, current.document)) {
    const existing = new Set(
      flattenDocumentBlocks(current.document.blocks).map((block) => block.id),
    );

    if (!documentInsertedIds(operations).some((inserted) => existing.has(inserted))) {
      return [];
    }
  }

  content.elements[index] = { ...current, document, version: current.version + 1 };

  return [id];
}

function applyTodoEdit(content: WhiteboardContent, operation: Operation): string[] {
  const id = safeId(operation.id, '任务清单 ID');
  const index = content.elements.findIndex((item) => item.id === id);
  const current = content.elements[index];
  if (!current || current.type !== 'todo') {
    throw new StudioError('NOT_FOUND', '任务清单不存在。');
  }

  const before = normalizeTodoItems(current.data?.items);
  const items = applyTodoOperations(before, operation.data?.operations as TodoOperation[]);
  if (same(items, before)) {
    return [];
  }

  content.elements[index] = {
    ...current,
    data: { ...current.data, items },
    version: current.version + 1,
  };

  return [id];
}

function removeElements(
  content: WhiteboardContent,
  operation: Operation,
  baseline: WhiteboardContent,
): string[] {
  const ids = deletedIds(content, operation);
  const elements = content.elements.filter((element) => !ids.includes(element.id));
  assertLockedGeometry(content, { ...content, elements }, baseline);
  content.elements = elements;
  if (ids.length) {
    content.orderVersion = (content.orderVersion ?? 0) + 1;
  }

  return ids;
}

function applyStyle(content: WhiteboardContent, operation: Operation): string[] {
  const patch = operation.style ?? {};
  if (
    !object(patch) ||
    Object.values(patch).some((value) => typeof value !== 'string' || value.length > 500)
  ) {
    throw new StudioError('INVALID_ARGUMENT', '样式字段必须是文字。');
  }

  content.style = { ...content.style, ...(copy(patch) as Record<string, string>) };

  return ['$style'];
}

function applyMotion(content: WhiteboardContent, operation: Operation): string[] {
  content.motion = copy(operation.data ?? {});

  return ['$motion'];
}

function applyLayout(
  content: WhiteboardContent,
  operation: Operation,
  baseline: WhiteboardContent,
): string[] {
  if (['front', 'back', 'forward', 'backward'].includes(operation.preset ?? '')) {
    return applyLayerLayout(content, operation, baseline);
  }

  const elements = content.elements
    .filter((item) => !operation.ids || operation.ids.includes(item.id))
    .map((item) => ({ ...item }));
  const arrangedColumns =
    operation.preset === 'row'
      ? Math.max(1, elements.length)
      : Math.max(1, Math.ceil(Math.sqrt(elements.length)));
  const columns = operation.preset === 'column' ? 1 : arrangedColumns;
  const width = Math.max(220, ...elements.map((item) => item.w));
  const height = Math.max(120, ...elements.map((item) => item.h));
  elements.forEach((item, index) => {
    item.x = finite(operation.data?.x, 80) + (index % columns) * (width + 64);
    item.y = finite(operation.data?.y, 80) + Math.floor(index / columns) * (height + 64);
    item.version++;
  });
  const updates = new Map(elements.map((element) => [element.id, element]));
  const next = {
    ...content,
    elements: content.elements.map((element) => updates.get(element.id) ?? element),
  };
  assertLockedGeometry(content, next, baseline);
  content.elements = next.elements;

  return elements.map((item) => item.id);
}

function applyLayerLayout(
  content: WhiteboardContent,
  operation: Operation,
  baseline: WhiteboardContent,
): string[] {
  const selected = new Set(operation.ids ?? content.elements.map((element) => element.id));
  const locked = content.elements.find(
    (element) =>
      selected.has(element.id) &&
      (element.locked || baseline.elements.find((item) => item.id === element.id)?.locked),
  );

  if (locked) {
    throw new StudioError('LOCKED', '对象已锁定，请先单独解锁后调整层级。', {
      elementId: locked.id,
    });
  }

  const elements = reorderLayers(content.elements, selected, operation.preset);
  const changed = elements
    .filter(
      (element, index) => selected.has(element.id) && content.elements[index]?.id !== element.id,
    )
    .map((element) => element.id);
  content.elements = elements.map((element) =>
    changed.includes(element.id) ? { ...element, version: element.version + 1 } : element,
  );

  if (changed.length) {
    content.orderVersion = (content.orderVersion ?? 0) + 1;
  }

  return changed.length ? [...changed, '$order'] : changed;
}

function reorderLayers(
  source: readonly BoardElement[],
  selected: ReadonlySet<string>,
  preset: string | undefined,
): BoardElement[] {
  const elements = [...source];
  if (preset === 'front' || preset === 'back') {
    const picked = elements.filter((element) => selected.has(element.id));
    const rest = elements.filter((element) => !selected.has(element.id));
    elements.splice(
      0,
      elements.length,
      ...(preset === 'front' ? [...rest, ...picked] : [...picked, ...rest]),
    );
  } else if (preset === 'forward') {
    for (let index = elements.length - 2; index >= 0; index--) {
      if (selected.has(elements[index]!.id) && !selected.has(elements[index + 1]!.id)) {
        [elements[index], elements[index + 1]] = [elements[index + 1]!, elements[index]!];
      }
    }
  } else {
    for (let index = 1; index < elements.length; index++) {
      if (selected.has(elements[index]!.id) && !selected.has(elements[index - 1]!.id)) {
        [elements[index], elements[index - 1]] = [elements[index - 1]!, elements[index]!];
      }
    }
  }

  return elements;
}

export const MAX_WHITEBOARD_ELEMENTS = 2_000;
export const MAX_WHITEBOARD_BYTES = 8 * 1024 * 1024;

interface ArchiveWhiteboardValidation {
  elementBytes: WeakMap<BoardElement, number>;
  checkedElements: WeakSet<BoardElement>;
}

function archiveElementBytes(element: BoardElement, known: WeakMap<BoardElement, number>): number {
  const cached = known.get(element);
  if (cached !== undefined) {
    return cached;
  }

  const bytes = Buffer.byteLength(JSON.stringify(element) ?? 'null');
  if (object(element)) {
    known.set(element, bytes);
  }

  return bytes;
}

function whiteboardBytes(
  content: WhiteboardContent,
  archive?: ArchiveWhiteboardValidation,
): number {
  if (!archive) {
    return Buffer.byteLength(JSON.stringify(content));
  }

  const emptyElements = Buffer.byteLength(JSON.stringify({ ...content, elements: [] }));
  const separators = Math.max(0, content.elements.length - 1);

  return content.elements.reduce(
    (total, element) => total + archiveElementBytes(element, archive.elementBytes),
    emptyElements + separators,
  );
}

function validateWhiteboardElements(elements: readonly BoardElement[]): void {
  for (const element of elements) {
    if (element.type === 'arrow') {
      validateLayoutLabel(element);
    }
  }

  for (const element of elements) {
    if (element.type !== 'document') {
      continue;
    }

    normalizeDocument(element.document);
    if (element.html !== undefined) {
      throw new StudioError('INVALID_ARGUMENT', '文档不能同时保存 HTML 源。');
    }
  }

  for (const element of elements) {
    if (element.type === 'todo') {
      todoData(element);
    }
  }
}

function validateWhiteboard(
  content: WhiteboardContent,
  archive?: ArchiveWhiteboardValidation,
): void {
  if (!object(content) || !Array.isArray(content.elements) || !object(content.style)) {
    throw new StudioError('INVALID_ARGUMENT', '白板内容无效。');
  }
  if (
    content.orderVersion !== undefined &&
    (!Number.isSafeInteger(content.orderVersion) || content.orderVersion < 0)
  ) {
    throw new StudioError('INVALID_ARGUMENT', '白板层级版本无效。');
  }
  if (
    content.elements.length > MAX_WHITEBOARD_ELEMENTS ||
    whiteboardBytes(content, archive) > MAX_WHITEBOARD_BYTES
  ) {
    throw new StudioError('TOO_LARGE', '白板内容超过当前容量，请分成多个作品。');
  }

  if (!archive) {
    validateWhiteboardElements(content.elements);
    return;
  }

  const unchecked = content.elements.filter((element) => !archive.checkedElements.has(element));
  validateWhiteboardElements(unchecked);
  for (const element of unchecked) {
    if (object(element)) {
      archive.checkedElements.add(element);
    }
  }
}

function createArchiveContentValidator(): (content: WhiteboardContent) => void {
  const archive: ArchiveWhiteboardValidation = {
    elementBytes: new WeakMap(),
    checkedElements: new WeakSet(),
  };
  const checked = new WeakSet<WhiteboardContent>();

  return (content) => {
    if (checked.has(content)) {
      return;
    }

    validateWhiteboard(content, archive);
    checked.add(content);
  };
}

export const whiteboardAdapter: ProductAdapter<
  WhiteboardContent,
  Operation,
  Anchor,
  SourceSnapshot
> = {
  type: 'whiteboard',
  validate(content) {
    validateWhiteboard(content);
  },
  versionOf: (content, id) =>
    id === '$order'
      ? (content.orderVersion ?? 0)
      : (content.elements.find((item) => item.id === id)?.version ?? 0),
  syncVersions: syncElementVersions,
  supportsStructuredMerge: (operation) => operation.op === 'document' || operation.op === 'todo',
  rebaseStructured: rebaseNativeContent,
  rebaseUpdate(operation, base, current) {
    const canCompare = operation.op === 'update' && object(base) && object(current);
    if (!canCompare || !object(operation.changes) || base.type !== current.type) {
      throw new StudioError(
        'CONFLICT',
        '对象结构已改变，请保留本地修改并比较最新内容。',
        mergeConflictDetails(base, operation.changes, current, ['.']),
      );
    }

    const b = base as unknown as BoardElement;
    const c = current as unknown as BoardElement;
    const local = { ...copy(b), ...copy(operation.changes), id: b.id, version: b.version };
    if (local.type !== b.type) {
      throw new StudioError(
        'CONFLICT',
        '对象类型发生变化，不能自动合并过期修改。',
        mergeConflictDetails(base, local, current, ['type']),
      );
    }

    const changesEmbeddedState =
      Object.hasOwn(operation.changes, 'state') &&
      (b.type === 'html' || (b.type === 'diagram' && typeof b.html === 'string'));

    if (changesEmbeddedState && (b.sourceRevision !== c.sourceRevision || b.html !== c.html)) {
      throw new StudioError(
        'CONFLICT',
        'HTML 源码已有变化，旧的交互状态不能合并到新源码。',
        mergeConflictDetails(base, local, current, ['state']),
      );
    }
    if (b.type === 'table' && hasUnidentifiedTableRows(operation.changes.data)) {
      throw new StudioError(
        'CONFLICT',
        '并发表格编辑需要稳定的行列标识，请比较后重新提交。',
        mergeConflictDetails(base, local, current, ['data.rows']),
      );
    }

    const merged = safeElementMerge(b, local, c);
    if (merged.conflicts.length) {
      throw new StudioError(
        'CONFLICT',
        '这些字段同时被修改，未覆盖任何一方。',
        mergeConflictDetails(base, local, current, merged.conflicts),
      );
    }

    const fields = merged.result as Record<string, unknown>;
    const existing = mergeFields(c);
    const changes: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(fields), ...Object.keys(existing)])) {
      if (!jsonEqual(fields[key], existing[key])) {
        changes[key] = fields[key];
      }
    }

    return { operation: { ...operation, changes }, local };
  },
  targets(content, operation) {
    if (operation.op === 'restore') {
      const ids = operation.ids ?? (operation.id === undefined ? undefined : [operation.id]);

      return ids?.some((id) => id.startsWith('$') && id !== '$order') ? undefined : ids;
    }
    if (['style', 'motion'].includes(operation.op)) {
      return;
    }
    if (operation.op === 'add' && operation.data?.beforeId !== undefined) {
      return;
    }

    if (operation.op === 'layout') {
      const ids = operation.ids ?? content.elements.map((element) => element.id);

      return ['front', 'back', 'forward', 'backward'].includes(operation.preset ?? '')
        ? [...ids, '$order']
        : ids;
    }

    if (operation.op === 'delete') {
      return [
        ...new Set([
          ...(operation.ids ?? [safeId(operation.id, '元素 ID')]),
          ...deletedIds(content, operation),
        ]),
      ];
    }
    if (operation.op === 'update' || operation.op === 'document' || operation.op === 'todo') {
      return [safeId(operation.id, '元素 ID')];
    }

    return [];
  },
  snapshotMutationContent(content) {
    if (this !== whiteboardAdapter) {
      return;
    }

    return { ...content, elements: [...content.elements] };
  },
  apply(content, operation, baseline = content) {
    if (operation.op === 'add') {
      return addElement(content, operation, baseline);
    }
    if (operation.op === 'update') {
      return updateElement(content, operation, baseline);
    }
    if (operation.op === 'document') {
      return applyDocumentEdit(content, operation);
    }
    if (operation.op === 'todo') {
      return applyTodoEdit(content, operation);
    }
    if (operation.op === 'delete') {
      return removeElements(content, operation, baseline);
    }
    if (operation.op === 'style') {
      return applyStyle(content, operation);
    }
    if (operation.op === 'motion') {
      return applyMotion(content, operation);
    }
    if (operation.op === 'layout') {
      return applyLayout(content, operation, baseline);
    }

    throw new StudioError('INVALID_ARGUMENT', '不支持的白板修改操作。');
  },
  diff(before, after) {
    return [
      ...elementChanges(before, after),
      ...(orderChanged(before, after)
        ? [{ id: '$order', before: orderUnit(before), after: orderUnit(after) }]
        : []),
      ...(['style', 'motion'] as const).flatMap((key) =>
        same(before[key], after[key])
          ? []
          : [{ id: `$${key}`, before: before[key], after: after[key] }],
      ),
    ];
  },
  readUnit(content, id) {
    if (id === '$style') {
      return content.style;
    }
    if (id === '$motion') {
      return content.motion;
    }
    if (id === '$order') {
      return orderUnit(content);
    }

    return content.elements.find((item) => item.id === id) ?? null;
  },
  undoUnit(content, change, history, { current, changesWereReversed }) {
    const objectEdit = object(change.before) && object(change.after) && object(current);
    if (change.id === '$order' || !objectEdit) {
      if (!jsonEqual(current, change.after)) {
        const sameValue =
          object(current) &&
          object(change.after) &&
          (change.id === '$order'
            ? jsonEqual(current.ids, change.after.ids)
            : jsonEqual(mergeFields(current), mergeFields(change.after)));
        const unitVersion = (value: unknown) => (object(value) ? value.version : undefined);
        if (
          !sameValue ||
          !changesWereReversed((before, after) => unitVersion(before) !== unitVersion(after))
        ) {
          throw new StudioError('CONFLICT', '后来有人修改了这项内容，不能直接撤回。', {
            elementId: change.id,
            ...mergeConflictDetails(change.after, change.before, current, ['.']),
          });
        }
      }

      this.restoreUnit(content, change, history);

      return;
    }
    if (change.id === '$style' || change.id === '$motion') {
      const merged = mergeJson(change.after, change.before, current);
      if (merged.conflicts.length) {
        throw new StudioError('CONFLICT', '后来有人修改了要撤回的字段，未覆盖他人的编辑。', {
          elementId: change.id,
          ...mergeConflictDetails(change.after, change.before, current, merged.conflicts),
        });
      }

      this.restoreUnit(content, { ...change, before: merged.result }, history);

      return;
    }

    const after = change.after as unknown as BoardElement;
    const live = current as unknown as BoardElement;
    const merged = safeElementMerge(after, change.before as unknown as BoardElement, live);
    if (merged.conflicts.length) {
      throw new StudioError('CONFLICT', '后来有人修改了要撤回的字段，未覆盖他人的编辑。', {
        elementId: change.id,
        currentVersion: live.version,
        ...mergeConflictDetails(change.after, change.before, current, merged.conflicts),
      });
    }

    this.restoreUnit(
      content,
      {
        ...change,
        before: {
          ...(merged.result as Record<string, unknown>),
          id: live.id,
          version: live.version,
          ...(live.sourceRevision !== undefined ? { sourceRevision: live.sourceRevision } : {}),
        },
      },
      history,
    );
  },
  restoreUnit(content, change, history = []) {
    if (change.id === '$style') {
      content.style = copy(change.before) as WhiteboardContent['style'];

      return;
    }
    if (change.id === '$motion') {
      content.motion = copy(change.before) as WhiteboardContent['motion'];

      return;
    }
    if (change.id === '$order') {
      const saved = change.before as ReturnType<typeof orderUnit>;
      const byId = new Map(content.elements.map((element) => [element.id, element]));
      const elements = [
        ...saved.ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
        ...content.elements.filter((element) => !saved.ids.includes(element.id)),
      ];

      if (
        !same(
          content.elements.map((element) => element.id),
          elements.map((element) => element.id),
        )
      ) {
        content.elements = elements;
        content.orderVersion =
          Math.max(
            content.orderVersion ?? 0,
            ...history.map((snapshot) => snapshot.orderVersion ?? 0),
          ) + 1;
      }

      return;
    }

    const index = content.elements.findIndex((item) => item.id === change.id);
    if (change.before) {
      const historical = { version: 0, sourceRevision: 0 };
      for (const snapshot of history) {
        const element = snapshot.elements.find((item) => item.id === change.id);
        if (!element) {
          continue;
        }

        historical.version = Math.max(historical.version, element.version);
        historical.sourceRevision = Math.max(
          historical.sourceRevision,
          Number(element.sourceRevision ?? 0),
        );
      }

      const restored = restoredElement(
        change.before as BoardElement,
        content.elements[index],
        historical,
      );

      if (index >= 0) {
        content.elements[index] = restored;
      } else {
        const source = history
          .slice()
          .reverse()
          .find((snapshot) => snapshot.elements.some((element) => same(element, change.before)));
        const sourceIndex = source?.elements.findIndex((element) => element.id === change.id) ?? -1;
        const successor = source?.elements
          .slice(sourceIndex + 1)
          .find((element) => content.elements.some((current) => current.id === element.id));
        const insertAt = successor
          ? content.elements.findIndex((element) => element.id === successor.id)
          : content.elements.length;
        content.elements.splice(insertAt, 0, restored);
        content.orderVersion =
          Math.max(
            content.orderVersion ?? 0,
            ...history.map((snapshot) => snapshot.orderVersion ?? 0),
          ) + 1;
      }
    } else if (index >= 0) {
      content.elements.splice(index, 1);
      content.orderVersion =
        Math.max(
          content.orderVersion ?? 0,
          ...history.map((snapshot) => snapshot.orderVersion ?? 0),
        ) + 1;
    }
  },
  restore(current, saved, history = []) {
    const historical = new Map<string, Pick<BoardElement, 'version' | 'sourceRevision'>>();
    for (const snapshot of history) {
      for (const element of snapshot.elements) {
        const previous = historical.get(element.id);
        historical.set(element.id, {
          version: Math.max(previous?.version ?? 0, element.version),
          sourceRevision: Math.max(
            Number(previous?.sourceRevision ?? 0),
            Number(element.sourceRevision ?? 0),
          ),
        });
      }
    }

    const changedOrder = !same(
      current.elements.map((element) => element.id),
      saved.elements.map((element) => element.id),
    );

    return {
      elements: saved.elements.map((item) =>
        restoredElement(
          item,
          current.elements.find((element) => element.id === item.id),
          historical.get(item.id),
        ),
      ),
      style: copy(saved.style),
      motion: copy(saved.motion),
      orderVersion:
        Math.max(
          current.orderVersion ?? 0,
          ...history.map((snapshot) => snapshot.orderVersion ?? 0),
        ) + (changedOrder ? 1 : 0),
    };
  },
  validateRestore(current, restored, baseline, mode) {
    assertLockedGeometry(current, restored, baseline);
    const unlocked = current.elements.find(
      (element) =>
        element.locked && restored.elements.some((next) => next.id === element.id && !next.locked),
    );

    if (unlocked) {
      const contentFields = (element: BoardElement) => {
        const { locked: _locked, ...fields } = mergeFields(element);

        return fields;
      };

      const onlyLocks =
        current.elements.length === restored.elements.length &&
        current.elements.every(
          (element, index) =>
            element.id === restored.elements[index]?.id &&
            jsonEqual(contentFields(element), contentFields(restored.elements[index]!)),
        ) &&
        jsonEqual(current.style, restored.style) &&
        jsonEqual(current.motion, restored.motion);

      if (mode !== 'undo' || !onlyLocks) {
        throw new StudioError('LOCKED', '恢复历史不能隐式解锁对象，请先单独明确解锁。', {
          elementId: unlocked.id,
        });
      }
    }
  },
  snapshotFeedback,
};

type LegacyHistoryEntry = WhiteboardState['history'][number]['entry'];
type LegacySavedBoard = { entry: LegacyHistoryEntry; board: Board };
type LegacyStateMetadata = Omit<
  WhiteboardState,
  'artifact' | 'content' | 'history' | 'schemaVersion'
>;
type LegacyWhiteboardState = {
  board: Board;
  history: LegacySavedBoard[];
} & LegacyStateMetadata;

export function decodeWhiteboardState(value: unknown): WhiteboardState | undefined {
  if (object(value) && value.schemaVersion === 1 && object(value.board)) {
    const legacy = value as unknown as LegacyWhiteboardState;
    const { board, history, ...rest } = legacy;
    const { artifact, ...content } = board;

    return {
      ...rest,
      schemaVersion: 2,
      artifact,
      content,
      history: history.map((saved) => {
        const { artifact: metadata, ...data } = saved.board;

        return { entry: saved.entry, artifact: metadata, content: data };
      }),
    };
  }

  return;
}

function readSummary(state: WhiteboardState, args: Record<string, unknown>) {
  const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
  const limit = Math.min(200, Math.max(1, Math.floor(Number(args.limit) || 100)));
  const items = state.content.elements.slice(offset, offset + limit).map((item) => ({
    id: item.id,
    type: item.type,
    label: item.text?.slice(0, 200),
    version: item.version,
    sourceRevision: item.sourceRevision,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
  }));

  return {
    artifact: state.artifact,
    orderVersion: state.content.orderVersion ?? 0,
    counts: state.content.elements.reduce<Record<string, number>>((out, item) => {
      out[item.type] = (out[item.type] ?? 0) + 1;

      return out;
    }, {}),
    items,
    totalCount: state.content.elements.length,
    offset,
    ...(offset + limit < state.content.elements.length ? { nextOffset: offset + limit } : {}),
    feedback: state.feedback.filter((item) => item.status !== 'resolved').length,
  };
}

function readObjects(state: WhiteboardState, args: Record<string, unknown>) {
  let ids: unknown[] | undefined;
  if (Array.isArray(args.ids)) {
    ids = args.ids;
  } else if (Array.isArray(args.elementIds)) {
    ids = args.elementIds;
  }

  return {
    artifact: state.artifact,
    orderVersion: state.content.orderVersion ?? 0,
    elements: state.content.elements.filter((item) => !ids || ids.includes(item.id)),
    ...(ids?.includes('$order')
      ? { units: [{ id: '$order', value: orderUnit(state.content) }] }
      : {}),
  };
}

function readTasks(state: WhiteboardState, args: Record<string, unknown>) {
  const elementId = safeId(args.elementId, '任务清单 ID');
  const element =
    args.feedbackId === undefined
      ? state.content.elements.find((item) => item.id === elementId)
      : state.sources[safeId(args.feedbackId, '反馈 ID')]?.find(
          (source) => source.element?.id === elementId,
        )?.element;

  if (!element || element.type !== 'todo') {
    throw new StudioError('NOT_FOUND', '任务清单不存在。');
  }

  const ids = args.itemIds;
  const validCount = Array.isArray(ids) && ids.length > 0 && ids.length <= TODO_ITEM_LIMIT;
  if (ids !== undefined && (!validCount || !ids.every(isTodoId))) {
    throw new StudioError('INVALID_ARGUMENT', '任务行 ID 列表无效。');
  }
  if (args.checked !== undefined && typeof args.checked !== 'boolean') {
    throw new StudioError('INVALID_ARGUMENT', '任务完成筛选须为布尔值。');
  }
  if (!validTaskPage(args.offset, args.limit)) {
    throw new StudioError('INVALID_ARGUMENT', '任务行分页无效，每页最多 20 行。');
  }

  const all = normalizeTodoItems(element.data?.items);
  const selected = all.filter(
    (item) =>
      (!ids || ids.includes(item.id)) &&
      (args.checked === undefined || item.checked === args.checked),
  );
  const offset = Number(args.offset ?? 0);
  const limit = Number(args.limit ?? 10);
  const next = offset + limit;

  return {
    artifactId: state.artifact.id,
    elementId,
    version: element.version,
    title: element.text ?? '任务清单',
    items: selected.slice(offset, next),
    totalCount: selected.length,
    totalItems: all.length,
    completedCount: all.filter((item) => item.checked).length,
    offset,
    ...(next < selected.length ? { nextOffset: next } : {}),
  };
}

function validTaskPage(offset: unknown, limit: unknown): boolean {
  const validOffset = offset === undefined || (Number.isSafeInteger(offset) && Number(offset) >= 0);
  if (!validOffset) {
    return false;
  }
  if (limit === undefined) {
    return true;
  }

  return Number.isSafeInteger(limit) && Number(limit) >= 1 && Number(limit) <= 20;
}

function readBlocks(state: WhiteboardState, args: Record<string, unknown>) {
  const elementId = safeId(args.elementId ?? args.regionId, '文档 ID');
  const element = args.feedbackId
    ? state.sources[safeId(args.feedbackId, '反馈 ID')]?.find(
        (source) => source.element?.id === elementId,
      )?.element
    : state.content.elements.find((item) => item.id === elementId && item.type === 'document');

  if (!element?.document) {
    throw new StudioError('NOT_FOUND', '文档区域不存在。');
  }

  const all: {
    block: import('../../contracts/document.js').DocumentBlock;
    parentId: string | null;
    afterId: string | null;
  }[] = [];
  const visit = (
    blocks: import('../../contracts/document.js').DocumentBlock[],
    parentId: string | null,
  ) => {
    let afterId: string | null = null;
    for (const block of blocks) {
      all.push({ block, parentId, afterId });
      visit(block.children ?? [], block.id);
      afterId = block.id;
    }
  };

  visit(element.document.blocks, null);
  const ids = args.blockIds;
  if (ids !== undefined && (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string'))) {
    throw new StudioError('INVALID_ARGUMENT', '段落 ID 列表无效。');
  }

  const selected = ids ? all.filter(({ block }) => (ids as string[]).includes(block.id)) : all;
  const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
  const limit = Math.min(200, Math.max(1, Math.floor(Number(args.limit) || 100)));

  return {
    artifactId: state.artifact.id,
    elementId,
    version: element.version,
    schemaVersion: 1,
    flat: true,
    blocks: selected.slice(offset, offset + limit).map(({ block, parentId, afterId }) => ({
      ...copy(block),
      children: [],
      parentId,
      afterId,
    })),
    totalCount: selected.length,
    ...(offset + limit < selected.length ? { nextOffset: offset + limit } : {}),
  };
}

function readSource(state: WhiteboardState, args: Record<string, unknown>) {
  if (args.feedbackId) {
    const snapshots = state.sources[safeId(args.feedbackId, '反馈 ID')];
    const snapshot = snapshots?.find(
      (item) =>
        (args.regionId === undefined || item.regionId === args.regionId) &&
        (args.elementId === undefined || item.element?.id === args.elementId),
    );

    if (!snapshot) {
      throw new StudioError('NOT_FOUND', '反馈没有对应的冻结源码。');
    }
    if (snapshot.element?.type === 'document') {
      return {
        ...copy(snapshot),
        document: copy(snapshot.element.document),
        sourceVersion: snapshot.element.version,
      };
    }

    return { ...copy(snapshot), sources: copy(snapshots) };
  }

  const document = state.content.elements.find(
    (item) => item.id === (args.elementId ?? args.regionId) && item.type === 'document',
  );

  if (document?.document) {
    return {
      artifactId: state.artifact.id,
      elementId: document.id,
      version: document.version,
      document: copy(document.document),
      text: documentPlainText(document.document),
    };
  }

  const regionId = safeId(args.regionId ?? args.elementId, '区域 ID');
  const { region } = htmlSource(
    [state, ...state.history.slice().reverse()],
    regionId,
    args.sourceRevision,
  );

  return {
    html: region.html,
    regionId,
    sourceRevision: region.sourceRevision ?? 1,
    version: region.sourceRevision ?? 1,
    artifactId: state.artifact.id,
  };
}

export const whiteboardProduct: ProductDefinition<
  WhiteboardContent,
  Operation,
  Anchor,
  SourceSnapshot
> = {
  adapter: whiteboardAdapter,
  title: '白板',
  defaultTitle: '未命名白板',
  create: (args, base) => initialWhiteboard(args.elements, base),
  initialIds: (content) => content.elements.map((element) => element.id),
  project: (snapshot) => copy(boardView(snapshot)),
  result: (snapshot) => ({ board: copy(boardView(snapshot)) }),
  read(state, mode, args) {
    if (mode === 'summary') {
      return readSummary(state, args);
    }
    if (mode === 'objects') {
      return readObjects(state, args);
    }
    if (mode === 'tasks') {
      return readTasks(state, args);
    }
    if (mode === 'blocks') {
      return readBlocks(state, args);
    }
    if (mode === 'source') {
      return readSource(state, args);
    }

    throw new StudioError('INVALID_ARGUMENT', '不支持的白板读取方式。');
  },
  diff(before, after) {
    return {
      changes: elementChanges(before.content, after.content),
      order: orderChanged(before.content, after.content)
        ? { before: orderUnit(before.content), after: orderUnit(after.content) }
        : undefined,
      style: same(before.content.style, after.content.style)
        ? undefined
        : { before: before.content.style, after: after.content.style },
    };
  },
  rewriteAssetReferences(content, from, to) {
    for (const element of content.elements) {
      for (const key of ['src', 'video'] as const) {
        if (typeof element[key] === 'string') {
          element[key] = element[key]!.replace(`/assets/${from}/`, `/assets/${to}/`);
        }
      }
    }

    for (const element of content.elements) {
      if (!element.document) {
        continue;
      }

      for (const block of flattenDocumentBlocks(element.document.blocks)) {
        if (block.type === 'image' && typeof block.props.url === 'string') {
          block.props.url = block.props.url.replace(`/assets/${from}/`, `/assets/${to}/`);
        }
      }
    }
  },
  validateAsset: validateWhiteboardAsset,
  createArchiveContentValidator,
  thumbnail(snapshot, resources) {
    return whiteboardThumbnail(boardView(snapshot), (options) =>
      whiteboardProduct.export(snapshot, 'svg', options, resources),
    );
  },
  async export(snapshot, format, options, resources) {
    const { exportArtifact } = await import('../export.js');
    const board = boardView(snapshot);
    const prepared =
      format !== 'json'
        ? await inlineExportAssets(board, format, options, (reference) =>
            resources.assetDataUri(reference),
          )
        : board;

    return exportArtifact(resources.renderSvgPng, prepared, format, options);
  },
  decodeLegacy: decodeWhiteboardState,
};
