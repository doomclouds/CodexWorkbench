import type {
  BoardHistoryVersion,
  WhiteboardObject,
  WhiteboardScene,
} from '../../data/whiteboard/index.js';

interface HistoryGroup {
  readonly key: string;
  readonly label: string;
  readonly entries: BoardHistoryVersion[];
}

export interface HistoryChange {
  readonly id: string;
  readonly before?: WhiteboardObject;
  readonly after?: WhiteboardObject;
  readonly order?: { readonly before: number; readonly after: number };
}

const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long' });

function dayKey(date: Date): string {
  return [date.getFullYear(), date.getMonth(), date.getDate()].join('-');
}

function historyDateLabel(date: Date, now: Date, yesterday: Date): string {
  const key = dayKey(date);
  if (key === dayKey(now)) {
    return '今天';
  }

  return key === dayKey(yesterday) ? '昨天' : dateFormat.format(date);
}

export function groupHistoryByDate(
  history: readonly BoardHistoryVersion[],
  now = new Date(),
): readonly HistoryGroup[] {
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const groups = new Map<string, HistoryGroup>();
  for (const entry of history) {
    const date = entry.savedAtMillis === undefined ? undefined : new Date(entry.savedAtMillis);
    const key = date ? dayKey(date) : 'unknown';
    const group = groups.get(key);
    if (group) {
      group.entries.push(entry);
    } else {
      groups.set(key, {
        key,
        label: date ? historyDateLabel(date, now, yesterday) : '日期未知',
        entries: [entry],
      });
    }
  }

  return [...groups.values()];
}

function commonOrder(
  objects: readonly WhiteboardObject[],
  other: ReadonlyMap<string, WhiteboardObject>,
): ReadonlyMap<string, number> {
  const order = new Map<string, number>();
  for (const { id } of objects) {
    if (other.has(id)) {
      order.set(id, order.size);
    }
  }

  return order;
}

function hasChanged(current: WhiteboardObject, previous: WhiteboardObject): boolean {
  const geometryChanged = current.geometryVersion !== previous.geometryVersion;
  const contentChanged = current.payloadVersion !== previous.payloadVersion;

  return geometryChanged || contentChanged;
}

export function historyChanges(
  before: WhiteboardScene,
  after: WhiteboardScene,
): readonly HistoryChange[] {
  const previousById = new Map(before.objects.map((object) => [object.id, object]));
  const currentById = new Map(after.objects.map((object) => [object.id, object]));
  const previousOrder = commonOrder(before.objects, currentById);
  const currentOrder = commonOrder(after.objects, previousById);
  const previousPositions = new Map(before.objects.map((object, index) => [object.id, index + 1]));
  const changes: HistoryChange[] = [];
  for (const [index, object] of after.objects.entries()) {
    const previous = previousById.get(object.id);
    const beforeLayer = previousPositions.get(object.id);
    const reordered = previousOrder.get(object.id) !== currentOrder.get(object.id);
    const order =
      reordered && beforeLayer !== undefined
        ? { before: beforeLayer, after: index + 1 }
        : undefined;

    if (!previous || order || hasChanged(object, previous)) {
      changes.push({ id: object.id, before: previous, after: object, order });
    }
  }

  for (const previous of before.objects) {
    if (!currentById.has(previous.id)) {
      changes.push({ id: previous.id, before: previous });
    }
  }

  return changes;
}

export function changeKind(change: HistoryChange): '新增' | '删除' | '修改' {
  if (!change.before) {
    return '新增';
  }

  return change.after ? '修改' : '删除';
}

export function changeLabel({ id, before, after }: HistoryChange): string {
  return after?.label || before?.label || '元素 · ' + id;
}
