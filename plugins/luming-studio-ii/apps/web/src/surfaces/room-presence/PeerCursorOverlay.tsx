import type { BoardRoomSession } from '../../data/rooms/index.js';
import { participantColor, participantKey, type RoomPresenceViewport } from './follow.js';
import { useRoomCursorSnapshot } from './room-snapshot.js';

interface PeerCursorOverlayProps {
  readonly session: BoardRoomSession;
  readonly viewport: RoomPresenceViewport;
}

export function PeerCursorOverlay({ session, viewport }: PeerCursorOverlayProps) {
  const { participants, actorId: localActor, viewId: localView } = useRoomCursorSnapshot(session);
  return (
    <div className="room-presence-cursors" aria-hidden="true">
      {participants.map((participant) => {
        const { cursor, actorId, displayName } = participant;
        const ownPointer = actorId === localActor && participant.viewId === localView;
        if (!cursor || ownPointer) {
          return null;
        }

        const x = cursor.x * viewport.zoom + viewport.x;
        const y = cursor.y * viewport.zoom + viewport.y;
        const visibleX = x >= 0 && x <= viewport.width;
        const visibleY = y >= 0 && y <= viewport.height;
        if (!visibleX || !visibleY) {
          return null;
        }

        const color = participantColor(actorId);
        return (
          <div
            key={participantKey(participant)}
            className="room-presence-cursor"
            style={{ left: x, top: y }}
          >
            <svg width="16" height="20" viewBox="0 0 16 20" fill={color}>
              <path d="M1 1v15l4-4 3 7 3-1-3-7h6L1 1Z" stroke="white" strokeLinejoin="round" />
            </svg>
            <span style={{ backgroundColor: color }}>{displayName}</span>
          </div>
        );
      })}
    </div>
  );
}
