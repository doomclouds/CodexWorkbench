import { afterEach, expect, test, vi } from 'vitest';

const harness = vi.hoisted(() => ({ refs: [] as { current: any }[], nodes: [] as unknown[], states: [] as unknown[], stateIndex: 0, effects: [] as (() => (() => void) | void)[], setters: [] as ReturnType<typeof vi.fn>[], layers: vi.fn() }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  memo: (component: unknown) => component,
  useRef: (value: unknown) => { const ref = { current: harness.refs.length < 4 ? harness.nodes[harness.refs.length] : value }; harness.refs.push(ref); return ref; },
  useState: (value: unknown) => { const i = harness.stateIndex++; const setter = vi.fn(); harness.setters.push(setter); return [i in harness.states ? harness.states[i] : value, setter]; },
  useMemo: (compute: () => unknown) => compute(),
  useEffect: (effect: () => (() => void) | void) => { harness.effects.push(effect); },
}));
vi.mock('../src/app/pdf-runtime', () => ({ pdfjs: { TextLayer: class { constructor(input: unknown) { harness.layers(input); } render() { return Promise.resolve(); } cancel() {} } } }));
import { PageView } from '../src/app/pdf/PageView';

afterEach(() => { harness.refs = []; harness.nodes = []; harness.states = []; harness.stateIndex = 0; harness.effects = []; harness.setters = []; harness.layers.mockClear(); vi.unstubAllGlobals(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
function setup(options: { text?: Promise<unknown>; renderError?: Error } = {}) {
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  const canvas = { width: 0, height: 0, style: {}, isConnected: true, getBoundingClientRect: () => ({ left: 0, top: 0, width: 612, height: 792 }) }, content = { replaceChildren: vi.fn(), querySelectorAll: () => [], isConnected: true };
  const sheet = { isConnected: true }, element = { isConnected: true };
  harness.nodes = [sheet, element, canvas, content];
  const cancel = vi.fn();
  const page = { rotate: 0, view: [0, 0, 612, 792], getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }), render: vi.fn(() => { if (options.renderError) throw options.renderError; return { promise: Promise.resolve(), cancel }; }), getTextContent: vi.fn(() => options.text ?? Promise.resolve({ items: [], styles: {} })) };
  harness.states = [true, page, [], false, '', null];
  const onFailure = vi.fn(), onRendered = vi.fn();
  // Exercise the real component's render effect with DOM detachment before passive cleanup.
  PageView({ document: {} as any, number: 141, active: true, scale: 1, rotation: 0, tone: 'white', estimate: { width: 612, height: 792 }, viewportRef: { current: null }, marks: [], selectedMark: null, cards: false, crop: false, onReady: vi.fn(), onMark: vi.fn(), onDestination: vi.fn(), onExternal: vi.fn(), onVisual: vi.fn(), onRendered, onFailure });
  const cleanup = harness.effects[4]() as () => void;
  const detach = () => { canvas.isConnected = false; content.isConnected = false; harness.refs[2].current = null; harness.refs[3].current = null; };
  return { canvas, content, page, cancel, onFailure, onRendered, cleanup, detach, done: () => harness.refs[5].current as Promise<void> };
}

test('queued page work skips refs detached before the effect cleanup can run', async () => {
  const ctx = setup(); ctx.detach(); await ctx.done();
  expect(ctx.onFailure).not.toHaveBeenCalled(); expect(ctx.page.render).not.toHaveBeenCalled(); expect(ctx.canvas.width).toBe(0); ctx.cleanup();
});
test('a queued old render cannot paint a replacement surface', async () => {
  const ctx = setup(); const replacement = { ...ctx.canvas };
  harness.refs[2].current = replacement; harness.refs[3].current = { ...ctx.content };
  await ctx.done(); expect(ctx.page.render).not.toHaveBeenCalled(); expect(replacement.width).toBe(0); expect(ctx.onFailure).not.toHaveBeenCalled(); ctx.cleanup();
});
test('detachment during text RPC cancels the old render without mounting a text layer or reporting a PDF failure', async () => {
  const text = deferred<unknown>(), ctx = setup({ text: text.promise }); await settle(); expect(ctx.page.render).toHaveBeenCalledOnce();
  ctx.detach(); text.resolve({ items: [], styles: {} }); await ctx.done();
  expect(harness.layers).not.toHaveBeenCalled(); expect(ctx.cancel).toHaveBeenCalled(); expect(ctx.onRendered).not.toHaveBeenCalled(); expect(ctx.onFailure).not.toHaveBeenCalled(); ctx.cleanup();
});
test('passive cleanup cancels queued work and releases the scheduling slot', async () => {
  const ctx = setup(); ctx.cleanup(); await ctx.done(); expect(ctx.page.render).not.toHaveBeenCalled(); expect(ctx.onFailure).not.toHaveBeenCalled();
});
test('a connected page still renders its bounded canvas and text layer', async () => {
  const ctx = setup(); await ctx.done(); expect(ctx.canvas).toMatchObject({ width: 612, height: 792 }); expect(harness.layers).toHaveBeenCalledOnce(); expect(ctx.onRendered).toHaveBeenCalledWith(141); expect(ctx.onFailure).not.toHaveBeenCalled(); ctx.cleanup();
});
test('a real connected-page error stays visible without falsely claiming a resource budget violation', async () => {
  const ctx = setup({ renderError: new Error('Owned malformed page') }); await ctx.done();
  expect(ctx.onFailure).toHaveBeenCalledWith(141, expect.stringContaining('Owned malformed page')); expect(ctx.onFailure.mock.calls[0][1]).not.toContain('安全预算'); ctx.cleanup();
});
