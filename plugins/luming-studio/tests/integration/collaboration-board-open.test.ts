import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOARD_OPEN_FORMAT,
  BOARD_SCENE_FORMAT,
  type BoardOpenResponse,
  type BoardSceneResponse,
} from '../../src/contracts/board-open.js';
import { DEFAULT_STYLE, type Board, type StudioClient } from '../../src/contracts/studio.js';
import { BoardOpenCache } from '../../src/app/features/collaboration/board-open-cache.js';
import { createCollaboration } from '../../src/app/features/collaboration/useCollaboration.js';

const artifact = {
  id: 'drawing',
  type: 'whiteboard',
  title: '原白板',
  revision: 7,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  pinned: false,
};
const geometry = { id: 'region', type: 'html' as const, x: 1, y: 2, w: 200, h: 100, version: 4 };
const board: Board = {
  artifact,
  style: DEFAULT_STYLE,
  elements: [{ ...geometry, html: '<p>完整正文</p>' }],
};
const opened: BoardOpenResponse = {
  format: BOARD_OPEN_FORMAT,
  artifactId: artifact.id,
  revision: artifact.revision,
  epoch: 'server-1',
  unchanged: false,
  board,
};
const scene: BoardSceneResponse = {
  format: BOARD_SCENE_FORMAT,
  artifactId: artifact.id,
  revision: artifact.revision,
  epoch: 'server-1',
  scene: { artifact, style: DEFAULT_STYLE, units: [{ state: 'unloaded', geometry }] },
};

type RequestHandler = (url: URL) => Promise<Response> | Response | undefined;

function host(handler: RequestHandler) {
  const checked: URL[] = [];
  const call = vi.fn();
  const client: StudioClient = {
    baseUrl: 'http://localhost',
    boardOpen: true,
    embedded: false,
    call: call as StudioClient['call'],
    request: async (input, init) => {
      const url = new URL(input);
      checked.push(url);
      const reply = handler(url);
      if (reply) {
        return reply;
      }

      if (url.pathname === '/api/sync') {
        if (
          checked.filter((item) => item.pathname === '/api/sync' && !item.searchParams.has('check'))
            .length === 1
        ) {
          return Response.json({
            type: 'ready',
            reset: true,
            cursor: 'room-1:1',
            peers: [],
            events: [],
          });
        }

        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          });
        });
      }
      if (url.pathname === '/api/tools/artifact_feedback') {
        return Response.json({ ok: true, data: { feedback: [] } });
      }

      return Response.json({ cursor: 'room-1:1', peers: [], events: [] });
    },
  };

  return { client, checked };
}

let dom: JSDOM;
let sessions: ReturnType<typeof createCollaboration>[];
beforeEach(() => {
  dom = new JSDOM('', { pretendToBeVisual: true });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  sessions = [];
});
afterEach(() => {
  sessions.forEach((session) => session.close());
  vi.unstubAllGlobals();
  dom.window.close();
});

function open(client: StudioClient, cache: BoardOpenCache, authorityKey = 'owner') {
  let current: Board | null = null;
  const seen = vi.fn();
  const events = vi.fn();
  const errors = vi.fn();
  const connection = createCollaboration({
    client,
    authorityKey,
    boardOpenCache: cache,
    artifactId: artifact.id,
    peerId: 'peer',
    polling: true,
    getDocument: () => current,
    applyRemoteEvent: () => undefined,
    onDocument(document) {
      current = document as Board;
    },
    onScene: seen,
    onFeedback() {},
    onPresence() {},
    onEvent: events,
    onStatus() {},
    onError: errors,
  });
  sessions.push(connection);

  return { connection, board: () => current, seen, events, errors };
}

function boardRequests(checked: URL[]) {
  return checked.filter((url) => url.searchParams.get('check') === 'board');
}

