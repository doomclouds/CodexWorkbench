import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { DEFAULT_STYLE, type Board, type BoardElement } from '../src/contracts/studio.js';
import { buildBoardHtml, buildBoardSvg } from '../src/core/serialization.js';
import { exportArtifact } from '../src/core/export.js';
import { whiteboardProduct } from '../src/core/products/whiteboard.js';

interface OfflineEmbed {
  load(): Record<string, unknown>;
  save(value: unknown): void;
  onLoad(listener: (state: unknown) => void): () => void;
}

const picture =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>',
  ).toString('base64');
const video = 'data:video/mp4;base64,U1lOVEhFVElDX1RFU1RfTUVESUE=';
const widget =
  '<!doctype html><html lang="en"><head><title>Counter</title></head><body><button id="step">Step</button><script>window.initialState=studioEmbed.load();document.getElementById("step").onclick=()=>studioEmbed.save({...studioEmbed.load(),count:studioEmbed.load().count+1});</script></body></html>';
const element = (patch: Partial<BoardElement>): BoardElement => ({
  id: 'unit',
  type: 'text',
  x: 0,
  y: 0,
  w: 100,
  h: 80,
  version: 1,
  ...patch,
});

function board(elements: BoardElement[]): Board {
  return {
    artifact: {
      id: 'export-fixture',
      type: 'whiteboard',
      title: 'Offline board',
      revision: 2,
      createdAt: '2026-11-15T00:00:00Z',
      updatedAt: '2026-11-15T00:00:00Z',
      pinned: false,
    },
    elements,
    style: DEFAULT_STYLE,
  };
}

const snapshot = (value: Board) => {
  const { artifact, ...content } = value;

  return { artifact, content };
};

function firstFrame(html: string): string {
  return new JSDOM(html).window.document.querySelector('iframe')!.getAttribute('srcdoc')!;
}

describe('offline whole-board HTML exports', () => {
  it('loads saved state before source scripts, isolates values and saves only in page memory', () => {
    const source = board([
      element({
        id: 'counter',
        type: 'html',
        html: widget,
        state: { count: 7, text: '</script><script>window.injected=true</script>' },
      }),
    ]);
    const exported = new JSDOM(firstFrame(buildBoardHtml(source)), { runScripts: 'dangerously' });
    const win = exported.window as typeof exported.window & {
      studioEmbed: OfflineEmbed;
      initialState: Record<string, unknown>;
      injected?: boolean;
    };
    expect(win.document.compatMode).toBe('CSS1Compat');
    expect(win.document.documentElement.lang).toBe('en');
    expect(win.initialState).toMatchObject({
      count: 7,
      text: '</script><script>window.injected=true</script>',
    });
    expect(win.injected).toBeUndefined();
    const copy = win.studioEmbed.load();
    copy.count = 100;
    expect(win.studioEmbed.load().count).toBe(7);
    const loaded = vi.fn();
    const stop = win.studioEmbed.onLoad(loaded);
    const messages = vi.spyOn(win.parent, 'postMessage');
    win.document.getElementById('step')!.click();
    expect(win.studioEmbed.load().count).toBe(8);
    expect(loaded).toHaveBeenCalledWith(expect.objectContaining({ count: 8 }));
    stop();
    win.studioEmbed.save({ count: 9 });
    expect(loaded).toHaveBeenCalledTimes(1);
    expect(messages).not.toHaveBeenCalled();
    expect(source.elements[0]!.state).toMatchObject({ count: 7 });
    const reopened = new JSDOM(firstFrame(buildBoardHtml(source)), { runScripts: 'dangerously' });
    expect((reopened.window as any).studioEmbed.load().count).toBe(7);
    reopened.window.close();
    win.close();
  });
  it('keeps invalid saves observable without losing the last valid offline state', () => {
    const page = new JSDOM(
      firstFrame(
        buildBoardHtml(
          board([element({ type: 'html', html: '<p>Widget</p>', state: { count: 3 } })]),
        ),
      ),
      { runScripts: 'dangerously' },
    );
    const api = (page.window as any).studioEmbed;
    const errors: unknown[] = [];
    page.window.addEventListener('studio-embed-error', (event) =>
      errors.push((event as CustomEvent).detail),
    );
    expect(api).toBeDefined();
    api.save([]);
    api.save({ text: 'x'.repeat(65537) });
    const cycle: any = {};
    cycle.self = cycle;
    api.save(cycle);
    expect(errors).toHaveLength(3);
    expect(api.load()).toEqual({ count: 3 });
    page.window.close();
  });
  it('renders native inline video in the HTML layer while keeping vector exports as posters', () => {
    const source = board([
      element({
        id: 'movie',
        type: 'image',
        x: -20,
        y: 50,
        w: 320,
        h: 180,
        rotation: 15,
        src: picture,
        video,
      }),
    ]);
    const document = new JSDOM(buildBoardHtml(source)).window.document;
    const player = document.querySelector('video')!;
    expect(player).not.toBeNull();
    expect(player.getAttribute('src')).toBe(video);
    expect(player.getAttribute('poster')).toBe(picture);
    expect(player.hasAttribute('controls')).toBe(true);
    expect(player.hasAttribute('playsinline')).toBe(true);
    expect(
      document.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute('content'),
    ).toContain('media-src data: blob:');
    expect(
      document.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute('content'),
    ).toContain("connect-src 'none'");
    const svg = buildBoardSvg(source);
    expect(svg).toContain('<image');
    expect(svg).not.toContain('<video');
    expect(svg).not.toContain(video);
  });
  it('leaves explicit single-region HTML as canonical source without the offline runner', async () => {
    const source = board([
      element({ id: 'counter', type: 'html', html: widget, state: { count: 7 } }),
    ]);
    expect((await exportArtifact(source, 'html', { regionId: 'counter' })).data).toBe(widget);
  });
  it('uses the same offline-state and raw-source contracts for legacy diagram HTML regions', async () => {
    const source = board([
      element({ id: 'legacy', type: 'diagram', html: widget, state: { count: 11 } }),
    ]);
    const page = new JSDOM(firstFrame(buildBoardHtml(source)), { runScripts: 'dangerously' });
    expect((page.window as any).studioEmbed.load().count).toBe(11);
    page.window.close();
    expect((await exportArtifact(source, 'html', { regionId: 'legacy' })).data).toBe(widget);
  });
});

