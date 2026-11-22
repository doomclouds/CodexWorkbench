import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ServerResponse } from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  LOCAL_ACTOR,
  type Actor,
  type Board,
  type StudioClient,
  type SyncBatch,
  type ToolName,
} from '../../src/contracts/studio';
import { startStudioHost, type StudioHost } from '../../src/server/http';
import type { BoardOpenResponse } from '../../src/contracts/board-open.js';
import { createCollaboration } from '../../src/app/features/collaboration/useCollaboration';
import { whiteboardProduct } from '../../src/app/features/whiteboard/whiteboard';

vi.mock('../../src/app/features/whiteboard/canvas/WhiteboardCanvas', () => ({
  default: ({ board, readOnly }: { board: Board; readOnly: boolean }) => (
    <section
      aria-label="协作白板"
      data-revision={board.artifact.revision}
      data-read-only={String(readOnly)}
    />
  ),
}));
import StudioApp from '../../src/app/shell/StudioApp';
import { studioRequest } from '../../src/app/transport/client';

let directory = '';
let host: StudioHost;
let root: Root | undefined;
let container: HTMLDivElement | undefined;
const closes: (() => void)[] = [];
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  directory = await mkdtemp(join(tmpdir(), 'studio-front-sync-'));
  host = await startStudioHost({ dataRoot: directory });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
  }

  root = undefined;
  container?.remove();
  closes.splice(0).forEach((close) => close());
  await host.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) {
    throw new Error('Unexpected fixture path');
  }

  await rm(directory, { recursive: true, force: true });
});

async function until(check: () => boolean, deadlineMs = 1500) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() <= deadline) {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
    });

    if (check()) {
      return;
    }
  }

  throw new Error(`Sync did not settle: ${container?.textContent}`);
}

function client(token: string, cookie?: string): StudioClient {
  const request: NonNullable<StudioClient['request']> = (input, init) =>
    fetch(input, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init?.headers)),
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });

  return {
    embedded: true,
    baseUrl: host.origin,
    token,
    request,
    async call<T>(name: ToolName, args = {}) {
      const response = await request(`${host.origin}/api/tools/${name}`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(args),
      });
      const result = await response.json();
      if (!response.ok) {
        throw Object.assign(new Error(result.error.message), result.error);
      }

      return result.data as T;
    },
  };
}

