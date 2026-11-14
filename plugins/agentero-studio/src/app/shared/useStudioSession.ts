import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Actor, StudioClient, ToolName } from '../../contracts/studio';

const ACCESS_REASONS = ['removed', 'sharing-closed', 'link-disabled', 'link-reset', 'invalid-link', 'local-only'] as const;
export type AccessReason = typeof ACCESS_REASONS[number];
export type SessionStatus = 'valid' | 'checking' | 'reconnecting' | 'denied';
interface SessionState { status: SessionStatus; actor: Actor; reason?: AccessReason; access?: 'local' | 'lan' }
interface Failure { status?: number; code?: string; details?: { reason?: unknown } }

export function accessReason(value: unknown): AccessReason | undefined {
  return ACCESS_REASONS.includes(value as AccessReason) ? value as AccessReason : undefined;
}
export function isAuthenticationFailure(error: unknown): boolean {
  const failure = error as Failure | null;
  return failure?.status === 401 || failure?.code === 'UNAUTHORIZED' || !!accessReason(failure?.details?.reason);
}
function isNetworkFailure(error: unknown): boolean {
  return error instanceof Error && (error instanceof TypeError && /^(Failed to fetch|Load failed|fetch failed|NetworkError when attempting to fetch resource\.)$/i.test(error.message)
    || error.name === 'TimeoutError' || ['NETWORK_ERROR', 'SERVICE_UNAVAILABLE', 'ECONNREFUSED', 'TIMEOUT'].includes((error as Failure).code || ''));
}
function writes(name: ToolName, args: Record<string, unknown>): boolean {
  return name === 'artifact_apply' || name === 'artifact_manage' || name === 'artifact_share' && args.action !== 'status'
    || name === 'artifact_feedback' && !['list', 'preview'].includes(String(args.action));
}
function paused() { return Object.assign(new Error('正在核对访问权限，未提交的内容已保留，请稍后重试。'), { code: 'SESSION_PAUSED' }); }

/** One authority check for HTTP, host RPC, and live-event failures; writes are never replayed. */
export function useStudioSession(source: StudioClient, initialActor: Actor, artifactId: string) {
  const [state, setState] = useState<SessionState>({ status: source.baseUrl ? 'checking' : 'valid', actor: initialActor });
  const current = useRef(state);
  const running = useRef<Promise<void> | null>(null);
  const runningInBackground = useRef(false);
  const generation = useRef(0);
  const checkRef = useRef<(reason?: unknown, background?: boolean) => Promise<void>>(async () => {});
  const update = useCallback((next: SessionState) => { current.current = next; setState(next); }, []);
  const check = useCallback((reason?: unknown, background = false): Promise<void> => {
    if (!source.baseUrl || current.current.status === 'denied') return Promise.resolve();
    const previousReason = accessReason(reason) || current.current.reason;
    // An authority-change event must not reuse a response obtained before that change.
    if (running.current && !background && (reason !== undefined || runningInBackground.current)) {
      generation.current += 1; running.current = null;
    }
    if (!background) update({ ...current.current, status: 'checking', reason: previousReason });
    if (running.current) return running.current;
    const serial = generation.current;
    runningInBackground.current = background;
    const pending = (async () => {
      try {
        const url = new URL('/api/session', source.baseUrl);
        if (artifactId) url.searchParams.set('artifactId', artifactId);
        const response = await (source.request ? source.request(url, { headers: source.token ? { Authorization: `Bearer ${source.token}` } : {}, cache: 'no-store' }) : fetch(url, { headers: source.token ? { Authorization: `Bearer ${source.token}` } : {}, cache: 'no-store' }));
        const result = await response.json();
        if (serial !== generation.current) return;
        if (response.ok && result.actor) update({ status: 'valid', actor: result.actor, access: result.access });
        else if (response.status === 401 || response.status === 403 || response.status === 428) update({ ...current.current, status: 'denied', reason: accessReason(result.error?.details?.reason) || previousReason || 'invalid-link' });
        else update({ ...current.current, status: 'reconnecting' });
      } catch {
        if (serial === generation.current) update({ ...current.current, status: 'reconnecting' });
      }
    })().finally(() => { if (running.current === pending) running.current = null; });
    running.current = pending;
    return pending;
  }, [source, artifactId, update]);
  checkRef.current = check;

  useEffect(() => {
    generation.current += 1; running.current = null;
    update({ status: source.baseUrl ? 'checking' : 'valid', actor: initialActor });
    void check();
    return () => { generation.current += 1; running.current = null; };
  }, [source, initialActor, artifactId, check, update]);
  useEffect(() => {
    if (state.status !== 'reconnecting') return;
    const timer = window.setTimeout(() => { void check(); }, 2000);
    return () => window.clearTimeout(timer);
  }, [state.status, check]);
  useEffect(() => {
    if (!source.request || state.status !== 'valid') return;
    const timer = window.setInterval(() => { if (document.visibilityState !== 'hidden') void check(undefined, true); }, 15000);
    return () => window.clearInterval(timer);
  }, [source, state.status, check]);

  const client = useMemo<StudioClient>(() => {
    const observe = (error: unknown) => {
      if (isAuthenticationFailure(error)) void checkRef.current((error as Failure).details?.reason);
      else if (isNetworkFailure(error)) void checkRef.current();
    };
    return {
      ...source,
      async call<T>(name: ToolName, args: Record<string, unknown> = {}) {
        if (current.current.status === 'denied' || current.current.status !== 'valid' && writes(name, args)) throw paused();
        try { return await source.call<T>(name, args); }
        catch (error) { observe(error); throw error; }
      },
      async request(input, init) {
        if (current.current.status === 'denied' || current.current.status !== 'valid' && !['GET', 'HEAD'].includes((init?.method || 'GET').toUpperCase())) throw paused();
        try {
          const response = await (source.request ? source.request(input, init) : fetch(input, init));
          if (!response.ok) {
            const result = await response.clone().json().catch(() => null);
            observe({ status: response.status, ...result?.error });
          }
          return response;
        } catch (error) { observe(error); throw error; }
      },
    };
  }, [source]);
  const revoke = useCallback((reason: unknown) => {
    const known = accessReason(reason);
    if (!known) { void checkRef.current(reason); return; }
    generation.current += 1; running.current = null;
    update({ ...current.current, status: 'denied', reason: known });
  }, [update]);
  const updateAccess = useCallback((access: unknown) => {
    if (access === 'local' || access === 'lan') update({ ...current.current, access });
  }, [update]);
  return { ...state, client: source.baseUrl ? client : source, check, revoke, updateAccess };
}
