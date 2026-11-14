import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { buildHtmlRegionDocument, validateHtmlScrollMessage, validateHtmlSelectionMessage, validateHtmlStateMessage } from '../src/app/shared/html-region/runtime.js';
import { COMMENT_CURSOR } from '../src/app/shared/comments/cursor.js';

const options = { channel: 'unique-frame-channel', regionId: 'region-one', sourceRevision: 7, annotation: true };
const windows: JSDOM[] = [];
afterEach(() => { windows.forEach((dom) => dom.window.close()); windows.length = 0; vi.unstubAllGlobals(); });

function parser() {
  const dom = new JSDOM(); windows.push(dom);
  vi.stubGlobal('DOMParser', dom.window.DOMParser);
}

async function runtime(source: string, overrides = {}) {
  parser();
  const sent: Record<string, unknown>[] = [];
  const dom = new JSDOM(buildHtmlRegionDocument(source, { ...options, ...overrides }), { runScripts: 'dangerously', beforeParse(window) {
    Object.defineProperty(window, 'CSS', { value: { escape: (value: string) => value } });
    Object.defineProperty(window, 'TextEncoder', { value: TextEncoder });
    window.postMessage = (message: Record<string, unknown>) => { sent.push(message); };
  } }); windows.push(dom);
  await new Promise<void>((resolve) => dom.window.addEventListener('load', () => resolve(), { once: true }));
  return { dom, sent, select: () => sent.filter((message) => message.type === 'studio-html-selection') };
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
    expect(doc.head.firstElementChild?.getAttribute('charset')).toBe('utf-8');
    expect(doc.head.children[1]?.getAttribute('http-equiv')).toBe('Content-Security-Policy');
    expect(source).toContain('<iframe src="https://example.com">');
    expect(source).not.toContain('studio-html-selection');
  });

  it.each(['', '<meta charset="UTF-8">', '<meta charset="gbk"><meta charset="windows-1252"><meta http-equiv="Content-Type" content="text/html;charset=gb2312">'])('decodes Chinese as UTF-8 before the injected bridge with source declarations %s', (declarations) => {
    parser();
    const chinese = '中文图解：文字拖选与区域批注。';
    const source = `<html lang="zh-CN"><head>${declarations}<title>阅读中文 HTML</title></head><body><p>${chinese}</p></body></html>`;
    const savedSource = source;
    const rendered = buildHtmlRegionDocument(source, options);
    const charset = '<meta charset="utf-8">';
    const charsetEnd = rendered.indexOf(charset) + charset.length;
    expect(rendered.indexOf(charset)).toBeGreaterThan(0);
    expect(new TextEncoder().encode(rendered.slice(0, charsetEnd)).byteLength).toBeLessThanOrEqual(1024);
    expect(charsetEnd).toBeLessThan(rendered.indexOf('<script'));
    const dom = new JSDOM(Buffer.from(rendered, 'utf8')); windows.push(dom);
    expect(dom.window.document.characterSet).toBe('UTF-8');
    expect(dom.window.document.querySelector('p')?.textContent).toBe(chinese);
    expect(dom.window.document.title).toBe('阅读中文 HTML');
    expect(dom.window.document.querySelectorAll('meta[charset]')).toHaveLength(1);
    expect(dom.window.document.head.firstElementChild?.outerHTML).toBe(charset);
    expect(source).toBe(savedSource);
    expect(source).toContain(declarations);
    expect(source).not.toContain('data-studio-runtime');
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

  it('intercepts source button, pointer and form handlers while annotating', async () => {
    const { dom, select } = await runtime('<form><button data-studio-id="vote">Vote</button></form><script>window.executed=[];for(const name of ["pointerdown","mousedown","click","submit"]){window.addEventListener(name,()=>window.executed.push(name),true);}</script>');
    const button = dom.window.document.querySelector('button')!;
    const pointer = new dom.window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 12, clientY: 18 });
    button.dispatchEvent(pointer);
    expect(pointer.defaultPrevented).toBe(false);
    button.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    const click = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 12, clientY: 18 });
    button.dispatchEvent(click);
    const submit = new dom.window.Event('submit', { bubbles: true, cancelable: true });
    dom.window.document.querySelector('form')!.dispatchEvent(submit);
    expect(click.defaultPrevented).toBe(true);
    expect(submit.defaultPrevented).toBe(true);
    expect(dom.window.eval('window.executed')).toEqual([]);
    expect(select()).toHaveLength(1);
    expect(select()[0]).toMatchObject({ targetIds: ['vote'], point: { x: 12, y: 18 } });
  });

  it('captures a natural text drag and suppresses the trailing node click', async () => {
    const { dom, select } = await runtime('<p data-studio-id="paragraph">Hello selected text</p>');
    const paragraph = dom.window.document.querySelector('p')!;
    paragraph.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 20, clientY: 30 }));
    const range = dom.window.document.createRange();
    range.setStart(paragraph.firstChild!, 6);
    range.setEnd(paragraph.firstChild!, 14);
    Object.defineProperty(range, 'getBoundingClientRect', { value: () => ({ x: 20, y: 30, width: 70, height: 18 }) });
    dom.window.getSelection()!.addRange(range);
    paragraph.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true, clientX: 90, clientY: 48 }));
    paragraph.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 90, clientY: 48 }));
    expect(select()).toHaveLength(1);
    expect(select()[0]).toMatchObject({ targetIds: ['paragraph'], quote: 'selected', rect: { x: 20, y: 30, w: 70, h: 18 }, point: { x: 90, y: 48 } });
  });

  it('captures Shift drag areas in document CSS pixels without a mode switch', async () => {
    const { dom, select } = await runtime('<section data-studio-id="container"><p data-studio-id="child">Child</p></section>');
    Object.defineProperty(dom.window, 'scrollX', { value: 80 });
    Object.defineProperty(dom.window, 'scrollY', { value: 120 });
    for (const element of dom.window.document.querySelectorAll('[data-studio-id]')) Object.defineProperty(element, 'getBoundingClientRect', { value: () => ({ x: 10, y: 20, left: 10, right: 70, top: 20, bottom: 80, width: 60, height: 60 }) });
    const child = dom.window.document.querySelector('p')!;
    const down = new dom.window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, shiftKey: true, clientX: 10, clientY: 20 });
    child.dispatchEvent(down);
    child.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 50, clientY: 60 }));
    child.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true, clientX: 50, clientY: 60 }));
    child.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: 50, clientY: 60 }));
    expect(down.defaultPrevented).toBe(true);
    expect(select()).toHaveLength(1);
    expect(select()[0]).toMatchObject({ targetIds: ['child'], quote: 'Child', rect: { x: 90, y: 140, w: 40, h: 40 }, point: { x: 50, y: 60 } });
  });

  it('keeps normal source button interaction when annotation is disabled', async () => {
    const { dom, select } = await runtime('<button>Vote</button><script>window.votes=0;document.querySelector("button").addEventListener("click",()=>window.votes++);</script>', { annotation: false });
    dom.window.document.querySelector('button')!.click();
    expect(dom.window.eval('window.votes')).toBe(1);
    expect(select()).toHaveLength(0);
  });

  it('changes annotation state only for its authenticated parent, region and source', async () => {
    const { dom, sent, select } = await runtime('<button data-studio-id="vote">Vote</button><script>window.votes=0;document.querySelector("button").addEventListener("click",()=>window.votes++);</script>', { annotation: false });
    expect(sent.find((message) => message.type === 'studio-html-ready')).toMatchObject({ channel: options.channel, regionId: options.regionId, sourceRevision: options.sourceRevision });
    const mode = { type: 'studio-html-mode', ...options, enabled: true };
    for (const invalid of [{ regionId: 'other' }, { channel: 'other' }, { sourceRevision: 6 }]) dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source: dom.window as unknown as MessageEventSource, data: { ...mode, ...invalid } }));
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source: null, data: mode }));
    dom.window.document.querySelector('button')!.click();
    expect(dom.window.eval('window.votes')).toBe(1);
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source: dom.window as unknown as MessageEventSource, data: mode }));
    dom.window.document.querySelector('button')!.click();
    expect(dom.window.eval('window.votes')).toBe(1);
    expect(select()).toHaveLength(1);
  });

  it('uses the shared bubble cursor for all annotation targets and restores source cursors on exit', async () => {
    const source = '<html style="cursor:help"><head><style>#button{cursor:pointer}</style></head><body><button id="button" style="cursor:pointer">Click</button><p>Selectable text</p></body></html>';
    const { dom } = await runtime(source, { annotation: false });
    const button = dom.window.document.querySelector('button')!;
    const paragraph = dom.window.document.querySelector('p')!;
    const cursorStyle = dom.window.document.querySelector<HTMLStyleElement>('[data-studio-runtime="annotation-cursor"]')!;
    expect(cursorStyle.textContent).toBe('');
    expect(dom.window.getComputedStyle(button).cursor).toBe('pointer');
    const mode = { type: 'studio-html-mode', ...options, enabled: true };
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source: dom.window as unknown as MessageEventSource, data: mode }));
    expect(dom.window.getComputedStyle(paragraph).cursor).toBe(COMMENT_CURSOR);
    expect(dom.window.getComputedStyle(button).cursor).toBe(COMMENT_CURSOR);
    const rule = cursorStyle.sheet!.cssRules[0] as CSSStyleRule;
    expect(rule.selectorText).toBe(':root, :root *');
    expect(rule.style.getPropertyValue('cursor')).toBe(COMMENT_CURSOR);
    expect(rule.style.getPropertyPriority('cursor')).toBe('important');
    expect(button.getAttribute('style')).toBe('cursor:pointer');
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source: dom.window as unknown as MessageEventSource, data: { ...mode, enabled: false } }));
    expect(cursorStyle.textContent).toBe('');
    expect(dom.window.getComputedStyle(button).cursor).toBe('pointer');
    expect(dom.window.document.documentElement.style.cursor).toBe('help');
    expect(source).not.toContain('data-studio-runtime');
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
    expect(validateHtmlSelectionMessage({ ...valid, point: { x: Infinity, y: 10 } }, options)).toBeNull();
    expect(validateHtmlSelectionMessage({ ...valid, point: { x: 10, y: 1e8 } }, options)).toBeNull();
  });
  it('bounds untrusted excerpts and exposes no mutation operation from frame messages', () => {
    expect(validateHtmlSelectionMessage({ ...valid, excerpt: 'x'.repeat(16001) }, options)).toBeNull();
    const accepted = validateHtmlSelectionMessage({ ...valid, operation: 'delete-all', token: 'do-not-forward' }, options);
    expect(accepted).not.toHaveProperty('operation');
    expect(accepted).not.toHaveProperty('token');
    expect(accepted).toMatchObject({ regionId: 'region-one', sourceRevision: 7, targetIds: ['gateway'] });
  });

  it('validates internal client points and discards frame-supplied host screen points', () => {
    const accepted = validateHtmlSelectionMessage({ ...valid, point: { x: 20, y: 40 }, screenPoint: { x: 900, y: 900 } }, options);
    expect(accepted?.point).toEqual({ x: 20, y: 40 });
    expect(accepted).not.toHaveProperty('screenPoint');
  });

  it('rejects unauthenticated or malformed scroll positions and bounds', () => {
    const scroll = { type: 'studio-html-scroll', ...options, x: 20, y: 300, maxX: 100, maxY: 900 };
    expect(validateHtmlScrollMessage(scroll, options)).toEqual({ x: 20, y: 300, maxX: 100, maxY: 900 });
    for (const invalid of [{ channel: 'other' }, { regionId: 'other' }, { sourceRevision: 6 }, { x: -1 }, { y: 901 }, { maxX: NaN }, { maxY: Infinity }, { maxY: 1e8 }]) expect(validateHtmlScrollMessage({ ...scroll, ...invalid }, options)).toBeNull();
  });
});

