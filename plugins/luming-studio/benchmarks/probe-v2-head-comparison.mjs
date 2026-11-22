import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { capacityProfiles } from './capacity-fixtures.mjs';
import { runTemporaryServer, sha256, verifyRuntime } from './runtime-fingerprint.mjs';
import { summarizeTiming } from './timing-samples.mjs';

const retained = 200;
const kinds = ['field', 'move'];
const idPattern = /^[a-zA-Z0-9_-]+$/u;
const checkpointPollLimit = 300;

export function ordinaryWrites(start, samplesPerKind) {
  assert(Number.isSafeInteger(samplesPerKind) && samplesPerKind >= 30);
  assert(samplesPerKind * 2 <= retained, 'All timed writes must fit in the retained history');

  return Array.from({ length: samplesPerKind }, (_, i) => [
    { kind: 'field', changes: { text: 'V2 paired text #' + (i + 1) } },
    {
      kind: 'move',
      changes: {
        x: start.x + (i % 2 === 0 ? 18 : -18),
        y: start.y + (i % 2 === 0 ? 12 : -12),
      },
    },
  ]).flat();
}

export function anchorTurnover(before, after) {
  const previous = new Set(before);
  const current = new Set(after);

  return {
    created: after.filter((revision) => !previous.has(revision)),
    retired: before.filter((revision) => !current.has(revision)),
  };
}

export function retainedHistory(history, newest) {
  const ordered = history.toSorted((left, right) => left.revision - right.revision);
  assert.equal(ordered.length, retained);
  assert.equal(new Set(ordered.map(({ id }) => id)).size, retained);
  assert.deepEqual(
    ordered.map(({ revision }) => revision),
    Array.from({ length: retained }, (_, index) => newest - retained + index + 1),
  );

  return ordered;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function fileHash(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    digest.update(chunk);
  }

  return digest.digest('hex');
}

async function verifiedFile(path) {
  assert((await lstat(path)).isFile(), 'Expected a regular synthetic file');
  assert.equal(await realpath(path), path);

  return { path, sha256: await fileHash(path) };
}

async function assertStopped(dataRoot) {
  const record = await verifiedFile(join(dataRoot, 'service.json'));
  const { pid } = await readJson(record.path);
  assert(Number.isSafeInteger(pid) && pid > 0, 'Invalid synthetic service record');
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'The seed service is running');
}

async function prepareSeed(path) {
  const witness = await readJson(path);
  const { tier, original, source, fixture } = witness;
  assert(['near', 'expanded'].includes(tier));
  assert.equal(witness.kind, 'full-history-archive-roundtrip');
  assert.equal(witness.archiveVerified, true);
  assert.equal(witness.storageComparison?.schema, 'v2');
  assert.equal(fixture.seedVersion, 'studio-capacity-v1');
  assert.deepEqual(fixture.profile, capacityProfiles[tier]);
  assert.equal(original.retainedVersions, retained);
  assert.equal(source.revision, original.revision);
  assert.equal(original.elements, fixture.profile.elements);
  assert.match(source.artifactId, /^[a-f0-9-]{36}$/u);
  assert.match(original.assetId, idPattern);
  const temp = await realpath(tmpdir());
  const output = await realpath(witness.output);
  const distance = relative(temp, output);
  assert(
    distance && !isAbsolute(distance) && !distance.startsWith('..') && !distance.includes(sep),
  );
  assert(basename(output).startsWith('luming-full-archive-' + tier + '-comparison-'));
  const dataRoot = join(output, 'data');
  assert.equal(await realpath(witness.dataRoot), dataRoot);
  await assertStopped(dataRoot);

  const location = join(dataRoot, 'artifact-generations', source.artifactId);
  const pointer = await verifiedFile(join(location, 'active.json'));
  const active = await readJson(pointer.path);
  assert.match(active.generation, /^g-[a-zA-Z0-9_-]+$/u);
  const prepared = await verifiedFile(join(location, active.generation, 'prepared.json'));
  assert.deepEqual(await readJson(prepared.path), active);
  const current = join(dirname(prepared.path), 'current');
  assert.equal(await realpath(current), current);
  const entries = await readdir(current);
  assert(
    !entries.some((entry) => /^artifact\.sqlite-(?:journal|wal|shm)$/u.test(entry)),
    'Source database has SQLite sidecar files',
  );
  assert.deepEqual(await readdir(join(current, 'assets')), [original.assetId]);
  assert(!entries.includes('recycle-assets'), 'Use the original single-asset synthetic fixture');
  const database = await verifiedFile(join(current, 'artifact.sqlite'));
  const asset = await verifiedFile(join(current, 'assets', original.assetId));
  assert.equal(asset.sha256, original.assetSha256);

  return { tier, fixture, source, original, asset, database, pointer, prepared };
}

