export const metrics = [
  "cold-paint",
  "cold-ready",
  "warm-paint",
  "warm-ready",
  "drag-latency",
  "drag-frames",
  "pan-latency",
  "pan-frames",
  "zoom-latency",
  "zoom-frames",
  "save-ui",
  "save-http",
];

const states = ["ok", "failure", "timeout"];

function validDuration(value) {
  return Number.isFinite(value) && value >= 0;
}

function validSample(metric, sample) {
  if (!sample || !states.includes(sample.status)) {
    return false;
  }
  if (sample.status !== "ok") {
    return true;
  }
  if (metric.endsWith("-frames")) {
    return (
      Array.isArray(sample.frames) && sample.frames.length > 0 && sample.frames.every(validDuration)
    );
  }

  return validDuration(sample.ms);
}

export function completeSamples(samples, error, expected = metrics) {
  const occurrences = new Map();
  for (const sample of samples) {
    const metric = sample.metric;
    const prior = occurrences.get(metric);
    occurrences.set(
      metric,
      prior ? { status: "failure", error: "Duplicate metric in attempt." } : sample,
    );
  }

  return expected.map((metric) => {
    const sample = occurrences.get(metric);
    if (validSample(metric, sample)) {
      return { ...sample, metric };
    }

    return {
      metric,
      status: error?.name === "TimeoutError" ? "timeout" : "failure",
      error: error?.message ?? "Metric was not observed in this attempt.",
    };
  });
}

function rank(values, fraction) {
  const sample = values[Math.ceil(fraction * values.length) - 1];

  return sample === Infinity ? "Infinity" : (sample ?? null);
}

export function summarize(metric, attempts) {
  const frames = metric.endsWith("-frames");
  const successful = attempts.filter(({ status }) => status === "ok");
  const failures = attempts.filter(({ status }) => status === "failure").length;
  const timeouts = attempts.filter(({ status }) => status === "timeout").length;
  const values = successful.flatMap((sample) => (frames ? sample.frames : [sample.ms]));
  const distribution = frames
    ? [...values]
    : values.concat(Array(failures + timeouts).fill(Infinity));
  distribution.sort((a, b) => a - b);

  return {
    attempts: attempts.length,
    validAttempts: successful.length,
    failures,
    timeouts,
    samples: values.length,
    p50: rank(distribution, 0.5),
    p95: rank(distribution, 0.95),
    p99: rank(distribution, 0.99),
    worst: rank(distribution, 1),
    over50: frames ? values.filter((value) => value > 50).length : null,
  };
}

export function comparisonRows(cases) {
  const groups = new Map();
  for (const retry of cases) {
    for (const metric of retry.metrics ?? metrics) {
      const key = [retry.profile, retry.view, metric].join(":");
      const row = groups.get(key) ?? {
        profile: retry.profile,
        view: retry.view,
        metric,
        initial: null,
        ii: null,
      };
      const samples = retry.rounds.flatMap(({ samples }) =>
        samples.filter((sample) => sample.metric === metric),
      );
      row[retry.edition] = { ...summarize(metric, samples), planned: retry.expectedRounds };
      groups.set(key, row);
    }
  }

  return [...groups.values()];
}
