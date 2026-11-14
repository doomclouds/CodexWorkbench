import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import HtmlRegion from '../src/app/shared/html-region/HtmlRegion.js';
import type { BoardElement } from '../src/contracts/studio.js';

afterEach(() => vi.unstubAllGlobals());

it('broadcasts state-only changes without replacing an iframe rendering document', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/?token=owner-secret' });
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('DOMParser', dom.window.DOMParser); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = createRoot(dom.window.document.getElementById('root')!);
  const element: BoardElement = { id: 'region', type: 'html', x: 0, y: 0, w: 500, h: 300, version: 4, sourceRevision: 2, html: '<p data-studio-id="value">A poll</p>', state: { votes: 1 } };
  const onStateChange = async () => ({ state: { votes: 2 }, version: 5 });
  await act(async () => { root.render(<HtmlRegion element={element} annotation={false} interactive onAnnotate={() => {}} onStateChange={onStateChange} />); });
  const frame = dom.window.document.querySelector('iframe')!;
  const originalDocument = frame.src;
  expect(originalDocument.startsWith('blob:')).toBe(true);
  expect(originalDocument).not.toContain('owner-secret');
  expect(frame.hasAttribute('srcdoc')).toBe(false);
  const post = vi.spyOn(frame.contentWindow!, 'postMessage');
  await act(async () => { root.render(<HtmlRegion element={{ ...element, version: 5, state: { votes: 2 } }} annotation={false} interactive onAnnotate={() => {}} onStateChange={onStateChange} />); });
  expect(dom.window.document.querySelector('iframe')).toBe(frame);
  expect(frame.src).toBe(originalDocument);
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'studio-html-state-update', state: { votes: 2 }, version: 5 }), '*');
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  await act(async () => root.unmount());
  dom.window.close();
});
