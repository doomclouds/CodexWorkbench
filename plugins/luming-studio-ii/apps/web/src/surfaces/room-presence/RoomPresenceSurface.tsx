import { Users } from 'lucide-react';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  BoardRoomAgentWorkspace,
  BoardRoomContentChange,
  BoardRoomGesturePreview,
  BoardRoomParticipant,
  BoardRoomPoint,
  BoardRoomSession,
  BoardRoomState,
  BoardRoomViewport,
} from '../../data/rooms/index.js';
import {
  canFollowParticipant,
  fitFollowViewport,
  participantKey,
  presenceMembers,
  toRoomViewport,
  type RoomPresenceCamera,
  type RoomPresenceViewport,
} from './follow.js';
import { ParticipantControl } from './ParticipantControl.js';
import { PeerCursorOverlay } from './PeerCursorOverlay.js';
import { useRoomChromeSnapshot } from './room-snapshot.js';
import { useAgentWorkspaceCamera } from './use-agent-workspace-camera.js';
import { usePeerGestures } from './use-peer-gestures.js';
import './room-presence.css';

export interface RoomPresenceSlot {
  readonly participants: ReactNode;
  readonly notice: ReactNode;
  readonly overlay: ReactNode;
  readonly accessLost: boolean;
  readonly onCursorChange: (point: BoardRoomPoint | undefined) => void;
  readonly onGesturePreviewChange: (gesture: BoardRoomGesturePreview | undefined) => void;
  readonly remoteGesturePreviews?: readonly BoardRoomGesturePreview[];
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

interface FollowSelection {
  readonly kind: 'person' | 'agent';
  readonly actorId: string;
  readonly session: BoardRoomSession;
  readonly detachSequence: number;
  readonly displayName: string;
}

interface PublishedGesture {
  readonly session: BoardRoomSession;
  readonly preview: BoardRoomGesturePreview;
}

const emptyWorkspaces: readonly BoardRoomAgentWorkspace[] = [];

function RoomPresenceNotice({
  status,
  paused,
  waitingForViewport,
  agent,
  name,
  onStop,
}: {
  readonly status: BoardRoomState['status'];
  readonly paused: boolean;
  readonly waitingForViewport: boolean;
  readonly agent: boolean;
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

  let text = '正在跟随 ' + name + (agent ? ' 的工作区' : ' 的视角');
  if (reconnecting) {
    text = '正在重新连接白板 · 暂停跟随 ' + name;
  } else if (paused) {
    text = '已暂停跟随 ' + name;
  } else if (waitingForViewport) {
    text = '正在等待 ' + name + ' 的视口';
  }

  return (
    <div className="room-presence-banner">
      <Users size={14} aria-hidden="true" />
      <span role="status">{text}</span>
      <button type="button" className="room-presence-link" onClick={onStop}>
        停止跟随
      </button>
    </div>
  );
}

function usePublishPresence(
  session: BoardRoomSession,
  { status, canEdit }: Pick<BoardRoomState, 'status' | 'canEdit'>,
  viewport: BoardRoomViewport | undefined,
  cursor: BoardRoomPoint | undefined,
  following: boolean,
  paused: boolean,
) {
  const pointer = useRef<BoardRoomPoint | undefined>(cursor);
  const gesture = useRef<PublishedGesture | undefined>(undefined);
  const canPublishGesture = !paused && status === 'online' && canEdit;
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

  function currentGesture() {
    const sample = gesture.current;
    return sample?.session === session ? sample.preview : undefined;
  }

  function sendPresence() {
    session.publishPresence({
      viewport,
      cursor: pointer.current,
      following,
      gesture: currentGesture(),
    });
  }

  const publish = useEffectEvent(() => {
    if (paused) {
      pointer.current = undefined;
    }
    if (!canPublishGesture) {
      gesture.current = undefined;
    }

    sendPresence();
  });
  useEffect(() => {
    if (status !== 'accessLost') {
      publish();
    }
  }, [
    session,
    status,
    centerX,
    centerY,
    zoom,
    width,
    height,
    cursorX,
    cursorY,
    following,
    paused,
    canPublishGesture,
  ]);

  return {
    onCursorChange(point: BoardRoomPoint | undefined) {
      if (!paused && status !== 'accessLost') {
        pointer.current = point;
        sendPresence();
      }
    },
    onGesturePreviewChange(preview: BoardRoomGesturePreview | undefined) {
      if (canPublishGesture && preview !== currentGesture()) {
        gesture.current = preview && { session, preview };
        sendPresence();
      }
    },
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
  targetId: string | undefined,
  next: RoomPresenceCamera | undefined,
  onViewportRequest: RoomPresenceSurfaceProps['onViewportRequest'],
) {
  const x = next?.x;
  const y = next?.y;
  const zoom = next?.zoom;
  const requestCamera = useEffectEvent((camera: RoomPresenceCamera) => onViewportRequest(camera));
  useEffect(() => {
    if (x !== undefined && y !== undefined && zoom !== undefined) {
      requestCamera({ x, y, zoom });
    }
  }, [targetId, x, y, zoom]);
}

function activeFollow(
  selection: FollowSelection | undefined,
  available: boolean,
  status: BoardRoomState['status'],
  { session, detachSequence }: Pick<RoomPresenceSurfaceProps, 'session' | 'detachSequence'>,
) {
  const ownsSelection =
    selection?.session === session && selection.detachSequence === detachSequence;
  const peerGone = status === 'online' && !available;
  return ownsSelection && !peerGone && status !== 'accessLost' ? selection : undefined;
}

interface FollowCandidates {
  readonly participants: readonly BoardRoomParticipant[];
  readonly workspaces: readonly BoardRoomAgentWorkspace[];
}

function followCandidate(selection: FollowSelection | undefined, candidates: FollowCandidates) {
  const { participants, workspaces } = candidates;
  if (selection?.kind === 'agent') {
    const workspace = workspaces.find(({ agentId }) => agentId === selection.actorId);
    return {
      available: workspace !== undefined,
      name: workspace?.label,
      waiting: !workspace?.areas.length,
    };
  }

  const peer = participants.find(({ actorId }) => actorId === selection?.actorId);
  return {
    peer,
    available: Boolean(peer && !peer.following),
    name: peer?.displayName,
    waiting: !peer?.viewport,
  };
}

function useFollowSelection(
  { session, detachSequence }: Pick<RoomPresenceSurfaceProps, 'session' | 'detachSequence'>,
  status: BoardRoomState['status'],
  candidates: FollowCandidates,
  canStartFollow: boolean,
) {
  const [selection, setSelection] = useState<FollowSelection>();
  const { available, peer, name, waiting } = followCandidate(selection, candidates);
  const target = activeFollow(selection, available, status, { session, detachSequence });
  if (selection && !target) {
    setSelection(undefined);
  }

  function handleFollow(participant: BoardRoomParticipant) {
    if (participant.actorId === target?.actorId) {
      setSelection(undefined);
    } else if (canStartFollow && canFollowParticipant(participant)) {
      setSelection({
        kind: 'person',
        actorId: participant.actorId,
        displayName: participant.displayName,
        session,
        detachSequence,
      });
    }
  }

  function handleFollowAgent(id: string) {
    if (target?.kind === 'agent' && id === target.actorId) {
      setSelection(undefined);
      return;
    }

    const workspace = candidates.workspaces.find(
      ({ agentId, areas }) => agentId === id && areas.length > 0,
    );

    if (workspace && canStartFollow) {
      setSelection({
        kind: 'agent',
        actorId: id,
        displayName: workspace.label || 'Agent',
        session,
        detachSequence,
      });
    }
  }

  return {
    target,
    peer,
    handleFollow,
    handleFollowAgent,
    stop: () => setSelection(undefined),
    waitingForViewport: waiting,
    name: target && (name || target.displayName),
  };
}

function useRoomFollow(props: RoomPresenceSurfaceProps, snapshot: BoardRoomState) {
  const { session, viewport, cursor, paused, onViewportRequest } = props;
  const { status, actorId } = snapshot;
  const participants = presenceMembers(snapshot.participants, actorId);
  const workspaces = snapshot.agentWorkspaces ?? emptyWorkspaces;
  const roomViewport = toRoomViewport(viewport);
  const canStartFollow = status === 'online' && !paused && roomViewport !== undefined;
  const follow = useFollowSelection(props, status, { participants, workspaces }, canStartFollow);
  const { target, peer } = follow;
  const canApply = status === 'online' && !paused && target !== undefined;
  const next = canApply ? fitFollowViewport(peer?.viewport, viewport) : undefined;
  useFollowCamera(peer && participantKey(peer), next, onViewportRequest);
  useAgentWorkspaceCamera(
    target?.kind === 'agent' ? target.actorId : undefined,
    workspaces,
    viewport,
    canApply,
    onViewportRequest,
  );
  const canPublishViewport = !paused && !target;
  const publish = usePublishPresence(
    session,
    snapshot,
    canPublishViewport ? roomViewport : undefined,
    cursor,
    Boolean(target),
    paused,
  );

  return { ...follow, participants, workspaces, canStartFollow, publish };
}

export function RoomPresenceSurface(props: RoomPresenceSurfaceProps) {
  const { paused, viewport, render, session } = props;
  const snapshot = useRoomSession(props);
  const { status } = snapshot;
  const follow = useRoomFollow(props, snapshot);
  const remoteGestures = usePeerGestures(session);

  return render({
    accessLost: status === 'accessLost',
    ...follow.publish,
    remoteGesturePreviews: paused ? undefined : remoteGestures,
    participants: status !== 'accessLost' && (
      <ParticipantControl
        participants={follow.participants}
        targetActor={follow.target?.actorId}
        canStartFollow={follow.canStartFollow}
        preview={paused}
        reconnecting={status === 'reconnecting'}
        onFollow={follow.handleFollow}
        agents={{
          workspaces: follow.workspaces,
          followedAgentId: follow.target?.kind === 'agent' ? follow.target.actorId : undefined,
          onFollow: follow.handleFollowAgent,
          onRelease:
            status === 'online' && snapshot.canReleaseAgentActivity
              ? session.releaseAgentWorkspace?.bind(session)
              : undefined,
        }}
      />
    ),
    notice: (
      <RoomPresenceNotice
        status={status}
        paused={paused}
        waitingForViewport={follow.waitingForViewport}
        agent={follow.target?.kind === 'agent'}
        name={follow.name}
        onStop={follow.stop}
      />
    ),
    overlay: status === 'online' && !paused && viewport && (
      <PeerCursorOverlay session={session} viewport={viewport} />
    ),
  });
}
