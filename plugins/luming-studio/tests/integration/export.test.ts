import { inflateSync } from 'node:zlib';
import { JSDOM } from 'jsdom';
import { describe, expect, test } from 'vitest';
import { exportArtifact } from '../support/rendering.js';
import {
  boardBounds,
  buildBoardHtml,
  buildBoardSvg,
  extractRegionSvg,
  filenameFor,
} from '../../src/shared/serialization';
import { contrastRatio, DARK_THEME, LIGHT_THEME } from '../../src/shared/theme';
import type { Board, BoardElement } from '../../src/contracts/studio';
import { BOARD_STICKERS, boardStickerMarkup } from '../../src/shared/whiteboard-stickers';

function board(elements: BoardElement[] = []): Board {
  return {
    artifact: {
      id: 'board-one',
      type: 'whiteboard',
      title: '架构 <审阅> / 示例',
      revision: 3,
      createdAt: '2026-11-14T00:00:00Z',
      updatedAt: '2026-11-14T01:00:00Z',
      pinned: false,
    },
    style: { ...LIGHT_THEME },
    elements,
  };
}

const shape: BoardElement = {
  id: 'one',
  type: 'shape',
  kind: 'rounded',
  x: -30,
  y: 15,
  w: 140,
  h: 90,
  text: '采样 <ADC> & FPGA',
  version: 2,
};
const region: BoardElement = {
  id: 'region',
  type: 'html',
  x: 140,
  y: 0,
  w: 320,
  h: 180,
  version: 4,
  html: '<!doctype html><html><head><style>.node{fill:#ff0000}.edge{stroke:#111111;marker-end:url(#arrow)}</style></head><body><svg xmlns="http://www.w3.org/2000/svg" width="32" height="18" viewBox="0 0 32 18" role="img" aria-labelledby="title"><title id="title">图解</title><defs><marker id="arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><path d="M0 0L8 3L0 6"/></marker></defs><rect class="node" width="32" height="18"/><path class="edge" d="M2 2H8"/></svg></body></html>',
};

