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
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { unzipSync } from 'fflate';
import { capacityProfiles, makeCapacityFixture } from './capacity-fixtures.mjs';
import { runTemporaryServer, sha256, verifyRuntime } from './runtime-fingerprint.mjs';

const [runtimeDirectory, fingerprintPath, tier, previousWitness, timeoutArgument] =
  process.argv.slice(2);
const regularTimeoutMs = 60_000;
const maxRequestBytes = 9 * 1024 * 1024;
const maxOperations = 200;
const jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value));

if (!tier || !Object.hasOwn(capacityProfiles, tier)) {
  throw new Error(
    'Supply the frozen runtime directory, fingerprint JSON, and small, near, or expanded',
  );
}

const importTimeoutMs = previousWitness ? Number(timeoutArgument) : regularTimeoutMs;
if (previousWitness) {
  assert(isAbsolute(previousWitness), 'An absolute previous witness path is required');
  assert(
    Number.isSafeInteger(importTimeoutMs) &&
      importTimeoutMs > 0 &&
      importTimeoutMs <= 4_294_967_295,
    'A finite positive import replay timeout is required',
  );
}

const fixture = makeCapacityFixture(tier);
const saveCount = tier === 'small' ? 4 : fixture.profile.history;
const prefix = 'luming-full-archive-' + tier + (previousWitness ? '-replay-' : '-');
const output = await mkdtemp(join(tmpdir(), prefix));
const coordinates = { dataRoot: join(output, 'data'), packagedCopy: join(output, 'runtime') };
const samples = [];
const evidence = {
  kind: 'full-history-archive-roundtrip',
  scope: previousWitness
    ? 'Frozen product package, direct local HTTP restore of a prior archive and source copy'
    : 'Frozen product package, local HTTP, synthetic mixed board and real committed history',
  tier,
  expectedSaves: saveCount,
  fixture: { seedVersion: fixture.seedVersion, sha256: fixture.digest, profile: fixture.profile },
  output,
  ...coordinates,
  samples,
  archiveVerified: false,
};

function failure(error) {
  if (!(error instanceof Error)) {
    return { code: 'FAILURE', message: String(error) };
  }

  return {
    code: error.code || error.name,
    message: error.message,
    ...(error.status === undefined ? {} : { status: error.status }),
  };
}

async function measure(name, execute, details = {}) {
  const started = performance.now();
  try {
    const result = await execute();
    samples.push({ name, ...details, durationMs: performance.now() - started, code: 'OK' });
    return result;
  } catch (error) {
    samples.push({
      name,
      ...details,
      durationMs: performance.now() - started,
      error: failure(error),
    });

    throw error;
  }
}

function archivedMarkup(assetUrl, current) {
  const title = current ? 'Edited after the feedback was created' : 'Frozen source before editing';
  return `<article><img src="${assetUrl}"><h1>${title}</h1></article>`;
}

function archivedFixture(assetUrl) {
  const texts = fixture.content.elements.filter((element) => element.type === 'text');
  const sourceId = texts[0].id;
  const markerId = texts.at(-1).id;

  const operations = fixture.content.elements.map((element) => {
    const value = { ...element };
    if (value.type === 'image') {
      value.src = assetUrl;
    }
    if (value.id === sourceId) {
      delete value.text;
      value.type = 'html';
      value.html = archivedMarkup(assetUrl, false);
    }
    return { op: 'add', element: value };
  });

  return { sourceId, markerId, operations };
}

