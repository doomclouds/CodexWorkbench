import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { capacityProfiles } from './capacity-fixtures.mjs';
import {
  fingerprintRuntime,
  runTemporaryServer,
  sha256,
  verifyRuntime,
} from './runtime-fingerprint.mjs';

const [runtimeDirectory, fingerprintPath, oldWitnessPath, archiveWitnessPath] =
  process.argv.slice(2);
const maxOldBytes = 8 * 1024 * 1024;
const retainedLimit = 200;
const oldCommit = '059d55feacc7c22e1a17030520b1cd6d993669a6';
const oldServerSha256 = '527bf3b1796ef3b5ccab664172f76a5ea7b3c4c7180c4b4961b3d3e91e577972';
const oldText = '0.2.21 committed to the heavy fixture';
const tempRoot = await realpath(tmpdir());
const output = await mkdtemp(join(tempRoot, 'luming-heavy-rollback-'));
const dataRoot = join(output, 'data');
const evidence = {
  kind: 'heavy-board-packaged-nminus1',
  outcome: 'incomplete',
  releaseEligible: false,
  output,
  dataRoot,
  steps: [],
};

function inside(parent, target) {
  const distance = relative(parent, target);
  return distance && distance !== '..' && !distance.startsWith('..' + sep) && !isAbsolute(distance);
}

async function readTemporaryWitness(input, expectedName) {
  assert(input && isAbsolute(input), 'Supply an absolute synthetic witness path');
  const file = await realpath(input);
  assert(inside(tempRoot, file) && basename(file) === expectedName);
  return { file, parent: dirname(file), data: JSON.parse(await readFile(file, 'utf8')) };
}

async function knownPreviousRuntime() {
  const { file, parent, data } = await readTemporaryWitness(
    oldWitnessPath,
    'old-runtime-fixture.json',
  );
  assert(basename(parent).startsWith('studio-nminus1-059d55f-'));
  assert.equal(data.commit, oldCommit);
  assert.equal(data.pluginVersion, '0.2.21');
  const runtime = await fingerprintRuntime(join(parent, 'old-runtime'));
  assert(inside(parent, runtime.directory));
  assert.deepEqual(runtime.files, data.artifacts);
  assert.equal(runtime.files.find(({ file }) => file === 'server.mjs').sha256, oldServerSha256);
  return { ...runtime, witness: file, commit: data.commit };
}

