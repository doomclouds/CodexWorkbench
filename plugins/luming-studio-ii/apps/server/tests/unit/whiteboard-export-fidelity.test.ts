import { expect, test } from 'vitest';
import { createWhiteboardApplication } from '../../src/modules/whiteboard/application/index.js';
import type { JsonObject, PayloadRecord } from '../../src/modules/whiteboard/domain/index.js';
import type { ExportAssetRead } from '../../src/modules/whiteboard/ports/index.js';
import { boardId, object, TestWhiteboardRepository, viewer } from './whiteboard-repository.js';

const assetPath = '/studio-archive-assets/' + boardId + '/';
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0aDjAwMDAxAAGUAoAHFQBhrzYfPQAAAAASUVORK5CYII=';
const exportBoard = {
  boardId,
  expectedRevision: 10n,
  scope: { kind: 'whole' },
} as const;

class AssetRepository extends TestWhiteboardRepository {
  readonly reads: string[] = [];

  getExportAsset(_board: string, asset: string): ExportAssetRead | undefined {
    this.reads.push(asset);
    if (asset === 'video' || asset === 'photo') {
      const mimeType = asset === 'video' ? 'video/webm' : 'image/png';
      const base64 = asset === 'video' ? 'AA==' : png;

      return {
        kind: 'asset',
        asset: { mimeType, base64, byteLength: Buffer.from(base64, 'base64').length },
      };
    }
  }
}

function payload(objectId: string, bodyKind: string, data: JsonObject): PayloadRecord {
  return { objectId, bodyKind, data, payloadVersion: 1n };
}

test('lays out the complete saved document and table and prepares posterless local video for the browser', async () => {
  const layers = [
    payload('document', 'document', {
      blocks: [
        {
          type: 'heading',
          props: { level: 2 },
          content: [{ type: 'text', text: 'Rich heading', styles: { bold: true } }],
        },
        { type: 'image', props: { url: assetPath + 'photo', caption: 'Archived photo' } },
      ],
    }),
    payload('table', 'table', {
      grid: {
        head: true,
        columnWidths: [80, 40],
        rows: [{ cells: [{ text: 'Heading' }, { boolValue: false }] }],
      },
    }),
    payload('video', 'video', { src: assetPath + 'video' }),
  ];
  const objects = layers.map(({ objectId, bodyKind }) =>
    object(objectId, { kind: bodyKind, payloadVersion: 1n }),
  );
  const repository = new AssetRepository(objects, layers);
  const application = createWhiteboardApplication(repository);

  for (const format of ['svg', 'png'] as const) {
    const result = await application.exportBoardFile(viewer, { ...exportBoard, format });
    expect(result.kind).toBe('browserPng');
    if (result.kind !== 'browserPng') {
      throw new Error('Expected saved browser layout data.');
    }

    expect(result.filename).toBe('Unit board.' + format);
    expect(result.svgTemplate.match(/<foreignObject /gu)).toHaveLength(3);
    const [document, table, video] = result.regions;
    expect(document?.html).toContain('<h2><strong>Rich heading</strong></h2>');
    expect(document?.html).toContain('data:image/png;base64,' + png);
    expect(document?.html).toContain('Archived photo');
    expect(table?.html).toMatch(/<th>.*?Heading.*?<\/th><th>.*?false.*?<\/th>/su);
    expect(table?.html).toContain('table-layout:fixed');
    expect(video?.html).toContain(
      '<video data-studio-export-video src="data:video/webm;base64,AA=="',
    );
    expect(result.regions.every(({ scripted }) => scripted === undefined)).toBe(true);
  }

  expect(repository.reads).toEqual(['photo', 'video', 'photo', 'video']);
});

test('keeps sticker graphics, link details and image framing in the vector layers', () => {
  const address = 'https://example.test/a-very-long-link?x=1&y=2';
  const layers = [
    payload('sticker', 'sticker', { stickerId: 'heart' }),
    payload('link', 'link', { href: address }),
    payload('image', 'image', {
      src: assetPath + 'photo',
      naturalSize: { width: 2, height: 3 },
      crop: { x: 0.25, y: 0.5, zoom: 2 },
    }),
    payload('video', 'video', { src: assetPath + 'video', poster: assetPath + 'photo' }),
  ];
  const objects = layers.map(({ objectId, bodyKind }) =>
    object(objectId, { kind: bodyKind, payloadVersion: 1n }),
  );
  const repository = new AssetRepository(objects, layers);
  const result = createWhiteboardApplication(repository).exportBoard(viewer, {
    ...exportBoard,
    format: 'svg',
  });
  expect(result.kind).toBe('file');
  if (result.kind !== 'file') {
    throw new Error('Expected native vector layers.');
  }

  const svg = new TextDecoder().decode(result.content);
  expect(svg).toContain('viewBox="0 0 24 24"');
  expect(svg).toContain('fill="#e87970"');
  expect(svg).toContain('<title>https://example.test/a-very-long-link?x=1&amp;y=2</title>');
  expect(svg.match(/href="data:image\/png;base64,/gu)).toHaveLength(2);
  expect(svg).toContain('preserveAspectRatio="none"');
  expect(svg).toContain('clip-path="url(#board-object-2)"');
  expect(repository.reads).toEqual(['photo']);
});

test('uses the saved inline text styles for SVG labels and Todo rows', () => {
  const layers = [
    payload('shape', 'text', { text: '**Review** and *repair*' }),
    payload('note', 'text', { text: '- [Spec](https://example.test/spec) then `go`' }),
    payload('todo', 'todo', { items: [{ itemId: 'review', text: '**Check** result' }] }),
  ];
  const objects = layers.map(({ objectId }) =>
    object(objectId, {
      kind: objectId,
      geometry: { x: 0, y: 0, width: 280, height: 120, rotation: 0 },
      payloadVersion: 1n,
    }),
  );
  const result = createWhiteboardApplication(
    new TestWhiteboardRepository(objects, layers),
  ).exportBoard(viewer, { ...exportBoard, format: 'svg' });

  if (result.kind !== 'file') {
    throw new Error('Expected styled SVG text.');
  }

  const svg = new TextDecoder().decode(result.content);
  expect(svg).toContain('<tspan font-weight="700">Review</tspan>');
  expect(svg).toContain('<tspan font-style="italic">repair</tspan>');
  expect(svg).toContain('• <tspan fill="#385f9d" text-decoration="underline">Spec</tspan>');
  expect(svg).toContain('<tspan font-family="monospace">go</tspan>');
  expect(svg).toContain('<tspan font-weight="700">Check</tspan> result');
  expect(svg).not.toContain('**Review**');
});
