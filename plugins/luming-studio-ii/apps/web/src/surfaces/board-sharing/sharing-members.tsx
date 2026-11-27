import { ChevronDown, RefreshCw, Trash2, UserRound } from 'lucide-react';

import type {
  BoardSharingState,
  SharingMember,
  SharingOperation,
  SharingRole,
} from '../../data/sharing/index.js';
import { invitationRoles, roleLabels } from './sharing-labels.js';
import { SharingMenu } from './sharing-menu.js';

export interface SharingConfirmation {
  readonly title: string;
  readonly description: string;
  readonly label: string;
  readonly operation: SharingOperation;
  readonly trigger: HTMLButtonElement;
}

interface MemberActions {
  readonly locked: boolean;
  readonly onUpdate: (operation: SharingOperation) => void;
  readonly onConfirm: (confirmation: SharingConfirmation) => void;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function memberRole(role: SharingRole) {
  return role === 'owner' ? '所有者' : roleLabels[role];
}

function memberRemoval(member: SharingMember, trigger: HTMLButtonElement): SharingConfirmation {
  const { removed, actorId, name } = member;
  return {
    title: removed ? '删除成员记录？' : '移除成员？',
    description: removed
      ? '删除 ' +
        name +
        ' 的成员记录并释放此白板中的名字。对方以后使用有效邀请链接需重新填写名字；历史和评论仍保留。'
      : '移除 ' + name + ' 后，此人的当前访问权限将被撤销。',
    label: removed ? '确认删除' : '确认移除',
    operation: { kind: removed ? 'forgetMember' : 'removeMember', actorId },
    trigger,
  };
}

function memberStatus({ removed, active, online }: SharingMember) {
  if (removed) {
    return '访问权限已移除';
  }
  if (!active) {
    return '链接已停用';
  }
  if (online) {
    return '在线';
  }

  return online === undefined ? '有权访问' : '未在线';
}

function MemberRow({
  member,
  actions,
  links,
}: {
  member: SharingMember;
  actions: MemberActions;
  links: BoardSharingState['links'];
}) {
  const { actorId, name, role, removed, online } = member;
  const changeKind = removed ? 'restoreMember' : 'changeMemberRole';
  const actionLabel = removed ? '恢复访问' : memberRole(role);
  const choices = invitationRoles.map((choice) => ({
    id: choice,
    label: removed ? '恢复为' + roleLabels[choice] : roleLabels[choice],
    shortcut: !removed && role === choice ? '✓' : undefined,
    disabled: !links.some((link) => link.role === choice && link.enabled),
    run: () => {
      if (removed || role !== choice) {
        actions.onUpdate({ kind: changeKind, actorId, role: choice });
      }
    },
  }));
  const remove = {
    id: 'removeMember',
    label: '移除访问权限',
    separatorBefore: true,
    run: (trigger: HTMLButtonElement) => actions.onConfirm(memberRemoval(member, trigger)),
  };

  return (
    <div className="board-sharing__row">
      <span className="board-sharing__avatar" aria-hidden="true">
        {graphemes.segment(name).containing(0)?.segment}
        {online && <span className="board-sharing__online-dot" />}
      </span>
      <span className="board-sharing__row-copy">
        <strong>{name}</strong>
        <small data-online={online || undefined}>{memberStatus(member)}</small>
      </span>
      <SharingMenu
        label={removed ? '恢复访问：' + name : name + '的访问权限'}
        className="board-sharing__button board-sharing__button--member-role"
        disabled={actions.locked || (removed && choices.every(({ disabled }) => disabled))}
        items={removed ? choices : [...choices, remove]}
      >
        {removed && <RefreshCw size={14} aria-hidden="true" />}
        {actionLabel} <ChevronDown size={13} />
      </SharingMenu>
      {removed && (
        <button
          type="button"
          className="board-sharing__button board-sharing__button--forget"
          aria-label={'删除成员记录：' + name}
          title="删除成员记录"
          disabled={actions.locked}
          onClick={(event) => actions.onConfirm(memberRemoval(member, event.currentTarget))}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function SharingMembers({
  state,
  actions,
}: {
  state: BoardSharingState;
  actions: MemberActions;
}) {
  const { members, links, ownerDisplayName } = state;
  const joined = members.filter(({ role, removed }) => role !== 'owner' && !removed);
  const removed = members.filter((member) => member.removed);

  return (
    <>
      <section className="board-sharing__section">
        <h3>有权访问的人</h3>
        <div className="board-sharing__row">
          <span className="board-sharing__avatar" aria-hidden="true">
            {ownerDisplayName ? (
              graphemes.segment(ownerDisplayName).containing(0)?.segment
            ) : (
              <UserRound size={18} />
            )}
          </span>
          <span className="board-sharing__row-copy">
            <strong>{ownerDisplayName ?? '作品所有者'}（你）</strong>
            <small>这台电脑</small>
          </span>
          <span className="board-sharing__muted">所有者</span>
        </div>
      </section>
      <section className="board-sharing__section">
        <h3>加入的人</h3>
        {joined.length === 0 && (
          <p className="board-sharing__muted">还没有人加入。把下面的链接发给对方。</p>
        )}
        {joined.map((member) => (
          <MemberRow key={member.actorId} member={member} links={links} actions={actions} />
        ))}
      </section>
      {removed.length > 0 && (
        <section className="board-sharing__section">
          <h3>已移除的成员</h3>
          {removed.map((member) => (
            <MemberRow key={member.actorId} member={member} links={links} actions={actions} />
          ))}
          <p className="board-sharing__muted">选择角色恢复后，对方可用原浏览器重新打开白板。</p>
        </section>
      )}
    </>
  );
}