async function missingIsNull(work) {
  try {
    return await work();
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

async function checkStopped(directory) {
  const raw = await missingIsNull(() => readFile(join(directory, 'service.json'), 'utf8'));
  if (!raw) {
    return;
  }

  const { pid } = JSON.parse(raw);
  assert(Number.isSafeInteger(pid) && pid > 0, 'Invalid synthetic service record');
  assert.throws(
    () => process.kill(pid, 0),
    { code: 'ESRCH' },
    'The synthetic service still exists',
  );
}

async function checkNoJournals(database) {
  for (const suffix of ['-journal', '-wal', '-shm']) {
    assert.equal(
      await missingIsNull(() => lstat(database + suffix)),
      null,
      'An SQLite sidecar is still present',
    );
  }
}

async function fileHash(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) {
    digest.update(chunk);
  }
  return digest.digest('hex');
}

async function verifyFixture(runtime) {
  const { file, parent, data } = await readTemporaryWitness(
    archiveWitnessPath,
    'full-history-archive-witness.json',
  );
  const { tier, original } = data;
  assert(
    tier === 'near' || tier === 'expanded',
    'The archive witness must describe a heavy fixture',
  );
  assert(basename(parent).startsWith('luming-full-archive-' + tier + '-'));
  assert.equal(data.kind, 'full-history-archive-roundtrip');
  assert.equal(await realpath(data.output), parent);
  assert.equal(data.packagedVersion, '0.3.0');
  assert.deepEqual(
    data.runtime.files,
    runtime.files,
    'Fixture and first runtime are from different packages',
  );
  assert.equal(data.expectedSaves, retainedLimit);
  assert.equal(data.repeatedHtml.unchangedAcrossSaves, retainedLimit);
  assert.equal(original.retainedVersions, retainedLimit);
  assert.equal(original.elements, capacityProfiles[tier].elements);
  assert(
    tier === 'expanded' ? original.contentBytes > maxOldBytes : original.contentBytes < maxOldBytes,
  );
  const { artifactId } = data.source;
  assert.match(artifactId, /^[a-f0-9-]{36}$/u);
  assert.equal(data.source.revision, original.revision);
  assert.match(original.assetId, /^[-.\w]+$/u);
  assert.match(original.feedbackId, /^[-.\w]+$/u);
  const seedRoot = await realpath(data.dataRoot);
  assert.equal(seedRoot, join(parent, 'data'));
  await checkStopped(seedRoot);
  const artifact = join(seedRoot, 'artifacts', artifactId);
  assert.equal(
    await realpath(artifact),
    artifact,
    'The synthetic artifact directory is redirected',
  );
  const database = join(artifact, 'artifact.sqlite');
  assert((await lstat(database)).isFile());
  await checkNoJournals(database);
  evidence.fixture = {
    witness: file,
    tier,
    artifactId,
    archiveVerified: data.archiveVerified === true,
    archiveFailure: data.failure,
    sourceRevision: original.revision,
    databaseSha256: await fileHash(database),
  };

  return { data, artifact, database, seedRoot, original, artifactId, tier };
}

async function copyAssets(seed, target, collection) {
  const source = join(seed, collection);
  const info = await missingIsNull(() => lstat(source));
  if (!info) {
    return [];
  }

  assert(info.isDirectory());
  assert.equal(await realpath(source), source);
  const directory = join(target, collection);
  await mkdir(directory);
  const files = [];
  for (const name of (await readdir(source)).sort()) {
    const entry = join(source, name);
    const outputFile = join(directory, name);
    assert((await lstat(entry)).isFile(), 'Unexpected synthetic resource entry: ' + name);
    const sha256 = await fileHash(entry);
    await copyFile(entry, outputFile);
    assert.equal(await fileHash(outputFile), sha256, name);
    files.push({ path: collection + '/' + name, sha256 });
  }
  return files;
}

async function copyFixture(fixture) {
  const directory = join(dataRoot, 'artifacts', fixture.artifactId);
  await mkdir(directory, { recursive: true });
  const database = join(directory, 'artifact.sqlite');
  await copyFile(fixture.database, database);
  assert.equal(await fileHash(database), evidence.fixture.databaseSha256);
  await checkNoJournals(fixture.database);
  assert.equal(
    await fileHash(fixture.database),
    evidence.fixture.databaseSha256,
    'The source changed during copy',
  );
  evidence.assetsCopied = [
    ...(await copyAssets(fixture.artifact, directory, 'assets')),
    ...(await copyAssets(fixture.artifact, directory, 'recycle-assets')),
  ];

  return database;
}

function rowFingerprint(db, query, parameters) {
  const digest = createHash('sha256');
  let rows = 0;
  for (const row of db.prepare(query).iterate(...parameters)) {
    digest.update(JSON.stringify(row) + '\n');
    rows++;
  }
  return { rows, sha256: digest.digest('hex') };
}

const historyReferences = `WITH RECURSIVE kept(hash) AS (
  SELECT DISTINCT content_hash FROM history_versions WHERE revision BETWEEN ? AND ?
), reachable(hash) AS (
  SELECT payload_hash FROM content_payloads INNER JOIN kept ON manifest_hash = kept.hash
  UNION SELECT child_hash FROM payload_links INNER JOIN reachable ON parent_hash = reachable.hash
) `;

function retainedProjection(db, range) {
  const query = (suffix) => rowFingerprint(db, historyReferences + suffix, range);
  return {
    manifests: query(
      'SELECT kept.hash,m.json FROM kept LEFT JOIN content_manifests m ON kept.hash=m.hash ORDER BY kept.hash',
    ),
    manifestLinks: query(
      'SELECT m.manifest_hash,m.payload_hash FROM kept JOIN content_payloads m ON kept.hash=m.manifest_hash ORDER BY m.manifest_hash,m.payload_hash',
    ),
    payloads: query(
      'SELECT reachable.hash,p.json FROM reachable LEFT JOIN payload_blobs p ON reachable.hash=p.hash ORDER BY reachable.hash',
    ),
    links: query(
      'SELECT parent_hash,child_hash FROM reachable JOIN payload_links ON reachable.hash=parent_hash ORDER BY parent_hash,child_hash',
    ),
  };
}

function inspectDatabase(database, range, trimOldest) {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
    const history = db
      .prepare(
        'SELECT revision,id,content_hash,entry_json,artifact_json FROM history_versions ORDER BY revision',
      )
      .all();
    const start = history[trimOldest ? 1 : 0]?.revision;
    assert(Number.isSafeInteger(start));
    const interval = range ?? [start, history.at(-1).revision];
    const linked = db
      .prepare(
        "SELECT collection,id,payload_hash FROM state_records WHERE collection IN ('assets','feedback','sources') ORDER BY collection,id",
      )
      .all();

    return { history, interval, allPreservedPayloads: retainedProjection(db, interval), linked };
  } finally {
    db.close();
  }
}

