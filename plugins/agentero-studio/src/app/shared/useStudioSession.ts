import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  STUDIO_TOOLS,
  type Actor,
  type ArtifactReadRequest,
  type ArtifactReadResult,
  type OtherStudioTool,
  type StudioClient,
  type StudioToolArguments,
  type ToolName,
} from '../../contracts/studio';
import { reportStudioWarning } from '../transport';

const ACCESS_REASONS = [
  'removed',
  'sharing-closed',
  'link-disabled',
  'link-reset',
  'invalid-link',
  'local-only',
] as const;

export type AccessReason = (typeof ACCESS_REASONS)[number];
export type SessionStatus = 'valid' | 'checking' | 'reconnecting' | 'denied';
interface SessionState {
  status: SessionStatus;
  actor: Actor;
  reason?: AccessReason;
  access?: 'local' | 'lan';
}
interface Failure {
  status?: number;
  code?: string;
  details?: { reason?: unknown };
}

export function accessReason(value: unknown): AccessReason | undefined {
  return ACCESS_REASONS.includes(value as AccessReason) ? (value as AccessReason) : undefined;
}

export function isAuthenticationFailure(error: unknown): boolean {
  const failure = error as Failure | null;
  return (
    failure?.status === 401 ||
    failure?.code === 'UNAUTHORIZED' ||
    !!accessReason(failure?.details?.reason)
  );
}

function isNetworkFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    ((error instanceof TypeError &&
      /^(Failed to fetch|Load failed|fetch failed|NetworkError when attempting to fetch resource\.)$/i.test(
        error.message,
      )) ||
      error.name === 'TimeoutError' ||
      ['NETWORK_ERROR', 'SERVICE_UNAVAILABLE', 'ECONNREFUSED', 'TIMEOUT'].includes(
        (error as Failure).code || '',
      ))
  );
}

function writes(name: ToolName, args: Record<string, unknown>): boolean {
  return (
    name === STUDIO_TOOLS.apply ||
    name === STUDIO_TOOLS.manage ||
    (name === STUDIO_TOOLS.share && args.action !== 'status') ||
    (name === STUDIO_TOOLS.feedback && !['list', 'preview'].includes(String(args.action)))
  );
}

function paused() {
  return Object.assign(new Error('正在核对访问权限，未提交的内容已保留，请稍后重试。'), {
    code: 'SESSION_PAUSED',
  });
}

