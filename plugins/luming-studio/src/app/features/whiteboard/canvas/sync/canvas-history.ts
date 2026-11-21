import { useRef, useState } from 'react';
import type {
  Board,
  BoardElement,
  ElementType,
  Operation,
} from '../../../../../contracts/studio.js';
import { arrowHeads } from '../../../../../shared/whiteboard-geometry.js';
import {
  sameWireContentValue,
  type ContentReceipt,
  type ContentTask,
  type NativeContentQueue,
} from './content-queue.js';

interface ChangeRecord {
  before: BoardElement[];
  after: BoardElement[];
  ids: string[];
  summary: string;
  revision: number;
  historyId?: string;
  fields?: Record<string, string[]>;
}
interface CanvasHistory {
  undo: ChangeRecord[];
  redo: ChangeRecord[];
  lastEditRevision: number;
}

interface CanvasHistoryOptions {
  queue: NativeContentQueue;
  getBoard(): Board;
  canEdit(): boolean;
  isCurrent(): boolean;
}

const insertUndoEntry = (entries: ChangeRecord[], entry: ChangeRecord) =>
  [...entries, entry].sort((a, b) => a.revision - b.revision).slice(-50);

function defaultStrokeWidth(type: ElementType) {
  if (type === 'stroke') {
    return 3;
  }

  return type === 'shape' ? 1.4 : 1.8;
}

function undoFieldChanges(
  previous: BoardElement,
  next: BoardElement,
  expected: BoardElement | undefined,
  fieldNames?: string[],
) {
  const changes: Partial<BoardElement> = {};
  const defaults: Partial<BoardElement> = {
    groupId: '',
    parentId: '',
    fontFamily: '',
    bold: false,
    italic: false,
    locked: false,
    hollow: false,
    dash: false,
    text: '',
    label: '',
    fill: next.type === 'link' ? '#ffffff' : '',
    color: '',
    stroke: '',
    fontSize: 17,
    textAlign: next.type === 'shape' ? 'center' : 'left',
    strokeWidth: Number(next.width ?? defaultStrokeWidth(next.type)),
    heads: arrowHeads(next),
    crop: { zoom: 1, x: 0.5, y: 0.5 },
    data: {},
  };

  for (const key of fieldNames ?? new Set([...Object.keys(expected ?? {}), ...Object.keys(next)])) {
    if (key === 'id' || key === 'version' || sameWireContentValue(expected?.[key], next[key])) {
      continue;
    }
    if (!sameWireContentValue(previous[key] ?? defaults[key], expected?.[key] ?? defaults[key])) {
      throw Object.assign(new Error('这项内容后来已被修改。'), {
        details: { elementId: previous.id },
      });
    }

    changes[key] = next[key] ?? defaults[key];
  }
  return changes;
}

function comparableContent(element: BoardElement | undefined) {
  return (
    element && Object.fromEntries(Object.entries(element).filter(([key]) => key !== 'version'))
  );
}

function inverseElementOperation(
  id: string,
  previous: BoardElement | undefined,
  next: BoardElement | undefined,
  expected: BoardElement | undefined,
  fields?: string[],
): Operation | null {
  if (!next && previous) {
    if (!sameWireContentValue(comparableContent(previous), comparableContent(expected))) {
      throw Object.assign(new Error('对象后来已被修改。'), { details: { elementId: id } });
    }

    return { op: 'delete', id };
  }
  if (next && !previous) {
    if (expected) {
      throw Object.assign(new Error('对象后来已被删除。'), { details: { elementId: id } });
    }

    return { op: 'add', id, element: next };
  }
  if (!next || !previous) {
    return null;
  }

  const changes = undoFieldChanges(previous, next, expected, fields);
  return Object.keys(changes).length ? { op: 'update', id, changes } : null;
}

function inverseOperations(
  direction: 'undo' | 'redo',
  record: ChangeRecord,
  current: BoardElement[],
): Operation[] {
  if (record.historyId) {
    return [{ op: 'restore', versionId: record.historyId, data: { mode: 'undo' } }];
  }

  const target = direction === 'undo' ? record.before : record.after;
  const expected = direction === 'undo' ? record.after : record.before;
  const operations: Operation[] = [];
  for (const id of record.ids) {
    const operation = inverseElementOperation(
      id,
      current.find((element) => element.id === id),
      target.find((element) => element.id === id),
      expected.find((element) => element.id === id),
      record.fields?.[id],
    );

    if (operation) {
      operations.push(operation);
    }
  }
  return operations;
}

