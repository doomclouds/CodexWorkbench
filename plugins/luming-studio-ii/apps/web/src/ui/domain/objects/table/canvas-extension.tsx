import { useMemo } from 'react';

import type { CanvasObjectExtension, CanvasObjectViewProps } from '../../canvas/index.js';
import type { TableObjectActivity, TableObjectDraft, TableObjectValue } from './contracts.js';
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

function TableCanvasView({
  id,
  payload,
  geometry,
  selected,
  interactive,
  readOnly,
  locked,
  zoom,
  editRequest,
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

  if (!value) {
    return content;
  }

  async function handleSave(draft: TableObjectDraft) {
    const receipt = await request({
      name: 'table.save',
      expectedVersion: draft.base.version,
      value: draft,
    });

    if (receipt.ok && isTableValue(receipt.payload.value)) {
      return receipt.payload.value;
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
      zoom={zoom}
      editRequest={editRequest}
      onSave={handleSave}
      onActivityChange={handleActivityChange}
    />
  );
}

export const tableExtension: CanvasObjectExtension = {
  kind: 'table',
  capabilities: { content: 'native', move: true, resize: true, rotate: false, connect: true },
  placement: { kind: 'table', label: '表格', width: 480, height: 180 },
  View: TableCanvasView,
};
