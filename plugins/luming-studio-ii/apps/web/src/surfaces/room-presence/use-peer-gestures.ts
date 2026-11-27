import { useMemo, useSyncExternalStore } from 'react';
import type {
  BoardRoomGestureChange,
  BoardRoomGestureGeometry,
  BoardRoomGesturePreview,
  BoardRoomSession,
} from '../../data/rooms/index.js';

function sameGeometry(current: BoardRoomGestureGeometry, next: BoardRoomGestureGeometry) {
  const samePoint = current.x === next.x && current.y === next.y;
  const sameSize = current.width === next.width && current.height === next.height;
  return samePoint && sameSize && current.rotation === next.rotation;
}

function sameChange(current: BoardRoomGestureChange, next: BoardRoomGestureChange | undefined) {
  if (!next || current.id !== next.id) {
    return false;
  }

  return (
    current.expectedVersion === next.expectedVersion &&
    sameGeometry(current.geometry, next.geometry)
  );
}

function sameFrame(current: BoardRoomGesturePreview, next: BoardRoomGesturePreview | undefined) {
  if (!next || current.kind !== next.kind || current.changes.length !== next.changes.length) {
    return false;
  }

  return current.changes.every((change, index) => sameChange(change, next.changes[index]));
}

function readCurrentPreviews(session: BoardRoomSession) {
  const state = session.getSnapshot();
  const previews: BoardRoomGesturePreview[] = [];
  let deadline = Infinity;
  if (state.status !== 'online') {
    return { previews, deadline };
  }

  const now = session.now();
  for (const peer of state.participants) {
    const ownView = peer.actorId === state.actorId && peer.viewId === state.viewId;
    const { gesture, gestureExpiresAtMillis: expiresAt } = peer;
    const active = expiresAt !== undefined && expiresAt > now;
    if (ownView || !gesture || !active) {
      continue;
    }

    previews.push(gesture);
    deadline = Math.min(deadline, expiresAt);
  }

  return { previews, deadline };
}

function createPeerGestureStore(session: BoardRoomSession) {
  let current = readCurrentPreviews(session).previews;
  return {
    getSnapshot: () => current,
    subscribe: (listener: () => void) => {
      let cancel: (() => void) | undefined;
      function refresh() {
        cancel?.();
        const { previews, deadline } = readCurrentPreviews(session);
        const unchanged =
          current.length === previews.length &&
          current.every((frame, index) => sameFrame(frame, previews[index]));

        if (!unchanged) {
          current = previews;
          listener();
        }

        if (Number.isFinite(deadline)) {
          cancel = session.schedule(Math.max(1, deadline - session.now()), refresh);
        }
      }

      const unsubscribe = session.subscribe(refresh);
      refresh();
      return () => {
        unsubscribe();
        cancel?.();
      };
    },
  };
}

export function usePeerGestures(session: BoardRoomSession) {
  const store = useMemo(() => createPeerGestureStore(session), [session]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
