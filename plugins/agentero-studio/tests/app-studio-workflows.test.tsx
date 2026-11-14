// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { DEFAULT_STYLE, LOCAL_ACTOR, type Actor, type Artifact, type Board, type Feedback, type StudioClient, type ToolName } from '../src/contracts/studio';
import { StudioService } from '../src/core/service';

vi.mock('../src/app/canvas/WhiteboardCanvas', () => ({
  default: ({ board, onChanged, onAnnotate, onAnnotateNative, onSelectionChange, onEditHtml, onOpenHtml, readOnly, presence, externalViewport }: { board: Board; onChanged: (board: Board) => void; onAnnotate: (selection: unknown) => void; onAnnotateNative?: (selection: unknown) => void; onSelectionChange?: (ids: string[]) => void; onEditHtml?: (element?: Board['elements'][number]) => void; onOpenHtml?: (element: Board['elements'][number]) => void; readOnly?: boolean; presence?: { peerId: string }[]; externalViewport?: unknown }) => <section data-peers={presence?.map(peer => peer.peerId).join(',')} data-external-viewport={JSON.stringify(externalViewport)} aria-label="白板画布" data-artifact={board.artifact.id} data-revision={board.artifact.revision} data-read-only={String(!!readOnly)}>
    <button onClick={() => onAnnotate({ regionId: 'region-one', sourceRevision: 1, targetIds: ['node-input'], quote: '输入节点', excerpt: '输入节点 → 输出节点', selector: '[data-node="input"]', rect: { x: 10, y: 20, w: 80, h: 30 } })}>标注 HTML 内部</button>
    <button onClick={() => onAnnotate({ regionId: 'region-one', sourceRevision: 1, targetIds: ['node-output'], quote: '输出节点', excerpt: '输入节点 → 输出节点', selector: '[data-node="output"]', rect: { x: 100, y: 20, w: 80, h: 30 } })}>标注 HTML 输出</button>
    <button onClick={() => { const element = board.elements.find(item => item.id === 'native-table'); if (element) onAnnotateNative?.({ anchor: { coordinateSpace: 'element', elementIds: [element.id], x: 1, y: .5 }, versions: { [element.id]: element.version }, label: '对象 · table', screenPoint: { x: 300, y: 150 } }); }}>标注原生表格</button>
    <button onClick={() => onSelectionChange?.(['region-one'])}>选择 HTML 区域</button>
    <button onClick={() => onEditHtml?.()}>导入 HTML</button>
    <button onClick={() => { const element = board.elements.find(element => element.id === 'region-one'); if (element) onOpenHtml?.(element); }}>独立阅读 HTML</button>
    <button onClick={() => onChanged({ ...board, artifact: { ...board.artifact, revision: board.artifact.revision + 5 } })}>模拟较新画布版本</button>
  </section>,
}));
import StudioApp from '../src/app/StudioApp';
import { whiteboardProduct } from '../src/app/products/whiteboard';

let folder = '';
let service: StudioService;
let container: HTMLDivElement;
let root: Root;
let client: StudioClient;
let call: Mock<(name: ToolName, args: Record<string, any>) => Promise<any>>;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  folder = await mkdtemp(join(tmpdir(), 'agentero-studio-app-'));
  service = new StudioService({ dataRoot: folder });
  service.configureSharing(async () => 'http://127.0.0.1:49177');
  call = vi.fn((name: ToolName, args: Record<string, unknown> = {}) => service.execute(name, args, LOCAL_ACTOR));
  client = { embedded: true, async call<T>(name: ToolName, args?: Record<string, unknown>) { return await call(name, args || {}) as T; } };
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  await service?.close();
  const parent = resolve(tmpdir()); const target = resolve(folder);
  if (target.startsWith(`${parent}\\agentero-studio-app-`) || target.startsWith(`${parent}/agentero-studio-app-`)) await rm(target, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mount(options: { artifactId?: string; actor?: Actor; view?: 'trash' | 'recent'; attach?: (feedback: Feedback, board: Pick<Board, 'artifact'>) => Promise<void> } = {}) {
  await act(async () => root.render(<StudioApp client={client} actor={options.actor || LOCAL_ACTOR} initialArtifactId={options.artifactId} initialView={options.view} attachContext={options.attach} />));
}
async function waitUntil(check: () => boolean) {
  for (let attempt = 0; attempt < 80; attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    if (check()) return;
  }
  throw new Error(`UI did not reach expected state. ${container.textContent?.slice(0, 1500)}`);
}
function button(label: string, partial = false): HTMLButtonElement {
  const all = [...container.querySelectorAll<HTMLButtonElement>('button')];
  const found = all.find(element => element.getAttribute('aria-label') === label) || [...container.querySelectorAll<HTMLButtonElement>('[role="menu"] button'), ...all].find(element => partial ? element.textContent?.includes(label) : element.textContent?.trim() === label);
  if (!found) throw new Error(`Button missing: ${label}`);
  return found;
}
async function click(element: HTMLElement) { await act(async () => { element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); element.click(); }); }
async function change(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}
async function submit(form: HTMLFormElement) { await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); }
async function createFixture(elements: Board['elements'] = []) {
  return await service.execute('artifact_manage', { action: 'create', title: '架构讨论', elements }, LOCAL_ACTOR) as { board: Board };
}
function region(html = '<h1 data-node="input">输入节点</h1>'): Board['elements'][number] {
  return { id: 'region-one', type: 'html', x: 0, y: 0, w: 700, h: 500, version: 1, sourceRevision: 1, html, text: '系统架构' };
}
async function apply(board: Board, operations: unknown[]) {
  return await service.execute('artifact_apply', { artifactId: board.artifact.id, operationId: crypto.randomUUID(), expectedRevision: board.artifact.revision, operations }, LOCAL_ACTOR) as { board: Board };
}
async function appRequest(input: string | URL, init?: RequestInit, actor: Actor = LOCAL_ACTOR): Promise<Response> {
  const url = new URL(String(input));
  if (url.pathname === '/api/session') return Response.json({ actor, access: 'local' });
  if (url.pathname.startsWith('/api/tools/')) {
    const name = url.pathname.slice('/api/tools/'.length) as ToolName;
    return Response.json({ ok: true, data: await call(name, JSON.parse(String(init?.body || '{}'))) });
  }
  if (url.pathname === '/api/sync') {
    if (!url.searchParams.has('after')) return Response.json({ cursor: 'fixture:1', reset: true, events: [], peers: [], timer: null, serverTime: Date.now() });
    return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
  }
  if (url.pathname === '/api/presence') return Response.json({ peers: [], timer: null, cursor: 'fixture:0', serverTime: Date.now() });
  if (url.pathname === '/api/room') return Response.json({ accepted: JSON.parse(String(init?.body || '{}')).events?.length || 0, dropped: 0, cursor: 'fixture:0', serverTime: Date.now() });
  throw new Error(`Unexpected app request: ${url.pathname}`);
}
function readerTransport() {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const request = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    if (url.pathname !== '/api/region-view') return appRequest(input, init);
    if (url.pathname === '/api/region-view') {
      if (init?.method === 'POST') {
        const target = JSON.parse(String(init.body)) as { artifactId: string; regionId: string };
        return Response.json({ ok: true, data: { url: `http://studio.test/region/${target.artifactId}/${target.regionId}#cap=limited-reader`, expiresAt: Date.now() + 900000 } });
      }
      return Response.json({ ok: true, data: {} });
    }
    throw new Error(`Unexpected reader request: ${url.pathname}`);
  });
  const openLink = vi.fn().mockRejectedValue(new Error('宿主不支持打开新标签'));
  Object.assign(client, { baseUrl: 'http://studio.test', token: 'owner-secret-kept-in-header', request, openLink });
  return { request, openLink };
}

