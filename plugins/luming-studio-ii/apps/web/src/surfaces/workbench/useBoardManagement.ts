import { useEffect, useRef, useState } from 'react';
import type { CatalogBoardSummary, CatalogManagementService } from '../../data/catalog/index.js';

type ManagementCommand = Parameters<CatalogManagementService['manageBoard']>[0];
type ManagementReceipt = Awaited<ReturnType<CatalogManagementService['manageBoard']>>;
type RejectionReason = Extract<ManagementReceipt, { kind: 'rejected' }>['reason'];
export type WorkbenchManagementOperation = Extract<
  ManagementCommand['operation'],
  { kind: 'rename' | 'pin' | 'trash' }
>;

interface ManagementAttempt {
  readonly command: ManagementCommand;
  readonly controller: AbortController;
}

type ManagementState =
  | { readonly kind: 'idle' | 'managing' | 'checking' }
  | { readonly kind: 'changed'; readonly message?: string }
  | { readonly kind: 'rejected' | 'unknown'; readonly detail: string };

type AttemptResult = { readonly receipt: ManagementReceipt } | { readonly detail: string };

const rejectionMessages: Readonly<Record<RejectionReason, string>> = {
  invalidTitle: '作品名称无效。',
  commandIdReuse: '操作命令 ID 已被另一条命令使用。',
  forbidden: '你没有管理这件作品的权限。',
  entryVersionChanged: '作品已变化，请确认最新内容后再试。',
  stateChanged: '作品状态已变化，请刷新后再试。',
  invalidCommand: '操作无效。',
  unknown: '服务端拒绝了这次操作。',
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function lookup(
  service: CatalogManagementService,
  attempt: ManagementAttempt,
  previousError?: string,
): Promise<AttemptResult> {
  const prefix = previousError ? previousError + ' ' : '';
  try {
    const receipt = await service.getReceipt(attempt.command.commandId, attempt.controller.signal);
    if (receipt) {
      return { receipt };
    }

    return { detail: prefix + '服务端暂无这条操作的回执。' };
  } catch (error) {
    return { detail: prefix + '查询回执失败。' + errorMessage(error) };
  }
}

async function submit(
  service: CatalogManagementService,
  attempt: ManagementAttempt,
): Promise<AttemptResult> {
  try {
    return { receipt: await service.manageBoard(attempt.command, attempt.controller.signal) };
  } catch (error) {
    const detail = errorMessage(error);
    if (attempt.controller.signal.aborted) {
      return { detail };
    }

    return lookup(service, attempt, detail);
  }
}

export function useBoardManagement(
  service: CatalogManagementService | undefined,
  createCommandId: () => string,
  onChanged: () => void,
  onRejected: () => void,
) {
  const [state, setState] = useState<ManagementState>({ kind: 'idle' });
  const pending = useRef<ManagementAttempt | undefined>(undefined);
  const running = useRef(false);

  useEffect(
    () => () => {
      const attempt = pending.current;
      pending.current = undefined;
      running.current = false;
      attempt?.controller.abort();
    },
    [service],
  );

  function complete(attempt: ManagementAttempt, result: AttemptResult) {
    if (pending.current !== attempt || attempt.controller.signal.aborted) {
      return;
    }

    running.current = false;
    if ('detail' in result) {
      setState({ kind: 'unknown', detail: result.detail });
      return;
    }

    const { receipt } = result;
    if (receipt.commandId !== attempt.command.commandId || receipt.kind === 'purged') {
      setState({ kind: 'unknown', detail: '操作回执与当前命令不匹配。' });
      return;
    }
    if (receipt.kind === 'changed' && receipt.board.boardId !== attempt.command.boardId) {
      setState({ kind: 'unknown', detail: '操作回执与当前作品不匹配。' });
      return;
    }

    pending.current = undefined;
    if (receipt.kind === 'rejected') {
      setState({
        kind: 'rejected',
        detail: rejectionMessages[receipt.reason],
      });
      onRejected();
      return;
    }

    const message =
      attempt.command.operation.kind === 'trash' ? '已移入回收站，可以随时恢复。' : undefined;
    setState({ kind: 'changed', message });
    onChanged();
  }

  function run(attempt: ManagementAttempt, kind: 'managing' | 'checking') {
    if (!service || running.current) {
      return;
    }

    running.current = true;
    setState({ kind });
    const request = kind === 'managing' ? submit(service, attempt) : lookup(service, attempt);

    request
      .then((result) => complete(attempt, result))
      .catch((error: unknown) => complete(attempt, { detail: errorMessage(error) }));
  }

  function manage(board: CatalogBoardSummary, operation: WorkbenchManagementOperation) {
    if (!service || board.canManage !== true || pending.current) {
      return;
    }

    let commandId: string;
    try {
      commandId = createCommandId();
    } catch (error) {
      setState({ kind: 'rejected', detail: errorMessage(error) });
      return;
    }

    const attempt: ManagementAttempt = {
      command: {
        commandId,
        boardId: board.boardId,
        expectedEntryVersion: board.entryVersion,
        operation,
      },
      controller: new AbortController(),
    };
    pending.current = attempt;
    run(attempt, 'managing');
  }

  function retry() {
    if (pending.current) {
      run(pending.current, 'managing');
    }
  }

  function query() {
    if (pending.current) {
      run(pending.current, 'checking');
    }
  }

  function dismiss() {
    if (!pending.current) {
      setState({ kind: 'idle' });
    }
  }

  const busy = state.kind === 'managing' || state.kind === 'checking';

  return { state, busy, blocked: busy || state.kind === 'unknown', manage, retry, query, dismiss };
}
