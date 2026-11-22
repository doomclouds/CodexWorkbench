import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { FileExportCopyStore } from '../../src/infrastructure/export-copy-store.js';

it('atomically publishes a staged export and leaves its lease with the caller', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-export-copy-'));
  try {
    const store = new FileExportCopyStore(root);
    const partOne = Buffer.from('content ');
    const partTwo = Buffer.from('and all assets');
    const bytes = Buffer.concat([partOne, partTwo]);
    const file = {
      filename: 'board.studio.zip',
      mimeType: 'application/zip',
      size: bytes.length,
      chunks: () => Readable.from([partOne, partTwo]),
      dispose: vi.fn(async () => {}),
    };
    const result = await store.save('board', file);
    const download = await store.open(result.exportId);
    const streamed: Uint8Array[] = [];
    for await (const chunk of download.chunks()) {
      streamed.push(chunk);
    }

    expect(Buffer.concat(streamed)).toEqual(bytes);
    expect((await store.read(result.exportId)).data).toEqual(bytes);
    expect(file.dispose).not.toHaveBeenCalled();
    await expect(store.save('board', { ...file, size: 1 })).rejects.toMatchObject({
      code: 'CORRUPT_EXPORT',
    });
    expect((await readdir(join(root, 'exports'))).sort()).toEqual([
      result.exportId,
      result.exportId + '.json',
    ]);
  } finally {
    expect(dirname(root)).toBe(tmpdir());
    await rm(root, { recursive: true, force: true });
  }
});
