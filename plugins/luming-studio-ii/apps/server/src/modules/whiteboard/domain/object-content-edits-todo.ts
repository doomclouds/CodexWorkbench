import type { JsonObject, JsonValue } from './model.js';
import {
  contentFits,
  contentIdentifier,
  contentRecord,
  contentTitleLimit,
  type ContentEditRejection,
  type ContentPayloadPlan,
  type TodoContentEdit,
  type TodoContentItem,
  type TodoContentPlacement,
  type TodoContentSource,
} from './object-content-edits.js';

type TodoRowEdit = Exclude<TodoContentEdit, { kind: 'rename' }>;

interface TodoRows {
  readonly rows: JsonObject[];
  readonly usedIds: Set<string>;
}

const maxTodoItems = 200;
const maxTodoTextBytes = 2_000;
const untitledTodo = '任务清单';
const encoder = new TextEncoder();

function validText(text: string): boolean {
  return text.length <= maxTodoTextBytes && encoder.encode(text).byteLength <= maxTodoTextBytes;
}

function sourceData(source: TodoContentSource): JsonObject {
  const { boardId, objectId, blockId, itemId, version } = source;

  return {
    objectId,
    ...(boardId === undefined ? {} : { boardId }),
    ...(blockId === undefined ? {} : { blockId }),
    ...(itemId === undefined ? {} : { itemId }),
    ...(version === undefined ? {} : { version }),
  };
}

function rowData({ itemId, text, checked, sourceRef }: TodoContentItem): JsonObject {
  return {
    itemId,
    text,
    checked,
    ...(sourceRef === undefined ? {} : { sourceRef: sourceData(sourceRef) }),
  };
}

function readRows(value: JsonValue | undefined): TodoRows | undefined {
  if (!Array.isArray(value) || value.length > maxTodoItems) {
    return;
  }

  const ids = new Set<string>();
  const rows: JsonObject[] = [];
  for (const raw of value) {
    const row = contentRecord(raw);
    const id = row?.itemId;
    const validId = typeof id === 'string' && contentIdentifier.test(id);
    if (!row || !validId || ids.has(id)) {
      return;
    }
    if (typeof row.text !== 'string' || typeof row.checked !== 'boolean') {
      return;
    }

    ids.add(id);
    rows.push(row);
  }

  return { rows, usedIds: ids };
}

function rowPosition(rows: readonly JsonObject[], placement: TodoContentPlacement): number {
  switch (placement.kind) {
    case 'first':
      return 0;
    case 'append':
      return rows.length;
    case 'after': {
      const anchor = rows.findIndex(({ itemId }) => itemId === placement.itemId);

      return anchor < 0 ? -1 : anchor + 1;
    }
  }
}

function addRow(
  rows: JsonObject[],
  usedIds: Set<string>,
  { item, placement }: Extract<TodoRowEdit, { kind: 'insert' }>,
  canLink: (source: TodoContentSource) => boolean,
): ContentEditRejection | undefined {
  if (rows.length >= maxTodoItems || !validText(item.text)) {
    return 'tooLarge';
  }

  const position = rowPosition(rows, placement);
  const newIdentifier = contentIdentifier.test(item.itemId) && !usedIds.has(item.itemId);
  const sourceAllowed = item.sourceRef === undefined || canLink(item.sourceRef);
  if (position < 0 || !newIdentifier || !sourceAllowed) {
    return 'invalidEdit';
  }

  rows.splice(position, 0, rowData(item));
  usedIds.add(item.itemId);
}

function updateRow(
  rows: JsonObject[],
  index: number,
  change: Extract<TodoRowEdit, { kind: 'update' }>,
  canLink: (source: TodoContentSource) => boolean,
): ContentEditRejection | undefined {
  const { text, checked, sourceRef } = change;
  if (text !== undefined && !validText(text)) {
    return 'tooLarge';
  }
  if (sourceRef && !canLink(sourceRef)) {
    return 'invalidEdit';
  }

  const next = { ...rows[index] };
  if (text !== undefined) {
    next.text = text;
  }
  if (checked !== undefined) {
    next.checked = checked;
  }
  if (sourceRef === null) {
    delete next.sourceRef;
  } else if (sourceRef) {
    next.sourceRef = sourceData(sourceRef);
  }

  rows[index] = next;
}

function moveRow(
  rows: JsonObject[],
  index: number,
  row: JsonObject,
  placement: TodoContentPlacement,
): ContentEditRejection | undefined {
  if (placement.kind === 'after' && placement.itemId === row.itemId) {
    return 'invalidEdit';
  }

  rows.splice(index, 1);
  const position = rowPosition(rows, placement);
  if (position < 0) {
    return 'invalidEdit';
  }

  rows.splice(position, 0, row);
}

function applyRowEdit(
  rows: JsonObject[],
  usedIds: Set<string>,
  change: TodoRowEdit,
  canLink: (source: TodoContentSource) => boolean,
): ContentEditRejection | undefined {
  if (change.kind === 'insert') {
    return addRow(rows, usedIds, change, canLink);
  }

  const index = rows.findIndex(({ itemId }) => itemId === change.itemId);
  const row = rows[index];
  if (!row) {
    return 'invalidEdit';
  }

  switch (change.kind) {
    case 'update':
      return updateRow(rows, index, change, canLink);
    case 'delete':
      rows.splice(index, 1);
      return;
    case 'move':
      return moveRow(rows, index, row, change.placement);
  }
}

export function editTodoContent(
  current: JsonObject,
  edits: readonly TodoContentEdit[],
  canLink: (source: TodoContentSource) => boolean,
): ContentPayloadPlan {
  if (edits.length > maxTodoItems) {
    return { kind: 'rejected', reason: 'tooLarge' };
  }

  const list = readRows(current.items ?? []);
  if (!list || !edits.length || typeof current.title !== 'string') {
    return { kind: 'rejected', reason: 'invalidEdit' };
  }

  const { rows, usedIds } = list;
  let title = current.title;
  for (const edit of edits) {
    if (edit.kind === 'rename') {
      title = edit.title.trim() || untitledTodo;
      if (title.length > contentTitleLimit) {
        return { kind: 'rejected', reason: 'tooLarge' };
      }
    } else {
      const reason = applyRowEdit(rows, usedIds, edit, canLink);
      if (reason) {
        return { kind: 'rejected', reason };
      }
    }
  }

  const data = { title, items: rows };
  if (!contentFits(data)) {
    return { kind: 'rejected', reason: 'tooLarge' };
  }

  return { kind: 'updated', label: title, data };
}
