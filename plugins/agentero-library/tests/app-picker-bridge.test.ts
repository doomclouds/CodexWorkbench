import { afterEach, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ apps: [] as any[] }));
vi.mock('@modelcontextprotocol/ext-apps', () => ({
  App: class {
    constructor() { harness.apps.push(this); }
    connect = vi.fn(async () => {});
    getHostContext = () => ({ theme: 'dark' });
    getHostCapabilities = () => ({});
    callServerTool = vi.fn();
  },
  PostMessageTransport: class {},
  applyDocumentTheme: vi.fn(), applyHostStyleVariables: vi.fn(),
}));
vi.mock('@openai/mcp-extensions/app', () => ({ OpenAIExtensions: class {} }));

afterEach(() => { vi.unstubAllGlobals(); harness.apps.length = 0; });
async function bridge() {
  vi.resetModules();
  vi.stubGlobal('window', { parent: {} });
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  return import('../src/app/bridge');
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

it('central bridge IDs and explicit cancellation cover an unchanged file_picker caller', async () => {
  const api = await bridge(); const app = harness.apps[0];
  const selection = deferred<unknown>(); const ack = deferred<unknown>();
  let requestId = '';
  app.callServerTool.mockImplementation((params: any) => {
    if (params.name === 'file_picker') { requestId = params.arguments.requestId; return selection.promise; }
    return ack.promise;
  });
  const controller = new AbortController();
  const original = api.callTool('file_picker', { mode: 'open-file' }, { signal: controller.signal });
  await vi.waitFor(() => expect(requestId).toMatch(/^[0-9a-f-]{36}$/));
  controller.abort();
  await vi.waitFor(() => expect(app.callServerTool).toHaveBeenCalledTimes(2));
  expect(app.callServerTool.mock.calls[1]).toEqual([{ name: 'file_picker_cancel', arguments: { requestId } }, { timeout: 15_000, signal: undefined }]);
  let closed = false;
  const teardown = app.onteardown().then(() => { closed = true; });
  await Promise.resolve(); expect(closed).toBe(false);
  ack.resolve({ structuredContent: { ok: true, data: { requestId, closed: true } } });
  await teardown; expect(api.getHostState().connected).toBe(false);
  selection.resolve({ _meta: { picker: { cancelled: true, paths: [] } }, structuredContent: { ok: true, data: { count: 0, cancelled: true } } });
  await expect(original).resolves.toEqual({ cancelled: true, paths: [] });
});

it('teardown fails visibly and can retry when cancellation is not acknowledged', async () => {
  const api = await bridge(); const app = harness.apps[0];
  const selection = deferred<unknown>(); let attempts = 0;
  app.callServerTool.mockImplementation(async (params: any) => {
    if (params.name === 'file_picker') return selection.promise;
    if (++attempts === 1) throw new Error('host unavailable');
    return { structuredContent: { ok: true, data: { requestId: params.arguments.requestId, closed: true } } };
  });
  const original = api.callTool('file_picker', { mode: 'save-file', defaultPath: '论文.pdf' });
  await vi.waitFor(() => expect(app.callServerTool).toHaveBeenCalledTimes(1));
  await expect(app.onteardown()).rejects.toThrow('host unavailable');
  expect(api.getHostState().connected).toBe(true);
  await app.onteardown(); expect(attempts).toBe(2);
  selection.resolve({ _meta: { picker: { cancelled: true, paths: [] } } });
  await original;
});

it('failed picker cancellation still waits for note cleanup before rejecting teardown', async () => {
  const api = await bridge(); const app = harness.apps[0];
  const selection = deferred<unknown>(); const saved = deferred<void>();
  let attempts = 0;
  app.callServerTool.mockImplementation(async (params: any) => {
    if (params.name === 'file_picker') return selection.promise;
    if (++attempts === 1) throw new Error('chooser cancellation failed');
    return { structuredContent: { ok: true, data: { requestId: params.arguments.requestId, closed: true } } };
  });
  const flushNotes = vi.fn(() => saved.promise);
  const unregister = api.registerBeforeTeardown(flushNotes);
  const original = api.callTool('file_picker', { mode: 'open-directory' });
  await vi.waitFor(() => expect(app.callServerTool).toHaveBeenCalledTimes(1));
  let finished = false;
  const teardown = app.onteardown().catch((error: Error) => error).finally(() => { finished = true; });
  await vi.waitFor(() => expect(flushNotes).toHaveBeenCalledTimes(1));
  expect(finished).toBe(false);
  saved.resolve();
  expect((await teardown).message).toBe('chooser cancellation failed');
  expect(api.getHostState().connected).toBe(true);
  await app.onteardown();
  expect(flushNotes).toHaveBeenCalledTimes(2);
  unregister();
  selection.resolve({ _meta: { picker: { cancelled: true, paths: [] } } });
  await original;
});
