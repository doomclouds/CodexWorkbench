import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { ReaderMark } from '../src/contracts/reader';

const harness = vi.hoisted(() => ({ refs: [] as { current: any }[], states: [] as any[], effects: [] as (() => (() => void) | void)[], setters: [] as ReturnType<typeof vi.fn>[], refIndex: 0, stateIndex: 0, effectIndex: 0 }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useRef: (initial: unknown) => { const index = harness.refIndex++; return harness.refs[index] ??= { current: initial }; },
  useState: (initial: unknown) => {
    const index = harness.stateIndex++; if (!(index in harness.states)) harness.states[index] = initial;
    const setter = harness.setters[index] ??= vi.fn((value: unknown) => { harness.states[index] = value; });
    return [harness.states[index], setter];
  },
  useEffect: (effect: () => (() => void) | void) => { harness.effects[harness.effectIndex++] = effect; },
}));
import { AnnotationManagerFrame, AnnotationSourcePreview, type AnnotationSourcePreviewProps } from '../src/app/pdf/AnnotationManager';

afterEach(() => { harness.refs = []; harness.states = []; harness.effects = []; harness.setters = []; resetHooks(); vi.unstubAllGlobals(); });
function resetHooks() { harness.refIndex = 0; harness.stateIndex = 0; harness.effectIndex = 0; }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (cause: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function settle() { for (let index = 0; index < 30; index++) await Promise.resolve(); }
const mark: ReaderMark = { id: 'synthetic', kind: 'highlight', page: 7, space: 'pt', rects: [{ x: 10, y: 20, w: 100, h: 12 }, { x: 10, y: 45, w: 100, h: 12 }], quote: 'Synthetic quotation', note: '', comment: 'Synthetic comment' };

function makePage(options: { width?: number; height?: number; rotation?: number; rendered?: Promise<void>; renderError?: Error } = {}) {
  const width = options.width ?? 600, height = options.height ?? 800, rotate = options.rotation ?? 0;
  const cancel = vi.fn();
  const page = {
    rotate, view: [20, 30, width + 20, height + 30], cleanup: vi.fn(), getTextContent: vi.fn(),
    getViewport: ({ scale, rotation = rotate }: { scale: number; rotation?: number }) => ({
      width: (rotation % 180 ? height : width) * scale, height: (rotation % 180 ? width : height) * scale,
      convertToViewportPoint: (x: number, y: number) => rotation === 90 ? [(y - 30) * scale, (x - 20) * scale] : [(x - 20) * scale, (height + 30 - y) * scale],
    }),
    render: vi.fn((_input: { canvas: unknown }) => { if (options.renderError) throw options.renderError; return { promise: options.rendered ?? Promise.resolve(), cancel }; }),
  };
  return { page, cancel };
}
function setup(options: { page?: ReturnType<typeof makePage>; loaded?: Promise<unknown>; width?: number } = {}) {
  vi.stubGlobal('window', { devicePixelRatio: 4 });
  const canvas = { width: 0, height: 0, style: {}, isConnected: true };
  const viewport = { getBoundingClientRect: () => ({ width: options.width ?? 420 }) };
  harness.refs = [{ current: viewport }, { current: canvas }]; harness.states = [options.width ?? 420, null];
  const currentPage = options.page ?? makePage();
  const document = { numPages: 400, getPage: vi.fn(() => options.loaded ?? Promise.resolve(currentPage.page)), destroy: vi.fn(), saveDocument: vi.fn() };
  const props: AnnotationSourcePreviewProps = { document: document as any, mark, active: true, onLocate: vi.fn() };
  const render = (next: Partial<AnnotationSourcePreviewProps> = {}) => { resetHooks(); return AnnotationSourcePreview({ ...props, ...next }); };
  const start = (next: Partial<AnnotationSourcePreviewProps> = {}) => { const tree = render(next); const cleanup = harness.effects[1]() as (() => void) | undefined; return { tree, cleanup: cleanup ?? (() => {}) }; };
  const done = () => harness.refs[2].current as Promise<void>;
  const detach = () => { canvas.isConnected = false; harness.refs[1].current = null; };
  return { canvas, viewport, document, ...currentPage, props, render, start, done, detach };
}
function elements(node: ReactNode): ReactElement<Record<string, any>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as ReactElement<Record<string, any>>;
  return [element, ...elements(element.props.children)];
}

