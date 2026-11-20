export interface TodoSourceRef {
  artifactId?: string;
  elementId: string;
  blockId?: string;
  itemId?: string;
  version?: number;
}

export interface TodoItem {
  id: string;
  text: string;
  checked: boolean;
  sourceRef?: TodoSourceRef;
}

export type TodoOperation =
  | { op: 'insert'; item: TodoItem; afterId?: string | null }
  | { op: 'update'; id: string; changes: { text?: string; checked?: boolean; sourceRef?: TodoSourceRef | null } }
  | { op: 'delete'; id: string }
  | { op: 'move'; id: string; afterId: string | null };

export const TODO_ITEM_LIMIT = 200;
export const TODO_TEXT_BYTES = 2_000;

const encoder = new TextEncoder();
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = (message: string) => Object.assign(new Error(message), { code: 'INVALID_ARGUMENT' });
const conflict = (message: string) => Object.assign(new Error(message), { code: 'CONFLICT' });
export const isTodoId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(value);

function normalizeSource(value: unknown): TodoSourceRef {
  if (!record(value)) throw invalid('任务来源需要作品对象引用。');
  const { artifactId, elementId, blockId, itemId, version } = value;
  if (!isTodoId(elementId) || (artifactId !== undefined && !isTodoId(artifactId)) ||
      (blockId !== undefined && !isTodoId(blockId)) || (itemId !== undefined && !isTodoId(itemId)) ||
      (blockId !== undefined && itemId !== undefined) ||
      (version !== undefined && (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1))) {
    throw invalid('任务来源对象、内容定位或版本无效。');
  }
  return {
    ...(artifactId !== undefined ? { artifactId } : {}),
    elementId,
    ...(blockId !== undefined ? { blockId } : {}),
    ...(itemId !== undefined ? { itemId } : {}),
    ...(version !== undefined ? { version } : {}),
  };
}

function normalizeItem(value: unknown): TodoItem {
  if (!record(value)) throw invalid('任务行无效。');
  const { id, text, checked, sourceRef } = value;
  if (!isTodoId(id)) throw invalid('任务行 ID 无效。');
  if (typeof text !== 'string' || text.length > TODO_TEXT_BYTES || encoder.encode(text).byteLength > TODO_TEXT_BYTES) throw invalid('任务文字须在 2,000 UTF-8 字节以内。');
  if (checked !== undefined && typeof checked !== 'boolean') throw invalid('任务完成状态必须是布尔值。');
  return { id, text, checked: checked ?? false, ...(sourceRef !== undefined ? { sourceRef: normalizeSource(sourceRef) } : {}) };
}

export function normalizeTodoItems(value: unknown): TodoItem[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > TODO_ITEM_LIMIT) throw invalid('任务清单须为最多 200 行的数组。');
  const items = Array.from(value, normalizeItem);
  if (new Set(items.map(item => item.id)).size !== items.length) throw invalid('任务清单的行 ID 必须唯一。');
  return items;
}

function insertionIndex(items: readonly TodoItem[], afterId: unknown): number {
  if (afterId === undefined) return items.length;
  if (afterId === null) return 0;
  if (!isTodoId(afterId)) throw invalid('任务行的位置锚点无效。');
  const index = items.findIndex(item => item.id === afterId);
  if (index < 0) throw conflict('位置对应的任务行已不存在。');
  return index + 1;
}

export function applyTodoOperations(items: readonly TodoItem[], operations: readonly TodoOperation[]): TodoItem[] {
  const next = normalizeTodoItems(items);
  if (!Array.isArray(operations) || !operations.length || operations.length > TODO_ITEM_LIMIT) throw invalid('一次提交需要 1 至 200 个任务行操作。');
  const assignedIds = new Set(next.map(item => item.id));
  for (const operation of operations) {
    if (!record(operation)) throw invalid('任务行操作无效。');
    if (operation.op === 'insert') {
      const item = normalizeItem(operation.item);
      if (assignedIds.has(item.id)) throw conflict('任务行 ID 已存在或已在本次提交使用。');
      if (next.length >= TODO_ITEM_LIMIT) throw invalid('清单最多可保存 200 行。');
      next.splice(insertionIndex(next, operation.afterId), 0, item);
      assignedIds.add(item.id);
      continue;
    }
    if (!isTodoId(operation.id)) throw invalid('任务行 ID 无效。');
    const index = next.findIndex(item => item.id === operation.id);
    const item = next[index];
    if (!item) throw conflict('要修改的任务行已不存在。');
    switch (operation.op) {
      case 'update': {
        if (!record(operation.changes) || Object.keys(operation.changes).some(key => !['text', 'checked', 'sourceRef'].includes(key))) throw invalid('任务行只支持更新正文、完成状态和来源。');
        const { text = item.text, checked = item.checked, sourceRef = item.sourceRef } = operation.changes;
        next[index] = normalizeItem({ id: item.id, text, checked, sourceRef: sourceRef === null ? undefined : sourceRef });
        break;
      }
      case 'delete':
        next.splice(index, 1);
        break;
      case 'move':
        if (operation.afterId === undefined || operation.afterId === item.id) throw invalid('移动任务行需要其他行的 ID 或 null。');
        next.splice(index, 1);
        next.splice(insertionIndex(next, operation.afterId), 0, item);
        break;
      default:
        throw invalid('不支持的任务行操作。');
    }
  }
  return next;
}