describe('scoped resource resolution', () => {
  it('resolves only selected elements while retaining full scene geometry for a lone arrow', async () => {
    const source = board([
      element({ id: 'left', type: 'shape', x: 0 }),
      element({ id: 'right', type: 'shape', x: 200 }),
      element({ id: 'edge', type: 'arrow', from: 'left', to: 'right' }),
      element({ id: 'excluded', type: 'image', src: '/assets/export-fixture/missing' }),
    ]);
    const read = vi.fn(async () => {
      throw Error('Excluded resource must not be read');
    });
    const exported = await whiteboardProduct.export(
      snapshot(source),
      'html',
      { ids: ['edge'] },
      { assetDataUri: read },
    );
    expect(read).not.toHaveBeenCalled();
    const document = new JSDOM(exported.data).window.document;
    expect(document.querySelector('[data-studio-id="edge"] path')).not.toBeNull();
    expect(document.querySelector('[data-studio-id="left"]')).toBeNull();
    expect(document.querySelector('[data-studio-id="excluded"]')).toBeNull();
  });
  it('inlines selected HTML image, media and CSS assets without touching its excluded neighbor', async () => {
    const html =
      '<!doctype html><img src="/assets/export-fixture/picture"><video src="/assets/export-fixture/video" poster="/assets/export-fixture/poster"></video><style>body{background-image:url( /assets/export-fixture/background )}</style>';
    const source = board([
      element({ id: 'html', type: 'html', html, state: { selected: true } }),
      element({ id: 'excluded', type: 'image', src: '/assets/export-fixture/missing' }),
    ]);
    const requested: string[] = [];
    const read = async (reference: string) => {
      requested.push(reference);
      if (reference.endsWith('/missing')) {
        throw Error('Excluded');
      }

      return reference.endsWith('/video') ? video : picture;
    };

    const exported = await whiteboardProduct.export(
      snapshot(source),
      'html',
      { ids: ['html'] },
      { assetDataUri: read },
    );
    const srcdoc = firstFrame(exported.data);
    expect(srcdoc).not.toContain('/assets/');
    expect(srcdoc).toContain(picture);
    expect(srcdoc).toContain(video);
    expect(requested).toHaveLength(4);
    expect(requested).toContain('/assets/export-fixture/background');
    expect(source.elements[0]!.html).toBe(html);
  });
  it('does not load native video bytes for SVG and never hides a selected resource failure', async () => {
    const source = board([
      element({
        id: 'movie',
        type: 'image',
        src: '/assets/export-fixture/poster',
        video: '/assets/export-fixture/video',
      }),
    ]);
    const requested: string[] = [];
    const exported = await whiteboardProduct.export(
      snapshot(source),
      'svg',
      {},
      {
        async assetDataUri(reference) {
          requested.push(reference);
          if (reference.endsWith('/video')) {
            throw Error('Unused video');
          }

          return picture;
        },
      },
    );
    expect(requested).toEqual(['/assets/export-fixture/poster']);
    expect(exported.data).toContain(picture);
    await expect(
      whiteboardProduct.export(
        snapshot(source),
        'html',
        {},
        {
          async assetDataUri() {
            throw Object.assign(Error('Asset missing'), { code: 'ASSET_UNAVAILABLE' });
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'ASSET_UNAVAILABLE' });
  });
});
