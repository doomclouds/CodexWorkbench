import type { TableObjectDraft, TableObjectValue, TableSourceRow } from './contracts.js';

export interface CellAddress {
  readonly row: number;
  readonly column: number;
}

export type TableAxis = 'row' | 'column';
type CellRow = readonly string[];

export interface TableModel {
  readonly width: number;
  readonly rows: readonly CellRow[];
  readonly rowIds: readonly string[];
  readonly columnIds: readonly string[];
  readonly widths: readonly number[];
  readonly head: boolean;
}

export interface TableDraft {
  readonly base: TableObjectValue;
  readonly original: TableModel;
  readonly model: TableModel;
}

const defaultWidth = 400;
const minimumColumnWidth = 40;

function sourceRows(value: TableObjectValue): readonly TableSourceRow[] {
  const rows = value.data?.rows;
  if (rows?.length) {
    return rows;
  }
  if (value.text) {
    return value.text
      .replace(/\r\n?/gu, '\n')
      .replace(/\n$/u, '')
      .split('\n')
      .map((row) => row.split('\t'));
  }

  return [['']];
}

function axisIds(prefix: string, length: number, stored?: readonly string[]) {
  const unique = stored?.length === length && new Set(stored).size === length;
  if (unique && stored.every(Boolean)) {
    return stored;
  }

  return Array.from({ length }, (_, index) => prefix + ':' + index);
}

function normalizedWidths(width: number, columns: number, stored?: readonly number[]) {
  const valid =
    stored?.length === columns && stored.every((value) => Number.isFinite(value) && value > 0);

  if (!valid) {
    return Array.from({ length: columns }, () => width / columns);
  }

  const total = stored.reduce((sum, value) => sum + value, 0);
  return stored.map((value) => (value / total) * width);
}

export function readTable(value: TableObjectValue): TableModel {
  const source = sourceRows(value);
  const columns = source.reduce((count, row) => Math.max(count, row.length), 1);
  const rows = source.map((row) =>
    Array.from({ length: columns }, (_, index) => String(row[index] ?? '')),
  );
  const width = Number.isFinite(value.width) && value.width > 0 ? value.width : defaultWidth;

  return {
    rows,
    width,
    rowIds: axisIds(value.id + ':row', rows.length, value.data?.rowIds),
    columnIds: axisIds(value.id + ':col', columns, value.data?.columnIds),
    widths: normalizedWidths(width, columns, value.data?.columnWidths),
    head: value.data?.head !== false,
  };
}

function sameVector<T>(left: readonly T[], right: readonly T[]) {
  return (
    left === right ||
    (left.length === right.length && left.every((item, index) => item === right[index]))
  );
}

function sameAxes(left: TableModel, right: TableModel) {
  return sameVector(left.rowIds, right.rowIds) && sameVector(left.columnIds, right.columnIds);
}

export function sameTable(left: TableModel, right: TableModel) {
  if (left === right) {
    return true;
  }

  const sameDimensions = left.width === right.width && sameVector(left.widths, right.widths);
  const sameStyle = left.head === right.head;
  const sameContent =
    sameAxes(left, right) && left.rows.every((row, index) => sameVector(row, right.rows[index]!));

  return sameDimensions && sameStyle && sameContent;
}

export function tableDraft(value: TableObjectValue, recovered?: TableObjectDraft): TableDraft {
  if (recovered && recovered.base.id === value.id) {
    return {
      base: recovered.base,
      original: readTable(recovered.base),
      model: readTable(recovered.value),
    };
  }

  const model = readTable(value);
  return { base: value, original: model, model };
}

export function describeTableDraft(draft: TableDraft): TableObjectDraft {
  const { base, model } = draft;

  return {
    base,
    value: {
      ...base,
      width: model.width,
      data: {
        ...base.data,
        rows: model.rows,
        rowIds: model.rowIds,
        columnIds: model.columnIds,
        columnWidths: model.widths,
        head: model.head,
      },
    },
  };
}

export function projectTableDraft(draft: TableDraft, observed: TableModel) {
  const { original, model } = draft;
  if (!sameAxes(original, model) || !sameAxes(original, observed)) {
    return model;
  }

  const rows = model.rows.map((row, rowIndex) =>
    row.map((text, column) =>
      text === original.rows[rowIndex]?.[column]
        ? (observed.rows[rowIndex]?.[column] ?? text)
        : text,
    ),
  );
  const localWidths = model.width !== original.width || !sameVector(model.widths, original.widths);
  const { width, widths } = localWidths ? model : observed;

  return {
    ...model,
    rows,
    width,
    widths,
    head: model.head === original.head ? observed.head : model.head,
  };
}

