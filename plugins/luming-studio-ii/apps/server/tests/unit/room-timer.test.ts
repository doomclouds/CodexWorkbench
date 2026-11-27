import { expect, test } from 'vitest';
import { changeTimer, initialTimer, timerView } from '../../src/modules/rooms/domain/index.js';

test('pause freezes remaining time and resume rebuilds one authoritative deadline', () => {
  const now = 100_000;
  const started = changeTimer(initialTimer, { kind: 'start' }, now);
  expect(started).toEqual({ version: 1n, durationMs: 300_000, deadlineUnixMs: 400_000 });

  if (!started) {
    throw new Error('Timer failed to start');
  }

  const paused = changeTimer(started, { kind: 'pause' }, now + 15_000);
  if (!paused) {
    throw new Error('Timer failed to pause');
  }

  expect(timerView(paused, now + 20_000)).toEqual({
    version: 2n,
    phase: 'paused',
    durationMs: 300_000,
    remainingMs: 285_000,
  });
  const resumed = changeTimer(paused, { kind: 'resume' }, now + 25_000);
  expect(resumed).toEqual({ version: 3n, durationMs: 300_000, deadlineUnixMs: 410_000 });
});

test('timer display expires by read time without changing its persisted version', () => {
  const timer = { version: 12n, durationMs: 1000, deadlineUnixMs: 10_000 };
  expect(timerView(timer, 9_999)).toMatchObject({ phase: 'running', remainingMs: 1, version: 12n });
  expect(timerView(timer, 10_000)).toMatchObject({ phase: 'ended', remainingMs: 0, version: 12n });
  expect(timerView(timer, 12_400)).toMatchObject({
    phase: 'idle',
    remainingMs: 1000,
    version: 12n,
  });
});
