import type { BoardObject, JsonObject, JsonValue } from './model.js';
import {
  contentFits,
  contentRecord,
  type ContentEditRejection,
  type ContentOperation,
  type ContentPayloadDecision,
} from './object-content-edits.js';

type TableEdit = Extract<ContentOperation, { kind: 'table' }>;

interface TableLayoutChange {
  readonly axesChanged: boolean;
  readonly columnsResized: boolean;
}

const maxRows = 1_000;
const maxColumns = 256;
const maxCells = 20_000;
const maxAxisIdLength = 192;
const maxTableWidth = 10_000_000;
const minimumRowHeight = 50;
const widthTolerance = 0.000001;
const controlCharacter = /\p{Cc}/u;

function validAxisId(value: JsonValue): boolean {
  return (
    typeof value === 'string' &&
    value.length <= maxAxisIdLength &&
    Boolean(value.trim()) &&
    !controlCharacter.test(value)
  );
}

function validAxis(value: JsonValue | undefined, count: number): boolean {
  if (!Array.isArray(value) || value.length !== count) {
    return false;
  }

  return value.every(validAxisId) && new Set(value).size === count;
}

function cellValueValid(raw: JsonValue): boolean {
  const cell = contentRecord(raw);
  if (!cell || Object.keys(cell).length !== 1) {
    return false;
  }
  if (typeof cell.text === 'string' || typeof cell.boolValue === 'boolean') {
    return true;
  }
  if (typeof cell.number === 'number') {
    return Number.isFinite(cell.number);
  }

  return cell.nullValue === null || cell.nullValue === 'NULL_VALUE';
}

function validRow(raw: JsonValue, columns: number): boolean {
  const cells = contentRecord(raw)?.cells;

  return Array.isArray(cells) && cells.length === columns && cells.every(cellValueValid);
}

function validWidths(value: JsonValue | undefined, columns: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === columns &&
    value.every((width) => typeof width === 'number' && Number.isFinite(width) && width > 0)
  );
}

function widthsAllowed(value: JsonValue | undefined, columns: number): boolean {
  return (
    value === undefined ||
    validWidths(value, columns) ||
    (Array.isArray(value) && value.length === 0)
  );
}

export function tableContentIssue(data: JsonObject): ContentEditRejection | undefined {
  const grid = contentRecord(data.grid);
  const rows = grid?.rows;
  const columns = Array.isArray(grid?.columnIds) ? grid.columnIds.length : 0;
  if (!grid || !Array.isArray(rows) || !rows.length) {
    return 'invalidEdit';
  }
  if (rows.length > maxRows || columns > maxColumns || rows.length * columns > maxCells) {
    return 'tooLarge';
  }

  const axes =
    columns > 0 && validAxis(grid.rowIds, rows.length) && validAxis(grid.columnIds, columns);
  const widths = widthsAllowed(grid.columnWidths, columns);
  const header = grid.head === undefined || typeof grid.head === 'boolean';
  if (!axes || !widths || !header) {
    return 'invalidEdit';
  }
  if (data.text !== undefined && typeof data.text !== 'string') {
    return 'invalidEdit';
  }
  if (!rows.every((row) => validRow(row, columns))) {
    return 'invalidEdit';
  }
  if (!contentFits(data)) {
    return 'tooLarge';
  }
}

function textRows(data: JsonObject) {
  const text = typeof data.text === 'string' ? data.text : '';

  return text.replace(/\r\n?/gu, '\n').replace(/\n$/u, '').split('\n');
}

function existingColumns(data: JsonObject, grid: JsonObject | undefined): number {
  if (Array.isArray(grid?.rows) && grid.rows.length > 0) {
    return grid.rows.reduce((count: number, row) => {
      const cells = contentRecord(row)?.cells;

      return Array.isArray(cells) ? Math.max(count, cells.length) : count;
    }, 1);
  }

  return textRows(data).reduce((columns, row) => Math.max(columns, row.split('\t').length), 1);
}

