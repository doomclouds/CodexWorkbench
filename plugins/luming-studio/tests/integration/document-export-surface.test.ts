import { afterEach, beforeEach, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { inflateSync } from 'node:zlib';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { DEFAULT_STYLE, type Board, type BoardElement } from '../../src/contracts/studio.js';
import type { DocumentContent } from '../../src/contracts/document.js';
import { exportArtifact } from '../support/rendering.js';
import { buildBoardHtml, buildBoardSvg } from '../../src/shared/serialization.js';
import { documentHtml } from '../../src/shared/document-serialization.js';
import { contrastRatio } from '../../src/shared/theme.js';
import {
  createStudioService,
  type ComposedStudioService,
} from '../../src/server/studio-composition.js';

const content: DocumentContent = {
  schemaVersion: 1,
  blocks: [
    {
      id: 'one',
      type: 'paragraph',
      props: {},
      content: [
        { type: 'text', text: 'Paper color follows the document. ', styles: {} },
        {
          type: 'text',
          text: 'Explicit pink',
          styles: { textColor: '#DB2777', backgroundColor: '#C9F0FF' },
        },
      ],
      children: [],
    },
    { id: 'last', type: 'paragraph', props: {}, content: 'Full export tail', children: [] },
  ],
};
const element = (patch: Partial<BoardElement> = {}): BoardElement => ({
  id: 'doc',
  type: 'document',
  x: 0,
  y: 0,
  w: 420,
  h: 300,
  version: 1,
  text: 'Color document',
  document: structuredClone(content),
  ...patch,
});
const board = (doc: BoardElement): Board => ({
  artifact: {
    id: 'board',
    type: 'whiteboard',
    title: 'Surface export',
    revision: 1,
    createdAt: '',
    updatedAt: '',
    pinned: false,
  },
  style: DEFAULT_STYLE,
  elements: [doc],
});
const color = (value: string) => {
  const node = new JSDOM('<p></p>').window.document.querySelector('p')!;
  node.style.color = value;

  return node.style.color;
};

const inlineColor = (node: Element, property: string) =>
  color(new RegExp(`(?:^|;)${property}:([^;]+)`).exec(node.getAttribute('style') || '')?.[1] || '');

function pngPixel(bytes: Buffer, x: number, y: number): number[] {
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const channels = bytes[25] === 6 ? 4 : 3;
  const chunks: Buffer[] = [];
  expect(bytes[24]).toBe(8);
  expect([2, 6]).toContain(bytes[25]);
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
      chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    }

    offset += length + 12;
  }

  const pixels = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const decoded = Buffer.alloc(height * stride);
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

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < stride; col++) {
      const filter = pixels[row * (stride + 1)];
      const a = col >= channels ? decoded[row * stride + col - channels]! : 0;
      const b = row ? decoded[(row - 1) * stride + col]! : 0;
      const c = row && col >= channels ? decoded[(row - 1) * stride + col - channels]! : 0;
      decoded[row * stride + col] =
        (pixels[row * (stride + 1) + col + 1]! + predictor(filter, a, b, c)) & 255;
    }
  }

  return [...decoded.subarray((y * width + x) * channels, (y * width + x) * channels + 3)];
}

