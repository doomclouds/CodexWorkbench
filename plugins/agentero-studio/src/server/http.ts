import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import type { AddressInfo, Socket } from 'node:net';
import { LOCAL_ACTOR, TOOL_NAMES, type Actor, type Role, type ToolName } from '../contracts/studio.js';
import { StudioError, StudioService } from '../core/service.js';
import { MAX_ARCHIVE_BYTES } from '../core/shared/archive.js';
import { createGuestSessions } from './guest-session.js';

interface Auth { actor: Actor; token: string; artifactId?: string; owner: boolean }
interface Live { response: ServerResponse; auth: Auth; artifactId: string; dispose: () => void }
export interface StudioHost { service: StudioService; origin: string; token: string; close(): Promise<void> }
const MAX_BODY = 21 * 1024 * 1024;
const json = (response: ServerResponse, status: number, value: unknown) => {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': Buffer.byteLength(body) }); response.end(body);
};
function equal(a: string, b: string) { const left = Buffer.from(a), right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
function failure(response: ServerResponse, error: unknown) {
  if (response.headersSent) { response.end(); return; }
  const code = error instanceof StudioError ? error.code : 'INTERNAL_ERROR';
  const status = ({ UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, TRASHED: 410, CONFLICT: 409, OPERATION_REUSED: 409, TOO_LARGE: 413, BUSY: 409, CLOSED: 503 } as Record<string, number>)[code] ?? (error instanceof StudioError ? 400 : 500);
  json(response, status, { ok: false, error: { code, message: error instanceof Error ? error.message : 'Studio 操作失败。', ...(error instanceof StudioError && error.details !== undefined ? { details: error.details } : {}) } });
}
async function body(request: IncomingMessage, maximum = MAX_BODY) {
  if (Number(request.headers['content-length']) > maximum) { request.resume(); throw new StudioError('TOO_LARGE', '请求内容过大。'); }
  const parts: Uint8Array[] = []; let size = 0;
  for await (const part of request) { const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part); size += bytes.length; if (size > maximum) throw new StudioError('TOO_LARGE', '请求内容过大。'); parts.push(bytes); }
  return Buffer.concat(parts);
}
async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  try { const bytes = await body(request, 9 * 1024 * 1024), value = bytes.length ? JSON.parse(bytes.toString('utf8')) : {}; if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; }
  catch (error) { if (error instanceof StudioError) throw error; throw new StudioError('INVALID_ARGUMENT', '请求必须是 JSON 对象。'); }
}
async function listen(server: Server, port: number, host: string) {
  await new Promise<void>((resolve, reject) => { const failed = (error: Error) => reject(error); server.once('error', failed); server.listen(port, host, () => { server.removeListener('error', failed); resolve(); }); });
  return (server.address() as AddressInfo).port;
}
function closeServer(server: Server | undefined): Promise<void> {
  if (!server?.listening) return Promise.resolve();
  return new Promise(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
}
function lanAddress() {
  const addresses = Object.entries(networkInterfaces()).flatMap(([name, entries]) => (entries ?? []).filter(entry => entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.')).map(entry => ({ name, address: entry.address })));
  addresses.sort((a, b) => Number(/vpn|tun|docker|virtual|veth|wsl/i.test(a.name)) - Number(/vpn|tun|docker|virtual|veth|wsl/i.test(b.name)));
  if (!addresses.length) throw new StudioError('NO_NETWORK', '没有可用于局域网分享的网卡，请连接网络后重试。');
  return addresses[0]!.address;
}
function header(request: IncomingMessage, key: string) { const value = request.headers[key]; return typeof value === 'string' ? value : ''; }
export async function startStudioHost(options: { dataRoot?: string; html?: string; port?: number } = {}): Promise<StudioHost> {
  const service = new StudioService({ dataRoot: options.dataRoot }), token = randomBytes(32).toString('base64url');
  const guestSession = createGuestSessions(service.dataRoot);
  const lives = new Set<Live>(), servers = new Set<Server>(), sockets = new Set<Socket>();
  let origin = '', lan: Server | undefined, sharingOrigin = '', startingLan: Promise<string> | undefined, stopping = false;
  function server() {
    const instance = createServer((request, response) => { void handle(request, response).catch(error => failure(response, error)); });
    instance.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    instance.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
    servers.add(instance); return instance;
  }
  const local = server();
  async function authorize(request: IncomingMessage, response: ServerResponse, url: URL, artifactId?: string): Promise<Auth> {
    const bearer = header(request, 'authorization').replace(/^Bearer\s+/i, '');
    const provided = bearer || url.searchParams.get('token') || url.searchParams.get('share') || '';
    if (provided && equal(provided, token)) {
      const actor: Actor = header(request, 'x-studio-actor') === 'agent' ? { id: 'codex', name: 'Codex', kind: 'agent', role: 'owner' } : { ...LOCAL_ACTOR };
      return { actor, token: provided, owner: true, ...(artifactId ? { artifactId } : {}) };
    }
    const scope = artifactId ?? url.searchParams.get('artifactId') ?? undefined;
    if (scope && provided) {
      const role = await service.shareRole(scope, provided);
      if (role) { const id = guestSession(request, response); return { actor: { id: `guest-${id}`, name: (header(request, 'x-studio-name') || `访客 ${id.slice(0, 6)}`).slice(0, 60), kind: 'human', role }, token: provided, artifactId: scope, owner: false }; }
    }
    throw new StudioError('UNAUTHORIZED', '连接凭据无效，或分享已关闭。');
  }
  function scope(auth: Auth, artifactId: unknown) { if (!auth.owner && artifactId !== auth.artifactId) throw new StudioError('FORBIDDEN', '分享链接只能访问对应的作品。'); }
  function endLive(live: Live, reason: string) {
    if (!lives.delete(live)) return;
    live.response.write(`data: ${JSON.stringify({ type: 'access-revoked', artifactId: live.artifactId, reason })}\n\n`); live.dispose(); live.response.end();
  }
  service.subscribe('*', event => {
    if (event.type !== 'share') return;
    for (const live of [...lives]) if (!live.auth.owner && live.artifactId === event.artifactId && (event.enabled === false || Array.isArray(event.revokedRoles) && event.revokedRoles.includes(live.auth.actor.role))) endLive(live, '分享已关闭或链接已重置。');
  });
  service.configureSharing(async enabled => {
    if (enabled) {
      if (lan?.listening) return sharingOrigin;
      startingLan ??= (async () => { const address = lanAddress(), instance = server(); try { const port = await listen(instance, 0, '0.0.0.0'); lan = instance; sharingOrigin = `http://${address}:${port}`; return sharingOrigin; } catch (error) { servers.delete(instance); await closeServer(instance); throw error; } })().finally(() => { startingLan = undefined; });
      return startingLan;
    }
    if (lan && !await service.hasShares()) { const instance = lan; lan = undefined; sharingOrigin = ''; await closeServer(instance); servers.delete(instance); }
    return undefined;
  });
  async function handle(request: IncomingMessage, response: ServerResponse) {
    if (stopping) throw new StudioError('CLOSED', 'Studio 服务正在退出。');
    const url = new URL(request.url ?? '/', 'http://studio.local');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-Studio-Actor,X-Studio-Peer-Id,X-Studio-Name,X-Filename,X-Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    if (request.method === 'GET' && url.pathname.startsWith('/api/thumbnails/')) {
      const artifactId = decodeURIComponent(url.pathname.slice('/api/thumbnails/'.length));
      const auth = await authorize(request, response, url, artifactId); scope(auth, artifactId);
      const thumbnail = await service.getThumbnail(artifactId);
      response.writeHead(200, { 'Content-Type': thumbnail.mimeType, 'Content-Length': thumbnail.data.byteLength, 'Cache-Control': 'private, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-src 'none'; sandbox" });
      response.end(thumbnail.data); return;
    }
    if (url.pathname.startsWith('/api/tools/') && request.method === 'POST') {
      const name = decodeURIComponent(url.pathname.slice('/api/tools/'.length));
      if (!TOOL_NAMES.includes(name as ToolName)) throw new StudioError('UNKNOWN_TOOL', 'Studio 操作不存在。');
      const envelope = await readJson(request);
      const args = envelope.arguments && typeof envelope.arguments === 'object' && !Array.isArray(envelope.arguments) ? envelope.arguments as Record<string, unknown> : envelope.args && typeof envelope.args === 'object' && !Array.isArray(envelope.args) ? envelope.args as Record<string, unknown> : envelope;
      const artifactId = typeof args.artifactId === 'string' ? args.artifactId : undefined;
      const auth = await authorize(request, response, url, artifactId); scope(auth, artifactId);
      if (!auth.owner && ['artifact_list', 'artifact_manage', 'artifact_share'].includes(name)) throw new StudioError('FORBIDDEN', '访客不能管理作品库或分享权限。');
      if (!auth.owner && name === 'studio_open') args.artifactId = auth.artifactId;
      const data = await service.execute(name as ToolName, args, auth.actor); json(response, 200, { ok: true, data }); return;
    }
    if (url.pathname === '/api/session' && request.method === 'GET') {
      const auth = await authorize(request, response, url);
      json(response, 200, { actor: auth.actor, artifactId: auth.artifactId, owner: auth.owner, agentAvailable: false }); return;
    }
    if (url.pathname === '/api/events' && request.method === 'GET') {
      const artifactId = url.searchParams.get('artifactId') ?? '', auth = await authorize(request, response, url, artifactId || undefined); scope(auth, artifactId || undefined);
      if (artifactId) await service.execute('artifact_read', { artifactId, mode: 'summary' }, auth.actor);
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      response.write(`retry: 1500\ndata: ${JSON.stringify({ type: 'ready', artifactId, actor: auth.actor })}\n\n`);
      const unsubscribe = service.subscribe(artifactId, event => { if (!response.writableEnded) response.write(`data: ${JSON.stringify(event)}\n\n`); });
      const timer = setInterval(() => { if (!response.writableEnded) response.write(': keep-alive\n\n'); }, 15_000); timer.unref();
      const live: Live = { response, auth, artifactId, dispose: () => { clearInterval(timer); unsubscribe(); } }; lives.add(live);
      response.on('close', () => { lives.delete(live); live.dispose(); }); return;
    }
    if (url.pathname === '/api/presence' && (request.method === 'GET' || request.method === 'POST')) {
      const input = request.method === 'POST' ? await readJson(request) : {}, artifactId = typeof input.artifactId === 'string' ? input.artifactId : url.searchParams.get('artifactId') ?? '';
      const auth = await authorize(request, response, url, artifactId); scope(auth, artifactId);
      const result = request.method === 'POST' ? await service.updatePresence(artifactId, input, auth.actor) : { peers: service.getPresence(artifactId), timer: service.getTimer(artifactId) };
      json(response, 200, result); return;
    }
    if (url.pathname === '/api/assets' && request.method === 'POST') {
      const artifactId = url.searchParams.get('artifactId') ?? '', auth = await authorize(request, response, url, artifactId); scope(auth, artifactId);
      let filename = header(request, 'x-filename') || 'resource'; try { filename = decodeURIComponent(filename); } catch { /* A literal filename is still usable. */ }
      const result = await service.putAsset(artifactId, await body(request, 20 * 1024 * 1024), { filename, mimeType: header(request, 'x-content-type') || header(request, 'content-type') }, auth.actor);
      json(response, 200, result); return;
    }
    if (url.pathname === '/api/import' && request.method === 'POST') {
      // Uploads come directly from the owner's file picker, never through model context.
      if (!/^Bearer\s+/i.test(header(request, 'authorization'))) throw new StudioError('UNAUTHORIZED', '导入备份需要所有者凭据。');
      const auth = await authorize(request, response, url);
      if (!auth.owner) throw new StudioError('FORBIDDEN', '只有所有者可以导入作品备份。');
      if (header(request, 'content-type').split(';')[0]?.trim().toLowerCase() !== 'application/zip') throw new StudioError('INVALID_ARGUMENT', '请上传 ZIP 备份文件。');
      const data = await service.importArchive(await body(request, MAX_ARCHIVE_BYTES), auth.actor);
      json(response, 200, { ok: true, data }); return;
    }
    const asset = /^\/assets\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (asset && request.method === 'GET') {
      const artifactId = decodeURIComponent(asset[1]!), auth = await authorize(request, response, url, artifactId); scope(auth, artifactId);
      const result = await service.getAsset(artifactId, decodeURIComponent(asset[2]!));
      response.writeHead(200, { 'Content-Type': result.mimeType, 'Content-Length': result.size, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" }); response.end(result.data); return;
    }
    const exported = /^\/api\/exports\/([^/]+)$/.exec(url.pathname);
    if (exported && request.method === 'GET') {
      const result = await service.getExport(decodeURIComponent(exported[1]!)), auth = await authorize(request, response, url, result.artifactId); scope(auth, result.artifactId);
      if (result.mimeType === 'application/zip' && !auth.owner) throw new StudioError('FORBIDDEN', '只有所有者可以下载包含历史和反馈的作品备份。');
      response.writeHead(200, { 'Content-Type': result.mimeType, 'Content-Length': result.size, 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`, 'X-Content-Type-Options': 'nosniff' }); response.end(result.data); return;
    }
    if ((url.pathname === '/' || url.pathname === '/index.html') && request.method === 'GET') {
      const auth = await authorize(request, response, url);
      const boot = JSON.stringify({ baseUrl: `http://${request.headers.host ?? new URL(origin).host}`, token: auth.token, actor: auth.actor, ...(auth.artifactId ? { artifactId: auth.artifactId } : url.searchParams.get('artifactId') ? { artifactId: url.searchParams.get('artifactId') } : {}) }).replace(/</g, '\\u003c');
      const script = `<script>window.__STUDIO_BOOT__=${boot};</script>`, raw = options.html ?? '<!doctype html><html><head><meta charset="utf-8"><title>Agentero Studio</title></head><body><main id="root">Agentero Studio</main></body></html>';
      // Bundled JavaScript can contain literal closing head tags from HTML exports.
      const html = /<head\b[^>]*>/i.test(raw) ? raw.replace(/<head\b[^>]*>/i, opening => opening + script) : `${script}${raw}`;
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': Buffer.byteLength(html) }); response.end(html); return;
    }
    throw new StudioError('NOT_FOUND', '页面不存在。');
  }
  try { await service.resetSharingSessions(); const port = await listen(local, options.port ?? 0, '127.0.0.1'); origin = `http://127.0.0.1:${port}`; }
  catch (error) { await service.close(); throw error; }
  return { service, origin, token, async close() {
    if (stopping) return; stopping = true;
    for (const live of [...lives]) endLive(live, 'Studio 服务已退出。');
    await Promise.all([...servers].map(closeServer)); for (const socket of sockets) socket.destroy(); await service.resetSharingSessions(); await service.close();
  } };
}
