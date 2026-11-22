import assert from 'node:assert/strict';
import test from 'node:test';
import { frameIntervals, summarizeTiming } from './timing-samples.mjs';

test('uses nearest ranks without dropping failures and timeouts', () => {
  const samples = Array.from({ length: 18 }, (_, index) => ({ status: 'ok', ms: index + 1 }));
  samples.push({ status: 'failure' }, { status: 'timeout' });

  assert.deepEqual(summarizeTiming(samples), {
    samples: 20,
    failures: 1,
    timeouts: 1,
    p50: 10,
    p95: 'Infinity',
    p99: 'Infinity',
  });
  assert.throws(() => summarizeTiming([{ status: 'ok', ms: NaN }]));
});

test('preserves raw frame gaps, including delayed frames', () => {
  const frames = frameIntervals([1, 17, 33, 92]);

  assert.deepEqual(
    frames.map((frame) => frame.ms),
    [16, 16, 59],
  );
  assert.equal(summarizeTiming(frames).p95, 59);
  assert.equal(summarizeTiming([]).p50, null);
});
