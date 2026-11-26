import { useEffect, useRef, useState } from 'react';
import type {
  WhiteboardMoveCommand,
  WhiteboardMoveReceipt,
  createWhiteboardSession,
} from '../../data/whiteboard/index.js';
import type { CanvasEditIntent, CanvasMoveIntent } from '../../ui/domain/canvas/index.js';

type WhiteboardSession = ReturnType<typeof createWhiteboardSession>;

interface PendingMove {
  readonly edits: readonly CanvasMoveIntent[];
  readonly command: WhiteboardMoveCommand;
}

type MoveState =
  | { readonly kind: 'idle' | 'saved' }
  | { readonly kind: 'saving' | 'checking'; readonly move: PendingMove }
  | { readonly kind: 'unknown'; readonly move: PendingMove; readonly detail: string }
  | { readonly kind: 'conflict' | 'rejected' | 'unsupported'; readonly detail: string };

type MoveAttempt = { readonly receipt: WhiteboardMoveReceipt } | { readonly detail: string };

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

function reportReceipt(receipt: WhiteboardMoveReceipt): MoveState {
  switch (receipt.kind) {
    case 'applied':
      return { kind: 'saved' };
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
  submitError?: string,
): Promise<MoveAttempt> {
  try {
    const receipt = await session.readReceipt(commandId);
    if (receipt) {
      return { receipt };
    }

    return { detail: submitError ? submitError + ' ' + noReceipt : noReceipt };
  } catch (error) {
    const detail = '查询回执失败。' + requestError(error);

    return { detail: submitError ? submitError + ' ' + detail : detail };
  }
}

async function submitMove(
  session: WhiteboardSession,
  command: WhiteboardMoveCommand,
  isActive: () => boolean,
): Promise<MoveAttempt> {
  try {
    return { receipt: await session.submitMove(command) };
  } catch (error) {
    const detail = requestError(error);
    if (isActive()) {
      return queryReceipt(session, command.commandId, detail);
    }

    return { detail };
  }
}

export function useMoveSession(
  session: WhiteboardSession,
  boardId: string,
  canEdit: boolean,
  createCommandId: () => string,
) {
  const [state, setState] = useState<MoveState>({ kind: 'idle' });
  const pending = useRef<PendingMove | undefined>(undefined);
  const running = useRef(false);

  useEffect(
    () => () => {
      pending.current = undefined;
      running.current = false;
    },
    [],
  );

  function complete(move: PendingMove, result: MoveAttempt) {
    if (pending.current !== move) {
      return;
    }

    running.current = false;
    if ('detail' in result) {
      setState({ kind: 'unknown', move, detail: result.detail });
      return;
    }

    pending.current = undefined;
    setState(reportReceipt(result.receipt));
    if (result.receipt.kind === 'conflict') {
      session.reload();
    }
  }

  function run(move: PendingMove, kind: 'saving' | 'checking') {
    if (running.current || pending.current !== move) {
      return;
    }

    running.current = true;
    setState({ kind, move });

    const request =
      kind === 'saving'
        ? submitMove(session, move.command, () => pending.current === move)
        : queryReceipt(session, move.command.commandId);

    request
      .then((result) => complete(move, result))
      .catch((error: unknown) => complete(move, { detail: requestError(error) }));
  }

  function handleEdit(intent: CanvasEditIntent) {
    if (!canEdit || pending.current) {
      return;
    }

    if (intent.kind !== 'move') {
      setState({ kind: 'unsupported', detail: '当前只支持保存对象位置。' });
      return;
    }

    let commandId: string;
    try {
      commandId = createCommandId();
    } catch (error) {
      setState({ kind: 'rejected', detail: requestError(error) });
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

  return { state, pendingEdits, handleEdit, retryMove, checkReceipt, canRetry: canEdit };
}
