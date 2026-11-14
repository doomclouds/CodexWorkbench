import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import HtmlReader from '../src/app/HtmlReader';
import { createRegionReaderLink, watchRegionReaderReturn } from '../src/app/region-reader';
import type { StudioClient } from '../src/contracts/studio';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const first = { artifactId: 'artifact-one', regionId: 'html-one', artifactTitle: '原白板', title: '原图', sourceRevision: 1, version: 2, width: 1440, height: 1120, canAnnotate: true,
  element: { id: 'html-one', html: '<h1>Original source · 中文图解</h1>', state: { votes: 1 }, version: 2, sourceRevision: 1 } };
function browser() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/region/artifact-one/html-one#cap=reader-secret', pretendToBeVisual: true });
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('location', dom.window.location); vi.stubGlobal('localStorage', dom.window.localStorage);
  vi.stubGlobal('DOMParser', dom.window.DOMParser); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  return dom;
}

describe('independent HTML reader', () => {
  it('renders the original sandboxed document read-only, announces source changes and refreshes on demand', async () => {
    vi.useFakeTimers(); const dom = browser();
    let revision = 1;
    const createUrl = vi.spyOn(URL, 'createObjectURL');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL');
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer reader-secret' });
      if (input.endsWith('/return')) return Response.json({ ok: true, data: { requested: true } });
      const next = revision === 1 ? first : { ...first, version: 3, sourceRevision: 2, element: { ...first.element, html: '<h1>New source · 新版图解</h1>', version: 3, sourceRevision: 2 } };
      if (input.endsWith('?metadata=1')) { const { element: _element, ...metadata } = next; return Response.json({ ok: true, data: metadata }); }
      return Response.json({ ok: true, data: next });
    });
    vi.stubGlobal('fetch', fetcher);
    const root = createRoot(dom.window.document.getElementById('root')!);
    await act(async () => root.render(<HtmlReader artifactId="artifact-one" regionId="html-one" />));
    const frame = dom.window.document.querySelector('iframe')!;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts'); expect(frame.hasAttribute('src')).toBe(false);
    const source = frame.srcdoc;
    expect(source).toContain('Original source'); expect(source).toContain('"writable":false'); expect(source).not.toContain('reader-secret');
    expect(source).toContain('<head><meta charset="utf-8">'); expect(source).toContain('中文图解');
    expect(dom.window.document.querySelector('.studio-html-modes')).toBeNull();
    expect(dom.window.document.querySelector('.studio-canvas-toolbar')).toBeNull();
    const viewport = dom.window.document.querySelector('.studio-reader-viewport')!; viewport.scrollTop = 250;
    revision = 2;
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(dom.window.document.body.textContent).toContain('原 HTML 已更新');
    expect(frame.srcdoc).toBe(source);
    const refresh = [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === '刷新到新版本')!;
    await act(async () => refresh.click());
    expect(frame.srcdoc).toContain('New source · 新版图解'); expect(frame.srcdoc).not.toBe(source); expect(viewport.scrollTop).toBe(250);
    expect(dom.window.document.body.textContent).not.toContain('原 HTML 已更新');
    const annotate = [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === '在白板中备注')!;
    await act(async () => annotate.click());
    expect(fetcher).toHaveBeenLastCalledWith('/api/region-reader/artifact-one/html-one/return', expect.objectContaining({ method: 'POST', body: JSON.stringify({ annotate: true }) }));
    expect(dom.window.document.body.textContent).toContain('请切回原白板');
    await act(async () => root.unmount()); dom.window.close();
    expect(createUrl).not.toHaveBeenCalled(); expect(revokeUrl).not.toHaveBeenCalled();
  });

  it('reports expired access and never substitutes an editable client or full whiteboard', async () => {
    const dom = browser();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '阅读链接已失效，请从白板重新打开。' } }, { status: 401 })));
    const root = createRoot(dom.window.document.getElementById('root')!);
    await act(async () => root.render(<HtmlReader artifactId="artifact-one" regionId="html-one" />));
    expect(dom.window.document.querySelector('[role="alert"]')?.textContent).toContain('阅读链接已失效');
    expect(dom.window.document.querySelector('iframe')).toBeNull();
    await act(async () => root.unmount()); dom.window.close();
  });

  it('uses the embedded request transport and bounds return polling to the original live view', async () => {
    vi.useFakeTimers(); const dom = browser();
    const onReturn = vi.fn();
    let intent: unknown = { artifactId: 'artifact-other', regionId: 'html-other', viewId: 'view-one', annotate: true };
    const request = vi.fn(async (input: string | URL, init?: RequestInit) => String(input).includes('?')
      ? Response.json({ ok: true, data: { navigation: intent } })
      : Response.json({ ok: true, data: { url: 'http://localhost/region/artifact-one/html-one#cap=limited', expiresAt: Date.now() + 900000 } }));
    const client: StudioClient = { embedded: true, baseUrl: 'http://localhost', token: 'owner-secret', request, call: vi.fn() };
    const fallback = vi.fn(); vi.stubGlobal('fetch', fallback);
    const result = await createRegionReaderLink(client, { artifactId: 'artifact-one', regionId: 'html-one', viewId: 'view-one' });
    expect(result.url).toContain('#cap=limited'); expect(fallback).not.toHaveBeenCalled();
    const close = watchRegionReaderReturn(client, { artifactId: 'artifact-one', viewId: 'view-one' }, onReturn);
    await vi.advanceTimersByTimeAsync(1); expect(onReturn).not.toHaveBeenCalled();
    intent = { artifactId: 'artifact-one', regionId: 'html-one', viewId: 'view-one', annotate: true };
    await vi.advanceTimersByTimeAsync(1500); expect(onReturn).toHaveBeenCalledExactlyOnceWith(intent);
    Object.defineProperty(dom.window.document, 'hidden', { configurable: true, value: true });
    const count = request.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000); expect(request).toHaveBeenCalledTimes(count);
    Object.defineProperty(dom.window.document, 'hidden', { configurable: true, value: false });
    await vi.advanceTimersByTimeAsync(15 * 60_000); const expiredCount = request.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000); expect(request).toHaveBeenCalledTimes(expiredCount);
    close(); dom.window.close();
  });
});