describe('Studio real management workflows', () => {
  it('refreshes live guest permissions without discarding an unsent comment', async () => {
    const fixture = await createFixture([region()]);
    const guest: Actor = { id: 'guest-live', name: '协作者', kind: 'human', role: 'editor' };
    const streams: { onmessage: ((event: { data: string }) => void) | null }[] = [];
    vi.stubGlobal('EventSource', class {
      onmessage: ((event: { data: string }) => void) | null = null;
      onopen = null; onerror = null;
      constructor() { streams.push(this); queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'ready', cursor: 'fixture:1', reset: true, events: [], peers: [], timer: null, serverTime: Date.now() }) })); }
      addEventListener() {}
      close() {}
    });
    let liveActor = guest;
    vi.stubGlobal('fetch', vi.fn((input, init) => appRequest(input, init, liveActor)));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    client = { ...client, embedded: false, baseUrl: 'http://studio.test', token: 'fixture-guest' };
    await mount({ artifactId: fixture.board.artifact.id, actor: guest });
    await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]'));
    const emit = async (message: object) => act(async () => { streams.at(-1)!.onmessage!({ data: JSON.stringify({ artifactId: fixture.board.artifact.id, ...message }) }); });
    const readOnly = () => container.querySelector('[aria-label="白板画布"]')?.getAttribute('data-read-only');
    expect(readOnly()).toBe('false');
    await click(button('标注 HTML 内部'));
    await change(container.querySelector<HTMLTextAreaElement>('[aria-label="批注内容"]')!, '尚未发送的备注');

    liveActor = { ...guest, role: 'viewer' };
    await emit({ type: 'access-revoked', reason: 'role-changed' });
    expect(readOnly()).toBe('true');
    expect(button('备注').disabled).toBe(true);
    expect(container.querySelector('[aria-label="批注内容"]')).toBeNull();
    await emit({ type: 'ready', actor: { ...guest, role: 'viewer' } });
    expect(readOnly()).toBe('true');
    expect(button('备注').disabled).toBe(true);
    // A ready frame can expose a change missed while disconnected, but never grants a role without a fresh session check.
    await emit({ type: 'ready', actor: { ...guest, role: 'editor' } });
    expect(readOnly()).toBe('true'); expect(button('备注').disabled).toBe(true);
    await click(button('分享'));
    expect(container.querySelector('[aria-label="一般访问权限"]')).toBeNull();
    expect(container.textContent).not.toContain('作品所有者');
    await click(button('关闭架构讨论'));

    liveActor = { ...guest, role: 'commenter' };
    await emit({ type: 'access-revoked', reason: 'role-changed' });
    expect(readOnly()).toBe('true');
    expect(button('备注').disabled).toBe(false);
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="批注内容"]')?.value).toBe('尚未发送的备注');
    liveActor = guest;
    await emit({ type: 'access-revoked', reason: 'role-changed' });
    expect(readOnly()).toBe('false');
    expect(call.mock.calls.some(([name, args]) => name === 'artifact_feedback' && args.action === 'create')).toBe(false);
  });

  it('rechecks fresh self metadata on a long-poll reset even when the role-change event is absent', async () => {
    const fixture = await createFixture();
    const guest: Actor = { id: 'reset-guest', name: '重连访客', kind: 'human', role: 'editor' };
    let liveActor = guest, sessionReads = 0;
    const request = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/session') { sessionReads++; return Response.json({ actor: liveActor, access: 'local' }); }
      if (url.pathname === '/api/sync' && !url.searchParams.has('after')) {
        liveActor = { ...guest, role: 'viewer' };
        return Response.json({ cursor: 'reset:10', reset: true, events: [], peers: [], timer: null, serverTime: Date.now(), actor: liveActor, access: 'local' });
      }
      return appRequest(input, init, liveActor);
    });
    client = { ...client, embedded: true, baseUrl: 'http://studio.test', token: '', request };
    await mount({ artifactId: fixture.board.artifact.id, actor: guest });
    await waitUntil(() => container.querySelector('[aria-label="白板画布"]')?.getAttribute('data-read-only') === 'true');
    expect(sessionReads).toBeGreaterThanOrEqual(2); expect(button('备注').disabled).toBe(true);
    expect(container.querySelector('.studio-session-message')).toBeNull();
    expect(call.mock.calls.some(([name]) => name === 'artifact_apply')).toBe(false);
  });

  it('hides mounted popovers and menus on terminal access loss and stops invalid reconnects', async () => {
    const fixture = await createFixture([region()]);
    const streams: { onmessage: ((event: { data: string }) => void) | null; close: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal('EventSource', class {
      onmessage: ((event: { data: string }) => void) | null = null;
      onopen = null; onerror = null; close = vi.fn();
      constructor() { streams.push(this); queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'ready', cursor: 'fixture:1', reset: true, events: [], peers: [], timer: null, serverTime: Date.now() }) })); }
      addEventListener() {}
    });
    const request = vi.fn((input, init) => appRequest(input, init));
    vi.stubGlobal('fetch', request); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    client = { ...client, embedded: false, baseUrl: 'http://studio.test', token: 'fixture-owner' };
    await mount({ artifactId: fixture.board.artifact.id });
    await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]'));
    await click(button('分享')); await waitUntil(() => !button('一般访问权限').disabled);
    await click(button('一般访问权限'));
    const popover = container.querySelector<HTMLElement>('.studio-editor-popover')!;
    const menu = container.querySelector<HTMLElement>('.studio-editor-submenu')!;
    expect(popover.parentElement).toBe(container.querySelector('.studio'));
    expect(menu.parentElement).toBe(container.querySelector('.studio'));
    await act(async () => streams.at(-1)!.onmessage!({ data: JSON.stringify({ type: 'access-revoked', artifactId: fixture.board.artifact.id, reason: 'invalid-link' }) }));
    expect(container.querySelector('.studio')?.getAttribute('data-session-status')).toBe('denied');
    expect(container.querySelector<HTMLElement>('.studio-session-content')?.hidden).toBe(true);
    expect(popover.hidden).toBe(true); expect(popover.inert).toBe(true); expect(popover.getAttribute('aria-hidden')).toBe('true');
    expect(!menu.isConnected || menu.hidden && menu.inert).toBe(true);
    expect(document.activeElement).toBe(container.querySelector('.studio-session-message'));
    expect(streams[0]!.close).toHaveBeenCalled();
    const requests = request.mock.calls.length, streamCount = streams.length;
    vi.useFakeTimers(); await act(async () => { await vi.advanceTimersByTimeAsync(60000); }); vi.useRealTimers();
    expect(request).toHaveBeenCalledTimes(requests); expect(streams).toHaveLength(streamCount);
    expect(call.mock.calls.some(([name, args]) => name === 'artifact_apply' || name === 'artifact_feedback' && args.action === 'create')).toBe(false);
  });

  it('counts people by actor while preserving their page peers and follows an active viewport', async () => {
    const fixture = await createFixture([region()]);
    const streams: { onmessage: ((event: { data: string }) => void) | null }[] = [];
    vi.stubGlobal('EventSource', class {
      onmessage: ((event: { data: string }) => void) | null = null; onopen = null; onerror = null;
      constructor() { streams.push(this); queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'ready', cursor: 'fixture:1', reset: true, events: [], peers: [], timer: null, serverTime: Date.now() }) })); } addEventListener() {} close() {}
    });
    vi.stubGlobal('fetch', vi.fn((input, init) => appRequest(input, init)));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    client = { ...client, embedded: false, baseUrl: 'http://studio.test', token: 'fixture-owner' };
    await mount({ artifactId: fixture.board.artifact.id }); await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]'));
    const remote = { ...LOCAL_ACTOR, id: 'remote', name: '同名协作者' }, other = { ...remote, id: 'another' };
    const peer = (peerId: string, actor: Actor, updatedAt: string, x: number) => ({ peerId, actor, updatedAt, cursor: { x, y: 1 }, context: { viewId: peerId, artifactId: fixture.board.artifact.id, selectedIds: [], viewport: { x, y: 0, zoom: 1 } } });
    const peers = [peer('my-other-tab', LOCAL_ACTOR, '2026-11-14T10:00:03Z', 5), peer('remote-old', remote, '2026-11-14T10:00:01Z', 10), peer('remote-active', remote, '2026-11-14T10:00:03Z', 30), peer('another-page', other, '2026-11-14T10:00:02Z', 20)];
    const emit = async (pages: typeof peers) => act(async () => streams.at(-1)!.onmessage!({ data: JSON.stringify({ type: 'presence', artifactId: fixture.board.artifact.id, peers: pages }) }));
    await emit(peers); await click(button('分享')); await click(button('此刻在这里'));
    expect(container.querySelectorAll('.studio-online-row')).toHaveLength(2);
    expect(button('此刻在这里').querySelectorAll('.studio-online-avatar')).toHaveLength(2);
    expect(container.textContent).toContain('同名协作者');
    await click([...container.querySelectorAll<HTMLButtonElement>('.studio-online-row button')][0]!);
    const canvas = container.querySelector('[aria-label="白板画布"]')!;
    await waitUntil(() => Math.abs((JSON.parse(canvas.getAttribute('data-external-viewport') || '{}').x || 0) - 30) < .1);
    expect(canvas.getAttribute('data-peers')?.split(',')).toHaveLength(4);
    await emit(peers.filter(page => page.peerId !== 'remote-active'));
    await waitUntil(() => Math.abs((JSON.parse(canvas.getAttribute('data-external-viewport') || '{}').x || 0) - 10) < .1);
    vi.useFakeTimers(); await emit(peers.filter(page => page.actor.id !== remote.id));
    await act(async () => { await vi.advanceTimersByTimeAsync(1001); }); vi.useRealTimers();
    expect(container.querySelector('.studio-follow-banner')).toBeNull();
  });

  it('refreshes joined members, online state and roles while the same share panel remains open', async () => {
    const fixture = await createFixture();
    const member = { id: 'guest-member', name: '新加入的人', role: 'editor' as const, joinedAt: '', lastSeenAt: '', active: true, online: true };
    let state = { enabled: true, access: 'local' as const, members: [] as ({ role: string } & Omit<typeof member, 'role'>)[], owner: LOCAL_ACTOR };
    const execute = call.getMockImplementation()!;
    call.mockImplementation((name, args) => name === 'artifact_share' && args.action === 'status' ? Promise.resolve(state) : execute(name, args));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await mount({ artifactId: fixture.board.artifact.id }); await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]'));
    vi.useFakeTimers(); await click(button('分享'));
    expect(button('一般访问权限').disabled).toBe(false);
    const panel = container.querySelector('.studio-share-panel'); expect(panel?.textContent).not.toContain(member.name);
    state = { ...state, members: [member] };
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(container.querySelector('.studio-share-panel')).toBe(panel); expect(panel?.textContent).toContain(member.name); expect(panel?.textContent).toContain('在线');
    state = { ...state, members: [{ ...member, role: 'viewer', online: false }] };
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); }); vi.useRealTimers();
    expect(button(`管理成员：${member.name}`).textContent).toBe('仅查看'); expect(panel?.textContent).toContain('离线');
  });

  it('keeps search, filters, views, import and icon theme switching usable in the compact library header', async () => {
    await createFixture();
    await service.execute('artifact_manage', { action: 'create', title: '系统规划' }, LOCAL_ACTOR);
    const items = await service.execute('artifact_list', {}, LOCAL_ACTOR);
    const pinned = items.artifacts.find((item: { id: string; title: string }) => item.title === '系统规划')!;
    await service.execute('artifact_manage', { action: 'pin', artifactId: pinned.id, pinned: true }, LOCAL_ACTOR);
    await mount();
    await waitUntil(() => container.querySelectorAll('.studio-artifact').length === 2);

    expect(container.querySelector('select[aria-label="主题"]')).toBeNull();

    await click(button('切换为列表视图'));
    expect(container.querySelector('.studio-artifacts-list')).not.toBeNull();
    expect(localStorage.getItem('agentero-studio-view')).toBe('list');
    expect(button('切换为卡片视图').title).toBe('切换为卡片视图');
    await click(button('切换为卡片视图'));
    expect(container.querySelector('.studio-artifacts-grid')).not.toBeNull();
    expect(localStorage.getItem('agentero-studio-view')).toBe('grid');
    await click(button('切换为列表视图'));
    await click(button('搜索作品'));
    const search = container.querySelector<HTMLInputElement>('[aria-label="搜索作品名称"]')!;
    expect(document.activeElement).toBe(search);
    await change(search, '架构');
    await waitUntil(() => container.querySelectorAll('.studio-artifact').length === 1);
    expect(container.querySelector('.studio-artifact h3')?.textContent).toBe('架构讨论');
    await act(async () => search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await waitUntil(() => container.querySelectorAll('.studio-artifact').length === 2);
    expect(container.querySelector('[aria-label="搜索作品名称"]')).toBeNull();
    expect(document.activeElement).toBe(button('搜索作品'));

    await click(button('筛选作品'));
    expect(document.activeElement).toBe(button('最近作品'));
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    expect(document.activeElement).toBe(button('已固定'));
    await click(button('已固定'));
    await waitUntil(() => container.querySelectorAll('.studio-artifact').length === 1);
    expect(container.querySelector('.studio-artifact h3')?.textContent).toBe('系统规划');
    expect(button('筛选作品').getAttribute('aria-expanded')).toBe('false');
    await click(button('筛选作品'));
    expect(document.activeElement).toBe(button('已固定'));
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.activeElement).toBe(button('筛选作品'));
    expect(container.querySelector('[role="menu"]')).toBeNull();

    await click(button('切换为暗色主题'));
    expect(container.querySelector('.studio')?.getAttribute('data-studio-theme')).toBe('dark');
    expect(button('切换为明亮主题').textContent).toBe('');
    await click(button('切换为明亮主题'));
    expect(container.querySelector('.studio')?.getAttribute('data-studio-theme')).toBe('light');
    const archive = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const chooseArchive = vi.spyOn(archive, 'click').mockImplementation(() => {});
    await click(button('新建作品'));
    expect(document.activeElement).toBe(button('白板'));
    await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(container.querySelector('[role="menu"]')).toBeNull();
    await click(button('新建作品'));
    await click(button('导入作品'));
    expect(chooseArchive).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it('creates from the new menu, renames, pins, trashes and restores the same persisted artifact', async () => {
    await mount();
    await waitUntil(() => call.mock.calls.some(([name]) => name === 'artifact_list'));
    await click(button('新建作品'));
    expect(call.mock.calls.some(([name, args]) => name === 'artifact_manage' && args.action === 'create')).toBe(false);
    expect(container.querySelector('[aria-label="白板画布"]')).toBeNull();
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
    expect(document.activeElement).toBe(button('导入作品'));
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(button('新建作品'));
    await act(async () => button('新建作品').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    await click(button('白板'));
    await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]'));
    expect(container.querySelector('select[aria-label="主题"]')).toBeNull();
    await click(button('分享'));
    await waitUntil(() => !!container.querySelector('.studio-share-panel'));
    await click(button('切换为暗色主题'));
    expect(container.querySelector('.studio')?.getAttribute('data-studio-theme')).toBe('dark');
    await click(button('切换为明亮主题'));
    await click(button('分享'));
    let items = await service.execute('artifact_list', {}, LOCAL_ACTOR);
    expect(items.artifacts).toHaveLength(1);
    const artifactId = items.artifacts[0].id;

    const title = container.querySelector<HTMLInputElement>('[aria-label="白板名称"]')!;
    await act(async () => title.focus());
    await change(title, '硬件系统架构');
    await act(async () => title.blur());
    await waitUntil(() => call.mock.calls.some(([name, args]) => name === 'artifact_manage' && args.action === 'rename'));
    await click(button('返回作品中心'));
    await waitUntil(() => !!container.querySelector('[aria-label="打开白板：硬件系统架构"]'));
    await click(button('管理作品：硬件系统架构'));
    await click(button('固定'));
    await waitUntil(() => !!container.querySelector('.studio-pin-mark'));
    items = await service.execute('artifact_list', { pinned: true }, LOCAL_ACTOR);
    expect(items.artifacts.map((item: { id: string }) => item.id)).toEqual([artifactId]);

    await click(button('管理作品：硬件系统架构'));
    await click(button('移入回收站'));
    await waitUntil(() => !container.querySelector('[aria-label="打开白板：硬件系统架构"]'));
    expect((await service.execute('artifact_list', {}, LOCAL_ACTOR)).artifacts).toHaveLength(0);
    await click(button('筛选作品'));
    await click(button('回收站'));
    await waitUntil(() => !!container.querySelector('[aria-label="打开白板：硬件系统架构"]'));
    await click(button('恢复作品：硬件系统架构'));
    await waitUntil(() => !container.querySelector('[aria-label="打开白板：硬件系统架构"]'));
    items = await service.execute('artifact_list', {}, LOCAL_ACTOR);
    expect(items.artifacts[0]).toMatchObject({ id: artifactId, title: '硬件系统架构', pinned: true });
    expect(items.artifacts[0].trashedAt).toBeUndefined();
  });

  it('imports HTML as a persisted independent region without blocking unrelated board changes', async () => {
    const fixture = await createFixture();
    await mount({ artifactId: fixture.board.artifact.id });
    await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]'));
    await click(button('导入 HTML'));
    const html = '<!doctype html><html><body><svg><rect data-node="input" width="80" height="40"/></svg></body></html>';
    await change(container.querySelector<HTMLTextAreaElement>('#studio-html-source')!, html);
    await submit(container.querySelector<HTMLFormElement>('[role="dialog"] form')!);
    await waitUntil(() => !container.querySelector('[role="dialog"]'));
    let saved = await service.execute('artifact_read', { artifactId: fixture.board.artifact.id });
    expect(saved.elements).toHaveLength(1);
    expect(saved.elements[0]).toMatchObject({ type: 'html', html, sourceRevision: 1 });
    const request = call.mock.calls.find(([name]) => name === 'artifact_apply');
    expect(request?.[1].operationId).toBeTruthy();
    expect(request?.[1].merge).toBe('safe');
    const addedId = request?.[1].operations[0].element.id;
    expect(request?.[1].expectedVersions).toEqual({ [addedId]: 0 });
  });

  it('offers a scoped explicit reader link after host open fails and watches the original view without creating another grant', async () => {
    const fixture = await createFixture([region()]), { request, openLink } = readerTransport();
    await mount({ artifactId: fixture.board.artifact.id });
    await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]'));
    await click(button('独立阅读 HTML'));
    await waitUntil(() => !!container.querySelector('.studio-reader-fallback a'));
    const fallback = container.querySelector<HTMLAnchorElement>('.studio-reader-fallback a')!, url = new URL(fallback.href);
    expect(url.pathname).toBe(`/region/${fixture.board.artifact.id}/region-one`);
    expect(url.hash).toBe('#cap=limited-reader'); expect(url.searchParams.has('token')).toBe(false);
    expect(fallback.href).not.toContain(client.token);
    expect(fallback.target).toBe('_blank'); expect(fallback.rel).toBe('noopener noreferrer');
    expect(openLink).toHaveBeenCalledExactlyOnceWith(fallback.href);
    const creates = request.mock.calls.filter(([input, init]) => new URL(input).pathname === '/api/region-view' && init?.method === 'POST');
    expect(creates).toHaveLength(1);
    const target = JSON.parse(String(creates[0]![1]?.body));
    expect(target).toEqual({ artifactId: fixture.board.artifact.id, regionId: 'region-one', viewId: expect.any(String) });
    expect(creates[0]![1]?.headers).toMatchObject({ Authorization: `Bearer ${client.token}` });
    expect(request.mock.calls.some(([input, init]) => new URL(input).pathname === '/api/region-view' && init?.method !== 'POST')).toBe(false);
    // Keep JSDOM in this document while exercising the anchor's real click handler.
    fallback.addEventListener('click', event => event.preventDefault(), { once: true });
    await click(fallback);
    await waitUntil(() => request.mock.calls.some(([input, init]) => new URL(input).pathname === '/api/region-view' && init?.method !== 'POST'));
    const poll = request.mock.calls.find(([input, init]) => new URL(input).pathname === '/api/region-view' && init?.method !== 'POST')!;
    const pollUrl = new URL(poll[0]);
    expect(pollUrl.searchParams.get('artifactId')).toBe(fixture.board.artifact.id);
    expect(pollUrl.searchParams.get('viewId')).toBe(target.viewId);
    expect(pollUrl.href).not.toContain(client.token);
    expect(request.mock.calls.filter(([input, init]) => new URL(input).pathname === '/api/region-view' && init?.method === 'POST')).toHaveLength(1);
    expect(container.querySelector('.studio-reader-fallback')).toBeNull();
  });

  it('reserves a Web reader tab during the click before awaiting its scoped link', async () => {
    const fixture = await createFixture([region()]), { request, openLink } = readerTransport();
    client.embedded = false;
    const order: string[] = [], originalRequest = request.getMockImplementation()!;
    request.mockImplementation(async (...args) => { if (new URL(args[0]).pathname === '/api/region-view' && args[1]?.method === 'POST') order.push('grant'); return originalRequest(...args); });
    const replace = vi.fn(), close = vi.fn();
    const tab = { opener: window, closed: false, location: { replace }, close };
    const open = vi.spyOn(window, 'open').mockImplementation(() => { order.push('tab'); return tab as unknown as Window; });
    await mount({ artifactId: fixture.board.artifact.id });
    await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]'));
    await click(button('独立阅读 HTML'));
    await waitUntil(() => replace.mock.calls.length === 1);
    expect(order.slice(0, 2)).toEqual(['tab', 'grant']);
    expect(open).toHaveBeenCalledExactlyOnceWith('about:blank', '_blank');
    expect(tab.opener).toBeNull(); expect(openLink).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
    const url = new URL(replace.mock.calls[0]![0]);
    expect(url.pathname).toBe(`/region/${fixture.board.artifact.id}/region-one`);
    expect(url.hash).toBe('#cap=limited-reader'); expect(url.searchParams.has('token')).toBe(false);
  });

  it('closes a reserved Web reader tab when its scoped request fails', async () => {
    const fixture = await createFixture([region()]), { request } = readerTransport();
    client.embedded = false;
    const original = request.getMockImplementation()!;
    request.mockImplementation((input, init) => new URL(String(input)).pathname === '/api/region-view' ? Promise.resolve(Response.json({ ok: false, error: { code: 'FORBIDDEN', message: '无法创建阅读链接' } }, { status: 403 })) : original(input, init));
    const tab = { opener: window, closed: false, location: { replace: vi.fn() }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    await mount({ artifactId: fixture.board.artifact.id });
    await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]'));
    await click(button('独立阅读 HTML'));
    await waitUntil(() => tab.close.mock.calls.length === 1);
    expect(tab.location.replace).not.toHaveBeenCalled(); expect(container.textContent).toContain('无法创建阅读链接');
  });

  it('clears a blocked reader link when switching artifacts and when returning home', async () => {
    const first = await createFixture([region()]);
    const second = await service.execute('artifact_manage', { action: 'create', title: '另一块白板', elements: [region()] }, LOCAL_ACTOR) as { board: Board };
    const { request } = readerTransport();
    await mount({ artifactId: first.board.artifact.id });
    await waitUntil(() => container.querySelector('[aria-label="白板画布"]')?.getAttribute('data-artifact') === first.board.artifact.id);
    await click(button('独立阅读 HTML'));
    await waitUntil(() => !!container.querySelector('.studio-reader-fallback a'));
    expect(container.querySelector<HTMLAnchorElement>('.studio-reader-fallback a')?.href).toContain(`/region/${first.board.artifact.id}/region-one`);
    await mount({ artifactId: second.board.artifact.id });
    await waitUntil(() => container.querySelector('[aria-label="白板画布"]')?.getAttribute('data-artifact') === second.board.artifact.id);
    expect(container.querySelector('.studio-reader-fallback')).toBeNull();
    await click(button('独立阅读 HTML'));
    await waitUntil(() => !!container.querySelector('.studio-reader-fallback a'));
    expect(container.querySelector<HTMLAnchorElement>('.studio-reader-fallback a')?.href).toContain(`/region/${second.board.artifact.id}/region-one`);
    await click(button('返回作品中心'));
    await waitUntil(() => !!container.querySelector('.studio-library-main'));
    expect(container.querySelector('.studio-reader-fallback')).toBeNull();
    const targets = request.mock.calls.filter(([input, init]) => new URL(input).pathname === '/api/region-view' && init?.method === 'POST').map(([, init]) => JSON.parse(String(init?.body)));
    expect(targets.map(target => target.artifactId)).toEqual([first.board.artifact.id, second.board.artifact.id]);
  });

  it('freezes internal HTML selection and original source even when the region changed before commenting', async () => {
    const original = '<h1 data-node="input">输入节点</h1>';
    const fixture = await createFixture([region(original)]);
    const attach = vi.fn(async (_feedback: Feedback, _board: Pick<Board, 'artifact'>) => {});
    await mount({ artifactId: fixture.board.artifact.id, attach });
    await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]'));
    await click(button('标注 HTML 内部'));
    await apply(fixture.board, [{ op: 'update', id: 'region-one', changes: { html: '<h1>已被他人修改的新内容</h1>' } }]);
    await change(container.querySelector<HTMLTextAreaElement>('[aria-label="批注内容"]')!, '把输入节点改成强调色');
    const compose = container.querySelector<HTMLFormElement>('.studio-comment-compose')!;
    expect(compose.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
    expect(container.querySelector('[aria-label="反馈类型"]')).toBeNull();
    await submit(compose);
    await waitUntil(() => !container.querySelector('.studio-comment-compose') && !!container.querySelector('[data-feedback-id]'));
    const result = await service.execute('artifact_feedback', { action: 'list', artifactId: fixture.board.artifact.id });
    expect(result.feedback).toHaveLength(1);
    expect(result.feedback[0]).toMatchObject({ type: 'comment', status: 'open' });
    expect(attach).not.toHaveBeenCalled();
    expect(call.mock.calls.some(([name, args]) => name === 'artifact_feedback' && args.action === 'send')).toBe(false);
    expect(result.feedback[0].anchor).toMatchObject({ regionId: 'region-one', sourceRevision: 1, targetIds: ['node-input'], quote: '输入节点' });
    const source = await service.execute('artifact_read', { artifactId: fixture.board.artifact.id, mode: 'source', feedbackId: result.feedback[0].id });
    expect(source.html).toBe(original);
    await click(button('备注列表'));
    await waitUntil(() => !!container.querySelector('.studio-comment-list-item'));
    await click(container.querySelector<HTMLButtonElement>('.studio-comment-list-item')!);
    await click(button('备注操作'));
    await click(button('附加到对话'));
    await waitUntil(() => attach.mock.calls.length === 1);
    expect(attach.mock.calls[0]?.[0]).toMatchObject({ id: result.feedback[0].id, anchor: result.feedback[0].anchor });
  });

  it('freezes native object versions through the same comment composer as internal HTML selections', async () => {
    const table: Board['elements'][number] = { id: 'native-table', type: 'table', x: 750, y: 10, w: 300, h: 180, version: 1, data: { rows: [['名称', '说明'], ['原始内容', '待核对']] } };
    const fixture = await createFixture([region(), table]);
    await mount({ artifactId: fixture.board.artifact.id });
    await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]'));
    await click(button('标注原生表格'));
    expect(container.querySelector('.studio-comment-target')?.textContent).toContain('表格，2 行 × 2 列');
    expect(container.querySelector('.studio-comment-target')?.textContent).not.toContain('对象 · table');
    await apply(fixture.board, [{ op: 'update', id: table.id, changes: { data: { rows: [['已经变更']] } } }]);
    await change(container.querySelector<HTMLTextAreaElement>('[aria-label="批注内容"]')!, '讨论原始表格');
    await submit(container.querySelector<HTMLFormElement>('.studio-comment-compose')!);
    await waitUntil(() => !container.querySelector('.studio-comment-compose') && !!container.querySelector('[data-feedback-id]'));
    const result = await service.execute('artifact_feedback', { action: 'list', artifactId: fixture.board.artifact.id });
    expect(result.feedback[0]).toMatchObject({ anchor: { coordinateSpace: 'element', elementIds: [table.id], x: 1, y: .5 }, versions: { [table.id]: 1 } });
    const frozen = await service.execute('artifact_read', { mode: 'source', artifactId: fixture.board.artifact.id, feedbackId: result.feedback[0].id, elementId: table.id });
    expect(frozen.element).toMatchObject({ id: table.id, version: 1, data: table.data });
  });

  it('retains an unsent comment while changing targets and clicking outside its composer', async () => {
    const fixture = await createFixture([region()]);
    await mount({ artifactId: fixture.board.artifact.id });
    await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]'));
    await click(button('标注 HTML 内部'));
    await change(container.querySelector<HTMLTextAreaElement>('[aria-label="批注内容"]')!, '保留当前输入');
    await click(document.body);
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="批注内容"]')?.value).toBe('保留当前输入');
    await click(button('标注 HTML 输出'));
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="批注内容"]')?.value).toBe('保留当前输入');
    expect(container.querySelector('.studio-comment-target')?.textContent).toContain('输出节点');
    expect(call.mock.calls.filter(([name, args]) => name === 'artifact_feedback' && args.action === 'create')).toHaveLength(0);
  });

  it('edits and deletes an own comment thread through the actual feedback service', async () => {
    const fixture = await createFixture([region()]);
    const created = await service.execute('artifact_feedback', { action: 'create', artifactId: fixture.board.artifact.id, operationId: crypto.randomUUID(), text: '原备注', anchor: { regionId: 'region-one', sourceRevision: 1 } }, LOCAL_ACTOR);
    await mount({ artifactId: fixture.board.artifact.id });
    await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]'));
    await click(button('备注列表'));
    await waitUntil(() => !!container.querySelector('.studio-comment-list-item'));
    await click(container.querySelector<HTMLElement>('.studio-comment-list-item')!);
    await click(button('备注操作')); await click(button('编辑'));
    await change(container.querySelector<HTMLTextAreaElement>('[aria-label="编辑备注内容"]')!, '更新后的备注');
    await submit(container.querySelector<HTMLFormElement>('.studio-comment-edit')!);
    await waitUntil(() => !container.querySelector('.studio-comment-edit') && container.querySelector('.studio-feedback-message')?.textContent === '更新后的备注');
    await click(button('备注操作')); await click(button('删除备注线程'));
    expect((await service.execute('artifact_feedback', { action: 'list', artifactId: fixture.board.artifact.id })).feedback).toHaveLength(1);
    await click(button('删除'));
    await waitUntil(() => !container.querySelector('.studio-comment-popover'));
    expect((await service.execute('artifact_feedback', { action: 'list', artifactId: fixture.board.artifact.id })).feedback).toHaveLength(0);
    expect(call.mock.calls.find(([name, args]) => name === 'artifact_feedback' && args.action === 'delete')?.[1].feedbackId).toBe(created.feedback[0].id);
  });

  it('keeps an explicitly attached Web guest comment pending for the owner', async () => {
    const fixture = await createFixture([region()]);
    const guest: Actor = { id: 'guest-one', name: '同事', kind: 'human', role: 'commenter' };
    client.embedded = false;
    call.mockImplementation((name: ToolName, args: Record<string, unknown> = {}) => service.execute(name, args, guest));
    await mount({ artifactId: fixture.board.artifact.id, actor: guest });
    await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]'));
    await click(button('备注'));
    await click(button('标注 HTML 内部'));
    await change(container.querySelector<HTMLTextAreaElement>('[aria-label="批注内容"]')!, '请补充状态机');
    const compose = container.querySelector<HTMLFormElement>('.studio-comment-compose')!;
    await click(compose.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    await submit(compose);
    await waitUntil(() => !container.querySelector('.studio-comment-popover'));
    const { feedback } = await service.execute('artifact_feedback', { action: 'list', artifactId: fixture.board.artifact.id });
    expect(feedback[0]).toMatchObject({ type: 'comment', status: 'pending', author: { id: guest.id }, text: '请补充状态机' });
    expect(call.mock.calls.find(([name, args]) => name === 'artifact_feedback' && args.action === 'send')?.[1]).toMatchObject({ artifactId: fixture.board.artifact.id, feedbackId: feedback[0].id });
    expect(container.querySelector('[aria-label="返回作品中心"]')).toBeNull();
  });

  it('opens existing comments from the list and persists replies, resolution and reopening', async () => {
    const fixture = await createFixture([region()]);
    await service.execute('artifact_feedback', { action: 'create', operationId: crypto.randomUUID(), artifactId: fixture.board.artifact.id, type: 'comment', text: '需要补充说明', anchor: { regionId: 'region-one', sourceRevision: 1 } }, LOCAL_ACTOR);
    await mount({ artifactId: fixture.board.artifact.id });
    await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]'));
    await click(button('备注列表'));
    await waitUntil(() => !!container.querySelector('.studio-comment-list-item'));
    await click(container.querySelector<HTMLButtonElement>('.studio-comment-list-item')!);
    await change(container.querySelector<HTMLTextAreaElement>('[aria-label="回复批注：需要补充说明"]')!, '已补充接口约束');
    await submit(container.querySelector<HTMLFormElement>('.studio-reply-form')!);
    await waitUntil(() => container.querySelector('.studio-feedback-reply')?.textContent?.includes('已补充接口约束') === true);
    let result = await service.execute('artifact_feedback', { action: 'list', artifactId: fixture.board.artifact.id });
    expect(result.feedback[0].replies).toHaveLength(1);
    expect(result.feedback[0].replies[0].text).toBe('已补充接口约束');
    await click(button('解决'));
    await waitUntil(() => !container.querySelector('.studio-comment-popover'));
    await click(button('备注列表'));
    expect(container.querySelector('.studio-comment-list-item')).toBeNull();
    await click(button('筛选备注'));
    await click(button('显示已解决'));
    await waitUntil(() => !!container.querySelector('.studio-comment-list-item[data-status="resolved"]'));
    await click(container.querySelector<HTMLButtonElement>('.studio-comment-list-item')!);
    await click(button('备注操作'));
    await click(button('重新打开'));
    await waitUntil(() => container.querySelector('.studio-comment-thread[data-status="open"]') !== null);
    result = await service.execute('artifact_feedback', { action: 'list', artifactId: fixture.board.artifact.id });
    expect(result.feedback[0].status).toBe('open');
    expect(result.feedback[0].replies[0].text).toBe('已补充接口约束');
  });

  it('reuses a committed reply ID after a lost acknowledgement and closing/reopening the thread', async () => {
    const fixture = await createFixture([region()]);
    await service.execute('artifact_feedback', { action: 'create', operationId: crypto.randomUUID(), artifactId: fixture.board.artifact.id, type: 'comment', text: '回复确认测试', anchor: { regionId: 'region-one', sourceRevision: 1 } }, LOCAL_ACTOR);
    const execute = call.getMockImplementation()!; let loseAck = true;
    call.mockImplementation(async (name, args) => {
      const result = await execute(name, args);
      if (name === 'artifact_feedback' && args.action === 'reply' && loseAck) { loseAck = false; throw new Error('回复已保存，但确认丢失。'); }
      return result;
    });
    await mount({ artifactId: fixture.board.artifact.id }); await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]'));
    const open = async () => { await click(button('备注列表')); await waitUntil(() => !!container.querySelector('.studio-comment-list-item')); await click(container.querySelector<HTMLElement>('.studio-comment-list-item')!); };
    await open();
    await change(container.querySelector<HTMLTextAreaElement>('[aria-label="回复批注：回复确认测试"]')!, '保持这条回复');
    await submit(container.querySelector<HTMLFormElement>('.studio-reply-form')!);
    await waitUntil(() => container.querySelector('.studio-comment-error')?.textContent?.includes('确认丢失') === true);
    let saved = await service.execute('artifact_feedback', { action: 'list', artifactId: fixture.board.artifact.id });
    expect(saved.feedback[0].replies).toHaveLength(1);
    await click(button('关闭备注')); expect(container.querySelector('.studio-reply-form')).toBeNull();
    await open(); expect(container.querySelector<HTMLTextAreaElement>('[aria-label="回复批注：回复确认测试"]')?.value).toBe('保持这条回复');
    await submit(container.querySelector<HTMLFormElement>('.studio-reply-form')!);
    await waitUntil(() => container.querySelector<HTMLTextAreaElement>('[aria-label="回复批注：回复确认测试"]')?.value === '');
    saved = await service.execute('artifact_feedback', { action: 'list', artifactId: fixture.board.artifact.id });
    expect(saved.feedback[0].replies).toHaveLength(1);
    let attempts = call.mock.calls.filter(([name, args]) => name === 'artifact_feedback' && args.action === 'reply');
    expect(attempts).toHaveLength(2); expect(attempts[1]![1].replyId).toBe(attempts[0]![1].replyId);
    await change(container.querySelector<HTMLTextAreaElement>('[aria-label="回复批注：回复确认测试"]')!, '保持这条回复');
    await submit(container.querySelector<HTMLFormElement>('.studio-reply-form')!);
    await waitUntil(() => container.querySelectorAll('.studio-feedback-reply').length === 2);
    attempts = call.mock.calls.filter(([name, args]) => name === 'artifact_feedback' && args.action === 'reply');
    expect(attempts[2]![1].replyId).not.toBe(attempts[0]![1].replyId);
  });

  it('retries attaching the saved comment after a host failure without creating it again', async () => {
    const fixture = await createFixture([region()]);
    const attach = vi.fn().mockRejectedValueOnce(new Error('对话草稿暂不可用')).mockResolvedValueOnce(undefined);
    await mount({ artifactId: fixture.board.artifact.id, attach });
    await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]'));
    await click(button('备注'));
    expect(button('备注').getAttribute('aria-pressed')).toBe('true');
    await click(button('标注 HTML 内部'));
    await change(container.querySelector<HTMLTextAreaElement>('[aria-label="批注内容"]')!, '把输入节点改成强调色');
    const compose = container.querySelector<HTMLFormElement>('.studio-comment-compose')!;
    const attachToggle = compose.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(attachToggle.checked).toBe(false);
    expect(attachToggle.closest('label')?.textContent).toContain('附加到对话');
    await click(attachToggle);
    await submit(compose);
    await waitUntil(() => attach.mock.calls.length === 1 && !!container.querySelector('[role="alert"]'));
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="批注内容"]')?.value).toBe('把输入节点改成强调色');
    let saved = await service.execute('artifact_feedback', { action: 'list', artifactId: fixture.board.artifact.id });
    expect(saved.feedback).toHaveLength(1);
    expect(saved.feedback[0]).toMatchObject({ type: 'comment', status: 'open' });
    expect(attach.mock.calls[0]?.[0]).toMatchObject({ id: saved.feedback[0].id });
    await submit(container.querySelector<HTMLFormElement>('.studio-comment-compose')!);
    await waitUntil(() => attach.mock.calls.length === 2 && !container.querySelector('.studio-comment-popover'));
    saved = await service.execute('artifact_feedback', { action: 'list', artifactId: fixture.board.artifact.id });
    expect(saved.feedback).toHaveLength(1);
    expect(attach.mock.calls[1]?.[0]).toMatchObject({ id: saved.feedback[0].id });
    expect(call.mock.calls.filter(([name, args]) => name === 'artifact_feedback' && args.action === 'create')).toHaveLength(1);
    expect(call.mock.calls.some(([name, args]) => name === 'artifact_feedback' && args.action === 'send')).toBe(false);
  });

  it('opens one header popover at a time and exports through the active product without enabling sharing', async () => {
    const fixture = await createFixture();
    const exportDocument = vi.spyOn(whiteboardProduct, 'exportDocument').mockResolvedValue(undefined);
    await mount({ artifactId: fixture.board.artifact.id });
    await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]'));
    await click(button('版本历史'));
    await waitUntil(() => !!container.querySelector('.studio-history-panel'));
    expect(container.querySelectorAll('.studio-editor-popover')).toHaveLength(1);
    await click(button('分享'));
    await waitUntil(() => !!container.querySelector('.studio-share-panel'));
    expect(container.querySelector('.studio-history-panel')).toBeNull();
    expect(container.querySelectorAll('.studio-editor-popover')).toHaveLength(1);
    await click(button('导出'));
    expect(container.querySelectorAll('.studio-editor-export-option')).toHaveLength(whiteboardProduct.exportFormats.length + 1);
    await click(button('白板文件 (.json)', true));
    await waitUntil(() => exportDocument.mock.calls.length === 1);
    expect(exportDocument.mock.calls[0]).toEqual([expect.objectContaining({ artifact: expect.objectContaining({ id: fixture.board.artifact.id }) }), 'json', client]);
    expect(call.mock.calls.some(([name, args]) => name === 'artifact_share' && args.action === 'start')).toBe(false);
    const local = await service.execute('artifact_share', { action: 'status', artifactId: fixture.board.artifact.id });
    expect(local.enabled).toBe(false);
    expect(container.querySelector('[aria-label="局域网共享已开启"]')).toBeNull();
  });

  it('previews history without mutating the live board, then restores while retaining subsequent history', async () => {
    const fixture = await createFixture();
    const changed = await apply(fixture.board, [{ op: 'add', element: { id: 'shape-one', type: 'shape', x: 20, y: 20, w: 100, h: 80, text: '新内容' } }]);
    await mount({ artifactId: fixture.board.artifact.id });
    await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]'));
    await click(button('版本历史'));
    await waitUntil(() => container.querySelectorAll('.studio-history-record').length === 2);
    await click(button('展开版本 0'));
    await click(button('预览版本'));
    await waitUntil(() => container.querySelector('[aria-label="白板画布"]')?.getAttribute('data-read-only') === 'true');
    expect((await service.execute('artifact_read', { artifactId: fixture.board.artifact.id })).elements).toHaveLength(1);
    await click(button('恢复为新版本'));
    expect(call.mock.calls.some(([name, args]) => name === 'artifact_apply' && args.operations?.[0]?.op === 'restore')).toBe(false);
    await click(button('确认恢复'));
    await waitUntil(() => call.mock.calls.some(([name, args]) => name === 'artifact_apply' && args.operations?.[0]?.op === 'restore'));
    await waitUntil(() => container.querySelector('[aria-label="白板画布"]')?.getAttribute('data-read-only') === 'false');
    const current = await service.execute('artifact_read', { artifactId: fixture.board.artifact.id });
    const { history } = await service.execute('artifact_read', { artifactId: fixture.board.artifact.id, mode: 'history' });
    expect(current.elements).toHaveLength(0);
    expect(current.artifact.revision).toBeGreaterThan(changed.board.artifact.revision);
    expect(history).toHaveLength(3);
    expect(history.at(-1).restoredFrom).toBe(history[0].id);
  });

  it('rejects restoring a stale preview rather than overwriting another collaborator’s later change', async () => {
    const fixture = await createFixture();
    const first = await apply(fixture.board, [{ op: 'add', element: { id: 'shape-one', type: 'shape', x: 0, y: 0, w: 120, h: 80, text: '原内容' } }]);
    await mount({ artifactId: fixture.board.artifact.id });
    await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]'));
    await click(button('版本历史'));
    await waitUntil(() => container.querySelectorAll('.studio-history-record').length === 2);
    await click(button('展开版本 0'));
    await click(button('预览版本'));
    await waitUntil(() => container.querySelector('[aria-label="白板画布"]')?.getAttribute('data-read-only') === 'true');
    const second = await apply(first.board, [{ op: 'update', id: 'shape-one', changes: { text: '他人刚刚修改' } }]);
    await click(button('恢复为新版本'));
    await click(button('确认恢复'));
    await waitUntil(() => !!container.querySelector('[role="alert"]'));
    const saved = await service.execute('artifact_read', { artifactId: fixture.board.artifact.id });
    expect(saved.artifact.revision).toBe(second.board.artifact.revision);
    expect(saved.elements[0].text).toBe('他人刚刚修改');
  });

  it('copies a local role invitation without silently enabling LAN or copying an owner token', async () => {
    const fixture = await createFixture();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await mount();
    await waitUntil(() => !!container.querySelector(`[aria-label="管理作品：${fixture.board.artifact.title}"]`));
    await click(button(`管理作品：${fixture.board.artifact.title}`));
    await click(button('复制链接'));
    await waitUntil(() => writeText.mock.calls.length === 1);
    const status = await service.execute('artifact_share', { action: 'status', artifactId: fixture.board.artifact.id });
    expect(status).toMatchObject({ enabled: true, access: 'local' });
    expect(writeText).toHaveBeenCalledWith(status.links.viewer);
    expect(call.mock.calls.filter(([name, args]) => name === 'artifact_share' && args.action === 'start').map(([, args]) => args.access)).toEqual(['local']);
    expect(container.querySelector('[aria-label="局域网共享已开启"]')).toBeNull();
  });
  it('provides the actual local invitation for manual copy when the browser blocks the clipboard', async () => {
    const fixture = await createFixture();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) } });
    await mount({ artifactId: fixture.board.artifact.id }); await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]'));
    await click(button('分享')); await waitUntil(() => !button('复制可编辑链接').disabled);
    await click(button('复制可编辑链接'));
    await waitUntil(() => !!container.querySelector('[aria-label="邀请链接"]'));
    const state = await service.execute('artifact_share', { action: 'status', artifactId: fixture.board.artifact.id });
    expect(state.access).toBe('local');
    expect(container.querySelector<HTMLInputElement>('[aria-label="邀请链接"]')?.value).toBe(state.links.editor);
    expect(container.querySelector('[aria-label="局域网共享已开启"]')).toBeNull();
  });

  it('starts LAN sharing, rotates one role link and preserves invitations when returning to local access', async () => {
    const fixture = await createFixture();
    await mount({ artifactId: fixture.board.artifact.id });
    await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]'));
    await click(button('分享'));
    await waitUntil(() => !!container.querySelector('.studio-share-panel') && !button('一般访问权限').disabled);
    await click(button('一般访问权限'));
    await click(button('局域网可访问'));
    await waitUntil(() => !button('复制可编辑链接').disabled);
    const before = await service.execute('artifact_share', { action: 'status', artifactId: fixture.board.artifact.id });
    expect(before.enabled).toBe(true);
    expect(container.querySelector('[aria-label="局域网共享已开启"]')).not.toBeNull();
    await click(button('可编辑链接更多操作'));
    await click(button('重置此链接'));
    expect(call.mock.calls.some(([name, args]) => name === 'artifact_share' && args.action === 'reset')).toBe(false);
    await click(button('确认重置'));
    await waitUntil(() => !button('复制可编辑链接').disabled);
    const after = await service.execute('artifact_share', { action: 'status', artifactId: fixture.board.artifact.id });
    expect(after.links.editor).not.toBe(before.links.editor);
    expect(after.links.viewer).toBe(before.links.viewer);
    await click(button('一般访问权限'));
    await click(button('仅这台电脑'));
    await waitUntil(() => button('一般访问权限').textContent?.includes('仅这台电脑') === true && !button('一般访问权限').disabled);
    const local = await service.execute('artifact_share', { action: 'status', artifactId: fixture.board.artifact.id });
    expect(local).toMatchObject({ enabled: true, access: 'local' });
    for (const role of ['editor', 'commenter', 'viewer'] as const) expect(new URL(local.links[role], 'http://studio.test').searchParams.get('share')).toBe(new URL(after.links[role], 'http://studio.test').searchParams.get('share'));
    expect(container.querySelector('[aria-label="局域网共享已开启"]')).toBeNull();
  });
});

