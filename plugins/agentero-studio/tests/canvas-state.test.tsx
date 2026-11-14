import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import HtmlRegion from '../src/app/shared/html-region/HtmlRegion.js';
import type { BoardElement, Json } from '../src/contracts/studio.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const region: BoardElement = { id: 'region', type: 'html', x: 0, y: 0, w: 500, h: 300, version: 4, sourceRevision: 2, html: '<p data-studio-id="value">A poll</p>', state: { votes: 1 } };

function mount() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/?token=owner-secret' });
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('DOMParser', dom.window.DOMParser); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = createRoot(dom.window.document.getElementById('root')!);
  cleanups.push(async () => { await act(async () => root.unmount()); dom.window.close(); });
  const send = (frame: HTMLIFrameElement, data: unknown, source: MessageEventSource | null = frame.contentWindow) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source, data }));
  const messages = async (frame: HTMLIFrameElement) => {
    const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockClear();
    await act(async () => { frame.dispatchEvent(new dom.window.Event('load')); });
    const identity = post.mock.calls.find(([message]) => message.type === 'studio-html-mode')![0] as { channel: string; regionId: string; sourceRevision: number };
    return { post, identity: { channel: identity.channel, regionId: identity.regionId, sourceRevision: identity.sourceRevision } };
  };
  return { dom, root, send, messages };
}

async function connectRuntime(host: ReturnType<typeof mount>, frame: HTMLIFrameElement) {
  const { post, identity } = await host.messages(frame);
  let embedded: JSDOM | undefined;
  post.mockImplementation((message: unknown) => {
    if (embedded) embedded.window.dispatchEvent(new embedded.window.MessageEvent('message', { source: embedded.window as unknown as MessageEventSource, data: message }));
  });
  await act(async () => {
    embedded = new JSDOM(frame.srcdoc, { runScripts: 'dangerously', beforeParse(window) {
      Object.defineProperty(window, 'TextEncoder', { value: TextEncoder });
      window.postMessage = (message: unknown) => { host.send(frame, message); };
    } });
    await new Promise<void>(resolve => embedded!.window.addEventListener('load', () => resolve(), { once: true }));
  });
  const runtime = embedded!;
  cleanups.push(async () => runtime.window.close());
  return { identity, post, load: () => runtime.window.eval('studioEmbed.load()') as Json, save: (state: Json) => runtime.window.eval(`studioEmbed.save(${JSON.stringify(state)})`) };
}

it('broadcasts state-only changes without replacing an iframe rendering document', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/?token=owner-secret' });
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('DOMParser', dom.window.DOMParser); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = createRoot(dom.window.document.getElementById('root')!);
  const element: BoardElement = { id: 'region', type: 'html', x: 0, y: 0, w: 500, h: 300, version: 4, sourceRevision: 2, html: '<p data-studio-id="value">A poll</p>', state: { votes: 1 } };
  const onStateChange = async () => ({ state: { votes: 2 }, version: 5 });
  await act(async () => { root.render(<HtmlRegion element={element} annotation={false} interactive onAnnotate={() => {}} onStateChange={onStateChange} />); });
  const frame = dom.window.document.querySelector('iframe')!;
  const originalDocument = frame.srcdoc;
  expect(originalDocument.startsWith('<!doctype html>')).toBe(true);
  expect(originalDocument).not.toContain('owner-secret');
  expect(frame.hasAttribute('src')).toBe(false);
  const post = vi.spyOn(frame.contentWindow!, 'postMessage');
  await act(async () => { root.render(<HtmlRegion element={{ ...element, version: 5, state: { votes: 2 } }} annotation={false} interactive onAnnotate={() => {}} onStateChange={onStateChange} />); });
  expect(dom.window.document.querySelector('iframe')).toBe(frame);
  expect(frame.srcdoc).toBe(originalDocument);
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'studio-html-state-update', state: { votes: 2 }, version: 5 }), '*');
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  await act(async () => root.unmount());
  dom.window.close();
});

