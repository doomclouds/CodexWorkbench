import { useEffect, useRef, useState } from 'react';
import type { BoardCatalogService, CatalogReceipt } from '../../data/catalog/index.js';

type CreateCommand = Parameters<BoardCatalogService['createBoard']>[0];

interface CreationAttempt {
  readonly command: CreateCommand;
  readonly controller: AbortController;
}

type CreationState =
  | { readonly kind: 'idle' | 'creating' | 'checking' }
  | { readonly kind: 'rejected' | 'unknown'; readonly detail: string };

type AttemptResult = { readonly receipt: CatalogReceipt } | { readonly detail: string };

const defaultBoardTitle = '未命名白板';
const missingReceipt = '服务端暂无这条创建命令的回执。';
const rejectionMessages = {
  invalidTitle: '白板名称无效。',
  commandIdReuse: '创建命令 ID 已被另一条命令使用。',
  unknown: '服务端拒绝了这次创建。',
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function lookup(
  service: BoardCatalogService,
  attempt: CreationAttempt,
  createError?: string,
): Promise<AttemptResult> {
  try {
    const receipt = await service.getReceipt(attempt.command.commandId, attempt.controller.signal);
    if (receipt) {
      return { receipt };
    }

    return { detail: createError ? createError + ' ' + missingReceipt : missingReceipt };
  } catch (error) {
    const detail = '查询回执失败。' + errorMessage(error);

    return { detail: createError ? createError + ' ' + detail : detail };
  }
}

async function submit(
  service: BoardCatalogService,
  attempt: CreationAttempt,
): Promise<AttemptResult> {
  try {
    return { receipt: await service.createBoard(attempt.command, attempt.controller.signal) };
  } catch (error) {
    const detail = errorMessage(error);
    if (attempt.controller.signal.aborted) {
      return { detail };
    }

    return lookup(service, attempt, detail);
  }
}

export function useBoardCreation(
  service: BoardCatalogService,
  createCommandId: () => string,
  onOpenBoard: (boardId: string) => void,
) {
  const [state, setState] = useState<CreationState>({ kind: 'idle' });
  const pending = useRef<CreationAttempt | undefined>(undefined);
  const running = useRef(false);

  useEffect(
    () => () => {
      pending.current?.controller.abort();
      pending.current = undefined;
      running.current = false;
    },
    [service],
  );

  function complete(attempt: CreationAttempt, result: AttemptResult) {
    if (pending.current !== attempt || attempt.controller.signal.aborted) {
      return;
    }

    running.current = false;
    if ('detail' in result) {
      setState({ kind: 'unknown', detail: result.detail });
      return;
    }
    if (result.receipt.commandId !== attempt.command.commandId) {
      setState({ kind: 'unknown', detail: '创建回执与当前命令不匹配。' });
      return;
    }

    pending.current = undefined;
    if (result.receipt.kind === 'rejected') {
      setState({ kind: 'rejected', detail: rejectionMessages[result.receipt.reason] });
      return;
    }

    setState({ kind: 'idle' });
    onOpenBoard(result.receipt.board.boardId);
  }

  function run(attempt: CreationAttempt, kind: 'creating' | 'checking') {
    if (running.current) {
      return;
    }

    running.current = true;
    setState({ kind });
    const request = kind === 'creating' ? submit(service, attempt) : lookup(service, attempt);

    request
      .then((result) => complete(attempt, result))
      .catch((error: unknown) => complete(attempt, { detail: errorMessage(error) }));
  }

  function create() {
    if (pending.current) {
      return;
    }

    let commandId: string;
    try {
      commandId = createCommandId();
    } catch (error) {
      setState({ kind: 'rejected', detail: errorMessage(error) });
      return;
    }

    const attempt = {
      command: { commandId, title: defaultBoardTitle },
      controller: new AbortController(),
    };

    pending.current = attempt;
    run(attempt, 'creating');
  }

  function retry() {
    if (pending.current) {
      run(pending.current, 'creating');
    }
  }

  function query() {
    if (pending.current) {
      run(pending.current, 'checking');
    }
  }

  const busy = state.kind === 'creating' || state.kind === 'checking';
  const blocked = busy || state.kind === 'unknown';

  return { state, busy, blocked, create, retry, query };
}