function canonical(value, assetPrefix) {
  if (typeof value === 'string') {
    return value.replaceAll(assetPrefix, '/assets/archive-namespace/');
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonical(item, assetPrefix));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key], assetPrefix)]),
    );
  }

  return value;
}

function fingerprintBoard(board, expectedId, markerId) {
  const { artifact, ...content } = board;
  assert.equal(artifact.id, expectedId);
  if (markerId) {
    content.elements = content.elements.map((element) =>
      element.id === markerId ? { ...element, text: '', version: 0 } : element,
    );
  }
  return sha256(JSON.stringify(canonical(content, '/assets/' + expectedId + '/')));
}

function describeFailure(error) {
  return error instanceof Error
    ? { code: error.code || error.name, status: error.status, message: error.message }
    : { code: 'FAILURE', message: String(error) };
}

async function step(name, work) {
  const began = performance.now();
  try {
    const value = await work();
    evidence.steps.push({ name, code: 'OK', durationMs: performance.now() - began });
    return value;
  } catch (error) {
    evidence.steps.push({
      name,
      error: describeFailure(error),
      durationMs: performance.now() - began,
    });

    throw error;
  }
}

function withRuntime(runtime, version, work) {
  return runTemporaryServer(runtime, dataRoot, async (service) => {
    assert.equal(service.session.pluginVersion, version);
    return work(service);
  });
}

function isOldStartupCapacityError(error, runtime) {
  const pinned =
    runtime.commit === oldCommit &&
    runtime.files.some(({ file, sha256 }) => file === 'server.mjs' && sha256 === oldServerSha256);

  if (!pinned || !(error instanceof Error)) {
    return false;
  }

  const cause = error.cause;
  const exitedBeforeReadiness =
    cause instanceof Error && cause.message === 'Temporary packaged server exited before readiness';

  if (!exitedBeforeReadiness) {
    return false;
  }

  const executable = pathToFileURL(join(runtime.directory, 'server.mjs')).href;
  const lines = error.message.split(/\r?\n/u).map((line) => line.trim());
  const stack = [
    'SqliteArtifactRepository.readState',
    'async StudioService.resetSharingSessions',
    'async startStudioHost',
  ];
  const reportedCapacity =
    lines.includes('StudioError: 作品数据库超过读取容量。') && lines.includes("code: 'TOO_LARGE',");
  const startupStack = stack.every((frame) =>
    lines.some((line) => line.startsWith(`at ${frame} (${executable}:`)),
  );

  return reportedCapacity && startupStack;
}

async function withPreviousRuntime(runtime, expanded, work) {
  let ready = false;
  try {
    return await withRuntime(runtime, '0.2.21', (service) => {
      ready = true;
      return work(service);
    });
  } catch (error) {
    const startupFailure = expanded && !ready;
    if (!startupFailure || !isOldStartupCapacityError(error, runtime)) {
      throw error;
    }

    return {
      startup: {
        outcome: 'rejected',
        phase: 'before-readiness',
        code: 'TOO_LARGE',
        message: error.message,
      },
      read: { attempted: false },
      write: { attempted: false },
    };
  }
}

async function capacityRejection(work) {
  try {
    await work();
  } catch (error) {
    assert.equal(error.code, 'TOO_LARGE', error.message);
    return describeFailure(error);
  }
  throw new Error('The old runtime accepted content outside its capacity');
}

async function getSavedState(service, fixture, expectedRevision) {
  const { artifactId, original } = fixture;
  const board = await service.tool('artifact_read', { artifactId, mode: 'board' });
  assert.equal(board.artifact.revision, expectedRevision);
  assert.equal(board.elements.length, original.elements);
  const path =
    '/assets/' + encodeURIComponent(artifactId) + '/' + encodeURIComponent(original.assetId);
  const bytes = Buffer.from(await (await service.request(path)).arrayBuffer());
  assert.equal(sha256(bytes), original.assetSha256);
  const { feedback } = await service.tool('artifact_read', {
    artifactId,
    mode: 'context',
    feedbackId: original.feedbackId,
  });
  assert.equal(feedback.id, original.feedbackId);
  const frozen = await service.tool('artifact_read', {
    artifactId,
    mode: 'source',
    feedbackId: original.feedbackId,
  });
  assert.equal(frozen.artifactId, artifactId);
  assert(frozen.html.includes('Frozen source before editing') && frozen.html.includes(path));
  const { history } = await service.tool('artifact_read', { artifactId, mode: 'history' });
  return { board, history, feedback, frozenSha256: sha256(frozen.html) };
}

