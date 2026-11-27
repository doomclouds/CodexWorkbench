import { hasValidEditInk } from './geometry-edits.js';
import { editLinkContent } from './link-content.js';
import type { BoardObject, JsonObject, JsonValue, PayloadRecord, Point } from './model.js';
import { tableContentIssue } from './object-content-edits-table.js';
import { contentFits, contentTitleLimit } from './object-content-edits.js';

type NativeInitialBodyKind = 'text' | 'sticker' | 'ink' | 'document' | 'todo' | 'table';
type InitialBodyKind = NativeInitialBodyKind | 'embed' | 'link';

const initialBodyKinds = new Map<string, InitialBodyKind>([
  ['text', 'text'],
  ['note', 'text'],
  ['shape', 'text'],
  ['section', 'text'],
  ['connector', 'text'],
  ['sticker', 'sticker'],
  ['ink', 'ink'],
  ['document', 'document'],
  ['todo', 'todo'],
  ['table', 'table'],
  ['html', 'embed'],
  ['link', 'link'],
]);
const maxTextLength = 64 * 1024;
const maxTitleLength = 4096;
const maxStyleStringLength = 128;
const maxFontSize = 512;
const defaultTableRows = [
  ['名称', '说明', '状态'],
  ['项目 A', '双击编辑表格', '进行中'],
  ['项目 B', '待补充', '待处理'],
] as const;
const defaultTableColumnCount = defaultTableRows[0].length;
const alignments = new Set([
  'TEXT_ALIGNMENT_UNSPECIFIED',
  'TEXT_ALIGNMENT_LEFT',
  'TEXT_ALIGNMENT_CENTER',
  'TEXT_ALIGNMENT_RIGHT',
]);

export function supportsGeometryCreation(kind: string): boolean {
  return initialBodyKinds.has(kind);
}

function defaultTableData({ objectId, label, geometry }: BoardObject): JsonObject {
  const rows = defaultTableRows.map((row) => ({ cells: row.map((text) => ({ text })) }));
  const rowIds = rows.map((_row, index) => objectId + ':row:' + index);
  const columnIds = Array.from(
    { length: defaultTableColumnCount },
    (_, index) => objectId + ':col:' + index,
  );
  const columnWidths = columnIds.map(() => geometry.width / defaultTableColumnCount);

  return { text: label, grid: { rows, rowIds, columnIds, columnWidths, head: true } };
}

function defaultInitialData(
  kind: NativeInitialBodyKind,
  object: BoardObject,
): JsonObject | undefined {
  const { label } = object;

  switch (kind) {
    case 'text':
      return { text: '' };
    case 'sticker':
      return { stickerId: 'heart' };
    case 'ink':
      return undefined;
    case 'document':
      return { title: label, schemaVersion: 1, blocks: [] };
    case 'todo':
      return { title: label, items: [] };
    case 'table':
      return defaultTableData(object);
  }
}

function optionalString(value: JsonValue | undefined, maximum: number): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= maximum);
}

function emptyList(value: JsonValue | undefined): boolean {
  return value === undefined || (Array.isArray(value) && value.length === 0);
}

function readInkPoint(value: JsonValue): Point | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const { x = 0, y = 0 } = value;
  if (Object.keys(value).every((key) => key === 'x' || key === 'y')) {
    return typeof x === 'number' && typeof y === 'number' ? { x, y } : undefined;
  }
}

function validInkPoints(points: JsonValue | undefined): boolean {
  if (!Array.isArray(points)) {
    return false;
  }

  const path: Point[] = [];
  for (const value of points) {
    const point = readInkPoint(value);
    if (!point) {
      return false;
    }

    path.push(point);
  }

  return hasValidEditInk(path);
}

function validInitialText({ text, color, fontFamily, fontSize, align }: JsonObject): boolean {
  const validFont =
    fontSize === undefined ||
    (typeof fontSize === 'number' && fontSize > 0 && fontSize <= maxFontSize);

  return (
    optionalString(text, maxTextLength) &&
    optionalString(color, maxStyleStringLength) &&
    optionalString(fontFamily, maxStyleStringLength) &&
    validFont &&
    (align === undefined || (typeof align === 'string' && alignments.has(align)))
  );
}

function validInitialData(kind: NativeInitialBodyKind, data: JsonObject): boolean {
  switch (kind) {
    case 'text':
      return validInitialText(data);
    case 'sticker':
      return (
        optionalString(data.stickerId, maxStyleStringLength) &&
        optionalString(data.fallback, maxStyleStringLength)
      );
    case 'ink':
      return validInkPoints(data.points);
    case 'document':
      return (
        optionalString(data.title, maxTitleLength) &&
        data.schemaVersion === 1 &&
        emptyList(data.blocks)
      );
    case 'todo':
      return optionalString(data.title, maxTitleLength) && emptyList(data.items);
    case 'table':
      return tableContentIssue(data) === undefined;
  }
}

function initialEmbedData({ label }: BoardObject, payload: JsonObject): JsonObject | undefined {
  const { title, html, sourceRevision, state } = payload;
  const validTitle = label.length <= contentTitleLimit && (title === undefined || title === label);
  const startsAtZero = sourceRevision === undefined || sourceRevision === '0';
  if (!validTitle || !startsAtZero || state !== undefined) {
    return undefined;
  }
  if (typeof html !== 'string' || !html.trim()) {
    return undefined;
  }

  const data = { title: label, html, sourceRevision: '0' };

  return contentFits(data) ? data : undefined;
}

export function initialGeometryPayload(
  object: BoardObject,
  payload: PayloadRecord | undefined,
): PayloadRecord | undefined {
  const bodyKind = initialBodyKinds.get(object.kind);
  if (!bodyKind) {
    return undefined;
  }

  const { objectId } = object;
  if (!payload) {
    const needsContent = bodyKind === 'embed' || bodyKind === 'link';
    const data = needsContent ? undefined : defaultInitialData(bodyKind, object);

    return data && { objectId, bodyKind, payloadVersion: 0n, data };
  }
  if (
    payload.objectId !== objectId ||
    payload.payloadVersion !== 0n ||
    payload.bodyKind !== bodyKind
  ) {
    return undefined;
  }

  if (bodyKind === 'embed') {
    const data = initialEmbedData(object, payload.data);

    return data && { ...payload, data };
  }
  if (bodyKind === 'link') {
    const { href } = payload.data;
    if (typeof href !== 'string') {
      return undefined;
    }

    const link = editLinkContent(object.label, href);

    return link.kind === 'updated' && link.label === object.label
      ? { ...payload, data: link.data }
      : undefined;
  }

  return validInitialData(bodyKind, payload.data) ? payload : undefined;
}
