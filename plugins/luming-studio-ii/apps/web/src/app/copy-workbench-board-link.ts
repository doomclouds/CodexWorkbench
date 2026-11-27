import type {
  BoardSharingService,
  BoardSharingState,
  SharingCommand,
} from '../data/sharing/index.js';

function findViewerLink(state: BoardSharingState) {
  return state.enabled
    ? state.links.find(({ role, enabled }) => role === 'viewer' && enabled)?.url
    : undefined;
}

export function createWorkbenchBoardLinkCopy(
  service: BoardSharingService,
  copyShareLink: (url: string) => Promise<void>,
  createCommandId: () => string,
) {
  const pending = new Map<string, SharingCommand>();

  async function startLocalSharing(boardId: string, version: bigint, signal: AbortSignal) {
    const previous = pending.get(boardId);
    const command: SharingCommand = previous ?? {
      boardId,
      commandId: createCommandId(),
      expectedVersion: version,
      operation: { kind: 'setScope', scope: 'local' },
    };
    pending.set(boardId, command);
    const receipt = previous
      ? await service.retryBoardSharing(command, signal)
      : await service.updateBoardSharing(command, signal);

    pending.delete(boardId);
    if (receipt.kind === 'rejected' && receipt.reason !== 'versionChanged') {
      throw new Error('无法开启本机分享，请在白板的分享面板中检查。');
    }

    return service.getBoardSharing(boardId, signal);
  }

  return async (boardId: string, signal: AbortSignal) => {
    const sharing = await service.getBoardSharing(boardId, signal);
    signal.throwIfAborted();
    if (sharing.role !== 'owner') {
      throw new Error('你没有管理此白板分享的权限。');
    }

    const current = sharing.enabled
      ? sharing
      : await startLocalSharing(boardId, sharing.version, signal);
    signal.throwIfAborted();
    const url = findViewerLink(current);
    if (!url) {
      return 'sharingRequired' as const;
    }

    await copyShareLink(url);
    pending.delete(boardId);
    return 'copied' as const;
  };
}
