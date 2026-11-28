import { useLayoutEffect, useRef, useState } from 'react';
import type {
  BoardEditReceipt,
  BoardEditRejection,
  ReverseBoardEditCommand,
  WhiteboardEditService,
  WhiteboardMoveReceipt,
} from '../../data/whiteboard/index.js';

type Direction = 'undo' | 'redo';
type HistoryService = Pick<WhiteboardEditService, 'reverseEdit' | 'getReceipt'>;
type Applied = Extract<BoardEditReceipt, { kind: 'applied' }>;
type Conflict = Extract<BoardEditReceipt, { kind: 'conflict' }>;
type Source = ReverseBoardEditCommand['source'];

interface BoardUndoOptions {
  readonly boardId: string;
  readonly revision: bigint;
  readonly enabled: boolean;
  readonly service: HistoryService | undefined;
  readonly createCommandId: () => string;
  readonly onApplied: (receipt: Applied) => void;
  readonly onConflict: (receipt: Conflict) => void;
}

interface Entry {
  readonly source: Source;
  readonly revision: bigint;
}

interface UndoHistory {
  readonly boardId: string;
  readonly undo: readonly Entry[];
  readonly redo: readonly Entry[];
  readonly lastEditRevision: bigint;
  readonly seen: readonly string[];
}

interface Attempt {
  readonly command: ReverseBoardEditCommand;
  readonly direction: Direction;
  readonly entry: Entry;
  readonly controller: AbortController;
}

type UndoState =
  | { readonly kind: 'idle' | 'saved' }
  | { readonly kind: 'saving' | 'checking' }
  | { readonly kind: 'unknown' | 'rejected' | 'conflict'; readonly detail: string };

const historyLimit = 50;
const receiptLimit = 200;
const idle: UndoState = { kind: 'idle' };
const missingReceipt = '还没有查到这次操作的回执。';
const reversalRejections = {
  forbidden: '当前没有撤销或重做权限。',
  invalidEdit: '这次编辑无法撤销或重做。',
  objectNotFound: '相关对象已经不存在。',
  geometryLocked: '相关对象或选区已锁定。',
  commandIdReuse: '原命令 ID 已被不同的请求使用。',
  unsupportedKind: '这类编辑无法撤销或重做。',
  versionUnavailable: '原编辑的版次已不可用。',
  tooLarge: '这次编辑超出可撤销的大小。',
  invalidImage: '相关图片已无法使用。',
  invalidVideo: '相关视频已无法使用。',
  inlineHtmlResource: 'HTML 含有新增的 data: 资源。',
  unknown: '这次编辑无法撤销或重做。',
} satisfies Readonly<Record<BoardEditRejection, string>>;

function emptyHistory(boardId: string): UndoHistory {
  return { boardId, undo: [], redo: [], lastEditRevision: -1n, seen: [] };
}

function receiptKey(source: Source) {
  return source.kind + ':' + source.commandId;
}

function errorDetail(error: unknown) {
  return error instanceof Error ? error.message : '请求失败。';
}

function editChanged({
  objects,
  removedIds,
  order,
  payloads,
  customColors,
  detailsExpired,
}: Applied) {
  const footprint = objects.length + removedIds.length + order.length + payloads.length;

  return (footprint > 0 || customColors !== undefined) && !detailsExpired;
}

function changeStacks(
  history: UndoHistory,
  { direction, entry }: Attempt,
  receipt: Applied,
): UndoHistory {
  const opposite = direction === 'undo' ? 'redo' : 'undo';
  const retained = history[direction].filter((previous) => previous !== entry);
  const source: Source = { kind: 'edit', commandId: receipt.commandId };
  const next = { source, revision: receipt.revision };
  const branch =
    history.lastEditRevision > receipt.revision ? history[opposite] : [...history[opposite], next];

  return {
    ...history,
    [direction]: retained,
    [opposite]: branch.slice(-historyLimit),
    seen: [...history.seen, receiptKey(source)].slice(-receiptLimit),
  };
}

async function queryReceipt(service: HistoryService, { command, controller }: Attempt) {
  const receipt = await service.getReceipt(command.boardId, command.commandId, controller.signal);
  if (receipt?.kind === 'rejected' && receipt.reason === 'forbidden') {
    throw new Error('当前没有权限查询原回执。');
  }

  return receipt;
}

async function requestReceipt(service: HistoryService, attempt: Attempt, checkOnly: boolean) {
  const { command, controller } = attempt;
  const { signal } = controller;
  if (checkOnly || !service.reverseEdit) {
    return queryReceipt(service, attempt);
  }

  try {
    return await service.reverseEdit(command, signal);
  } catch (error) {
    signal.throwIfAborted();
    const receipt = await queryReceipt(service, attempt);
    if (receipt) {
      return receipt;
    }

    throw error;
  }
}

