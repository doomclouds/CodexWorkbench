import type {
  BoardRoomParticipant,
  BoardRoomParticipantKey,
  BoardRoomPoint,
  BoardRoomViewport,
} from '../../data/rooms/index.js';

export interface RoomPresenceCamera extends BoardRoomPoint {
  readonly zoom: number;
}

export interface RoomPresenceViewport extends RoomPresenceCamera {
  readonly width: number;
  readonly height: number;
}

const minimumZoom = 0.05;
const maximumZoom = 8;
const participantColors = [
  '#785ee8',
  '#dc3c3d',
  '#019c7f',
  '#fbb315',
  '#ce447d',
  '#10a122',
  '#257de0',
] as const;

export function sameParticipant(
  a: BoardRoomParticipantKey,
  b: BoardRoomParticipantKey | undefined,
) {
  return a.actorId === b?.actorId && a.viewId === b.viewId;
}

export function participantKey({ actorId, viewId }: BoardRoomParticipantKey) {
  return actorId.length + ':' + actorId + viewId;
}

export function participantColor(actorId: string) {
  let hash = 0;
  for (const character of actorId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return participantColors[hash % participantColors.length];
}

export function toRoomViewport(
  viewport: RoomPresenceViewport | undefined,
): BoardRoomViewport | undefined {
  if (!viewport) {
    return;
  }

  const { x, y, zoom, width, height } = viewport;
  if (Math.min(zoom, width, height) <= 0 || ![x, y, zoom, width, height].every(Number.isFinite)) {
    return;
  }

  return {
    centerX: (width / 2 - x) / zoom,
    centerY: (height / 2 - y) / zoom,
    zoom,
    width,
    height,
  };
}

export function fitFollowViewport(
  remote: BoardRoomViewport | undefined,
  local: RoomPresenceViewport | undefined,
): RoomPresenceCamera | undefined {
  if (!remote || !local || Math.min(remote.width, remote.height, remote.zoom) <= 0) {
    return;
  }

  const scale = Math.min(local.width / remote.width, local.height / remote.height);
  const zoom = Math.max(minimumZoom, Math.min(maximumZoom, remote.zoom * scale));
  if (scale <= 0 || !Number.isFinite(zoom)) {
    return;
  }

  return {
    x: local.width / 2 - remote.centerX * zoom,
    y: local.height / 2 - remote.centerY * zoom,
    zoom,
  };
}

export function canFollowParticipant(participant: BoardRoomParticipant) {
  return participant.viewport !== undefined && !participant.following;
}
