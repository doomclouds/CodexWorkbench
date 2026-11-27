import { reportMcpWarning } from './diagnostics.js';
import { decodeSession, parseToolResult, protocolVersion } from './protocol.js';
import type { AppSession, HostExchange } from './protocol.js';

interface SessionOptions {
  readonly call: HostExchange;
  readonly boardId: () => string | undefined;
  readonly lifetime: AbortSignal;
}

interface PendingSession {
  readonly boardId?: string;
  readonly promise: Promise<AppSession>;
}

function matches(session: AppSession, boardId: string | undefined) {
  return session.boardId === undefined || session.boardId === boardId;
}

export function createMcpSessions({ call, boardId, lifetime }: SessionOptions) {
  let active: AppSession | undefined;
  let pending: PendingSession | undefined;
  let closed = false;

  async function release({ id }: AppSession) {
    try {
      const result = await call(
        { version: protocolVersion, action: 'close', sessionId: id },
        AbortSignal.timeout(1_000),
      );
      parseToolResult(result);
      return true;
    } catch (error) {
      reportMcpWarning('面板会话会在到期后回收。', error);
      return false;
    }
  }

  function releaseUnused(lease: AppSession) {
    release(lease).catch((error: unknown) => {
      reportMcpWarning('面板会话会在到期后回收。', error);
    });
  }

  function keep(lease: AppSession) {
    const previous = active;
    active = lease;
    if (previous && previous.id !== lease.id) {
      releaseUnused(previous);
    }
  }

  function accept(lease: AppSession) {
    const scope = boardId();
    if (closed || !matches(lease, scope)) {
      return;
    }

    if (active && active.expiresAtMillis > Date.now() && matches(active, scope)) {
      if (active.id !== lease.id) {
        releaseUnused(lease);
      }
      return;
    }

    pending = undefined;
    keep(lease);
  }

  function open(scope: string | undefined): PendingSession {
    const request =
      scope === undefined
        ? { version: protocolVersion, action: 'connect' }
        : { version: protocolVersion, action: 'connect', boardId: scope };
    const attempt: PendingSession = {
      boardId: scope,
      promise: call(request, lifetime).then((result) => {
        const response = parseToolResult(result);
        const lease = decodeSession(response, scope);
        if (!lease || lease.expiresAtMillis <= Date.now()) {
          throw new Error('宿主未返回有效的白板面板会话。');
        }

        if (closed || pending !== attempt) {
          releaseUnused(lease);

          const replacement = closed ? undefined : active;
          if (
            replacement &&
            replacement.expiresAtMillis > Date.now() &&
            matches(replacement, scope)
          ) {
            return replacement;
          }

          throw new Error('白板面板已切换，原会话未启用。');
        }

        keep(lease);
        return lease;
      }),
    };
    pending = attempt;

    return attempt;
  }

  async function read(signal: AbortSignal): Promise<AppSession> {
    signal.throwIfAborted();
    const scope = boardId();
    if (active && active.expiresAtMillis > Date.now() && matches(active, scope)) {
      return active;
    }

    const next = pending?.boardId === scope && pending ? pending : open(scope);
    try {
      const lease = await next.promise;
      signal.throwIfAborted();
      if (!matches(lease, boardId())) {
        throw new Error('白板面板已切换，请重新打开所选作品。');
      }

      return lease;
    } finally {
      if (pending === next) {
        pending = undefined;
      }
    }
  }

  function invalidate(id: string) {
    if (active?.id === id) {
      active = undefined;
    }
  }

  async function close() {
    closed = true;
    pending = undefined;
    const previous = active;
    active = undefined;
    if (previous) {
      await release(previous);
    }
  }

  return { accept, read, invalidate, close };
}