it('directly assigns UTF-8 rendering documents for the shared whiteboard and independent reader', async () => {
  const { dom, root } = mount();
  const createUrl = vi.spyOn(URL, 'createObjectURL');
  const html = '<meta charset="gbk"><p>中文阅读与白板批注</p>';
  for (const preserveScroll of [false, true]) {
    const element = { ...region, id: preserveScroll ? 'reader-region' : 'board-region', html };
    await act(async () => { root.render(<HtmlRegion element={element} annotation={!preserveScroll} interactive preserveScroll={preserveScroll} onAnnotate={() => {}} />); });
    const frame = dom.window.document.querySelector('iframe')!;
    const content = frame.srcdoc;
    expect(content).toContain('<head><meta charset="utf-8">');
    expect(content).toContain('<p>中文阅读与白板批注</p>');
    expect(content).toContain('Content-Security-Policy');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.hasAttribute('src')).toBe(false);
    expect(element.html).toBe(html);
  }
  expect(createUrl).not.toHaveBeenCalled();
});

it('removes annotation mode buttons and converts iframe client points through its host scale', async () => {
  const { dom, root, send, messages } = mount();
  const annotate = vi.fn();
  await act(async () => { root.render(<HtmlRegion element={region} annotation interactive onAnnotate={annotate} />); });
  expect(dom.window.document.querySelector('button')).toBeNull();
  const frame = dom.window.document.querySelector('iframe')!;
  Object.defineProperties(frame, { clientWidth: { value: 500 }, clientHeight: { value: 300 }, getBoundingClientRect: { value: () => ({ left: 100, top: 200, width: 250, height: 150 }) } });
  const { identity } = await messages(frame);
  const selection = { type: 'studio-html-selection', ...identity, targetIds: ['value'], quote: 'A poll', excerpt: '<p>A poll</p>', rect: { x: 30, y: 400, w: 20, h: 15 }, point: { x: 40, y: 50 }, screenPoint: { x: 9999, y: 9999 } };
  await act(async () => { send(frame, selection, null); send(frame, { ...selection, sourceRevision: 1 }); });
  expect(annotate).not.toHaveBeenCalled();
  await act(async () => { send(frame, selection); });
  expect(annotate).toHaveBeenCalledWith(expect.objectContaining({ rect: { x: 30, y: 400, w: 20, h: 15 }, screenPoint: { x: 120, y: 225 } }));
  expect(annotate.mock.calls[0][0]).not.toHaveProperty('point');
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
});

it('preserves authenticated iframe scroll across HTML source replacements after the next ready', async () => {
  const { dom, root, send, messages } = mount();
  const render = (element: BoardElement) => root.render(<HtmlRegion element={element} annotation={false} interactive preserveScroll onAnnotate={() => {}} />);
  await act(async () => { render(region); });
  const frame = dom.window.document.querySelector('iframe')!;
  const previousDocument = frame.srcdoc;
  const first = await messages(frame);
  const scroll = { type: 'studio-html-scroll', ...first.identity, x: 30, y: 480, maxX: 100, maxY: 900 };
  await act(async () => { send(frame, { type: 'studio-html-ready', ...first.identity }); send(frame, scroll); send(frame, { ...scroll, y: 800 }, null); send(frame, { ...scroll, y: 1e9 }); });
  await act(async () => { render({ ...region, html: '<p>Updated source</p>', sourceRevision: 3, version: 5 }); });
  expect(frame.srcdoc).not.toBe(previousDocument);
  const next = await messages(frame);
  expect(next.identity.channel).not.toBe(first.identity.channel);
  expect(next.post.mock.calls.some(([message]) => message.type === 'studio-html-scroll-restore')).toBe(false);
  await act(async () => { send(frame, { type: 'studio-html-ready', ...first.identity }); send(frame, { ...scroll, ...next.identity, y: 0 }); });
  expect(next.post.mock.calls.some(([message]) => message.type === 'studio-html-scroll-restore')).toBe(false);
  await act(async () => { send(frame, { type: 'studio-html-ready', ...next.identity }); });
  expect(next.post).toHaveBeenCalledWith({ type: 'studio-html-scroll-restore', ...next.identity, x: 30, y: 480 }, '*');
});

