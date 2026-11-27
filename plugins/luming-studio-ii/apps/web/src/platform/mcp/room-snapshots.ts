import { StudioMcpRequestError } from './protocol.js';

interface Observer<Snapshot> {
  readonly onEvent: (snapshot: Snapshot) => void;
  readonly onDisconnect: (reason?: 'accessLost', error?: unknown) => void;
}

const intervalMs = 600;
const accessLostStatuses = new Set([401, 403, 404]);

interface PollingEnvironment {
  readonly now: () => number;
  readonly isVisible: () => boolean;
  readonly schedule: (delay: number, task: () => void) => () => void;
  readonly subscribeVisibility: (task: () => void) => () => void;
}

const panel: PollingEnvironment = {
  now: () => performance.now(),
  isVisible: () => document.visibilityState !== 'hidden',
  schedule(delay, task) {
    const id = setTimeout(task, delay);

    return () => clearTimeout(id);
  },
  subscribeVisibility(task) {
    document.addEventListener('visibilitychange', task);

    return () => document.removeEventListener('visibilitychange', task);
  },
};

export function observeMcpRoomSnapshots<Snapshot>(
  read: (signal: AbortSignal) => Promise<Snapshot>,
  observer: Observer<Snapshot>,
  signal: AbortSignal,
  environment: PollingEnvironment = panel,
): void {
  let cancel: (() => void) | undefined;
  let unsubscribe: (() => void) | undefined;
  let reading = false;
  let stopped = false;
  let nextRead = 0;

  function stop() {
    stopped = true;
    cancel?.();
    unsubscribe?.();
    signal.removeEventListener('abort', stop);
  }

  function disconnect(error: unknown) {
    if (stopped) {
      return;
    }

    stop();
    const accessLost =
      error instanceof StudioMcpRequestError && accessLostStatuses.has(error.status);
    observer.onDisconnect(accessLost ? 'accessLost' : undefined, error);
  }

  async function sample() {
    reading = true;
    try {
      const result = await read(signal);
      if (!stopped) {
        observer.onEvent(result);
      }
    } catch (error) {
      disconnect(error);
    } finally {
      reading = false;
      nextRead = environment.now() + intervalMs;
      schedule();
    }
  }

  function schedule() {
    const waiting = reading || cancel !== undefined;
    if (stopped || waiting || !environment.isVisible()) {
      return;
    }

    cancel = environment.schedule(Math.max(0, nextRead - environment.now()), () => {
      cancel = undefined;
      if (!stopped && environment.isVisible()) {
        sample().catch(disconnect);
      }
    });
  }

  if (!signal.aborted) {
    signal.addEventListener('abort', stop, { once: true });
    unsubscribe = environment.subscribeVisibility(schedule);
    schedule();
  }
}
