import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function renameWithRetry(source: string, target: string): Promise<void> {
  for (let retry = 0; ; retry++) {
    try {
      await rename(source, target);

      return;
    } catch (error) {
      if (
        process.platform !== 'win32' ||
        retry === 5 ||
        !['EPERM', 'EBUSY', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')
      ) {
        throw error;
      }

      await delay(50 * (retry + 1));
    }
  }
}

export async function atomicWrite(
  file: string,
  content: string | Uint8Array,
): Promise<BigIntStats> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = join(dirname(file), `.${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx');
  try {
    await handle.writeFile(content);
    await renameWithRetry(temporary, file);

    return await handle.stat({ bigint: true });
  } finally {
    await handle.close();
    await rm(temporary, { force: true });
  }
}