describe('artifact export preserves one canonical source', () => {
  test.each(
    (['light', 'dark'] as const).flatMap((theme) =>
      [undefined, 'ink', 'muted'].map((color) => ({ theme, color })),
    ),
  )(
    'exports automatic text against its visible native backdrop in $theme with $color ink',
    ({ theme, color }) => {
      const style = theme === 'dark' ? DARK_THEME : LIGHT_THEME;
      const fill = theme === 'dark' ? '#EFEFEF' : '#222638';
      const surface: BoardElement = {
        ...shape,
        id: 'surface',
        type: 'container',
        x: 0,
        y: 0,
        w: 400,
        h: 260,
        fill,
        text: '',
      };
      const text: BoardElement = {
        ...shape,
        id: 'text',
        type: 'text',
        x: 40,
        y: 60,
        w: 220,
        h: 60,
        color,
      };
      const source = board([surface, text]);
      source.style = { ...style };
      const original = structuredClone(source);
      for (const markup of [buildBoardSvg(source), buildBoardHtml(source)]) {
        const document = new JSDOM(markup).window.document;
        const ink = document.querySelector('[data-studio-id="text"] text')!.getAttribute('fill')!;
        expect(contrastRatio(ink, fill)).toBeGreaterThanOrEqual(4.5);
      }

      const isolated = new JSDOM(buildBoardSvg(source, { ids: ['text'] })).window.document;
      expect(
        contrastRatio(isolated.querySelector('text')!.getAttribute('fill')!, style.paper),
      ).toBeGreaterThanOrEqual(4.5);
      expect(source).toEqual(original);
    },
  );
  test.each([
    { type: 'container', x: 160, y: 0, w: 400, h: 260, fill: '#EFEFEF' },
    { type: 'container', x: 0, y: 0, w: 400, h: 260, fill: '#EFEFEF', rotation: 30 },
    { type: 'container', x: 0, y: 0, w: 400, h: 260, fill: 'rgba(255,255,255,.5)' },
    { type: 'shape', kind: 'ellipse', x: 0, y: 0, w: 400, h: 260, fill: '#EFEFEF' },
    { type: 'html', x: 0, y: 0, w: 400, h: 260, html: '<p>Opaque content</p>' },
  ] as const)(
    'keeps the canvas default when an overlapping $type surface is uncertain',
    (extra) => {
      const base: BoardElement = {
        ...shape,
        id: 'base',
        type: 'container',
        x: 0,
        y: 0,
        w: 500,
        h: 300,
        fill: '#EFEFEF',
      };
      const cover: BoardElement = { ...shape, id: 'cover', ...extra };
      const text: BoardElement = {
        ...shape,
        id: 'text',
        type: 'text',
        x: 40,
        y: 60,
        w: 220,
        h: 60,
      };
      const source = board([base, cover, text]);
      source.style = { ...DARK_THEME };
      const exported = new JSDOM(buildBoardSvg(source)).window.document;
      expect(exported.querySelector('[data-studio-id="text"] text')!.getAttribute('fill')).toBe(
        DARK_THEME.ink,
      );
    },
  );
  test('exports automatic table body and header ink against their separate surfaces', () => {
    const value: BoardElement = {
      ...shape,
      type: 'table',
      fill: '#EFEFEF',
      color: 'ink',
      data: { rows: [['Header'], ['Body']] },
    };
    const source = board([value]);
    source.style = { ...DARK_THEME };
    const document = new JSDOM(buildBoardSvg(source)).window.document;
    const texts = [...document.querySelectorAll('[data-studio-id="one"] text')];
    expect(contrastRatio(texts[0]!.getAttribute('fill')!, '#EFEFEF')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(texts[1]!.getAttribute('fill')!, DARK_THEME.paper)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(value.color).toBe('ink');
  });
  test('prepares backdrop layers once when exporting a thousand text objects or their selection', () => {
    const background: BoardElement = {
      ...shape,
      id: 'surface',
      type: 'container',
      x: 0,
      y: 0,
      w: 1200,
      h: 2400,
      fill: '#EFEFEF',
      text: '',
    };
    const texts: BoardElement[] = Array.from({ length: 1000 }, (_, index) => ({
      ...shape,
      id: `text-${index}`,
      type: 'text',
      x: 20 + (index % 10) * 110,
      y: 20 + Math.floor(index / 10) * 22,
      w: 90,
      h: 20,
    }));
    const elements = [background, ...texts];
    const ids = elements.map((element) => element.id);
    let reads = 0;
    const source = board(
      elements.map(
        (element) =>
          new Proxy(element, {
            get(value, key, receiver) {
              if (key === 'id') {
                reads++;
              }

              return Reflect.get(value, key, receiver);
            },
          }),
      ),
    );
    source.style = { ...DARK_THEME };
    for (const options of [{}, { ids }]) {
      reads = 0;
      const markup = buildBoardSvg(source, options);
      expect(markup).toContain('data-studio-id="text-999"');
      expect(reads).toBeLessThan(elements.length * 8);
    }
  });
  test.each(
    (['light', 'dark'] as const).flatMap((theme) => [
      { theme, color: '#2d3142', fill: '#ffffff' },
      { theme, color: '#eacb67', fill: '#1d4266' },
    ]),
  )(
    'exports populated table cells with readable per-surface ink in $theme with $color',
    ({ theme, color, fill }) => {
      const rows = [
        ['名称', '说明', '状态'],
        ['项目 A', '第一行内容', '进行中'],
        ['项目 B', '第二行内容', '待处理'],
      ];
      const value: BoardElement = { ...shape, type: 'table', color, fill, data: { rows } };
      const source = board([value]);
      source.style = { ...(theme === 'dark' ? DARK_THEME : LIGHT_THEME) };
      const original = structuredClone(source);
      for (const markup of [buildBoardSvg(source), buildBoardHtml(source)]) {
        const document = new JSDOM(markup).window.document;
        const texts = [...document.querySelectorAll('[data-studio-id="one"] text')];
        expect(texts.map((text) => text.textContent)).toEqual(rows.flat());
        for (const text of texts.slice(0, 3)) {
          expect(contrastRatio(text.getAttribute('fill')!, color)).toBe(1);
        }

        for (const text of texts.slice(3)) {
          expect(
            contrastRatio(text.getAttribute('fill')!, source.style.paper),
          ).toBeGreaterThanOrEqual(4.5);
        }

        const matchesLightInk = theme === 'light' && color === '#2d3142';
        const matchesDarkInk = theme === 'dark' && color === '#eacb67';
        if (matchesLightInk || matchesDarkInk) {
          for (const text of texts.slice(3)) {
            expect(contrastRatio(text.getAttribute('fill')!, color)).toBe(1);
          }
        }
      }

      expect(source).toEqual(original);
    },
  );
  test('renders visible PNG body text when the stored table ink matches the dark workspace', async () => {
    const rows = [
      ['名称', '说明', '状态'],
      ['项目 A', '第一行内容', '进行中'],
      ['项目 B', '第二行内容', '待处理'],
    ];
    const value: BoardElement = {
      ...shape,
      type: 'table',
      x: 0,
      y: 0,
      w: 600,
      h: 180,
      color: '#2d3142',
      fill: '#ffffff',
      data: { rows },
    };
    const source = board([value]);
    source.style = { ...DARK_THEME };
    const blank = structuredClone(source);
    blank.elements[0]!.data!.rows = [rows[0], ['', '', ''], ['', '', '']];
    const visible = await exportArtifact(source, 'png', { padding: 0 });
    const empty = await exportArtifact(blank, 'png', { padding: 0 });
    expect(visible.data).not.toBe(empty.data);
    expect(Buffer.from(visible.data, 'base64').readUInt32BE(16)).toBe(600);
    expect(value.color).toBe('#2d3142');
    expect(value.data!.rows).toEqual(rows);
  });
  test.each(
    (['light', 'dark'] as const).flatMap((theme) =>
      (['text', 'shape', 'note', 'container'] as const).map((type) => ({ theme, type })),
    ),
  )(
    'preserves explicit low-contrast $type ink in $theme SVG and HTML exports',
    ({ theme, type }) => {
      const style = theme === 'dark' ? DARK_THEME : LIGHT_THEME;
      const color = theme === 'dark' ? '#303645' : '#F4F4F4';
      const value: BoardElement = { ...shape, type, fill: style.paper, color };
      const original = board([value]);
      original.style = { ...style };
      const snapshot = structuredClone(original);
      for (const markup of [buildBoardSvg(original), buildBoardHtml(original)]) {
        const document = new JSDOM(markup).window.document;
        const texts = [...document.querySelectorAll('[data-studio-id="one"] text')];
        expect(texts.length).toBeGreaterThan(0);
        expect(texts.map((node) => node.getAttribute('fill'))).toEqual(
          Array(texts.length).fill(color),
        );
      }

      expect(original).toEqual(snapshot);
    },
  );
  test.each(['shape', 'note', 'container'] as const)(
    'keeps semantic %s ink readable when a theme color matches its surface',
    (type) => {
      const value = { ...shape, type, fill: DARK_THEME.paper, color: 'ink' };
      const original = board([value]);
      original.style = { ...DARK_THEME, ink: DARK_THEME.paper };
      const document = new JSDOM(buildBoardSvg(original)).window.document;
      const color = document.querySelector('text')!.getAttribute('fill')!;
      expect(contrastRatio(color, DARK_THEME.paper)).toBeGreaterThanOrEqual(4.5);
      expect(value.color).toBe('ink');
    },
  );
  test('exports legacy TSV table cells with structured data taking precedence when present', async () => {
    const legacy = {
      ...shape,
      type: 'table' as const,
      x: 0,
      y: 0,
      w: 900,
      h: 300,
      text: '名称\t说明\t状态\n项目 A\t双击单元格编辑\t进行中\n项目 B\t后续安排\t待处理',
      data: undefined,
    };
    const document = new JSDOM(buildBoardSvg(board([legacy])), { contentType: 'image/svg+xml' })
      .window.document;
    expect(document.querySelectorAll('[data-studio-id="one"] > rect')).toHaveLength(9);
    expect([...document.querySelectorAll('text')].map((node) => node.textContent)).toEqual([
      '名称',
      '说明',
      '状态',
      '项目 A',
      '双击单元格编辑',
      '进行中',
      '项目 B',
      '后续安排',
      '待处理',
    ]);
    expect(document.querySelector('[data-studio-id="one"] > rect')!.getAttribute('width')).toBe(
      '300',
    );
    const html = new JSDOM(buildBoardHtml(board([legacy]))).window.document;
    expect(html.body.textContent).toContain('后续安排');
    const structured = new JSDOM(
      buildBoardSvg(board([{ ...legacy, data: { rows: [['Current', 'Rows']] } }])),
      { contentType: 'image/svg+xml' },
    ).window.document;
    expect([...structured.querySelectorAll('text')].map((node) => node.textContent)).toEqual([
      'Current',
      'Rows',
    ]);
    const png = await exportArtifact(board([legacy]), 'png', { padding: 0 });
    expect(Buffer.from(png.data, 'base64').readUInt32BE(16)).toBe(900);
  });
  test('preserves combined inline marks, escaped literals and real table widths and header state', () => {
    const text = {
      ...shape,
      type: 'text' as const,
      text: '[**_both_**](https://example.com) and \\_literal\\_',
    };
    const document = new JSDOM(buildBoardSvg(board([text])), { contentType: 'image/svg+xml' })
      .window.document;
    expect(document.querySelector('a tspan')?.getAttribute('font-weight')).toBe('700');
    expect(document.querySelector('a tspan')?.getAttribute('font-style')).toBe('italic');
    expect(document.querySelector('text')?.textContent).toContain('_literal_');
    const table = {
      ...shape,
      type: 'table' as const,
      x: 0,
      w: 300,
      data: {
        rows: [
          ['A', 'B'],
          ['C', 'D'],
        ],
        columnWidths: [100, 200],
        head: false,
      },
    };
    const exported = new JSDOM(buildBoardSvg(board([table])), { contentType: 'image/svg+xml' })
      .window.document;
    const cells = [...exported.querySelectorAll('[data-studio-id="one"] > rect')];
    expect(cells.map((cell) => cell.getAttribute('width'))).toEqual(['100', '200', '100', '200']);
    expect(cells.map((cell) => cell.getAttribute('fill'))).toEqual(
      Array(4).fill(LIGHT_THEME.paper),
    );
  });
  test('exports the entire vector sticker catalog through the shared SVG, HTML and real PNG renderer', async () => {
    const stickers = BOARD_STICKERS.map((sticker, index): BoardElement => ({
      id: `sticker-${sticker.id}`,
      type: 'sticker',
      text: sticker.label,
      data: { stickerIconId: sticker.id },
      x: (index % 7) * 80,
      y: Math.floor(index / 7) * 80,
      w: 64,
      h: 64,
      version: 1,
    }));
    const source = board(stickers);
    expect(new Set(BOARD_STICKERS.map((sticker) => sticker.id)).size).toBe(42);
    const svg = buildBoardSvg(source, { padding: 0 });
    const html = buildBoardHtml(source);
    const xml = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
    expect(xml.querySelector('parsererror')).toBeNull();
    expect(xml.querySelectorAll('[data-sticker-icon-id]')).toHaveLength(42);
    for (const sticker of BOARD_STICKERS) {
      expect(svg).toContain(boardStickerMarkup(sticker.id));
      expect(html).toContain(boardStickerMarkup(sticker.id));
    }

    expect(svg).not.toContain('<text');
    const png = Buffer.from((await exportArtifact(source, 'png', { padding: 0 })).data, 'base64');
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBe(544);
    expect(png.readUInt32BE(20)).toBe(464);
    expect(png.length).toBeGreaterThan(10_000);
  });
  test('native JSON round-trips versions and HTML exactly; source HTML export is unchanged', async () => {
    const original = board([shape, region]);
    const result = await exportArtifact(original, 'json');
    expect(JSON.parse(result.data)).toEqual(original);
    expect((await exportArtifact(original, 'html', { regionId: region.id })).data).toBe(
      region.html,
    );
    expect(() => buildBoardSvg(original, { ids: ['missing'] })).toThrow('不存在');
  });
  test('whole HTML contains isolated source-preserving regions and native geometry', () => {
    const html = buildBoardHtml(board([shape, region]));
    const document = new JSDOM(html).window.document;
    const frame = document.querySelector('iframe')!;
    const srcdoc = frame.getAttribute('srcdoc')!;
    expect(srcdoc).toContain('data-studio-export-runtime="state"');
    expect(srcdoc.replace(/<script data-studio-export-runtime="state">[^]*?<\/script>/, '')).toBe(
      region.html,
    );
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(
      document.querySelector('svg')?.querySelector('[data-studio-id="one"]')?.textContent,
    ).toContain(shape.text);
    expect(document.title).toBe('架构 <审阅> / 示例');
  });
  test('whole HTML preserves stacking order between native annotations and HTML regions', () => {
    const document = new JSDOM(buildBoardHtml(board([region, shape]))).window.document;
    expect(
      [...document.querySelector('main')!.children].map((element) => element.tagName.toLowerCase()),
    ).toEqual(['iframe', 'svg']);
  });
  test('exported connectors attach to node boundaries and retain endpoints when exported alone', () => {
    const left = { ...shape, id: 'left', x: 0, y: 0, w: 100, h: 60 };
    const right = { ...shape, id: 'right', x: 200, y: 0, w: 100, h: 60 };
    const edge: BoardElement = {
      id: 'edge',
      type: 'arrow',
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      version: 1,
      from: 'left',
      to: 'right',
      fromSide: 'right',
      toSide: 'left',
    };
    const document = new JSDOM(buildBoardSvg(board([left, right, edge]), { ids: ['edge'] }), {
      contentType: 'image/svg+xml',
    }).window.document;
    expect(
      document
        .querySelector('[data-studio-id="edge"] path')
        ?.getAttribute('d')
        ?.match(/-?\d+(?:\.\d+)?/g)
        ?.map(Number),
    ).toEqual([100, 30, 200, 30]);
    const viewBox = document.documentElement.getAttribute('viewBox')!.split(' ').map(Number);
    expect(viewBox[0]).toBeLessThan(100);
    expect(viewBox[0] + viewBox[2]).toBeGreaterThan(200);
  });
  test('SVG is valid XML, retains Chinese labels, and covers negative scene coordinates', () => {
    const original = board([shape]);
    original.style = { ...DARK_THEME };
    const svg = buildBoardSvg(original);
    const document = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
    expect(document.querySelector('parsererror')).toBeNull();
    expect(document.querySelector('svg')?.getAttribute('viewBox')).toBe('-62 -17 204 154');
    expect(document.querySelector('text')?.textContent).toBe(shape.text);
    expect(document.querySelector('text')?.getAttribute('fill')).toBe('#f5f5f5');
    expect(boardBounds([shape])).toEqual({ x: -62, y: -17, width: 204, height: 154 });
  });
  test('freehand export retains canvas paint, width, dash, smoothing and unclipped bounds', () => {
    const pen: BoardElement = {
      id: 'pen',
      type: 'stroke',
      x: 10,
      y: 20,
      w: 40,
      h: 40,
      version: 1,
      points: [0, 0, 40, 0, 40, 40],
      stroke: '#123456',
      strokeWidth: 9,
      color: '#ff0000',
      width: 1,
      dash: true,
    };
    const document = new JSDOM(buildBoardSvg(board([pen])), { contentType: 'image/svg+xml' }).window
      .document;
    const path = document.querySelector('[data-studio-id="pen"] path')!;
    expect(path.getAttribute('stroke')).toBe('#123456');
    expect(path.getAttribute('stroke-width')).toBe('9');
    expect(path.getAttribute('stroke-dasharray')).toBe('6 5');
    expect(path.getAttribute('d')).toBe('M 10 20 Q 50 20 50 40 L 50 60');
    expect(boardBounds([pen], 0)).toEqual({ x: 1, y: 11, width: 58, height: 58 });
  });
  test('image exports preserve safe page links without turning videos into image links', () => {
    const image: BoardElement = {
      id: 'picture',
      type: 'image',
      x: 0,
      y: 0,
      w: 20,
      h: 20,
      version: 1,
      src: 'data:image/png;base64,AA',
      href: 'https://example.com/picture',
    };
    const exported = (value: BoardElement) =>
      new JSDOM(buildBoardHtml(board([value]))).window.document;
    expect(exported(image).querySelector('a')?.getAttribute('href')).toBe(image.href);
    expect(exported({ ...image, href: 'javascript:alert(1)' }).querySelector('a')).toBeNull();
    const movie = exported({ ...image, video: 'data:video/mp4;base64,AAAA' });
    expect(movie.querySelector('a')).toBeNull();
    expect(movie.querySelector('video')?.getAttribute('src')).toBe('data:video/mp4;base64,AAAA');
    expect(() => exported({ ...image, video: '/assets/board-one/movie' })).toThrow(
      '嵌入视频和封面资源',
    );
  });
  test('region SVG carries CSS, namespaces all identities and preserves valid references', () => {
    const svg = extractRegionSvg(String(region.html), 'copied-region')!;
    const document = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
    expect(document.querySelector('parsererror')).toBeNull();
    expect(document.querySelector('marker')?.id).toBe('copied-region_arrow');
    expect(document.querySelector('svg')?.getAttribute('aria-labelledby')).toBe(
      'copied-region_title',
    );
    expect(document.querySelector('style')?.textContent).toContain('url(#copied-region_arrow)');
    expect(document.getElementById('copied-region_title')?.textContent).toBe('图解');
    const repeated = new JSDOM(
      `<svg xmlns="http://www.w3.org/2000/svg">${svg}${extractRegionSvg(String(region.html), 'second')}</svg>`,
      { contentType: 'image/svg+xml' },
    ).window.document;
    const ids = [...repeated.querySelectorAll('[id]')].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  test('scripts, event handlers and external SVG assets are not executable export payloads', () => {
    const svg = extractRegionSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><image href="https://example.test/private" onload="alert(1)"/><rect id="valid" width="8" height="8"/></svg>',
      'safe',
    )!;
    const document = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('image')?.hasAttribute('href')).toBe(false);
    expect(document.querySelector('image')?.hasAttribute('onload')).toBe(false);
  });
  test('SVG namespacing distinguishes selector identities from hexadecimal colors', () => {
    const svg = extractRegionSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" aria-labelledby="fff title"><style>#fff{fill:#fff;stroke:#123456}</style><title id="title">引用</title><rect id="fff" width="10" height="10"/></svg>',
      'region',
    )!;
    const document = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
    expect(document.querySelector('style')?.textContent).toContain(
      '#region_fff{fill:#fff;stroke:#123456}',
    );
    expect(document.documentElement.getAttribute('aria-labelledby')).toBe(
      'region_fff region_title',
    );
  });
  test('PNG renderer produces actual colored pixels with the source SVG dimensions', async () => {
    const result = await exportArtifact(board([region]), 'png', { regionId: region.id });
    const bytes = Buffer.from(result.data, 'base64');
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(bytes.readUInt32BE(16)).toBe(32);
    expect(bytes.readUInt32BE(20)).toBe(18);
    let position = 8;
    const chunks: Buffer[] = [];
    while (position < bytes.length) {
      const length = bytes.readUInt32BE(position);
      if (bytes.toString('ascii', position + 4, position + 8) === 'IDAT') {
        chunks.push(bytes.subarray(position + 8, position + 8 + length));
      }

      position += length + 12;
    }

    const pixels = inflateSync(Buffer.concat(chunks));
    const channels = bytes[25] === 6 ? 4 : 3;
    expect(bytes[24]).toBe(8);
    expect([2, 6]).toContain(bytes[25]);
    const stride = 32 * channels;
    const decoded = Buffer.alloc(18 * stride);
    const paeth = (a: number, b: number, c: number) => {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);

      if (pa <= pb && pa <= pc) {
        return a;
      }

      return pb <= pc ? b : c;
    };

    const predictor = (filter: number, a: number, b: number, c: number) => {
      switch (filter) {
        case 1:
          return a;
        case 2:
          return b;
        case 3:
          return Math.floor((a + b) / 2);
        case 4:
          return paeth(a, b, c);
        default:
          return 0;
      }
    };

    for (let y = 0; y < 18; y++) {
      const filter = pixels[y * (stride + 1)];
      for (let x = 0; x < stride; x++) {
        const a = x >= channels ? decoded[y * stride + x - channels] : 0;
        const b = y ? decoded[(y - 1) * stride + x] : 0;
        const c = y && x >= channels ? decoded[(y - 1) * stride + x - channels] : 0;
        decoded[y * stride + x] =
          (pixels[y * (stride + 1) + x + 1] + predictor(filter, a, b, c)) & 255;
      }
    }

    const center = (9 * 32 + 16) * channels;
    expect([...decoded.subarray(center, center + 3)]).toEqual([255, 0, 0]);
    expect(result.mimeType).toBe('image/png');
    expect(result.encoding).toBe('base64');
  });
  test('rich HTML is never silently returned as an empty server PNG', async () => {
    const rich = { ...region, html: '<html><body><h1>需要浏览器排版</h1></body></html>' };
    await expect(exportArtifact(board([rich]), 'png')).rejects.toMatchObject({
      code: 'EXPORT_BROWSER_REQUIRED',
    });
    await expect(exportArtifact(board([rich]), 'png', { regionId: rich.id })).rejects.toMatchObject(
      { code: 'EXPORT_BROWSER_REQUIRED' },
    );
  });
  test('export names are portable and do not introduce paths', () => {
    expect(filenameFor('../CON <one> / 输出', 'svg')).not.toContain('/');
    expect(filenameFor('CON', 'png')).toBe('_CON.png');
    expect(filenameFor('白板', 'html')).toBe('白板.html');
  });
});
