import type { StudioClient, ToolResponse } from '../contracts/studio';
import { studioRequest } from './transport';

export interface RegionReaderTarget { artifactId: string; regionId: string; viewId: string; annotate: boolean }
export interface RegionReaderLink { url: string; expiresAt: number }
async function request<T>(client: StudioClient, path: string, init?: RequestInit): Promise<T> {
  const response = await studioRequest(client, new URL(path, client.baseUrl || location.href), {
    ...init, headers: { ...(client.token ? { Authorization: `Bearer ${client.token}` } : {}), ...init?.headers },
  });
  const result = await response.json() as ToolResponse<T>;
  if (!response.ok || !result.ok) throw new Error(result.error?.message || '无法打开 HTML 阅读页。');
  return result.data as T;
}
export function createRegionReaderLink(client: StudioClient, target: { artifactId: string; regionId: string; viewId: string }): Promise<RegionReaderLink> {
  return request(client, '/api/region-view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(target) });
}
/** A return request carries only the original target, never a caller-selected URL or credentials. */
export function watchRegionReaderReturn(client: StudioClient, target: { artifactId: string; viewId: string }, onReturn: (target: RegionReaderTarget) => void): () => void {
  let stopped = false, pending = false;
  const expiresAt = Date.now() + 15 * 60_000;
  const controller = new AbortController();
  const poll = async () => {
    if (stopped) return;
    if (Date.now() >= expiresAt) { close(); return; }
    if (pending || document.hidden) return;
    pending = true;
    try {
      const result = await request<{ navigation?: RegionReaderTarget }>(client, `/api/region-view?artifactId=${encodeURIComponent(target.artifactId)}&viewId=${encodeURIComponent(target.viewId)}`, { signal: controller.signal });
      if (!stopped && result.navigation?.artifactId === target.artifactId && result.navigation.viewId === target.viewId) onReturn(result.navigation);
    } catch { /* Reopening the original whiteboard remains possible after a disconnect. */ }
    finally { pending = false; }
  };
  const timer = setInterval(() => { void poll(); }, 1500);
  const visible = () => { if (!document.hidden) void poll(); };
  document.addEventListener('visibilitychange', visible);
  function close() { if (stopped) return; stopped = true; clearInterval(timer); controller.abort(); document.removeEventListener('visibilitychange', visible); }
  void poll();
  return close;
}