function splitApplyRequests(operations) {
  const payloadLimit = maxRequestBytes - 1024;
  const batches = [];
  let batch = [];
  let bytes = 0;
  for (const operation of operations) {
    const size = jsonBytes(operation) + 1;
    assert(size < payloadLimit, 'An individual operation exceeds the HTTP payload budget');
    if (batch.length === maxOperations || bytes + size > payloadLimit) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(operation);
    bytes += size;
  }
  if (batch.length) {
    batches.push(batch);
  }
  return batches;
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

function contentFingerprint(board, artifactId) {
  const { artifact, ...content } = board;
  assert.equal(artifact.id, artifactId);
  const canonicalJson = JSON.stringify(canonical(content, '/assets/' + artifactId + '/'));
  return sha256(canonicalJson);
}

function htmlPayloads(board) {
  return board.elements.flatMap((element) =>
    element.type === 'html' ? [[element.id, element.html]] : [],
  );
}

function assetPath(artifactId, assetId) {
  return `/assets/${encodeURIComponent(artifactId)}/${encodeURIComponent(assetId)}`;
}

async function uploadAsset(request, artifactId) {
  const asset = await (
    await request('/api/assets?artifactId=' + encodeURIComponent(artifactId), {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', 'X-Filename': 'archive-witness.png' },
      body: fixture.resourceData,
    })
  ).json();
  assert.equal(asset.url, assetPath(artifactId, asset.id));
  return asset;
}

async function apply(tool, state, operations, label) {
  const serial = state.requestNumber + 1;
  const args = {
    artifactId: state.artifactId,
    expectedRevision: state.revision,
    operationId: `archive-${tier}-${serial}`,
    operations,
  };
  const requestBytes = jsonBytes(args);
  assert(operations.length <= maxOperations && requestBytes <= maxRequestBytes);
  const result = await measure('apply:' + label, () => tool('artifact_apply', args), {
    operations: operations.length,
    requestBytes,
    expectedRevision: state.revision,
    operationId: args.operationId,
  });
  assert.equal(result.board.artifact.id, state.artifactId);
  assert.equal(
    result.board.artifact.revision,
    state.revision + 1,
    label + ' was not a distinct save',
  );
  assert.equal(result.historyEntry.revision, result.board.artifact.revision);
  state.revision = result.board.artifact.revision;
  state.requestNumber = serial;
  return result;
}

function read(tool, artifactId, mode, extra = {}) {
  return tool('artifact_read', { artifactId, mode, ...extra });
}

async function createSource(tool, request) {
  const created = await measure('create', () =>
    tool('artifact_manage', { action: 'create', title: 'Full archive witness ' + tier }),
  );
  const state = {
    artifactId: created.artifact.id,
    revision: created.artifact.revision,
    requestNumber: 0,
  };
  evidence.source = state;
  const asset = await measure('upload-asset', () => uploadAsset(request, state.artifactId));
  const { sourceId, markerId, operations: additions } = archivedFixture(asset.url);
  for (const [index, operations] of splitApplyRequests(additions).entries()) {
    await apply(tool, state, operations, 'seed-' + (index + 1));
  }

  const board = await measure('read-seeded-board', () => read(tool, state.artifactId, 'board'));
  const source = board.elements.find((element) => element.id === sourceId);
  assert.equal(source.html, archivedMarkup(asset.url, false));
  const { feedback } = await measure('create-frozen-feedback', () =>
    tool('artifact_feedback', {
      artifactId: state.artifactId,
      action: 'create',
      type: 'request',
      text: 'Retain the original referenced source',
      anchor: { regionId: sourceId, sourceRevision: source.sourceRevision },
    }),
  );
  const feedbackId = feedback[0].id;
  state.revision = (await read(tool, state.artifactId, 'board')).artifact.revision;
  const edited = await apply(
    tool,
    state,
    [{ op: 'update', id: sourceId, changes: { html: archivedMarkup(asset.url, true) } }],
    'edit-source-after-freezing',
  );

  return { state, asset, sourceId, markerId, feedbackId, sharedBodies: htmlPayloads(edited.board) };
}

async function saveVersions(tool, source) {
  const ledger = new Map();
  const { state, markerId, sharedBodies } = source;
  evidence.repeatedHtml = {
    regions: sharedBodies.length,
    bytesPerVersion: sharedBodies.reduce((total, [, html]) => total + Buffer.byteLength(html), 0),
    sha256: sha256(JSON.stringify(sharedBodies)),
    unchangedAcrossSaves: 0,
  };

  for (let i = 0; i < saveCount; i++) {
    const value = 'Durable archive marker #' + (i + 1);
    const result = await apply(
      tool,
      state,
      [{ op: 'update', id: markerId, changes: { text: value } }],
      'history-' + (i + 1),
    );
    assert.equal(result.board.elements.find((element) => element.id === markerId).text, value);
    assert.deepEqual(htmlPayloads(result.board), sharedBodies);
    evidence.repeatedHtml.unchangedAcrossSaves++;

    const { historyEntry, board } = result;
    ledger.set(historyEntry.id, {
      revision: historyEntry.revision,
      marker: value,
      sha256: contentFingerprint(board, state.artifactId),
    });
  }
  assert.equal(ledger.size, saveCount);
  assert.equal(new Set(Array.from(ledger.values(), (entry) => entry.sha256)).size, saveCount);
  return ledger;
}

async function verifyAsset(request, url, name) {
  const bytes = await measure('download-' + name + '-asset', async () =>
    Buffer.from(await (await request(url)).arrayBuffer()),
  );
  assert.deepEqual(bytes, fixture.resourceData, name + ' asset bytes do not match the upload');
}

async function checkOriginal(tool, request, source, ledger) {
  const id = source.state.artifactId;
  await verifyAsset(request, source.asset.url, 'original');
  const current = await measure('read-original-current', () => read(tool, id, 'board'));
  const frozen = await measure('read-original-frozen-source', () =>
    read(tool, id, 'source', { feedbackId: source.feedbackId }),
  );
  assert.equal(frozen.html, archivedMarkup(source.asset.url, false));
  const { history } = await measure('read-original-history-list', () => read(tool, id, 'history'));
  const historyIds = new Set(history.map((entry) => entry.id));
  assert.equal(historyIds.size, history.length);
  assert.equal(
    Array.from(ledger.keys()).every((entry) => historyIds.has(entry)),
    true,
  );

  if (tier !== 'small') {
    assert.equal(history.length, saveCount);
  }

  const { artifact, ...content } = current;
  const contentBytes = jsonBytes(content);
  assert.equal(current.elements.length, fixture.profile.elements);
  assert(
    Math.abs(contentBytes - fixture.profile.contentBytes) < 128 * 1024,
    'Mixed board size drift',
  );
  evidence.original = {
    revision: artifact.revision,
    elements: current.elements.length,
    contentBytes,
    sha256: contentFingerprint(current, id),
    retainedVersions: history.length,
    distinctMeasuredVersions: ledger.size,
    feedbackId: source.feedbackId,
    assetId: source.asset.id,
    assetSha256: sha256(fixture.resourceData),
  };

  return { history, currentSha256: evidence.original.sha256, revision: artifact.revision };
}

function zipEntries(archive) {
  const entries = [];
  unzipSync(archive, {
    filter({ name, size, originalSize }) {
      entries.push({ name, compressedBytes: size, expandedBytes: originalSize });
      return false;
    },
  });

  return entries;
}

async function exportArchive(tool, request, artifactId) {
  const exported = await measure('export-complete-archive', () =>
    tool('artifact_export', { artifactId, format: 'zip' }),
  );
  const path = exported.downloadPath;
  assert(path.startsWith('/') && !path.startsWith('//'), 'Expected a local product download route');
  const archive = await measure('download-archive', async () =>
    Buffer.from(await (await request(path)).arrayBuffer()),
  );
  assert.equal(archive.subarray(0, 2).toString(), 'PK');
  const archiveFile = join(output, tier + '-complete-history.studio.zip');
  await writeFile(archiveFile, archive);
  evidence.archive = { file: archiveFile, bytes: archive.length, sha256: sha256(archive) };
  const entries = zipEntries(archive);
  evidence.archive.entries = entries;
  evidence.archive.expandedBytes = entries.reduce((total, entry) => total + entry.expandedBytes, 0);

  return archive;
}

async function importCompletedArchive(request, archive, artifactId) {
  const imported = await measure(
    'import-complete-archive',
    async () =>
      (
        await request('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/zip' },
          body: archive,
          ...(previousWitness ? { signal: AbortSignal.timeout(importTimeoutMs) } : {}),
        })
      ).json(),
    { timeoutMs: importTimeoutMs },
  );
  assert.equal(imported.ok, true);
  const { artifact } = imported.data;
  assert.notEqual(artifact.id, artifactId);
  assert.equal(artifact.importedFrom?.artifactId, artifactId);
  evidence.restoredArtifactId = artifact.id;
  return artifact.id;
}

