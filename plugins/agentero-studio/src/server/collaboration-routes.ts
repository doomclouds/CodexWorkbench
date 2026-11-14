import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Actor, StudioEvent } from '../contracts/studio.js';
import type { StudioAuthority, StudioService } from '../core/service.js';
import { StudioError } from '../core/shared/common.js';

interface Auth { actor: Actor; owner: boolean; access: 'local' | 'lan'; viaLan: boolean; artifactId?: string; authority: StudioAuthority }
interface Live { response: ServerResponse; auth: Auth; artifactId: string; dispose(): void }
interface Dependencies {
  service: StudioService;
  authorize(request: IncomingMessage, response: ServerResponse, url: URL, artifactId?: string): Promise<Auth>;
  scope(auth: Auth, artifactId: unknown): void;
  readJson(request: IncomingMessage): Promise<Record<string, unknown>>;
  json(response: ServerResponse, status: number, value: unknown): void;
}
function revoked(auth: Auth, event: StudioEvent): boolean {
  return event.type === 'share' && (event.access === 'local' && auth.viaLan || !auth.owner && (event.enabled === false || Array.isArray(event.revokedRoles) && event.revokedRoles.includes(auth.actor.role) || Array.isArray(event.revokedMemberIds) && event.revokedMemberIds.includes(auth.actor.id)));
}
function sequence(cursor: unknown): number { return typeof cursor === 'string' ? Number(cursor.slice(cursor.lastIndexOf(':') + 1)) : -1; }