it('keeps default scroll behavior unchanged and does not restore positions between regions', async () => {
  const { dom, root, send, messages } = mount();
  await act(async () => { root.render(<HtmlRegion element={region} annotation={false} interactive onAnnotate={() => {}} />); });
  const frame = dom.window.document.querySelector('iframe')!;
  const first = await messages(frame);
  await act(async () => { send(frame, { type: 'studio-html-ready', ...first.identity }); send(frame, { type: 'studio-html-scroll', ...first.identity, x: 0, y: 400, maxX: 0, maxY: 900 }); });
  await act(async () => { root.render(<HtmlRegion element={{ ...region, html: '<p>Updated source</p>', sourceRevision: 3 }} annotation={false} interactive preserveScroll onAnnotate={() => {}} />); });
  const updated = await messages(frame);
  await act(async () => { send(frame, { type: 'studio-html-ready', ...updated.identity }); send(frame, { type: 'studio-html-scroll', ...updated.identity, x: 0, y: 400, maxX: 0, maxY: 900 }); });
  expect(updated.post.mock.calls.some(([message]) => message.type === 'studio-html-scroll-restore')).toBe(false);
  await act(async () => { root.render(<HtmlRegion element={{ ...region, id: 'another-region', html: '<p>Another source</p>' }} annotation={false} interactive preserveScroll onAnnotate={() => {}} />); });
  const next = await messages(frame);
  await act(async () => { send(frame, { type: 'studio-html-ready', ...next.identity }); });
  expect(next.post.mock.calls.some(([message]) => message.type === 'studio-html-scroll-restore')).toBe(false);
});

it('coalesces pending state saves and advances only its accepted compare-and-swap versions', async () => {
  const { dom, root, send, messages } = mount();
  let finishFirst!: (result: { state: { votes: number }; version: number }) => void;
  const change = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; })).mockResolvedValueOnce({ state: { votes: 4 }, version: 6 });
  await act(async () => { root.render(<HtmlRegion element={region} annotation={false} interactive onAnnotate={() => {}} onStateChange={change} />); });
  const frame = dom.window.document.querySelector('iframe')!;
  const { identity } = await messages(frame);
  await act(async () => {
    for (const votes of [2, 3, 4]) send(frame, { type: 'studio-html-state', ...identity, baseVersion: 4, saveId: votes - 1, state: { votes } });
  });
  expect(change).toHaveBeenCalledTimes(1);
  expect(change).toHaveBeenNthCalledWith(1, { votes: 2 }, 4);
  await act(async () => { finishFirst({ state: { votes: 2 }, version: 5 }); });
  expect(change).toHaveBeenCalledTimes(2);
  expect(change).toHaveBeenNthCalledWith(2, { votes: 4 }, 5);
});

it('runs real iframe clicks through the serial saver without early ACK rollback or losing merged remote fields', async () => {
  const host = mount();
  const waiting: ((result: { state: Json; version: number }) => void)[] = [];
  const change = vi.fn((_state: Json, _version: number) => new Promise<{ state: Json; version: number }>(resolve => waiting.push(resolve)));
  await act(async () => host.root.render(<HtmlRegion element={{ ...region, state: { votes: 0, label: 'A' } }} annotation={false} interactive onAnnotate={() => {}} onStateChange={change} />));
  const runtime = await connectRuntime(host, host.dom.window.document.querySelector('iframe')!);
  await act(async () => { runtime.save({ votes: 1, label: 'A' }); runtime.save({ votes: 2, label: 'A' }); });
  expect(change).toHaveBeenCalledTimes(1);
  await act(async () => waiting.shift()!({ state: { votes: 1, label: 'Remote' }, version: 5 }));
  expect(runtime.load()).toEqual({ votes: 2, label: 'Remote' });
  expect(change).toHaveBeenNthCalledWith(2, { votes: 2, label: 'Remote' }, 5);
  await act(async () => runtime.save({ ...runtime.load() as object, votes: 3 }));
  await act(async () => waiting.shift()!({ state: { votes: 2, label: 'Remote' }, version: 6 }));
  expect(runtime.load()).toEqual({ votes: 3, label: 'Remote' });
  expect(change).toHaveBeenNthCalledWith(3, { votes: 3, label: 'Remote' }, 6);
  await act(async () => waiting.shift()!({ state: { votes: 3, label: 'Remote' }, version: 7 }));
  expect(runtime.load()).toEqual({ votes: 3, label: 'Remote' });
  await act(async () => host.send(host.dom.window.document.querySelector('iframe')!, { type: 'studio-html-state', ...runtime.identity, saveId: 3, baseVersion: 6, state: { votes: 99 } }));
  expect(change).toHaveBeenCalledTimes(3);
});

