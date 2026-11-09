import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { checkRepository } from './check-repository.mjs';

async function fixture(t, files) {
  const temporaryParent = resolve(tmpdir());
  const root = await mkdtemp(join(temporaryParent, 'codex-workbench-check-'));
  t.after(async () => {
    assert.equal(dirname(root), temporaryParent);
    assert.ok(basename(root).startsWith('codex-workbench-check-'));
    await rm(root, { recursive: true, force: true });
  });
  const result = spawnSync('git', ['init', '--quiet', root]);
  assert.equal(result.status, 0);
  for (const [file, contents] of Object.entries(files)) {
    const path = join(root, file);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, contents);
  }
  return root;
}

test('accepts Unicode local links and excludes ignored generated files', async (t) => {
  const root = await fixture(t, {
    '.gitignore': 'node_modules/\n',
    'README.md': '[说明](<docs/开发 约定.md>)\n[External](https://example.com)\n',
    'docs/开发 约定.md': '# 开发约定\n',
    'node_modules/bad.json': 'invalid JSON',
    '.agents/skills/example/SKILL.md': '---\nname: example\ndescription: A useful skill\n---\n\n# Example\n',
  });
  assert.deepEqual(await checkRepository(root), { checked: 4, errors: [] });
});

test('reports missing and escaping local links', async (t) => {
  const root = await fixture(t, {
    'README.md': '[Missing](missing.md)\n[Outside](../outside.md)\n',
  });
  const { errors } = await checkRepository(root);
  assert.equal(errors.length, 2);
  assert.ok(errors.some((error) => error.includes('broken local link')));
  assert.ok(errors.some((error) => error.includes('leaves the repository')));
});

test('preserves original license archives while checking their generated index', async (t) => {
  const root = await fixture(t, {
    'plugins/example/assets/licenses/packages/upstream/1.0.0/LICENSE': 'Original\r\nNo final newline',
    'plugins/example/assets/licenses/sources/upstream/NOTICE.md': '[Upstream](../not-in-this-repo)',
    'plugins/example/assets/licenses/index.json': '{invalid',
  });
  const { checked, errors } = await checkRepository(root);
  assert.equal(checked, 1);
  assert.equal(errors.length, 2);
  assert.ok(errors.every((error) => error.startsWith('plugins/example/assets/licenses/index.json:')));
});

test('rejects invalid UTF-8, JSON and text line endings', async (t) => {
  const root = await fixture(t, {
    'invalid.md': Buffer.from([0xff]),
    'invalid.json': '{\n',
    'README.md': 'Windows line ending\r\nNo final newline',
  });
  const { errors } = await checkRepository(root);
  assert.equal(errors.length, 4);
  assert.ok(errors.some((error) => error.includes('cannot read UTF-8')));
  assert.ok(errors.some((error) => error.includes('invalid JSON')));
  assert.ok(errors.some((error) => error.includes('LF line endings')));
  assert.ok(errors.some((error) => error.includes('final newline')));
});

test('rejects a skill identity mismatch and an unfinished description', async (t) => {
  const root = await fixture(t, {
    '.agents/skills/example/SKILL.md': '---\nname: other\ndescription: "[TODO: explain]"\n---\n',
  });
  const { errors } = await checkRepository(root);
  assert.equal(errors.length, 2);
  assert.ok(errors.some((error) => error.includes('skill name')));
  assert.ok(errors.some((error) => error.includes('skill description')));
});