it.each([undefined, '#F9E56F', '#20242C'])(
  'keeps paper %s and readable automatic ink in standalone HTML, board HTML and vector summaries',
  async (fill) => {
    const doc = element({ ...(fill ? { fill } : {}), color: 'ink' });
    const source = board(doc);
    const before = structuredClone(source);
    const expected = fill || '#EFEFEF';
    const exported = await exportArtifact(source, 'html', { regionId: doc.id });
    const page = new JSDOM(exported.data).window.document;
    const paper = page.querySelector<HTMLElement>('.studio-document')!;
    expect(inlineColor(paper, '--document-paper')).toBe(color(expected));
    expect(contrastRatio(inlineColor(paper, 'color'), expected)).toBeGreaterThanOrEqual(4.5);
    expect(page.body.textContent).toContain('Full export tail');
    const whole = new JSDOM(buildBoardHtml(source)).window.document.querySelector<HTMLElement>(
      '[data-studio-id="doc"]',
    )!;
    expect(inlineColor(whole, '--document-paper')).toBe(color(expected));
    expect(inlineColor(whole, 'color')).toBe(inlineColor(paper, 'color'));
    const svg = new JSDOM(buildBoardSvg(source), { contentType: 'image/svg+xml' }).window.document;
    const preview = svg.querySelector('[data-studio-id="doc"]')!;
    expect(
      preview.querySelector('[data-document-paper]')!.getAttribute('fill')!.toUpperCase(),
    ).toBe(expected.toUpperCase());
    expect(color(preview.querySelector('text')!.getAttribute('fill')!)).toBe(
      inlineColor(paper, 'color'),
    );
    const json = JSON.parse((await exportArtifact(source, 'json', { regionId: doc.id })).data);
    expect(json.elements[0]).toEqual(doc);
    expect(source).toEqual(before);
  },
);

it('preserves explicit document ink and inline span colors without weakening standalone CSP', async () => {
  const doc = element({ fill: '#20242C', color: '#EF8DAF' });
  const page = new JSDOM((await exportArtifact(board(doc), 'html', { regionId: doc.id })).data)
    .window.document;
  const paper = page.querySelector<HTMLElement>('.studio-document')!;
  const span = page.querySelector<HTMLSpanElement>('span')!;
  expect(inlineColor(paper, 'color')).toBe(color('#EF8DAF'));
  expect(inlineColor(span, 'color')).toBe(color('#DB2777'));
  expect(inlineColor(span, 'background-color')).toBe(color('#C9F0FF'));
  const svg = new JSDOM(buildBoardSvg(board(doc)), { contentType: 'image/svg+xml' }).window
    .document;
  expect(svg.querySelector('[data-studio-id="doc"] text')!.getAttribute('fill')).toBe('#EF8DAF');
  expect(
    page.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute('content'),
  ).toContain("default-src 'none'");
  expect(
    page.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute('content'),
  ).toContain('img-src data:');
  expect(page.querySelector('script')).toBeNull();
});

it('uses the same default paper for the existing two-argument HTML helper without writing a fill into legacy JSON', () => {
  const source = structuredClone(content);
  const page = new JSDOM(documentHtml(source, 'Legacy')).window.document;
  expect(inlineColor(page.querySelector('main')!, '--document-paper')).toBe(color('#EFEFEF'));
  expect(source).toEqual(content);
});

it.each([
  ['#F9E56F', [249, 229, 111]],
  ['#20242C', [32, 36, 44]],
] as const)('renders real board PNG paper pixels for %s', async (fill, expected) => {
  const result = await exportArtifact(board(element({ fill })), 'png', { padding: 0 });
  expect(pngPixel(Buffer.from(result.data, 'base64'), 10, 280)).toEqual(expected);
});

it.each([
  ['rgba(0,0,0,0)', [32, 36, 44]],
  ['rgba(255,255,255,0.5)', [144, 146, 150]],
] as const)(
  'keeps a real opaque backing for %s without changing its saved transparency',
  async (fill, expected) => {
    const source = board(element({ fill, color: 'ink' }));
    source.style = { ...source.style, paper: '#20242C' };
    const before = structuredClone(source);
    const page = new JSDOM((await exportArtifact(source, 'html', { regionId: 'doc' })).data).window
      .document;
    expect(page.querySelector('style')!.textContent).toMatch(/body\{[^}]*background:#20242C/);
    const paper = page.querySelector('main')!;
    expect(inlineColor(paper, 'background-color')).toBe(color('#20242C'));
    expect(paper.getAttribute('style')).toContain(
      `background-image:linear-gradient(${fill},${fill})`,
    );
    const png = await exportArtifact(source, 'png', { padding: 0 });
    const pixel = pngPixel(Buffer.from(png.data, 'base64'), 10, 280);
    pixel.forEach((channel, index) =>
      expect(Math.abs(channel - expected[index]!)).toBeLessThanOrEqual(1),
    );
    expect(JSON.parse((await exportArtifact(source, 'json')).data).elements[0].fill).toBe(fill);
    expect(source).toEqual(before);
  },
);

let folder = '';
let service: ComposedStudioService | undefined;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'studio-document-surface-export-'));
  service = createStudioService({ dataRoot: folder });
});
afterEach(async () => {
  await service?.close();
  if (!resolve(folder).startsWith(resolve(tmpdir()) + sep)) {
    throw new Error('Unexpected export fixture directory');
  }

  await rm(folder, { recursive: true, force: true });
});