it('retains the newest failed iframe intent for explicit retry and exposes the authoritative state for discard', async () => {
  const host = mount();
  let reject!: (error: Error) => void;
  const change = vi.fn().mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })).mockResolvedValueOnce({ state: { votes: 3 }, version: 5 }).mockRejectedValueOnce(new Error('同一字段有冲突'));
  await act(async () => host.root.render(<HtmlRegion element={region} annotation={false} interactive onAnnotate={() => {}} onStateChange={change} />));
  const runtime = await connectRuntime(host, host.dom.window.document.querySelector('iframe')!);
  await act(async () => { runtime.save({ votes: 2 }); runtime.save({ votes: 3 }); reject(new Error('网络暂不可用')); });
  expect(runtime.load()).toEqual({ votes: 3 });
  expect(host.dom.window.document.querySelector('[role="alert"]')?.textContent).toContain('网络暂不可用');
  expect(host.dom.window.document.querySelector('pre')?.textContent).toContain('"votes": 1');
  await act(async () => [...host.dom.window.document.querySelectorAll('button')].find(button => button.textContent === '重试保存')!.click());
  expect(change).toHaveBeenNthCalledWith(2, { votes: 3 }, 4);
  expect(host.dom.window.document.querySelector('[role="alert"]')).toBeNull();
  await act(async () => runtime.save({ votes: 4 }));
  expect(runtime.load()).toEqual({ votes: 4 });
  await act(async () => [...host.dom.window.document.querySelectorAll('button')].find(button => button.textContent === '使用共享状态')!.click());
  expect(runtime.load()).toEqual({ votes: 3 });
  expect(change).toHaveBeenCalledTimes(3);
});

it('isolates old-source asynchronous errors from the new channel and its pending real iframe saves', async () => {
  const host = mount();
  let rejectOld!: (error: Error) => void;
  let acceptNew!: (result: { state: Json; version: number }) => void;
  const change = vi.fn().mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; })).mockImplementationOnce(() => new Promise(resolve => { acceptNew = resolve; })).mockResolvedValueOnce({ state: { votes: 12 }, version: 7 });
  const render = (element: BoardElement) => host.root.render(<HtmlRegion element={element} annotation={false} interactive onAnnotate={() => {}} onStateChange={change} />);
  await act(async () => render(region));
  const frame = host.dom.window.document.querySelector('iframe')!;
  const old = await connectRuntime(host, frame);
  await act(async () => old.save({ votes: 2 }));
  await act(async () => render({ ...region, html: '<p>New source</p>', sourceRevision: 3, version: 5, state: { votes: 10 } }));
  const next = await connectRuntime(host, frame);
  expect(next.identity.channel).not.toBe(old.identity.channel);
  await act(async () => { next.save({ votes: 11 }); next.save({ votes: 12 }); rejectOld(new Error('旧源码请求失败')); });
  expect(host.dom.window.document.querySelector('[role="alert"]')).toBeNull();
  expect(next.load()).toEqual({ votes: 12 });
  await act(async () => acceptNew({ state: { votes: 11 }, version: 6 }));
  expect(change).toHaveBeenNthCalledWith(3, { votes: 12 }, 6);
  expect(next.load()).toEqual({ votes: 12 });
});

it('keeps the original write base across a remote conflict until the user explicitly adopts shared state', async () => {
  const host = mount();
  const change = vi.fn().mockRejectedValueOnce(new Error('共享字段已变化')).mockRejectedValueOnce(new Error('共享字段仍有冲突')).mockResolvedValueOnce({ state: { votes: 10 }, version: 6 });
  const render = (element: BoardElement) => host.root.render(<HtmlRegion element={element} annotation={false} interactive onAnnotate={() => {}} onStateChange={change} />);
  await act(async () => render(region));
  const runtime = await connectRuntime(host, host.dom.window.document.querySelector('iframe')!);
  await act(async () => runtime.save({ votes: 2 }));
  await act(async () => render({ ...region, version: 5, state: { votes: 9 } }));
  expect(runtime.load()).toEqual({ votes: 2 });
  await act(async () => runtime.save({ votes: 3 }));
  expect(change).toHaveBeenCalledTimes(1);
  await act(async () => [...host.dom.window.document.querySelectorAll('button')].find(button => button.textContent === '重试保存')!.click());
  expect(change).toHaveBeenNthCalledWith(2, { votes: 3 }, 4);
  expect(runtime.load()).toEqual({ votes: 3 });
  expect(host.dom.window.document.querySelector('pre')?.textContent).toContain('"votes": 9');
  await act(async () => [...host.dom.window.document.querySelectorAll('button')].find(button => button.textContent === '使用共享状态')!.click());
  expect(runtime.load()).toEqual({ votes: 9 });
  await act(async () => runtime.save({ votes: 10 }));
  expect(change).toHaveBeenNthCalledWith(3, { votes: 10 }, 5);
});