async function checkResourcesAndFeedback(tool, request, source, restoredId) {
  const sourceId = source.state.artifactId;
  const { asset, feedbackId } = source;
  const restoredUrl = assetPath(restoredId, asset.id);
  await verifyAsset(request, restoredUrl, 'restored');

  const original = await read(tool, sourceId, 'context', { feedbackId });
  const restored = await measure('read-restored-feedback', () =>
    read(tool, restoredId, 'context', { feedbackId }),
  );
  assert.equal(restored.feedback.artifactId, restoredId);
  assert.deepEqual(
    { ...restored.feedback, artifactId: sourceId },
    original.feedback,
    'The exported feedback was not reproduced',
  );
  const frozen = await measure('read-restored-frozen-source', () =>
    read(tool, restoredId, 'source', { feedbackId }),
  );
  assert.equal(frozen.artifactId, restoredId);
  assert.equal(frozen.html, archivedMarkup(restoredUrl, false));
  return restoredUrl;
}

async function checkHistory(tool, source, restoredId, history, ledger) {
  const sourceId = source.state.artifactId;
  const imported = await measure('read-restored-history-list', () =>
    read(tool, restoredId, 'history'),
  );
  assert.deepEqual(imported.history, history);
  evidence.verifiedHistory = [];

  for (const entry of history) {
    const saved = ledger.get(entry.id);
    const expected =
      saved ??
      (await measure(
        'read-original-version',
        async () => {
          const { board } = await read(tool, sourceId, 'version', { versionId: entry.id });
          return { revision: board.artifact.revision, sha256: contentFingerprint(board, sourceId) };
        },
        { versionId: entry.id },
      ));
    const { board } = await measure(
      'read-restored-version',
      () => read(tool, restoredId, 'version', { versionId: entry.id }),
      {
        versionId: entry.id,
        revision: entry.revision,
      },
    );
    const hash = contentFingerprint(board, restoredId);
    assert.equal(entry.revision, expected.revision);
    assert.equal(board.artifact.revision, expected.revision);
    assert.equal(hash, expected.sha256, 'Historical content changed for ' + entry.id);
    evidence.verifiedHistory.push({ id: entry.id, revision: entry.revision, sha256: hash });
  }
}

