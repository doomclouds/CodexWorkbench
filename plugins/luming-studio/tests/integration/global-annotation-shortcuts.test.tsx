import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createStudioService,
  type ComposedStudioService,
} from '../../src/server/studio-composition.js';
import { DARK_THEME } from '../../src/shared/theme';
import {
  LOCAL_ACTOR,
  type Actor,
  type Board,
  type StudioClient,
  type ToolName,
} from '../../src/contracts/studio';
import { createAppMock } from '../fixtures/app-mock.js';

let host: HTMLDivElement;
let appMock: ReturnType<typeof createAppMock>;
let service: ComposedStudioService;
let folder: string;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 0),
  );
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  folder = await mkdtemp(join(tmpdir(), 'studio-global-annotation-'));
  service = createStudioService({ dataRoot: folder });
  appMock = createAppMock();
  host = appMock.container;
});
afterEach(async () => {
  await appMock.dispose();
  await service.close();
  await rm(folder, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(actor: Actor = LOCAL_ACTOR) {
  const fixture = (await service.execute('artifact_manage', {
    action: 'create',
    elements: [
      {
        id: 'html',
        type: 'html',
        x: 0,
        y: 0,
        w: 500,
        h: 300,
        text: 'Region',
        html: '<p>Static</p><input>',
      },
    ],
  })) as { board: Board };
  const client: StudioClient = {
    embedded: true,
    async call<T>(name: ToolName, args?: Record<string, unknown>) {
      return (await service.execute(name, args, LOCAL_ACTOR)) as T;
    },
  };
  await appMock.render({ client, actor, initialArtifactId: fixture.board.artifact.id });
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
    });
    expect(host.querySelector('[aria-label="白板画布"]')).not.toBeNull();
  });
}

const canvas = () => host.querySelector<HTMLElement>('[aria-label="白板画布"]')!;
const header = () => host.querySelector<HTMLButtonElement>('[aria-label="备注"]')!;
const tool = () => host.querySelector('.studio-whiteboard')!.getAttribute('data-tool');

async function key(value: string, target: Element = canvas(), extra: KeyboardEventInit = {}) {
  await act(async () =>
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...extra }),
    ),
  );
}

it('commits dark canvas paper on the first render when opening a work', async () => {
  localStorage.setItem('luming-studio-theme', 'dark');
  const papers: (string | null)[] = [];
  const setProperty = CSSStyleDeclaration.prototype.setProperty;
  vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty').mockImplementation(function (
    this: CSSStyleDeclaration,
    name,
    value,
    priority,
  ) {
    if (name === '--canvas-paper') {
      papers.push(value);
    }

    setProperty.call(this, name, value, priority);
  });

  await mount();
  expect(papers.length).toBeGreaterThan(0);
  expect(new Set(papers)).toEqual(new Set([DARK_THEME.paper]));

  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="返回 Luming Studio"]')!.click(),
  );
  const openWork = () => host.querySelector<HTMLButtonElement>('[aria-label^="打开白板："]');
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(openWork()).not.toBeNull();
  });
  papers.length = 0;
  await act(async () => openWork()!.click());
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(canvas()).not.toBeNull();
  });
  expect(papers.length).toBeGreaterThan(0);
  expect(new Set(papers)).toEqual(new Set([DARK_THEME.paper]));
});

describe('one global annotation tool', () => {
  it('keeps header and native tool state identical across every numeric tool transition', async () => {
    await mount();
    for (const [digit, name] of [
      ['1', 'select'],
      ['2', 'pan'],
      ['3', 'text'],
      ['4', 'container'],
      ['5', 'note'],
      ['6', 'stroke'],
      ['7', 'shape'],
      ['8', 'sticker'],
    ]) {
      await key(digit);
      expect(tool()).toBe(name);
      expect(header().getAttribute('aria-pressed')).toBe('false');
      await key('9');
      expect(tool()).toBe('annotate');
      expect(header().getAttribute('aria-pressed')).toBe('true');
      await key('9');
      expect(tool()).toBe('annotate');
      expect(header().getAttribute('aria-pressed')).toBe('true');
      await key(digit);
      expect(tool()).toBe(name);
      expect(header().getAttribute('aria-pressed')).toBe('false');
    }

    await act(async () => header().click());
    expect(tool()).toBe('annotate');
    await key('2');
    expect(tool()).toBe('pan');
    expect(header().getAttribute('aria-pressed')).toBe('false');
    expect(header().getAttribute('title')).toContain('9');
  });
  it('uses the authenticated annotation iframe shortcut to leave global mode and rejects stale frames', async () => {
    await mount();
    await key('9');
    const frame = host.querySelector('iframe')!;
    const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockClear();
    await act(async () => frame.dispatchEvent(new Event('load')));
    const mode = post.mock.calls.find(([value]) => value.type === 'studio-html-mode')![0] as {
      channel: string;
      regionId: string;
      sourceRevision: number;
    };
    const send = async (
      key: string,
      channel = mode.channel,
      source: MessageEventSource | null = frame.contentWindow,
    ) =>
      act(async () =>
        window.dispatchEvent(
          new MessageEvent('message', {
            source,
            data: {
              type: 'studio-html-tool-shortcut',
              channel,
              regionId: mode.regionId,
              sourceRevision: mode.sourceRevision,
              key,
            },
          }),
        ),
      );
    await send('2', 'old-channel');
    await send('2', mode.channel, null);
    expect(tool()).toBe('annotate');
    await send('2');
    expect(tool()).toBe('pan');
    expect(header().getAttribute('aria-pressed')).toBe('false');
    await send('9');
    expect(tool()).toBe('pan');
  });
  it('keeps inputs, composition and platform modifiers ahead of annotation shortcuts', async () => {
    await mount();
    const title = host.querySelector('[aria-label="白板名称"]')!;
    await key('9', title);
    for (const extra of [
      { isComposing: true },
      { key: 'Process' },
      { repeat: true },
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { shiftKey: true },
    ]) {
      await key('9', canvas(), extra);
    }

    expect(tool()).toBe('select');
    expect(header().getAttribute('aria-pressed')).toBe('false');
  });
  it.each(['viewer', 'commenter'] as const)(
    'respects the %s role while retaining navigation',
    async (role) => {
      await mount({ ...LOCAL_ACTOR, id: 'guest', role });
      await key('9');
      expect(tool()).toBe(role === 'viewer' ? 'select' : 'annotate');
      expect(header().disabled).toBe(role === 'viewer');
      await key('2');
      expect(tool()).toBe('pan');
      expect(header().getAttribute('aria-pressed')).toBe('false');
      await key('3');
      expect(tool()).toBe('pan');
    },
  );
});
