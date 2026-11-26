import { useEffect, useRef, useState } from 'react';
import type {
  BoardEditReceipt,
  BoardEditRejection,
  BoardHistoryService,
  ExportBoardScope,
  RestoreBoardVersionCommand,
} from '../../data/whiteboard/index.js';
import type { WhiteboardHistorySurfaceProps } from './contracts.js';

type RestoreAction = 'confirm' | 'check' | 'retry';

interface RestoreAttempt {
  readonly controller: AbortController;
  readonly command: RestoreBoardVersionCommand;
  readonly action: RestoreAction;
}

interface RestoreNotice {
  readonly tone: 'error' | 'success';
  readonly message: string;
}

type RestoreOptions = Pick<
  WhiteboardHistorySurfaceProps,
  'boardId' | 'revision' | 'canEdit' | 'service' | 'createCommandId' | 'onRestored'
>;

const restoreMessages: Readonly<Record<BoardEditRejection, string>> = {
  forbidden: '当前账号没有恢复白板的权限。',
  invalidEdit: '选定的范围暂时无法恢复。',
  objectNotFound: '所选对象已无法恢复。',
  geometryLocked: '恢复涉及已锁定的对象。请返回当前白板检查锁定状态。',
  commandIdReuse: '恢复命令已用于不同的请求。请重新选择恢复范围。',
  unsupportedKind: '所选对象暂不支持恢复。',
  versionUnavailable: '所选历史版本已无法恢复。',
  tooLarge: '恢复范围超过大小限制。',
  invalidImage: '恢复所需图片已不可用。',
  unknown: '恢复未能完成。',
};

function restoreError(receipt: Exclude<BoardEditReceipt, { kind: 'applied' }>): string {
  return receipt.kind === 'conflict'
    ? '当前白板已更新。请返回当前白板刷新后再恢复。'
    : restoreMessages[receipt.reason];
}

async function checkReceipt(
  service: BoardHistoryService,
  { boardId, commandId }: RestoreBoardVersionCommand,
  signal: AbortSignal,
): Promise<BoardEditReceipt | undefined> {
  const receipt = await service.getRestoreReceipt(boardId, commandId, signal);
  signal.throwIfAborted();
  if (receipt?.kind === 'rejected' && receipt.reason === 'forbidden') {
    throw new Error('当前账号无法核对该恢复回执。');
  }

  return receipt;
}

async function requestRestore(
  service: BoardHistoryService,
  { action, command, controller: { signal } }: RestoreAttempt,
): Promise<BoardEditReceipt | undefined> {
  if (action === 'check') {
    return checkReceipt(service, command, signal);
  }

  if (action === 'retry') {
    const receipt = await checkReceipt(service, command, signal);
    if (receipt) {
      return receipt;
    }
  }

  try {
    signal.throwIfAborted();
    return await service.restoreVersion(command, signal);
  } catch (error) {
    signal.throwIfAborted();
    const receipt = await checkReceipt(service, command, signal);
    if (receipt) {
      return receipt;
    }

    throw error;
  }
}

const uncertainMessage = '恢复结果待确认。可以核对或重试原命令。';

export function useVersionRestore({
  boardId,
  revision,
  canEdit,
  service,
  createCommandId,
  onRestored,
}: RestoreOptions) {
  const [confirmation, setConfirmation] = useState<RestoreBoardVersionCommand>();
  const [recovery, setRecovery] = useState<RestoreBoardVersionCommand>();
  const [pending, setPending] = useState<RestoreAction>();
  const [notice, setNotice] = useState<RestoreNotice>();
  const active = useRef<RestoreAttempt>(undefined);

  useEffect(() => () => active.current?.controller.abort(), []);

  function settle(attempt: RestoreAttempt) {
    if (active.current !== attempt) {
      return false;
    }

    active.current = undefined;
    setPending(undefined);

    return true;
  }

  function handleReceipt(attempt: RestoreAttempt, receipt: BoardEditReceipt | undefined) {
    if (attempt.controller.signal.aborted || !settle(attempt)) {
      return;
    }

    if (!receipt) {
      setNotice({ tone: 'error', message: '尚未查到原恢复回执。' });
      return;
    }

    setConfirmation(undefined);
    setRecovery(undefined);
    if (receipt.kind === 'applied') {
      setNotice({
        tone: 'success',
        message: '已确认恢复到版本 ' + attempt.command.revision + '。',
      });
      onRestored(receipt);
    } else {
      setNotice({ tone: 'error', message: restoreError(receipt) });
    }
  }

  function handleAttemptFailure(attempt: RestoreAttempt, error: unknown) {
    if (attempt.controller.signal.aborted) {
      return;
    }

    const detail = error instanceof Error ? ' ' + error.message : '';
    const message = settle(attempt)
      ? uncertainMessage + detail
      : '恢复已确认，界面未能更新。' + detail;
    setNotice({ tone: 'error', message });
  }

  function start(command: RestoreBoardVersionCommand, action: RestoreAction) {
    if (active.current) {
      return;
    }

    const attempt = { controller: new AbortController(), command, action };
    active.current = attempt;
    setRecovery(command);
    setPending(action);
    setNotice(undefined);

    requestRestore(service, attempt)
      .then((receipt) => handleReceipt(attempt, receipt))
      .catch((error: unknown) => handleAttemptFailure(attempt, error));
  }

  function handleRequestRestore(sourceRevision: bigint, scope: ExportBoardScope) {
    const unavailable = active.current || confirmation || recovery;
    if (!canEdit || unavailable) {
      return;
    }

    setNotice(undefined);
    try {
      const commandId = createCommandId();
      setConfirmation({
        boardId,
        commandId,
        revision: sourceRevision,
        expectedCurrentRevision: revision,
        scope,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法创建恢复命令。';
      setNotice({ tone: 'error', message });
    }
  }

  function handleCancelRestore() {
    setConfirmation(undefined);
    const attempt = active.current;
    if (attempt && settle(attempt)) {
      attempt.controller.abort();
      setNotice({ tone: 'error', message: uncertainMessage });
    }
  }

  function handleConfirmRestore() {
    if (confirmation && canEdit) {
      start(confirmation, recovery ? 'retry' : 'confirm');
    }
  }

  function handleCheckReceipt() {
    if (recovery) {
      start(recovery, 'check');
    }
  }

  function handleRetryRestore() {
    if (recovery && canEdit) {
      start(recovery, 'retry');
    }
  }

  return {
    confirmation,
    recovery,
    pending,
    notice,
    handleRequestRestore,
    handleCancelRestore,
    handleConfirmRestore,
    handleCheckReceipt,
    handleRetryRestore,
  };
}

export type VersionRestore = ReturnType<typeof useVersionRestore>;