function historyTargetLabel(board: Board, id: string | undefined, record?: ChangeRecord) {
  if (!id) {
    return undefined;
  }
  if (id === '$order') {
    return '图层顺序';
  }
  if (id === '$style') {
    return '白板样式';
  }

  const matchesId = (element: BoardElement) => element.id === id;
  const element =
    board.elements.find(matchesId) ??
    record?.after.find(matchesId) ??
    record?.before.find(matchesId);

  return element?.text?.trim().slice(0, 60) || element?.label?.trim().slice(0, 60) || id;
}

export function useCanvasHistory({ queue, getBoard, canEdit, isCurrent }: CanvasHistoryOptions) {
  const [historyError, setHistoryError] = useState('');
  const [history, setHistory] = useState<CanvasHistory>({
    undo: [],
    redo: [],
    lastEditRevision: -1,
  });
  const { undo, redo } = history;
  const historyRef = useRef(history);
  const updateHistory = (value: CanvasHistory) => {
    historyRef.current = value;
    setHistory(value);
  };

  function recordUndoEntry(task: ContentTask, response: ContentReceipt) {
    const ids = task.keys.filter((key) => key !== '$board');
    const operations = (task.args?.operations as Operation[] | undefined) ?? task.operations;
    const knownFields: Record<string, string[]> = {};
    for (const operation of operations) {
      if (operation.id && (operation.op === 'update' || operation.op === 'document')) {
        knownFields[operation.id] = [
          ...new Set([
            ...(knownFields[operation.id] ?? []),
            ...(operation.op === 'document' ? ['document'] : Object.keys(operation.changes ?? {})),
          ]),
        ];
      }
    }
    const mergedWithoutHistory =
      !response.historyEntry &&
      operations.some(
        (operation) =>
          operation.op === 'update' &&
          Object.entries(operation.changes ?? {}).some(
            ([field, value]) =>
              !sameWireContentValue(
                response.board.elements.find((element) => element.id === operation.id)?.[field],
                value,
              ),
          ),
      );
    const history = historyRef.current;
    const revision = response.historyEntry?.revision ?? response.board.artifact.revision;
    const entry = {
      before: task.appliedSources ?? task.sources,
      after: response.board.elements.filter((element) => ids.includes(element.id)),
      ids,
      summary: task.summary,
      revision,
      historyId: response.historyEntry?.id,
      fields: knownFields,
    };
    updateHistory({
      undo: mergedWithoutHistory ? history.undo : insertUndoEntry(history.undo, entry),
      redo: [],
      lastEditRevision: Math.max(history.lastEditRevision, revision),
    });
  }

  function changeHistory(direction: 'undo' | 'redo') {
    if (!canEdit() || queue.unconfirmedHistory) {
      return;
    }

    setHistoryError('');
    const command = direction === 'undo' ? '撤销' : '重做';
    let record: ChangeRecord | undefined;
    queue.enqueueHistory(getBoard(), command, {
      prepare: () => {
        if (!canEdit() || !isCurrent()) {
          return;
        }

        const next = historyRef.current[direction].at(-1);
        if (!next) {
          return;
        }

        record = next;
        const before = getBoard();
        const operations = inverseOperations(direction, next, before.elements);
        if (!operations.length) {
          return;
        }

        return {
          before,
          operations,
          summary: `${command}：${next.summary}`,
          accepted: (receipt) => {
            if (!isCurrent()) {
              return;
            }

            const history = historyRef.current;
            const revision = receipt.historyEntry?.revision ?? receipt.board.artifact.revision;
            const entry = { ...next, revision, historyId: receipt.historyEntry?.id };
            const laterEdit = history.lastEditRevision > revision;

            if (direction === 'undo') {
              updateHistory({
                ...history,
                undo: history.undo.filter((item) => item !== next),
                redo: laterEdit ? history.redo : [...history.redo, entry],
              });
            } else {
              const undo = insertUndoEntry(history.undo, entry);
              updateHistory({
                ...history,
                undo,
                redo: history.redo.filter((item) => item !== next),
              });
            }
          },
        };
      },
      rejected: (failure) => {
        if (!isCurrent()) {
          return;
        }

        const error = failure as { message?: string; details?: { elementId?: string } } | null;
        const id = error?.details?.elementId;
        const target = historyTargetLabel(getBoard(), id, record);
        setHistoryError(
          `无法${command}${record ? `「${record.summary}」` : '这一步'}。${target ? `涉及「${target}」。` : ''}${error?.message || '请查看当前内容。'}`,
        );
      },
    });
  }

  return {
    undo,
    redo,
    historyError,
    clearHistoryError: () => setHistoryError(''),
    changeHistory,
    recordUndoEntry,
  };
}
