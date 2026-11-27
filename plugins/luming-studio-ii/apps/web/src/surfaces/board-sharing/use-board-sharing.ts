import { useEffect, useEffectEvent, useRef, useState } from 'react';

import type {
  BoardSharingService,
  BoardSharingState,
  InvitationRole,
  SharingCommand,
  SharingOperation,
  SharingReceipt,
} from '../../data/sharing/index.js';
import { rejectionMessages } from './sharing-labels.js';

interface SharingControls {
  readonly boardId: string;
  readonly open: boolean;
  readonly service: BoardSharingService;
  readonly createCommandId: () => string;
  readonly copyLink: (url: string) => Promise<void>;
}

interface PendingSharingCommand {
  readonly command: SharingCommand;
  readonly copy?: CopyOnApply;
}

interface CopyOnApply {
  readonly role: InvitationRole;
  readonly trigger: HTMLButtonElement;
}

interface ManualLinkCopy {
  readonly url: string;
  readonly trigger: HTMLButtonElement;
}

function formatFailure(error: unknown, message: string) {
  return error instanceof Error && error.message ? message + ' ' + error.message : message;
}

export function useBoardSharing({
  boardId,
  open,
  service,
  createCommandId,
  copyLink,
}: SharingControls) {
  const [snapshot, setSnapshot] = useState<BoardSharingState>();
  const [pending, setPending] = useState<PendingSharingCommand>();
  const [notice, setNotice] = useState<{ text: string; error: boolean }>();
  const [manualLink, setManualLink] = useState<ManualLinkCopy>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const lifetime = useRef<AbortController>(undefined);
  const readNumber = useRef(0);
  const executing = useRef(false);

  async function refresh(signal = lifetime.current?.signal) {
    if (!signal || signal.aborted) {
      return;
    }

    const request = ++readNumber.current;
    setLoading(true);
    try {
      const next = await service.getBoardSharing(boardId, signal);
      if (!signal.aborted && request === readNumber.current) {
        setSnapshot(next);
        return next;
      }
    } catch (error) {
      if (!signal.aborted && request === readNumber.current) {
        setSnapshot(undefined);
        setNotice({ text: formatFailure(error, '读取分享设置失败，请重试。'), error: true });
      }
    } finally {
      if (!signal.aborted && request === readNumber.current) {
        setLoading(false);
      }
    }
  }

  function reportFailure(error: unknown) {
    if (!lifetime.current?.signal.aborted) {
      setNotice({ text: formatFailure(error, '分享操作未能完成。'), error: true });
    }
  }

  function readSharing() {
    refresh().catch(reportFailure);
  }

  const refreshOnOpen = useEffectEvent(readSharing);

  useEffect(() => {
    const current = new AbortController();
    lifetime.current = current;
    return () => current.abort();
  }, [boardId, service]);

  useEffect(() => {
    if (open) {
      refreshOnOpen();
    }
  }, [boardId, open, service]);

  async function copy(url: string, trigger: HTMLButtonElement) {
    const signal = lifetime.current?.signal;
    try {
      await copyLink(url);
      if (!signal?.aborted) {
        setNotice({ text: '已复制链接', error: false });
      }
    } catch (error) {
      if (!signal?.aborted) {
        setNotice({ text: formatFailure(error, '复制链接失败。'), error: true });
        setManualLink({ url, trigger });
      }
    }
  }

  async function applyReceipt(
    receipt: SharingReceipt,
    deferredCopy: CopyOnApply | undefined,
    signal: AbortSignal,
  ) {
    setPending(undefined);

    if (receipt.kind === 'rejected') {
      setNotice({ text: rejectionMessages[receipt.reason], error: true });
      await refresh(signal);
      return false;
    }

    const current = await refresh(signal);
    if (current && deferredCopy) {
      const url = current.links.find(
        ({ role, enabled }) => enabled && role === deferredCopy.role,
      )?.url;

      if (url) {
        await copy(url, deferredCopy.trigger);
      }
    }

    return true;
  }

  async function submit(entry: PendingSharingCommand, retry: boolean) {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || executing.current) {
      return false;
    }

    executing.current = true;
    setBusy(true);
    setNotice(undefined);

    try {
      const receipt = retry
        ? await service.retryBoardSharing(entry.command, signal)
        : await service.updateBoardSharing(entry.command, signal);

      return !signal.aborted && (await applyReceipt(receipt, entry.copy, signal));
    } catch (error) {
      if (signal.aborted) {
        return false;
      }

      setPending(entry);
      setNotice({ text: formatFailure(error, '分享操作结果未知，请重试原操作。'), error: true });
      return false;
    } finally {
      executing.current = false;
      if (!signal.aborted) {
        setBusy(false);
      }
    }
  }

  async function update(operation: SharingOperation, deferredCopy?: CopyOnApply) {
    const unavailable = loading || pending;
    if (snapshot?.role !== 'owner' || unavailable) {
      return false;
    }

    const command = {
      boardId,
      commandId: createCommandId(),
      expectedVersion: snapshot.version,
      operation,
    };

    return submit({ command, copy: deferredCopy }, false);
  }

  async function retry() {
    return pending ? submit(pending, true) : false;
  }

  function requestUpdate(operation: SharingOperation, deferredCopy?: CopyOnApply) {
    update(operation, deferredCopy).catch(reportFailure);
  }

  function copyInvitation(url: string, trigger: HTMLButtonElement) {
    copy(url, trigger).catch(reportFailure);
  }

  return {
    snapshot,
    notice,
    manualLink,
    loading,
    busy,
    pending,
    readSharing,
    update,
    requestUpdate,
    retry,
    dismissManualLink: () => setManualLink(undefined),
    copyInvitation,
    reportFailure,
  };
}
