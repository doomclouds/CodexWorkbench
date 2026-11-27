import { ChevronDown, UserRound } from 'lucide-react';

import type { SharingMember, SharingOperation, SharingRole } from '../../data/sharing/index.js';
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

function MemberRow({ member, actions }: { member: SharingMember; actions: MemberActions }) {
  const { actorId, name, role, removed, active } = member;
  const changeKind = removed ? 'restoreMember' : 'changeMemberRole';
  const deleteKind = removed ? 'forgetMember' : 'removeMember';
  const deleteLabel = removed ? '删除成员记录' : '移除访问权限';
  const actionLabel = removed ? '恢复访问' : memberRole(role);
  const activeStatus = active ? '在线' : '未在线';
  const choices = invitationRoles.map((choice) => ({
    id: choice,
    label: roleLabels[choice],
    shortcut: !removed && role === choice ? '✓' : undefined,
    disabled: !removed && role === choice,
    run: () => actions.onUpdate({ kind: changeKind, actorId, role: choice }),
  }));

  return (
    <div className="board-sharing__row">
      <span className="board-sharing__avatar" aria-hidden="true">
        {graphemes.segment(name).containing(0)?.segment}
      </span>
      <span className="board-sharing__row-copy">
        <strong>{name}</strong>
        <small>{removed ? '已移除' : activeStatus}</small>
      </span>
      <SharingMenu
        label={name + '的访问权限'}
        className="board-sharing__button"
        disabled={actions.locked}
        items={[
          ...choices,
          {
            id: deleteKind,
            label: deleteLabel,
            separatorBefore: true,
            run: (trigger) =>
              actions.onConfirm({
                title: removed ? '删除成员记录？' : '移除成员？',
                description: removed
                  ? '此成员记录将被永久删除。'
                  : name + '将失去访问此白板的权限。',
                label: deleteLabel,
                operation: { kind: deleteKind, actorId },
                trigger,
              }),
          },
        ]}
      >
        {actionLabel} <ChevronDown size={14} />
      </SharingMenu>
    </div>
  );
}

export function SharingMembers({
  members,
  actions,
}: {
  members: readonly SharingMember[];
  actions: MemberActions;
}) {
  const joined = members.filter(({ role, removed }) => role !== 'owner' && !removed);
  const removed = members.filter((member) => member.removed);

  return (
    <section className="board-sharing__section">
      <h3>有权访问的人</h3>
      <div className="board-sharing__row">
        <span className="board-sharing__avatar" aria-hidden="true">
          <UserRound size={18} />
        </span>
        <span className="board-sharing__row-copy">
          <strong>作品所有者（你）</strong>
          <small>这台电脑</small>
        </span>
        <span className="board-sharing__muted">所有者</span>
      </div>
      {joined.length > 0 ? <h4>加入的人</h4> : null}
      {joined.map((member) => (
        <MemberRow key={member.actorId} member={member} actions={actions} />
      ))}
      {removed.length > 0 ? <h4>已移除的成员</h4> : null}
      {removed.map((member) => (
        <MemberRow key={member.actorId} member={member} actions={actions} />
      ))}
    </section>
  );
}