async function recoverSource(tool, previous) {
  const { source: state, original } = previous;
  const { artifactId } = state;
  const { assetId, feedbackId } = original;
  const { feedback } = await measure('read-source-copy-feedback', () =>
    read(tool, artifactId, 'context', { feedbackId }),
  );
  assert.equal(feedback.id, feedbackId);
  const sourceId = feedback.anchor.regionId;
  assert.equal(typeof sourceId, 'string');
  return {
    state,
    asset: { id: assetId, url: assetPath(artifactId, assetId) },
    sourceId,
    feedbackId,
  };
}

async function verifyRoundtrip({ tool, request, session }, replay) {
  evidence.packagedVersion = session.pluginVersion;
  assert.equal(session.pluginVersion, '0.3.0');
  const source = replay
    ? await recoverSource(tool, replay.previous)
    : await createSource(tool, request);
  const ledger = replay ? new Map() : await saveVersions(tool, source);
  const original = await checkOriginal(tool, request, source, ledger);
  if (replay) {
    assert.equal(original.currentSha256, replay.previous.original.sha256);
    assert.equal(original.revision, replay.previous.original.revision);
    assert.equal(original.history.length, replay.previous.original.retainedVersions);
    assert.equal(evidence.original.contentBytes, replay.previous.original.contentBytes);
  }

  const archive = replay?.archive ?? (await exportArchive(tool, request, source.state.artifactId));
  const restoredId = await importCompletedArchive(request, archive, source.state.artifactId);

  const restored = await measure('read-restored-current', () => read(tool, restoredId, 'board'));
  assert.equal(restored.artifact.revision, original.revision);
  assert.equal(contentFingerprint(restored, restoredId), original.currentSha256);
  const url = await checkResourcesAndFeedback(tool, request, source, restoredId);
  const images = restored.elements.filter((element) => element.type === 'image');
  assert.equal(images.length, fixture.profile.images);
  assert(images.every((element) => element.src === url));
  assert.equal(
    restored.elements.find((element) => element.id === source.sourceId).html,
    archivedMarkup(url, true),
  );
  await checkHistory(tool, source, restoredId, original.history, ledger);
  if (replay) {
    const distinct = new Set(evidence.verifiedHistory.map(({ sha256 }) => sha256)).size;
    assert(distinct >= saveCount, 'The retained source states are not distinct');
    evidence.original.distinctMeasuredVersions = distinct;
  }

  const old = await measure('read-original-after-restore', () =>
    read(tool, source.state.artifactId, 'board'),
  );
  assert.equal(old.artifact.revision, original.revision);
  assert.equal(contentFingerprint(old, source.state.artifactId), original.currentSha256);
}