/** Web keeps a stream; the public App bridge receives bounded, cancellable sync requests. */
export function createCollaborationRoutes({ service, authorize, scope, readJson, json }: Dependencies) {
  const lives = new Set<Live>(), pending = new Set<AbortController>();
  const unsubscribe = service.subscribe('*', event => {
    for (const live of lives) if (live.artifactId === event.artifactId && revoked(live.auth, event)) {
      if (live.response.headersSent) live.response.write(`data: ${JSON.stringify({ type: 'access-revoked', artifactId: live.artifactId, reason: event.reason ?? 'invalid-link', cursor: event.cursor })}\n\n`);
      else json(live.response, 403, { ok: false, error: { code: 'FORBIDDEN', message: '白板访问权限已变更。', details: { reason: event.reason ?? 'invalid-link' } } });
      live.dispose(); live.response.end();
    }
  });
  return {
    async handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
      const path = url.pathname;
      if (!['/api/sync', '/api/events', '/api/presence', '/api/room'].includes(path)) return false;
      if (path === '/api/sync' && request.method !== 'GET' || path === '/api/events' && request.method !== 'GET' || path === '/api/room' && request.method !== 'POST' || path === '/api/presence' && !['GET', 'POST'].includes(request.method ?? '')) return false;
      const input = request.method === 'POST' ? await readJson(request) : {};
      const artifactId = typeof input.artifactId === 'string' ? input.artifactId : url.searchParams.get('artifactId') ?? '';
      const auth = await authorize(request, response, url, artifactId || undefined); scope(auth, artifactId || undefined);
      if (path === '/api/presence') {
        const data = request.method === 'POST' ? await service.updatePresence(artifactId, input, auth.actor, auth.authority) : await service.sync(artifactId, {}, auth.actor, auth.authority);
        json(response, 200, data); return true;
      }
      if (path === '/api/room') { json(response, 200, await service.room(artifactId, input, auth.actor, auth.authority)); return true; }
      const peerId = url.searchParams.get('peerId') ?? undefined, peerEpoch = url.searchParams.get('peerEpoch') ?? undefined;
      if (peerEpoch && !peerId) throw new StudioError('INVALID_ARGUMENT', '页面代次需要参与者 ID。');
      const after = url.searchParams.get('after') ?? (typeof request.headers['last-event-id'] === 'string' ? request.headers['last-event-id'] : undefined);
      if (after && after.length > 160) throw new StudioError('INVALID_ARGUMENT', '同步游标无效。');
      const waitInput = url.searchParams.get('wait') ?? '0';
      if (!/^(?:0|[1-9]\d*)$/.test(waitInput) || Number(waitInput) > 20_000) throw new StudioError('INVALID_ARGUMENT', '同步等待时间应为 0 至 20000 毫秒。');
      const controller = new AbortController(); pending.add(controller);
      const abort = () => controller.abort(new DOMException('Client disconnected', 'AbortError'));
      response.once('close', abort);
      if (path === '/api/sync') {
        try {
          const data = await service.sync(artifactId, { after, wait: Number(waitInput), signal: controller.signal, peerId, peerEpoch }, auth.actor, auth.authority);
          if (!response.destroyed) json(response, 200, data);
        } catch (error) { if (!controller.signal.aborted) throw error; }
        finally { pending.delete(controller); response.removeListener('close', abort); }
        return true;
      }
      const queued: StudioEvent[] = []; let queuedBytes = 0, overflow = false, ready = false, disposed = false, last = -1, releasePeer = () => {};
      const send = (event: StudioEvent) => {
        if (disposed || response.writableEnded) return;
        if (!ready) {
          if (!overflow) { queued.push(event); queuedBytes += Buffer.byteLength(JSON.stringify(event)); if (queued.length > 512 || queuedBytes > 1024 * 1024) { overflow = true; queued.length = 0; } }
          return;
        }
        if (sequence(event.cursor) <= last) return;
        last = sequence(event.cursor);
        // Closing a slow consumer bounds Node's output queue; its cursor replays on reconnect.
        if (!response.write(`id: ${event.cursor ?? ''}\ndata: ${JSON.stringify(event)}\n\n`)) response.end();
      };
      const stop = service.subscribe(artifactId, send);
      const heartbeat = setInterval(() => { if (!response.writableEnded && !response.write(': keep-alive\n\n')) response.end(); }, 15_000); heartbeat.unref();
      const live: Live = { response, auth, artifactId, dispose: () => { if (disposed) return; disposed = true; lives.delete(live); stop(); releasePeer(); clearInterval(heartbeat); pending.delete(controller); response.removeListener('close', abort); } }; lives.add(live);
      response.once('close', live.dispose);
      try {
        // Listener precedes the first snapshot. Later queued events are filtered by its watermark.
        const initial = await service.sync(artifactId, { after, peerId, peerEpoch, signal: controller.signal }, auth.actor, auth.authority);
        if (disposed || controller.signal.aborted) { live.dispose(); return true; }
        auth.actor = initial.actor; auth.access = initial.access;
        if (peerId) releasePeer = service.connectPeer(artifactId, peerId, peerEpoch, auth.actor);
        let data = await service.sync(artifactId, { after, signal: controller.signal }, auth.actor, auth.authority);
        if (disposed || controller.signal.aborted) { live.dispose(); releasePeer(); return true; }
        auth.actor = data.actor; auth.access = data.access;
        if (overflow) data = { ...data, cursor: service.cursor(), reset: true, events: [] };
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        last = sequence(data.cursor);
        if (!response.write(`retry: 1500\nid: ${data.cursor}\ndata: ${JSON.stringify({ type: 'ready', artifactId, ...data })}\n\n`)) response.end();
        ready = true; for (const event of queued) send(event);
      } catch (error) { const failed = !disposed && !controller.signal.aborted; live.dispose(); releasePeer(); if (failed) throw error; }
      return true;
    },
    close(): void {
      unsubscribe();
      for (const controller of pending) controller.abort(new DOMException('Studio closed', 'AbortError'));
      for (const live of [...lives]) { live.response.write(`data: ${JSON.stringify({ type: 'access-revoked', artifactId: live.artifactId, reason: 'sharing-closed' })}\n\n`); live.dispose(); live.response.end(); }
      pending.clear();
    },
  };
}
