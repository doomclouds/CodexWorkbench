import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { collectLicenses } from './collect-agentero-licenses.mjs';

async function fixture(t) {
  const parent = resolve(tmpdir()), root = await mkdtemp(join(parent, 'codex-license-owned-'));
  const cleanup = [];
  t.after(async () => { for (const action of cleanup.reverse()) await action(); assert.equal(dirname(root), parent); assert(basename(root).startsWith('codex-license-owned-')); await rm(root, { recursive: true, force: true }); });
  const plugin = join(root, 'plugins/agentero-library'), archive = join(plugin, 'assets/licenses');
  const write = async (path, bytes) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); };
  await write(join(plugin, 'package.json'), JSON.stringify({ name: 'owned-plugin', version: '0.2.1', dependencies: { 'owned-a': '1.0.0' } }));
  await write(join(plugin, 'src/app/pdf/translation/MOTIF-LICENSE.txt'), 'MIT owned source fixture\n');
  const inputs = {};
  for (const name of ['owned-a', 'owned-b']) {
    await write(join(plugin, 'node_modules', name, 'package.json'), JSON.stringify({ name, version: '1.0.0', license: 'MIT' }));
    await write(join(plugin, 'node_modules', name, 'dist/index.js'), 'export const value = 1;');
    await write(join(plugin, 'node_modules', name, 'dist/package.json'), JSON.stringify(name === 'owned-a' ? { type: 'module' } : { name, version: '1.0.0' }));
    await write(join(plugin, 'node_modules', name, 'LICENSE'), `MIT ${name} original\n`);
    inputs[`node_modules/${name}/dist/index.js`] = {};
  }
  await write(join(plugin, 'node_modules/owned-b/fonts/OFL.txt'), 'Owned font license\n');
  await write(join(root, 'artifacts/agentero-library/v0.2.1/validation/bundle-inputs.json'), JSON.stringify({ server: { inputs }, appInputs: [join(plugin, 'node_modules/owned-a/dist/index.js') + '?commonjs-proxy'] }));
  return { root, plugin, archive, write, cleanup, collect: () => collectLicenses({ repoRoot: root }), source: name => join(plugin, 'node_modules', name, 'LICENSE'), target: name => join(archive, 'packages', name, '1.0.0/LICENSE') };
}

async function snapshot(root) {
  const result = {};
  const walk = async (directory, prefix) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.generated-')) continue;
      const path = join(directory, entry.name), key = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await walk(path, `${key}/`); else result[key] = (await readFile(path)).toString('base64');
    }
  };
  await walk(root, ''); return result;
}

async function lockFile(fixture, file, milliseconds) {
  const literal = file.replaceAll("'", "''");
  const script = `$licenseLock = [System.IO.File]::Open('${literal}', [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read); try { [Console]::Out.WriteLine('LOCKED'); [Console]::Out.Flush(); Start-Sleep -Milliseconds ${milliseconds} } finally { $licenseLock.Dispose() }`;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  fixture.cleanup.push(async () => { if (child.exitCode === null) child.kill(); await exited; });
  await new Promise((resolve, reject) => {
    let stdout = '', stderr = '';
    const timer = setTimeout(() => reject(new Error('Owned file-lock helper did not become ready.')), 5000);
    child.stdout.on('data', bytes => { stdout += bytes; if (stdout.includes('LOCKED')) { clearTimeout(timer); resolve(); } });
    child.stderr.on('data', bytes => { stderr += bytes; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { if (!stdout.includes('LOCKED')) { clearTimeout(timer); reject(new Error(`File-lock helper exited: ${stderr}`)); } });
  });
}

test('collects nearest package identities and font notices; unchanged builds do not rewrite originals', async t => {
  const f = await fixture(t);
  await f.write(join(f.archive, 'packages/stale/0.0.1/LICENSE'), 'obsolete');
  await f.write(join(f.archive, 'sources/npm-supplements/keep/LICENSE'), 'fixed checked-in supplement');
  await f.write(join(f.root, 'unrelated/keep.txt'), 'unrelated');
  const result = await f.collect();
  assert.equal(result.packageCount, 2); assert.equal(result.licenseFileCount, 4);
  assert(result.manifest.packages.every(item => item.license === 'MIT'));
  assert.deepEqual(result.manifest.packages[0].scope, ['app', 'server']);
  assert(!JSON.stringify(result.manifest).includes(f.root));
  await assert.rejects(() => stat(join(f.archive, 'packages/stale')), error => error.code === 'ENOENT');
  const before = await snapshot(f.archive), info = await stat(f.target('owned-a'));
  await f.collect();
  assert.deepEqual(await snapshot(f.archive), before);
  assert.equal((await stat(f.target('owned-a'))).mtimeMs, info.mtimeMs);
  assert.equal(await readFile(join(f.archive, 'sources/npm-supplements/keep/LICENSE'), 'utf8'), 'fixed checked-in supplement');
  assert.equal(await readFile(join(f.root, 'unrelated/keep.txt'), 'utf8'), 'unrelated');
  await assert.rejects(() => collectLicenses({ repoRoot: f.root, version: '../../outside' }), /safe semantic/);
});

test('rejects a junction in an existing generated subtree before any out-of-tree mutation', async t => {
  const f = await fixture(t); await f.collect();
  const outside = join(f.root, 'unrelated'); await f.write(join(outside, 'keep.txt'), 'unrelated');
  await rm(join(f.archive, 'packages/owned-b'), { recursive: true });
  await symlink(outside, join(f.archive, 'packages/owned-b'), process.platform === 'win32' ? 'junction' : 'dir');
  f.cleanup.push(() => unlink(join(f.archive, 'packages/owned-b')));
  await assert.rejects(() => f.collect(), /symlink or external target/);
  assert.deepEqual(await readdir(outside), ['keep.txt']);
});

test('Windows transient file locks are retried without replacing whole archive directories', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t); await f.collect();
  await writeFile(f.source('owned-b'), 'MIT owned-b changed\n');
  await lockFile(f, f.target('owned-b'), 600);
  await f.collect();
  assert.equal(await readFile(f.target('owned-b'), 'utf8'), 'MIT owned-b changed\n');
  assert.equal(await readFile(f.target('owned-a'), 'utf8'), 'MIT owned-a original\n');
});

test('Windows persistent file locks restore earlier replacements and retain the complete old archive', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t); await f.collect();
  const before = await snapshot(f.archive);
  await writeFile(f.source('owned-a'), 'MIT owned-a changed\n');
  await writeFile(f.source('owned-b'), 'MIT owned-b changed\n');
  await lockFile(f, f.target('owned-b'), 15000);
  await assert.rejects(() => f.collect(), /previous archive files were restored/);
  assert.deepEqual(await snapshot(f.archive), before);
  assert(!(await readdir(f.archive)).some(name => name.startsWith('.generated-')));
});