test('inactive, empty and invalid previews never load or allocate a PDF page', async () => {
  const ctx = setup();
  for (const next of [{ active: false }, { mark: null }, { document: null }, { mark: { ...mark, page: 401 } }]) {
    const result = ctx.start(next); await settle();
    expect(elements(result.tree).filter(element => element.type === 'canvas')).toHaveLength(0); result.cleanup();
  }
  expect(ctx.document.getPage).not.toHaveBeenCalled(); expect(ctx.page.render).not.toHaveBeenCalled(); expect(ctx.canvas.width).toBe(0);
});

test('work queued before React detaches its canvas never starts against the cleared ref', async () => {
  const ctx = setup(); const result = ctx.start(); ctx.detach(); await ctx.done();
  expect(ctx.document.getPage).not.toHaveBeenCalled(); expect(ctx.page.render).not.toHaveBeenCalled(); expect(harness.states[1].status).toBe('loading'); result.cleanup();
});

test('a preview with no visible width never loads a PDF page', async () => {
  const ctx = setup({ width: 0 }); const result = ctx.start(); await settle();
  expect(ctx.document.getPage).not.toHaveBeenCalled(); expect(ctx.page.render).not.toHaveBeenCalled(); expect(elements(result.tree).filter(element => element.type === 'canvas')).toHaveLength(0); result.cleanup();
});

test('a delayed page RPC cannot paint a detached or replacement canvas', async () => {
  const loaded = deferred<unknown>(); const ctx = setup({ loaded: loaded.promise }); const result = ctx.start(); await settle();
  const replacement = { width: 33, height: 44, style: {}, isConnected: true };
  ctx.canvas.isConnected = false; harness.refs[1].current = replacement; loaded.resolve(ctx.page); await ctx.done();
  expect(ctx.page.render).not.toHaveBeenCalled(); expect(ctx.canvas.width).toBe(0); expect(replacement.width).toBe(33); expect(harness.states[1].status).toBe('loading'); result.cleanup();
});

test('unmount cancels a delayed render, releases its canvas and ignores late worker failure', async () => {
  const rendered = deferred<void>(), currentPage = makePage({ rendered: rendered.promise }); const ctx = setup({ page: currentPage }); const result = ctx.start(); await settle();
  expect(ctx.page.render).toHaveBeenCalledOnce(); ctx.detach(); result.cleanup(); await ctx.done();
  expect(ctx.cancel).toHaveBeenCalled(); expect(ctx.canvas).toMatchObject({ width: 0, height: 0 });
  rendered.reject(new Error('Late synthetic worker failure')); await settle();
  expect(harness.states[1].status).toBe('loading'); expect(ctx.document.destroy).not.toHaveBeenCalled(); expect(ctx.page.cleanup).not.toHaveBeenCalled();
});

test('detachment before passive cleanup cancels an in-flight render without claiming a page failure', async () => {
  const rendered = deferred<void>(), currentPage = makePage({ rendered: rendered.promise }); const ctx = setup({ page: currentPage }); const result = ctx.start(); await settle();
  ctx.detach(); rendered.resolve(); await ctx.done();
  expect(ctx.cancel).toHaveBeenCalled(); expect(ctx.canvas).toMatchObject({ width: 0, height: 0 }); expect(harness.states[1].status).toBe('loading'); result.cleanup();
});

test('source switch cancels the previous render before reusing the one owned canvas', async () => {
  const rendered = deferred<void>(), oldPage = makePage({ rendered: rendered.promise }); const ctx = setup({ page: oldPage }); const first = ctx.start(); await settle();
  const nextPage = makePage({ width: 500, height: 700 });
  const nextDocument = { numPages: 10, getPage: vi.fn(() => Promise.resolve(nextPage.page)), destroy: vi.fn() };
  first.cleanup(); const second = ctx.start({ document: nextDocument as any, mark: { ...mark, page: 8 } }); await ctx.done();
  expect(ctx.cancel).toHaveBeenCalled(); expect(nextDocument.getPage).toHaveBeenCalledWith(8); expect(nextPage.page.render).toHaveBeenCalledOnce();
  expect(nextPage.page.render.mock.calls[0][0].canvas).toBe(ctx.canvas); expect(harness.states[1]).toMatchObject({ document: nextDocument, page: 8, status: 'ready' });
  const currentSize = { width: ctx.canvas.width, height: ctx.canvas.height }; rendered.resolve(); await settle();
  expect(ctx.canvas).toMatchObject(currentSize); expect(harness.states[1].document).toBe(nextDocument); expect(oldPage.page.cleanup).not.toHaveBeenCalled(); second.cleanup(); await settle();
});