async function copyFrozenRuntime() {
  const verified = await verifyRuntime(runtimeDirectory, fingerprintPath);
  evidence.runtime = verified;
  await mkdir(coordinates.packagedCopy);
  await mkdir(coordinates.dataRoot);
  for (const { file } of verified.files) {
    await copyFile(join(verified.directory, file), join(coordinates.packagedCopy, file));
  }
  return verifyRuntime(coordinates.packagedCopy, fingerprintPath);
}

async function requireRegularFile(path) {
  assert((await lstat(path)).isFile(), 'Expected a regular fixture file ' + path);
  assert.equal(await realpath(path), path, 'Fixture file resolves outside its declared path');
}

async function assertSourceStopped(dataRoot) {
  const path = join(dataRoot, 'service.json');
  await requireRegularFile(path);
  const { pid } = JSON.parse(await readFile(path, 'utf8'));
  assert(Number.isSafeInteger(pid) && pid > 0, 'Source service PID is unavailable');
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error.code === 'ESRCH') {
      return;
    }

    throw error;
  }
  throw new Error('The prior fixture service still has a live PID');
}

async function fileDigest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function copyVerifiedFile(source, destination) {
  await requireRegularFile(source);
  await copyFile(source, destination);
  const [before, after] = await Promise.all([fileDigest(source), fileDigest(destination)]);
  assert.equal(before, after, 'The isolated source copy did not preserve its bytes');
  return { source, copy: destination, sha256: after, bytes: (await lstat(destination)).size };
}