describe('authorized progressive whiteboard opening', () => {
  it('publishes a separate geometry scene ahead of the complete authoritative board', async () => {
    let respond!: (reply: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      respond = resolve;
    });
    const remote = host((url) => {
      if (url.searchParams.get('check') === 'scene') {
        return Response.json(scene);
      }
      if (url.searchParams.get('check') === 'board') {
        return pending;
      }
    });
    const view = open(remote.client, new BoardOpenCache());
    await vi.waitFor(() => expect(view.seen).toHaveBeenCalledWith(scene));
    expect(view.board()).toBeNull();

    respond(Response.json(opened));
    await vi.waitFor(() => expect(view.board()).toEqual(board));
    expect(view.seen).toHaveBeenLastCalledWith(undefined);
  });

  it('never accepts an empty body presented as unloaded geometry', async () => {
    const remote = host((url) => {
      if (url.searchParams.get('check') === 'scene') {
        return Response.json({
          ...scene,
          scene: {
            ...scene.scene,
            units: [{ state: 'unloaded', geometry: { ...geometry, html: '' } }],
          },
        });
      }
      if (url.searchParams.get('check') === 'board') {
        return Response.json(opened);
      }
    });
    const view = open(remote.client, new BoardOpenCache());
    await vi.waitFor(() => expect(view.board()).toEqual(board));
    expect(view.seen.mock.calls.every(([value]) => value === undefined)).toBe(true);
  });

  it('ignores a scene delivered after its controller is closed', async () => {
    let respond!: (reply: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      respond = resolve;
    });
    const remote = host((url) => {
      if (url.searchParams.get('check') === 'scene' || url.searchParams.get('check') === 'board') {
        return pending;
      }
    });
    const view = open(remote.client, new BoardOpenCache());
    await vi.waitFor(() =>
      expect(remote.checked.some((url) => url.searchParams.get('check') === 'scene')).toBe(true),
    );
    view.connection.close();
    respond(Response.json(scene));
    await Promise.resolve();
    await Promise.resolve();
    expect(view.seen.mock.calls.every(([value]) => value === undefined)).toBe(true);
    expect(view.board()).toBeNull();
  });

  it('reuses the same authorized edition on reopen and refreshes lightweight artwork metadata', async () => {
    const cache = new BoardOpenCache();
    const renamed = { ...artifact, title: '新白板标题' };
    const remote = host((url) => {
      if (url.searchParams.get('check') === 'scene') {
        return Response.json(scene);
      }

      if (url.searchParams.get('check') === 'board') {
        if (url.searchParams.has('knownRevision')) {
          return Response.json({
            ...opened,
            unchanged: true,
            artifact: renamed,
            board: undefined,
          });
        }

        return Response.json(opened);
      }
    });
    const first = open(remote.client, cache);
    await vi.waitFor(() => expect(first.board()).toEqual(board));
    const elements = first.board()?.elements;
    first.connection.close();
    remote.checked.length = 0;

    const next = open(remote.client, cache);
    await vi.waitFor(() => expect(next.board()?.artifact).toEqual(renamed));
    expect(next.board()?.elements).toBe(elements);
    const [conditional] = boardRequests(remote.checked);
    expect(conditional?.searchParams.get('knownRevision')).toBe('7');
    expect(conditional?.searchParams.get('knownEpoch')).toBe('server-1');
    expect(remote.checked.some((url) => url.searchParams.get('check') === 'scene')).toBe(false);
    expect(remote.checked.some((url) => url.pathname === '/api/tools/artifact_read')).toBe(false);

    await next.connection.refresh();
    const forced = boardRequests(remote.checked).at(-1);
    expect(forced?.searchParams.has('knownRevision')).toBe(false);
  });

  it('does not reuse a board from a different permission scope', async () => {
    const cache = new BoardOpenCache();
    const remote = host((url) =>
      url.searchParams.get('check') === 'board' ? Response.json(opened) : undefined,
    );
    cache.remember(
      { client: remote.client, artifactId: artifact.id, authorityKey: 'owner' },
      'server-1',
      board,
    );
    const view = open(remote.client, cache, 'viewer');
    await vi.waitFor(() => expect(view.board()).toEqual(board));
    expect(boardRequests(remote.checked)[0]?.searchParams.has('knownRevision')).toBe(false);
  });

  it.each([
    { type: 'ready', cursor: 'old-room:1' },
    { ...opened, unchanged: true, artifact, board: undefined, epoch: 'wrong-server' },
  ])(
    'falls back to the authorized full read for an unsupported or inconsistent opening response',
    async (reply) => {
      const cache = new BoardOpenCache();
      const remote = host((url) => {
        if (url.searchParams.get('check') === 'board') {
          return Response.json(reply);
        }
        if (url.pathname === '/api/tools/artifact_read') {
          return Response.json({ ok: true, data: board });
        }
      });
      cache.remember(
        { client: remote.client, artifactId: artifact.id, authorityKey: 'owner' },
        'server-1',
        board,
      );
      const view = open(remote.client, cache);
      await vi.waitFor(() => expect(view.board()).toEqual(board));
      expect(
        remote.checked.filter((url) => url.pathname === '/api/tools/artifact_read'),
      ).toHaveLength(1);
      expect(view.board()).not.toBe(board);
    },
  );

  it('does not publish cached content or fall back when the authorized opening is denied', async () => {
    const cache = new BoardOpenCache();
    const remote = host((url) => {
      if (url.searchParams.get('check') === 'board') {
        return Response.json({ error: { details: { reason: 'removed' } } }, { status: 403 });
      }
    });
    const scope = { client: remote.client, artifactId: artifact.id, authorityKey: 'owner' };
    cache.remember(scope, 'server-1', board);
    const view = open(remote.client, cache);
    await vi.waitFor(() =>
      expect(view.events).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'access-revoked', reason: 'removed' }),
      ),
    );
    expect(view.board()).toBeNull();
    expect(cache.get(scope)).toBeUndefined();
    expect(remote.checked.some((url) => url.pathname === '/api/tools/artifact_read')).toBe(false);
  });
});
