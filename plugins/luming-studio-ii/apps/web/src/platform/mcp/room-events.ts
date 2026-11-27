import { reportMcpWarning } from './diagnostics.js';
import { StudioMcpRequestError } from './protocol.js';

interface EventCursor {
  readonly instanceId: string;
  readonly sequence: bigint;
}

interface Observer<Event> {
  readonly onEvent: (event: Event) => void;
  readonly onDisconnect: (reason?: 'accessLost', error?: unknown) => void;
}

interface Visibility {
  readonly isVisible: () => boolean;
  readonly subscribe: (task: () => void) => () => void;
}

const retryMs = 500;
const documentVisibility: Visibility = {
  isVisible: () => document.visibilityState !== 'hidden',
  subscribe(task) {
    document.addEventListener('visibilitychange', task);

    return () => document.removeEventListener('visibilitychange', task);
  },
};

function accessLost(error: unknown): boolean {
  return error instanceof StudioMcpRequestError && (error.status === 401 || error.status === 403);
}

function waitToRetry(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resume, retryMs);
    signal.addEventListener('abort', resume, { once: true });

    function resume() {
      clearTimeout(timeout);
      signal.removeEventListener('abort', resume);
      resolve();
    }
  });
}

export function observeMcpRoomEvents<Event extends EventCursor>(
  wait: (cursor: EventCursor | undefined, signal: AbortSignal) => Promise<readonly Event[]>,
  observer: Observer<Event>,
  signal: AbortSignal,
  visibility: Visibility = documentVisibility,
): void {
  if (signal.aborted) {
    return;
  }

  let cursor: EventCursor | undefined;
  let active: AbortController | undefined;
  let stopped = false;
  const unsubscribe = visibility.subscribe(sync);
  signal.addEventListener('abort', stop, { once: true });
  sync();

  function stop() {
    stopped = true;
    active?.abort();
    unsubscribe();
    signal.removeEventListener('abort', stop);
  }

  async function waitForBatch(scope: AbortSignal): Promise<readonly Event[]> {
    try {
      return await wait(cursor, scope);
    } catch (error) {
      if (accessLost(error)) {
        throw error;
      }

      scope.throwIfAborted();
      await waitToRetry(scope);
      scope.throwIfAborted();

      return wait(cursor, scope);
    }
  }

  async function observe(controller: AbortController) {
    const scope = controller.signal;
    try {
      while (!scope.aborted) {
        const events = await waitForBatch(scope);
        for (const event of events) {
          scope.throwIfAborted();
          observer.onEvent(event);
          cursor = { instanceId: event.instanceId, sequence: event.sequence };
        }
      }
    } catch (error) {
      if (!scope.aborted) {
        stop();
        observer.onDisconnect(accessLost(error) ? 'accessLost' : undefined, error);
      }
    } finally {
      active = undefined;
      sync();
    }
  }

  function sync() {
    if (stopped || !visibility.isVisible()) {
      active?.abort();
      return;
    }
    if (!active) {
      active = new AbortController();
      observe(active).catch((error: unknown) => {
        reportMcpWarning('无法处理白板房间事件。', error);
      });
    }
  }
}
