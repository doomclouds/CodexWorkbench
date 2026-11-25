import type {
  TodoObjectChange,
  TodoObjectEdit,
  TodoObjectItem,
  TodoObjectSnapshot,
  TodoSourceRef,
} from './contracts.js';

export const maxTodoItems = 200;
export const maxTodoTextBytes = 2_000;
export const maxTodoTitleLength = 200;
export const defaultTodoTitle = '任务清单';

const encoder = new TextEncoder();
const validId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;

function isOptionalId(value: string | undefined) {
  return value === undefined || validId.test(value);
}

function checkSource(source: TodoSourceRef | undefined) {
  if (!source) {
    return;
  }

  const idsValid = [source.artifactId, source.blockId, source.itemId].every(isOptionalId);
  const locationValid = !(source.blockId && source.itemId);
  if (!validId.test(source.elementId) || !idsValid || !locationValid) {
    throw new Error('任务来源对象、内容定位或版本无效。');
  }
  if (
    source.version !== undefined &&
    (!Number.isSafeInteger(source.version) || source.version < 1)
  ) {
    throw new Error('任务来源对象、内容定位或版本无效。');
  }
}

function validateItem(item: TodoObjectItem) {
  if (!validId.test(item.id)) {
    throw new Error('任务行 ID 无效。');
  }
  if (
    item.text.length > maxTodoTextBytes ||
    encoder.encode(item.text).byteLength > maxTodoTextBytes
  ) {
    throw new Error('任务文字须在 2,000 UTF-8 字节以内。');
  }
  if (typeof item.checked !== 'boolean') {
    throw new Error('任务完成状态必须是布尔值。');
  }

  checkSource(item.sourceRef);
}

function insertionIndex(items: readonly TodoObjectItem[], afterId?: string | null) {
  if (afterId === undefined) {
    return items.length;
  }
  if (afterId === null) {
    return 0;
  }

  const index = items.findIndex((item) => item.id === afterId);
  if (index < 0) {
    throw new Error('位置对应的任务行已不存在。');
  }

  return index + 1;
}

function updateItem(item: TodoObjectItem, change: Extract<TodoObjectChange, { op: 'update' }>) {
  const { text = item.text, checked = item.checked, sourceRef = item.sourceRef } = change.changes;
  const next = { ...item, text, checked, sourceRef: sourceRef ?? undefined };
  validateItem(next);

  return next;
}

function applyRowChange(
  items: TodoObjectItem[],
  ids: Set<string>,
  change: Exclude<TodoObjectChange, { op: 'rename' }>,
) {
  if (change.op === 'insert') {
    validateItem(change.item);
    if (ids.has(change.item.id)) {
      throw new Error('任务行 ID 已存在或已在本次提交使用。');
    }
    if (items.length >= maxTodoItems) {
      throw new Error('清单最多可保存 200 行。');
    }

    items.splice(insertionIndex(items, change.afterId), 0, change.item);
    ids.add(change.item.id);
    return;
  }

  const index = items.findIndex((item) => item.id === change.id);
  const item = items[index];
  if (!item) {
    throw new Error('要修改的任务行已不存在。');
  }

  switch (change.op) {
    case 'update':
      items[index] = updateItem(item, change);
      break;
    case 'delete':
      items.splice(index, 1);
      break;
    case 'move':
      if (change.id === change.afterId) {
        throw new Error('移动任务行需要其他行的 ID 或 null。');
      }

      items.splice(index, 1);
      items.splice(insertionIndex(items, change.afterId), 0, item);
      break;
  }
}

export function applyTodoObjectEdit(
  value: TodoObjectSnapshot,
  edit: TodoObjectEdit,
): TodoObjectSnapshot | false {
  if (edit.objectId !== value.id || edit.expectedRevision !== value.revision) {
    return false;
  }
  if (edit.changes.length === 0 || edit.changes.length > maxTodoItems) {
    throw new Error('一次提交需要 1 至 200 个任务行操作。');
  }

  const items = [...value.items];
  const ids = new Set(items.map(({ id }) => id));
  let title = value.title;
  for (const change of edit.changes) {
    if (change.op === 'rename') {
      title = change.title.trim() || defaultTodoTitle;
      if (title.length > maxTodoTitleLength) {
        throw new Error('清单标题最多 200 个字符。');
      }
    } else {
      applyRowChange(items, ids, change);
    }
  }

  return { ...value, revision: value.revision + 1, title, items };
}

function sourceKey(source: TodoSourceRef | undefined) {
  return (
    source &&
    JSON.stringify([
      source.artifactId,
      source.elementId,
      source.blockId,
      source.itemId,
      source.version,
    ])
  );
}

function sameItem(left: TodoObjectItem, right: TodoObjectItem | undefined) {
  if (!right || left.id !== right.id) {
    return false;
  }

  return (
    left.text === right.text &&
    left.checked === right.checked &&
    sourceKey(left.sourceRef) === sourceKey(right.sourceRef)
  );
}

export function sameTodoContent(left: TodoObjectSnapshot, right: TodoObjectSnapshot) {
  if (left.title !== right.title || left.items.length !== right.items.length) {
    return false;
  }

  return left.items.every((item, index) => sameItem(item, right.items[index]));
}

export function taskLabel(item: TodoObjectItem) {
  return item.text || '未命名任务';
}