export function useStudioSession(source: StudioClient, initialActor: Actor, artifactId: string) {
  const scope = useMemo<{ source: StudioClient; artifactId: string; initial: SessionState }>(
    () => ({
      source,
      artifactId,
      initial: { status: source.baseUrl ? 'checking' : 'valid', actor: initialActor },
    }),
    [source, initialActor, artifactId],
  );
  const [session, setSession] = useState<{ scope: typeof scope; state: SessionState }>(() => ({
    scope,
    state: scope.initial,
  }));
  const state = session.scope === scope ? session.state : scope.initial;
  const current = useRef(state);
  const running = useRef<Promise<void> | null>(null);
  const runningInBackground = useRef(false);
  const generation = useRef(0);
  const startCheckRef = useRef<(reason?: unknown) => void>(() => {});
  const update = useCallback(
    (next: SessionState) => {
      current.current = next;
      setSession({ scope, state: next });
    },
    [scope],
  );
  const check = useCallback(
    (reason?: unknown, background = false): Promise<void> => {
      if (!source.baseUrl || current.current.status === 'denied') {
        return Promise.resolve();
      }

      const previousReason = accessReason(reason) || current.current.reason;
      const invalidateRunning = reason !== undefined || runningInBackground.current;
      if (running.current && !background && invalidateRunning) {
        generation.current += 1;
        running.current = null;
      }
      if (
        !background &&
        (current.current.status !== 'checking' || current.current.reason !== previousReason)
      ) {
        update({ ...current.current, status: 'checking', reason: previousReason });
      }
      if (running.current) {
        return running.current;
      }

      const serial = generation.current;
      runningInBackground.current = background;
      const pending = (async () => {
        try {
          const url = new URL('/api/session', source.baseUrl);
          if (artifactId) {
            url.searchParams.set('artifactId', artifactId);
          }
          const response = await (source.request
            ? source.request(url, {
                headers: source.token ? { Authorization: `Bearer ${source.token}` } : {},
                cache: 'no-store',
              })
            : fetch(url, {
                headers: source.token ? { Authorization: `Bearer ${source.token}` } : {},
                cache: 'no-store',
              }));
          const result = await response.json();
          if (serial !== generation.current) {
            return;
          }

          if (response.ok && result.actor) {
            update({ status: 'valid', actor: result.actor, access: result.access });
          } else if (
            response.status === 401 ||
            response.status === 403 ||
            response.status === 428
          ) {
            update({
              ...current.current,
              status: 'denied',
              reason:
                accessReason(result.error?.details?.reason) || previousReason || 'invalid-link',
            });
          } else {
            update({ ...current.current, status: 'reconnecting' });
          }
        } catch (error) {
          if (serial === generation.current) {
            reportStudioWarning('无法读取作品访问权限，正在重新连接。', error);
            update({ ...current.current, status: 'reconnecting' });
          }
        }
      })().finally(() => {
        if (running.current === pending) {
          running.current = null;
        }
      });
      running.current = pending;
      return pending;
    },
    [source, artifactId, update],
  );
  const startCheck = useCallback(
    (reason?: unknown, background = false) => {
      const pending = check(reason, background);
      const serial = generation.current;
      pending.catch((error) => {
        if (serial === generation.current && current.current.status !== 'denied') {
          reportStudioWarning('作品访问权限检查未完成。', error);
          update({ ...current.current, status: 'reconnecting' });
        }
      });
    },
    [check, update],
  );
  useLayoutEffect(() => {
    generation.current += 1;
    running.current = null;
    current.current = scope.initial;
    startCheckRef.current = startCheck;
    return () => {
      generation.current += 1;
      running.current = null;
    };
  }, [scope, startCheck]);
  useEffect(() => {
    startCheck();
  }, [startCheck]);
  useEffect(() => {
    if (state.status !== 'reconnecting') {
      return;
    }

    const timer = window.setTimeout(() => startCheck(), 2000);
    return () => window.clearTimeout(timer);
  }, [state.status, startCheck]);
  useEffect(() => {
    if (!source.request || state.status !== 'valid') {
      return;
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') {
        startCheck(undefined, true);
      }
    }, 15000);

    return () => window.clearInterval(timer);
  }, [source, state.status, startCheck]);

  const client = useMemo<StudioClient>(() => {
    const observe = (error: unknown) => {
      if (isAuthenticationFailure(error)) {
        startCheckRef.current((error as Failure).details?.reason);
      } else if (isNetworkFailure(error)) {
        startCheckRef.current();
      }
    };

    function call<Request extends ArtifactReadRequest>(
      name: typeof STUDIO_TOOLS.read,
      args: Request,
    ): Promise<ArtifactReadResult<Request>>;
    function call<T = unknown>(name: OtherStudioTool, args?: Record<string, unknown>): Promise<T>;
    function call(...args: StudioToolArguments): Promise<unknown>;
    async function call(...args: StudioToolArguments): Promise<unknown> {
      const [name, input = {}] = args;
      if (
        current.current.status === 'denied' ||
        (current.current.status !== 'valid' && writes(name, input))
      ) {
        throw paused();
      }

      try {
        return await source.call(...args);
      } catch (error) {
        observe(error);
        throw error;
      }
    }

    return {
      ...source,
      call,
      async request(input, init) {
        const method = (init?.method || 'GET').toUpperCase();
        const readOnly = method === 'GET' || method === 'HEAD';
        const status = current.current.status;
        if (status === 'denied' || (status !== 'valid' && !readOnly)) {
          throw paused();
        }

        try {
          const response = await (source.request
            ? source.request(input, init)
            : fetch(input, init));

          if (!response.ok) {
            const result = await response
              .clone()
              .json()
              .catch((error) => {
                if (!(error instanceof SyntaxError)) {
                  reportStudioWarning('无法解析作品服务的失败响应。', error);
                }
                return null;
              });
            observe({ status: response.status, ...result?.error });
          }
          return response;
        } catch (error) {
          observe(error);
          throw error;
        }
      },
    };
  }, [source]);
  const revoke = useCallback(
    (reason: unknown) => {
      const known = accessReason(reason);
      if (!known) {
        startCheckRef.current(reason);
        return;
      }
      generation.current += 1;
      running.current = null;
      update({ ...current.current, status: 'denied', reason: known });
    },
    [update],
  );
  const updateAccess = useCallback(
    (access: unknown) => {
      if (access === 'local' || access === 'lan') {
        update({ ...current.current, access });
      }
    },
    [update],
  );

  return { ...state, client: source.baseUrl ? client : source, check, revoke, updateAccess };
}
