import { useMemo } from 'react';

import type { CanvasObjectExtension, CanvasObjectViewProps } from '../../canvas/index.js';
import type {
  TableCellValue,
  TableObjectActivity,
  TableObjectDraft,
  TableObjectPaint,
  TableObjectValue,
} from './contracts.js';
import { readTable, type TableModel } from './table-model.js';
import { tableBodyPaint, tableHeaderPaint } from './table-paint.js';
import { TableObject } from './TableObject.js';

function isCellValue(value: unknown) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function optionalValues(value: unknown, check: (item: unknown) => boolean) {
  return value === undefined || (Array.isArray(value) && value.every(check));
}

function isTableData(value: unknown) {
  if (value === undefined) {
    return true;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const rows =
    !('rows' in value) ||
    optionalValues(value.rows, (row) => Array.isArray(row) && row.every(isCellValue));
  const rowsIdentified =
    !('rowIds' in value) || optionalValues(value.rowIds, (id) => typeof id === 'string');
  const columnsIdentified =
    !('columnIds' in value) || optionalValues(value.columnIds, (id) => typeof id === 'string');
  const widths =
    !('columnWidths' in value) ||
    optionalValues(value.columnWidths, (size) => typeof size === 'number' && Number.isFinite(size));
  const head = !('head' in value) || value.head === undefined || typeof value.head === 'boolean';
  const marked = rowsIdentified && columnsIdentified && head;

  return rows && marked && widths;
}

function isTableValue(value: unknown): value is TableObjectValue {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const identity = 'id' in value && typeof value.id === 'string';
  const version = 'version' in value && Number.isSafeInteger(value.version);
  const width = 'width' in value && typeof value.width === 'number' && Number.isFinite(value.width);
  const text = !('text' in value) || value.text === undefined || typeof value.text === 'string';
  const content = text && (!('data' in value) || isTableData(value.data));
  const stamped = identity && version;

  return stamped && width && content;
}

function tableDetail(geometry: CanvasObjectViewProps['geometry'], zoom: number) {
  const width = geometry.width * zoom;
  const height = geometry.height * zoom;
  if (width < 96 || height < 44) {
    return 'outline';
  }
  if (width < 240 || height < 96 || 17 * zoom < 8) {
    return 'preview';
  }

  return 'full';
}

function sameColumns<T>(base: readonly T[], target: readonly T[] | undefined) {
  return target?.length === base.length && base.every((value, index) => value === target[index]);
}

function preserveCellType(next: TableCellValue, old: TableCellValue | undefined): TableCellValue {
  return old !== undefined && String(old ?? '') === next ? old : next;
}

function preserveTableScalars(draft: TableObjectDraft, base: TableModel): TableObjectDraft {
  const previous = draft.base.data?.rows;
  if (!previous?.some((row) => row.some((cell) => typeof cell !== 'string'))) {
    return draft;
  }

  const current = draft.value.data;
  const { rows, rowIds, columnIds } = current ?? {};
  if (!rows || !rowIds || !columnIds) {
    return draft;
  }

  const baseRows = new Map(base.rowIds.map((id, index) => [id, previous[index]]));
  const baseColumns = new Map(base.columnIds.map((id, index) => [id, index]));
  const columnIndexes = columnIds.map((id) => baseColumns.get(id));
  const cells = rows.map((row, index) => {
    const source = baseRows.get(rowIds[index] ?? '');

    return row.map((value, column) => {
      const original = columnIndexes[column];

      return preserveCellType(value, original === undefined ? undefined : source?.[original]);
    });
  });

  return { ...draft, value: { ...draft.value, data: { ...current, rows: cells } } };
}

function tableSaveValue(draft: TableObjectDraft) {
  const base = readTable(draft.base);
  const { columnIds, columnWidths } = draft.value.data ?? {};
  const sameWidth = draft.base.width === draft.value.width;
  const sameLayout =
    sameColumns(base.columnIds, columnIds) && sameColumns(base.widths, columnWidths);
  const value = preserveTableScalars(draft, base);

  return sameWidth && sameLayout ? value : { ...value, layoutChanged: true };
}

const placementColumns = [0, 1, 2];
const placementBodyRows = [0, 1];

function TablePlacementPreview({ headerPaint }: { headerPaint: TableObjectPaint }) {
  return (
    <table
      className="studio-object-table-grid studio-object-table-placement"
      aria-hidden="true"
      style={tableBodyPaint}
    >
      <thead>
        <tr>
          {placementColumns.map((column) => (
            <th key={column} style={headerPaint} />
          ))}
        </tr>
      </thead>
      <tbody>
        {placementBodyRows.map((row) => (
          <tr key={row}>
            {placementColumns.map((column) => (
              <td key={column} />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TableCanvasView({
  id,
  object,
  payload,
  geometry,
  selected,
  interactive,
  readOnly,
  locked,
  zoom,
  editRequest,
  formatRequest,
  content,
  onRetentionChange,
  request,
}: CanvasObjectViewProps) {
  const source = payload?.value;
  const projected = useMemo(() => {
    if (isTableValue(source) && source.id === id) {
      return source;
    }
  }, [id, source]);
  const value = useMemo(
    () => projected && { ...projected, width: geometry.width },
    [geometry.width, projected],
  );
  const headerPaint = useMemo(() => tableHeaderPaint(object.fill), [object.fill]);

  if (id === undefined) {
    return <TablePlacementPreview headerPaint={headerPaint} />;
  }
  if (!value) {
    return content;
  }

  async function handleSave(draft: TableObjectDraft) {
    const receipt = await request({
      name: 'table.save',
      expectedVersion: draft.base.version,
      value: tableSaveValue(draft),
    });

    if (receipt.ok && isTableValue(receipt.payload.value)) {
      return receipt.payload.value;
    }
    if (!receipt.ok) {
      throw new Error(receipt.message + ' 草稿已保留。');
    }

    return false as const;
  }

  function handleActivityChange({ editing, dirty, saving, resizing }: TableObjectActivity) {
    const localWork = dirty || saving;
    const interacting = editing || resizing;
    onRetentionChange?.(localWork || interacting);
  }

  return (
    <TableObject
      value={value}
      selected={selected}
      canEdit={interactive && !readOnly}
      locked={locked}
      detail={tableDetail(geometry, zoom)}
      frameHeight={geometry.height}
      zoom={zoom}
      bodyPaint={tableBodyPaint}
      headerPaint={headerPaint}
      editRequest={editRequest}
      formatRequest={formatRequest}
      onSave={handleSave}
      onActivityChange={handleActivityChange}
    />
  );
}

export const tableExtension: CanvasObjectExtension = {
  kind: 'table',
  capturePointerTargetOnBodyDrag: true,
  capabilities: {
    content: 'native',
    move: true,
    resize: true,
    rotate: false,
    connect: true,
    inlineFormats: ['bold', 'italic', 'link', 'bullets', 'numbered'],
  },
  placement: { kind: 'table', label: '表格', width: 480, height: 180, fill: '#ffffff' },
  View: TableCanvasView,
};
