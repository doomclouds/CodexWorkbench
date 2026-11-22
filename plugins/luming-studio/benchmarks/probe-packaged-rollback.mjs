import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import {
  fingerprintRuntime,
  runTemporaryServer,
  sha256 as sha,
  verifyRuntime,
} from './runtime-fingerprint.mjs';

const [runtimeDirectory, fingerprintPath, previousEvidence] = process.argv.slice(2);
const candidateRuntime = await verifyRuntime(runtimeDirectory, fingerprintPath);
assert(previousEvidence && isAbsolute(previousEvidence), 'Use the absolute N-1 TEMP witness path');
const evidenceFile = await realpath(previousEvidence);
const parent = dirname(evidenceFile);
const tempRoot = await realpath(tmpdir());
const evidenceLocation = relative(tempRoot, parent);
assert(evidenceLocation && !evidenceLocation.startsWith('..' + sep) && evidenceLocation !== '..');
assert(!isAbsolute(evidenceLocation) && basename(parent).startsWith('studio-nminus1-059d55f-'));
const old = JSON.parse(await readFile(evidenceFile, 'utf8'));
assert.equal(old.commit, '059d55feacc7c22e1a17030520b1cd6d993669a6');
assert.match(old.artifactId, /^[a-z0-9-]+$/u);
const oldRuntime = await fingerprintRuntime(join(parent, 'old-runtime'));
assert.deepEqual(oldRuntime.files, old.artifacts);
const seed = join(parent, 'seed-data');
assert.equal(
  sha(await readFile(join(seed, 'artifacts', old.artifactId, 'artifact.sqlite'))),
  old.databaseSha256,
);
const plugin = fileURLToPath(new URL('../', import.meta.url));
const requirePlugin = createRequire(join(plugin, 'package.json'));
const scratch = await mkdtemp(join(tempRoot, 'luming-stage4-rollback-'));
const dataRoot = join(scratch, 'data');
await cp(seed, dataRoot, { recursive: true });

