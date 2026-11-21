import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Actor, StudioEvent } from '../contracts/studio.js';
import type { StudioAuthority, StudioService } from '../core/service.js';
import { StudioError } from '../shared/studio-error.js';

interface Auth {
  actor: Actor;
  owner: boolean;
  access: 'local' | 'lan';
  viaLan: boolean;
  artifactId?: string;
  authority: StudioAuthority;
}
interface Live {
  response: ServerResponse;
  auth: Auth;
  artifactId: string;
  dispose(): void;
}
interface Dependencies {
  service: StudioService;
  authorize(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    artifactId?: string,
  ): Promise<Auth>;
  scope(auth: Auth, artifactId: unknown): void;
  readJson(request: IncomingMessage): Promise<Record<string, unknown>>;
  json(response: ServerResponse, status: number, value: unknown): void;
}

function revoked(auth: Auth, event: StudioEvent): boolean {
  return (
    event.type === 'share' &&
    ((event.access === 'local' && auth.viaLan) ||
      (!auth.owner &&
        (event.enabled === false ||
          (Array.isArray(event.revokedRoles) && event.revokedRoles.includes(auth.actor.role)) ||
          (Array.isArray(event.revokedMemberIds) &&
            event.revokedMemberIds.includes(auth.actor.id)))))
  );
}

function sequence(cursor: unknown): number {
  return typeof cursor === 'string' ? Number(cursor.slice(cursor.lastIndexOf(':') + 1)) : -1;
}

const collaborationMethods = new Map([
  ['/api/sync', ['GET']],
  ['/api/events', ['GET']],
  ['/api/presence', ['GET', 'POST']],
  ['/api/room', ['POST']],
]);

function syncParameters(url: URL, lastEventId: string | string[] | undefined) {
  const peerId = url.searchParams.get('peerId') ?? undefined;
  const peerEpoch = url.searchParams.get('peerEpoch') ?? undefined;
  if (peerEpoch && !peerId) {
    throw new StudioError('INVALID_ARGUMENT', '页面代次需要参与者 ID。');
  }

  const after =
    url.searchParams.get('after') ?? (typeof lastEventId === 'string' ? lastEventId : undefined);

  if (after && after.length > 160) {
    throw new StudioError('INVALID_ARGUMENT', '同步游标无效。');
  }

  const waitInput = url.searchParams.get('wait') ?? '0';
  if (!/^(?:0|[1-9]\d*)$/.test(waitInput) || Number(waitInput) > 20_000) {
    throw new StudioError('INVALID_ARGUMENT', '同步等待时间应为 0 至 20000 毫秒。');
  }

  return { after, peerId, peerEpoch, wait: Number(waitInput) };
}

