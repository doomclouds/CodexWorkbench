import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprintRuntime, sha256 } from './runtime-fingerprint.mjs';

const workspace = fileURLToPath(new URL('../../../', import.meta.url));
const plugin = 'plugins/luming-studio';
const buildEntry = 'tooling/build-luming-studio.mjs';
const product = plugin + '/src/core/products/whiteboard.ts';
const sqlite = plugin + '/src/infrastructure/sqlite-artifact.ts';
const changes = [
  {
    file: product,
    from: 'const MAX_WHITEBOARD_ELEMENTS = 2_000;',
    to: 'const MAX_WHITEBOARD_ELEMENTS = 4_000;',
  },
  {
    file: product,
    from: 'const MAX_WHITEBOARD_BYTES = 8 * 1024 * 1024;',
    to: 'const MAX_WHITEBOARD_BYTES = 16 * 1024 * 1024;',
  },
  { file: sqlite, from: "['current_units', 2000]", to: "['current_units', 4000]" },
];
const rootFiles = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'];
const pluginFiles = [
  '.oxfmtrc.json',
  '.oxlintrc.json',
  'eslint.config.mjs',
  'package.json',
  'tsconfig.json',
  'vitest.config.mts',
];
const sourceTrees = [
  'tooling',
  ...['src', 'lint', 'tests', 'benchmarks'].map((name) => plugin + '/' + name),
];

async function filesIn(root, directory) {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const candidate = directory + '/' + entry.name;
      if (entry.isDirectory()) {
        return filesIn(root, candidate);
      }

      assert(entry.isFile(), 'Build inputs must be regular files: ' + candidate);
      return [candidate];
    }),
  );

  return files.flat();
}

async function snapshot(root) {
  const trees = await Promise.all(sourceTrees.map((directory) => filesIn(root, directory)));
  const files = [...rootFiles, ...pluginFiles.map((name) => plugin + '/' + name), ...trees.flat()];
  return new Map(
    await Promise.all(files.sort().map(async (file) => [file, await readFile(join(root, file))])),
  );
}

function replaceGate(source, from, to, file) {
  assert.equal(
    source.split(from).length,
    2,
    'Expected exactly one original capacity gate in ' + file,
  );
  assert(!source.includes(to), 'Candidate capacity gate is already present in ' + file);
  return source.replace(from, to);
}

function candidateSources(original) {
  const files = new Map(original);
  const edits = [];
  for (const { file, from, to } of changes) {
    const raw = files.get(file);
    assert(raw, 'Missing capacity source ' + file);
    const source = raw.toString('utf8');
    assert(raw.equals(Buffer.from(source)), 'Capacity source must be valid UTF-8: ' + file);
    const updated = replaceGate(source, from, to, file);
    const line = source.slice(0, source.indexOf(from)).split('\n').length;
    files.set(file, Buffer.from(updated));
    edits.push({ file, line, from, to });
  }

  const changedFiles = [...original.keys()].filter(
    (file) => !files.get(file).equals(original.get(file)),
  );
  assert.deepEqual(
    changedFiles.sort(),
    [product, sqlite].sort(),
    'Unexpected candidate source differences',
  );
  const reversed = new Map(files);
  for (const { file, from, to } of changes.slice().reverse()) {
    reversed.set(
      file,
      Buffer.from(replaceGate(reversed.get(file).toString('utf8'), to, from, file)),
    );
  }

  assert.deepEqual(reversed, original, 'Candidate edits must reverse to the exact original inputs');
  return { files, edits };
}

function describeFiles(files) {
  const entries = [...files].map(([file, bytes]) => ({
    file,
    bytes: bytes.length,
    sha256: sha256(bytes),
  }));

  return { sha256: sha256(JSON.stringify(entries)), files: entries };
}

function pinDependencies(files) {
  const manifest = JSON.parse(files.get(plugin + '/package.json').toString('utf8'));
  return Object.entries({ ...manifest.dependencies, ...manifest.devDependencies }).sort(
    ([a], [b]) => a.localeCompare(b),
  );
}

