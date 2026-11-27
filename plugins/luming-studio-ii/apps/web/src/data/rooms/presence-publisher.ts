import type { BoardRoomClock, BoardRoomPresence } from './contracts.js';

interface PresencePort {
  readonly update: (
    sequence: bigint,
    presence: BoardRoomPresence,
    signal: AbortSignal,
  ) => Promise<boolean>;
  readonly leave: (sequence: bigint) => Promise<boolean>;
  readonly onUnavailable: (error: unknown) => void;
  readonly onLeaveFailure: (error: unknown) => void;
}

const heartbeatMs = 5000;
const motionIntervalMs = 50;

function defaultPresence(): BoardRoomPresence {
  return { following: false };
}

function sameView(
  next: BoardRoomPresence['viewport'],
  prior: BoardRoomPresence['viewport'],
): boolean {
  if (!next || !prior) {
    return next === prior;
  }

  const sameCenter = next.centerX === prior.centerX && next.centerY === prior.centerY;
  const sameSize = next.width === prior.width && next.height === prior.height;

  return sameCenter && sameSize && next.zoom === prior.zoom;
}

function differs(next: BoardRoomPresence, previous: BoardRoomPresence | undefined): boolean {
  if (!previous) {
    return true;
  }

  const cursorChanged =
    next.cursor?.x !== previous.cursor?.x || next.cursor?.y !== previous.cursor?.y;
  const viewChanged = !sameView(next.viewport, previous.viewport);

  return cursorChanged || viewChanged || next.following !== previous.following;
}

export function createPresencePublisher(clock: BoardRoomClock, port: PresencePort) {
  let sequence = 0n;
  let current = defaultPresence();
  let sent: BoardRoomPresence | undefined;
  let sentAt = -Infinity;
  let backoff = 0;
  let controller: AbortController | undefined;
  let sending = false;
  let sentInScope = false;
  let cancelSchedule: (() => void) | undefined;

  function schedule() {
    cancelSchedule?.();
    cancelSchedule = undefined;
    if (!controller || sending) {
      return;
    }

    const cadence = differs(current, sent) ? motionIntervalMs : heartbeatMs;
    const interval = Math.max(cadence, backoff);
    const delay = Math.max(0, sentAt + interval - clock.now());
    cancelSchedule = clock.schedule(delay, send);
  }

  function send() {
    cancelSchedule = undefined;
    const scope = controller;
    if (!scope) {
      return;
    }

    sending = true;
    sent = current;
    sentAt = clock.now();
    sentInScope = true;
    port
      .update(++sequence, sent, scope.signal)
      .then((accepted) => {
        if (controller !== scope) {
          return;
        }

        if (accepted) {
          backoff = 0;
        } else {
          sent = undefined;
          sentAt = clock.now();
          backoff = Math.min(heartbeatMs, Math.max(motionIntervalMs, backoff * 2));
        }
      })
      .catch((error: unknown) => {
        if (controller === scope) {
          port.onUnavailable(error);
        }
      })
      .finally(() => {
        if (controller === scope) {
          sending = false;
          schedule();
        }
      });
  }

  function publish(presence: BoardRoomPresence) {
    if (differs(presence, current)) {
      current = presence;
      schedule();
    }
  }

  function resume() {
    if (!controller) {
      controller = new AbortController();
      sent = undefined;
      schedule();
    }
  }

  function pause() {
    controller?.abort();
    controller = undefined;
    cancelSchedule?.();
    cancelSchedule = undefined;
    sending = false;
  }

  function leave() {
    pause();
    if (sentInScope) {
      sentInScope = false;
      port.leave(++sequence).catch((error: unknown) => port.onLeaveFailure(error));
    }

    current = defaultPresence();
    sent = undefined;
    sentAt = -Infinity;
    backoff = 0;
  }

  function clear() {
    sentInScope = false;
    leave();
  }

  return { publish, resume, pause, leave, clear };
}