describe('HTML reader scroll bridge', () => {
  it('reports scroll and restores only authenticated, finite coordinates clamped to new content', async () => {
    const { dom, sent } = await runtime('<p>Long document</p>', { preserveScroll: true });
    Object.defineProperties(dom.window.document.documentElement, { scrollWidth: { value: 800 }, scrollHeight: { value: 1800 } });
    Object.defineProperties(dom.window, { innerWidth: { value: 300 }, innerHeight: { value: 600 }, scrollX: { value: 30 }, scrollY: { value: 250 } });
    const scroll = vi.spyOn(dom.window, 'scrollTo').mockImplementation(() => {});
    dom.window.dispatchEvent(new dom.window.Event('scroll'));
    expect(sent.find((message) => message.type === 'studio-html-scroll')).toMatchObject({ channel: options.channel, regionId: options.regionId, sourceRevision: 7, x: 30, y: 250, maxX: 500, maxY: 1200 });
    const restore = { type: 'studio-html-scroll-restore', ...options, x: 600, y: 1500 };
    for (const invalid of [{ channel: 'other' }, { regionId: 'other' }, { sourceRevision: 6 }, { x: -1 }, { y: Infinity }, { y: 1e8 }]) dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source: dom.window as unknown as MessageEventSource, data: { ...restore, ...invalid } }));
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source: null, data: restore }));
    expect(scroll).not.toHaveBeenCalled();
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source: dom.window as unknown as MessageEventSource, data: restore }));
    expect(scroll).toHaveBeenCalledWith(500, 1200);
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
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source: dom.window as unknown as MessageEventSource, data: { type: 'studio-html-state-update', channel: options.channel, regionId: options.regionId, state: { votes: 3 }, version: 5, saveId: 1 } }));
    const beforeRemote = sent.length;
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source: dom.window as unknown as MessageEventSource, data: { type: 'studio-html-state-update', channel: options.channel, regionId: options.regionId, state: { votes: 8 }, version: 6 } }));
    expect(dom.window.document.querySelector('#count')?.textContent).toBe('8');
    expect(dom.window.eval('studioEmbed.load()')).toEqual({ votes: 8 });
    expect(dom.window.eval('window.changes')).toEqual([{ votes: 8 }]);
    expect(sent).toHaveLength(beforeRemote);
    expect(source).not.toContain('votes:8');
  });

  it('keeps newer local clicks across an early own acknowledgement and ignores duplicate acknowledgements', async () => {
    const { dom, sent } = await runtime('<p>Counter</p>', { annotation: false, state: { votes: 0 }, elementVersion: 1, writable: true });
    const receive = (data: Record<string, unknown>) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source: dom.window as unknown as MessageEventSource, data: { type: 'studio-html-state-update', channel: options.channel, regionId: options.regionId, ...data } }));
    const click = () => dom.window.eval('studioEmbed.save({votes:studioEmbed.load().votes+1})');
    click(); click();
    receive({ saveId: 1, state: { votes: 1 }, version: 2 });
    expect(dom.window.eval('studioEmbed.load()')).toEqual({ votes: 2 });
    click();
    expect(dom.window.eval('studioEmbed.load()')).toEqual({ votes: 3 });
    expect(sent.filter(value => value.type === 'studio-html-state').map(value => [value.saveId, value.state, value.baseVersion])).toEqual([[1, { votes: 1 }, 1], [2, { votes: 2 }, 1], [3, { votes: 3 }, 2]]);
    receive({ saveId: 3, state: { votes: 3 }, version: 3 });
    receive({ saveId: 1, state: { votes: 1 }, version: 2 });
    receive({ saveId: 3, state: { votes: 99 }, version: 99 });
    receive({ saveId: 999, state: { votes: 99 }, version: 99 });
    expect(dom.window.eval('studioEmbed.load()')).toEqual({ votes: 3 });
    receive({ state: { votes: 4 }, version: 4 });
    expect(dom.window.eval('studioEmbed.load()')).toEqual({ votes: 4 });
  });

  it('replays newer nested local intent over merged own ACK values, including deletions and array replacement', async () => {
    const { dom } = await runtime('<p>Form</p>', { annotation: false, state: { form: { count: 0, label: 'A', obsolete: true }, rows: [1] }, elementVersion: 1, writable: true });
    dom.window.eval('studioEmbed.save({form:{count:1,label:"A",obsolete:true},rows:[1]});studioEmbed.save({form:{count:2,label:"A"},rows:[1,2]});');
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source: dom.window as unknown as MessageEventSource, data: { type: 'studio-html-state-update', channel: options.channel, regionId: options.regionId, saveId: 1, version: 3, state: { form: { count: 1, label: 'Remote', obsolete: true }, rows: [1], remote: true } } }));
    expect(dom.window.eval('studioEmbed.load()')).toEqual({ form: { count: 2, label: 'Remote' }, rows: [1, 2], remote: true });
  });

  it('keeps remote authority separate from dirty intent, reports both on error, and discards only explicitly', async () => {
    const { dom, sent } = await runtime('<p>Counter</p>', { annotation: false, state: { votes: 0 }, elementVersion: 1, writable: true });
    dom.window.eval('window.errors=[];window.addEventListener("studio-embed-error", event=>window.errors.push(event.detail));studioEmbed.save({votes:1});');
    const receive = (data: Record<string, unknown>) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source: dom.window as unknown as MessageEventSource, data: { channel: options.channel, regionId: options.regionId, ...data } }));
    receive({ type: 'studio-html-state-update', version: 5, state: { votes: 8 } });
    expect(dom.window.eval('studioEmbed.load()')).toEqual({ votes: 1 });
    dom.window.eval('studioEmbed.save({votes:2})');
    expect(sent.filter(value => value.type === 'studio-html-state').at(-1)?.baseVersion).toBe(1);
    receive({ type: 'studio-html-state-error', version: 5, saveId: 1, state: { votes: 8 }, message: '字段冲突' });
    expect(dom.window.eval('studioEmbed.load()')).toEqual({ votes: 2 });
    expect(dom.window.eval('window.errors.at(-1)')).toMatchObject({ message: '字段冲突', saveId: 1, localState: { votes: 2 }, remoteState: { votes: 8 }, version: 5 });
    receive({ type: 'studio-html-state-reset', version: 5, state: { votes: 8 } });
    expect(dom.window.eval('studioEmbed.load()')).toEqual({ votes: 8 });
    receive({ type: 'studio-html-state-update', version: 2, saveId: 1, state: { votes: 1 } });
    expect(dom.window.eval('studioEmbed.load()')).toEqual({ votes: 8 });
    receive({ type: 'studio-html-mode', sourceRevision: options.sourceRevision, enabled: false, writable: false });
    dom.window.eval('studioEmbed.save({votes:9})');
    expect(dom.window.eval('studioEmbed.load()')).toEqual({ votes: 8 });
    expect(sent.filter(value => value.type === 'studio-html-state')).toHaveLength(2);
  });

  it('does not advance a newer intent over a conflicting remote value carried by an own ACK', async () => {
    const { dom, sent } = await runtime('<p>Form</p>', { annotation: false, state: { a: 0, b: 0 }, elementVersion: 4, writable: true });
    dom.window.eval('studioEmbed.save({a:1,b:0});studioEmbed.save({a:1,b:1});');
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source: dom.window as unknown as MessageEventSource, data: { type: 'studio-html-state-update', channel: options.channel, regionId: options.regionId, saveId: 1, version: 5, state: { a: 1, b: 2 } } }));
    expect(dom.window.eval('studioEmbed.load()')).toEqual({ a: 1, b: 1 });
    dom.window.eval('studioEmbed.save({a:2,b:1})');
    expect(sent.filter(value => value.type === 'studio-html-state').at(-1)).toMatchObject({ state: { a: 2, b: 1 }, baseVersion: 4 });
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
