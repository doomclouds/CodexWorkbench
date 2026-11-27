import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  BoardRoomContentChange,
  BoardRoomParticipant,
  BoardRoomParticipantKey,
  BoardRoomPoint,
  BoardRoomSession,
  BoardRoomState,
  BoardRoomViewport,
} from '../../data/rooms/index.js';
import {
  canFollowParticipant,
  fitFollowViewport,
  participantKey,
  sameParticipant,
  toRoomViewport,
  type RoomPresenceCamera,
  type RoomPresenceViewport,
} from './follow.js';
import { ParticipantControl } from './ParticipantControl.js';
import { PeerCursorOverlay } from './PeerCursorOverlay.js';
import { useRoomChromeSnapshot } from './room-snapshot.js';
import './room-presence.css';

export interface RoomPresenceSlot {
  readonly participants: ReactNode;
  readonly notice: ReactNode;
  readonly overlay: ReactNode;
  readonly accessLost: boolean;
  readonly onCursorChange: (point: BoardRoomPoint | undefined) => void;
}

export interface RoomPresenceSurfaceProps {
  readonly session: BoardRoomSession;
  readonly viewport?: RoomPresenceViewport;
  readonly cursor?: BoardRoomPoint;
  readonly paused: boolean;
  readonly detachSequence: number;
  readonly onViewportRequest: (viewport: RoomPresenceCamera) => void;
  readonly onContentChanged?: (change: BoardRoomContentChange) => void;
  readonly onAccessLost?: () => void;
  readonly render: (slot: RoomPresenceSlot) => ReactNode;
}

interface FollowSelection extends BoardRoomParticipantKey {
  readonly session: BoardRoomSession;
  readonly detachSequence: number;
  readonly displayName: string;
}

function RoomPresenceNotice({
  status,
  paused,
  waitingForViewport,
  name,
  onStop,
}: {
  readonly status: BoardRoomState['status'];
  readonly paused: boolean;
  readonly waitingForViewport: boolean;
  readonly name?: string;
  readonly onStop: () => void;
}) {
  if (status === 'accessLost') {
    return (
      <div className="room-presence-banner" role="status">
        白板访问已撤销
      </div>
    );
  }

  const reconnecting = status === 'reconnecting';
  if (!name) {
    return reconnecting ? (
      <div className="room-presence-banner" role="status">
        正在重新连接白板
      </div>
    ) : null;
  }

  let text = '正在跟随 ' + name;
  if (reconnecting) {
    text = '正在重新连接白板 · 暂停跟随 ' + name;
  } else if (paused) {
    text = '已暂停跟随 ' + name;
  } else if (waitingForViewport) {
    text = '正在等待 ' + name + ' 的视口';
  }

  return (
    <div className="room-presence-banner">
      <span role="status">{text}</span>
      <button type="button" className="room-presence-link" onClick={onStop}>
        停止跟随
      </button>
    </div>
  );
}

function usePublishPresence(
  session: BoardRoomSession,
  status: BoardRoomState['status'],
  viewport: BoardRoomViewport | undefined,
  cursor: BoardRoomPoint | undefined,
  following: boolean,
  paused: boolean,
) {
  const pointer = useRef<BoardRoomPoint | undefined>(cursor);
  const centerX = viewport?.centerX;
  const centerY = viewport?.centerY;
  const zoom = viewport?.zoom;
  const width = viewport?.width;
  const height = viewport?.height;
  const cursorX = cursor?.x;
  const cursorY = cursor?.y;
  useEffect(() => {
    pointer.current =
      cursorX === undefined || cursorY === undefined ? undefined : { x: cursorX, y: cursorY };
  }, [session, cursorX, cursorY]);

  const publish = useEffectEvent(() => {
    if (paused) {
      pointer.current = undefined;
    }
    session.publishPresence({ viewport, cursor: pointer.current, following });
  });
  useEffect(() => {
    if (status !== 'accessLost') {
      publish();
    }
  }, [session, status, centerX, centerY, zoom, width, height, cursorX, cursorY, following, paused]);

  return (point: BoardRoomPoint | undefined) => {
    if (!paused && status !== 'accessLost') {
      pointer.current = point;
      session.publishPresence({ viewport, cursor: point, following });
    }
  };
}

