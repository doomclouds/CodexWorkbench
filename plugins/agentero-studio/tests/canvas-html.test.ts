import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { buildHtmlRegionDocument, validateHtmlSelectionMessage, validateHtmlStateMessage } from '../src/app/shared/html-region/runtime.js';

const options = { channel: 'unique-frame-channel', regionId: 'region-one', sourceRevision: 7, annotation: true, mode: 'element' as const };
const windows: JSDOM[] = [];
afterEach(() => { windows.forEach((dom) => dom.window.close()); windows.length = 0; vi.unstubAllGlobals(); });

function parser() {
  const dom = new JSDOM(); windows.push(dom);
  vi.stubGlobal('DOMParser', dom.window.DOMParser);
}

describe('HTML region rendering copy', () => {
  it('retains inline diagrams and animations without modifying the canonical source', () => {
    parser();
    const source = '<html><head><style>.node{fill:#eb6c36}</style><link href="https://fonts.example/font.css" rel="stylesheet"><script src="https://example.com/track.js"></script></head><body><svg viewBox="0 0 200 100"><g data-studio-id="api"><rect width="200" height="100" class="node"/><text>Gateway</text></g></svg><script>document.body.dataset.playing="yes";</script><iframe src="https://example.com"></iframe><a href="https://example.com">link</a><form action="https://example.com"><button>submit</button></form></body></html>';
    const rendered = buildHtmlRegionDocument(source, options);
    const dom = new JSDOM(rendered); windows.push(dom);
    const doc = dom.window.document;
    expect(doc.querySelector('[data-studio-id="api"] text')?.textContent).toBe('Gateway');
    expect(doc.querySelector('style:not([data-studio-runtime])')?.textContent).toContain('#eb6c36');
    expect([...doc.scripts].some((script) => script.textContent?.includes('dataset.playing'))).toBe(true);
    expect(doc.querySelector('iframe,script[src],link')).toBeNull();
    expect(doc.querySelector('a')?.hasAttribute('href')).toBe(false);
    expect(doc.querySelector('form')?.hasAttribute('action')).toBe(false);
    expect(doc.head.firstElementChild?.getAttribute('http-equiv')).toBe('Content-Security-Policy');
    expect(source).toContain('<iframe src="https://example.com">');
    expect(source).not.toContain('studio-html-selection');
  });

  it('captures the clicked SVG object with its source revision and a DOM excerpt', async () => {
    parser();
    const rendered = buildHtmlRegionDocument('<svg viewBox="0 0 100 50"><g data-studio-id="gateway"><rect width="90" height="40"/><text>Gateway</text></g></svg>', options);
    const sent: unknown[] = [];
    const dom = new JSDOM(rendered, { runScripts: 'dangerously', beforeParse(window) {
      Object.defineProperty(window, 'CSS', { value: { escape: (value: string) => value } });
      window.postMessage = (message: unknown) => { sent.push(message); };
    } }); windows.push(dom);
    await new Promise<void>((resolve) => dom.window.addEventListener('load', () => resolve(), { once: true }));
    dom.window.document.querySelector('rect')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    const selection = sent.find((value) => value && typeof value === 'object' && 'type' in value && value.type === 'studio-html-selection');
    expect(selection).toMatchObject({ regionId: 'region-one', sourceRevision: 7, targetIds: ['gateway'], quote: 'Gateway' });
    const accepted = validateHtmlSelectionMessage(selection, options);
    expect(accepted?.excerpt).toContain('data-studio-id="gateway"');
    expect(accepted?.selector).toBe('[data-studio-id="gateway"]');
  });
});

describe('frame message boundary', () => {
  const valid = { type: 'studio-html-selection', ...options, targetIds: ['gateway'], quote: 'Gateway', excerpt: '<g>Gateway</g>', rect: { x: 0, y: 0, w: 100, h: 40 } };
  it('rejects messages for a different frame, region, source version or invalid geometry', () => {
    expect(validateHtmlSelectionMessage({ ...valid, channel: 'other' }, options)).toBeNull();
    expect(validateHtmlSelectionMessage({ ...valid, regionId: 'other' }, options)).toBeNull();
    expect(validateHtmlSelectionMessage({ ...valid, sourceRevision: 6 }, options)).toBeNull();
    expect(validateHtmlSelectionMessage({ ...valid, rect: { x: 0, y: 0, w: -1, h: 30 } }, options)).toBeNull();
    expect(validateHtmlSelectionMessage({ ...valid, rect: { x: Number.NaN, y: 0, w: 100, h: 30 } }, options)).toBeNull();
  });
  it('bounds untrusted excerpts and exposes no mutation operation from frame messages', () => {
    expect(validateHtmlSelectionMessage({ ...valid, excerpt: 'x'.repeat(16001) }, options)).toBeNull();
    const accepted = validateHtmlSelectionMessage({ ...valid, operation: 'delete-all', token: 'do-not-forward' }, options);
    expect(accepted).not.toHaveProperty('operation');
    expect(accepted).not.toHaveProperty('token');
    expect(accepted).toMatchObject({ regionId: 'region-one', sourceRevision: 7, targetIds: ['gateway'] });
  });
});