it('reads an old saved document without fill using the default surface and does not migrate content or revision during export', async () => {
  const created = await service!.execute('artifact_manage', {
    action: 'create',
    elements: [element()],
  });
  const artifactId = created.artifact.id;
  const before = (await service!.execute('artifact_read', { artifactId })) as Board;
  expect(before.elements[0]!.fill).toBeUndefined();
  const result = await service!.execute('artifact_export', {
    artifactId,
    format: 'html',
    regionId: 'doc',
  });
  const html = Buffer.from((await service!.getExport(result.exportId)).data).toString('utf8');
  expect(
    inlineColor(new JSDOM(html).window.document.querySelector('main')!, '--document-paper'),
  ).toBe(color('#EFEFEF'));
  const reopened = createStudioService({ dataRoot: folder });
  try {
    expect(await reopened.execute('artifact_read', { artifactId })).toEqual(before);
  } finally {
    await reopened.close();
  }
});

it('persists explicit paper through reopening and historical exports while still embedding document images', async () => {
  const doc = element({ fill: '#F9E56F' });
  const created = await service!.execute('artifact_manage', { action: 'create', elements: [doc] });
  const artifactId = created.artifact.id;
  await service!.execute('artifact_apply', {
    artifactId,
    expectedVersions: { doc: 1 },
    operations: [{ op: 'update', id: 'doc', changes: { fill: '#20242C' } }],
  });
  const reopened = createStudioService({ dataRoot: folder });
  try {
    const current = (await reopened.execute('artifact_read', { artifactId })) as Board;
    expect(current.elements[0]!.fill).toBe('#20242C');
    expect(
      inlineColor(
        new JSDOM(
          (await exportArtifact(current, 'html', { regionId: 'doc' })).data,
        ).window.document.querySelector('main')!,
        '--document-paper',
      ),
    ).toBe(color('#20242C'));
    const history = await reopened.execute('artifact_read', { artifactId, mode: 'history' });
    const original = (
      await reopened.execute('artifact_read', {
        artifactId,
        mode: 'version',
        versionId: history.history[0].id,
      })
    ).board as Board;
    expect(original.elements[0]!.fill).toBe('#F9E56F');
    expect(
      inlineColor(
        new JSDOM(
          (await exportArtifact(original, 'html', { regionId: 'doc' })).data,
        ).window.document.querySelector('main')!,
        '--document-paper',
      ),
    ).toBe(color('#F9E56F'));
    const image = await reopened.putAsset(
      artifactId,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
        'base64',
      ),
      { filename: 'pixel.png', mimeType: 'image/png' },
      reopened.owner,
    );
    await reopened.execute('artifact_apply', {
      artifactId,
      expectedVersions: { doc: 2 },
      operations: [
        {
          op: 'document',
          id: 'doc',
          data: {
            operations: [
              { op: 'insert', block: { id: 'picture', type: 'image', props: { url: image.url } } },
            ],
          },
        },
      ],
    });
    const result = await reopened.execute('artifact_export', {
      artifactId,
      format: 'html',
      regionId: 'doc',
    });
    const html = Buffer.from((await reopened.getExport(result.exportId)).data).toString('utf8');
    expect(html).toContain('data:image/png;base64,');
    expect(html).not.toContain(image.url);
    expect(html).toContain('Full export tail');
  } finally {
    await reopened.close();
  }
});
