import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export function createGuestSessions(secret: Buffer) {
  const cookieName = `studio-guest-${createHash('sha256').update(secret).digest('hex').slice(0, 24)}`;
  const sign = (id: string) => createHmac('sha256', secret).update(id).digest('base64url');
  const read = (request: IncomingMessage): string | undefined => {
    const value = request.headers.cookie
      ?.split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    const signed = value && /^([A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{43})$/.exec(value);
    if (signed && timingSafeEqual(Buffer.from(signed[2]!), Buffer.from(sign(signed[1]!)))) {
      return signed[1]!;
    }
  };
  const resolve = (request: IncomingMessage, response: ServerResponse): string => {
    const existing = read(request);
    if (existing) {
      return existing;
    }

    const id = randomBytes(24).toString('base64url');
    response.appendHeader(
      'Set-Cookie',
      `${cookieName}=${id}.${sign(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`,
    );

    return id;
  };

  return Object.assign(resolve, { read });
}
