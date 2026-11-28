import { describe, expect, it } from 'vitest';
import {
  createWhiteboardApplication,
  WhiteboardAccessError,
  type ExportBoardCommand,
  type ExportBoardResult,
} from '../../src/modules/whiteboard/application/index.js';
import type {
  ExportAssetRead,
  WhiteboardReader,
} from '../../src/modules/whiteboard/ports/index.js';
import { boardId, object, TestWhiteboardRepository, viewer } from './whiteboard-repository.js';

const allJson: ExportBoardCommand = {
  boardId,
  expectedRevision: 10n,
  scope: { kind: 'whole' },
  format: 'json',
};
const outline = {
  x: 0,
  y: 0,
  width: 100,
  height: 80,
  rotation: 0,
};
const coverSource = '/studio-archive-assets/' + boardId + '/cover';
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Efp8AAAAASUVORK5CYII=';

function fileText(result: ExportBoardResult): string {
  if (result.kind !== 'file') {
    throw new Error('Expected an exported file, received ' + JSON.stringify(result));
  }

  return new TextDecoder().decode(result.content);
}

class AssetRepository extends TestWhiteboardRepository {
  readonly assetQueries: string[] = [];

  getExportAsset(_boardId: string, id: string): ExportAssetRead | undefined {
    this.assetQueries.push(id);
    if (id !== 'cover') {
      return undefined;
    }

    return {
      kind: 'asset',
      asset: {
        mimeType: 'image/png',
        byteLength: Buffer.from(png, 'base64').byteLength,
        base64: png,
      },
    };
  }
}

