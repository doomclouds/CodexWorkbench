import { deflateSync, inflateSync } from 'node:zlib';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import type { Actor, Board, BoardElement, ToolResponse } from '../src/contracts/studio.js';
import { captureSavedRegion } from '../src/core/products/scoped-capture.js';
import { buildBoardHtml, buildBoardSvg } from '../src/core/serialization.js';
import { StudioService } from '../src/core/service.js';
import { LIGHT_THEME } from '../src/core/theme.js';
import { createStudioServer } from '../src/server/protocol.js';

function board(elements: BoardElement[]): Board {
  return {
    artifact: {
      id: 'board-capture',
      title: '局部取图',
      type: 'whiteboard',
      revision: 7,
      pinned: false,
      createdAt: '',
      updatedAt: '',
    },
    elements,
    style: { ...LIGHT_THEME },
  };
}

const shape: BoardElement = {
  id: 'shape-one',
  type: 'shape',
  kind: 'rect',
  version: 3,
  x: -420,
  y: -120,
  w: 180,
  h: 160,
  fill: '#FF0000',
};
const local = () => vi.fn(async (src: string) => src);

function chunks(png: Buffer) {
  const result: { type: string; data: Buffer }[] = [];
  for (let offset = 8; offset + 12 <= png.length;) {
    const length = png.readUInt32BE(offset);
    result.push({
      type: png.toString('ascii', offset + 4, offset + 8),
      data: png.subarray(offset + 8, offset + 8 + length),
    });
    offset += 12 + length;
  }

  return result;
}

function encodedChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  let crc = -1;
  for (const byte of chunk.subarray(4, data.length + 8)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }

  chunk.writeUInt32BE((crc ^ -1) >>> 0, data.length + 8);

  return chunk;
}

function noisyPng(size: number): string {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  let state = 0xaabbccdd;
  for (let y = 0; y < size; y++) {
    const line = y * (size * 3 + 1) + 1;
    for (let x = 0; x < size * 3; x++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      raw[line + x] = state & 0xff;
    }
  }

  const png = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    encodedChunk('IHDR', header),
    encodedChunk('IDAT', deflateSync(raw, { level: 0 })),
    encodedChunk('IEND', Buffer.alloc(0)),
  ]);

  return `data:image/png;base64,${png.toString('base64')}`;
}

