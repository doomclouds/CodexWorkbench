import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [baselinePath, candidatePath] = process.argv.slice(2);
assert(baselinePath && candidatePath, 'Supply the v1 and v2 full-history comparison witnesses');

async function readWitness(path, schema) {
  const witness = JSON.parse(await readFile(path, 'utf8'));
  const storage = witness.storageComparison;
  assert.equal(witness.kind, 'full-history-archive-roundtrip');
  assert.equal(storage?.schema, schema);
  assert.equal(witness.archiveVerified, true, 'The full archive roundtrip must pass: ' + path);
  assert.equal(storage.prefillSaves, 200);
  assert(storage.requestedSamples >= 30);
  assert.equal(storage.timing.samples, storage.requestedSamples);
  assert.equal(storage.timing.failures + storage.timing.timeouts, 0);
  assert.equal(witness.verifiedHistory.length, storage.prefillSaves);
  return witness;
}

function retainedVersions(witness) {
  return witness.verifiedHistory.map(({ revision, sha256 }) => [revision, sha256]);
}

function measurements(witness) {
  const durations = (name) =>
    witness.samples
      .filter((sample) => sample.name === name && sample.code === 'OK')
      .map((sample) => sample.durationMs);

  return {
    runtime: witness.runtime.files,
    firstWriteHistoryCount: witness.storageComparison.historyAfterFirstSave.length,
    save: witness.storageComparison.timing,
    initialBoardReadMs: durations('storage-first-board-read'),
    reopenedColdBoardReadMs: durations('storage-reopened-cold-read'),
    reopenedWarmBoardReadMs: durations('storage-reopened-warm-read'),
    readOnlyReceiptMs: durations('storage-read-only-receipt'),
    exportMs: durations('export-complete-archive'),
    importMs: durations('import-complete-archive'),
    archiveBytes: witness.archive.bytes,
  };
}

const [baseline, candidate] = await Promise.all([
  readWitness(baselinePath, 'v1'),
  readWitness(candidatePath, 'v2'),
]);
assert.notDeepEqual(
  baseline.runtime.files,
  candidate.runtime.files,
  'Both reports used the same runtime',
);
assert.deepEqual(baseline.fixture, candidate.fixture, 'Synthetic fixture changed');
assert.equal(
  baseline.replay.sourceCopies.database.sha256,
  candidate.replay.sourceCopies.database.sha256,
);
assert.equal(baseline.replay.sourceCopies.asset.sha256, candidate.replay.sourceCopies.asset.sha256);
assert.deepEqual(baseline.storageComparison.seed, candidate.storageComparison.seed);
assert.equal(
  baseline.storageComparison.requestedSamples,
  candidate.storageComparison.requestedSamples,
);
assert.equal(baseline.original.revision, candidate.original.revision);
assert.equal(baseline.original.sha256, candidate.original.sha256);
assert.deepEqual(retainedVersions(baseline), retainedVersions(candidate));

console.log(
  JSON.stringify(
    {
      scope:
        'Same synthetic v1 input, isolated product HTTP, 200 post-start writes before save timing',
      releaseEligible: false,
      baselinePath,
      candidatePath,
      tier: baseline.tier,
      finalRevision: candidate.original.revision,
      retainedVersions: candidate.verifiedHistory.length,
      baseline: measurements(baseline),
      candidate: measurements(candidate),
    },
    null,
    2,
  ),
);