async function prepareReplay(runtime) {
  const beforeFile = await realpath(previousWitness);
  const beforeFolder = dirname(beforeFile);
  const place = relative(await realpath(tmpdir()), beforeFolder);
  assert(place && place !== '..' && !place.startsWith('..' + sep) && !isAbsolute(place));
  await requireRegularFile(beforeFile);
  const raw = await readFile(beforeFile, 'utf8');
  const previous = JSON.parse(raw);
  assert.equal(previous.kind, evidence.kind, 'Not a prior full archive probe witness');
  assert.equal(previous.tier, tier, 'The archive witness has a different profile');
  assert.equal(previous.expectedSaves, saveCount);
  assert.deepEqual(previous.fixture, evidence.fixture);
  assert.deepEqual(
    previous.runtime.files,
    runtime.files,
    'Replay runtime differs from the prior run',
  );
  assert.equal(previous.original.distinctMeasuredVersions, saveCount);

  const firstImport = previous.samples.find((sample) => sample.name === 'import-complete-archive');
  assert(firstImport, 'The previous probe never reached archive import');
  evidence.replay = {
    previousWitness: beforeFile,
    previousWitnessSha256: sha256(raw),
    firstImport,
    previousFailure: previous.failure,
    limitsMs: {
      originalProbe: regularTimeoutMs,
      currentProbe: importTimeoutMs,
      embeddedHttpForwarding: 90_000,
      embeddedSdkCall: 120_000,
      standaloneWebApplication: null,
    },
  };

  const sourceRoot = join(beforeFolder, 'data');
  assert.equal(resolve(previous.dataRoot), sourceRoot);
  assert.equal(await realpath(sourceRoot), sourceRoot);
  await assertSourceStopped(sourceRoot);

  const archivePath = join(beforeFolder, tier + '-complete-history.studio.zip');
  assert.equal(resolve(previous.archive.file), archivePath);
  await requireRegularFile(archivePath);
  const archive = await readFile(archivePath);
  assert.equal(archive.length, previous.archive.bytes);
  assert.equal(sha256(archive), previous.archive.sha256);
  evidence.archive = { ...previous.archive, file: archivePath };

  const { artifactId } = previous.source;
  const { assetId } = previous.original;
  assert.match(artifactId, /^[a-zA-Z0-9_-]+$/u);
  assert.match(assetId, /^[a-zA-Z0-9_-]+$/u);
  const source = join(sourceRoot, 'artifacts', artifactId);
  assert.equal(await realpath(source), source);
  const files = await readdir(source);
  assert(
    !files.some((name) => /^artifact\.sqlite-(?:wal|shm|journal)$/u.test(name)),
    'The source SQLite database has active sidecar files',
  );

  const target = join(coordinates.dataRoot, 'artifacts', artifactId);
  await mkdir(join(target, 'assets'), { recursive: true });
  const database = await copyVerifiedFile(
    join(source, 'artifact.sqlite'),
    join(target, 'artifact.sqlite'),
  );
  const asset = await copyVerifiedFile(
    join(source, 'assets', assetId),
    join(target, 'assets', assetId),
  );
  assert.equal(asset.sha256, previous.original.assetSha256);
  evidence.replay.sourceCopies = { database, asset };
  return { previous, archive };
}

try {
  const runtime = await measure('verify-and-copy-frozen-runtime', copyFrozenRuntime);
  const replay = previousWitness
    ? await measure('prepare-replay-source-copy', () => prepareReplay(runtime))
    : undefined;
  await measure('complete-archive-product-probe', () =>
    runTemporaryServer(runtime, coordinates.dataRoot, (api) => verifyRoundtrip(api, replay)),
  );
  await measure('recheck-frozen-runtime-after-exit', () =>
    verifyRuntime(coordinates.packagedCopy, fingerprintPath),
  );
  evidence.archiveVerified = true;
} catch (error) {
  evidence.failure = failure(error);
  process.exitCode = 2;
} finally {
  const attempt = samples.find((sample) => sample.name === 'import-complete-archive');
  if (evidence.replay && attempt) {
    const { durationMs } = attempt;
    evidence.replay.wallClockComparison = {
      durationMs,
      exceededOriginalProbe: durationMs > regularTimeoutMs,
      exceededEmbeddedHttpForwarding: durationMs > 90_000,
      exceededEmbeddedSdkCall: durationMs > 120_000,
    };
  }

  const witness = join(output, 'full-history-archive-witness.json');
  await writeFile(witness, JSON.stringify(evidence, null, 2) + '\n');
  console.log(
    JSON.stringify({ tier, witness, verified: evidence.archiveVerified, error: evidence.failure }),
  );
}