describe('saved scoped PNG', () => {
  it('crops exact world coordinates, keeps the revision, and only sees objects in the crop', async () => {
    const offside: BoardElement = {
      ...shape,
      id: 'offside',
      type: 'image',
      src: 'https://example.invalid/media.png',
      x: 50,
      y: -80,
    };
    const resolve = local();
    const rect = { x: -360, y: -80, w: 60, h: 40 };
    const capture = await captureSavedRegion(board([shape, offside]), { rect }, resolve);

    expect(capture).toMatchObject({
      source: 'saved-render',
      artifactId: 'board-capture',
      revision: 7,
      bounds: rect,
      width: 60,
      height: 40,
      ids: ['shape-one'],
      encoding: 'base64',
      mimeType: 'image/png',
    });
    const png = Buffer.from(capture.data, 'base64');
    const blocks = chunks(png);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBe(60);
    expect(png.readUInt32BE(20)).toBe(40);
    expect([
      ...inflateSync(
        Buffer.concat(blocks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data)),
      ).subarray(1, 4),
    ]).toEqual([255, 0, 0]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('bounds native pixels and keeps connector geometry from the saved scene for selected IDs', async () => {
    const left: BoardElement = { ...shape, x: 0, y: 0 };
    const right: BoardElement = { ...shape, id: 'far-node', x: 4000, y: 2600 };
    const arrow: BoardElement = {
      ...shape,
      id: 'edge',
      type: 'arrow',
      from: left.id,
      to: right.id,
      label: '连接到版本',
    };
    const result = await captureSavedRegion(
      board([left, right, arrow]),
      { ids: [arrow.id] },
      local(),
    );
    expect(result.ids).toEqual([arrow.id]);
    expect(result.bounds.w).toBeGreaterThan(3000);
    expect(result.bounds.h).toBeGreaterThan(2000);
    expect(result.width * result.height).toBeLessThanOrEqual(1_000_000);
    expect(Buffer.from(result.data, 'base64').length).toBeLessThanOrEqual(1024 * 1024);
  });

  it('resolves a selected local picture once and ignores links while rendering ink', async () => {
    const source = '/assets/board-capture/asset-alpha';
    const resolve = vi.fn(async () => noisyPng(8));
    const images: BoardElement[] = [
      { ...shape, type: 'image', src: source, href: 'https://example.com/detail' },
      { ...shape, id: 'image-two', type: 'image', x: -240, src: source },
      {
        ...shape,
        id: 'rich-text',
        type: 'text',
        x: -60,
        text: '[参见说明](https://example.com/spec)',
      },
    ];
    const result = await captureSavedRegion(
      board(images),
      { ids: images.map((element) => element.id) },
      resolve,
    );
    expect(result.ids).toEqual(images.map((element) => element.id));
    expect(resolve).toHaveBeenCalledExactlyOnceWith(source);
  });

  it('downsizes a real noisy PNG when the bytes would exceed one MiB', async () => {
    const image: BoardElement = {
      ...shape,
      type: 'image',
      x: 0,
      y: 0,
      w: 768,
      h: 768,
      src: noisyPng(768),
    };
    const capture = await captureSavedRegion(
      board([image]),
      { rect: { x: 0, y: 0, w: 768, h: 768 } },
      local(),
    );
    expect(capture.width).toBeLessThan(768);
    expect(capture.width * capture.height).toBeLessThanOrEqual(240_000);
    expect(Buffer.from(capture.data, 'base64').length).toBeLessThanOrEqual(1024 * 1024);
  });

  it('rejects ambiguous, empty, oversized, and unavailable capture scopes', async () => {
    const resolve = local();
    const source = board([shape]);
    const rect = { x: -400, y: -100, w: 80, h: 60 };
    await expect(captureSavedRegion(source, {} as never, resolve)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await expect(
      captureSavedRegion(source, { rect, ids: [shape.id] } as never, resolve),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(captureSavedRegion(source, { ids: [] }, resolve)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await expect(captureSavedRegion(source, { ids: ['missing'] }, resolve)).rejects.toMatchObject({
      code: 'ELEMENT_NOT_FOUND',
    });
    await expect(
      captureSavedRegion(source, { rect: { ...rect, x: -3000 } }, resolve),
    ).rejects.toMatchObject({ code: 'EMPTY_CAPTURE' });
    await expect(
      captureSavedRegion(source, { rect: { ...rect, w: -1 } }, resolve),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const crowded = board(
      Array.from({ length: 21 }, (_, index) => ({ ...shape, id: `shape-${index}` })),
    );
    await expect(captureSavedRegion(crowded, { rect }, resolve)).rejects.toMatchObject({
      code: 'CAPTURE_TOO_MANY_ELEMENTS',
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('sends rich HTML to the browser path and never fetches external or different-board sources', async () => {
    const resolve = local();
    const options = { ids: [shape.id] };
    const rich = board([
      { ...shape, type: 'html', html: '<p>真实排版像素</p><svg><text>局部</text></svg>' },
    ]);
    await expect(captureSavedRegion(rich, options, resolve)).rejects.toMatchObject({
      code: 'EXPORT_BROWSER_REQUIRED',
    });

    for (const src of ['https://example.invalid/image.png', '/assets/another-board/picture']) {
      await expect(
        captureSavedRegion(board([{ ...shape, type: 'image', src }]), options, resolve),
      ).rejects.toMatchObject({ code: 'ASSET_NOT_EMBEDDED' });
    }

    expect(resolve).not.toHaveBeenCalled();
  });

  it('exports native Todo rows and source identities in SVG and scrollable read-only HTML', () => {
    const items = [
      {
        id: 'item-a',
        text: '验证 <读取> & 上限',
        checked: true,
        sourceRef: { elementId: 'doc-one', blockId: 'block-one', version: 3 },
      },
      { id: 'item-b', text: '确认回溯', checked: false },
    ];
    const source = board([
      { ...shape, type: 'todo', text: '发布验收', w: 280, h: 96, data: { items } },
    ]);
    const svg = new JSDOM(buildBoardSvg(source), { contentType: 'image/svg+xml' });
    const html = new JSDOM(buildBoardHtml(source));
    try {
      const svgRows = [...svg.window.document.querySelectorAll('[data-studio-task-id]')];
      const htmlRows = [...html.window.document.querySelectorAll('[data-studio-task-id]')];
      for (const rows of [svgRows, htmlRows]) {
        expect(rows.map((node) => node.getAttribute('data-studio-task-id'))).toEqual([
          'item-a',
          'item-b',
        ]);
        expect(JSON.parse(rows[0]!.getAttribute('data-source-ref')!)).toEqual(items[0]!.sourceRef);
        expect(rows.every((node, index) => node.textContent?.includes(items[index]!.text))).toBe(
          true,
        );
      }

      expect(
        svg.window.document
          .querySelector('[data-studio-task-id="item-a"]')
          ?.getAttribute('data-checked'),
      ).toBe('true');
      expect(
        html.window.document.querySelectorAll('input[type="checkbox"]:disabled:checked'),
      ).toHaveLength(1);
      expect(html.window.document.querySelector('section header')?.textContent).toContain(
        '1/2 完成',
      );
    } finally {
      svg.window.close();
      html.window.close();
    }
  });

  it('renders the requested historical revision and persists the exact MCP PNG bytes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studio-mcp-scoped-png-'));
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) {
      throw new Error('Unexpected test directory');
    }

    const service = new StudioService({ dataRoot: directory });
    const actor: Actor = { id: 'render-agent', name: 'Agent', kind: 'agent', role: 'owner' };
    const server = createStudioServer(
      {
        execute: (name, args) => service.execute(name, args, actor),
        connection: async () => ({ baseUrl: 'http://127.0.0.1:12345', token: 'test', actor }),
      },
      '<!doctype html>',
    );
    const client = new Client({ name: 'scoped-png', version: '1.0.0' });
    try {
      const { artifact } = await service.execute('artifact_manage', {
        action: 'create',
        title: '有界截图',
      });
      const { version: _version, ...element } = shape;
      await service.execute('artifact_apply', {
        artifactId: artifact.id,
        expectedRevision: 0,
        operations: [{ op: 'add', element }],
      });
      await service.execute('artifact_apply', {
        artifactId: artifact.id,
        expectedRevision: 1,
        operations: [{ op: 'update', id: element.id, changes: { fill: '#0080FF' } }],
      });

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const rect = { x: -360, y: -80, w: 60, h: 40 };
      const args = { artifactId: artifact.id, format: 'png', rect };
      const callExport = async (options: Record<string, unknown> = {}) =>
        CallToolResultSchema.parse(
          await client.callTool({ name: 'artifact_export', arguments: { ...args, ...options } }),
        );
      const result = await callExport({ atRevision: 1 });
      const response = result.structuredContent as unknown as ToolResponse<{
        exportId: string;
        revision: number;
      }>;
      expect(response).toMatchObject({
        ok: true,
        data: {
          source: 'saved-render',
          revision: 1,
          bounds: rect,
          width: 60,
          height: 40,
          ids: [shape.id],
        },
      });
      expect(response.data).not.toHaveProperty('image');
      expect(result._meta).toBeUndefined();
      expect(result.content).toHaveLength(1);
      const image = result.content[0];
      if (image?.type !== 'image') {
        throw new Error('Expected PNG image content');
      }

      expect(image.mimeType).toBe('image/png');
      const persisted = await service.getExport(response.data!.exportId);
      expect(Buffer.from(persisted.data)).toEqual(Buffer.from(image.data, 'base64'));

      const current = await callExport();
      expect(current.structuredContent).toMatchObject({ ok: true, data: { revision: 2 } });
      expect(current.content[0]).not.toEqual(image);
      const unavailable = await callExport({ atRevision: 25 });
      expect(unavailable.structuredContent).toMatchObject({
        ok: false,
        error: { code: 'VERSION_NOT_FOUND' },
      });
      expect(unavailable.content.some((block) => block.type === 'image')).toBe(false);
    } finally {
      await client.close();
      await server.close();
      await service.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
