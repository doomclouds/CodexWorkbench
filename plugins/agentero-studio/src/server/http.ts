import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { TOOL_NAMES, type Actor, type Role, type ToolName } from '../contracts/studio.js';
import { StudioError, StudioService, type StudioAuthority } from '../core/service.js';
import { safeId, text } from '../core/shared/common.js';
import { MAX_ARCHIVE_BYTES } from '../core/shared/archive.js';
import { createGuestSessions } from './guest-session.js';
import { createRegionReaders } from './region-reader.js';
import { lanAddresses } from './lan-addresses.js';
import { createCollaborationRoutes } from './collaboration-routes.js';
import { SERVICE_PROTOCOL_VERSION } from './service-protocol.js';
import { PLUGIN_VERSION } from '../contracts/version.js';

interface Auth { actor: Actor; token: string; artifactId?: string; owner: boolean; access: 'local' | 'lan'; viaLan: boolean; authority: StudioAuthority }
interface Invitation { title: string; role: Exclude<Role, 'owner'> }
export interface StudioHost { service: StudioService; origin: string; token: string; hasActiveReaders(): boolean; close(): Promise<void> }
const MAX_BODY = 21 * 1024 * 1024;
// A listening socket on one of these ports is still rejected by browser Fetch.
// https://fetch.spec.whatwg.org/#port-blocking
const BROWSER_BLOCKED_PORTS = new Set([
  0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179,
  389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601,
  636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000,
  6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);
const json = (response: ServerResponse, status: number, value: unknown) => {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': Buffer.byteLength(body) }); response.end(body);
};
function equal(a: string, b: string) { const left = Buffer.from(a), right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
function failure(response: ServerResponse, error: unknown) {
  if (response.headersSent) { response.end(); return; }
  const code = error instanceof StudioError ? error.code : 'INTERNAL_ERROR';
  const status = ({ UNAUTHORIZED: 401, FORBIDDEN: 403, NAME_REQUIRED: 428, NAME_TAKEN: 409, NAME_ALREADY_SET: 409, NOT_FOUND: 404, TRASHED: 410, CONFLICT: 409, OPERATION_REUSED: 409, TOO_LARGE: 413, BUSY: 409, CLOSED: 503 } as Record<string, number>)[code] ?? (error instanceof StudioError ? 400 : 500);
  const details = error instanceof StudioError && error.details !== undefined ? error.details : code === 'UNAUTHORIZED' ? { reason: 'invalid-link' } : undefined;
  json(response, status, { ok: false, error: { code, message: error instanceof Error ? error.message : 'Studio 操作失败。', ...(details !== undefined ? { details } : {}) } });
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
function accessPage(response: ServerResponse, status: number, title: string, content: string) {
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Agentero 创作</title><style>
:root{color-scheme:light dark;--bg:#f7f6f3;--card:#fff;--fg:#1f1e1d;--muted:#6b6a66;--line:#e3e1dc;--accent:#c96442}
@media(prefers-color-scheme:dark){:root{--bg:#1f1e1d;--card:#2a2927;--fg:#f2f1ee;--muted:#a8a6a0;--line:#3a3936}}
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Microsoft YaHei",sans-serif}
main{width:min(420px,100%);padding:28px;background:var(--card);border:1px solid var(--line);border-radius:14px}h1{font-size:20px;line-height:1.4;margin:0 0 8px;overflow-wrap:anywhere}p{margin:0 0 20px;color:var(--muted)}
label{display:block;font-size:13px;margin-bottom:8px;color:var(--muted)}input,button{width:100%;font:inherit;border-radius:8px}input{padding:10px 11px;border:1px solid var(--line);background:transparent;color:inherit}button{margin-top:16px;padding:10px;border:0;background:var(--accent);color:#fff;font-weight:600;cursor:pointer}
input:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.note{margin:14px 0 0;font-size:12px}[role=alert]{color:light-dark(#a53131,#ff9b9b)}
</style></head><body><main>${content}</main></body></html>`;
  response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", 'Content-Length': Buffer.byteLength(html) }); response.end(html);
}
function namePage(response: ServerResponse, artifactId: string, token: string, invitation: Invitation, error = '', name = '', status = 200) {
  const action = `/api/session?${new URLSearchParams({ artifactId, share: token })}`;
  const role = { editor: '编辑', commenter: '评论', viewer: '查看' }[invitation.role];
  accessPage(response, status, invitation.title, `<h1>${escapeHtml(invitation.title)}</h1><p>你被邀请${role}这块白板。</p>${error ? `<p role="alert">${escapeHtml(error)}</p>` : ''}<form method="post" action="${escapeHtml(action)}"><label for="guest-name">你的名字（别人会在你的评论和编辑上看到它）</label><input id="guest-name" name="name" autocomplete="nickname" maxlength="60" required autofocus value="${escapeHtml(name)}"><button type="submit">打开白板</button></form><p class="note">这个浏览器会记住你的身份；所有者可以随时移除。</p>`);
}
function deniedPage(response: ServerResponse, error: StudioError) {
  const reason = (error.details as { reason?: string } | undefined)?.reason;
  const messages: Record<string, string> = { removed: '所有者已移除你的访问权限。', 'sharing-closed': '这块白板的分享已关闭。', 'link-disabled': '这个角色的邀请链接已停用。', 'link-reset': '这个邀请链接已重置，旧链接已失效。', 'local-only': '这块白板目前仅允许在所有者电脑上访问。', 'invalid-link': '这个分享链接无效。' };
  accessPage(response, error.code === 'FORBIDDEN' ? 403 : 401, '无权访问', `<h1>无权访问</h1><p>${escapeHtml(messages[reason ?? ''] ?? '这块白板没有分享给你。')}请向所有者索取有效链接。</p>`);
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
  for (let attempt = 0; attempt < 8; attempt++) {
    await new Promise<void>((resolve, reject) => { const failed = (error: Error) => reject(error); server.once('error', failed); server.listen(port, host, () => { server.removeListener('error', failed); resolve(); }); });
    const assigned = (server.address() as AddressInfo).port;
    if (!BROWSER_BLOCKED_PORTS.has(assigned)) return assigned;
    await closeServer(server);
  }
  throw new StudioError('NO_NETWORK', '无法分配浏览器可访问的端口，请重试。');
}
function closeServer(server: Server | undefined): Promise<void> {
  if (!server?.listening) return Promise.resolve();
  return new Promise(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
}
function lanAddress() {
  const addresses = lanAddresses();
  if (!addresses.length) throw new StudioError('NO_NETWORK', '没有可用于局域网分享的普通网卡，请连接 Wi-Fi 或以太网后重试。');
  return addresses[0]!;
}
function header(request: IncomingMessage, key: string) { const value = request.headers[key]; return typeof value === 'string' ? value : ''; }
function exportContentType(mimeType: string) {
  const mediaType = mimeType.split(';', 1)[0]!.trim().toLowerCase();
  return mediaType.startsWith('text/') || mediaType === 'image/svg+xml' || mediaType === 'application/json' ? `${mediaType}; charset=utf-8` : mimeType;
}
export async function startStudioHost(options: { dataRoot?: string; html?: string; port?: number; ownerName?: string } = {}): Promise<StudioHost> {
  if (options.port && BROWSER_BLOCKED_PORTS.has(options.port)) throw new StudioError('INVALID_ARGUMENT', `浏览器禁止访问端口 ${options.port}，请选择其他端口。`);
  const service = new StudioService({ dataRoot: options.dataRoot, ownerName: options.ownerName }), token = randomBytes(32).toString('base64url');
  const guestSession = await createGuestSessions(service.dataRoot);
  const regionReaders = createRegionReaders(service);
  const servers = new Set<Server>(), sockets = new Set<Socket>();
  let origin = '', lan: Server | undefined, sharingOrigin = '', startingLan: Promise<string> | undefined, stopping = false;
  function server() {
    const instance = createServer((request, response) => { void handle(request, response).catch(error => failure(response, error)); });
    instance.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    instance.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
    servers.add(instance); return instance;
  }
  const local = server();
  const viaLan = (request: IncomingMessage) => request.socket.localPort !== (local.address() as AddressInfo | null)?.port;
  const providedToken = (request: IncomingMessage, url: URL) => header(request, 'authorization').replace(/^Bearer\s+/i, '') || url.searchParams.get('token') || url.searchParams.get('share') || '';
  async function authorize(request: IncomingMessage, response: ServerResponse, url: URL, artifactId?: string, registration?: { name: unknown }): Promise<Auth> {
    const provided = providedToken(request, url), scope = artifactId ?? url.searchParams.get('artifactId') ?? undefined, lanRequest = viaLan(request);
    if (provided && equal(provided, token)) {
      const access = scope ? await service.accessMode(scope, lanRequest, true) : 'local';
      let agentName = header(request, 'x-studio-agent-name');
      if (agentName) { try { agentName = decodeURIComponent(agentName); } catch { throw new StudioError('INVALID_ARGUMENT', 'Agent 名称编码无效。'); } }
      const actor: Actor = header(request, 'x-studio-actor') === 'agent' ? { id: header(request, 'x-studio-agent-id') ? safeId(header(request, 'x-studio-agent-id'), 'Agent ID') : 'codex', name: agentName ? text(agentName, 'Codex', 60).trim() || 'Codex' : 'Codex', kind: 'agent', role: 'owner' } : { ...service.owner };
      return { actor, token: provided, owner: true, access, viaLan: lanRequest, authority: { owner: true, actorId: actor.id, viaLan: lanRequest }, ...(scope ? { artifactId: scope } : {}) };
    }
    const access = scope ? await service.accessMode(scope, lanRequest) : 'local';
    if (scope) {
      const id = provided ? guestSession(request, response) : guestSession.read(request);
      if (!id) throw new StudioError('UNAUTHORIZED', '请使用有效邀请链接加入白板。', { reason: 'invalid-link' });
      if (!provided && request.method !== 'GET' && request.method !== 'OPTIONS') {
        const requestOrigin = header(request, 'origin'), expectedOrigin = `http://${header(request, 'host')}`;
        if (requestOrigin && requestOrigin !== expectedOrigin) throw new StudioError('FORBIDDEN', '不能从其他来源使用白板会话修改内容。');
      }
      const actor = await service.guestActor(scope, provided || undefined, `guest-${id}`, registration, lanRequest);
      return { actor, token: provided, artifactId: scope, owner: false, access, viaLan: lanRequest, authority: { owner: false, actorId: actor.id, credential: provided || undefined, viaLan: lanRequest } };
    }
    throw new StudioError('UNAUTHORIZED', '分享链接无效。', { reason: 'invalid-link' });
  }
  function scope(auth: Auth, artifactId: unknown) { if (!auth.owner && artifactId !== auth.artifactId) throw new StudioError('FORBIDDEN', '分享链接只能访问对应的作品。'); }
  const collaborationRoutes = createCollaborationRoutes({ service, authorize, scope, readJson, json });
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
    if (await collaborationRoutes.handle(request, response, url)) return;
    if (url.pathname === '/api/region-view' && (request.method === 'POST' || request.method === 'GET')) {
      const input = request.method === 'POST' ? await readJson(request) : {}, artifactId = typeof input.artifactId === 'string' ? input.artifactId : url.searchParams.get('artifactId') ?? '';
      const auth = await authorize(request, response, url, artifactId); scope(auth, artifactId);
      // Use the listener's known address, never a caller-controlled Host header.
      const readerOrigin = request.socket.localPort === (local.address() as AddressInfo)?.port ? origin : sharingOrigin;
      const data = request.method === 'POST' ? await regionReaders.create(auth, input, readerOrigin) : await regionReaders.takeReturn(auth, artifactId, url.searchParams.get('viewId') ?? '');
      json(response, 200, { ok: true, data }); return;
    }
    const reader = /^\/api\/region-reader\/([^/]+)\/([^/]+)(\/return)?$/.exec(url.pathname);
    if (reader && (request.method === 'GET' && !reader[3] || request.method === 'POST' && reader[3])) {
      const capability = header(request, 'authorization').replace(/^Bearer\s+/i, '');
      const artifactId = decodeURIComponent(reader[1]!), regionId = decodeURIComponent(reader[2]!);
      await service.accessMode(artifactId, viaLan(request));
      if ([...url.searchParams.keys()].some(key => key !== 'metadata') || url.searchParams.has('metadata') && url.searchParams.get('metadata') !== '1') throw new StudioError('INVALID_ARGUMENT', '阅读请求参数无效。');
      let data;
      if (reader[3]) {
        const input = await readJson(request);
        if (Object.keys(input).some(key => key !== 'annotate') || typeof input.annotate !== 'boolean') throw new StudioError('INVALID_ARGUMENT', '返回白板请求无效。');
        data = await regionReaders.returnToBoard(capability, artifactId, regionId, input.annotate);
      } else data = await regionReaders.source(capability, artifactId, regionId, url.searchParams.get('metadata') === '1');
      json(response, 200, { ok: true, data }); return;
    }
    const readerPage = /^\/region\/([A-Za-z0-9][A-Za-z0-9_-]{0,119})\/([A-Za-z0-9][A-Za-z0-9_-]{0,119})$/.exec(url.pathname);
    if (readerPage && request.method === 'GET') {
      const boot = JSON.stringify({ artifactId: readerPage[1], regionId: readerPage[2] }).replace(/</g, '\\u003c');
      const script = `<script>window.__STUDIO_READER_BOOT__=${boot};</script>`, raw = options.html ?? '<!doctype html><html><head><meta charset="utf-8"><title>Agentero Studio</title></head><body><main id="root">Agentero Studio</main></body></html>';
      const html = /<head\b[^>]*>/i.test(raw) ? raw.replace(/<head\b[^>]*>/i, opening => opening + script) : `${script}${raw}`;
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': Buffer.byteLength(html) }); response.end(html); return;
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/thumbnails/')) {
      const artifactId = decodeURIComponent(url.pathname.slice('/api/thumbnails/'.length));
      const auth = await authorize(request, response, url, artifactId); scope(auth, artifactId);
      const thumbnail = await service.getThumbnail(artifactId, auth.actor);
      response.writeHead(200, { 'Content-Type': thumbnail.mimeType, 'Content-Length': thumbnail.data.byteLength, 'Cache-Control': 'private, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-src 'none'; sandbox" });
      response.end(thumbnail.data); return;
    }
    if (url.pathname.startsWith('/api/tools/') && request.method === 'POST') {
      const name = decodeURIComponent(url.pathname.slice('/api/tools/'.length));
      if (!TOOL_NAMES.includes(name as ToolName)) throw new StudioError('UNKNOWN_TOOL', 'Studio 操作不存在。');
      const envelope = await readJson(request);
      const args = envelope.arguments && typeof envelope.arguments === 'object' && !Array.isArray(envelope.arguments) ? envelope.arguments as Record<string, unknown> : envelope.args && typeof envelope.args === 'object' && !Array.isArray(envelope.args) ? envelope.args as Record<string, unknown> : envelope;
      const createsArtifact = name === 'artifact_manage' && ['create', 'import'].includes(typeof args.action === 'string' ? args.action : 'create');
      const artifactId = createsArtifact && equal(providedToken(request, url), token) ? '' : typeof args.artifactId === 'string' ? args.artifactId : undefined;
      const auth = await authorize(request, response, url, artifactId); scope(auth, artifactId);
      if (!auth.owner && (['artifact_list', 'artifact_manage'].includes(name) || name === 'artifact_share' && args.action !== undefined && args.action !== 'status')) throw new StudioError('FORBIDDEN', '访客不能管理作品库或分享权限。');
      if (!auth.owner && name === 'studio_open') args.artifactId = auth.artifactId;
      const data = await service.execute(name as ToolName, args, auth.actor, auth.authority); json(response, 200, { ok: true, data }); return;
    }
    if (url.pathname === '/api/session' && request.method === 'POST') {
      const form = /^application\/x-www-form-urlencoded(?:;|$)/i.test(header(request, 'content-type'));
      const input = form ? Object.fromEntries(new URLSearchParams((await body(request, 8192)).toString('utf8'))) : await readJson(request);
      const artifactId = typeof input.artifactId === 'string' ? input.artifactId : url.searchParams.get('artifactId') ?? '';
      try {
        const auth = await authorize(request, response, url, artifactId, { name: input.name });
        if (form && !auth.owner) { response.writeHead(303, { Location: `/?${new URLSearchParams({ artifactId })}`, 'Cache-Control': 'no-store' }); response.end(); }
        else json(response, 200, { actor: auth.actor, artifactId: auth.artifactId, owner: auth.owner, access: auth.access, serviceProtocol: SERVICE_PROTOCOL_VERSION, pluginVersion: PLUGIN_VERSION, agentAvailable: false });
      } catch (error) {
        if (!form || !(error instanceof StudioError)) throw error;
        const invitation = (error.details as { invitation?: Invitation } | undefined)?.invitation;
        if (error.code === 'UNAUTHORIZED' || error.code === 'FORBIDDEN') deniedPage(response, error);
        else if (invitation) namePage(response, artifactId, providedToken(request, url), invitation, error.message, typeof input.name === 'string' ? input.name : '', ['NAME_TAKEN', 'NAME_ALREADY_SET'].includes(error.code) ? 409 : 400);
        else throw error;
      }
      return;
    }
    if (url.pathname === '/api/session' && request.method === 'GET') {
      const auth = await authorize(request, response, url);
      json(response, 200, { actor: auth.actor, artifactId: auth.artifactId, owner: auth.owner, access: auth.access, serviceProtocol: SERVICE_PROTOCOL_VERSION, pluginVersion: PLUGIN_VERSION, agentAvailable: false }); return;
    }
    if (url.pathname === '/api/assets' && request.method === 'POST') {
      const artifactId = url.searchParams.get('artifactId') ?? '', auth = await authorize(request, response, url, artifactId); scope(auth, artifactId);
      let filename = header(request, 'x-filename') || 'resource'; try { filename = decodeURIComponent(filename); } catch { /* A literal filename is still usable. */ }
      const result = await service.putAsset(artifactId, await body(request, 20 * 1024 * 1024), { filename, mimeType: header(request, 'x-content-type') || header(request, 'content-type') }, auth.actor, auth.authority);
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
      response.writeHead(200, { 'Content-Type': exportContentType(result.mimeType), 'Content-Length': result.size, 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`, 'X-Content-Type-Options': 'nosniff' }); response.end(result.data); return;
    }
    if ((url.pathname === '/' || url.pathname === '/index.html') && request.method === 'GET') {
      let auth: Auth;
      try { auth = await authorize(request, response, url); }
      catch (error) {
        if (!(error instanceof StudioError)) throw error;
        const invitation = (error.details as { invitation?: Invitation } | undefined)?.invitation;
        if (error.code === 'NAME_REQUIRED' && invitation) namePage(response, url.searchParams.get('artifactId') ?? '', providedToken(request, url), invitation);
        else if (error.code === 'UNAUTHORIZED' || error.code === 'FORBIDDEN') deniedPage(response, error);
        else throw error;
        return;
      }
      const boot = JSON.stringify({ baseUrl: `http://${request.headers.host ?? new URL(origin).host}`, token: auth.owner ? auth.token : '', actor: auth.actor, access: auth.access, serviceProtocol: SERVICE_PROTOCOL_VERSION, pluginVersion: PLUGIN_VERSION, ...(auth.artifactId ? { artifactId: auth.artifactId } : url.searchParams.get('artifactId') ? { artifactId: url.searchParams.get('artifactId') } : {}) }).replace(/</g, '\\u003c');
      const script = `<script>window.__STUDIO_BOOT__=${boot};</script>`, raw = options.html ?? '<!doctype html><html><head><meta charset="utf-8"><title>Agentero Studio</title></head><body><main id="root">Agentero Studio</main></body></html>';
      // Bundled JavaScript can contain literal closing head tags from HTML exports.
      const html = /<head\b[^>]*>/i.test(raw) ? raw.replace(/<head\b[^>]*>/i, opening => opening + script) : `${script}${raw}`;
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': Buffer.byteLength(html) }); response.end(html); return;
    }
    throw new StudioError('NOT_FOUND', '页面不存在。');
  }
  try { await service.resetSharingSessions(); const port = await listen(local, options.port ?? 0, '127.0.0.1'); origin = `http://127.0.0.1:${port}`; service.configureLocalOrigin(origin); }
  catch (error) { await service.close(); throw error; }
  return { service, origin, token, hasActiveReaders: regionReaders.hasActiveReaders, async close() {
    if (stopping) return; stopping = true;
    collaborationRoutes.close();
    regionReaders.close();
    await Promise.all([...servers].map(closeServer)); for (const socket of sockets) socket.destroy(); await service.resetSharingSessions(); await service.close();
  } };
}