export function createCollaborationRoutes({
  service,
  authorize,
  scope,
  readJson,
  json,
}: Dependencies) {
  const lives = new Set<Live>();
  const pending = new Set<AbortController>();
  const unsubscribe = service.subscribe('*', (event) => {
    for (const live of lives) {
      if (live.artifactId === event.artifactId && revoked(live.auth, event)) {
        if (live.response.headersSent) {
          live.response.write(
            `data: ${JSON.stringify({ type: 'access-revoked', artifactId: live.artifactId, reason: event.reason ?? 'invalid-link', cursor: event.cursor })}\n\n`,
          );
        } else {
          json(live.response, 403, {
            ok: false,
            error: {
              code: 'FORBIDDEN',
              message: '白板访问权限已变更。',
              details: { reason: event.reason ?? 'invalid-link' },
            },
          });
        }
        live.dispose();
        live.response.end();
      }
    }
  });
  function trackRequest(response: ServerResponse) {
    const controller = new AbortController();
    pending.add(controller);
    const abort = () => controller.abort(new DOMException('Client disconnected', 'AbortError'));
    response.once('close', abort);
    return {
      controller,
      disposeRequest() {
        pending.delete(controller);
        response.removeListener('close', abort);
      },
    };
  }

  async function sync(
    response: ServerResponse,
    artifactId: string,
    auth: Auth,
    options: ReturnType<typeof syncParameters>,
  ): Promise<void> {
    const { controller, disposeRequest } = trackRequest(response);
    try {
      const data = await service.sync(
        artifactId,
        { ...options, signal: controller.signal },
        auth.actor,
        auth.authority,
      );

      if (!response.destroyed) {
        json(response, 200, data);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        throw error;
      }
    } finally {
      disposeRequest();
    }
  }

  async function openStream(
    response: ServerResponse,
    artifactId: string,
    auth: Auth,
    { after, peerId, peerEpoch }: ReturnType<typeof syncParameters>,
  ): Promise<void> {
    const { controller, disposeRequest } = trackRequest(response);
    const queued: StudioEvent[] = [];
    const frames: { text: string; bytes: number }[] = [];
    let queuedBytes = 0;
    let frameBytes = 0;
    let blocked = false;
    let overflow = false;
    let ready = false;
    let disposed = false;
    let last = -1;
    let releasePeer = () => {};
    const drain = () => {
      blocked = false;
      while (!disposed && !response.writableEnded && frames.length) {
        const frame = frames.shift()!;
        frameBytes -= frame.bytes;

        if (!response.write(frame.text)) {
          blocked = true;
          response.once('drain', drain);
          break;
        }
      }
    };
    const write = (text: string) => {
      if (disposed || response.writableEnded) {
        return;
      }

      if (blocked) {
        const bytes = Buffer.byteLength(text);
        frames.push({ text, bytes });
        frameBytes += bytes;

        if (frames.length > 512 || frameBytes > 1024 * 1024) {
          live.dispose();
          response.end();
        }
      } else if (!response.write(text)) {
        blocked = true;
        response.once('drain', drain);
      }
    };
    const send = (event: StudioEvent) => {
      if (disposed || response.writableEnded) {
        return;
      }

      if (!ready) {
        if (!overflow) {
          queued.push(event);
          queuedBytes += Buffer.byteLength(JSON.stringify(event));
          if (queued.length > 512 || queuedBytes > 1024 * 1024) {
            overflow = true;
            queued.length = 0;
          }
        }
        return;
      }
      if (sequence(event.cursor) <= last) {
        return;
      }

      last = sequence(event.cursor);
      write(`id: ${event.cursor ?? ''}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    const stop = service.subscribe(artifactId, send);
    const heartbeat = setInterval(() => write(': keep-alive\n\n'), 15_000);
    heartbeat.unref();
    const live: Live = {
      response,
      auth,
      artifactId,
      dispose: () => {
        if (disposed) {
          return;
        }

        disposed = true;
        lives.delete(live);
        stop();
        releasePeer();
        clearInterval(heartbeat);
        disposeRequest();
        response.removeListener('drain', drain);
        queued.length = 0;
        frames.length = 0;
        queuedBytes = frameBytes = 0;
      },
    };
    lives.add(live);
    response.once('close', live.dispose);
    try {
      const initial = await service.sync(
        artifactId,
        { after, peerId, peerEpoch, signal: controller.signal },
        auth.actor,
        auth.authority,
      );

      if (disposed || controller.signal.aborted) {
        live.dispose();
        return;
      }
      auth.actor = initial.actor;
      auth.access = initial.access;
      if (peerId) {
        releasePeer = service.connectPeer(artifactId, peerId, peerEpoch, auth.actor);
      }
      let data = await service.sync(
        artifactId,
        { after, signal: controller.signal },
        auth.actor,
        auth.authority,
      );

      if (disposed || controller.signal.aborted) {
        live.dispose();
        releasePeer();
        return;
      }
      auth.actor = data.actor;
      auth.access = data.access;
      if (overflow) {
        data = { ...data, cursor: service.cursor(), reset: true, events: [] };
      }
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      last = sequence(data.cursor);
      write(
        `retry: 1500\nid: ${data.cursor}\ndata: ${JSON.stringify({ type: 'ready', artifactId, ...data })}\n\n`,
      );
      ready = true;
      for (const event of queued) {
        send(event);
      }
      queued.length = 0;
      queuedBytes = 0;
    } catch (error) {
      const failed = !disposed && !controller.signal.aborted;
      live.dispose();
      releasePeer();
      if (failed) {
        throw error;
      }
    }
  }

  return {
    async handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
      const path = url.pathname;
      if (!collaborationMethods.get(path)?.includes(request.method ?? '')) {
        return false;
      }

      const input = request.method === 'POST' ? await readJson(request) : {};
      const artifactId =
        typeof input.artifactId === 'string'
          ? input.artifactId
          : (url.searchParams.get('artifactId') ?? '');
      const auth = await authorize(request, response, url, artifactId || undefined);
      scope(auth, artifactId || undefined);

      if (path === '/api/sync' && url.searchParams.get('check') === 'revision') {
        const head = await service.collaborationRevision(artifactId, auth.actor, auth.authority);
        if (!response.destroyed) {
          json(response, 200, head);
        }

        return true;
      }
      if (path === '/api/presence') {
        const data =
          request.method === 'POST'
            ? await service.updatePresence(artifactId, input, auth.actor, auth.authority)
            : await service.sync(artifactId, {}, auth.actor, auth.authority);
        json(response, 200, data);
        return true;
      }
      if (path === '/api/room') {
        json(response, 200, await service.room(artifactId, input, auth.actor, auth.authority));
        return true;
      }
      const options = syncParameters(url, request.headers['last-event-id']);
      if (path === '/api/sync') {
        await sync(response, artifactId, auth, options);
      } else {
        await openStream(response, artifactId, auth, options);
      }
      return true;
    },
    close(): void {
      unsubscribe();
      for (const controller of pending) {
        controller.abort(new DOMException('Studio closed', 'AbortError'));
      }
      for (const live of [...lives]) {
        live.response.write(
          `data: ${JSON.stringify({ type: 'access-revoked', artifactId: live.artifactId, reason: 'sharing-closed' })}\n\n`,
        );
        live.dispose();
        live.response.end();
      }
      pending.clear();
    },
  };
}
