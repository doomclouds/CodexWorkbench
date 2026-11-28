import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type {
  WhiteboardMoveCommand,
  WhiteboardMoveReceipt,
  createWhiteboardSession,
} from '../../data/whiteboard/index.js';
import type {
  CanvasEditIntent,
  CanvasMoveIntent,
  CanvasNudgeScope,
  CanvasProps,
} from '../../ui/domain/canvas/index.js';

type WhiteboardSession = ReturnType<typeof createWhiteboardSession>;
type MoveArguments = Parameters<WhiteboardSession['submitMove']>;
type PrepareMoveReceipt = NonNullable<MoveArguments[1]>;

interface PendingMove {
  readonly edits: readonly CanvasMoveIntent[];
  readonly command: WhiteboardMoveCommand;
}

type MoveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saved'; readonly revision: bigint; readonly scope?: CanvasNudgeScope }
  | { readonly kind: 'saving' | 'checking'; readonly move: PendingMove }
  | { readonly kind: 'unknown'; readonly move: PendingMove; readonly detail: string }
  | { readonly kind: 'conflict' | 'rejected' | 'unsupported'; readonly detail: string };

const rejectionMessages = new Map([
  ['forbidden', '当前没有编辑权限。'],
  ['geometryLocked', '对象已锁定。'],
  ['invalidMove', '服务端拒绝了这次位置变更。'],
  ['commandIdReuse', '移动命令 ID 已被不同的请求使用。'],
]);
const noReceipt = '服务端暂无这条移动的回执。';
const emptyEdits: readonly CanvasMoveIntent[] = [];

function requestError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === 'string' ? error : '请求失败。';
}

function nudgeScope(edit?: CanvasMoveIntent): CanvasNudgeScope | undefined {
  if (edit?.nudgeSelection) {
    return { selection: edit.nudgeSelection, targets: edit.changes.map(({ id }) => id) };
  }
}

function reportReceipt(receipt: WhiteboardMoveReceipt, edit?: CanvasMoveIntent): MoveState {
  switch (receipt.kind) {
    case 'applied':
      return { kind: 'saved', revision: receipt.revision, scope: nudgeScope(edit) };
    case 'conflict':
      return {
        kind: 'conflict',
        detail:
          receipt.reason === 'targetsChanged' ? '移动目标已变更。' : '对象位置已被其他操作更新。',
      };
    case 'rejected':
      return {
        kind: 'rejected',
        detail: rejectionMessages.get(receipt.reason) ?? '服务端拒绝了这次移动。',
      };
  }
}

async function queryReceipt(
  session: WhiteboardSession,
  commandId: string,
  prepare: PrepareMoveReceipt,
  submitError?: string,
): Promise<string | undefined> {
  try {
    const receipt = await session.readReceipt(commandId, prepare);
    if (receipt) {
      return undefined;
    }

    return submitError ? submitError + ' ' + noReceipt : noReceipt;
  } catch (error) {
    const detail = '查询回执失败。' + requestError(error);

    return submitError ? submitError + ' ' + detail : detail;
  }
}

async function submitMove(
  session: WhiteboardSession,
  command: WhiteboardMoveCommand,
  prepare: PrepareMoveReceipt,
  isActive: () => boolean,
): Promise<string | undefined> {
  try {
    await session.submitMove(command, prepare);
    return undefined;
  } catch (error) {
    const detail = requestError(error);
    if (isActive()) {
      return queryReceipt(session, command.commandId, prepare, detail);
    }

    return detail;
  }
}

function createMoveFeedback() {
  let state: MoveState = { kind: 'idle' };
  const listeners = new Set<() => void>();

  function notify() {
    for (const listener of listeners) {
      listener();
    }
  }

  function stage(next: MoveState) {
    state = next;

    return notify;
  }

  return {
    read: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    stage,
    update(next: MoveState) {
      stage(next)();
    },
  };
}

export function useMoveSession(
  session: WhiteboardSession,
  boardId: string,
  canEdit: boolean,
  createCommandId: () => string,
  onReceipt?: (receipt: WhiteboardMoveReceipt) => void,
) {
  const [feedback] = useState(createMoveFeedback);
  const state = useSyncExternalStore(feedback.subscribe, feedback.read, feedback.read);
  const pending = useRef<PendingMove | undefined>(undefined);
  const running = useRef(false);

  useEffect(
    () => () => {
      pending.current = undefined;
      running.current = false;
    },
    [],
  );

  function completeUnknown(move: PendingMove, detail: string) {
    if (pending.current !== move) {
      return;
    }

    running.current = false;
    feedback.update({ kind: 'unknown', move, detail });
  }

  function prepareReceipt(move: PendingMove, receipt: WhiteboardMoveReceipt) {
    if (pending.current !== move) {
      return;
    }

    running.current = false;
    pending.current = undefined;
    const publish = feedback.stage(reportReceipt(receipt, move.edits[0]));

    return () => {
      publish();
      onReceipt?.(receipt);
      if (receipt.kind === 'conflict') {
        session.reload();
      }
    };
  }

  function run(move: PendingMove, kind: 'saving' | 'checking') {
    if (running.current || pending.current !== move) {
      return;
    }

    running.current = true;
    feedback.update({ kind, move });
    const prepare = (receipt: WhiteboardMoveReceipt) => prepareReceipt(move, receipt);

    const request =
      kind === 'saving'
        ? submitMove(session, move.command, prepare, () => pending.current === move)
        : queryReceipt(session, move.command.commandId, prepare);

    request
      .then((detail) => {
        if (detail !== undefined) {
          completeUnknown(move, detail);
        }
      })
      .catch((error: unknown) => completeUnknown(move, requestError(error)));
  }

  function handleEdit(intent: CanvasEditIntent) {
    if (!canEdit || pending.current) {
      return;
    }

    if (intent.kind !== 'move') {
      feedback.update({ kind: 'unsupported', detail: '当前只支持保存对象位置。' });
      return;
    }

    let commandId: string;
    try {
      commandId = createCommandId();
    } catch (error) {
      feedback.update({ kind: 'rejected', detail: requestError(error) });
      return;
    }

    const targets = intent.changes.map(({ id, expectedVersion }) => ({
      id,
      expectedGeometryVersion: BigInt(expectedVersion),
    }));
    const move: PendingMove = {
      edits: [intent],
      command: { boardId, commandId, delta: intent.delta, targets },
    };

    pending.current = move;
    run(move, 'saving');
  }

  function retryMove() {
    if (canEdit && pending.current) {
      run(pending.current, 'saving');
    }
  }

  function checkReceipt() {
    if (pending.current) {
      run(pending.current, 'checking');
    }
  }

  const pendingEdits = 'move' in state ? state.move.edits : emptyEdits;

  const nudgeSave = nudgeSaveFor(state);

  return { state, pendingEdits, handleEdit, retryMove, checkReceipt, canRetry: canEdit, nudgeSave };
}

function nudgeSaveFor(state: MoveState): CanvasProps['nudgeSave'] {
  if (state.kind === 'saved') {
    return { kind: 'confirmed', revision: Number(state.revision), scope: state.scope };
  }

  const scope = state.kind === 'saving' ? nudgeScope(state.move.edits[0]) : undefined;
  return scope ? { kind: 'saving', ...scope } : { kind: 'idle' };
}
