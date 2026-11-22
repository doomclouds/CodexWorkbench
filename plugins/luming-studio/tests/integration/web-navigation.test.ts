import { afterEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createStudioBridge, type StudioBridge } from '../../src/app/transport/bridge';
import { LOCAL_ACTOR, type Connection } from '../../src/contracts/studio';

vi.mock('@modelcontextprotocol/ext-apps', () => ({
  App: class {
    addEventListener = vi.fn();

    async connect() {}
    async close() {}
    async callServerTool() {
      return {
        _meta: {
          connection: {
            baseUrl: 'http://127.0.0.1:5000',
            token: 'owner-secret',
            actor: { id: 'local', name: 'Owner', kind: 'human', role: 'owner' },
          },
        },
      };
    }
    getHostContext() {}
    getHostCapabilities() {
      return {};
    }
  },
  PostMessageTransport: class {},
  applyDocumentTheme() {},
  applyHostStyleVariables() {},
}));
vi.mock('@openai/mcp-extensions/app', () => ({ OpenAIExtensions: class {} }));

type Navigable = StudioBridge & { navigate?: (artifactId?: string, view?: string) => void };

const doms: JSDOM[] = [];
const bridges: StudioBridge[] = [];
afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.close()));
  doms.splice(0).forEach((dom) => dom.window.close());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function page(
  url: string,
  boot: Connection = {
    baseUrl: 'http://127.0.0.1:5000',
    token: 'owner-secret',
    actor: LOCAL_ACTOR,
  },
) {
  const dom = new JSDOM('<div id="root"></div>', { url });
  doms.push(dom);
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('location', dom.window.location);
  dom.window.__STUDIO_BOOT__ = boot;

  return dom;
}

async function connect(onNavigate = vi.fn()) {
  const bridge = (await createStudioBridge(onNavigate)) as Navigable;
  bridges.push(bridge);

  return { bridge, onNavigate };
}

async function traverse(dom: JSDOM, action: 'back' | 'forward') {
  const next = new Promise<void>((resolve) => {
    dom.window.addEventListener('popstate', () => resolve(), { once: true });
  });
  dom.window.history[action]();
  await next;
}

it('initializes the standalone library view from the public URL and reloads the active route', async () => {
  page('http://127.0.0.1:5000/index.html?token=owner-secret&view=trash');
  const { bridge } = await connect();
  expect(bridge.view).toBe('trash');
  expect(bridge.artifactId).toBeUndefined();
  bridge.navigate?.('new-board', 'editor');
  expect(window.location.search).toContain('artifactId=new-board');
  const boot = {
    baseUrl: 'http://127.0.0.1:5000',
    token: 'owner-secret',
    actor: LOCAL_ACTOR,
    artifactId: 'new-board',
  };
  page(window.location.href, boot);
  const reloaded = await connect();
  expect(reloaded.bridge.artifactId).toBe('new-board');
  expect(reloaded.bridge.view).toBe('editor');
});

it('tracks open/new/library/trash routes, preserves valid owner access, and replays history without pushing echoes', async () => {
  const dom = page(
    'http://127.0.0.1:5000/index.html?token=owner-secret&share=other-invite&artifactId=first&view=editor&theme=dark#old',
    {
      baseUrl: 'http://127.0.0.1:5000',
      token: 'owner-secret',
      actor: LOCAL_ACTOR,
      artifactId: 'first',
    },
  );
  const { bridge, onNavigate } = await connect();
  const push = vi.spyOn(dom.window.history, 'pushState');
  bridge.navigate?.('first', 'editor');
  expect(push).not.toHaveBeenCalled();
  bridge.navigate?.(undefined, 'library');
  expect(new URL(dom.window.location.href).searchParams.has('artifactId')).toBe(false);
  bridge.navigate?.('created', 'editor');
  bridge.navigate?.(undefined, 'trash');
  const url = new URL(dom.window.location.href);
  expect(url.origin).toBe('http://127.0.0.1:5000');
  expect(url.pathname).toBe('/index.html');
  expect(url.hash).toBe('');
  expect(url.searchParams.get('token')).toBe('owner-secret');
  expect(url.searchParams.has('share')).toBe(false);
  expect(url.searchParams.get('theme')).toBe('dark');
  expect(push).toHaveBeenCalledTimes(3);
  await traverse(dom, 'back');
  expect(bridge.artifactId).toBe('created');
  expect(bridge.view).toBe('editor');
  bridge.navigate?.('created', 'editor');
  expect(push).toHaveBeenCalledTimes(3);
  await traverse(dom, 'back');
  expect(bridge.artifactId).toBeUndefined();
  expect(bridge.view).toBe('library');
  await traverse(dom, 'forward');
  expect(bridge.artifactId).toBe('created');
  expect(push).toHaveBeenCalledTimes(3);
  expect(onNavigate).toHaveBeenLastCalledWith('created', 'editor');
});

