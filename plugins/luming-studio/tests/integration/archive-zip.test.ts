import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { unzipSync, zipSync } from 'fflate';
import { expect, it } from 'vitest';
import { extractZip, writeZip } from '../../src/infrastructure/archive-zip.js';

const manifest = Buffer.from('{"format":"fixture","version":4}');
const resource = Buffer.from('A sample asset with some noncompressible metadata.');
const limitForEntry = () => 1024;

it('writes and reads archives with streamed descriptors and ordinary ZIP headers', async () => {
  const staging = await mkdtemp(join(tmpdir(), 'studio-zip-streaming-'));
  try {
    const output = join(staging, 'output.zip');
    const outBytes = await writeZip(output, [
      {
        name: 'manifest.json',
        compress: true,
        chunks: () => Readable.from([manifest.subarray(0, 3), manifest.subarray(3)]),
      },
      {
        name: 'assets/source',
        compress: false,
        chunks: () => Readable.from([resource.subarray(0, 5), resource.subarray(5)]),
      },
    ]);
    expect(outBytes).toBe((await lstat(output)).size);
    const extracted = unzipSync(await readFile(output));
    expect(Buffer.from(extracted['manifest.json']!)).toEqual(manifest);
    expect(Buffer.from(extracted['assets/source']!)).toEqual(resource);

    const old = join(staging, 'original.zip');
    await writeFile(old, zipSync({ 'manifest.json': manifest, 'assets/source': resource }));
    for (const [index, archive] of [output, old].entries()) {
      const folder = join(staging, 'entries-' + index);
      await mkdir(folder);
      const entries = await extractZip(archive, folder, limitForEntry);
      expect(entries.get('manifest.json')!.size).toBe(manifest.length);
      expect(await readFile(entries.get('manifest.json')!.path)).toEqual(manifest);
      expect(await readFile(entries.get('assets/source')!.path)).toEqual(resource);
    }
  } finally {
    expect(dirname(staging)).toBe(tmpdir());
    await rm(staging, { force: true, recursive: true });
  }
});

it('fails closed when a ZIP member has corrupted stored bytes', async () => {
  const staging = await mkdtemp(join(tmpdir(), 'studio-zip-crc-'));
  try {
    const output = join(staging, 'checked.zip');
    const damaged = Buffer.from(zipSync({ 'assets/source': [resource, { level: 0 }] }));
    const offset = damaged.indexOf(resource);
    expect(offset).toBeGreaterThan(0);
    damaged[offset] = damaged[offset]! ^ 1;
    await writeFile(output, damaged);
    await expect(extractZip(output, staging, limitForEntry)).rejects.toMatchObject({
      code: 'INVALID_ARCHIVE',
    });
  } finally {
    expect(dirname(staging)).toBe(tmpdir());
    await rm(staging, { force: true, recursive: true });
  }
});