describe('Studio recycle bin workflows', () => {
  async function trashFixture(title: string): Promise<Artifact> {
    const created = await service.execute('artifact_manage', { action: 'create', title }, LOCAL_ACTOR) as { artifact: Artifact };
    const result = await service.execute('artifact_manage', { action: 'trash', artifactId: created.artifact.id }, LOCAL_ACTOR) as { artifact: Artifact };
    return result.artifact;
  }
  function confirmDelete() { return container.querySelector<HTMLButtonElement>('[role="dialog"] .studio-purge-confirm')!; }

  it.each(['grid', 'list'] as const)('confirms a single deletion in %s and keeps compact restore, selection and scope controls usable', async layout => {
    localStorage.setItem('agentero-studio-view', layout);
    const first = await trashFixture('可删除的作品'), second = await trashFixture('可以恢复的作品');
    await mount({ view: 'trash' });
    await waitUntil(() => container.querySelectorAll('.studio-artifact').length === 2);
    expect(container.querySelector('h1')?.textContent).toBe('回收站'); expect(container.querySelector('.studio-library-scope')).toBeNull();
    expect(container.querySelector('[aria-label="筛选作品"]')).toBeNull(); expect(container.querySelector('[aria-label="新建作品"]')).toBeNull();
    expect(container.querySelectorAll('.studio-artifact-preview')).toHaveLength(layout === 'grid' ? 2 : 0);
    expect(button(`恢复作品：${second.title}`).textContent).toBe(''); expect(button(`永久删除作品：${first.title}`).textContent).toBe('');
    await click(button('搜索回收站'));
    expect(container.querySelector<HTMLInputElement>('[aria-label="搜索回收站名称"]')?.placeholder).toBe('搜索回收站');
    await click(button(`永久删除作品：${first.title}`));
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('永久删除 1 项作品，此操作无法恢复');
    expect(call.mock.calls.some(([name, args]) => name === 'artifact_manage' && args.action === 'purge')).toBe(false);
    await click(button('取消'));
    expect((await service.execute('artifact_list', { trashed: true }, LOCAL_ACTOR)).artifacts).toHaveLength(2);
    await click(button(`永久删除作品：${first.title}`)); await click(confirmDelete());
    await waitUntil(() => container.querySelectorAll('.studio-artifact').length === 1 && !container.querySelector('[role="dialog"]') && !button(`恢复作品：${second.title}`).disabled);
    expect(call.mock.calls.find(([name, args]) => name === 'artifact_manage' && args.action === 'purge')?.[1]).toEqual({ action: 'purge', artifactId: first.id });
    const saved = await service.execute('artifact_list', { trashed: true }, LOCAL_ACTOR);
    expect(saved.artifacts.map((item: Artifact) => item.id)).toEqual([second.id]);
    await click(container.querySelector<HTMLInputElement>(`[aria-label="选择作品：${second.title}"]`)!);
    expect(container.querySelector('.studio-trash-selection')?.textContent).toContain('1 项已选');
    await click(button(`恢复作品：${second.title}`));
    await waitUntil(() => container.querySelectorAll('.studio-artifact').length === 0);
    expect((await service.execute('artifact_list', {}, LOCAL_ACTOR)).artifacts.map((item: Artifact) => item.id)).toEqual([second.id]);
    await click(button('返回最近作品'));
    await waitUntil(() => container.querySelector('h1')?.textContent === '作品');
  });

  it('retains failed selections and their error while removing successful batch items, then retries only the failed item', async () => {
    const first = await trashFixture('应删除成功'), failed = await trashFixture('暂时无法删除');
    call.mockImplementation(async (name: ToolName, args: Record<string, any>) => {
      if (name !== 'artifact_manage' || args.action !== 'purge') return service.execute(name, args, LOCAL_ACTOR);
      const ids: string[] = args.artifactIds || [args.artifactId];
      const result = await service.execute('artifact_manage', { action: 'purge', artifactIds: ids.filter(id => id !== failed.id) }, LOCAL_ACTOR) as { deletedIds: string[] };
      return { deletedIds: result.deletedIds, failures: [{ artifactId: failed.id, code: 'DELETE_FAILED', message: '文件正在使用，请重试。' }] };
    });
    await mount({ view: 'trash' }); await waitUntil(() => container.querySelectorAll('.studio-artifact').length === 2);
    await click(container.querySelector<HTMLInputElement>('[aria-label="全选当前页"]')!);
    expect(container.querySelector('.studio-trash-selection')?.textContent).toContain('2 项已选');
    await click(button('永久删除所选作品'));
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('永久删除 2 项作品');
    await click(confirmDelete());
    await waitUntil(() => container.querySelectorAll('.studio-artifact').length === 1 && !!container.querySelector('.studio-trash-errors') && !button('永久删除所选作品').disabled);
    expect(container.querySelector<HTMLInputElement>(`[aria-label="选择作品：${failed.title}"]`)?.checked).toBe(true);
    expect(container.querySelector('.studio-trash-errors')?.textContent).toContain('文件正在使用，请重试。');
    expect(container.querySelector('.studio-trash-errors')?.textContent).toContain(failed.title);
    expect((await service.execute('artifact_list', { trashed: true }, LOCAL_ACTOR)).artifacts.map((item: Artifact) => item.id)).toEqual([failed.id]);
    call.mockImplementation((name: ToolName, args: Record<string, unknown>) => service.execute(name, args, LOCAL_ACTOR));
    await click(button('永久删除所选作品')); await click(confirmDelete());
    await waitUntil(() => container.querySelectorAll('.studio-artifact').length === 0 && !container.querySelector('[role="dialog"]'));
    expect(container.querySelector('.studio-trash-errors')).toBeNull();
    const requests = call.mock.calls.filter(([name, args]) => name === 'artifact_manage' && args.action === 'purge').map(([, args]) => args);
    expect(requests[0].artifactIds).toEqual(expect.arrayContaining([first.id, failed.id]));
    expect(requests[1]).toEqual({ action: 'purge', artifactId: failed.id });
  });

  it('collects every unfiltered trash page before confirming clear, batches the fixed snapshot and retains a concurrently restored failure', async () => {
    const records = new Map<string, Artifact>(Array.from({ length: 105 }, (_, index) => { const id = `trash-${index}`; return [id, { id, title: index === 0 ? '唯一匹配的作品' : `作品 ${index}`, type: 'whiteboard', revision: 0, pinned: false, createdAt: '', updatedAt: '', trashedAt: '2026-11-14T10:00:00Z' }]; }));
    call.mockImplementation(async (name: ToolName, args: Record<string, any>) => {
      if (name === 'artifact_list') {
        const matches = [...records.values()].filter(item => !!item.trashedAt === !!args.trashed && (!args.query || item.title.includes(args.query)));
        const start = Number(args.cursor || 0), limit = Number(args.limit || 60);
        return { artifacts: matches.slice(start, start + limit), ...(start + limit < matches.length ? { nextCursor: String(start + limit) } : {}) };
      }
      if (name === 'artifact_manage' && args.action === 'purge') {
        const ids: string[] = args.artifactIds || [args.artifactId], deletedIds: string[] = [], failures = [];
        for (const id of ids) {
          if (!records.get(id)?.trashedAt) failures.push({ artifactId: id, code: 'NOT_TRASHED', message: '作品已恢复，不能永久删除。' });
          else { records.delete(id); deletedIds.push(id); }
        }
        return { deletedIds, failures };
      }
      throw new Error(`Unexpected ${name}`);
    });
    await mount({ view: 'trash' }); await waitUntil(() => container.querySelectorAll('.studio-artifact').length === 60);
    await click(button('搜索回收站')); await change(container.querySelector<HTMLInputElement>('[aria-label="搜索回收站名称"]')!, '唯一匹配');
    await waitUntil(() => container.querySelectorAll('.studio-artifact').length === 1);
    await click(button('清空回收站'));
    await waitUntil(() => !!container.querySelector('[role="dialog"]'));
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('永久删除 105 项作品');
    expect(call.mock.calls.filter(([name, args]) => name === 'artifact_list' && args.limit === 100).map(([, args]) => args)).toEqual([{ trashed: true, limit: 100 }, { trashed: true, limit: 100, cursor: '100' }]);
    expect(call.mock.calls.some(([name, args]) => name === 'artifact_manage' && args.action === 'purge')).toBe(false);
    records.set('later-trash', { ...records.get('trash-0')!, id: 'later-trash', title: '确认后移入的作品' });
    delete records.get('trash-104')!.trashedAt;
    await click(confirmDelete());
    await waitUntil(() => !container.querySelector('[role="dialog"]') && !!container.querySelector('.studio-trash-errors') && !button('清空回收站').disabled);
    const batches = call.mock.calls.filter(([name, args]) => name === 'artifact_manage' && args.action === 'purge').map(([, args]) => args.artifactIds as string[]);
    expect(batches.map(ids => ids.length)).toEqual([100, 5]);
    expect(batches.flat()).toEqual(Array.from({ length: 105 }, (_, index) => `trash-${index}`));
    expect([...records.keys()]).toEqual(['trash-104', 'later-trash']);
    expect(container.querySelector('.studio-trash-errors')?.textContent).toContain('作品已恢复，不能永久删除。');
    expect(container.querySelector('.studio-trash-selection')?.textContent).toContain('1 项已选');
  });
});