async function copySeed(seed, dataRoot) {
  const folder = join(dataRoot, 'artifacts', seed.source.artifactId);
  const assets = join(folder, 'assets');
  await mkdir(assets, { recursive: true });
  const database = join(folder, 'artifact.sqlite');
  const asset = join(assets, seed.original.assetId);
  await Promise.all([copyFile(seed.database.path, database), copyFile(seed.asset.path, asset)]);
  assert.equal(await fileHash(database), seed.database.sha256);
  assert.equal(await fileHash(asset), seed.asset.sha256);

  return database;
}

function checkpoints(database) {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout=300');
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);

    return db
      .prepare(`SELECT checkpoint.revision FROM history_checkpoints AS checkpoint
        WHERE NOT EXISTS (
          SELECT 1 FROM storage_meta WHERE key='history_checkpoint_work'
            AND json_extract(value,'$.phase') IN ('copy','replay')
            AND json_extract(value,'$.revision')=checkpoint.revision
        ) ORDER BY checkpoint.revision`)
      .all()
      .map(({ revision }) => Number(revision));
  } finally {
    db.close();
  }
}

async function observeTurnover(database, before) {
  for (let attempt = 0; attempt < checkpointPollLimit; attempt++) {
    const after = checkpoints(database);
    const event = anchorTurnover(before, after);
    const entries = await readdir(dirname(database));
    if (
      event.created.length &&
      event.retired.length &&
      !entries.includes('artifact.sqlite-journal')
    ) {
      return { before, after, ...event };
    }

    await delay(100);
  }

  throw new Error('The sample window did not finish checkpoint creation and retirement');
}

function canonical(value) {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }

  return value;
}

function digest(value) {
  return sha256(JSON.stringify(canonical(value)));
}

function boardDigest(board) {
  const { artifact, ...content } = board;

  return sha256(
    JSON.stringify(canonical(content)).replaceAll(
      '/assets/' + artifact.id + '/',
      '/assets/archive-namespace/',
    ),
  );
}

function read(tool, seed, mode, options = {}) {
  return tool('artifact_read', { artifactId: seed.source.artifactId, mode, ...options });
}

function errorDetails(error) {
  return {
    code: error.code ?? error.name,
    message: error.message,
    ...(error.status === undefined ? {} : { httpStatus: error.status }),
  };
}

