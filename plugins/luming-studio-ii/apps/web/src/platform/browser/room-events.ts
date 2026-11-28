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
  scheduleFrame(task: (time: number) => void) {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion !== false || !window.requestAnimationFrame) {
      return;
    }

    const frame = window.requestAnimationFrame(task);

    return () => window.cancelAnimationFrame(frame);
  },
};

export function observeBoardRoomVisibility(listener: (visible: boolean) => void) {
  let pageHidden = false;
  function sync() {
    listener(!pageHidden && document.visibilityState !== 'hidden');
  }

  function hide() {
    pageHidden = true;
    sync();
  }

  function restore() {
    pageHidden = false;
    sync();
  }

  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pagehide', hide, true);
  window.addEventListener('pageshow', restore);
  sync();

  return () => {
    document.removeEventListener('visibilitychange', sync);
    window.removeEventListener('pagehide', hide, true);
    window.removeEventListener('pageshow', restore);
  };
}