async function crossOldLimits(service, fixture, board) {
  const { artifactId, original } = fixture;
  const apply = (operationId, operation) =>
    service.tool('artifact_apply', {
      artifactId,
      operationId,
      expectedRevision: original.revision,
      operations: [operation],
    });
  const count = await capacityRejection(() =>
    apply('heavy-old-capacity-count', {
      op: 'add',
      element: { id: 'heavy-old-extra-item', type: 'text', x: 0, y: 0, w: 200, h: 100 },
    }),
  );
  const { artifact, ...content } = board;
  assert.equal(artifact.id, artifactId);
  const bytes = Buffer.byteLength(JSON.stringify(content));
  const amount = maxOldBytes - bytes + 1;
  assert(amount > 0, 'The near fixture must start inside the old byte limit');
  const region = board.elements.find(
    (element) =>
      element.type === 'html' &&
      typeof element.html === 'string' &&
      element.html.length + amount <= 2 * 1024 * 1024,
  );
  assert(region, 'No HTML region can safely cross the old whole-board byte boundary');
  const grown = await capacityRejection(() =>
    apply('heavy-old-capacity-bytes', {
      op: 'update',
      id: region.id,
      changes: { html: region.html + ' '.repeat(amount) },
    }),
  );

  return {
    elements: { tested: board.elements.length + 1, ...count },
    bytes: { tested: bytes + amount, ...grown },
  };
}

async function checkVersionSamples(service, fixture, rows) {
  const selected = [rows[0], rows[Math.floor(rows.length / 2)], rows.at(-1)];
  const samples = [];
  for (const row of selected) {
    const { board } = await service.tool('artifact_read', {
      artifactId: fixture.artifactId,
      mode: 'version',
      versionId: row.id,
    });
    assert.equal(board.artifact.revision, row.revision);
    const id = fixture.artifactId;
    const sha256 = fingerprintBoard(board, id);
    const measured = fixture.data.verifiedHistory?.find((item) => item.id === row.id);
    if (measured) {
      assert.equal(
        sha256,
        measured.sha256,
        'History fingerprint differs from the full-archive witness',
      );
    }
    samples.push({ id: row.id, revision: row.revision, sha256 });
  }
  return samples;
}

