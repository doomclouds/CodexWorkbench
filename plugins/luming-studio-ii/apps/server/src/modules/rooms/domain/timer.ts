import type { RoomTimer, RoomTimerState, TimerAction } from './model.js';

const defaultDuration = 300_000;
const minimumDuration = 1_000;
const maximumDuration = 5_999_000;
const adjustStep = 60_000;
const endGraceMs = 2400;
const maximumVersion = (1n << 63n) - 1n;

export const initialTimer: RoomTimerState = Object.freeze({
  version: 0n,
  durationMs: defaultDuration,
});

function validDuration(milliseconds: number): boolean {
  const inRange = milliseconds >= minimumDuration && milliseconds <= maximumDuration;

  return Number.isInteger(milliseconds) && inRange;
}

export function timerView(state: RoomTimerState, now: number): RoomTimer {
  const { version, durationMs, deadlineUnixMs, pausedRemainingMs } = state;
  const base = { version, durationMs };
  if (pausedRemainingMs !== undefined) {
    return { ...base, phase: 'paused', remainingMs: pausedRemainingMs };
  }
  if (deadlineUnixMs === undefined || deadlineUnixMs + endGraceMs <= now) {
    return { ...base, phase: 'idle', remainingMs: durationMs };
  }

  const remainingMs = Math.max(0, deadlineUnixMs - now);
  const phase = remainingMs > 0 ? 'running' : 'ended';

  return { ...base, phase, deadlineUnixMs, remainingMs };
}

function alterRemaining(
  state: RoomTimerState,
  current: RoomTimer,
  now: number,
  delta: number,
): RoomTimerState | undefined {
  if (delta !== adjustStep && delta !== -adjustStep) {
    return undefined;
  }

  const remaining = current.remainingMs + delta;
  if (!validDuration(remaining)) {
    return undefined;
  }
  if (current.phase === 'running') {
    return { ...state, deadlineUnixMs: now + remaining };
  }
  if (current.phase === 'paused') {
    return { ...state, pausedRemainingMs: remaining };
  }

  return { version: state.version, durationMs: remaining };
}

function transition(
  state: RoomTimerState,
  action: TimerAction,
  now: number,
): RoomTimerState | undefined {
  const current = timerView(state, now);
  const initial = { version: state.version, durationMs: state.durationMs };
  switch (action.kind) {
    case 'start': {
      const starting = current.phase === 'idle' || current.phase === 'ended';

      return starting ? { ...initial, deadlineUnixMs: now + state.durationMs } : undefined;
    }
    case 'pause':
      return current.phase === 'running'
        ? { ...initial, pausedRemainingMs: current.remainingMs }
        : undefined;
    case 'resume':
      return current.phase === 'paused'
        ? { ...initial, deadlineUnixMs: now + current.remainingMs }
        : undefined;
    case 'reset':
      return initial;
    case 'setDuration': {
      const allowed = current.phase !== 'running' && validDuration(action.milliseconds);

      return allowed ? { ...initial, durationMs: action.milliseconds } : undefined;
    }
    case 'adjustDuration':
      return alterRemaining(state, current, now, action.milliseconds);
  }
}

export function changeTimer(
  current: RoomTimerState,
  action: TimerAction,
  now: number,
): RoomTimerState | undefined {
  if (current.version >= maximumVersion) {
    return undefined;
  }

  const state = transition(current, action, now);

  return state && { ...state, version: current.version + 1n };
}
