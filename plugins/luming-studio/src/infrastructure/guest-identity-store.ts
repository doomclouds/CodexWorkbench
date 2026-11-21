import { randomBytes } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { lock } from 'proper-lockfile';
import { isRecord } from '../shared/is-record.js';
import { StudioError } from '../shared/studio-error.js';
import { atomicWrite } from './filesystem/atomic-write.js';

export async function loadOrCreateGuestSecret(dataRoot: string): Promise<Buffer> {
  await mkdir(dataRoot, { recursive: true });
  const file = join(dataRoot, 'guest-auth.json');
  let compromised = false;
  const release = await lock(file, {
    realpath: false,
    stale: 30_000,
    update: 5000,
    retries: { retries: 100, minTimeout: 10, maxTimeout: 50, factor: 1 },
    onCompromised: () => {
      compromised = true;
    },
  });

  try {
    let saved: string;
    try {
      saved = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }

      saved = JSON.stringify({ version: 1, secret: randomBytes(32).toString('base64url') });
      if (compromised) {
        throw new StudioError('LOCK_LOST', '访客身份密钥保存锁已失效。', undefined, {
          cause: error,
        });
      }

      await atomicWrite(file, saved);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(saved);
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }

      throw new StudioError(
        'CORRUPT_IDENTITY',
        '访客身份密钥无法读取，请保留原文件；不能自动重置已有身份。',
        undefined,
        { cause: error },
      );
    }
    const secretText = isRecord(parsed) && parsed.version === 1 ? parsed.secret : undefined;
    if (typeof secretText !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secretText)) {
      throw new StudioError(
        'CORRUPT_IDENTITY',
        '访客身份密钥无法读取，请保留原文件；不能自动重置已有身份。',
      );
    }

    const secret = Buffer.from(secretText, 'base64url');
    if (compromised) {
      throw new StudioError('LOCK_LOST', '访客身份密钥保存锁已失效。');
    }

    return secret;
  } finally {
    if (!compromised) {
      await release();
    }
  }
}
