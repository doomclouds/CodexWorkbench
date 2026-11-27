import { Users, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { BoardRoomParticipant, BoardRoomParticipantKey } from '../../data/rooms/index.js';
import { AnchoredPopover } from '../../ui/base/index.js';
import {
  canFollowParticipant,
  participantColor,
  participantKey,
  sameParticipant,
} from './follow.js';

interface ParticipantControlProps {
  readonly participants: readonly BoardRoomParticipant[];
  readonly target?: BoardRoomParticipantKey;
  readonly canStartFollow: boolean;
  readonly reconnecting: boolean;
  readonly onFollow: (participant: BoardRoomParticipant) => void;
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
  return (
    <span
      className="room-presence-avatar"
      data-followed={followed || undefined}
      aria-hidden="true"
      style={{ backgroundColor: participantColor(participant.actorId) }}
    >
      {Array.from(participant.displayName)[0] ?? '协'}
    </span>
  );
}

function ParticipantRow({
  participant,
  followed,
  canStartFollow,
  onFollow,
}: {
  readonly participant: BoardRoomParticipant;
  readonly followed: boolean;
  readonly canStartFollow: boolean;
  readonly onFollow: (participant: BoardRoomParticipant) => void;
}) {
  const role = roles.get(participant.role);
  const action = followed ? '停止跟随' : '跟随';
  const canFollow = canFollowParticipant(participant);
  const disabled = !followed && (!canStartFollow || !canFollow);
  const detail = participant.following ? '正在跟随他人' : '在线';
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
        title={disabled ? '当前没有可跟随的视口' : undefined}
        onClick={() => onFollow(participant)}
      >
        {action}
      </button>
    </li>
  );
}

export function ParticipantControl({
  participants,
  target,
  canStartFollow,
  reconnecting,
  onFollow,
}: ParticipantControlProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  if (!participants.length && !reconnecting) {
    return null;
  }

  function handleClose() {
    setOpen(false);
  }

  function handleFollow(participant: BoardRoomParticipant) {
    onFollow(participant);
    handleClose();
  }

  return (
    <div className="room-presence-control">
      <button
        ref={setAnchor}
        type="button"
        className="room-presence-trigger"
        aria-label="此刻在这里"
        title={participants.map(({ displayName }) => displayName).join('、') || '此刻在这里'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="room-presence-avatar-stack">
          {participants.slice(0, visibleAvatars).map((participant) => (
            <ParticipantAvatar
              key={participantKey(participant)}
              participant={participant}
              followed={sameParticipant(participant, target)}
            />
          ))}
          {!participants.length && <Users size={16} aria-hidden="true" />}
        </span>
        {participants.length > visibleAvatars && (
          <span className="room-presence-more">+{participants.length - visibleAvatars}</span>
        )}
      </button>
      <AnchoredPopover
        open={open}
        anchor={anchor}
        label="此刻在这里"
        align="end"
        initialFocus={() => closeButton.current?.focus({ preventScroll: true })}
        restoreFocus={() => anchor?.focus({ preventScroll: true })}
        onRequestClose={handleClose}
      >
        <section className="room-presence-members">
          <header className="room-presence-heading">
            <h2>此刻在这里</h2>
            <button
              ref={closeButton}
              type="button"
              className="room-presence-close"
              aria-label="关闭参与者列表"
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
            {participants.map((participant) => (
              <ParticipantRow
                key={participantKey(participant)}
                participant={participant}
                followed={sameParticipant(participant, target)}
                canStartFollow={canStartFollow}
                onFollow={handleFollow}
              />
            ))}
          </ul>
        </section>
      </AnchoredPopover>
    </div>
  );
}