describe('studioEmbed state bridge', () => {
  it('loads initial state, saves an object, and hears remote state without reloading the HTML', async () => {
    parser();
    const source = '<p id="count"></p><script>window.changes=[];document.getElementById("count").textContent=String(studioEmbed.load().votes);studioEmbed.onLoad(function(state){window.changes.push(state);document.getElementById("count").textContent=String(state.votes);});</script>';
    const rendered = buildHtmlRegionDocument(source, { ...options, state: { votes: 2 }, elementVersion: 4, writable: true });
    const sent: unknown[] = [];
    const dom = new JSDOM(rendered, { runScripts: 'dangerously', beforeParse(window) {
      Object.defineProperty(window, 'TextEncoder', { value: TextEncoder });
      window.postMessage = (message: unknown) => { sent.push(message); };
    } }); windows.push(dom);
    await new Promise<void>((resolve) => dom.window.addEventListener('load', () => resolve(), { once: true }));
    expect(dom.window.document.querySelector('#count')?.textContent).toBe('2');
    expect(dom.window.eval('window.changes')).toHaveLength(0);
    dom.window.eval('studioEmbed.save({votes:3});');
    const request = sent.find((value) => value && typeof value === 'object' && 'type' in value && value.type === 'studio-html-state');
    expect(request).toMatchObject({ regionId: 'region-one', sourceRevision: 7, baseVersion: 4, state: { votes: 3 } });
    expect(validateHtmlStateMessage(request, options)).toMatchObject({ baseVersion: 4, state: { votes: 3 } });
    const beforeRemote = sent.length;
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source: dom.window as unknown as MessageEventSource, data: { type: 'studio-html-state-update', channel: options.channel, regionId: options.regionId, state: { votes: 8 }, version: 5 } }));
    expect(dom.window.document.querySelector('#count')?.textContent).toBe('8');
    expect(dom.window.eval('studioEmbed.load()')).toEqual({ votes: 8 });
    expect(dom.window.eval('window.changes')).toEqual([{ votes: 8 }]);
    expect(sent).toHaveLength(beforeRemote);
    expect(source).not.toContain('votes:8');
  });

  it('gives read-only embeds no persistence ability', async () => {
    parser();
    const sent: unknown[] = [];
    const dom = new JSDOM(buildHtmlRegionDocument('<p>Readonly</p>', { ...options, state: { votes: 1 }, elementVersion: 4, writable: false }), { runScripts: 'dangerously', beforeParse(window) { window.postMessage = (message: unknown) => { sent.push(message); }; } }); windows.push(dom);
    await new Promise<void>((resolve) => dom.window.addEventListener('load', () => resolve(), { once: true }));
    dom.window.eval('studioEmbed.save({votes:99});');
    expect(sent.some((value) => value && typeof value === 'object' && 'type' in value && value.type === 'studio-html-state')).toBe(false);
    expect(dom.window.eval('studioEmbed.load()')).toEqual({ votes: 1 });
  });

  it('rejects cross-region, unversioned, excessive or non-JSON state messages', () => {
    const request = { type: 'studio-html-state', ...options, baseVersion: 3, saveId: 1, state: { votes: 5 } };
    expect(validateHtmlStateMessage(request, options)).toEqual({ baseVersion: 3, saveId: 1, state: { votes: 5 } });
    expect(validateHtmlStateMessage({ ...request, regionId: 'other-region' }, options)).toBeNull();
    expect(validateHtmlStateMessage({ ...request, baseVersion: undefined }, options)).toBeNull();
    expect(validateHtmlStateMessage({ ...request, state: { text: '字'.repeat(24000) } }, options)).toBeNull();
    expect(validateHtmlStateMessage({ ...request, state: { value: Number.NaN } }, options)).toBeNull();
    expect(validateHtmlStateMessage({ ...request, state: [] }, options)).toBeNull();
  });
});