describe('fixed revision board export', () => {
  it('exports a section, locked contents, and grouped descendants in saved layer order', () => {
    const section = object('section', { kind: 'section', geometry: outline });
    const member = object('member', {
      groupId: 'cards',
      geometry: { ...outline, x: 140 },
      payloadVersion: 2n,
      locked: true,
    });
    const contained = object('contained', { groupId: 'cards', locked: true });
    const child = object('child', { parentId: 'member', geometry: { ...outline, x: 240 } });
    const outside = object('outside', { geometry: { ...outline, x: 440 }, payloadVersion: 2n });
    const payload = {
      objectId: 'member',
      payloadVersion: 2n,
      bodyKind: 'text',
      data: { text: 'retained' },
    };
    const repository = new TestWhiteboardRepository(
      [outside, member, section, contained, child],
      [payload, { ...payload, objectId: 'outside', data: { text: 'excluded' } }],
    );
    const application = createWhiteboardApplication(repository);

    const file = application.exportBoard(viewer, {
      ...allJson,
      scope: { kind: 'selection', objectIds: ['section'] },
    });
    const text = fileText(file);

    expect(file).toMatchObject({
      kind: 'file',
      filename: 'Unit board.json',
      mimeType: 'application/json',
      revision: 10n,
    });
    expect(JSON.parse(text)).toMatchObject({
      board: { boardId, revision: '10' },
      objects: [member, section, contained, child].map(({ objectId }) => ({ objectId })),
      payloads: [{ objectId: 'member', data: { text: 'retained' } }],
    });
    expect(text).not.toContain('excluded');
    expect(repository.payloadQueries).toEqual([['member', 'section', 'contained', 'child']]);
    expect(repository.geometryWrites).toEqual([]);
  });

  it('reports stale revision and invalid selection without reading payloads', () => {
    const repository = new TestWhiteboardRepository([object('present')]);
    const application = createWhiteboardApplication(repository);

    expect(application.exportBoard(viewer, { ...allJson, expectedRevision: 9n })).toEqual({
      kind: 'stale',
      revision: 10n,
    });
    expect(repository.sceneReads).toBe(0);
    expect(
      application.exportBoard(viewer, {
        ...allJson,
        scope: { kind: 'selection', objectIds: ['missing'] },
      }),
    ).toEqual({ kind: 'rejected', reason: 'invalidSelection' });
    expect(repository.payloadQueries).toEqual([]);
  });

  it('exports the exact source of a grouped imported diagram without collecting assets', () => {
    const diagram = object('diagram', { kind: 'diagram', label: '阶段 / 计划', groupId: 'group' });
    const neighbor = object('neighbor', { groupId: 'group' });
    const html = `<!doctype html>\r\n<img src="${coverSource}"><p>原始图解</p>\r\n`;
    const repository = new AssetRepository(
      [diagram, neighbor],
      [{ objectId: diagram.objectId, payloadVersion: 0n, bodyKind: 'embed', data: { html } }],
    );
    const application = createWhiteboardApplication(repository);
    const command = { ...allJson, format: 'html-source' } as const;
    const result = application.exportBoard(viewer, {
      ...command,
      scope: { kind: 'selection', objectIds: [diagram.objectId] },
    });

    expect(result).toMatchObject({
      kind: 'file',
      filename: '阶段 - 计划.html',
      mimeType: 'text/html',
    });
    expect(fileText(result)).toBe(html);
    expect(repository.sceneReads).toBe(0);
    expect(repository.payloadQueries).toEqual([['diagram']]);
    expect(repository.assetQueries).toEqual([]);
    expect(
      application.exportBoard(viewer, {
        ...command,
        scope: { kind: 'selection', objectIds: [diagram.objectId, neighbor.objectId] },
      }),
    ).toEqual({ kind: 'rejected', reason: 'invalidSelection' });
    expect(
      application.exportBoard(viewer, {
        ...command,
        scope: { kind: 'selection', objectIds: [neighbor.objectId] },
      }),
    ).toEqual({ kind: 'rejected', reason: 'unsupported' });
  });

  it('composes scoped offline HTML with native tables, pictures, tasks, and formatted text', () => {
    const table = object('table', { kind: 'table', label: 'Schedule', geometry: outline });
    const doc = object('doc', {
      kind: 'document',
      label: 'Specification',
      geometry: { ...outline, x: 120, rotation: 15 },
    });
    const note = object('note', { kind: 'note', label: 'note', geometry: { ...outline, x: 240 } });
    const tasks = object('todo', {
      kind: 'todo',
      label: 'Tasks',
      geometry: { ...outline, x: 360 },
    });
    const media = object('video', {
      kind: 'video',
      label: 'Recording',
      geometry: { ...outline, x: 480 },
    });
    const outside = object('outside', {
      kind: 'text',
      label: 'Excluded',
      geometry: { ...outline, x: 600 },
    });
    const repository = new AssetRepository(
      [table, doc, note, tasks, media, outside],
      [
        {
          objectId: 'table',
          payloadVersion: 0n,
          bodyKind: 'table',
          data: {
            grid: {
              head: true,
              columnWidths: [40, 60],
              rows: [
                { cells: [{ text: 'Stage' }, { text: '**Date**' }] },
                { cells: [{ text: 'Implement' }, { number: 2026 }] },
              ],
            },
          },
        },
        {
          objectId: 'doc',
          payloadVersion: 0n,
          bodyKind: 'document',
          data: {
            blocks: [
              {
                type: 'numberedListItem',
                props: { start: 3 },
                content: 'Part three',
                children: [{ type: 'bulletListItem', content: 'Nested task' }],
              },
              { type: 'image', props: { url: coverSource, caption: 'Figure' } },
            ],
          },
        },
        {
          objectId: 'note',
          payloadVersion: 0n,
          bodyKind: 'text',
          data: {
            text: '**Important** [Guide](https://example.test/guide)',
          },
        },
        {
          objectId: 'todo',
          payloadVersion: 0n,
          bodyKind: 'todo',
          data: {
            items: [{ text: 'Review completed', checked: true }],
          },
        },
        {
          objectId: 'video',
          payloadVersion: 0n,
          bodyKind: 'video',
          data: {
            src: 'data:video/mp4;base64,AAAA',
            poster: coverSource,
          },
        },
      ],
    );
    const command = {
      ...allJson,
      format: 'html',
      scope: { kind: 'selection', objectIds: ['video', 'todo', 'note', 'doc', 'table'] },
    } as const;
    const html = fileText(createWhiteboardApplication(repository).exportBoard(viewer, command));

    expect(html).toContain('<table class="board-export-table"');
    expect(html).toContain('<col style="width:40%">');
    expect(html).toContain('<strong>Date</strong>');
    expect(html).toContain('2026</div></td>');
    expect(html).toContain('<ol start="3"><li>Part three<ul><li>Nested task</li>');
    expect(html).toContain('rotate(15deg)');
    expect(html).toContain('data:image/png;base64,' + png);
    expect(html).toContain('<strong>Important</strong>');
    expect(html).toContain('href="https://example.test/guide"');
    expect(html).toContain('type="checkbox" checked>Review completed');
    expect(html).toContain('<video controls playsinline');
    expect(html).toContain('src="data:video/mp4;base64,AAAA"');
    expect(html).not.toContain('Excluded');
    expect(html.indexOf('aria-label="Schedule"')).toBeLessThan(html.indexOf('Review completed'));
    expect(repository.assetQueries).toEqual(['cover']);
  });

  it('rejects document media that cannot be included offline', () => {
    const doc = object('doc', { kind: 'document', geometry: outline });
    const repository = new TestWhiteboardRepository(
      [doc],
      [
        {
          objectId: 'doc',
          payloadVersion: 0n,
          bodyKind: 'document',
          data: {
            blocks: [{ type: 'image', props: { url: 'https://example.test/cover.png' } }],
          },
        },
      ],
    );
    const result = createWhiteboardApplication(repository).exportBoard(viewer, {
      ...allJson,
      format: 'html',
    });

    expect(result).toEqual({ kind: 'rejected', reason: 'assetUnavailable' });
  });

  it('checks access before exposing a revision and rechecks access when delivering', () => {
    class ChangedAccessRepository extends TestWhiteboardRepository {
      override read<Value>(work: (reader: WhiteboardReader) => Value): Value {
        const result = super.read(work);
        this.access.delete(viewer.id);

        return result;
      }
    }

    const repository = new ChangedAccessRepository([object('shape')]);
    const application = createWhiteboardApplication(repository);

    expect(() => application.exportBoard({ id: 'outsider' }, allJson)).toThrow(
      WhiteboardAccessError,
    );
    expect(repository.sceneReads).toBe(0);
    expect(() => application.exportBoard(viewer, allJson)).toThrow(WhiteboardAccessError);
    expect(repository.sceneReads).toBe(1);
  });

  it('draws an independent connector using attached geometry and escapes its caption', () => {
    const hiddenShape = object('shape', {
      label: 'unselected',
      geometry: { ...outline, x: -160, y: -100 },
    });
    const connector = object('connector', {
      kind: 'connector',
      label: 'Plan <review> & share',
      detail: {
        kind: 'connector',
        start: { point: { x: 0, y: 0 }, attachment: { objectId: 'shape', port: 'right' } },
        end: { point: { x: 30, y: -60 } },
        bends: [],
      },
    });
    const repository = new TestWhiteboardRepository([hiddenShape, connector]);
    const file = createWhiteboardApplication(repository).exportBoard(viewer, {
      ...allJson,
      format: 'svg',
      scope: { kind: 'selection', objectIds: ['connector'] },
    });
    const svg = fileText(file);

    expect(svg).toContain('<path d="M -60 -60 L 30 -60"');
    expect(svg).toContain('Plan &lt;review&gt; &amp; share');
    expect(svg).toContain('viewBox="-92 -92 154 64"');
    expect(svg).not.toContain('unselected');
    expect(repository.payloadQueries).toEqual([['connector']]);

    const json = createWhiteboardApplication(repository).exportBoard(viewer, {
      ...allJson,
      scope: { kind: 'selection', objectIds: ['connector'] },
    });
    expect(JSON.parse(fileText(json))).toMatchObject({
      objects: [{ objectId: 'connector', detail: { start: { point: { x: -60, y: -60 } } } }],
    });
    expect(fileText(json)).not.toContain('"attachment"');
  });

  it('rounds the exported route and enters a rear-facing right port from its outside', () => {
    const left = object('left', { kind: 'shape', geometry: outline });
    const right = object('right', { kind: 'shape', geometry: { ...outline, x: 300 } });
    const connector = object('connector', {
      kind: 'connector',
      appearance: { strokeWidth: 4 },
      detail: {
        kind: 'connector',
        start: { point: { x: 0, y: 0 }, attachment: { objectId: 'left', port: 'right' } },
        end: { point: { x: 0, y: 0 }, attachment: { objectId: 'right', port: 'right' } },
        bends: [],
      },
    });
    const repository = new TestWhiteboardRepository([left, right, connector]);
    const svg = fileText(
      createWhiteboardApplication(repository).exportBoard(viewer, { ...allJson, format: 'svg' }),
    );
    const polyline = /<path d="(M 100 40 [^"]+ L 400 40)" fill="none" stroke-linecap="round"/u.exec(
      svg,
    )?.[1];
    expect(polyline).toContain(' Q ');
    const numbers = polyline!
      .split(/[MLQ\s]+/u)
      .filter(Boolean)
      .map(Number);
    const straightStart = numbers.at(-4)!;
    expect(straightStart).toBeGreaterThan(400);
    expect(numbers.slice(-3)).toEqual([40, 400, 40]);
    const arrow = /<path d="M 400 40 L ([\d.]+) [\d.]+ L ([\d.]+) [\d.]+ Z"/u.exec(svg);
    expect(arrow).not.toBeNull();
    expect(Number(arrow?.[1])).toBeGreaterThan(400);
    expect(Number(arrow?.[1])).toBe(Number(arrow?.[2]));
    expect(Number(arrow?.[1]) + 2).toBeLessThanOrEqual(straightStart);
  });

  it('captures only selected archived image bytes and embeds a safe SVG raster', () => {
    const image = object('image', { kind: 'image', geometry: outline, payloadVersion: 2n });
    const payload = {
      objectId: 'image',
      payloadVersion: 2n,
      bodyKind: 'image',
      data: { src: coverSource },
    };
    const repository = new AssetRepository([image], [payload]);
    const application = createWhiteboardApplication(repository);

    const svg = fileText(application.exportBoard(viewer, { ...allJson, format: 'svg' }));
    expect(svg).toContain('href="data:image/png;base64,' + png + '"');
    expect(svg).not.toContain(coverSource);
    expect(repository.assetQueries).toEqual(['cover']);
    const json = fileText(application.exportBoard(viewer, allJson));
    expect(JSON.parse(json)).toMatchObject({
      assets: [{ source: coverSource, mimeType: 'image/png', base64: png }],
    });
  });

  it('rejects missing archived assets and unsafe SVG content without returning file bytes', () => {
    const image = object('image', { kind: 'image', geometry: outline, payloadVersion: 2n });
    const payload = {
      objectId: 'image',
      payloadVersion: 2n,
      bodyKind: 'image',
      data: { src: coverSource },
    };
    const absent = createWhiteboardApplication(new TestWhiteboardRepository([image], [payload]));
    const external = createWhiteboardApplication(
      new TestWhiteboardRepository(
        [image],
        [{ ...payload, data: { src: 'https://example.invalid/cover.png' } }],
      ),
    );
    const rich = createWhiteboardApplication(
      new TestWhiteboardRepository([object('html', { kind: 'html' })]),
    );
    class ArchivedSvgRepository extends TestWhiteboardRepository {
      getExportAsset(): ExportAssetRead {
        const markup = '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>';

        return {
          kind: 'asset',
          asset: {
            mimeType: 'image/svg+xml',
            byteLength: Buffer.byteLength(markup),
            base64: Buffer.from(markup).toString('base64'),
          },
        };
      }
    }
    const unsafeAsset = createWhiteboardApplication(new ArchivedSvgRepository([image], [payload]));
    const svg = { ...allJson, format: 'svg' as const };

    expect(absent.exportBoard(viewer, svg)).toEqual({
      kind: 'rejected',
      reason: 'assetUnavailable',
    });
    expect(external.exportBoard(viewer, svg)).toEqual({ kind: 'rejected', reason: 'unsupported' });
    expect(rich.exportBoard(viewer, svg)).toEqual({ kind: 'rejected', reason: 'unsupported' });
    expect(unsafeAsset.exportBoard(viewer, svg)).toEqual({
      kind: 'rejected',
      reason: 'unsupported',
    });
  });
});
