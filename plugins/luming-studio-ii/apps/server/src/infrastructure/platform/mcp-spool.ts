import { openAsBlob } from 'node:fs';
import { mkdtemp, open, rmdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function removeOwnedFile(path: string, remove: (target: string) => Promise<void>) {
  try {
    await remove(path);
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }
  }
}

export async function createMcpSpool() {
  const folder = await mkdtemp(join(tmpdir(), 'luming-ii-transfer-'));
  const path = join(folder, 'content');
  const file = await open(path, 'wx+', 0o600).catch(async (error: unknown) => {
    try {
      await removeOwnedFile(folder, rmdir);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Could not open Studio transfer file.', {
        cause: cleanupError,
      });
    }
    throw error;
  });
  let size = 0;
  let disposal: Promise<void> | undefined;

  async function dispose() {
    try {
      await file.close();
    } finally {
      await removeOwnedFile(path, unlink);
      await removeOwnedFile(folder, rmdir);
    }
  }

  return {
    async append(bytes: Uint8Array): Promise<void> {
      let offset = 0;
      while (offset < bytes.byteLength) {
        const { bytesWritten } = await file.write(bytes, offset, bytes.byteLength - offset, size);
        if (!bytesWritten) {
          throw new Error('Could not write Studio transfer file.');
        }

        offset += bytesWritten;
        size += bytesWritten;
      }
    },
    async read(start: number, length: number): Promise<Uint8Array> {
      const target = new Uint8Array(length);
      let offset = 0;
      while (offset < length) {
        const { bytesRead } = await file.read(target, offset, length - offset, start + offset);
        if (!bytesRead) {
          throw new Error('Studio transfer file ended earlier than expected.');
        }

        offset += bytesRead;
      }

      return target;
    },
    body: () => openAsBlob(path),
    dispose: () => (disposal ??= dispose()),
  };
}
