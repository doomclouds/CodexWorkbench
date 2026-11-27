import { useEffect, useRef, useState, type ComponentProps } from 'react';
import type {
  BoardCatalogService,
  CatalogCreateRequest,
  CatalogDuplicateRequest,
  CatalogReceipt,
  CatalogRejectionReason,
} from '../../../data/catalog/index.js';
import type { studioPages } from '../../routes.js';

type WorkbenchPageProps = ComponentProps<(typeof studioPages)['workbench']>;
type CreationState = WorkbenchPageProps['creation']['state'];
type CreationAction = Exclude<CreationState, { kind: 'idle' }>['action'];

type CreationIntent =
  | { readonly action: 'create' }
  | { readonly action: 'duplicate'; readonly sourceBoardId: string };

type CreationCommand =
  | { readonly action: 'create'; readonly request: CatalogCreateRequest }
  | { readonly action: 'duplicate'; readonly request: CatalogDuplicateRequest };

interface CreationAttempt {
  readonly command: CreationCommand;
  readonly controller: AbortController;
  readonly routeGeneration: number;
}

type AttemptResult = { readonly receipt: CatalogReceipt } | { readonly detail: string };

interface BoardCreationOptions {
  readonly service: BoardCatalogService;
  readonly createCommandId: () => string;
  readonly onOpenBoard: (boardId: string) => void;
  readonly readRouteGeneration: () => number;
  readonly onLateConfirmation: (action: CreationAction) => void;
}

const defaultBoardTitle = '未命名白板';
const missingReceipt = {
  create: '服务端暂无这条创建命令的回执。',
  duplicate: '服务端暂无这条复制命令的回执。',
};
const actionLabel = { create: '创建', duplicate: '复制' };
const rejectionMessages: Record<
  Exclude<CatalogRejectionReason, 'commandIdReuse' | 'unknown'>,
  string
> = {
  invalidTitle: '白板名称无效。',
  forbidden: '当前权限无法执行这项操作。',
  entryVersionChanged: '来源作品已更新，请刷新后再试。',
  stateChanged: '来源作品目前无法复制。',
  invalidCommand: '作品操作无效。',
};

function rejectionDetail(action: CreationAction, reason: CatalogRejectionReason) {
  const label = actionLabel[action];
  if (reason === 'commandIdReuse') {
    return label + '命令 ID 已被另一条命令使用。';
  }
  if (reason === 'unknown') {
    return '服务端拒绝了这次' + label + '。';
  }

  return rejectionMessages[reason];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function lookup(
  service: BoardCatalogService,
  attempt: CreationAttempt,
  sendError?: string,
): Promise<AttemptResult> {
  const { action, request } = attempt.command;
  try {
    const receipt = await service.getReceipt(request.commandId, attempt.controller.signal);
    if (receipt) {
      return { receipt };
    }

    const detail = missingReceipt[action];

    return { detail: sendError ? sendError + ' ' + detail : detail };
  } catch (error) {
    const detail = '查询回执失败。' + errorMessage(error);

    return { detail: sendError ? sendError + ' ' + detail : detail };
  }
}

function send(service: BoardCatalogService, { command, controller }: CreationAttempt) {
  const { action, request } = command;
  const { signal } = controller;
  if (action === 'create') {
    return service.createBoard(request, signal);
  }
  if (service.duplicateBoard) {
    return service.duplicateBoard(request, signal);
  }

  throw new Error('当前无法复制作品。');
}

async function submit(
  service: BoardCatalogService,
  attempt: CreationAttempt,
): Promise<AttemptResult> {
  try {
    return { receipt: await send(service, attempt) };
  } catch (error) {
    const detail = errorMessage(error);
    if (attempt.controller.signal.aborted) {
      return { detail };
    }

    return lookup(service, attempt, detail);
  }
}

function pendingCommand(intent: CreationIntent, commandId: string): CreationCommand {
  return intent.action === 'create'
    ? { action: 'create', request: { commandId, title: defaultBoardTitle } }
    : { action: 'duplicate', request: { commandId, sourceBoardId: intent.sourceBoardId } };
}

function checkReceipt(receipt: CatalogReceipt, command: CreationCommand) {
  if (receipt.commandId !== command.request.commandId) {
    return actionLabel[command.action] + '回执与当前命令不匹配。';
  }

  if (command.action === 'duplicate' && receipt.kind === 'created') {
    if (receipt.board.boardId === command.request.sourceBoardId) {
      return '复制回执未返回新的作品。';
    }
  }
}

export function useBoardCreation({
  service,
  createCommandId,
  onOpenBoard,
  readRouteGeneration,
  onLateConfirmation,
}: BoardCreationOptions) {
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

    const { action } = attempt.command;
    running.current = false;
    if ('detail' in result) {
      setState({ kind: 'unknown', action, detail: result.detail });
      return;
    }

    const mismatch = checkReceipt(result.receipt, attempt.command);
    if (mismatch) {
      setState({ kind: 'unknown', action, detail: mismatch });
      return;
    }

    pending.current = undefined;
    if (result.receipt.kind === 'rejected') {
      setState({
        kind: 'rejected',
        action,
        detail: rejectionDetail(action, result.receipt.reason),
      });

      return;
    }

    setState({ kind: 'idle' });
    if (attempt.routeGeneration === readRouteGeneration()) {
      onOpenBoard(result.receipt.board.boardId);
    } else {
      onLateConfirmation(action);
    }
  }

  function run(attempt: CreationAttempt, kind: 'creating' | 'checking') {
    if (running.current) {
      return;
    }

    running.current = true;
    setState({ kind, action: attempt.command.action });
    const request = kind === 'creating' ? submit(service, attempt) : lookup(service, attempt);
    request
      .then((result) => complete(attempt, result))
      .catch((error: unknown) => complete(attempt, { detail: errorMessage(error) }));
  }

  function begin(intent: CreationIntent) {
    if (pending.current) {
      return;
    }

    let commandId: string;
    try {
      commandId = createCommandId();
    } catch (error) {
      setState({ kind: 'rejected', action: intent.action, detail: errorMessage(error) });
      return;
    }

    const attempt = {
      command: pendingCommand(intent, commandId),
      controller: new AbortController(),
      routeGeneration: readRouteGeneration(),
    };
    pending.current = attempt;
    run(attempt, 'creating');
  }

  function create() {
    begin({ action: 'create' });
  }

  function duplicate(sourceBoardId: string) {
    if (service.duplicateBoard) {
      begin({ action: 'duplicate', sourceBoardId });
    }
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
  const createBusy = busy && state.action === 'create';

  return { state, createBusy, blocked, create, duplicate, retry, query };
}