it('does not turn a remote overlap included in an own ACK into a newer-version overwrite', async () => {
  const host = mount();
  let acceptFirst!: (result: { state: Json; version: number }) => void;
  const change = vi.fn().mockImplementationOnce(() => new Promise(resolve => { acceptFirst = resolve; })).mockRejectedValueOnce(new Error('共享字段 b 存在冲突'));
  await act(async () => host.root.render(<HtmlRegion element={{ ...region, state: { a: 0, b: 0 } }} annotation={false} interactive onAnnotate={() => {}} onStateChange={change} />));
  const runtime = await connectRuntime(host, host.dom.window.document.querySelector('iframe')!);
  await act(async () => { runtime.save({ a: 1, b: 0 }); runtime.save({ a: 1, b: 1 }); });
  await act(async () => acceptFirst({ state: { a: 1, b: 2 }, version: 5 }));
  expect(change).toHaveBeenNthCalledWith(2, { a: 1, b: 1 }, 4);
  expect(runtime.load()).toEqual({ a: 1, b: 1 });
  expect(host.dom.window.document.querySelector('[role="alert"]')?.textContent).toContain('存在冲突');
  expect(host.dom.window.document.querySelector('pre')?.textContent).toContain('"b": 2');
  await act(async () => [...host.dom.window.document.querySelectorAll('button')].find(button => button.textContent === '使用共享状态')!.click());
  expect(runtime.load()).toEqual({ a: 1, b: 2 });
});

it('lets two real iframe regions progress independently and pauses unsent intent after edit permission is removed', async () => {
  const host = mount();
  let acceptFirst!: (result: { state: Json; version: number }) => void;
  const firstChange = vi.fn().mockImplementationOnce(() => new Promise(resolve => { acceptFirst = resolve; })).mockResolvedValueOnce({ state: { votes: 3 }, version: 6 });
  const secondChange = vi.fn().mockResolvedValue({ state: { votes: 2 }, version: 5 });
  const render = (writable: boolean) => host.root.render(<><HtmlRegion element={region} annotation={false} interactive onAnnotate={() => {}} onStateChange={writable ? firstChange : undefined} /><HtmlRegion element={{ ...region, id: 'second-region' }} annotation={false} interactive onAnnotate={() => {}} onStateChange={secondChange} /></>);
  await act(async () => render(true));
  const frames = host.dom.window.document.querySelectorAll('iframe');
  const first = await connectRuntime(host, frames[0]);
  const second = await connectRuntime(host, frames[1]);
  await act(async () => { first.save({ votes: 2 }); first.save({ votes: 3 }); second.save({ votes: 2 }); });
  expect(firstChange).toHaveBeenCalledTimes(1); expect(secondChange).toHaveBeenCalledTimes(1);
  expect(second.load()).toEqual({ votes: 2 });
  await act(async () => render(false));
  await act(async () => render(true));
  await act(async () => acceptFirst({ state: { votes: 2 }, version: 5 }));
  expect(firstChange).toHaveBeenCalledTimes(1);
  expect(first.load()).toEqual({ votes: 3 });
  expect(host.dom.window.document.querySelector('[role="alert"]')?.textContent).toContain('编辑权限已变更');
  expect(firstChange).toHaveBeenCalledTimes(1);
  await act(async () => [...host.dom.window.document.querySelectorAll('button')].find(button => button.textContent === '重试保存')!.click());
  expect(firstChange).toHaveBeenNthCalledWith(2, { votes: 3 }, 5);
});
