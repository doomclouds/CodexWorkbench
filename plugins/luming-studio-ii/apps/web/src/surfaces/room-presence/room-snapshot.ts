import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type {
  BoardRoomAgentWorkspace,
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
    current.activityAtMillis === next.activityAtMillis &&
    current.following === next.following &&
    sameViewport(current.viewport, next.viewport)
  );
}

function sameCursorMember(current: BoardRoomParticipant, next: BoardRoomParticipant) {
  const samePoint = current.cursor?.x === next.cursor?.x && current.cursor?.y === next.cursor?.y;
  const samePublishedCursor = !current.cursor || current.expiresAtMillis === next.expiresAtMillis;
  return samePoint && samePublishedCursor && sameMember(current, next);
}

function sameEditorMember(current: BoardRoomParticipant, next: BoardRoomParticipant) {
  const previous = current.editingObjectIds ?? [];
  const incoming = next.editingObjectIds ?? [];

  return (
    sameMember(current, next) &&
    previous.length === incoming.length &&
    previous.every((id, index) => id === incoming[index])
  );
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

type WorkspaceArea = BoardRoomAgentWorkspace['areas'][number];

function sameWorkspaceArea(current: WorkspaceArea, next: WorkspaceArea) {
  const a = current.bounds;
  const b = next.bounds;
  const sameOrigin = a.x === b.x && a.y === b.y;
  const sameSize = a.width === b.width && a.height === b.height;

  return current.id === next.id && current.active === next.active && sameOrigin && sameSize;
}

function sameWorkspace(current: BoardRoomAgentWorkspace, next: BoardRoomAgentWorkspace) {
  const sameOwner = current.agentId === next.agentId && current.taskId === next.taskId;
  const sameActivity = current.phase === next.phase && current.generation === next.generation;
  const sameLabel =
    current.label === next.label && current.expiresAtUnixMs === next.expiresAtUnixMs;

  return (
    sameOwner &&
    sameActivity &&
    sameLabel &&
    current.areas.length === next.areas.length &&
    current.areas.every((area, index) => {
      const candidate = next.areas[index];
      return candidate !== undefined && sameWorkspaceArea(area, candidate);
    })
  );
}

function sameAgentWorkspaces(current: BoardRoomState, next: BoardRoomState) {
  const previous = current.agentWorkspaces;
  const incoming = next.agentWorkspaces;
  if (previous === incoming) {
    return true;
  }
  if (!previous || !incoming || previous.length !== incoming.length) {
    return false;
  }

  return previous.every((workspace, index) => {
    const candidate = incoming[index];
    return (
      candidate !== undefined && (workspace === candidate || sameWorkspace(workspace, candidate))
    );
  });
}

function sameOnlineAgents(
  current: readonly string[] | undefined,
  next: readonly string[] | undefined,
) {
  return (
    current === next ||
    (current?.length === next?.length &&
      current?.every((id, index) => id === next?.[index]) === true)
  );
}

function sameChrome(current: BoardRoomState, next: BoardRoomState) {
  const sameAccess = current.status === next.status && current.canEdit === next.canEdit;
  return (
    sameAccess &&
    current.feedbackUpdateKey === next.feedbackUpdateKey &&
    current.suggestionsUpdateKey === next.suggestionsUpdateKey &&
    current.canReleaseAgentActivity === next.canReleaseAgentActivity &&
    sameAgentWorkspaces(current, next) &&
    sameOnlineAgents(current.onlineAgentIds, next.onlineAgentIds) &&
    sameOnlineAgents(current.readingAgentIds, next.readingAgentIds) &&
    sameViewer(current, next) &&
    sameMembers(current, next, sameChromeMember)
  );
}

function sameCursors(current: BoardRoomState, next: BoardRoomState) {
  return sameViewer(current, next) && sameMembers(current, next, sameCursorMember);
}

function sameEditors(current: BoardRoomState, next: BoardRoomState) {
  return (
    current.status === next.status &&
    sameViewer(current, next) &&
    sameMembers(current, next, sameEditorMember)
  );
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

export function useRoomEditingSnapshot(session: BoardRoomSession) {
  return useRoomSnapshot(session, sameEditors);
}