async function save({ request }, state, write, index, samples) {
  const { marker, artifactId, revision } = state;
  const operationId = 'v2-head-pair-' + index;
  const body = JSON.stringify({
    artifactId,
    expectedVersions: { [marker.id]: marker.version },
    operationId,
    merge: 'safe',
    receiptFormat: 'units-v1',
    operations: [{ op: 'update', id: marker.id, changes: write.changes }],
  });
  const started = performance.now();
  try {
    const response = await request('/api/tools/artifact_apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    const raw = await response.text();
    const { ok, data } = JSON.parse(raw);
    const ms = performance.now() - started;
    assert.equal(ok, true);
    assert.equal(data.receiptFormat, 'units-v1');
    assert.equal(data.operationId, operationId);
    assert.equal(data.baseRevision, revision);
    assert.equal(data.artifact.id, artifactId);
    assert.equal(data.artifact.revision, revision + 1);
    assert.equal(data.historyEntry.revision, revision + 1);
    assert.deepEqual(data.historyEntry.changedIds, [marker.id]);
    const expected = { ...marker, ...write.changes, version: marker.version + 1 };
    assert.deepEqual(data.units, [{ id: marker.id, after: expected }]);
    state.expected.set(revision + 1, { marker: expected, historyId: data.historyEntry.id });
    state.marker = expected;
    state.revision++;
    samples.push({
      kind: write.kind,
      status: 'ok',
      ms,
      revision: state.revision,
      requestBytes: Buffer.byteLength(body),
      responseBytes: Buffer.byteLength(raw),
    });
  } catch (error) {
    const timeout = error.code === 23 || error.name === 'TimeoutError';
    samples.push({
      kind: write.kind,
      status: timeout ? 'timeout' : 'failure',
      ...errorDetails(error),
    });

    throw error;
  }
}

async function exercise(api, seed, samples, perKind) {
  assert.equal(api.session.pluginVersion, '0.3.0');
  const board = await read(api.tool, seed, 'board');
  assert.equal(board.artifact.revision, seed.source.revision);
  assert.equal(board.elements.length, seed.original.elements);
  assert.equal(boardDigest(board), seed.original.sha256);
  const { history } = await read(api.tool, seed, 'history');
  retainedHistory(history, board.artifact.revision);
  const marker = board.elements.findLast(({ type }) => type === 'text');
  assert(Number.isFinite(marker?.x) && Number.isFinite(marker?.y));
  assert(Number.isSafeInteger(marker.version));
  const state = {
    artifactId: board.artifact.id,
    revision: board.artifact.revision,
    marker,
    expected: new Map(),
  };
  const writes = ordinaryWrites(marker, perKind);
  for (const [index, write] of writes.entries()) {
    await save(api, state, write, index + 1, samples);
  }

  return { ...state, initial: board };
}

async function verifyRetained(api, seed, state, anchors) {
  const { tool, request } = api;
  const { history } = await read(tool, seed, 'history');
  const ordered = retainedHistory(history, state.revision);
  const units = [];
  for (const entry of ordered) {
    const at = await read(tool, seed, 'units', {
      atRevision: entry.revision,
      ids: [state.marker.id],
    });
    assert.equal(at.artifact.revision, entry.revision);
    assert.equal(at.units.length, 1);
    const [unit] = at.units;
    assert.equal(unit.id, state.marker.id);
    const expected = state.expected.get(entry.revision);
    if (expected) {
      assert.equal(entry.id, expected.historyId);
      assert.deepEqual(unit.after, expected.marker);
    }
    units.push({ revision: entry.revision, sha256: digest(unit.after) });
  }

  const sampled = new Set([
    ordered[0].revision,
    seed.source.revision + 20,
    seed.source.revision + 40,
    ...anchors.created,
    state.revision,
  ]);
  const boards = [];
  for (const entry of ordered.filter(({ revision }) => sampled.has(revision))) {
    const { board } = await read(tool, seed, 'version', { versionId: entry.id });
    assert.equal(board.artifact.revision, entry.revision);
    assert.equal(board.elements.length, seed.original.elements);
    boards.push({ revision: entry.revision, sha256: boardDigest(board) });
  }
  const current = await read(tool, seed, 'board');
  assert.equal(current.artifact.revision, state.revision);
  const expected = {
    ...state.initial,
    elements: state.initial.elements.map((unit) =>
      unit.id === state.marker.id ? state.marker : unit,
    ),
  };
  assert.equal(boardDigest(current), boardDigest(expected));
  const asset = await request('/assets/' + seed.source.artifactId + '/' + seed.original.assetId);
  assert.equal(sha256(Buffer.from(await asset.arrayBuffer())), seed.asset.sha256);

  return { revision: state.revision, headSha256: boardDigest(current), units, boards };
}

async function runArm(role, witnessPath, seed, parent, perKind) {
  const dir = join(parent, role);
  const dataRoot = join(dir, 'data');
  const arm = { role, dataRoot, samples: [] };
  try {
    const witness = await readJson(witnessPath);
    const original = await verifyRuntime(witness.directory, witnessPath);
    const runtimeDir = join(dir, 'runtime');
    await mkdir(runtimeDir, { recursive: true });
    for (const { file } of original.files) {
      await copyFile(join(original.directory, file), join(runtimeDir, file));
    }
    const runtime = await verifyRuntime(runtimeDir, witnessPath);
    arm.runtime = runtime.files;
    const db = await copySeed(seed, dataRoot);
    const before = checkpoints(db);
    const state = await runTemporaryServer(runtime, dataRoot, async (api) => {
      const result = await exercise(api, seed, arm.samples, perKind);
      arm.turnoverDuringSaves = anchorTurnover(before, checkpoints(db));
      arm.anchors = await observeTurnover(db, before);

      return result;
    });
    arm.persisted = await runTemporaryServer(runtime, dataRoot, (api) =>
      verifyRetained(api, seed, state, arm.anchors),
    );
    await verifyRuntime(runtimeDir, witnessPath);
    await verifyRuntime(original.directory, witnessPath);
  } catch (error) {
    arm.failure = errorDetails(error);
  }
  arm.timing = Object.fromEntries(
    kinds.map((kind) => [
      kind,
      summarizeTiming(arm.samples.filter((sample) => sample.kind === kind)),
    ]),
  );

  return arm;
}

function compareArms(baseline, candidate, expectedSamples) {
  assert(!baseline.failure && !candidate.failure, 'An arm failed before completing verification');
  assert.notDeepEqual(baseline.runtime, candidate.runtime, 'Both arms used the same runtime');
  for (const arm of [baseline, candidate]) {
    for (const kind of kinds) {
      assert.equal(arm.timing[kind].samples, expectedSamples);
    }
  }
  assert.equal(baseline.persisted.revision, candidate.persisted.revision);
  assert.equal(baseline.persisted.headSha256, candidate.persisted.headSha256);
  assert.deepEqual(baseline.persisted.units, candidate.persisted.units);
  const candidateBoards = new Map(
    candidate.persisted.boards.map(({ revision, sha256 }) => [revision, sha256]),
  );

  for (const { revision, sha256 } of baseline.persisted.boards) {
    const peer = candidateBoards.get(revision);
    if (peer !== undefined) {
      assert.equal(sha256, peer, 'A shared full-board witness differs');
    }
  }
}

async function run(baseline, candidate, witness, perKind) {
  assert(
    [baseline, candidate, witness].every((path) => path && isAbsolute(path)),
    'Use absolute witness JSON paths',
  );
  const temp = await realpath(tmpdir());
  const locker = join(temp, 'luming-studio-v2-paired-timing.lock');
  const lock = await open(locker, 'wx', 0o600);
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid }));
    const output = await mkdtemp(join(temp, 'luming-v2-head-pair-'));
    const path = join(output, 'paired-comparison.json');
    const report = {
      scope: 'Serial isolated local product HTTP diagnostic. E-02 uses the real host and LAN.',
      requestContract: 'Single-owner units-v1 HTTP update, expectedVersions and merge:safe',
      releaseEligible: false,
      platform: process.platform,
      requestedSamplesPerKind: perKind,
      arms: [],
      pairVerified: false,
    };

    try {
      const seed = await prepareSeed(witness);
      report.seed = seed;
      report.arms.push(await runArm('baseline', baseline, seed, output, perKind));
      report.arms.push(await runArm('candidate', candidate, seed, output, perKind));
      for (const entry of [seed.database, seed.asset, seed.pointer, seed.prepared]) {
        assert.equal(await fileHash(entry.path), entry.sha256, 'A source seed file changed');
      }
      report.sourceBytesUnchanged = true;
      compareArms(...report.arms, perKind);
      report.pairVerified = true;
    } catch (error) {
      report.failure = errorDetails(error);
      process.exitCode = 2;
    } finally {
      await writeFile(path, JSON.stringify(report, null, 2) + '\n');
      console.log(
        JSON.stringify({ report: path, verified: report.pairVerified, failure: report.failure }),
      );
    }
  } finally {
    try {
      await lock.close();
    } finally {
      await unlink(locker);
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [baseline, candidate, witness, count = '30'] = process.argv.slice(2);
  const perKind = Number(count);
  ordinaryWrites({ x: 0, y: 0 }, perKind);
  await run(baseline, candidate, witness, perKind);
}
