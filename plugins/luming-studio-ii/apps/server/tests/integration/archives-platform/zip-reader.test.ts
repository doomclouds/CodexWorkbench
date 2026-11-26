import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { extractZip } from '../../../src/infrastructure/platform/archives/index.js';

const fixtures = new URL('../../fixtures/archives/', import.meta.url);
const streamedArchive = fileURLToPath(new URL('legacy-v4.studio.zip', fixtures));
const ordinaryArchive = fileURLToPath(new URL('ordinary-headers.zip', fixtures));
const manifestName = 'manifest.json';
const assetName = 'assets/source';
const fixtureAsset = 'A sample asset with some noncompressible metadata.';
const entryLimit = 8192;
const expectedLegacyEntries = new Map([
  [manifestName, '81fa08595165e2226ab7c40dd3e2cc8647206b771d33ab5773579deef89dcf12'],
  ['artifact-deltas.ndjson', 'b00f350a932579350d17e6160cab2da435b1983b0194aedeec72940b33fef7ea'],
  [
    'assets/0aba8478-cf7c-4c4a-bbf1-c17302e61c22',
    'd227da79b61d4e2a5caf9512849b36c4d34a3d583110e0481770da2e161dae6f',
  ],
]);
let staging: string | undefined;

beforeEach(async () => {
  staging = await mkdtemp(join(tmpdir(), 'luming-ii-zip-test-'));
});

afterEach(async () => {
  if (!staging) {
    return;
  }

  assert.equal(dirname(staging), tmpdir());
  await rm(staging, { force: true, recursive: true });
  staging = undefined;
});

test('reads the stored and deflated bytes from a streamed Studio 0.3.2 archive', async () => {
  assert.ok(staging);
  const entries = await extractZip(streamedArchive, staging, () => entryLimit);

  expect([...entries.keys()]).toEqual([...expectedLegacyEntries.keys()]);
  for (const [name, hash] of expectedLegacyEntries) {
    const entry = entries.get(name);
    assert.ok(entry);
    expect(dirname(entry.path)).toBe(staging);
    const bytes = await readFile(entry.path);
    const digest = await crypto.subtle.digest('SHA-256', bytes);

    expect(entry.size).toBe(bytes.length);
    expect(Buffer.from(digest).toString('hex')).toBe(hash);
  }
});

test('reads ordinary ZIP headers and verifies the manifest and asset contents', async () => {
  assert.ok(staging);
  const entries = await extractZip(ordinaryArchive, staging, () => entryLimit);
  const manifest = entries.get(manifestName);
  const asset = entries.get(assetName);
  assert.ok(manifest);
  assert.ok(asset);

  expect(await readFile(manifest.path, 'utf8')).toBe('{"format":"fixture","version":4}');
  expect(asset.size).toBe(Buffer.byteLength(fixtureAsset));
  expect(await readFile(asset.path, 'utf8')).toBe(fixtureAsset);
});

test('rejects a stored member whose bytes no longer match its checksum', async () => {
  assert.ok(staging);
  const damaged = await readFile(ordinaryArchive);
  const changedByte = damaged.indexOf(fixtureAsset);
  assert.ok(changedByte >= 0);
  const originalByte = damaged[changedByte];
  assert.ok(originalByte !== undefined);
  damaged[changedByte] = originalByte ^ 1;
  const archive = join(staging, 'damaged.zip');
  await writeFile(archive, damaged);

  await expect(extractZip(archive, staging, () => entryLimit)).rejects.toMatchObject({
    code: 'invalidArchive',
  });
});

test('rejects an entry above the caller size limit before creating any output', async () => {
  assert.ok(staging);

  await expect(extractZip(ordinaryArchive, staging, () => 4)).rejects.toMatchObject({
    code: 'tooLarge',
  });
  expect(await readdir(staging)).toEqual([]);
});