async function installedPackages(files) {
  const modules = join(workspace, plugin, 'node_modules');
  const packages = await Promise.all(
    pinDependencies(files).map(async ([name, pinnedVersion]) => {
      const directory = await realpath(join(modules, name));
      const actual = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      assert.equal(actual.name, name, 'Installed package identity changed');
      assert.equal(actual.version, pinnedVersion, 'Installed package is out of sync: ' + name);
      return { name, version: actual.version, directory };
    }),
  );
  const bin = join(modules, '.bin');
  const shimNames = (await readdir(bin)).filter((name) => /^tsgolint(?:\.cmd|\.ps1)?$/i.test(name));
  assert(shimNames.length, 'The locked tsgolint executable is unavailable');
  const shims = await Promise.all(
    shimNames.sort().map(async (file) => [file, await readFile(join(bin, file))]),
  );

  return { packages, shims };
}

async function writeInputs(destination, inputs) {
  for (const [file, bytes] of inputs) {
    const path = join(destination, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes, { flag: 'wx' });
  }
}

async function linkDependencies(destination, dependencies) {
  const modules = join(destination, plugin, 'node_modules');
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  for (const { name, directory } of dependencies.packages) {
    const path = join(modules, name);
    await mkdir(dirname(path), { recursive: true });
    await symlink(directory, path, linkType);
  }

  await writeInputs(join(modules, '.bin'), dependencies.shims);
}

async function runReleaseBuild(directory) {
  const logFile = join(directory, 'build.log');
  const log = await open(logFile, 'wx');
  try {
    const child = spawn(process.execPath, [join(directory, buildEntry)], {
      cwd: directory,
      env: { ...process.env, TMPDIR: directory, TEMP: directory, TMP: directory },
      stdio: ['ignore', log.fd, log.fd],
      windowsHide: true,
    });
    const [code, signal] = await once(child, 'close');
    if (code !== 0) {
      throw new Error('Candidate build failed (' + (signal ?? code) + '). Log: ' + logFile);
    }
  } finally {
    await log.close();
  }

  return logFile;
}

async function writeJson(path, report) {
  await writeFile(path, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}

async function main(args) {
  const verify = args.length === 1 && args[0] === '--verify-source';
  assert(args.length === 0 || verify, 'Usage: node build-expanded-candidate.mjs [--verify-source]');
  const original = await snapshot(workspace);
  const candidate = candidateSources(original);
  const before = describeFiles(original);
  const after = describeFiles(candidate.files);
  const lockHash = sha256(original.get('pnpm-lock.yaml'));
  const dependencies = await installedPackages(original);
  const proof = {
    releaseEligible: false,
    originalSources: before.sha256,
    candidateSources: after.sha256,
    sourceCount: original.size,
    lockSha256: lockHash,
    edits: candidate.edits,
    dependencies: dependencies.packages.length,
    node: process.version,
    platform: process.platform + '/' + process.arch,
  };

  if (verify) {
    console.log(JSON.stringify(proof, null, 2));
    return;
  }

  const base = await realpath(tmpdir());
  const directory = await mkdtemp(join(base, 'luming-expanded-candidate-'));
  const inputWitness = join(directory, 'build-inputs.json');
  await writeInputs(directory, candidate.files);
  const expected = {
    ...proof,
    original: before.files,
    modified: after.files,
    packages: dependencies.packages,
  };
  await writeJson(inputWitness, expected);
  await linkDependencies(directory, dependencies);
  assert.deepEqual(
    describeFiles(await snapshot(directory)),
    after,
    'Candidate source copy differs',
  );
  assert.deepEqual(
    describeFiles(await snapshot(workspace)),
    before,
    'Workspace changed before build',
  );
  const log = await runReleaseBuild(directory);
  assert.deepEqual(
    describeFiles(await snapshot(directory)),
    after,
    'Build changed candidate inputs',
  );
  assert.deepEqual(
    describeFiles(await snapshot(workspace)),
    before,
    'Workspace changed during build',
  );

  const runtime = await fingerprintRuntime(join(directory, plugin, 'runtime'));
  const fingerprint = join(directory, 'runtime-fingerprint.json');
  await writeJson(fingerprint, runtime);
  const report = { ...proof, directory, inputWitness, log, runtime, fingerprint };
  const evidence = join(directory, 'expanded-candidate.json');
  await writeJson(evidence, report);
  console.log(JSON.stringify({ ...report, evidence }, null, 2));
}

await main(process.argv.slice(2));