export function useBoardUndo({
  boardId,
  revision,
  enabled,
  service,
  createCommandId,
  onApplied,
  onConflict,
}: BoardUndoOptions) {
  const [history, setHistory] = useState(() => emptyHistory(boardId));
  const [status, setStatus] = useState<{ boardId: string; value: UndoState }>({
    boardId,
    value: idle,
  });
  const ledger = useRef(history);
  const pending = useRef<Attempt | undefined>(undefined);
  const running = useRef(false);

  useLayoutEffect(() => {
    if (ledger.current.boardId !== boardId) {
      ledger.current = emptyHistory(boardId);
    }

    return () => {
      pending.current?.controller.abort();
      pending.current = undefined;
      running.current = false;
    };
  }, [boardId]);

  if (history.boardId !== boardId) {
    setHistory(emptyHistory(boardId));
  }
  if (status.boardId !== boardId) {
    setStatus({ boardId, value: idle });
  }

  function update(next: UndoHistory) {
    ledger.current = next;
    setHistory(next);
  }

  function currentHistory() {
    return ledger.current.boardId === boardId ? ledger.current : emptyHistory(boardId);
  }

  function updateState(value: UndoState) {
    setStatus({ boardId, value });
  }

  function record(source: Source, receipt: { boardId: string; revision: bigint }) {
    if (receipt.boardId !== boardId || source.commandId === pending.current?.command.commandId) {
      return;
    }

    const current = currentHistory();
    const key = receiptKey(source);
    if (current.seen.includes(key)) {
      return;
    }

    const entry = { source, revision: receipt.revision };
    const undo = [...current.undo, entry].sort((a, b) => (a.revision < b.revision ? -1 : 1));
    const later = receipt.revision > current.lastEditRevision;
    update({
      ...current,
      undo: undo.slice(-historyLimit),
      redo: later ? [] : current.redo,
      lastEditRevision: later ? receipt.revision : current.lastEditRevision,
      seen: [...current.seen, key].slice(-receiptLimit),
    });
  }

  function recordEdit(receipt: BoardEditReceipt) {
    if (receipt.kind === 'applied' && editChanged(receipt)) {
      record({ kind: 'edit', commandId: receipt.commandId }, receipt);
    }
  }

  function recordMove(receipt: WhiteboardMoveReceipt) {
    if (receipt.kind === 'applied' && receipt.objects.length > 0) {
      record({ kind: 'move', commandId: receipt.commandId }, receipt);
    }
  }

  function complete(attempt: Attempt, receipt: BoardEditReceipt | undefined) {
    if (pending.current !== attempt) {
      return;
    }

    const { command } = attempt;
    const matches = receipt?.commandId === command.commandId && receipt.boardId === command.boardId;
    if (!matches || !receipt) {
      updateState({ kind: 'unknown', detail: missingReceipt });
      return;
    }

    pending.current = undefined;
    switch (receipt.kind) {
      case 'applied':
        update(changeStacks(currentHistory(), attempt, receipt));
        updateState({ kind: 'saved' });
        try {
          onApplied(receipt);
        } catch (error) {
          updateState({
            kind: 'rejected',
            detail: '操作已保存，刷新白板失败。' + errorDetail(error),
          });
        }
        break;
      case 'conflict':
        updateState({ kind: 'conflict', detail: '相关对象已被修改，无法撤销或重做。' });
        try {
          onConflict(receipt);
        } catch (error) {
          updateState({
            kind: 'conflict',
            detail: '编辑已冲突，刷新白板失败。' + errorDetail(error),
          });
        }
        break;
      case 'rejected':
        updateState({ kind: 'rejected', detail: reversalRejections[receipt.reason] });
        break;
    }
  }

  function run(attempt: Attempt, checkOnly: boolean) {
    if (!service?.reverseEdit || running.current || pending.current !== attempt) {
      return;
    }

    running.current = true;
    updateState({ kind: checkOnly ? 'checking' : 'saving' });
    requestReceipt(service, attempt, checkOnly)
      .then((receipt) => {
        if (pending.current === attempt) {
          running.current = false;
          complete(attempt, receipt);
        }
      })
      .catch((error: unknown) => {
        if (pending.current === attempt) {
          running.current = false;
          updateState({ kind: 'unknown', detail: '撤销或重做结果待确认。' + errorDetail(error) });
        }
      });
  }

  function change(direction: Direction) {
    if (!enabled || !service?.reverseEdit || pending.current) {
      return;
    }

    const entry = currentHistory()[direction].at(-1);
    if (!entry || entry.revision > revision) {
      return;
    }

    try {
      const command = { boardId, commandId: createCommandId(), source: entry.source };
      const attempt = { command, direction, entry, controller: new AbortController() };
      pending.current = attempt;
      run(attempt, false);
    } catch (error) {
      updateState({ kind: 'rejected', detail: errorDetail(error) });
    }
  }

  function retry() {
    if (enabled && pending.current) {
      run(pending.current, false);
    }
  }

  function checkReceipt() {
    if (enabled && pending.current) {
      run(pending.current, true);
    }
  }

  const state = status.boardId === boardId ? status.value : idle;
  const hasPendingEdit =
    state.kind === 'saving' || state.kind === 'checking' || state.kind === 'unknown';
  const available = enabled && !hasPendingEdit && Boolean(service?.reverseEdit);
  const current = history.boardId === boardId ? history : emptyHistory(boardId);
  const undo = current.undo.at(-1);
  const redo = current.redo.at(-1);

  return {
    recordEdit,
    recordMove,
    canUndo: available && Boolean(undo && undo.revision <= revision),
    canRedo: available && Boolean(redo && redo.revision <= revision),
    undo: () => change('undo'),
    redo: () => change('redo'),
    state,
    hasPendingEdit,
    retry,
    checkReceipt,
    canRetry: enabled && Boolean(service?.reverseEdit),
  };
}
