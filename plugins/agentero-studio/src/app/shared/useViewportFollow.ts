import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import type { CollaborationRoom, Presence } from '../../contracts/studio';
import { jsonEqual } from '../../core/shared/safe-merge';
import type { StudioDocument, Viewport } from '../products';
import { ParticipantActivity, participantIdentity } from './presence-members';
import {
  activeAgentTasks,
  agentPeerBounds,
  documentElements,
  type ActivityBounds,
} from './agent-activity';

export function fitFollowViewport(
  viewport: Viewport,
  remote: { w: number; h: number },
  local: { w: number; h: number },
): Viewport | undefined {
  const positiveDimensions = [viewport.zoom, remote.w, remote.h, local.w, local.h];
  const validDimensions = positiveDimensions.every((value) => Number.isFinite(value) && value > 0);
  if (!validDimensions || ![viewport.x, viewport.y].every(Number.isFinite)) {
    return;
  }

  const width = remote.w / viewport.zoom;
  const height = remote.h / viewport.zoom;
  const x = -viewport.x / viewport.zoom + width / 2;
  const y = -viewport.y / viewport.zoom + height / 2;
  const zoom = Math.max(0.1, Math.min(4, local.w / width, local.h / height));
  return { x: local.w / 2 - x * zoom, y: local.h / 2 - y * zoom, zoom };
}

export function fitAgentArea(bounds: ActivityBounds, local: { w: number; h: number }): Viewport {
  const margin = Math.min(48, local.w / 6, local.h / 6);
  const zoom = Math.max(
    0.1,
    Math.min(1, (local.w - margin * 2) / bounds.w, (local.h - margin * 2) / bounds.h),
  );

  return {
    x: local.w / 2 - (bounds.x + bounds.w / 2) * zoom,
    y: local.h / 2 - (bounds.y + bounds.h / 2) * zoom,
    zoom,
  };
}

interface FollowSnapshot {
  viewport?: Viewport;
  peer?: Presence;
}

