import { Users, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { BoardRoomParticipant } from '../../data/rooms/index.js';
import { AnchoredPopover } from '../../ui/base/index.js';
import {
  AgentWorkspaceAvatar,
  AgentWorkspaceRows,
  type AgentWorkspaceRowsProps,
} from './AgentWorkspaceRows.js';
import { canFollowParticipant, participantColor } from './follow.js';
import type { CSSProperties } from 'react';

interface ParticipantControlProps {
  readonly participants: readonly BoardRoomParticipant[];
  readonly targetActor?: string;
  readonly canStartFollow: boolean;
  readonly preview: boolean;
  readonly reconnecting: boolean;
  readonly onFollow: (participant: BoardRoomParticipant) => void;
  readonly agents: Omit<AgentWorkspaceRowsProps, 'canFollow' | 'preview'>;
}

const visibleAvatars = 3;
const roles = new Map([
  ['owner', '所有者'],
  ['editor', '可编辑'],
  ['commenter', '可评论'],
  ['viewer', '仅查看'],
  ['reader', '仅查看'],
]);

function ParticipantAvatar({
  participant,
  followed,
}: {
  readonly participant: BoardRoomParticipant;
  readonly followed: boolean;
}) {
  const color = participantColor(participant.actorId);
  const style = {
    '--room-member-color': color,
    backgroundColor: color,
    color: color === '#fbb315' ? '#201b0c' : '#fff',
  } as CSSProperties;

  return (
    <span
      className="room-presence-avatar"
      data-followed={followed || undefined}
      aria-hidden="true"
      style={style}
    >
      {Array.from(participant.displayName)[0] ?? '协'}
    </span>
  );
}

function ParticipantRow({
  participant,
  followed,
  canStartFollow,
  preview,
  onFollow,
}: {
  readonly participant: BoardRoomParticipant;
  readonly followed: boolean;
  readonly canStartFollow: boolean;
  readonly preview: boolean;
  readonly onFollow: (participant: BoardRoomParticipant) => void;
}) {
  const role = roles.get(participant.role);
  const action = followed ? '停止跟随' : '跟随';
  const canFollow = canFollowParticipant(participant);
  const disabled = preview || (!followed && (!canStartFollow || !canFollow));
  const detail = participant.following ? '正在跟随他人' : '在画布上';
  let followTitle: string | undefined;
  if (preview) {
    followTitle = '预览期间不能跟随，请先退出预览';
  } else if (disabled) {
    followTitle = '当前没有可跟随的视口';
  }

  return (
    <li className="room-presence-row">
      <ParticipantAvatar participant={participant} followed={followed} />
      <div className="room-presence-identity">
        <strong>{participant.displayName}</strong>
        <span>
          {detail}
          {role && ' · ' + role}
        </span>
      </div>
      <button
        className="room-presence-link"
        type="button"
        disabled={disabled}
        aria-label={action + ' ' + participant.displayName}
        title={followTitle}
        onClick={() => onFollow(participant)}
      >
        {action}
      </button>
    </li>
  );
}

export function ParticipantControl({
  participants,
  targetActor,
  canStartFollow,
  preview,
  reconnecting,
  onFollow,
  agents,
}: ParticipantControlProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLElement>(null);
  const agentIds = [...new Set(agents.workspaces.map(({ agentId }) => agentId))];
  const total = participants.length + agentIds.length;
  if (total === 0 && !reconnecting) {
    return null;
  }

  function handleClose() {
    setOpen(false);
  }

  function handleFollow(participant: BoardRoomParticipant) {
    onFollow(participant);
    handleClose();
  }

  function handleAgentFollow(agentId: string) {
    agents.onFollow(agentId);
    handleClose();
  }

  return (
    <div className="room-presence-control">
      <button
        ref={setAnchor}
        type="button"
        className="room-presence-trigger"
        aria-label="此刻在这里"
        title={
          [
            ...agentIds.map(() => 'Agent'),
            ...participants.map(({ displayName }) => displayName),
          ].join('、') || '此刻在这里'
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="room-presence-avatar-stack">
          {agentIds.slice(0, visibleAvatars).map((agentId) => (
            <AgentWorkspaceAvatar
              key={agentId}
              agentId={agentId}
              followed={agentId === agents.followedAgentId}
            />
          ))}
          {participants
            .slice(0, Math.max(0, visibleAvatars - agentIds.length))
            .map((participant) => (
              <ParticipantAvatar
                key={participant.actorId}
                participant={participant}
                followed={participant.actorId === targetActor}
              />
            ))}
          {total === 0 && <Users size={16} aria-hidden="true" />}
        </span>
        {total > visibleAvatars && (
          <span className="room-presence-more">+{total - visibleAvatars}</span>
        )}
      </button>
      <AnchoredPopover
        open={open}
        anchor={anchor}
        label="此刻在这里"
        align="end"
        initialFocus={() => panel.current?.focus({ preventScroll: true })}
        restoreFocus={() => anchor?.focus({ preventScroll: true })}
        onRequestClose={handleClose}
      >
        <section ref={panel} className="room-presence-members" tabIndex={-1}>
          <header className="room-presence-heading">
            <h2>此刻在这里</h2>
            <button
              type="button"
              className="room-presence-close"
              aria-label="关闭此刻在这里"
              onClick={handleClose}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>
          {reconnecting && (
            <p className="room-presence-muted" role="status">
              正在重新连接白板
            </p>
          )}
          <ul className="room-presence-list">
            <AgentWorkspaceRows
              {...agents}
              canFollow={canStartFollow}
              preview={preview}
              onFollow={handleAgentFollow}
            />
            {participants.map((participant) => (
              <ParticipantRow
                key={participant.actorId}
                participant={participant}
                followed={participant.actorId === targetActor}
                canStartFollow={canStartFollow}
                preview={preview}
                onFollow={handleFollow}
              />
            ))}
          </ul>
        </section>
      </AnchoredPopover>
    </div>
  );
}
