import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type {
  BoardRoomParticipant,
  BoardRoomSession,
  BoardRoomState,
  BoardRoomViewport,
} from '../../data/rooms/index.js';
import { sameParticipant } from './follow.js';

type MatchParticipant = (current: BoardRoomParticipant, next: BoardRoomParticipant) => boolean;
type MatchRoom = (current: BoardRoomState, next: BoardRoomState) => boolean;

function sameViewport(current: BoardRoomViewport | undefined, next: BoardRoomViewport | undefined) {
  if (current === next) {
    return true;
  }
  if (!current || !next) {
    return false;
  }

  const sameCenter = current.centerX === next.centerX && current.centerY === next.centerY;
  const sameDimensions = current.width === next.width && current.height === next.height;
  return sameCenter && sameDimensions && current.zoom === next.zoom;
}

function sameMember(current: BoardRoomParticipant, next: BoardRoomParticipant) {
  return sameParticipant(current, next) && current.displayName === next.displayName;
}

function sameChromeMember(current: BoardRoomParticipant, next: BoardRoomParticipant) {
  const sameProfile = sameMember(current, next) && current.role === next.role;
  return (
    sameProfile &&
    current.following === next.following &&
    sameViewport(current.viewport, next.viewport)
  );
}

function sameCursorMember(current: BoardRoomParticipant, next: BoardRoomParticipant) {
  const samePoint = current.cursor?.x === next.cursor?.x && current.cursor?.y === next.cursor?.y;
  return samePoint && sameMember(current, next);
}

function sameMembers(current: BoardRoomState, next: BoardRoomState, match: MatchParticipant) {
  const previous = current.participants;
  const incoming = next.participants;
  if (previous === incoming) {
    return true;
  }

  return (
    previous.length === incoming.length &&
    previous.every((member, index) => {
      const candidate = incoming[index];
      return candidate !== undefined && (member === candidate || match(member, candidate));
    })
  );
}

function sameViewer(current: BoardRoomState, next: BoardRoomState) {
  return current.actorId === next.actorId && current.viewId === next.viewId;
}

function sameChrome(current: BoardRoomState, next: BoardRoomState) {
  const sameAccess = current.status === next.status && current.canEdit === next.canEdit;
  return sameAccess && sameViewer(current, next) && sameMembers(current, next, sameChromeMember);
}

function sameCursors(current: BoardRoomState, next: BoardRoomState) {
  return sameViewer(current, next) && sameMembers(current, next, sameCursorMember);
}

function roomReader(session: BoardRoomSession, matches: MatchRoom) {
  let current: BoardRoomState | undefined;
  return () => {
    const next = session.getSnapshot();
    if (!current || (next !== current && !matches(current, next))) {
      current = next;
    }

    return current;
  };
}

function useRoomSnapshot(session: BoardRoomSession, matches: MatchRoom) {
  const subscribe = useCallback((listener: () => void) => session.subscribe(listener), [session]);
  const read = useMemo(() => roomReader(session, matches), [session, matches]);
  return useSyncExternalStore(subscribe, read, read);
}

export function useRoomChromeSnapshot(session: BoardRoomSession) {
  return useRoomSnapshot(session, sameChrome);
}

export function useRoomCursorSnapshot(session: BoardRoomSession) {
  return useRoomSnapshot(session, sameCursors);
}