async function nextVersion(runtime, old, fixture, database) {
  const { artifactId, original, tier } = fixture;
  const expanded = tier === 'expanded';
  const initial = inspectDatabase(database, undefined, !expanded);
  assert.equal(initial.history.length, retainedLimit);
  assert.equal(initial.history.at(-1).revision, original.revision);
  const preserved = expanded ? initial.history : initial.history.slice(1);
  const baseline = await step('N-read-closed-fixture', () =>
    withRuntime(runtime, '0.3.0', async (service) => {
      const state = await getSavedState(service, fixture, original.revision);
      const { board, feedback, frozenSha256 } = state;
      assert.equal(fingerprintBoard(board, artifactId), original.sha256);
      const marker = board.elements.find(
        (element) => element.type === 'text' && element.text === 'Durable archive marker #200',
      );
      assert(marker, 'The persisted heavy-fixture marker is missing');
      assert.equal(state.history.length, retainedLimit);
      const versions = await checkVersionSamples(service, fixture, preserved);
      return {
        marker,
        feedback,
        frozenSha256,
        versions,
        preservedBoard: fingerprintBoard(board, artifactId, marker.id),
      };
    }),
  );

  const beforeOldDatabase = expanded ? await fileHash(database) : undefined;
  const oldResult = await step('N-1-capacity-and-same-library', () =>
    withPreviousRuntime(old, expanded, async (service) => {
      const read = () => service.tool('artifact_read', { artifactId, mode: 'board' });
      const write = () =>
        service.tool('artifact_apply', {
          artifactId,
          operationId: 'heavy-nminus1-marker',
          expectedRevision: original.revision,
          expectedVersions: { [baseline.marker.id]: baseline.marker.version },
          operations: [{ op: 'update', id: baseline.marker.id, changes: { text: oldText } }],
        });

      if (expanded) {
        return { read: await capacityRejection(read), write: await capacityRejection(write) };
      }

      const { board, history, feedback, frozenSha256 } = await getSavedState(
        service,
        fixture,
        original.revision,
      );
      assert.equal(history.length, retainedLimit);
      assert.deepEqual(feedback, baseline.feedback);
      assert.equal(frozenSha256, baseline.frozenSha256);
      assert.equal(fingerprintBoard(board, artifactId), original.sha256);
      const oldVersions = await checkVersionSamples(service, fixture, preserved);
      assert.deepEqual(oldVersions, baseline.versions);
      const limits = await crossOldLimits(service, fixture, board);
      assert.equal((await read()).artifact.revision, original.revision);
      const saved = await write();
      assert.equal(saved.board.artifact.revision, original.revision + 1);
      return {
        readRevision: original.revision,
        writeRevision: saved.board.artifact.revision,
        historyId: saved.historyEntry.id,
        limits,
      };
    }),
  );
  evidence.Nminus1 = oldResult;
  if (expanded) {
    const afterOldDatabase = await fileHash(database);
    assert.equal(
      afterOldDatabase,
      beforeOldDatabase,
      'Rejected old access changed the copied SQLite bytes',
    );
    evidence.rejectedDatabaseSha256 = afterOldDatabase;
  }

  const reopenedRevision = expanded ? original.revision : original.revision + 1;
  const after = inspectDatabase(database, initial.interval, false);
  assert.deepEqual(
    after.history.filter((entry) => entry.revision <= original.revision),
    preserved,
  );
  assert.equal(after.history.length, retainedLimit);
  assert.equal(after.history.at(-1).revision, reopenedRevision);
  if (!expanded) {
    assert.equal(after.history.at(-1).id, oldResult.historyId);
    evidence.normalRetentionEviction = {
      id: initial.history[0].id,
      revision: initial.history[0].revision,
    };
  }
  assert.deepEqual(after.allPreservedPayloads, initial.allPreservedPayloads);
  assert.deepEqual(after.linked, initial.linked);
  evidence.history = {
    retained: after.history.length,
    preserved: preserved.length,
    interval: initial.interval,
    payloadClosure: after.allPreservedPayloads,
  };

  evidence.reopened = await step('N-reopen-same-library', () =>
    withRuntime(runtime, '0.3.0', async (service) => {
      const { board, history, feedback, frozenSha256 } = await getSavedState(
        service,
        fixture,
        reopenedRevision,
      );
      assert.equal(history.length, retainedLimit);
      assert.deepEqual(feedback, baseline.feedback);
      assert.equal(frozenSha256, baseline.frozenSha256);
      const marker = board.elements.find((element) => element.id === baseline.marker.id);
      assert.deepEqual(
        marker,
        expanded
          ? baseline.marker
          : { ...baseline.marker, text: oldText, version: baseline.marker.version + 1 },
      );
      assert.equal(fingerprintBoard(board, artifactId, marker.id), baseline.preservedBoard);
      const versions = await checkVersionSamples(service, fixture, preserved);
      assert.deepEqual(versions, baseline.versions);
      return {
        revision: board.artifact.revision,
        markerId: marker.id,
        markerVersion: marker.version,
        versions,
        assetSha256: original.assetSha256,
        frozenSha256,
      };
    }),
  );

  if (expanded) {
    evidence.recoveryPath = 'preserve-current-library-and-fix-forward';
  }

  return expanded ? 'rejected' : 'qualify';
}

let fixture;
try {
  const runtime = await step('verify-frozen-N', () =>
    verifyRuntime(runtimeDirectory, fingerprintPath),
  );
  const old = await step('verify-frozen-N-minus-1', knownPreviousRuntime);
  evidence.runtimes = { N: runtime, Nminus1: old };
  fixture = await step('verify-closed-synthetic-source', () => verifyFixture(runtime));
  const database = await step('copy-one-synthetic-artifact', () => copyFixture(fixture));
  const outcome = await nextVersion(runtime, old, fixture, database);
  await step('recheck-runtimes-and-original-source', async () => {
    await verifyRuntime(runtimeDirectory, fingerprintPath);
    assert.deepEqual((await fingerprintRuntime(old.directory)).files, old.files);
    await checkStopped(fixture.seedRoot);
    assert.equal(await fileHash(fixture.database), evidence.fixture.databaseSha256);
    for (const asset of evidence.assetsCopied) {
      assert.equal(await fileHash(join(dirname(database), asset.path)), asset.sha256);
    }
  });
  evidence.outcome = outcome;
} catch (error) {
  evidence.failure = describeFailure(error);
  process.exitCode = 2;
} finally {
  if (fixture && evidence.failure) {
    try {
      evidence.originalDatabaseUnchanged =
        (await fileHash(fixture.database)) === evidence.fixture.databaseSha256;
    } catch (error) {
      evidence.originalRecheckError = describeFailure(error);
    }
  }
  const witness = join(output, 'heavy-nminus1-witness.json');
  await writeFile(witness, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ witness, outcome: evidence.outcome, error: evidence.failure }));
}