export function changeCell(model: TableModel, cell: CellAddress, value: string): TableModel {
  const existing = model.rows[cell.row];
  if (!existing || existing[cell.column] === value) {
    return model;
  }

  const next = existing.map((text, column) => (column === cell.column ? value : text));
  return { ...model, rows: model.rows.map((row, index) => (index === cell.row ? next : row)) };
}

function insertAt<T>(values: readonly T[], index: number, value: T) {
  return [...values.slice(0, index), value, ...values.slice(index)];
}

function removeAt<T>(values: readonly T[], index: number) {
  return values.filter((_, position) => position !== index);
}

function resizedColumns(model: TableModel, widths: readonly number[], locked: boolean) {
  const total = widths.reduce((sum, width) => sum + width, 0);

  return {
    width: locked ? model.width : total,
    widths: locked ? widths.map((width) => (width * model.width) / total) : widths,
  };
}

export function insertAxis(
  model: TableModel,
  axis: TableAxis,
  index: number,
  locked: boolean,
): TableModel {
  const bits = crypto.getRandomValues(new Uint32Array(4));
  const id = axis + ':' + Array.from(bits, (word) => word.toString(16).padStart(8, '0')).join('');
  if (axis === 'row') {
    return {
      ...model,
      rows: insertAt(
        model.rows,
        index,
        model.columnIds.map(() => ''),
      ),
      rowIds: insertAt(model.rowIds, index, id),
    };
  }

  const widths = insertAt(model.widths, index, model.width / model.widths.length);
  return {
    ...model,
    ...resizedColumns(model, widths, locked),
    rows: model.rows.map((row) => insertAt(row, index, '')),
    columnIds: insertAt(model.columnIds, index, id),
  };
}

export function removeAxis(
  model: TableModel,
  axis: TableAxis,
  index: number,
  locked: boolean,
): TableModel {
  if (axis === 'row') {
    return { ...model, rows: removeAt(model.rows, index), rowIds: removeAt(model.rowIds, index) };
  }

  return {
    ...model,
    ...resizedColumns(model, removeAt(model.widths, index), locked),
    rows: model.rows.map((row) => removeAt(row, index)),
    columnIds: removeAt(model.columnIds, index),
  };
}

export function resizeColumn(model: TableModel, column: number, delta: number): TableModel {
  if (delta === 0) {
    return model;
  }

  const widths = model.widths.map((width, index) =>
    index === column ? Math.max(minimumColumnWidth, width + delta) : width,
  );

  return { ...model, ...resizedColumns(model, widths, false) };
}

export function clampCell(cell: CellAddress, model: TableModel): CellAddress {
  return {
    row: Math.min(cell.row, model.rows.length - 1),
    column: Math.min(cell.column, model.columnIds.length - 1),
  };
}

export function tabCell(model: TableModel, cell: CellAddress, backward: boolean) {
  const count = model.columnIds.length;
  const offset = backward ? -1 : 1;
  const index = cell.row * count + cell.column + offset;
  if (index < 0) {
    return undefined;
  }

  return { row: Math.floor(index / count), column: index % count };
}

function mergeCell(base: string, local: string, saved: string) {
  if (base === local) {
    return saved;
  }
  if (base === saved || local === saved) {
    return local;
  }

  return undefined;
}

function rebaseRows(submitted: TableModel, local: TableModel, saved: TableModel) {
  const rows: CellRow[] = [];
  for (const [rowIndex, row] of local.rows.entries()) {
    const merged = row.map((text, column) =>
      mergeCell(submitted.rows[rowIndex]![column]!, text, saved.rows[rowIndex]![column]!),
    );

    if (merged.some((text) => text === undefined)) {
      return undefined;
    }

    rows.push(merged.filter((text) => text !== undefined));
  }

  return rows;
}

export function rebaseTableDraft(
  submitted: TableDraft,
  newer: TableDraft,
  saved: TableObjectValue,
) {
  const committed = tableDraft(saved);
  if (!sameAxes(submitted.model, newer.model) || !sameAxes(submitted.model, committed.model)) {
    return undefined;
  }

  const rows = rebaseRows(submitted.model, newer.model, committed.model);
  return rows && { ...committed, model: { ...committed.model, rows } };
}
