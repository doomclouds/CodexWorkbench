import {
  Check,
  ChevronDown,
  Copy,
  Eye,
  Globe,
  LockKeyhole,
  MessageSquare,
  MoreHorizontal,
  Pencil,
} from 'lucide-react';

import type {
  BoardSharingState,
  InvitationRole,
  SharingLink,
  SharingOperation,
  SharingScope,
} from '../../data/sharing/index.js';
import { invitationRoles, roleDescriptions, roleLabels, scopeLabels } from './sharing-labels.js';
import { SharingMenu } from './sharing-menu.js';
import type { SharingConfirmation } from './sharing-members.js';

interface InvitationActions {
  readonly locked: boolean;
  readonly onUpdate: (operation: SharingOperation) => void;
  readonly onConfirm: (confirmation: SharingConfirmation) => void;
  readonly onCopy: (role: InvitationRole, trigger: HTMLButtonElement, url?: string) => void;
}

const roleIcons = { editor: Pencil, commenter: MessageSquare, viewer: Eye };
const scopes: readonly SharingScope[] = ['local', 'lan'];

export function GeneralAccess({
  scope,
  locked,
  onUpdate,
}: {
  scope: SharingScope;
  locked: boolean;
  onUpdate: InvitationActions['onUpdate'];
}) {
  const Icon = scope === 'local' ? LockKeyhole : Globe;
  return (
    <section className="board-sharing__section">
      <h3>一般访问权限</h3>
      <div className="board-sharing__row">
        <span className="board-sharing__role-icon" aria-hidden="true">
          <Icon size={18} />
        </span>
        <span className="board-sharing__row-copy">
          <SharingMenu
            label="一般访问权限"
            className="board-sharing__button board-sharing__button--scope"
            items={scopes.map((choice) => ({
              id: choice,
              label: scopeLabels[choice],
              shortcut: choice === scope ? '✓' : undefined,
              run: () => {
                if (choice !== scope) {
                  onUpdate({ kind: 'setScope', scope: choice });
                }
              },
            }))}
            disabled={locked}
          >
            {scopeLabels[scope]} <ChevronDown size={14} />
          </SharingMenu>
          <small>
            {scope === 'local'
              ? '只有这台电脑能够打开；邀请链接仍可复制。'
              : '同一局域网中的人可使用邀请链接访问。'}
          </small>
        </span>
      </div>
    </section>
  );
}

function InvitationMenu({ link, actions }: { link: SharingLink; actions: InvitationActions }) {
  const { role, enabled } = link;
  const toggleLabel = enabled ? '停用此链接' : '启用此链接';
  return (
    <SharingMenu
      label={roleLabels[role] + '链接更多操作'}
      className="board-sharing__button board-sharing__button--icon"
      disabled={actions.locked}
      items={[
        {
          id: 'toggle',
          label: toggleLabel,
          run: () => actions.onUpdate({ kind: 'setInvitation', role, enabled: !enabled }),
        },
        {
          id: 'reset',
          label: '重置此链接',
          run: (trigger) =>
            actions.onConfirm({
              title: '重置邀请链接？',
              description: '原链接将失效，通过该链接加入的成员需要使用新链接重新加入。',
              label: '确认重置',
              operation: { kind: 'resetInvitation', role },
              trigger,
            }),
        },
      ]}
    >
      <MoreHorizontal size={18} aria-hidden="true" />
    </SharingMenu>
  );
}

function InvitationRow({
  link,
  state,
  actions,
  copied,
}: {
  link: SharingLink;
  state: BoardSharingState;
  actions: InvitationActions;
  copied: boolean;
}) {
  const { role, enabled, url } = link;
  const owned = state.role === 'owner';
  const canCopy = enabled || !state.enabled;
  const label = canCopy ? '复制' + roleLabels[role] + '链接' : '启用' + roleLabels[role] + '链接';
  const Icon = roleIcons[role];

  function handleInvitationClick(trigger: HTMLButtonElement) {
    if (canCopy) {
      actions.onCopy(role, trigger, url);
    } else {
      actions.onUpdate({ kind: 'setInvitation', role, enabled: true });
    }
  }

  return (
    <div className="board-sharing__row">
      <span className="board-sharing__role-icon" aria-hidden="true">
        <Icon size={17} />
      </span>
      <span className="board-sharing__row-copy">
        <strong>{roleLabels[role]}</strong>
        <small>{canCopy ? roleDescriptions[role] : '链接已停用'}</small>
      </span>
      <button
        type="button"
        className="board-sharing__button board-sharing__button--copy"
        aria-label={label}
        disabled={actions.locked || (state.enabled && enabled && !url)}
        onClick={(event) => handleInvitationClick(event.currentTarget)}
      >
        {canCopy ? <CopyLinkLabel label="复制链接" copied={copied} /> : '启用链接'}
      </button>
      {owned && state.enabled ? <InvitationMenu link={link} actions={actions} /> : null}
    </div>
  );
}

function CopyLinkLabel({ label, copied }: { label: string; copied: boolean }) {
  const Icon = copied ? Check : Copy;
  return (
    <>
      <Icon size={14} aria-hidden="true" />
      <span className="board-sharing__copy-label">
        <span aria-hidden={copied || undefined}>{label}</span>
        {copied && <span>已复制</span>}
      </span>
    </>
  );
}

export function SharingInvitations({
  state,
  actions,
  copiedUrl,
  onCopyMember,
}: {
  state: BoardSharingState;
  actions: InvitationActions;
  copiedUrl?: string;
  onCopyMember: (url: string, trigger: HTMLButtonElement) => void;
}) {
  const owner = state.role === 'owner';
  const defaults: readonly SharingLink[] = invitationRoles.map((role) => ({ role, enabled: true }));
  const ownerLinks = state.enabled ? state.links : defaults;
  const links = owner ? ownerLinks : state.links.filter(({ enabled, url }) => enabled && url);
  const memberUrl = state.memberUrl;

  return (
    <section className="board-sharing__section">
      <h3>邀请链接</h3>
      <div className="board-sharing__invitation-list">
        {links.map((link) => (
          <InvitationRow
            key={link.role}
            link={link}
            state={state}
            actions={actions}
            copied={Boolean(copiedUrl && copiedUrl === link.url)}
          />
        ))}
      </div>
      {!owner && (
        <p className="board-sharing__muted">
          打开邀请链接的人会以对应角色加入。所有者可以更改角色或移除访问权限。
        </p>
      )}
      {!owner ? (
        <div className="board-sharing__canonical">
          <p className="board-sharing__muted">只有有权访问的人才能打开这个链接</p>
          <button
            type="button"
            className="board-sharing__button board-sharing__button--copy"
            aria-label="复制页面链接"
            disabled={actions.locked || !memberUrl}
            onClick={(event) => {
              if (memberUrl) {
                onCopyMember(memberUrl, event.currentTarget);
              }
            }}
          >
            <CopyLinkLabel
              label="复制页面链接"
              copied={Boolean(copiedUrl && copiedUrl === memberUrl)}
            />
          </button>
        </div>
      ) : null}
      {owner && !state.enabled ? (
        <p className="board-sharing__muted">复制链接仅创建本机邀请，不会自动开启局域网共享。</p>
      ) : null}
      <span className="board-sharing__copy-status" role="status">
        {copiedUrl ? '已复制链接' : ''}
      </span>
    </section>
  );
}
