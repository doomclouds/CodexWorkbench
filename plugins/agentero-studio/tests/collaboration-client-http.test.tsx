// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Actor, Board, StudioClient, ToolName } from '../src/contracts/studio';
import { startStudioHost, type StudioHost } from '../src/server/http';
import { createCollaboration } from '../src/app/shared/useCollaboration';

vi.mock('../src/app/canvas/WhiteboardCanvas', () => ({ default: ({ board, readOnly }: { board: Board; readOnly: boolean }) => <section aria-label="协作白板" data-revision={board.artifact.revision} data-read-only={String(readOnly)} /> }));
import StudioApp from '../src/app/StudioApp';

let directory = '', host: StudioHost, root: Root | undefined, container: HTMLDivElement | undefined;
const closes: (() => void)[] = [];
beforeEach(async () => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; directory = await mkdtemp(join(tmpdir(), 'studio-front-sync-')); host = await startStudioHost({ dataRoot: directory }); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; container?.remove(); closes.splice(0).forEach(close => close()); await host.close(); vi.restoreAllMocks(); if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected fixture path'); await rm(directory, { recursive: true, force: true }); });
async function until(check: () => boolean) { for (let i = 0; i < 150; i++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); if (check()) return; } throw new Error(`Sync did not settle: ${container?.textContent}`); }
function client(token: string, cookie?: string): StudioClient {
  const request: NonNullable<StudioClient['request']> = (input, init) => fetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), ...(cookie ? { Cookie: cookie } : {}) } });
  return { embedded: true, baseUrl: host.origin, token, request, async call<T>(name: ToolName, args = {}) { const response = await request(`${host.origin}/api/tools/${name}`, { method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(args) }); const result = await response.json(); if (!response.ok) throw Object.assign(new Error(result.error.message), result.error); return result.data as T; } };
}

it('consumes concurrent committed unit changes through real long polling and coalesces cursor writes', async () => {
  const created = await host.service.execute('artifact_manage', { action: 'create', title: '并发白板' });
  const id = created.artifact.id; let current: Board | null = null;
  const transport = client(host.token), request = vi.spyOn(transport, 'request');
  const controller = createCollaboration({ client: transport, polling: true, artifactId: id, peerId: 'front-page', getDocument: () => current, onDocument: value => { current = value as Board; }, onFeedback: () => {}, onPresence: () => {}, onStatus: () => {}, onEvent: () => {}, onError: error => { throw error; } }); closes.push(controller.close);
  await until(() => current !== null);
  await Promise.all(['a', 'b'].map(elementId => host.service.execute('artifact_apply', { artifactId: id, operationId: randomUUID(), merge: 'safe', expectedVersions: { [elementId]: 0 }, operations: [{ op: 'add', element: { id: elementId, type: 'shape', x: 10, y: 20, w: 40, h: 50 } }] })));
  await until(() => current?.artifact.revision === 2);
  expect(current!.elements.map(element => element.id).sort()).toEqual(['a', 'b']);
  expect(request.mock.calls.filter(([input]) => new URL(String(input)).pathname === '/api/tools/artifact_read')).toHaveLength(1);
  for (let x = 0; x < 100; x++) controller.presence({ cursor: { x, y: 10, surface: 'board' } });
  await until(() => host.service.getPresence(id).find(peer => peer.peerId === 'front-page')?.cursor?.x === 99);
  const cursorRequests = request.mock.calls.filter(([input, init]) => new URL(String(input)).pathname === '/api/presence' && init?.method === 'POST' && JSON.parse(String(init.body)).cursor);
  expect(cursorRequests.length).toBeGreaterThan(0); expect(cursorRequests.length).toBeLessThanOrEqual(2);
});

it('uses a real cookie-only guest projection and applies an owner role change without losing the page', async () => {
  const created = await host.service.execute('artifact_manage', { action: 'create', title: '访客白板' }), id = created.artifact.id;
  const shared = await host.service.execute('artifact_share', { artifactId: id, action: 'start', access: 'local' });
  const invitation = new URL(shared.links.editor, host.origin).searchParams.get('share')!;
  const joined = await fetch(`${host.origin}/api/session?artifactId=${id}&share=${invitation}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '前端协作访客' }) });
  expect(joined.status).toBe(200); const cookie = joined.headers.get('set-cookie')!.split(';')[0]!, session = await joined.json() as { actor: Actor };
  const guest = client('', cookie);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<StudioApp client={guest} actor={session.actor} initialArtifactId={id} />));
  await until(() => container!.querySelector('[aria-label="协作白板"]')?.getAttribute('data-read-only') === 'false');
  await act(async () => [...container!.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === '分享')!.click());
  await until(() => !!container!.querySelector('[aria-label="复制可编辑链接"]'));
  expect(container.querySelector('[aria-label="一般访问权限"]')).toBeNull(); expect(container.textContent).not.toContain('作品所有者');
  await host.service.execute('artifact_share', { artifactId: id, action: 'role', memberId: session.actor.id, role: 'viewer' });
  await until(() => container!.querySelector('[aria-label="协作白板"]')?.getAttribute('data-read-only') === 'true');
  expect(container.querySelector('.studio-session-message')).toBeNull();
  await host.service.execute('artifact_share', { artifactId: id, action: 'remove', memberId: session.actor.id });
  await until(() => container!.querySelector('.studio')?.getAttribute('data-session-status') === 'denied');
  expect(container.textContent).toContain('房主已移除你的访问权限，请联系房主');
});