it('does not put the boot owner token into a canonical URL or carry another invitation to a new board', async () => {
  const dom = page('http://127.0.0.1:5000/?artifactId=first&share=unrelated', {
    baseUrl: 'http://127.0.0.1:5000',
    token: 'secret-only-in-boot',
    actor: LOCAL_ACTOR,
    artifactId: 'first',
  });
  const { bridge } = await connect();
  bridge.navigate?.('second', 'editor');
  const url = new URL(dom.window.location.href);
  expect(url.searchParams.get('artifactId')).toBe('second');
  expect(url.searchParams.has('token')).toBe(false);
  expect(url.searchParams.has('share')).toBe(false);
});

it('keeps an already-present accepted owner credential in token rather than share when routing', async () => {
  const dom = page('http://127.0.0.1:5000/?artifactId=first&share=owner-secret', {
    baseUrl: 'http://127.0.0.1:5000',
    token: 'owner-secret',
    actor: LOCAL_ACTOR,
    artifactId: 'first',
  });
  const { bridge } = await connect();
  bridge.navigate?.('second', 'editor');
  const query = new URL(dom.window.location.href).searchParams;
  expect(query.get('token')).toBe('owner-secret');
  expect(query.has('share')).toBe(false);
  expect(query.get('artifactId')).toBe('second');
});

it.each([false, true])(
  'keeps a guest inside the original member scope and credential form (invite=%s)',
  async (invite) => {
    const dom = page(
      `http://127.0.0.1:5000/?artifactId=guest-board${invite ? '&share=original-invite' : ''}`,
      {
        baseUrl: 'http://127.0.0.1:5000',
        token: '',
        artifactId: 'guest-board',
        actor: { id: 'guest', name: 'Guest', kind: 'human', role: 'editor' },
      },
    );
    const { bridge, onNavigate } = await connect();
    bridge.navigate?.('other-board', 'editor');
    bridge.navigate?.(undefined, 'trash');
    expect(new URL(dom.window.location.href).searchParams.get('artifactId')).toBe('guest-board');
    expect(onNavigate).not.toHaveBeenCalled();
    dom.window.history.pushState(
      null,
      '',
      '/?artifactId=other-board&share=foreign-invite&token=foreign-owner',
    );
    dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
    const url = new URL(dom.window.location.href);
    expect(url.searchParams.get('artifactId')).toBe('guest-board');
    expect(url.searchParams.get('share')).toBe(invite ? 'original-invite' : null);
    expect(url.searchParams.has('token')).toBe(false);
  },
);

it('uses the latest pop route when bootstrap completes and removes its listener on close', async () => {
  const dom = page('http://127.0.0.1:5000/?artifactId=first', {
    baseUrl: 'http://127.0.0.1:5000',
    token: 'owner-secret',
    actor: LOCAL_ACTOR,
    artifactId: 'first',
  });
  const onNavigate = vi.fn();
  const pending = createStudioBridge(onNavigate);
  dom.window.history.pushState(null, '', '/?artifactId=latest&view=board');
  dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
  const bridge = await pending;
  bridges.push(bridge);
  expect(bridge.artifactId).toBe('latest');
  expect(['board', 'editor']).toContain(bridge.view);
  await bridge.close();
  onNavigate.mockClear();
  dom.window.history.pushState(null, '', '/?view=library');
  dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
  expect(onNavigate).not.toHaveBeenCalled();
  const url = dom.window.location.href;
  (bridge as Navigable).navigate?.('late-result', 'editor');
  expect(dom.window.location.href).toBe(url);
});

it('never changes browser history for an embedded MCP App', async () => {
  const dom = page('https://codex.test/chat/current');
  Object.defineProperty(dom.window, 'parent', { value: {} });
  const push = vi.spyOn(dom.window.history, 'pushState');
  const replace = vi.spyOn(dom.window.history, 'replaceState');
  const { bridge, onNavigate } = await connect();
  bridge.navigate?.('board-in-panel', 'editor');
  expect(bridge.artifactId).toBe('board-in-panel');
  dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
  expect(push).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
  expect(onNavigate).not.toHaveBeenCalled();
  expect(dom.window.location.href).toBe('https://codex.test/chat/current');
});
