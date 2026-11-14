import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import HtmlRegion from '../src/app/shared/html-region/HtmlRegion.js';
import type { BoardElement } from '../src/contracts/studio.js';

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
