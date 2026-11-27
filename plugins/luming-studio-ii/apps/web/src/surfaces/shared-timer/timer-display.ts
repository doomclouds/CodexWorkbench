import { useEffect, useState } from 'react';
import type { BoardRoomSession, BoardRoomTimer } from '../../data/rooms/index.js';

export type Digits = readonly [string, string];

export const milliseconds = 1000;
export const minute = 60;
export const maxSeconds = 5_999;
const endGraceMs = 2400;
const tickMs = 250;

export function digitPair(value: number) {
  return String(value).padStart(2, '0');
}

export function timerDigits(seconds: number): Digits {
  return [digitPair(Math.floor(seconds / minute)), digitPair(seconds % minute)];
}

export function timerPhase(timer: BoardRoomTimer, now: number): BoardRoomTimer['phase'] {
  if (timer.deadlineUnixMs === undefined) {
    return timer.phase;
  }
  if (now < timer.deadlineUnixMs) {
    return 'running';
  }

  return now < timer.deadlineUnixMs + endGraceMs ? 'ended' : 'idle';
}

export function timerRemaining(timer: BoardRoomTimer, now: number) {
  const phase = timerPhase(timer, now);
  switch (phase) {
    case 'running':
      return Math.max(0, (timer.deadlineUnixMs ?? now) - now);
    case 'paused':
      return timer.remainingMs;
    case 'ended':
      return 0;
    case 'idle':
      return timer.durationMs;
  }
}

export function adjustedIdleSeconds(seconds: number, direction: number) {
  const minutes = seconds / minute;

  return (direction > 0 ? Math.floor(minutes) + 1 : Math.ceil(minutes) - 1) * minute;
}

export function useTimerClock(session: BoardRoomSession, deadline: number | undefined) {
  const [now, setNow] = useState(() => session.now());
  useEffect(() => {
    let stop: (() => void) | undefined;

    function tick() {
      const sampled = session.now();
      setNow(sampled);
      if (deadline !== undefined && sampled < deadline + endGraceMs) {
        stop = session.schedule(tickMs, tick);
      }
    }

    stop = session.schedule(0, tick);

    return () => stop?.();
  }, [session, deadline]);

  return now;
}