async function joinViewer(artifactId: string): Promise<{ actor: Actor; cookie: string }> {
  const sharing = await host.service.execute('artifact_share', { artifactId, action: 'start' });
  const invitation = new URL(sharing.links.viewer).searchParams.get('share');
  const response = await fetch(`${host.origin}/api/session?artifactId=${artifactId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${invitation}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '尾包校对访客' }),
  });

  expect(response.ok).toBe(true);

  return {
    actor: (await response.json()).actor,
    cookie: response.headers.get('set-cookie')!.split(';')[0]!,
  };
}

function installHttpEventSource(cookie: string) {
  const connections = vi.fn();
  class HttpEventSource {
    readonly controller = new AbortController();
    onmessage?: (event: { data: string }) => void;
    onerror?: (error: unknown) => void;
    constructor(url: string) {
      connections(url);
      void this.open(url).catch((error) => {
        if (!this.controller.signal.aborted) {
          this.onerror?.(error);
        }
      });
    }

    addEventListener() {}

    close() {
      this.controller.abort();
    }

    private deliver(frames: string[]) {
      for (const frame of frames) {
        const data = frame.split('\n').find((line) => line.startsWith('data: '));
        if (data) {
          this.onmessage?.({ data: data.slice(6) });
        }
      }
    }

    private async open(url: string) {
      const response = await fetch(url, {
        headers: { Cookie: cookie },
        signal: this.controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Event stream failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) {
            return;
          }

          const frames = (pending + decoder.decode(chunk.value, { stream: true })).split('\n\n');
          pending = frames.pop() ?? '';
          this.deliver(frames);
        }
      } finally {
        reader.releaseLock();
      }
    }
  }

  vi.stubGlobal('EventSource', HttpEventSource);

  return connections;
}

it('reauthorizes a real workbench reopen and reuses the saved head without reading the full board', async () => {
  const title = '热开板缓存验证';
  const created = await host.service.execute('artifact_manage', {
    action: 'create',
    title,
    elements: [{ id: 'note', type: 'note', text: '当前' }],
  });
  const artifactId = created.artifact.id;
  const connection = client(host.token);
  const request = connection.request!;
  const openings: { url: URL; data: BoardOpenResponse }[] = [];
  const observed: URL[] = [];
  const appClient: StudioClient = {
    ...connection,
    boardOpen: true,
    async request(input, init) {
      const url = new URL(input);
      observed.push(url);
      const response = await request(input, init);
      if (url.searchParams.get('check') === 'board' && response.ok) {
        openings.push({ url, data: (await response.clone().json()) as BoardOpenResponse });
      }
      return response;
    },
  };

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <StudioApp client={appClient} actor={LOCAL_ACTOR} requestStudio={studioRequest} />,
    ),
  );
  const card = () =>
    container!.querySelector<HTMLButtonElement>(`[aria-label="打开白板：${title}"]`);
  await until(() => Boolean(card()));
  await act(async () => card()!.click());
  const canvas = () => container!.querySelector('[aria-label="协作白板"]');
  await until(() => canvas()?.getAttribute('data-revision') === '0');
  expect(openings).toHaveLength(1);
  expect(openings[0]?.data).toMatchObject({ unchanged: false, revision: 0 });

  await act(async () => {
    await appClient.call('artifact_apply', {
      artifactId,
      expectedVersions: { note: 1 },
      operations: [{ op: 'update', id: 'note', changes: { text: '已保存' } }],
    });
  });
  await until(() => canvas()?.getAttribute('data-revision') === '1');
  const back = [...container.querySelectorAll('button')].find((button) =>
    /^返回 .+Studio/.test(button.getAttribute('aria-label') || button.textContent || ''),
  );
  expect(back).toBeDefined();
  await act(async () => back!.click());

  await until(() => Boolean(card()));
  const before = observed.length;
  await act(async () => card()!.click());
  await until(() => canvas()?.getAttribute('data-revision') === '1');

  expect(openings).toHaveLength(2);
  const warm = openings[1]!;
  expect(warm.url.searchParams.get('knownRevision')).toBe('1');
  expect(warm.url.searchParams.get('knownEpoch')).toBe(openings[0]?.data.epoch);
  expect(warm.data).toMatchObject({ unchanged: true, artifactId, revision: 1 });
  expect(warm.data).not.toHaveProperty('board');
  const warmRequests = observed.slice(before);
  expect(warmRequests.some((url) => url.pathname === '/api/session')).toBe(true);
  expect(warmRequests.some((url) => url.searchParams.get('check') === 'scene')).toBe(false);
  expect(warmRequests.some((url) => url.pathname === '/api/tools/artifact_read')).toBe(false);
});

it.each(['sse', 'poll'] as const)(
  'catches up an authorized viewer after the final %s commit notification is lost',
  async (mode) => {
    const created = await host.service.execute('artifact_manage', { action: 'create' });
    const id = created.artifact.id;
    const element =
      mode === 'sse'
        ? { id: 'tail', type: 'html', html: '<p>当前</p>' }
        : {
            id: 'tail',
            type: 'todo',
            data: { items: [{ id: 'row', text: '当前', checked: false }] },
          };
    const added = await host.service.execute('artifact_apply', {
      artifactId: id,
      operationId: randomUUID(),
      operations: [{ op: 'add', element }],
    });
    const guest = await joinViewer(id);
    const viewer = client('', guest.cookie);
    const reads: { mode: string; atRevision?: number }[] = [];
    const onError = vi.fn();
    const dropped = vi.fn();
    const resume = mode === 'sse' ? installHttpEventSource(guest.cookie) : undefined;
    const fault: { revision?: number } = {};
    let current: Board | null = null;
    let present = false;
    const peerId = `tail-${mode}`;
    const revision = () => current?.artifact.revision;
    if (mode === 'sse') {
      const write = ServerResponse.prototype.write;
      vi.spyOn(ServerResponse.prototype, 'write').mockImplementation(function (
        this: ServerResponse,
        ...args
      ) {
        const text = String(args[0]);
        const stream = this.getHeader('Content-Type') === 'text/event-stream';
        if (stream && fault.revision !== undefined) {
          if (text.includes('"type":"board"') && text.includes(`"revision":${fault.revision},`)) {
            dropped();
          }

          return true;
        }

        return write.apply(this, args);
      });
    }

    const controller = createCollaboration({
      client: {
        ...viewer,
        async request(input, init) {
          const url = new URL(String(input));
          if (url.pathname === '/api/tools/artifact_read' && typeof init?.body === 'string') {
            reads.push(JSON.parse(init.body));
          }

          const response = await viewer.request!(input, init);
          const readsEvents = url.pathname === '/api/sync' && !url.searchParams.has('check');
          if (mode !== 'poll' || !readsEvents || !response.ok) {
            return response;
          }

          const batch: SyncBatch = await response.json();
          const events = batch.events.filter((event) => {
            if (event.type === 'board' && event.revision === fault.revision) {
              if (url.searchParams.get('wait') === '20000') {
                dropped(event.changedIds);
              }
              return false;
            }

            return true;
          });

          return Response.json({ ...batch, events });
        },
      },
      polling: mode === 'poll',
      artifactId: id,
      peerId,
      getDocument: () => current,
      applyRemoteEvent: whiteboardProduct.applyRemoteEvent!,
      onDocument: (board) => {
        current = board as Board;
      },
      onFeedback: vi.fn(),
      onPresence: (peers) => {
        present ||= peers.some((peer) => peer.peerId === peerId);
      },
      onEvent: vi.fn(),
      onStatus: vi.fn(),
      onError,
    });
    closes.push(controller.close);
    await until(() => revision() !== undefined && present);

    fault.revision = revision()! + 1;
    reads.length = 0;
    const html = `<p>${'x'.repeat(140 * 1024)}</p>`;
    const patch =
      mode === 'sse'
        ? { op: 'update', id: 'tail', changes: { html } }
        : {
            op: 'todo',
            id: 'tail',
            data: { operations: [{ op: 'update', id: 'row', changes: { checked: false } }] },
          };
    const commit = await host.service.execute('artifact_apply', {
      artifactId: id,
      operationId: randomUUID(),
      expectedVersions: { tail: added.board.elements[0].version },
      operations: [patch],
    });

    expect(commit.board.artifact.revision).toBe(fault.revision);
    await until(() => revision() === fault.revision, 5000);

    expect(dropped).toHaveBeenCalledTimes(1);
    if (mode === 'sse') {
      expect((current as Board | null)?.elements[0]?.html).toBe(html);
      expect(resume).toHaveBeenCalledTimes(1);
      expect(reads).toContainEqual(
        expect.objectContaining({ mode: 'units', atRevision: fault.revision }),
      );
      expect(reads.some((read) => read.mode === 'board')).toBe(false);
    } else {
      expect(dropped).toHaveBeenCalledExactlyOnceWith([]);
      expect((current as Board | null)?.elements[0]?.version).toBe(added.board.elements[0].version);
      expect(reads.some((read) => read.mode === 'board')).toBe(true);
    }

    const head = () => viewer.request!(`${host.origin}/api/sync?artifactId=${id}&check=revision`);
    expect(await (await head()).json()).toEqual({ artifactId: id, revision: fault.revision });
    expect(onError).not.toHaveBeenCalled();
    await host.service.execute('artifact_share', {
      artifactId: id,
      action: 'remove',
      memberId: guest.actor.id,
    });
    expect((await head()).status).toBe(401);
  },
  8000,
);

it('shows loading while the saved board resynchronizes after returning to the Studio tab', async () => {
  const created = await host.service.execute('artifact_manage', {
    action: 'create',
    title: '切回同一白板',
  });
  const id = created.artifact.id;
  const transport = client(host.token);
  const request = transport.request!;
  let holdSnapshot = false;
  let waiting = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  transport.request = async (input, init) => {
    if (holdSnapshot && new URL(String(input)).pathname === '/api/tools/artifact_read') {
      waiting = true;
      await gate;
    }

    return request(input, init);
  };

  const setVisibility = (next: DocumentVisibilityState) => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(next);
    document.dispatchEvent(new Event('visibilitychange'));
  };

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const badge = () => container!.querySelector('[data-save-status]');
  const revision = () =>
    container!.querySelector('[aria-label="协作白板"]')?.getAttribute('data-revision');

  try {
    await act(async () =>
      root!.render(
        <StudioApp
          requestStudio={studioRequest}
          client={transport}
          actor={LOCAL_ACTOR}
          initialArtifactId={id}
        />,
      ),
    );
    await until(() => badge()?.getAttribute('data-save-status') === 'saved' && revision() === '0');
    await act(async () => setVisibility('hidden'));
    holdSnapshot = true;
    await act(async () => setVisibility('visible'));
    await until(() => waiting);
    expect(badge()?.getAttribute('aria-label')).toBe('加载中');
    expect(revision()).toBe('0');
    release();
    await until(() => badge()?.getAttribute('data-save-status') === 'saved');
    expect(revision()).toBe('0');
  } finally {
    release();
  }
});

it('consumes concurrent committed unit changes through real long polling and coalesces cursor writes', async () => {
  const created = await host.service.execute('artifact_manage', {
    action: 'create',
    title: '并发白板',
  });
  const id = created.artifact.id;
  let current: Board | null = null;
  const transport = client(host.token);
  const request = vi.spyOn(transport, 'request');
  const controller = createCollaboration({
    client: transport,
    polling: true,
    artifactId: id,
    peerId: 'front-page',
    getDocument: () => current,
    applyRemoteEvent: whiteboardProduct.applyRemoteEvent!,
    onDocument: (value) => {
      current = value as Board;
    },
    onFeedback: () => {},
    onPresence: () => {},
    onStatus: () => {},
    onEvent: () => {},
    onError: (error) => {
      throw error;
    },
  });
  closes.push(controller.close);
  await until(() => current !== null);
  await Promise.all(
    ['a', 'b'].map((elementId) =>
      host.service.execute('artifact_apply', {
        artifactId: id,
        operationId: randomUUID(),
        merge: 'safe',
        expectedVersions: { [elementId]: 0 },
        operations: [
          { op: 'add', element: { id: elementId, type: 'shape', x: 10, y: 20, w: 40, h: 50 } },
        ],
      }),
    ),
  );
  await until(() => current?.artifact.revision === 2);
  expect(current!.elements.map((element) => element.id).sort()).toEqual(['a', 'b']);
  expect(
    request.mock.calls.filter(
      ([input]) => new URL(String(input)).pathname === '/api/tools/artifact_read',
    ),
  ).toHaveLength(1);

  for (let x = 0; x < 100; x++) {
    controller.presence({ cursor: { x, y: 10, surface: 'board' } });
  }

  await until(
    () =>
      host.service.getPresence(id).find((peer) => peer.peerId === 'front-page')?.cursor?.x === 99,
  );
  const cursorRequests = request.mock.calls.filter(
    ([input, init]) =>
      new URL(String(input)).pathname === '/api/presence' &&
      init?.method === 'POST' &&
      JSON.parse(String(init.body)).cursor,
  );
  expect(cursorRequests.length).toBeGreaterThan(0);
  expect(cursorRequests.length).toBeLessThanOrEqual(2);
});

it('delivers committed canvas changes while an unrelated feedback read is still waiting', async () => {
  const created = await host.service.execute('artifact_manage', {
    action: 'create',
    title: '评论慢读',
  });
  const id = created.artifact.id;
  let current: Board | null = null;
  let releaseFeedback!: () => void;
  let waiting = false;
  const delayed = new Promise<void>((resolve) => {
    releaseFeedback = resolve;
  });
  const transport = client(host.token);
  const request = transport.request!;
  transport.request = async (input, init) => {
    const response = await request(input, init);
    if (new URL(String(input)).pathname.endsWith('/artifact_feedback')) {
      waiting = true;
      await delayed;
    }

    return response;
  };

  const errors: unknown[] = [];
  const controller = createCollaboration({
    client: transport,
    polling: true,
    artifactId: id,
    peerId: 'slow-feedback-page',
    getDocument: () => current,
    applyRemoteEvent: whiteboardProduct.applyRemoteEvent!,
    onDocument: (value) => {
      current = value as Board;
    },
    onFeedback: () => {},
    onPresence: () => {},
    onStatus: () => {},
    onEvent: () => {},
    onError: (error) => errors.push(error),
  });
  closes.push(controller.close);
  try {
    await until(() => current !== null && waiting);
    await host.service.execute('artifact_apply', {
      artifactId: id,
      operationId: randomUUID(),
      operations: [{ op: 'add', element: { id: 'arrived', type: 'text', text: '先看到内容' } }],
    });
    await until(() => current?.elements.some((element) => element.id === 'arrived') === true);
    expect(errors).toEqual([]);
  } finally {
    releaseFeedback();
  }
});

it('applies a real guest geometry patch without pulling unchanged large HTML or embedded state', async () => {
  const created = await host.service.execute('artifact_manage', {
    action: 'create',
    title: 'HTML 轻量反向同步',
  });
  const id = created.artifact.id;
  const html = `<html><body>${'unchanged HTML '.repeat(40000)}</body></html>`;
  const state = { selected: 'preserved' };
  await host.service.execute('artifact_apply', {
    artifactId: id,
    operationId: randomUUID(),
    operations: [
      {
        op: 'add',
        element: { id: 'region', type: 'html', html, state, x: 10, y: 20, w: 800, h: 600 },
      },
    ],
  });
  const shared = await host.service.execute('artifact_share', {
    artifactId: id,
    action: 'start',
    access: 'local',
  });
  const invite = new URL(shared.links.editor, host.origin);
  const joined = await fetch(`${host.origin}/api/session${invite.search}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Geometry visitor' }),
  });
  expect(joined.status).toBe(200);
  const cookie = joined.headers.get('set-cookie')!.split(';')[0]!;
  await joined.json();
  let current: Board | null = null;
  const batches: any[] = [];
  const errors: unknown[] = [];
  const owner = client(host.token);
  const original = owner.request!;
  owner.request = vi.fn(async (input, init) => {
    const response = await original(input, init);
    if (new URL(String(input)).pathname === '/api/sync') {
      batches.push(await response.clone().json());
    }

    return response;
  });
  const controller = createCollaboration({
    client: owner,
    polling: true,
    artifactId: id,
    peerId: 'html-patch-page',
    getDocument: () => current,
    applyRemoteEvent: whiteboardProduct.applyRemoteEvent!,
    onDocument: (value) => {
      current = value as Board;
    },
    onFeedback: () => {},
    onPresence: () => {},
    onStatus: () => {},
    onEvent: () => {},
    onError: (error) => errors.push(error),
  });
  closes.push(controller.close);
  await until(() => current?.artifact.revision === 1);
  await client('', cookie).call('artifact_apply', {
    artifactId: id,
    operationId: randomUUID(),
    expectedVersions: { region: 1 },
    operations: [{ op: 'update', id: 'region', changes: { x: 420 } }],
  });
  await until(() => current?.artifact.revision === 2);
  expect(current!.elements[0]).toMatchObject({
    x: 420,
    version: 2,
    html,
    state,
    sourceRevision: 1,
  });
  const event = batches
    .flatMap((batch) => batch.events)
    .find((value) => value.type === 'board' && value.revision === 2);
  expect(event.units).toEqual([
    { id: 'region', patch: { baseVersion: 1, version: 2, changes: { x: 420 }, removedKeys: [] } },
  ]);
  expect(Buffer.byteLength(JSON.stringify(event))).toBeLessThan(2048);
  const reads = vi
    .mocked(owner.request!)
    .mock.calls.filter(([input]) => new URL(String(input)).pathname.endsWith('/artifact_read'));
  expect(reads.map(([, init]) => JSON.parse(String(init?.body)).mode)).toEqual(['board']);
  expect(errors).toEqual([]);
});

