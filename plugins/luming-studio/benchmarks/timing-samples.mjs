import assert from 'node:assert/strict';

function sampleTime(sample) {
  if (sample.status === 'ok') {
    assert(Number.isFinite(sample.ms) && sample.ms >= 0, 'Invalid successful timing sample');
    return sample.ms;
  }

  assert(['failure', 'timeout'].includes(sample.status), 'Unknown timing sample status');
  return Infinity;
}

export function summarizeTiming(samples) {
  const sorted = samples.map(sampleTime).sort((first, second) => first - second);

  function percentile(rank) {
    const value = sorted[Math.ceil(rank * sorted.length) - 1];
    return value === Infinity ? 'Infinity' : (value ?? null);
  }

  return {
    samples: samples.length,
    failures: samples.filter((sample) => sample.status === 'failure').length,
    timeouts: samples.filter((sample) => sample.status === 'timeout').length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
  };
}

export function frameIntervals(timestamps) {
  return timestamps.slice(1).map((timestamp, index) => ({
    status: 'ok',
    ms: timestamp - timestamps[index],
  }));
}