function rowCount(data: JsonObject) {
  const rows = contentRecord(data.grid)?.rows;

  return Array.isArray(rows) && rows.length ? rows.length : textRows(data).length;
}

function tableHeight(frameHeight: number, current: JsonObject, data: JsonObject, locked: boolean) {
  const before = rowCount(current);
  const after = rowCount(data);

  if (locked || before === after) {
    return undefined;
  }

  const height = Math.max(minimumRowHeight, frameHeight / before) * after;

  return height === frameHeight ? undefined : height;
}

function columnShares(widths: readonly number[]): readonly number[] {
  const scale = widths.reduce((maximum, width) => Math.max(maximum, width), 0);
  const total = widths.reduce((sum, width) => sum + width / scale, 0);

  return widths.map((width) => width / scale / total);
}

function sharedColumnsResized(
  priorWidths: ReadonlyMap<JsonValue, number>,
  ids: readonly JsonValue[],
  widths: readonly number[],
): boolean {
  const prior: number[] = [];
  const next: number[] = [];
  for (const [index, id] of ids.entries()) {
    const before = priorWidths.get(id);
    if (before !== undefined) {
      prior.push(before);
      next.push(widths[index] ?? 1);
    }
  }

  const oldShares = columnShares(prior);
  const newShares = columnShares(next);

  return newShares.some(
    (width, index) => Math.abs(width - (oldShares[index] ?? 0)) > widthTolerance,
  );
}

function layoutChanges(objectId: string, current: JsonObject, next: JsonObject): TableLayoutChange {
  const before = contentRecord(current.grid);
  const after = contentRecord(next.grid);
  const columns = existingColumns(current, before);
  const rawIds = before?.columnIds;
  const priorIds =
    Array.isArray(rawIds) && validAxis(rawIds, columns)
      ? rawIds
      : Array.from({ length: columns }, (_, index) => objectId + ':col:' + index);
  const nextIds = Array.isArray(after?.columnIds) ? after.columnIds : [];
  const prior = before?.columnWidths;
  const updated = after?.columnWidths;
  const validPrior = validWidths(prior, columns) ? prior : [];
  const validUpdated = validWidths(updated, nextIds.length) ? updated : [];
  const priorById = new Map(priorIds.map((id, index) => [id, validPrior[index] ?? 1]));

  return {
    axesChanged: columns !== nextIds.length || nextIds.some((id, index) => priorIds[index] !== id),
    columnsResized: sharedColumnsResized(priorById, nextIds, validUpdated),
  };
}

function validWidth(width: number): boolean {
  return Number.isFinite(width) && width > 0 && width <= maxTableWidth;
}

export function editTableContent(
  object: BoardObject,
  current: JsonObject,
  { data, widthChange }: TableEdit,
  locked: boolean,
): ContentPayloadDecision {
  const issue = tableContentIssue(data);
  if (issue) {
    return { kind: 'rejected', reason: issue };
  }

  const { axesChanged, columnsResized } = layoutChanges(object.objectId, current, data);
  const changesLayout = axesChanged || columnsResized;
  if (widthChange && ![widthChange.width, widthChange.expectedWidth].every(validWidth)) {
    return { kind: 'rejected', reason: 'invalidEdit' };
  }
  if (widthChange && widthChange.expectedWidth !== object.geometry.width) {
    return { kind: 'conflict' };
  }
  if (changesLayout && !widthChange) {
    return { kind: 'rejected', reason: 'invalidEdit' };
  }

  const width = widthChange?.width ?? object.geometry.width;
  const resizedFrame = width !== object.geometry.width;
  const geometryChanged = changesLayout || resizedFrame;
  const height = tableHeight(object.geometry.height, current, data, locked);
  const label = typeof data.text === 'string' ? data.text : object.label;

  return {
    kind: 'updated',
    label,
    data,
    geometryWidth: geometryChanged ? width : undefined,
    geometryHeight: height,
    requiresGeometryUnlock: columnsResized || resizedFrame,
  };
}
