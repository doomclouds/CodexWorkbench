import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCapacityFixture } from './capacity-fixtures.mjs';
import { runTemporaryServer, sha256, verifyRuntime } from './runtime-fingerprint.mjs';

const plugin = fileURLToPath(new URL('../', import.meta.url));
const requirePlugin = createRequire(join(plugin, 'package.json'));
const runtime = await verifyRuntime(process.argv[2], process.argv[3]);
const output = await mkdtemp(join(tmpdir(), 'luming-stage4-boundary-'));
const nearRoot = join(output, 'near-data');
const expandedRoot = join(output, 'expanded-data');
const seeder = await requirePlugin('esbuild').build({
  absWorkingDir: plugin,
  stdin: {
    contents: 'export { SqliteArtifactRepository } from "./src/infrastructure/sqlite-artifact.ts";',
    resolveDir: plugin,
  },
  format: 'esm',
  platform: 'node',
  bundle: true,
  write: false,
});
const sqlSource = seeder.outputFiles[0].contents;
const { SqliteArtifactRepository } = await import(
  'data:text/javascript;base64,' + Buffer.from(sqlSource).toString('base64')
);

async function seed(dataRoot, name, historyCount) {
  const fixture = makeCapacityFixture(name);
  const folder = join(dataRoot, 'artifacts', fixture.artifactId);
  const assets = join(folder, 'assets');
  await mkdir(assets, { recursive: true });
  for (const resource of fixture.resources) {
    await writeFile(join(assets, resource.id), fixture.resourceData);
  }
  const timestamp = '2026-01-01T00:00:00.000Z';
  const artifact = {
    id: fixture.artifactId,
    type: 'whiteboard',
    title: 'Isolated capacity fixture ' + name,
    revision: Math.max(1, historyCount),
    pinned: false,
    sharing: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const actor = {
    id: 'synthetic-stage4',
    name: 'Synthetic stage four',
    kind: 'human',
    role: 'owner',
  };
  const history = fixture.history.slice(0, historyCount).map(({ id, revision }) => ({
    entry: {
      id,
      revision,
      createdAt: timestamp,
      actor,
      summary: 'Synthetic baseline',
      changedIds: [],
    },
    artifact: { ...artifact, revision },
    content: fixture.content,
  }));
  const databasePath = join(folder, 'artifact.sqlite');
  const writer = new SqliteArtifactRepository(databasePath, true);
  try {
    writer.database.exec('BEGIN IMMEDIATE');
    writer.writeState({
      schemaVersion: 2,
      artifact,
      content: fixture.content,
      history,
      assets: Object.fromEntries(fixture.resources.map((asset) => [asset.id, asset])),
      feedback: [],
      sources: {},
      operations: [],
      sharing: { enabled: false, generation: 0, tokens: {} },
    });
    writer.database.exec('COMMIT');
  } finally {
    writer.close();
  }

  return { ...fixture, databasePath, materializedHistory: historyCount };
}

const results = [];

async function observe(name, expected, path) {
  const start = performance.now();
  try {
    const value = await path();
    results.push({
      name,
      expected,
      code: 'OK',
      matches: expected === 'OK',
      durationMs: performance.now() - start,
      value,
    });

    return value;
  } catch (error) {
    const code = error.code || error.name;
    results.push({
      name,
      expected,
      code,
      matches: expected === code,
      durationMs: performance.now() - start,
      message: error.message,
    });
  }
}

const near = await seed(nearRoot, 'near', 7);
const expanded = await seed(expandedRoot, 'expanded', 0);

async function measureNear({ tool, request, session }) {
  assert.equal(session.pluginVersion, '0.3.0');
  const id = near.artifactId;
  const read = (artifactId) => tool('artifact_read', { artifactId, mode: 'board' });
  const apply = (expectedRevision, operations) =>
    tool('artifact_apply', { artifactId: id, expectedRevision, operations });
  const nearBoard = await read(id);
  assert.equal(nearBoard.elements.length, 2_000);

  await observe('near rejects add beyond 2000', 'TOO_LARGE', () =>
    apply(nearBoard.artifact.revision, [
      { op: 'add', element: { type: 'text', id: 'limit-boundary-text', text: 'Boundary' } },
    ]),
  );
  const region = near.content.elements[0];
  const extra = ' '.repeat(8 * 1024 * 1024 - near.profile.contentBytes + 1);
  await observe('near rejects serialized content above 8 MiB', 'TOO_LARGE', () =>
    apply(nearBoard.artifact.revision, [
      {
        op: 'update',
        id: region.id,
        changes: { html: region.html.replace('</article>', extra + '</article>') },
      },
    ]),
  );
  assert.equal((await read(id)).artifact.revision, nearBoard.artifact.revision);
  const last = nearBoard.elements.at(-1);
  await apply(nearBoard.artifact.revision, [
    { op: 'update', id: last.id, changes: { text: 'Isolated foreground edit before backup' } },
  ]);
  const saved = await read(id);
  assert.equal(saved.artifact.revision, nearBoard.artifact.revision + 1);
  const beforeBackup = sha256(await readFile(near.databasePath));

  const filename = join(output, 'near-probe.studio.zip');
  const archived = await observe('near export complete archive', 'OK', async () => {
    const exported = await tool('artifact_export', { artifactId: id, format: 'zip' });
    const archive = Buffer.from(await (await request(exported.downloadPath)).arrayBuffer());
    await writeFile(filename, archive);

    return { archiveSha256: sha256(archive), bytes: archive.length };
  });

  if (archived) {
    await observe('near import verified archive', 'OK', async () => {
      const imported = await (
        await request('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/zip' },
          body: await readFile(filename),
        })
      ).json();
      const newId = imported.data?.artifact?.id;
      assert(newId && newId !== id);
      assert.equal((await read(newId)).artifact.revision, saved.artifact.revision);

      return { newArtifactId: newId };
    });
  }

  assert.equal(sha256(await readFile(near.databasePath)), beforeBackup);
}

async function measureExpanded({ tool, session }) {
  assert.equal(session.pluginVersion, '0.3.0');
  const board = await tool('artifact_read', { artifactId: expanded.artifactId, mode: 'board' });
  assert.equal(board.elements.length, 4_000);
  return { elements: board.elements.length, revision: board.artifact.revision };
}

await observe('temporary packaged server and near fixture checks', 'OK', () =>
  runTemporaryServer(runtime, nearRoot, measureNear),
);
await observe('expanded read at 4000 objects', 'OK', () =>
  runTemporaryServer(runtime, expandedRoot, measureExpanded),
);
await observe('frozen runtime still matches the inventory', 'OK', async () => {
  await verifyRuntime(process.argv[2], process.argv[3]);
});

const manifest = (fixture) => ({
  profile: fixture.profile,
  contentSha256: fixture.digest,
  materializedHistory: fixture.materializedHistory,
});
const witness = {
  kind: 'packaged-capacity-boundaries',
  runtime,
  fixtureSeederSha256: sha256(sqlSource),
  fixtures: { near: manifest(near), expanded: manifest(expanded) },
  results,
  releaseEligible: false,
  remainingEvidence: [
    'Near: package write uses seven retained snapshots plus one committed edit, not a performance run with 200 histories',
    'Expanded: requires product capacity, complete archive restore, and an explicit N-1 limit',
    'Both tiers: require the approved physical-platform evidence from E-02/E-03',
  ],
  output,
};
await writeFile(join(output, 'boundary-witness.json'), JSON.stringify(witness, null, 2) + '\n');
console.log(JSON.stringify(witness, null, 2));
if (results.some((row) => !row.matches)) {
  process.exitCode = 2;
}
