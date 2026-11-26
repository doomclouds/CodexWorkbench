import { useEffect, useRef, useState } from 'react';
import type { CatalogManagementService } from '../../data/catalog/index.js';
import {
  collectPurgeScope,
  describePurgeRejection,
  describeRecycleError,
  purgeRecycleTargets,
  recoverRecycleReceipt,
  type PurgeFailure,
  type PurgeScope,
  type RecycleTarget,
} from './recycle-bin-commands.js';

type RecycleActivity = 'restoring' | 'preparing' | 'purging';

interface RecycleNotice {
  readonly kind: 'error' | 'success';
  readonly message: string;
}

interface RecycleActionsOptions {
  readonly management: CatalogManagementService;
  readonly createCommandId: () => string;
  readonly refresh: (removedIds?: readonly string[]) => void;
}

export function useRecycleBinActions({
  management,
  createCommandId,
  refresh,
}: RecycleActionsOptions) {
  const [selected, setSelected] = useState<ReadonlyMap<string, RecycleTarget>>(() => new Map());
  const [confirmation, setConfirmation] = useState<PurgeScope>();
  const [failures, setFailures] = useState<readonly PurgeFailure[]>([]);
  const [notice, setNotice] = useState<RecycleNotice>();
  const [activity, setActivity] = useState<RecycleActivity>();
  const pending = useRef<AbortController>(undefined);

  useEffect(
    () => () => {
      pending.current?.abort();
      pending.current = undefined;
    },
    [management],
  );

  function run(nextActivity: RecycleActivity, execute: (signal: AbortSignal) => Promise<void>) {
    if (pending.current) {
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;
    pending.current = controller;
    setActivity(nextActivity);
    setNotice(undefined);

    execute(signal)
      .catch((cause: unknown) => {
        if (!signal.aborted) {
          setNotice({ kind: 'error', message: describeRecycleError(cause) });
        }
      })
      .finally(() => {
        if (pending.current === controller) {
          pending.current = undefined;
          setActivity(undefined);
        }
      });
  }

  function toggleSelection(targets: readonly RecycleTarget[], checked: boolean) {
    setSelected((previous) => {
      const next = new Map(previous);
      for (const target of targets) {
        if (checked) {
          next.set(target.boardId, target);
        } else {
          next.delete(target.boardId);
        }
      }

      return next;
    });
  }

  function clearSelection() {
    setSelected(new Map());
  }

  function resetQueryState() {
    clearSelection();
    setFailures([]);
    setNotice(undefined);
  }

  function confirmSelected(targets: readonly RecycleTarget[]) {
    if (pending.current || !targets.length) {
      return;
    }

    setNotice(undefined);
    setConfirmation({ all: false, targets });
  }

  function prepareEmpty() {
    run('preparing', async (signal) => {
      const targets = await collectPurgeScope(management, signal);
      signal.throwIfAborted();

      if (targets.length) {
        setConfirmation({ all: true, targets });
      } else {
        setNotice({ kind: 'success', message: '回收站已经为空。' });
      }
    });
  }

  function deleteConfirmed() {
    if (!confirmation) {
      return;
    }

    const { targets } = confirmation;
    run('purging', async (signal) => {
      const { deleted, failures: nextFailures } = await purgeRecycleTargets(
        management,
        targets,
        createCommandId,
        signal,
      );
      signal.throwIfAborted();

      toggleSelection(targets, false);
      toggleSelection(
        nextFailures.map(({ target }) => target),
        true,
      );
      setFailures(nextFailures);
      setConfirmation(undefined);
      if (deleted.length) {
        setNotice({ kind: 'success', message: '已永久删除 ' + deleted.length + ' 项作品。' });
      }

      refresh(deleted);
    });
  }

  function cancelConfirmation() {
    if (!pending.current) {
      setConfirmation(undefined);
    }
  }

  function restore(target: RecycleTarget) {
    run('restoring', async (signal) => {
      const commandId = createCommandId();
      const { boardId, expectedEntryVersion } = target;
      const receipt = await recoverRecycleReceipt(management, commandId, signal, () =>
        management.manageBoard(
          { commandId, boardId, expectedEntryVersion, operation: { kind: 'restore' } },
          signal,
        ),
      );
      signal.throwIfAborted();

      if (receipt.kind === 'rejected') {
        throw new Error(describePurgeRejection(receipt.reason));
      }
      if (receipt.kind !== 'changed' || receipt.board.boardId !== boardId) {
        throw new Error('恢复结果待确认，请先刷新回收站核对。');
      }

      toggleSelection([target], false);
      setFailures((previous) => previous.filter((failure) => failure.target.boardId !== boardId));
      setNotice({ kind: 'success', message: '作品已恢复。' });
      refresh([boardId]);
    });
  }

  return {
    selected,
    failures,
    notice,
    confirmation,
    activity,
    toggleSelection,
    clearSelection,
    resetQueryState,
    confirmSelected,
    prepareEmpty,
    deleteConfirmed,
    cancelConfirmation,
    restore,
    dismissNotice: () => setNotice(undefined),
  };
}