test('closing preview while getPage is unresolved cancels without retaining the scheduling chain', async () => {
  const loaded = deferred<unknown>(); const ctx = setup({ loaded: loaded.promise }); const result = ctx.start(); await settle();
  result.cleanup(); ctx.start({ active: false }); await ctx.done();
  expect(ctx.canvas).toMatchObject({ width: 0, height: 0 }); loaded.resolve(ctx.page); await settle(); expect(ctx.page.render).not.toHaveBeenCalled();
});

test('one large selected page uses at most two million pixels and never mutates its document or mark', async () => {
  const currentPage = makePage({ width: 600, height: 6000 }); const ctx = setup({ page: currentPage, width: 1000 });
  const immutable = Object.freeze({ ...mark, rects: Object.freeze(mark.rects.map(rect => Object.freeze({ ...rect }))) }) as unknown as ReaderMark;
  const before = JSON.stringify(immutable); const result = ctx.start({ mark: immutable }); await ctx.done();
  expect(ctx.canvas.width * ctx.canvas.height).toBeLessThanOrEqual(2_000_000); expect(ctx.canvas.width).toBeGreaterThan(0);
  expect(ctx.document.getPage).toHaveBeenCalledExactlyOnceWith(7); expect(ctx.page.getTextContent).not.toHaveBeenCalled();
  expect(ctx.document.saveDocument).not.toHaveBeenCalled(); expect(ctx.document.destroy).not.toHaveBeenCalled(); expect(ctx.page.cleanup).not.toHaveBeenCalled();
  resetHooks(); const html = renderToStaticMarkup(<AnnotationSourcePreview {...ctx.props} mark={immutable} />);
  expect(html.match(/<canvas/g)).toHaveLength(1); expect(html).toContain('物理第 7 页'); expect(html).toContain('fill-opacity="0.35"'); expect(html).toContain('批注所在位置');
  expect(JSON.stringify(immutable)).toBe(before); result.cleanup(); await settle();
});

test('normalized rotated marks use shared PDF geometry without adding an editable surface', async () => {
  const currentPage = makePage({ rotation: 90 }); const ctx = setup({ page: currentPage, width: 1000 });
  const normalized = { ...mark, space: 'norm' as const, rects: [{ x: .1, y: .1, w: .2, h: .02 }] }; const result = ctx.start({ mark: normalized }); await ctx.done();
  resetHooks(); const html = renderToStaticMarkup(<AnnotationSourcePreview {...ctx.props} mark={normalized} />);
  expect(html).toContain('matrix(0,0.75,-0.75,0,600,0)'); expect(html).toContain('d="M60 80h120v16h-120Z"');
  expect(html).not.toContain('<textarea'); expect(html).not.toContain('contenteditable'); expect(html).not.toContain('textLayer');
  expect(ctx.props.onLocate).not.toHaveBeenCalled(); const locate = elements(ctx.render()).find(element => element.type === 'button')!; locate.props.onClick(); expect(ctx.props.onLocate).toHaveBeenCalledExactlyOnceWith(mark); result.cleanup(); await settle();
});

test('real render failures show an error without reporting a parse or successful write', async () => {
  const ctx = setup({ page: makePage({ renderError: new Error('Synthetic damaged page') }) }); const result = ctx.start(); await ctx.done();
  resetHooks(); const html = renderToStaticMarkup(<AnnotationSourcePreview {...ctx.props} />);
  expect(html).toContain('role="alert"'); expect(html).toContain('Synthetic damaged page'); expect(html).not.toContain('已保存'); expect(html).not.toContain('已解析'); expect(ctx.canvas).toMatchObject({ width: 0, height: 0 }); result.cleanup(); await settle();
});

test('manager stays inside the App frame and unmounts preview at narrow widths', () => {
  harness.states = [1100]; const back = vi.fn(), change = vi.fn();
  const props = { title: 'Synthetic.pdf', onBack: back, previewOpen: true, onPreviewOpenChange: change, preview: <div>Original page</div>, children: <div>Manager list</div> };
  const wide = AnnotationManagerFrame(props); const nodes = elements(wide);
  expect(nodes.find(element => element.type === 'aside')).toBeDefined(); expect(nodes.filter(element => element.type === 'dialog')).toHaveLength(0);
  nodes.find(element => element.props.className === 'annotation-manager-back')!.props.onClick(); expect(back).toHaveBeenCalledOnce();
  nodes.find(element => element.props.role === 'switch')!.props.onClick(); expect(change).toHaveBeenCalledExactlyOnceWith(false);
  resetHooks(); harness.states[0] = 600; const narrow = AnnotationManagerFrame(props);
  expect(elements(narrow).find(element => element.type === 'aside')).toBeUndefined(); expect(elements(narrow).find(element => element.props.role === 'switch')!.props.disabled).toBe(true);
});