it('repairs an exact historical unit while a later concurrent commit continues arriving', async () => {
  const created = await host.service.execute('artifact_manage', {
    action: 'create',
    title: '精确单元历史补读',
  });
  const id = created.artifact.id;
  const html = '<p>keep source</p>'.repeat(20000);
  await host.service.execute('artifact_apply', {
    artifactId: id,
    operationId: randomUUID(),
    operations: [
      { op: 'add', element: { id: 'region', type: 'html', html, state: { kept: true } } },
      { op: 'add', element: { id: 'other', type: 'note', text: 'another object' } },
    ],
  });
  let current: Board | null = null;
  let repairing = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const owner = client(host.token);
  const original = owner.request!;
  const errors: unknown[] = [];
  owner.request = vi.fn(async (input, init) => {
    const args = init?.body ? JSON.parse(String(init.body)) : {};
    if (args.mode === 'units') {
      repairing = true;
      await gate;
    }

    return original(input, init);
  });
  const controller = createCollaboration({
    client: owner,
    polling: true,
    artifactId: id,
    peerId: 'unit-repair-page',
    getDocument: () => current,
    applyRemoteEvent: whiteboardProduct.applyRemoteEvent!,
    onDocument: (value) => {
      current = value as Board;
    },
    onFeedback: () => {},
    onPresence: () => {},
    onStatus: () => {},
    onEvent: () => {},
    onError: (error) => errors.push(error),
  });
  closes.push(controller.close);
  try {
    await until(() => current?.artifact.revision === 1);
    current = {
      ...current!,
      elements: current!.elements.map((element) =>
        element.id === 'region' ? { ...element, version: 0 } : element,
      ),
    };
    await host.service.execute('artifact_apply', {
      artifactId: id,
      operationId: randomUUID(),
      expectedVersions: { region: 1 },
      operations: [{ op: 'update', id: 'region', changes: { x: 300 } }],
    });
    await until(() => repairing);
    await host.service.execute('artifact_apply', {
      artifactId: id,
      operationId: randomUUID(),
      expectedVersions: { other: 1 },
      operations: [{ op: 'update', id: 'other', changes: { y: 700 } }],
    });
    release();
    await until(() => current?.artifact.revision === 3);
    expect(current!.elements.find((element) => element.id === 'region')).toMatchObject({
      x: 300,
      version: 2,
      html,
      state: { kept: true },
    });
    expect(current!.elements.find((element) => element.id === 'other')).toMatchObject({
      y: 700,
      version: 2,
    });
    const reads = vi
      .mocked(owner.request!)
      .mock.calls.filter(([input]) => new URL(String(input)).pathname.endsWith('/artifact_read'))
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(reads).toEqual([
      { artifactId: id, mode: 'board' },
      { artifactId: id, mode: 'units', ids: ['region'], atRevision: 2 },
    ]);
    expect(errors).toEqual([]);
  } finally {
    release();
  }
});

