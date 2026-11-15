import { afterEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { buildHtmlRegionDocument } from '../src/app/shared/html-region/runtime.js';
import { COMMENT_CURSOR } from '../src/app/shared/comments/cursor.js';

const options = { channel: 'html-target-regression', regionId: 'region', sourceRevision: 3, annotation: true };
const windows: JSDOM[] = [];
afterEach(() => { windows.forEach(dom => dom.window.close()); windows.length = 0; vi.unstubAllGlobals(); });
async function render(source: string) {
  const parser = new JSDOM(); windows.push(parser); vi.stubGlobal('DOMParser', parser.window.DOMParser);
  const sent: Record<string, unknown>[] = [];
  const dom = new JSDOM(buildHtmlRegionDocument(source, options), { runScripts: 'dangerously', beforeParse(win) {
    Object.defineProperty(win, 'CSS', { value: { escape: (value: string) => value } });
    win.TextEncoder = TextEncoder; win.postMessage = (value: Record<string, unknown>) => { sent.push(value); };
  } }); windows.push(dom);
  await new Promise<void>(resolve => dom.window.addEventListener('load', () => resolve(), { once: true }));
  const fire = (node: Element, type: string) => node.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: 50, clientY: 60 }));
  const mode = (enabled: boolean) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source: dom.window as unknown as MessageEventSource, data: { type: 'studio-html-mode', ...options, enabled } }));
  return { dom, fire, mode, selections: () => sent.filter(value => value.type === 'studio-html-selection') };
}

it('targets the visible summary when closed details blank space is clicked under a stable ancestor', async () => {
  const { dom, fire, selections } = await render('<main><footer data-studio-id="source-context"><details id="details"><summary id="summary">源码依据与范围</summary><p>Hidden source notes</p></details></footer></main>');
  const summary = dom.window.document.getElementById('summary')!, details = dom.window.document.getElementById('details')!;
  summary.getBoundingClientRect = () => ({ x: 20, y: 30, width: 112, height: 24 } as DOMRect);
  fire(details, 'pointermove');
  const outline = dom.window.document.querySelector<HTMLElement>('[data-studio-runtime="outline"]')!;
  expect(outline.style.left).toBe('20px'); expect(outline.style.width).toBe('112px');
  fire(details, 'pointerdown'); fire(details, 'pointerup'); fire(details, 'click');
  expect(selections()).toEqual([expect.objectContaining({ selector: '#summary', targetIds: ['source-context'], quote: '源码依据与范围', rect: { x: 20, y: 30, w: 112, h: 24 } })]);
  expect(selections()[0].excerpt).toContain('data-studio-id="source-context"');
  expect(selections()[0].excerpt).toContain('Hidden source notes');
});

it('chooses the nearest control or paragraph without replacing it with a tagged container', async () => {
  const control = await render('<section data-studio-id="panel"><button id="button"><span id="label">Visible control</span></button><p>Other content</p></section>');
  control.fire(control.dom.window.document.getElementById('label')!, 'click');
  expect(control.selections()[0]).toMatchObject({ selector: '#button', targetIds: ['panel'], quote: 'Visible control' });
  const text = await render('<section data-studio-id="panel"><p id="paragraph">Visible text<span hidden>Hidden attribute</span><span style="display:none">Hidden style</span><script>window.sourceRuns=true;</script></p><p>Other paragraph</p></section>');
  text.fire(text.dom.window.document.getElementById('paragraph')!, 'click');
  expect(text.selections()[0]).toMatchObject({ selector: '#paragraph', targetIds: ['panel'], quote: 'Visible text' });
  expect(text.selections()[0].excerpt).toContain('Other paragraph');
  expect(text.selections()[0].excerpt).not.toContain('<script');
});

it('keeps a natural text range exact while retaining the nearest stable context', async () => {
  const { dom, fire, selections } = await render('<section data-studio-id="panel"><p id="paragraph">Hello selected text</p><p>Other paragraph</p></section>');
  const paragraph = dom.window.document.getElementById('paragraph')!;
  fire(paragraph, 'pointerdown');
  const range = dom.window.document.createRange(); range.setStart(paragraph.firstChild!, 6); range.setEnd(paragraph.firstChild!, 14);
  range.getBoundingClientRect = () => ({ x: 20, y: 30, width: 70, height: 18 } as DOMRect);
  dom.window.getSelection()!.addRange(range);
  fire(paragraph, 'pointerup'); fire(paragraph, 'click');
  expect(selections()).toEqual([expect.objectContaining({ selector: '#paragraph', targetIds: ['panel'], quote: 'selected', rect: { x: 20, y: 30, w: 70, h: 18 } })]);
});

it('declares annotation priority before source CSS and protects future CSSOM rules without losing source cursor state', async () => {
  const { dom, mode } = await render('<style id="source">@layer source { #line { cursor:pointer!important } }</style><p id="line" style="cursor:text!important">Text</p>');
  const order = dom.window.document.querySelector<HTMLStyleElement>('[data-studio-runtime="annotation-layer-order"]');
  expect(order).not.toBeNull();
  expect(order!.compareDocumentPosition(dom.window.document.getElementById('source')!) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const declaration = order!.textContent!.match(/@layer\s+([^;]+);/)![1]!;
  const annotation = dom.window.document.querySelector<HTMLStyleElement>('[data-studio-runtime="annotation-cursor"]')!;
  expect(annotation.textContent).toContain(`@layer ${declaration}`);
  const block = [...annotation.sheet!.cssRules].find(rule => rule.cssText.startsWith(`@layer ${declaration}`)) as CSSGroupingRule;
  expect(block.cssRules[0]!.cssText).toContain('!important');
  expect(block.cssRules[0]!.cssText).toContain('::before'); expect(block.cssRules[0]!.cssText).toContain('::after');
  const source = (dom.window.document.getElementById('source') as HTMLStyleElement).sheet!;
  source.insertRule('#line::before { content:"Label"; cursor:crosshair!important }', source.cssRules.length);
  source.insertRule('#line { cursor:crosshair!important }', source.cssRules.length);
  await Promise.resolve();
  expect(annotation.textContent).toContain(COMMENT_CURSOR);
  mode(false);
  expect(annotation.textContent).toBe('');
  expect(source.cssRules[source.cssRules.length - 1]!.cssText).toContain('cursor: crosshair !important');
  expect(dom.window.document.getElementById('line')!.getAttribute('style')).toBe('cursor:text!important');
});