describe('Studio stale response protection', () => {
  it('ignores an older read result after a newer canvas commit', async () => {
    let resolveRead!: (board: Board) => void;
    const baseline: Board = { artifact: { id: 'synthetic-board', type: 'whiteboard', title: '并发白板', revision: 0, pinned: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, elements: [], style: DEFAULT_STYLE };
    call.mockImplementation((name: ToolName) => {
      if (name === 'artifact_list') return Promise.resolve({ artifacts: [] });
      if (name === 'artifact_manage') return Promise.resolve({ artifact: baseline.artifact, board: baseline });
      if (name === 'artifact_feedback') return Promise.resolve({ feedback: [] });
      if (name === 'artifact_read') return new Promise<Board>(resolve => { resolveRead = resolve; });
      throw new Error(`Unexpected ${name}`);
    });
    await mount();
    await click(button('新建作品'));
    await click(button('白板'));
    await waitUntil(() => !!container.querySelector('[aria-label="白板画布"]') && !!resolveRead);
    await click(button('模拟较新画布版本'));
    expect(container.querySelector('[aria-label="白板画布"]')?.getAttribute('data-revision')).toBe('5');
    await act(async () => { resolveRead(baseline); });
    expect(container.querySelector('[aria-label="白板画布"]')?.getAttribute('data-revision')).toBe('5');
  });
});
