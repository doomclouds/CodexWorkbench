import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_STYLE, type Board } from '../src/contracts/studio.js';
import { downloadBoard } from '../src/app/export.js';

function board(): Board {
  return {
    artifact: {
      id: 'browser-export',
      type: 'whiteboard',
      title: 'Browser export',
      revision: 2,
      createdAt: '2026-11-15T00:00:00Z',
      updatedAt: '2026-11-15T00:00:00Z',
      pinned: false,
    },
    style: DEFAULT_STYLE,
    elements: [
      {
        id: 'html',
        type: 'html',
        x: 0,
        y: 0,
        w: 200,
        h: 100,
        version: 1,
        html: '<!doctype html><img src="/assets/browser-export/image"><style>body{background-image:url(/assets/browser-export/background)}</style>',
        state: { count: 4 },
      },
      {
        id: 'video',
        type: 'image',
        x: 0,
        y: 100,
        w: 200,
        h: 100,
        version: 1,
        src: '/assets/browser-export/poster',
        video: '/assets/browser-export/movie',
      },
      {
        id: 'excluded',
        type: 'image',
        x: 1000,
        y: 0,
        w: 100,
        h: 100,
        version: 1,
        src: '/assets/browser-export/missing',
      },
    ],
  };
}

const request = vi.fn(
  async (input: URL) =>
    ({
      ok: true,
      blob: async () =>
        new Blob(['synthetic asset'], {
          type: input.pathname.endsWith('/movie') ? 'video/mp4' : 'image/png',
        }),
    }) as Response,
);

async function saveText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(blob);
  });
}

describe('HTML browser export resource parity', () => {
  it('embeds only selected HTML and native video resources before saving an offline page', async () => {
    request.mockClear();
    const source = board();
    let result = '';
    await downloadBoard(
      source,
      'html',
      { ids: ['html', 'video'], baseUrl: 'http://local.test', request },
      async (blob) => {
        result = await saveText(blob);
      },
    );
    expect(request.mock.calls.map(([url]) => url.pathname)).toEqual(
      expect.arrayContaining([
        '/assets/browser-export/image',
        '/assets/browser-export/background',
        '/assets/browser-export/poster',
        '/assets/browser-export/movie',
      ]),
    );
    expect(request.mock.calls.some(([url]) => url.pathname.endsWith('/missing'))).toBe(false);
    const document = new DOMParser().parseFromString(result, 'text/html');
    const frame = document.querySelector('iframe')!;
    expect(frame.getAttribute('srcdoc')).not.toContain('/assets/');
    expect(frame.getAttribute('srcdoc')).toContain('studioEmbed');
    expect(document.querySelector('video')!.getAttribute('src')).toMatch(
      /^data:video\/mp4;base64,/,
    );
    expect(source.elements[0]!.html).toContain('/assets/browser-export/image');
  });
  it.each(['html', 'diagram'] as const)(
    'keeps the single-region %s source contract but closes its local resource references too',
    async (type) => {
      request.mockClear();
      let result = '';
      const source = board();
      source.elements[0]!.type = type;
      await downloadBoard(
        source,
        'html',
        { regionId: 'html', baseUrl: 'http://local.test', request },
        async (blob) => {
          result = await saveText(blob);
        },
      );
      expect(result).not.toContain('/assets/');
      expect(result).not.toContain('studioEmbed');
      expect(result).toContain('data:image/png;base64,');
      expect(request.mock.calls).toHaveLength(2);
    },
  );
  it('does not save a partial page after a selected asset request fails', async () => {
    const save = vi.fn();
    await expect(
      downloadBoard(
        board(),
        'html',
        {
          ids: ['html'],
          baseUrl: 'http://local.test',
          request: async () => ({ ok: false }) as Response,
        },
        save,
      ),
    ).rejects.toMatchObject({ code: 'ASSET_UNAVAILABLE' });
    expect(save).not.toHaveBeenCalled();
  });
});
