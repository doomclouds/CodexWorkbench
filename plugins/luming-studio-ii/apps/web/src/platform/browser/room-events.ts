const eventPath = '/studio-room-events';

interface RoomEventCallbacks {
  readonly onEvent: (text: string) => void;
  readonly onDisconnect: () => void;
}

function openRoomEvents(
  boardId: string,
  viewId: string,
  callbacks: RoomEventCallbacks,
  signal: AbortSignal,
  guest: boolean,
): void {
  if (signal.aborted) {
    return;
  }

  const url = new URL(eventPath, window.location.origin);
  url.searchParams.set('boardId', boardId);
  url.searchParams.set('viewId', viewId);
  if (guest) {
    url.searchParams.set('guest', '1');
  }

  const source = new EventSource(url.href);
  let open = true;

  function close() {
    if (!open) {
      return false;
    }

    open = false;
    source.removeEventListener('message', handleMessage);
    source.removeEventListener('error', handleError);
    signal.removeEventListener('abort', close);
    source.close();

    return true;
  }

  function handleMessage(event: MessageEvent<unknown>) {
    const valid = open && !signal.aborted;
    if (valid && typeof event.data === 'string') {
      callbacks.onEvent(event.data);
    }
  }

  function handleError() {
    if (close() && !signal.aborted) {
      callbacks.onDisconnect();
    }
  }

  source.addEventListener('message', handleMessage);
  source.addEventListener('error', handleError);
  signal.addEventListener('abort', close, { once: true });
}

export function subscribeRoomEvents(
  boardId: string,
  viewId: string,
  callbacks: RoomEventCallbacks,
  signal: AbortSignal,
): void {
  openRoomEvents(boardId, viewId, callbacks, signal, false);
}

export function subscribeGuestRoomEvents(
  boardId: string,
  viewId: string,
  callbacks: RoomEventCallbacks,
  signal: AbortSignal,
): void {
  openRoomEvents(boardId, viewId, callbacks, signal, true);
}

export const boardRoomClock = {
  now: () => window.performance.now(),
  schedule(delayMs: number, task: () => void) {
    const timer = window.setTimeout(task, delayMs);

    return () => window.clearTimeout(timer);
  },
};
