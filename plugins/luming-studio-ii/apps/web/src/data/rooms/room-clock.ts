import type { BoardRoomClock } from './contracts.js';

export function createRoomClock(clock: BoardRoomClock) {
  let serverAnchor: number | undefined;
  let localAnchor = clock.now();
  let latestSample = -Infinity;

  function now(): number {
    if (serverAnchor === undefined) {
      return 0;
    }

    return serverAnchor + Math.max(0, clock.now() - localAnchor);
  }

  function sample(serverTimeUnixMs: number, requestStartedAt?: number) {
    if (serverTimeUnixMs < latestSample) {
      return;
    }

    const observedAt = clock.now();
    const roundTrip = requestStartedAt === undefined ? 0 : observedAt - requestStartedAt;
    latestSample = serverTimeUnixMs;
    serverAnchor = Math.max(now(), serverTimeUnixMs + Math.max(0, roundTrip / 2));
    localAnchor = observedAt;
  }

  function reset() {
    serverAnchor = undefined;
    localAnchor = clock.now();
    latestSample = -Infinity;
  }

  return { now, sample, reset };
}
