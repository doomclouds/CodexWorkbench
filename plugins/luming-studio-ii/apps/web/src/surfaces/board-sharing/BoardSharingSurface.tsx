import { Moon, Sun, X } from 'lucide-react';
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
  readonly theme?: {
    readonly resolvedTheme: 'light' | 'dark';
    readonly onThemeChange: (theme: 'light' | 'dark') => void;
  };
  readonly onLanSharingChange?: (active: boolean) => void;
  readonly onRequestClose: () => void;
  readonly restoreFocus: () => void;
}

type Sharing = ReturnType<typeof useBoardSharing>;

function ShareBody({
  sharing,
  confirming,
  onConfirm,
}: {
  sharing: Sharing;
  confirming: boolean;
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

  function handleCopy(role: InvitationRole, trigger: HTMLButtonElement, url?: string) {
    if (url) {
      copyInvitation(url, trigger);
      return;
    }

    if (snapshot && !snapshot.enabled && owner) {
      requestUpdate({ kind: 'setScope', scope: 'local' }, { role, trigger });
    }
  }

  return (
    <div className="board-sharing__scroll">
      {notice && !confirming ? (
        <p className="board-sharing__notice" role={notice.error ? 'alert' : 'status'}>
          {notice.text}
        </p>
      ) : null}
      {pending && !confirming ? (
        <Button
          label="重试原操作"
          disabled={busy}
          onActivate={() => {
            retry().catch(sharing.reportFailure);
          }}
        />
      ) : null}
      {snapshot ? (
        <>
          {owner ? <SharingMembers state={snapshot} actions={actions} /> : null}
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
    const success = sharing.pending
      ? await sharing.retry()
      : await sharing.update(current.operation);

    if (success) {
      close();
    }
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
      {sharing.notice?.error && (
        <p className="board-sharing__notice" role="alert">
          {sharing.notice.text}
        </p>
      )}
      <div className="board-sharing__confirmation">
        <Button ref={cancelButton} label="取消" disabled={sharing.busy} onActivate={close} />
        <Button
          label={sharing.pending ? '重试原操作' : current.label}
          variant="primary"
          tone={
            current.operation.kind === 'forgetMember' || current.operation.kind === 'removeMember'
              ? 'danger'
              : undefined
          }
          disabled={sharing.busy}
          onActivate={() => {
            handleConfirm().catch(sharing.reportFailure);
          }}
        />
      </div>
    </Dialog>
  );
}

function ManualLink({
  url,
  close,
  restoreFocus,
}: {
  url: string;
  close: () => void;
  restoreFocus: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  function focusLink() {
    input.current?.focus();
    input.current?.select();
  }

  return (
    <Dialog
      open
      title="复制链接"
      description="浏览器未能自动复制，请复制下面的邀请链接。"
      closeLabel="关闭"
      initialFocus={focusLink}
      restoreFocus={restoreFocus}
      onRequestClose={close}
    >
      <input
        className="board-sharing__manual-link"
        ref={input}
        aria-label="邀请链接"
        value={url}
        readOnly
      />
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
  theme,
  onLanSharingChange,
  onRequestClose,
  restoreFocus,
}: BoardSharingSurfaceProps) {
  const [tab, setTab] = useState('share');
  const [confirmation, setConfirmation] = useState<SharingConfirmation>();
  const closeButton = useRef<ButtonHandle>(null);
  const open = Boolean(anchor);
  const sharing = useBoardSharing({
    boardId,
    open,
    service,
    createCommandId,
    copyLink,
    onLanSharingChange,
  });
  const showExport = sharing.snapshot?.role === 'owner' && exportContent;
  const dark = theme?.resolvedTheme === 'dark';
  const shareBody = (
    <ShareBody
      sharing={sharing}
      confirming={confirmation !== undefined}
      onConfirm={setConfirmation}
    />
  );

  function close(restore = true) {
    if (confirmation || sharing.manualLink) {
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
        {showExport ? (
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
        {theme && (
          <footer className="board-sharing__footer">
            <Button
              label={dark ? '切换为明亮主题' : '切换为暗色主题'}
              icon={dark ? <Sun size={17} /> : <Moon size={17} />}
              variant="ghost"
              onActivate={() => theme.onThemeChange(dark ? 'light' : 'dark')}
            />
          </footer>
        )}
        {confirmation ? (
          <ConfirmSharing
            current={confirmation}
            sharing={sharing}
            close={() => setConfirmation(undefined)}
            restoreFocus={() => closeButton.current?.focus()}
          />
        ) : null}
        {sharing.manualLink && (
          <ManualLink
            url={sharing.manualLink.url}
            close={sharing.dismissManualLink}
            restoreFocus={() => {
              const trigger = sharing.manualLink?.trigger;
              if (trigger?.isConnected) {
                trigger.focus();
              } else {
                closeButton.current?.focus();
              }
            }}
          />
        )}
      </section>
    </AnchoredPopover>
  );
}