it('recovers an asynchronously failed feedback read without requiring another edit', async () => {
  const created = await host.service.execute('artifact_manage', {
    action: 'create',
    title: '评论读取恢复',
  });
  const id = created.artifact.id;
  let current: Board | null = null;
  let attempts = 0;
  let recovered = false;
  const transport = client(host.token);
  const request = transport.request!;
  transport.request = async (input, init) => {
    if (new URL(String(input)).pathname.endsWith('/artifact_feedback') && ++attempts === 1) {
      return Response.json(
        { error: { code: 'UNAVAILABLE', message: '评论暂时不可读' } },
        { status: 503 },
      );
    }

    return request(input, init);
  };

  const errors: unknown[] = [];
  const controller = createCollaboration({
    client: transport,
    polling: true,
    artifactId: id,
    peerId: 'feedback-retry-page',
    getDocument: () => current,
    applyRemoteEvent: whiteboardProduct.applyRemoteEvent!,
    onDocument: (value) => {
      current = value as Board;
    },
    onFeedback: () => {
      recovered = true;
    },
    onPresence: () => {},
    onStatus: () => {},
    onEvent: () => {},
    onError: (error) => errors.push(error),
  });
  closes.push(controller.close);
  await until(() => recovered);
  expect(attempts).toBe(2);
  expect(errors).toHaveLength(1);
  expect(current).not.toBeNull();
});