const bundledReader = await requirePlugin('esbuild').build({
  absWorkingDir: plugin,
  stdin: {
    contents: 'export { SqliteArtifactRepository } from "./src/infrastructure/sqlite-artifact.ts";',
    resolveDir: plugin,
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
});
const readerSource = Buffer.from(bundledReader.outputFiles[0].contents).toString('base64');
const { SqliteArtifactRepository } = await import('data:text/javascript;base64,' + readerSource);

function readClock(artifactId = old.artifactId) {
  const reader = new SqliteArtifactRepository(
    join(dataRoot, 'artifacts', artifactId, 'artifact.sqlite'),
  );

  try {
    return structuredClone(reader.readState().unitClocks?.['compat-doc']);
  } finally {
    reader.close();
  }
}

const paragraph = (id, text) => ({
  id,
  type: 'paragraph',
  props: {},
  content: [{ type: 'text', text, styles: {} }],
  children: [],
});

function databaseWitness() {
  const db = new DatabaseSync(join(dataRoot, 'artifacts', old.artifactId, 'artifact.sqlite'), {
    readOnly: true,
  });

  try {
    return {
      userVersion: db.prepare('PRAGMA user_version').get().user_version,
      versions: db
        .prepare('SELECT revision, content_hash FROM history_versions ORDER BY revision')
        .all(),
      linkedRecords: db
        .prepare(
          "SELECT collection,id,payload_hash FROM state_records WHERE collection IN ('assets','feedback','sources') ORDER BY collection,id",
        )
        .all(),
    };
  } finally {
    db.close();
  }
}

async function run(runtime, expectedVersion, verify) {
  return runTemporaryServer(runtime, dataRoot, async ({ request, tool, session }) => {
    assert.equal(session.pluginVersion, expectedVersion);
    const evidence = await verify(tool, request);

    return { pluginVersion: session.pluginVersion, ...evidence };
  });
}

const initial = databaseWitness();
assert.equal(initial.userVersion, 1);
const candidate = await run(candidateRuntime, '0.3.0', async (tool, get) => {
  const before = await tool('artifact_read', { artifactId: old.artifactId, mode: 'board' });
  assert.equal(before.artifact.revision, 3);
  assert.equal(
    sha(
      Buffer.from(await (await get('/assets/' + old.artifactId + '/' + old.assetId)).arrayBuffer()),
    ),
    old.assetSha256,
  );
  await tool('artifact_apply', {
    artifactId: old.artifactId,
    expectedRevision: 3,
    operationId: 'compat-030-commit',
    operations: [
      {
        op: 'update',
        id: 'original-label',
        changes: { text: '0.3.0 editing on the old fixture', fontSize: 37 },
      },
    ],
  });
  await tool('artifact_apply', {
    artifactId: old.artifactId,
    expectedRevision: 4,
    operationId: 'compat-doc-create',
    operations: [
      {
        op: 'add',
        element: {
          id: 'compat-doc',
          type: 'document',
          document: { schemaVersion: 1, blocks: [paragraph('base-block', 'Before old edit')] },
        },
      },
    ],
  });
  await tool('artifact_apply', {
    artifactId: old.artifactId,
    expectedVersions: { 'compat-doc': 1 },
    operationId: 'compat-doc-insert',
    operations: [
      {
        op: 'document',
        id: 'compat-doc',
        data: {
          operations: [
            {
              op: 'insert',
              afterId: 'base-block',
              block: paragraph('late-block', 'Inserted in 0.3.0'),
            },
          ],
        },
      },
    ],
  });
  const result = await tool('artifact_export', { artifactId: old.artifactId, format: 'zip' });
  const bytes = Buffer.from(await (await get(result.downloadPath)).arrayBuffer());
  const entries = requirePlugin('fflate').unzipSync(bytes);
  assert.equal(
    JSON.parse(Buffer.from(entries['manifest.json']).toString('utf8')).format,
    'luming-studio-archive',
  );
  await writeFile(join(scratch, 'candidate-backup.studio.zip'), bytes);
  return { archiveSha256: sha(bytes) };
});
const afterCandidate = databaseWitness();
const beforeOldClock = readClock();
assert.equal(beforeOldClock.version, 2);
assert.equal(beforeOldClock.children.throughVersion, 2);
assert.equal(beforeOldClock.children.inserted['late-block'], 2);
assert.deepEqual(afterCandidate.versions.slice(0, initial.versions.length), initial.versions);
assert.deepEqual(afterCandidate.linkedRecords, initial.linkedRecords);
const previous = await run(oldRuntime, '0.2.21', async (tool, get) => {
  const board = await tool('artifact_read', { artifactId: old.artifactId, mode: 'board' });
  assert.equal(board.artifact.revision, 6);
  assert.deepEqual(readClock(), beforeOldClock);
  const label = board.elements.find((item) => item.id === 'original-label');
  assert.equal(label.text, '0.3.0 editing on the old fixture');
  assert.equal(label.fontSize, 37);
  assert.equal(
    sha(
      Buffer.from(await (await get('/assets/' + old.artifactId + '/' + old.assetId)).arrayBuffer()),
    ),
    old.assetSha256,
  );

  await tool('artifact_apply', {
    artifactId: old.artifactId,
    expectedRevision: 6,
    expectedVersions: { 'compat-doc': 2 },
    operationId: 'compat-nminus1-commit',
    operations: [
      { op: 'update', id: 'original-label', changes: { text: '0.2.21 changed the new version' } },
      {
        op: 'document',
        id: 'compat-doc',
        data: {
          operations: [
            { op: 'update', id: 'base-block', changes: { content: 'Real old block write' } },
          ],
        },
      },
    ],
  });

  return { readVersion: 6, writeVersion: 7, readPreservedClock: true };
});
const afterOldClock = readClock();
assert.equal(afterOldClock.version, 3);
assert.notEqual(afterOldClock.children?.throughVersion, 3);
const reopened = await run(candidateRuntime, '0.3.0', async (tool, get) => {
  const board = await tool('artifact_read', { artifactId: old.artifactId, mode: 'board' });
  const label = board.elements.find((item) => item.id === 'original-label');
  assert.equal(board.artifact.revision, 7);
  await assert.rejects(
    tool('artifact_apply', {
      artifactId: old.artifactId,
      expectedVersions: { 'compat-doc': 2 },
      merge: 'same-generation',
      operationId: 'compat-child-guard',
      operations: [
        {
          op: 'document',
          id: 'compat-doc',
          data: {
            operations: [
              {
                op: 'update',
                id: 'late-block',
                changes: { content: 'Stale but otherwise disjoint' },
              },
            ],
          },
        },
      ],
    }),
    { code: 'CONFLICT', status: 409 },
  );
  assert.equal(
    (await tool('artifact_read', { artifactId: old.artifactId, mode: 'board' })).artifact.revision,
    7,
  );
  assert.equal(label.text, '0.2.21 changed the new version');
  assert.equal(label.fontSize, 37);
  assert.equal(
    sha(
      Buffer.from(await (await get('/assets/' + old.artifactId + '/' + old.assetId)).arrayBuffer()),
    ),
    old.assetSha256,
  );
  const backup = await readFile(join(scratch, 'candidate-backup.studio.zip'));
  const imported = await tool('artifact_manage', {
    action: 'import',
    archiveBase64: backup.toString('base64'),
  });
  assert.notEqual(imported.artifact.id, old.artifactId);
  const restored = await tool('artifact_read', { artifactId: imported.artifact.id, mode: 'board' });
  assert.equal(restored.artifact.revision, 6);
  assert.equal(restored.elements.find((item) => item.id === 'original-label').fontSize, 37);
  assert.equal(
    restored.elements.find((item) => item.id === 'original-image').src,
    '/assets/' + imported.artifact.id + '/' + old.assetId,
  );
  assert.equal(
    sha(
      Buffer.from(
        await (await get('/assets/' + imported.artifact.id + '/' + old.assetId)).arrayBuffer(),
      ),
    ),
    old.assetSha256,
  );
  assert.equal(readClock(imported.artifact.id).children, undefined);
  return {
    revision: 7,
    reopenedCandidateBackup: true,
    staleProofRejected: true,
    importedForeignEvidenceCleared: true,
  };
});
const final = databaseWitness();
assert.deepEqual(final.versions.slice(0, afterCandidate.versions.length), afterCandidate.versions);
assert.deepEqual(final.linkedRecords, initial.linkedRecords);
await verifyRuntime(runtimeDirectory, fingerprintPath);
const witness = {
  fixture: old.artifactId,
  runtime: candidateRuntime,
  kind: 'packaged-functional-nminus1-fixture',
  capacityQualified: false,
  oldSourceCommit: old.commit,
  oldRuntimeSha256: old.artifacts.find((file) => file.file === 'server.mjs').sha256,
  candidateRuntimeSha256: candidateRuntime.files.find((file) => file.file === 'server.mjs').sha256,
  candidate,
  previous,
  reopened,
  childClockBeforeOld: beforeOldClock,
  childClockAfterOld: afterOldClock,
  history: final.versions.map(({ revision }) => revision),
  unchangedLinkedRecords: final.linkedRecords.map(({ collection }) => collection),
  sqliteUserVersion: final.userVersion,
  outputDirectory: scratch,
};
await writeFile(
  join(scratch, 'child-clock-roundtrip-witness.json'),
  JSON.stringify(witness, null, 2) + '\n',
);
console.log(JSON.stringify(witness, null, 2));