function createFollowView() {
  let snapshot: FollowSnapshot = {};
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update(changes: Partial<FollowSnapshot>) {
      const next = { ...snapshot, ...changes };
      if (next.viewport === snapshot.viewport && jsonEqual(next.peer, snapshot.peer)) {
        return;
      }

      snapshot = next;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

function requestFrame(frame: FrameRequestCallback) {
  return window.requestAnimationFrame
    ? window.requestAnimationFrame(frame)
    : window.setTimeout(() => frame(performance.now()), 16);
}

function sameViewport(a: Viewport | undefined, b: Viewport) {
  if (!a) {
    return false;
  }

  return (
    Math.abs(a.x - b.x) < 0.1 && Math.abs(a.y - b.y) < 0.1 && Math.abs(a.zoom - b.zoom) < 0.001
  );
}

function createFollowMotion(updateView: (changes: Partial<FollowSnapshot>) => void) {
  let rendered: Viewport | undefined;
  let target: Viewport | undefined;
  let animation: number | undefined;
  function cancel() {
    if (animation === undefined) {
      return;
    }

    if (window.cancelAnimationFrame) {
      window.cancelAnimationFrame(animation);
    } else {
      window.clearTimeout(animation);
    }
    animation = undefined;
  }
  function render(viewport: Viewport | undefined) {
    rendered = viewport;
    updateView({ viewport });
  }
  function stop() {
    cancel();
    target = undefined;
    render(undefined);
  }
  function moveTo(next: Viewport, currentViewport: () => Viewport | undefined) {
    const inMotion = animation !== undefined || sameViewport(rendered, next);
    if (sameViewport(target, next) && inMotion) {
      return;
    }

    cancel();
    target = next;
    const from = rendered ?? currentViewport();
    if (!from || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      render(next);
      return;
    }
    const start = performance.now();
    const frame = (now: number) => {
      const progress = Math.max(0, Math.min(1, (now - start) / 90));
      const eased = progress * progress * (3 - 2 * progress);
      render({
        x: from.x + (next.x - from.x) * eased,
        y: from.y + (next.y - from.y) * eased,
        zoom: from.zoom + (next.zoom - from.zoom) * eased,
      });
      animation = progress < 1 ? requestFrame(frame) : undefined;
    };
    animation = requestFrame(frame);
  }
  return { cancel, stop, moveTo };
}

function followedPage(
  tracker: ParticipantActivity,
  peers: Presence[],
  actorId: string,
  following: string,
  elements: ReturnType<typeof documentElements>,
  clockOffsetMs: number,
) {
  const localNow = Date.now();
  const now = localNow + clockOffsetMs;
  const member = tracker
    .read(peers, actorId, localNow)
    .find((item) => participantIdentity(item.actor) === following);
  const agent = member?.actor.kind === 'agent';
  const peer = member?.peers.find((page) => {
    if (page.visible === false) {
      return false;
    }

    return agent ? !!agentPeerBounds(page, elements, now) : !!page.context?.viewport;
  });
  const expiry = agent
    ? Math.min(
        ...member.peers.flatMap((page) =>
          activeAgentTasks(page, now).map((task) => task.expiresAt),
        ),
      )
    : Infinity;

  return { peer, agent, expiry, now };
}

function remoteViewport(
  peer: Presence,
  bounds: ActivityBounds | undefined,
  area: HTMLElement | null,
) {
  const local = {
    w: area?.clientWidth || window.innerWidth,
    h: area?.clientHeight || window.innerHeight,
  };

  if (bounds) {
    return fitAgentArea(bounds, local);
  }

  const surface = peer.context?.surface as { w?: number; h?: number } | undefined;
  const viewport = peer.context?.viewport;
  if (viewport) {
    return fitFollowViewport(
      viewport,
      { w: surface?.w || local.w, h: surface?.h || local.h },
      local,
    );
  }
}

function followsOwnPage(peer: Presence, peers: Presence[], actorId: string, peerId: string) {
  if (!peer.following) {
    return false;
  }

  return (
    peer.following === peerId ||
    peers.some((page) => page.actor.id === actorId && page.peerId === peer.following)
  );
}

export function useViewportFollow({
  actorId,
  peerId,
  peers,
  following,
  room,
  area,
  busy,
  onStop,
  currentViewport,
  getCurrentViewport,
  document,
  clockOffsetMs = 0,
}: {
  actorId: string;
  peerId: string;
  peers: Presence[];
  following: string;
  room: CollaborationRoom;
  area: RefObject<HTMLElement | null>;
  busy: boolean;
  onStop: () => void;
  currentViewport?: Viewport;
  getCurrentViewport?: () => Viewport | undefined;
  document?: StudioDocument | null;
  clockOffsetMs?: number;
}) {
  const [view] = useState(createFollowView);
  const [motion] = useState(() => createFollowMotion(view.update));
  const snapshot = useSyncExternalStore(view.subscribe, view.getSnapshot, view.getSnapshot);
  const tracker = useRef(new ParticipantActivity());
  const seq = useRef(0);
  const began = useRef(0);
  const ownView = useRef(currentViewport);
  useLayoutEffect(() => {
    ownView.current = currentViewport;
  }, [currentViewport]);
  const deadline = useRef<number | undefined>(undefined);
  const lastPeer = useRef<Presence | undefined>(undefined);
  const agentEnded = useRef(false);
  const reported = useRef<
    { room: CollaborationRoom; peerId: string; targetId: string | null } | undefined
  >(undefined);
  const reportTarget = useCallback(
    (room: CollaborationRoom, peerId: string, targetId: string | null) => {
      const previous = reported.current;
      if (previous?.room === room && previous.peerId === peerId && previous.targetId === targetId) {
        return;
      }

      const outgoing = { room, peerId, targetId };
      reported.current = outgoing;
      function retryOnPresenceChange() {
        if (reported.current === outgoing) {
          reported.current = undefined;
        }
      }
      room
        .send('follow', {
          id: `follow-${peerId}`,
          seq: ++seq.current,
          phase: targetId ? 'step' : 'end',
          of: targetId,
        })
        .then((accepted) => {
          if (!accepted) {
            retryOnPresenceChange();
          }
        }, retryOnPresenceChange);
    },
    [],
  );
  const [sizeRevision, resize] = useState(0);
  const [clockRevision, tick] = useState(0);
  useEffect(() => {
    began.current = Date.now();
    deadline.current = undefined;
    agentEnded.current = false;
  }, [following]);
  useEffect(() => () => motion.cancel(), [motion]);
  useEffect(() => {
    const node = area.current;
    if (!node || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => resize((value) => value + 1));
    observer.observe(node);
    return () => observer.disconnect();
  }, [area, following]);
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const cleanup = () => timers.forEach((timer) => clearTimeout(timer));
    const elements = documentElements(document);
    const { peer, agent, expiry, now } = followedPage(
      tracker.current,
      peers,
      actorId,
      following,
      elements,
      clockOffsetMs,
    );
    reportTarget(room, peerId, peer?.peerId ?? null);
    const last = lastPeer.current;
    view.update({
      peer: peer ?? (last && participantIdentity(last.actor) === following ? last : undefined),
    });

    if (!following) {
      motion.stop();
      lastPeer.current = undefined;
      return cleanup;
    }
    if (Number.isFinite(expiry)) {
      timers.push(setTimeout(() => tick((value) => value + 1), Math.max(1, expiry - now)));
    }
    if (!peer) {
      if (agent || lastPeer.current?.actor.kind === 'agent') {
        if (!agentEnded.current) {
          agentEnded.current = true;
          motion.stop();
          onStop();
        }
        return cleanup;
      }
      motion.cancel();
      deadline.current ??= Date.now() + 1000;
      timers.push(setTimeout(onStop, Math.max(0, deadline.current - Date.now())));
      return cleanup;
    }
    deadline.current = undefined;
    agentEnded.current = false;
    lastPeer.current = peer;
    if (followsOwnPage(peer, peers, actorId, peerId)) {
      timers.push(setTimeout(onStop, Math.max(0, 1500 - (Date.now() - began.current))));
      return cleanup;
    }
    if (busy) {
      motion.cancel();
      return cleanup;
    }
    const bounds = agent ? agentPeerBounds(peer, elements, now) : undefined;
    const next = remoteViewport(peer, bounds, area.current);
    if (next) {
      motion.moveTo(next, () => getCurrentViewport?.() ?? ownView.current);
    }
    return cleanup;
  }, [
    following,
    peers,
    actorId,
    peerId,
    room,
    area,
    busy,
    onStop,
    getCurrentViewport,
    sizeRevision,
    clockRevision,
    document,
    clockOffsetMs,
    motion,
    reportTarget,
    view,
  ]);
  const peer =
    snapshot.peer && participantIdentity(snapshot.peer.actor) === following
      ? snapshot.peer
      : undefined;

  return { viewport: snapshot.viewport, peer, stop: motion.stop };
}
