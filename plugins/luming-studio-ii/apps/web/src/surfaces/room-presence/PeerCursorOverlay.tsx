import type { BoardRoomSession } from '../../data/rooms/index.js';
import {
  cursorLabelColor,
  participantColor,
  roomCursors,
  type RoomPresenceViewport,
} from './follow.js';
import { useRoomCursorSnapshot } from './room-snapshot.js';

interface PeerCursorOverlayProps {
  readonly session: BoardRoomSession;
  readonly viewport: RoomPresenceViewport;
}

export function PeerCursorOverlay({ session, viewport }: PeerCursorOverlayProps) {
  const { participants, actorId } = useRoomCursorSnapshot(session);
  const cursors = roomCursors(participants, actorId);
  return (
    <div className="room-presence-cursors" aria-hidden="true">
      {cursors.map((participant) => {
        const { cursor, actorId, displayName } = participant;
        if (!cursor) {
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
          <div key={actorId} className="room-presence-cursor" style={{ left: x, top: y }}>
            <svg width="18" height="23" viewBox="0 0 18 23" aria-hidden="true">
              <path d="M2 1 16 14 10 15 7 21 2 1Z" fill={color} stroke="#fff" strokeWidth="1.4" />
            </svg>
            <span style={{ backgroundColor: color, color: cursorLabelColor(color) }}>
              {displayName}
            </span>
          </div>
        );
      })}
    </div>
  );
}
