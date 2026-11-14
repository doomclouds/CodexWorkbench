import { inflateSync } from 'node:zlib';
import { JSDOM } from 'jsdom';
import { describe, expect, test } from 'vitest';
import { exportArtifact } from '../src/core/export';
import { boardBounds, buildBoardHtml, buildBoardSvg, extractRegionSvg, filenameFor } from '../src/core/serialization';
import { DARK_THEME, LIGHT_THEME } from '../src/core/theme';
import type { Board, BoardElement } from '../src/contracts/studio';

function board(elements: BoardElement[] = []): Board { return { artifact: { id: 'board-one', type: 'whiteboard', title: '架构 <审阅> / 示例', revision: 3, createdAt: '2026-11-14T00:00:00Z', updatedAt: '2026-11-14T01:00:00Z', pinned: false }, style: { ...LIGHT_THEME }, elements }; }
const shape: BoardElement = { id: 'one', type: 'shape', kind: 'rounded', x: -30, y: 15, w: 140, h: 90, text: '采样 <ADC> & FPGA', version: 2 };
const region: BoardElement = { id: 'region', type: 'html', x: 140, y: 0, w: 320, h: 180, version: 4, html: '<!doctype html><html><head><style>.node{fill:#ff0000}.edge{stroke:#111111;marker-end:url(#arrow)}</style></head><body><svg xmlns="http://www.w3.org/2000/svg" width="32" height="18" viewBox="0 0 32 18" role="img" aria-labelledby="title"><title id="title">图解</title><defs><marker id="arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><path d="M0 0L8 3L0 6"/></marker></defs><rect class="node" width="32" height="18"/><path class="edge" d="M2 2H8"/></svg></body></html>' };

