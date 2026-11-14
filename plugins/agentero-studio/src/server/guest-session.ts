import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { lock } from 'proper-lockfile';
import { atomicWrite, object, StudioError } from '../core/shared/common.js';

export async function createGuestSessions(dataRoot: string) {
  await mkdir(dataRoot, { recursive: true });
  const file = join(dataRoot, 'guest-auth.json');
  let compromised = false;
  const release = await lock(file, { realpath: false, stale: 30_000, update: 5000, retries: { retries: 100, minTimeout: 10, maxTimeout: 50, factor: 1 }, onCompromised: () => { compromised = true; } });
  let secret: Buffer;
  try {
    let saved: string;
    try { saved = await readFile(file, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      saved = JSON.stringify({ version: 1, secret: randomBytes(32).toString('base64url') });
      if (compromised) throw new StudioError('LOCK_LOST', '访客身份密钥保存锁已失效。');
      await atomicWrite(file, saved);
    }
    let parsed: unknown;
    try { parsed = JSON.parse(saved); }
    catch { throw new StudioError('CORRUPT_IDENTITY', '访客身份密钥无法读取，请保留原文件；不能自动重置已有身份。'); }
    if (!object(parsed) || parsed.version !== 1 || typeof parsed.secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(parsed.secret)) throw new StudioError('CORRUPT_IDENTITY', '访客身份密钥无法读取，请保留原文件；不能自动重置已有身份。');
    secret = Buffer.from(parsed.secret, 'base64url');
    if (compromised) throw new StudioError('LOCK_LOST', '访客身份密钥保存锁已失效。');
  } finally { if (!compromised) await release(); }
  // Persisted key identity isolates installations while surviving host restarts and port changes.
  const cookieName = `studio-guest-${createHash('sha256').update(secret).digest('hex').slice(0, 24)}`;
  const sign = (id: string) => createHmac('sha256', secret).update(id).digest('base64url');
  const read = (request: IncomingMessage): string | undefined => {
    const value = request.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    const signed = value && /^([A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{43})$/.exec(value);
    if (signed && timingSafeEqual(Buffer.from(signed[2]!), Buffer.from(sign(signed[1]!)))) return signed[1]!;
  };
  const resolve = (request: IncomingMessage, response: ServerResponse): string => {
    const existing = read(request); if (existing) return existing;
    const id = randomBytes(24).toString('base64url');
    response.appendHeader('Set-Cookie', `${cookieName}=${id}.${sign(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
    return id;
  };
  return Object.assign(resolve, { read });
}