it('uses a real cookie-only guest projection and applies an owner role change without losing the page', async () => {
  const created = await host.service.execute('artifact_manage', {
    action: 'create',
    title: '访客白板',
  });
  const id = created.artifact.id;
  const shared = await host.service.execute('artifact_share', {
    artifactId: id,
    action: 'start',
    access: 'local',
  });
  const invitation = new URL(shared.links.editor, host.origin).searchParams.get('share')!;
  const joined = await fetch(`${host.origin}/api/session?artifactId=${id}&share=${invitation}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '前端协作访客' }),
  });
  expect(joined.status).toBe(200);
  const cookie = joined.headers.get('set-cookie')!.split(';')[0]!;
  const session = (await joined.json()) as { actor: Actor };
  const guest = client('', cookie);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <StudioApp
        requestStudio={studioRequest}
        client={guest}
        actor={session.actor}
        initialArtifactId={id}
      />,
    ),
  );
  await until(
    () =>
      container!.querySelector('[aria-label="协作白板"]')?.getAttribute('data-read-only') ===
      'false',
  );
  await act(async () =>
    [...container!.querySelectorAll('button')]
      .find((button) => button.getAttribute('aria-label') === '分享')!
      .click(),
  );
  await until(() => !!container!.querySelector('[aria-label="复制可编辑链接"]'));
  expect(container.querySelector('[aria-label="一般访问权限"]')).toBeNull();
  expect(container.textContent).not.toContain('作品所有者');
  await host.service.execute('artifact_share', {
    artifactId: id,
    action: 'role',
    memberId: session.actor.id,
    role: 'viewer',
  });
  await until(
    () =>
      container!.querySelector('[aria-label="协作白板"]')?.getAttribute('data-read-only') ===
      'true',
  );
  expect(container.querySelector('.studio-session-message')).toBeNull();
  await host.service.execute('artifact_share', {
    artifactId: id,
    action: 'remove',
    memberId: session.actor.id,
  });
  await until(
    () => container!.querySelector('.studio')?.getAttribute('data-session-status') === 'denied',
  );
  expect(container.textContent).toContain('房主已移除你的访问权限，请联系房主');
});
