import { openAsBlob } from 'node:fs';
import { mkdtemp, open, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppTransferSpool } from '../../contracts/transport.js';

export async function createAppTransferSpool(): Promise<AppTransferSpool> {
  const directory = await mkdtemp(join(tmpdir(), 'luming-studio-app-transfer-'));
  const path = join(directory, 'bytes');
  const file = await open(path, 'wx+', 0o600).catch(async (error: unknown) => {
    await rmdir(directory);
    throw error;
  });

  return {
    async append(bytes) {
      await file.writeFile(bytes);
    },
    async read(offset, length) {
      const bytes = Buffer.alloc(length);
      let used = 0;
      while (used < length) {
        const { bytesRead } = await file.read(bytes, used, length - used, offset + used);
        if (bytesRead === 0) {
          throw new Error('作品临时文件未包含预期的分块。');
        }

        used += bytesRead;
      }

      return bytes;
    },
    blob() {
      return openAsBlob(path);
    },
    async dispose() {
      try {
        await file.close();
      } finally {
        await rm(path, { force: true });
        await rmdir(directory);
      }
    },
  };
}
