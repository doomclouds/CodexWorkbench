import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  readStagedArchiveChunks,
  readStagedArchiveEntry,
  stageCurrentArchive,
} from '../../../src/infrastructure/platform/archives/index.js';

const current = fileURLToPath(
  new URL('../../fixtures/archives/legacy-v4.studio.zip', import.meta.url),
);
const obsolete = fileURLToPath(
  new URL('../../fixtures/archives/obsolete-v3.studio.zip', import.meta.url),
);
const delta = fileURLToPath(
  new URL('../../fixtures/archives/delta-v4.studio.zip', import.meta.url),
);
const smallChunk = 131;
const fixtureAssetId = '0aba8478-cf7c-4c4a-bbf1-c17302e61c22';

test('stages a genuine v4 archive and decodes its current scene and assets', async () => {
  const staged = await stageCurrentArchive(
    createReadStream(current, { highWaterMark: smallChunk }),
  );

  try {
    expect(staged.title).toBe('产品发布工作台');
    expect(staged.sourceBoardId).toBe('7f1a680f-c09d-47c6-a76e-a5e7a803018f');
    expect(staged.objects).toHaveLength(7);
    expect(staged.objects).toContainEqual(expect.objectContaining({ id: 'release-scope', x: 76 }));
    expect(staged.objects).toContainEqual(
      expect.objectContaining({ id: 'release-document', type: 'document' }),
    );
    expect(staged.signature).toBe(
      '20d35157d2e9ea388e66774cd25e9e1ca722522b45d69bd69a30317cee4c51dc',
    );
    expect(Buffer.concat([...readStagedArchiveChunks(staged)])).toEqual(await readFile(current));

    const asset = staged.assets.get(fixtureAssetId);
    assert.ok(asset);
    expect(asset.mimeType).toBe('image/svg+xml');
    expect(Buffer.from(readStagedArchiveEntry(asset)).toString('utf8')).toMatch(/^<svg\b/u);
  } finally {
    await staged.dispose();
  }

  await expect(readFile(staged.archivePath)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('rejects a v3 manifest before opening its unsupported state payload', async () => {
  await expect(stageCurrentArchive(createReadStream(obsolete))).rejects.toMatchObject({
    code: 'unsupportedVersion',
    signature: expect.stringMatching(/^[a-f0-9]{64}$/u),
  });
});

test('restores a current delta with replaced and appended whiteboard objects', async () => {
  const staged = await stageCurrentArchive(createReadStream(delta));
  try {
    expect(staged.objects).toHaveLength(7);
    expect(staged.objects).toContainEqual(expect.objectContaining({ id: 'release-scope', x: 76 }));
    expect(staged.objects).toContainEqual(
      expect.objectContaining({ id: 'release-image', type: 'image' }),
    );
  } finally {
    await staged.dispose();
  }
});

test('classifies an undecodable local entry name as an invalid archive', async () => {
  const zip = await readFile(current);
  const localHeaderSize = 30;
  const manifest = 'manifest.json';
  assert.equal(zip.toString('utf8', localHeaderSize, localHeaderSize + manifest.length), manifest);
  zip[localHeaderSize] = 0xff;

  async function* source() {
    yield zip;
  }

  await expect(stageCurrentArchive(source())).rejects.toMatchObject({
    code: 'invalidArchive',
    signature: expect.stringMatching(/^[a-f0-9]{64}$/u),
  });
});

test('propagates an interrupted upload as a retryable operational failure', async () => {
  const interrupted = new Error('Test upload interrupted');
  async function* source() {
    yield new Uint8Array([1]);
    throw interrupted;
  }

  await expect(stageCurrentArchive(source())).rejects.toBe(interrupted);
});