describe('artifact export preserves one canonical source', () => {
  test('native JSON round-trips versions and HTML exactly; source HTML export is unchanged', async () => {
    const original = board([shape, region]);
    const result = await exportArtifact(original, 'json'); expect(JSON.parse(result.data)).toEqual(original);
    expect((await exportArtifact(original, 'html', { regionId: region.id })).data).toBe(region.html);
    expect(() => buildBoardSvg(original, { ids: ['missing'] })).toThrow('不存在');
  });
  test('whole HTML contains isolated source-preserving regions and native geometry', () => {
    const html = buildBoardHtml(board([shape, region])); const document = new JSDOM(html).window.document;
    const frame = document.querySelector('iframe')!;
    expect(frame.getAttribute('srcdoc')).toBe(region.html); expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(document.querySelector('svg')?.querySelector('[data-studio-id="one"]')?.textContent).toContain(shape.text);
    expect(document.title).toBe('架构 <审阅> / 示例');
  });
  test('whole HTML preserves stacking order between native annotations and HTML regions', () => {
    const document = new JSDOM(buildBoardHtml(board([region, shape]))).window.document;
    expect([...document.querySelector('main')!.children].map(element => element.tagName.toLowerCase())).toEqual(['iframe', 'svg']);
  });
  test('exported connectors attach to node boundaries and retain endpoints when exported alone', () => {
    const left = { ...shape, id: 'left', x: 0, y: 0, w: 100, h: 60 }; const right = { ...shape, id: 'right', x: 200, y: 0, w: 100, h: 60 };
    const edge: BoardElement = { id: 'edge', type: 'arrow', x: 0, y: 0, w: 1, h: 1, version: 1, from: 'left', to: 'right', fromSide: 'right', toSide: 'left' };
    const document = new JSDOM(buildBoardSvg(board([left, right, edge]), { ids: ['edge'] }), { contentType: 'image/svg+xml' }).window.document;
    expect(document.querySelector('[data-studio-id="edge"] path')?.getAttribute('d')?.match(/-?\d+(?:\.\d+)?/g)?.map(Number)).toEqual([100, 30, 200, 30]);
    const viewBox = document.documentElement.getAttribute('viewBox')!.split(' ').map(Number); expect(viewBox[0]).toBeLessThan(100); expect(viewBox[0] + viewBox[2]).toBeGreaterThan(200);
  });
  test('SVG is valid XML, retains Chinese labels, and covers negative scene coordinates', () => {
    const original = board([shape]); original.style = { ...DARK_THEME };
    const svg = buildBoardSvg(original); const document = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
    expect(document.querySelector('parsererror')).toBeNull(); expect(document.querySelector('svg')?.getAttribute('viewBox')).toBe('-62 -17 204 154');
    expect(document.querySelector('text')?.textContent).toBe(shape.text);
    expect(document.querySelector('text')?.getAttribute('fill')).toBe('#f5f5f5');
    expect(boardBounds([shape])).toEqual({ x: -62, y: -17, width: 204, height: 154 });
  });
  test('freehand export retains canvas paint, width, dash, smoothing and unclipped bounds', () => {
    const pen: BoardElement = { id: 'pen', type: 'stroke', x: 10, y: 20, w: 40, h: 40, version: 1, points: [0, 0, 40, 0, 40, 40], stroke: '#123456', strokeWidth: 9, color: '#ff0000', width: 1, dash: true };
    const document = new JSDOM(buildBoardSvg(board([pen])), { contentType: 'image/svg+xml' }).window.document;
    const path = document.querySelector('[data-studio-id="pen"] path')!;
    expect(path.getAttribute('stroke')).toBe('#123456'); expect(path.getAttribute('stroke-width')).toBe('9'); expect(path.getAttribute('stroke-dasharray')).toBe('6 5');
    expect(path.getAttribute('d')).toBe('M 10 20 Q 50 20 50 40 L 50 60');
    expect(boardBounds([pen], 0)).toEqual({ x: 1, y: 11, width: 58, height: 58 });
  });
  test('image exports preserve safe page links without turning videos into image links', () => {
    const image: BoardElement = { id: 'picture', type: 'image', x: 0, y: 0, w: 20, h: 20, version: 1, src: 'data:image/png;base64,AA', href: 'https://example.com/picture' };
    const exported = (value: BoardElement) => new JSDOM(buildBoardHtml(board([value]))).window.document;
    expect(exported(image).querySelector('a')?.getAttribute('href')).toBe(image.href);
    expect(exported({ ...image, href: 'javascript:alert(1)' }).querySelector('a')).toBeNull();
    expect(exported({ ...image, video: '/assets/board-one/movie' }).querySelector('a')).toBeNull();
  });
  test('region SVG carries CSS, namespaces all identities and preserves valid references', () => {
    const svg = extractRegionSvg(String(region.html), 'copied-region')!; const document = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
    expect(document.querySelector('parsererror')).toBeNull();
    expect(document.querySelector('marker')?.id).toBe('copied-region_arrow');
    expect(document.querySelector('svg')?.getAttribute('aria-labelledby')).toBe('copied-region_title');
    expect(document.querySelector('style')?.textContent).toContain('url(#copied-region_arrow)');
    expect(document.getElementById('copied-region_title')?.textContent).toBe('图解');
    const repeated = new JSDOM(`<svg xmlns="http://www.w3.org/2000/svg">${svg}${extractRegionSvg(String(region.html), 'second')}</svg>`, { contentType: 'image/svg+xml' }).window.document;
    const ids = [...repeated.querySelectorAll('[id]')].map(node => node.id); expect(new Set(ids).size).toBe(ids.length);
  });
  test('scripts, event handlers and external SVG assets are not executable export payloads', () => {
    const svg = extractRegionSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><image href="https://example.test/private" onload="alert(1)"/><rect id="valid" width="8" height="8"/></svg>', 'safe')!;
    const document = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
    expect(document.querySelector('script')).toBeNull(); expect(document.querySelector('image')?.hasAttribute('href')).toBe(false); expect(document.querySelector('image')?.hasAttribute('onload')).toBe(false);
  });
  test('SVG namespacing distinguishes selector identities from hexadecimal colors', () => {
    const svg = extractRegionSvg('<svg xmlns="http://www.w3.org/2000/svg" aria-labelledby="fff title"><style>#fff{fill:#fff;stroke:#123456}</style><title id="title">引用</title><rect id="fff" width="10" height="10"/></svg>', 'region')!;
    const document = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
    expect(document.querySelector('style')?.textContent).toContain('#region_fff{fill:#fff;stroke:#123456}');
    expect(document.documentElement.getAttribute('aria-labelledby')).toBe('region_fff region_title');
  });
  test('PNG renderer produces actual colored pixels with the source SVG dimensions', async () => {
    const result = await exportArtifact(board([region]), 'png', { regionId: region.id }); const bytes = Buffer.from(result.data, 'base64');
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); expect(bytes.readUInt32BE(16)).toBe(32); expect(bytes.readUInt32BE(20)).toBe(18);
    let position = 8; const chunks: Buffer[] = [];
    while (position < bytes.length) { const length = bytes.readUInt32BE(position); if (bytes.toString('ascii', position + 4, position + 8) === 'IDAT') chunks.push(bytes.subarray(position + 8, position + 8 + length)); position += length + 12; }
    const pixels = inflateSync(Buffer.concat(chunks)); const channels = bytes[25] === 6 ? 4 : 3;
    expect(bytes[24]).toBe(8); expect([2, 6]).toContain(bytes[25]);
    const stride = 32 * channels; const decoded = Buffer.alloc(18 * stride);
    const paeth = (a: number, b: number, c: number) => { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
    for (let y = 0; y < 18; y++) {
      const filter = pixels[y * (stride + 1)];
      for (let x = 0; x < stride; x++) {
        const a = x >= channels ? decoded[y * stride + x - channels] : 0; const b = y ? decoded[(y - 1) * stride + x] : 0; const c = y && x >= channels ? decoded[(y - 1) * stride + x - channels] : 0;
        decoded[y * stride + x] = (pixels[y * (stride + 1) + x + 1] + (filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : filter === 4 ? paeth(a, b, c) : 0)) & 255;
      }
    }
    const center = (9 * 32 + 16) * channels;
    expect([...decoded.subarray(center, center + 3)]).toEqual([255, 0, 0]);
    expect(result.mimeType).toBe('image/png'); expect(result.encoding).toBe('base64');
  });
  test('rich HTML is never silently returned as an empty server PNG', async () => {
    const rich = { ...region, html: '<html><body><h1>需要浏览器排版</h1></body></html>' };
    await expect(exportArtifact(board([rich]), 'png')).rejects.toMatchObject({ code: 'EXPORT_BROWSER_REQUIRED' });
    await expect(exportArtifact(board([rich]), 'png', { regionId: rich.id })).rejects.toMatchObject({ code: 'EXPORT_BROWSER_REQUIRED' });
  });
  test('export names are portable and do not introduce paths', () => {
    expect(filenameFor('../CON <one> / 输出', 'svg')).not.toContain('/'); expect(filenameFor('CON', 'png')).toBe('_CON.png'); expect(filenameFor('白板', 'html')).toBe('白板.html');
  });
});