function useRoomSession({ session, onContentChanged, onAccessLost }: RoomPresenceSurfaceProps) {
  const snapshot = useRoomChromeSnapshot(session);
  const forwardContentChange = useEffectEvent((change: BoardRoomContentChange) =>
    onContentChanged?.(change),
  );
  const forwardAccessLost = useEffectEvent(() => onAccessLost?.());
  useEffect(
    () =>
      session.open({
        onContentChanged: (change) => forwardContentChange(change),
        onAccessLost: () => forwardAccessLost(),
      }),
    [session],
  );

  return snapshot;
}

function useFollowCamera(
  target: FollowSelection | undefined,
  next: RoomPresenceCamera | undefined,
  onViewportRequest: RoomPresenceSurfaceProps['onViewportRequest'],
) {
  const x = next?.x;
  const y = next?.y;
  const zoom = next?.zoom;
  const targetId = target && participantKey(target);
  const requestCamera = useEffectEvent((camera: RoomPresenceCamera) => onViewportRequest(camera));
  useEffect(() => {
    if (x !== undefined && y !== undefined && zoom !== undefined) {
      requestCamera({ x, y, zoom });
    }
  }, [targetId, x, y, zoom]);
}

function activeFollow(
  selection: FollowSelection | undefined,
  peer: BoardRoomParticipant | undefined,
  status: BoardRoomState['status'],
  { session, detachSequence }: Pick<RoomPresenceSurfaceProps, 'session' | 'detachSequence'>,
) {
  const ownsSelection =
    selection?.session === session && selection.detachSequence === detachSequence;
  const peerGone = status === 'online' && (!peer || peer.following);
  return ownsSelection && !peerGone && status !== 'accessLost' ? selection : undefined;
}

function useRoomFollow(
  {
    session,
    viewport,
    cursor,
    paused,
    detachSequence,
    onViewportRequest,
  }: RoomPresenceSurfaceProps,
  snapshot: BoardRoomState,
) {
  const [selection, setSelection] = useState<FollowSelection>();
  const { status, actorId, viewId } = snapshot;
  const online = status === 'online';
  const participants = snapshot.participants.filter(
    ({ actorId: actor, viewId: view }) => actor !== actorId || view !== viewId,
  );
  const selectedPeer = participants.find((peer) => sameParticipant(peer, selection));
  const target = activeFollow(selection, selectedPeer, status, { session, detachSequence });
  if (selection && !target) {
    setSelection(undefined);
  }

  const canApply = online && !paused && target !== undefined;
  const next = canApply ? fitFollowViewport(selectedPeer?.viewport, viewport) : undefined;
  useFollowCamera(target, next, onViewportRequest);
  const roomViewport = toRoomViewport(viewport);
  const canPublishViewport = !paused && !target;
  const onCursorChange = usePublishPresence(
    session,
    status,
    canPublishViewport ? roomViewport : undefined,
    cursor,
    Boolean(target),
    paused,
  );

  const canStartFollow = online && !paused && roomViewport !== undefined;
  function handleFollow(participant: BoardRoomParticipant) {
    if (sameParticipant(participant, target)) {
      setSelection(undefined);
    } else if (canStartFollow && canFollowParticipant(participant)) {
      setSelection({
        actorId: participant.actorId,
        viewId: participant.viewId,
        displayName: participant.displayName,
        session,
        detachSequence,
      });
    }
  }

  return {
    participants,
    target,
    canStartFollow,
    handleFollow,
    stop: () => setSelection(undefined),
    waitingForViewport: !selectedPeer?.viewport,
    name: target && (selectedPeer?.displayName ?? target.displayName),
    onCursorChange,
  };
}

export function RoomPresenceSurface(props: RoomPresenceSurfaceProps) {
  const { paused, viewport, render, session } = props;
  const snapshot = useRoomSession(props);
  const { status } = snapshot;
  const follow = useRoomFollow(props, snapshot);

  return render({
    accessLost: status === 'accessLost',
    onCursorChange: follow.onCursorChange,
    participants: status !== 'accessLost' && (
      <ParticipantControl
        participants={follow.participants}
        target={follow.target}
        canStartFollow={follow.canStartFollow}
        reconnecting={status === 'reconnecting'}
        onFollow={follow.handleFollow}
      />
    ),
    notice: (
      <RoomPresenceNotice
        status={status}
        paused={paused}
        waitingForViewport={follow.waitingForViewport}
        name={follow.name}
        onStop={follow.stop}
      />
    ),
    overlay: status === 'online' && !paused && viewport && (
      <PeerCursorOverlay session={session} viewport={viewport} />
    ),
  });
}
