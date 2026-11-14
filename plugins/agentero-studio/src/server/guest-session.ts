import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export function createGuestSessions(dataRoot: string) {
  const secret = randomBytes(32);
  // Cookies are host scoped, so isolate instances even when their ports differ.
  const cookieName = `studio-guest-${createHash('sha256').update(dataRoot).update(secret).digest('hex').slice(0, 24)}`;
  const sign = (id: string) => createHmac('sha256', secret).update(id).digest('base64url');
  return (request: IncomingMessage, response: ServerResponse): string => {
    const value = request.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    const signed = value && /^([A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{43})$/.exec(value);
    if (signed && timingSafeEqual(Buffer.from(signed[2]!), Buffer.from(sign(signed[1]!)))) return signed[1]!;
    const id = randomBytes(24).toString('base64url');
    response.appendHeader('Set-Cookie', `${cookieName}=${id}.${sign(id)}; Path=/; HttpOnly; SameSite=Lax`);
    return id;
  };
}
