import {
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
  readonly onCopy: (role: InvitationRole, url?: string) => void;
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
              run: () => onUpdate({ kind: 'setScope', scope: choice }),
            }))}
            disabled={locked}
          >
            {scopeLabels[scope]} <ChevronDown size={14} />
          </SharingMenu>
          <small>
            {scope === 'local' ? '链接仅在这台电脑上有效' : '同一局域网内拥有链接的人可访问'}
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
      label={roleLabels[role] + '邀请链接选项'}
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
              description: '旧邀请链接将失效，请将新链接发给需要加入的人。',
              label: '重置链接',
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
}: {
  link: SharingLink;
  state: BoardSharingState;
  actions: InvitationActions;
}) {
  const { role, enabled, url } = link;
  const owned = state.role === 'owner';
  const canCopy = enabled || !state.enabled;
  const label = canCopy ? '复制' + roleLabels[role] + '链接' : '启用' + roleLabels[role] + '链接';
  const Icon = roleIcons[role];

  function handleInvitationClick() {
    if (canCopy) {
      actions.onCopy(role, url);
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
        onClick={handleInvitationClick}
      >
        {canCopy && <Copy size={14} aria-hidden="true" />}
        {canCopy ? '复制链接' : '启用链接'}
      </button>
      {owned && state.enabled ? <InvitationMenu link={link} actions={actions} /> : null}
    </div>
  );
}

export function SharingInvitations({
  state,
  actions,
  onCopyMember,
}: {
  state: BoardSharingState;
  actions: InvitationActions;
  onCopyMember: (url: string) => void;
}) {
  const owner = state.role === 'owner';
  const defaults = invitationRoles.map((role) => ({ role, enabled: true }));
  const ownerLinks = state.enabled ? state.links : defaults;
  const links = owner ? ownerLinks : state.links.filter(({ enabled, url }) => enabled && url);
  const memberUrl = state.memberUrl;

  return (
    <section className="board-sharing__section">
      <h3>邀请链接</h3>
      {links.map((link) => (
        <InvitationRow key={link.role} link={link} state={state} actions={actions} />
      ))}
      {memberUrl && !owner ? (
        <div className="board-sharing__canonical">
          <p className="board-sharing__muted">只有有权访问的人才能打开这个链接</p>
          <button
            type="button"
            className="board-sharing__button board-sharing__button--copy"
            disabled={actions.locked}
            onClick={() => onCopyMember(memberUrl)}
          >
            <Copy size={14} aria-hidden="true" /> 复制页面链接
          </button>
        </div>
      ) : null}
      {state.role === 'owner' && state.scope === 'local' ? (
        <p className="board-sharing__muted">复制链接仅创建本机邀请，不会自动开启局域网共享。</p>
      ) : null}
    </section>
  );
}
