import { X } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';

import type { BoardSharingService, InvitationRole } from '../../data/sharing/index.js';
import { AnchoredPopover, Button, Dialog, Tabs, type ButtonHandle } from '../../ui/base/index.js';
import { GeneralAccess, SharingInvitations } from './sharing-invitations.js';
import { SharingMembers, type SharingConfirmation } from './sharing-members.js';
import { useBoardSharing } from './use-board-sharing.js';
import './board-sharing.css';

export interface BoardSharingSurfaceProps {
  readonly anchor: Element | null;
  readonly boardId: string;
  readonly title: string;
  readonly service: BoardSharingService;
  readonly createCommandId: () => string;
  readonly copyLink: (url: string) => Promise<void>;
  readonly exportContent?: ReactNode;
  readonly onRequestClose: () => void;
  readonly restoreFocus: () => void;
}

type Sharing = ReturnType<typeof useBoardSharing>;

function ShareBody({
  sharing,
  onConfirm,
}: {
  sharing: Sharing;
  onConfirm: (confirmation: SharingConfirmation) => void;
}) {
  const {
    snapshot,
    loading,
    busy,
    pending,
    notice,
    readSharing,
    requestUpdate,
    copyInvitation,
    retry,
  } = sharing;
  const owner = snapshot?.role === 'owner';
  const actions = {
    locked: loading || busy || Boolean(pending),
    onUpdate: requestUpdate,
    onConfirm,
  };
  const unread = loading ? (
    <p role="status">正在读取分享设置…</p>
  ) : (
    <Button label="重新读取" onActivate={readSharing} />
  );

  function handleCopy(role: InvitationRole, url?: string) {
    if (url) {
      copyInvitation(url);
      return;
    }

    if (snapshot && !snapshot.enabled && owner) {
      requestUpdate({ kind: 'setScope', scope: 'local' }, role);
    }
  }

  return (
    <div className="board-sharing__scroll">
      {notice ? (
        <p className="board-sharing__notice" role={notice.error ? 'alert' : 'status'}>
          {notice.text}
        </p>
      ) : null}
      {pending ? <Button label="重试原操作" disabled={busy} onActivate={retry} /> : null}
      {snapshot ? (
        <>
          {owner ? <SharingMembers members={snapshot.members} actions={actions} /> : null}
          {owner ? (
            <GeneralAccess
              scope={snapshot.scope}
              locked={actions.locked}
              onUpdate={actions.onUpdate}
            />
          ) : null}
          <SharingInvitations
            state={snapshot}
            actions={{ ...actions, onCopy: handleCopy }}
            onCopyMember={copyInvitation}
          />
        </>
      ) : (
        unread
      )}
    </div>
  );
}

function ConfirmSharing({
  current,
  sharing,
  close,
  restoreFocus,
}: {
  current: SharingConfirmation;
  sharing: Sharing;
  close: () => void;
  restoreFocus: () => void;
}) {
  const cancelButton = useRef<ButtonHandle>(null);

  async function handleConfirm() {
    await sharing.update(current.operation);
    close();
  }

  function restoreTrigger() {
    if (current.trigger.isConnected) {
      current.trigger.focus();
    } else {
      restoreFocus();
    }
  }

  return (
    <Dialog
      open
      title={current.title}
      description={current.description}
      closeLabel="关闭"
      initialFocus={() => cancelButton.current?.focus()}
      restoreFocus={restoreTrigger}
      dismissPolicy={{ backdrop: false, escape: !sharing.busy }}
      onRequestClose={() => {
        if (!sharing.busy) {
          close();
        }
      }}
    >
      <div className="board-sharing__confirmation">
        <Button ref={cancelButton} label="取消" disabled={sharing.busy} onActivate={close} />
        <Button
          label={current.label}
          disabled={sharing.busy || Boolean(sharing.pending)}
          onActivate={() => {
            handleConfirm().catch(sharing.reportFailure);
          }}
        />
      </div>
    </Dialog>
  );
}

export function BoardSharingSurface({
  anchor,
  boardId,
  title,
  service,
  createCommandId,
  copyLink,
  exportContent,
  onRequestClose,
  restoreFocus,
}: BoardSharingSurfaceProps) {
  const [tab, setTab] = useState('share');
  const [confirmation, setConfirmation] = useState<SharingConfirmation>();
  const closeButton = useRef<ButtonHandle>(null);
  const open = Boolean(anchor);
  const sharing = useBoardSharing({ boardId, open, service, createCommandId, copyLink });
  const shareBody = <ShareBody sharing={sharing} onConfirm={setConfirmation} />;

  function close(restore = true) {
    if (confirmation) {
      return;
    }

    setTab('share');
    onRequestClose();
    if (restore) {
      restoreFocus();
    }
  }

  return (
    <AnchoredPopover
      open={open}
      anchor={anchor}
      label="分享"
      placement="bottom"
      align="end"
      initialFocus={() => closeButton.current?.focus()}
      onRequestClose={(reason) => close(reason !== 'outside-press')}
    >
      <section className="board-sharing">
        <header className="board-sharing__header">
          <h2>{title || '分享白板'}</h2>
          <Button
            ref={closeButton}
            label="关闭分享"
            iconOnly
            variant="ghost"
            icon={<X size={18} />}
            onActivate={() => close()}
          />
        </header>
        {exportContent ? (
          <Tabs
            label="分享与导出"
            value={tab}
            items={[
              { id: 'share', label: '分享', panel: shareBody },
              { id: 'export', label: '导出', panel: tab === 'export' ? exportContent : null },
            ]}
            onValueChange={setTab}
          />
        ) : (
          shareBody
        )}
        {confirmation ? (
          <ConfirmSharing
            current={confirmation}
            sharing={sharing}
            close={() => setConfirmation(undefined)}
            restoreFocus={() => closeButton.current?.focus()}
          />
        ) : null}
      </section>
    </AnchoredPopover>
  );
}
