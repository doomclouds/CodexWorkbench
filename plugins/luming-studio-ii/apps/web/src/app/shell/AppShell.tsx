import { useEffect, useState, type ReactNode } from 'react';
import type { BoardSharingService, BoardSharingState } from '../../data/sharing/index.js';
import {
  GuestAccessLostSurface,
  GuestJoinSurface,
  GuestSessionPendingSurface,
} from '../../surfaces/guest-join/index.js';

import { OperationNoticeSlot, type ShellOperationNotice } from './operation-notice/index.js';

type GuestBoardAccess = Pick<BoardSharingState, 'role' | 'canEdit' | 'canComment'>;

type StudioGuestEntry =
  | { readonly kind: 'invitation'; readonly boardId: string; readonly invitationToken: string }
  | { readonly kind: 'board'; readonly boardId: string }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'restricted' };

type GuestShellService = Pick<
  BoardSharingService,
  'getBoardSharing' | 'inspectBoardInvitation' | 'joinBoardInvitation'
>;

interface GuestShellProps {
  readonly entry: StudioGuestEntry;
  readonly service: GuestShellService;
  readonly isAccessDenied: (error: unknown) => boolean;
  readonly subscribeRefresh: (read: () => void) => () => void;
  readonly onJoin: (boardId: string) => void;
  readonly onExit: () => void;
  readonly renderBoard: (
    boardId: string,
    access: GuestBoardAccess,
    recheckAccess: () => void,
  ) => ReactNode;
}

interface AppShellProps {
  readonly resolvedTheme?: 'light' | 'dark';
  readonly notice?: ShellOperationNotice;
  readonly onDismissNotice: () => void;
  readonly guest?: GuestShellProps;
  readonly children?: ReactNode;
}

type GuestAccessState =
  | { readonly kind: 'checking' | 'lost' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'ready'; readonly access: GuestBoardAccess };

type GuestBoardProps = Pick<
  GuestShellProps,
  'service' | 'isAccessDenied' | 'subscribeRefresh' | 'onExit' | 'renderBoard'
> & { readonly boardId: string };

function GuestBoard({
  boardId,
  service,
  isAccessDenied,
  subscribeRefresh,
  onExit,
  renderBoard,
}: GuestBoardProps) {
  const [access, setAccess] = useState<GuestAccessState>({ kind: 'checking' });
  const [accessCheck, setAccessCheck] = useState(0);
  const [displayedBoard, setDisplayedBoard] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let reading = false;
    let lost = false;

    function rejectAccess() {
      lost = true;
      setAccess({ kind: 'lost' });
    }

    function acceptAccess(next: BoardSharingState) {
      if (signal.aborted) {
        return;
      }

      if (!next.enabled || next.role === 'owner' || next.boardId !== boardId) {
        rejectAccess();
        return;
      }

      setDisplayedBoard(true);
      setAccess({ kind: 'ready', access: next });
    }

    function onAccessFailure(error: unknown) {
      if (signal.aborted) {
        return;
      }

      if (isAccessDenied(error)) {
        rejectAccess();
        return;
      }

      const message = error instanceof Error ? error.message : '无法验证白板访问权限。';
      setAccess((current) => (current.kind === 'ready' ? current : { kind: 'failed', message }));
    }

    function checkAccess() {
      if (reading || lost || signal.aborted) {
        return;
      }

      reading = true;
      service
        .getBoardSharing(boardId, signal)
        .then(acceptAccess)
        .finally(() => {
          reading = false;
        })
        .catch(onAccessFailure);
    }

    checkAccess();
    const unsubscribe = subscribeRefresh(checkAccess);

    return () => {
      controller.abort();
      unsubscribe();
    };
  }, [boardId, service, isAccessDenied, subscribeRefresh, accessCheck]);

  function handleRecheckFromRoom() {
    setAccess({ kind: 'checking' });
    setAccessCheck((current) => current + 1);
  }

  if (access.kind === 'ready') {
    return renderBoard(boardId, access.access, handleRecheckFromRoom);
  }
  if (access.kind === 'lost') {
    return <GuestAccessLostSurface activeSession={displayedBoard} onExit={onExit} />;
  }

  return (
    <GuestSessionPendingSurface
      activeSession={displayedBoard}
      message={access.kind === 'failed' ? access.message : undefined}
      onRetry={handleRecheckFromRoom}
    />
  );
}

function GuestShell({ entry, onJoin, onExit, ...board }: GuestShellProps) {
  switch (entry.kind) {
    case 'invitation':
      return (
        <GuestJoinSurface
          boardId={entry.boardId}
          invitationToken={entry.invitationToken}
          service={board.service}
          onJoined={(session) => onJoin(session.boardId)}
          onCancel={onExit}
        />
      );
    case 'board':
      return <GuestBoard key={entry.boardId} boardId={entry.boardId} {...board} onExit={onExit} />;
    case 'invalid':
      return <GuestAccessLostSurface message="这个邀请链接已失效。" onExit={onExit} />;
    case 'restricted':
      return <GuestAccessLostSurface message="当前没有打开的白板。" />;
  }
}

export function AppShell({
  resolvedTheme,
  notice,
  onDismissNotice,
  guest,
  children,
}: AppShellProps) {
  return (
    <div className="studio-whiteboard-app" data-theme={resolvedTheme}>
      {!guest && notice && <OperationNoticeSlot notice={notice} onDismiss={onDismissNotice} />}
      <div className="studio-app-page">{guest ? <GuestShell {...guest} /> : children}</div>
    </div>
  );
}
