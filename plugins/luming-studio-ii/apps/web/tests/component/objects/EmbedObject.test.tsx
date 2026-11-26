import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  chartExtension,
  diagramExtension,
  EmbedObject,
  htmlExtension,
} from '../../../src/ui/domain/objects/embed/index.js';
import type {
  EmbedObjectValue,
  EmbedJson as Json,
  EmbedObjectProps,
} from '../../../src/ui/domain/objects/embed/index.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }

  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const region: EmbedObjectValue = {
  id: 'region',
  version: 4,
  sourceRevision: 2,
  html: '<p data-studio-id="value">A poll</p>',
  state: { votes: 1 },
};

const variants = [
  { kind: 'html', title: 'HTML 图解' },
  { kind: 'diagram', title: '图解' },
  { kind: 'chart', title: '图表' },
] as const;

const extensions = [htmlExtension, diagramExtension, chartExtension];
const CanvasEmbed = htmlExtension.View;

type EmbedViewProps = Parameters<typeof CanvasEmbed>[0];

const embedGeometry = { x: 0, y: 0, width: 500, height: 300, rotation: 0 };

function canvasEmbedProps(): EmbedViewProps {
  return {
    id: region.id,
    object: { kind: 'html', label: 'HTML 图解', geometry: embedGeometry },
    geometry: embedGeometry,
    zoom: 1,
    selected: true,
    interactive: true,
    readOnly: false,
    payload: { value: region, version: region.version },
    request: vi.fn(),
  };
}

it.each(extensions)(
  'registers $kind as embedded Canvas content',
  ({ kind, capabilities, placement }) => {
    expect(capabilities.content).toBe('embedded');
    expect(placement.kind).toBe(kind);
  },
);

it('sends the Canvas state CAS and keeps the iframe mounted when edit permission changes', async () => {
  const host = mount();
  const confirmed = { ...region, state: { votes: 2 }, version: 5 };
  const request = vi.fn<EmbedViewProps['request']>().mockResolvedValue({
    ok: true,
    payload: { version: confirmed.version, value: confirmed },
  });
  const props = { ...canvasEmbedProps(), request };
  await act(async () => host.root.render(<CanvasEmbed {...props} />));
  const frame = host.dom.window.document.querySelector('iframe')!;
  const runtime = await connectRuntime(host, frame);
  const originalSource = frame.srcdoc;

  await act(async () => runtime.save({ votes: 2 }));

  expect(request).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledWith({
    name: 'embed.save-state',
    expectedVersion: 4,
    value: { state: { votes: 2 } },
  });
  expect(runtime.load()).toEqual({ votes: 2 });
  expect(frame.srcdoc).toBe(originalSource);

  await act(async () => host.root.render(<CanvasEmbed {...props} readOnly zoom={2} />));
  await act(async () => runtime.save({ votes: 3 }));
  expect(request).toHaveBeenCalledOnce();
  expect(host.dom.window.document.querySelector('iframe')).toBe(frame);
  expect(frame.srcdoc).toBe(originalSource);
});

it('converts the embedded wheel anchor through the iframe bounds and preserves pan coordinates', async () => {
  const host = mount();
  const onNavigation = vi.fn<NonNullable<EmbedViewProps['onNavigation']>>();
  await act(async () =>
    host.root.render(<CanvasEmbed {...canvasEmbedProps()} onNavigation={onNavigation} />),
  );
  const frame = host.dom.window.document.querySelector('iframe')!;
  vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(
    new host.dom.window.DOMRect(40, 70, 200, 150),
  );
  const { identity } = await host.messages(frame);
  const type = 'studio-html-navigation';
  const wheel = { kind: 'zoom', x: 0.25, y: 0.6, deltaY: -4, deltaMode: 0 };
  const pan = { kind: 'pan', phase: 'start', pointerId: 1, screenX: 380, screenY: 210 };

  host.send(frame, { ...identity, type, ...wheel });
  host.send(frame, { ...identity, type, ...pan });

  expect(onNavigation).toHaveBeenNthCalledWith(1, { ...wheel, x: 90, y: 160 });
  expect(onNavigation).toHaveBeenNthCalledWith(2, pan);
});

it('keeps source drafts on rejected Canvas receipts and applies a confirmed new source revision', async () => {
  const host = mount();
  const doc = host.dom.window.document;
  const nextHtml = '<h1>确认的正文</h1>';
  const onRetentionChange = vi.fn<(retain: boolean) => void>();
  const request = vi
    .fn<EmbedViewProps['request']>()
    .mockResolvedValueOnce({ ok: false, message: '源码版次已经变化。' })
    .mockResolvedValueOnce({
      ok: true,
      payload: { version: 5, value: { ...region, version: 5, sourceRevision: 3, html: nextHtml } },
    });
  await act(async () =>
    host.root.render(
      <CanvasEmbed
        {...canvasEmbedProps()}
        request={request}
        onRetentionChange={onRetentionChange}
      />,
    ),
  );
  const frame = doc.querySelector('iframe')!;
  const originalDocument = frame.srcdoc;
  enableModalFixture(doc);
  expect(onRetentionChange).not.toHaveBeenCalled();
  expect(doc.querySelector('.studio-ui-embed__source-tools')).toBeNull();

  await act(async () =>
    host.root.render(
      <CanvasEmbed
        {...canvasEmbedProps()}
        editRequest={1}
        request={request}
        onRetentionChange={onRetentionChange}
      />,
    ),
  );
  expect(onRetentionChange).toHaveBeenCalledExactlyOnceWith(true);
  await act(async () => changeSource(host, nextHtml));
  await act(async () => clickEditorButton(doc, '保存源码'));

  expect(request).toHaveBeenNthCalledWith(1, {
    name: 'embed.save-source',
    expectedVersion: 4,
    value: { title: '', html: nextHtml, expectedSourceRevision: 2 },
  });
  expect(doc.querySelector('textarea')?.value).toBe(nextHtml);
  expect(doc.body.textContent).toContain('源码版次已经变化。');
  expect(frame.srcdoc).toBe(originalDocument);
  expect(onRetentionChange).toHaveBeenCalledExactlyOnceWith(true);

  await act(async () => clickEditorButton(doc, '保存源码'));
  expect(request).toHaveBeenCalledTimes(2);
  expect(doc.querySelector('dialog[open]')).toBeNull();
  expect(doc.querySelector('iframe')).toBe(frame);
  expect(frame.srcdoc).toContain(nextHtml);
  expect(onRetentionChange.mock.calls).toEqual([[true], [false]]);
});

it('retains failed embedded state while inactive and releases it when shared state is adopted', async () => {
  const host = mount();
  const request = vi.fn<EmbedViewProps['request']>().mockResolvedValue({
    ok: false,
    message: '保留待重试的交互状态。',
  });
  const onRetentionChange = vi.fn<(retain: boolean) => void>();
  const props = { ...canvasEmbedProps(), request, onRetentionChange };
  await act(async () => host.root.render(<CanvasEmbed {...props} />));
  const doc = host.dom.window.document;
  const frame = doc.querySelector('iframe')!;
  const runtime = await connectRuntime(host, frame);
  expect(onRetentionChange).not.toHaveBeenCalled();

  await act(async () => runtime.save({ votes: 2 }));
  expect(onRetentionChange).toHaveBeenCalledExactlyOnceWith(true);
  expect(runtime.load()).toEqual({ votes: 2 });

  await act(async () => host.root.render(<CanvasEmbed {...props} interactive={false} />));
  expect(doc.querySelector('iframe')).toBe(frame);
  expect(onRetentionChange).toHaveBeenCalledExactlyOnceWith(true);

  await act(async () => clickEditorButton(doc, '使用共享状态'));
  expect(runtime.load()).toEqual({ votes: 1 });
  expect(onRetentionChange.mock.calls).toEqual([[true], [false]]);
});

it.each(['diagram', 'chart'] as const)(
  'keeps a legacy %s without HTML as a title with no generic or source editor',
  async (kind) => {
    const { dom, root } = mount();
    const value = { id: 'legacy', version: 1, title: '兼容标题' };
    const onSaveSource = vi.fn();

    await act(async () =>
      root.render(
        <EmbedObject kind={kind} value={value} interactive onSaveSource={onSaveSource} />,
      ),
    );

    const doc = dom.window.document;
    expect(doc.body.textContent).toContain('兼容标题');
    expect(doc.querySelector('iframe, button, textarea, [contenteditable]')).toBeNull();
    expect(onSaveSource).not.toHaveBeenCalled();
  },
);

it.each(variants)('renders the $kind object body inside a script-only sandbox', async (variant) => {
  const { dom, root } = mount();

  await act(async () =>
    root.render(<EmbedObject kind={variant.kind} value={region} interactive />),
  );

  const frame = dom.window.document.querySelector('iframe')!;
  expect(frame.title).toBe(variant.title);
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(frame.srcdoc).toContain('data-studio-id="value"');
  expect(frame.srcdoc).toContain("connect-src 'none'");
  expect(frame.srcdoc).not.toContain('owner-secret');
});

function clickEditorButton(doc: Document, label: string) {
  const control = [...doc.querySelectorAll('button')].find(
    (button) => button.textContent === label,
  );
  expect(control).toBeDefined();
  control?.click();
}

function changeSource(host: ReturnType<typeof mount>, next: string) {
  const { document, HTMLTextAreaElement, InputEvent } = host.dom.window;
  const area = document.querySelector<HTMLTextAreaElement>('textarea')!;
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  if (!nativeValue?.set) {
    throw new Error('Native text area value setter is missing.');
  }

  nativeValue.set.call(area, next);
  area.dispatchEvent(new InputEvent('input', { bubbles: true, data: next }));
}

function enableModalFixture(doc: Document) {
  const prototype = doc.defaultView?.HTMLDialogElement.prototype;
  if (prototype && typeof prototype.showModal !== 'function') {
    Object.defineProperties(prototype, {
      showModal: {
        value(this: HTMLDialogElement) {
          this.open = true;
        },
      },
      close: {
        value(this: HTMLDialogElement) {
          this.open = false;
        },
      },
    });
  }
}

it('retains unsaved source after a rejected update and applies only the confirmed source revision', async () => {
  const host = mount();
  const doc = host.dom.window.document;
  const onSaveSource = vi
    .fn<NonNullable<EmbedObjectProps['onSaveSource']>>()
    .mockRejectedValueOnce(new Error('已有新的源码版本。'))
    .mockResolvedValueOnce(undefined);
  const render = (value: EmbedObjectValue) =>
    host.root.render(
      <EmbedObject kind="html" value={value} interactive onSaveSource={onSaveSource} />,
    );
  await act(async () => render(region));
  const frame = doc.querySelector('iframe')!;
  const originalDocument = frame.srcdoc;
  const nextHtml = '<h1>调整后的图解</h1>';
  enableModalFixture(doc);

  await act(async () => clickEditorButton(doc, '编辑 HTML 源码'));
  await act(async () => changeSource(host, nextHtml));
  await act(async () => clickEditorButton(doc, '保存源码'));

  const draft = { title: '', html: nextHtml };
  expect(onSaveSource).toHaveBeenNthCalledWith(1, draft, region.sourceRevision);
  expect(doc.querySelector('textarea')?.value).toBe(nextHtml);
  expect(doc.body.textContent).toContain('已有新的源码版本。');
  expect(frame.srcdoc).toBe(originalDocument);

  await act(async () => clickEditorButton(doc, '保存源码'));
  expect(onSaveSource).toHaveBeenNthCalledWith(2, draft, region.sourceRevision);
  expect(doc.querySelector('dialog[open]')).toBeNull();
  expect(frame.srcdoc).toBe(originalDocument);

  await act(async () => render({ ...region, html: nextHtml, version: 5, sourceRevision: 3 }));
  expect(doc.querySelector('iframe')).toBe(frame);
  expect(frame.srcdoc).toContain(nextHtml);
});

it('loads a selected HTML file through the injected port without replacing the edited region title', async () => {
  const host = mount();
  const { document, File, Event } = host.dom.window;
  const source = '<h1>文件图解</h1>';
  const file = new File([source], '导入题目.html', { type: 'text/html' });
  const readHtmlSource = vi.fn<(file: File) => Promise<string>>().mockResolvedValue(source);
  const onSaveSource = vi.fn<NonNullable<EmbedObjectProps['onSaveSource']>>().mockResolvedValue();
  enableModalFixture(document);

  await act(async () =>
    host.root.render(
      <EmbedObject
        kind="html"
        value={{ ...region, title: '现有图解名' }}
        interactive
        editRequest={1}
        readHtmlSource={readHtmlSource}
        onSaveSource={onSaveSource}
      />,
    ),
  );
  const input = document.querySelector('input[type="file"]');
  if (!input) {
    throw new Error('Expected the HTML file picker.');
  }

  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(readHtmlSource).toHaveBeenCalledExactlyOnceWith(file);
  expect(document.querySelector('textarea')?.value).toBe(source);
  await act(async () => clickEditorButton(document, '保存源码'));
  expect(onSaveSource).toHaveBeenCalledExactlyOnceWith(
    { title: '现有图解名', html: source },
    region.sourceRevision,
  );
});

it('forwards only current interactive-frame pointer messages and clears position when interaction ends', async () => {
  const host = mount();
  const pointer = vi.fn();
  const render = (interactive: boolean, element = region) =>
    host.root.render(
      <EmbedObject
        kind="html"
        value={element}
        annotation={false}
        interactive={interactive}
        onSelection={() => {}}
        onPointerPosition={pointer}
      />,
    );
  await act(async () => render(true));
  const frame = host.dom.window.document.querySelector('iframe')!;
  const { identity } = await host.messages(frame);
  expect(frame.tabIndex).toBe(0);
  const message = { type: 'studio-html-pointer', ...identity, point: { x: 0.2, y: 0.75 } };
  host.send(frame, message);
  expect(pointer).toHaveBeenLastCalledWith({ x: 0.2, y: 0.75 });
  for (const data of [
    { ...message, channel: 'old-frame' },
    { ...message, regionId: 'other-region' },
    { ...message, sourceRevision: 1 },
    { ...message, point: { x: 1.01, y: 0.75 } },
    { ...message, point: { x: Number.NaN, y: 0 } },
  ]) {
    host.send(frame, data);
  }

  host.send(frame, message, host.dom.window as unknown as MessageEventSource);
  expect(pointer).toHaveBeenCalledTimes(1);
  host.send(frame, { ...message, point: null });
  expect(pointer).toHaveBeenLastCalledWith(null);
  host.send(frame, message);
  await act(async () => render(false));
  expect(pointer).toHaveBeenLastCalledWith(null);
  expect(frame.tabIndex).toBe(-1);
  const afterDisable = pointer.mock.calls.length;
  host.send(frame, message);
  expect(pointer).toHaveBeenCalledTimes(afterDisable);
  await act(async () => render(true, { ...region, html: '<p>New source</p>', sourceRevision: 3 }));
  host.send(frame, message);
  expect(pointer).toHaveBeenCalledTimes(afterDisable);
  const next = await host.messages(frame);
  host.send(frame, { type: 'studio-html-pointer', ...next.identity, point: { x: 0.5, y: 0.5 } });
  expect(pointer).toHaveBeenLastCalledWith({ x: 0.5, y: 0.5 });
  await act(async () => host.root.render(null));
  expect(pointer).toHaveBeenLastCalledWith(null);
});

it('forwards only current visible annotation-frame numeric shortcuts', async () => {
  const host = mount();
  const shortcut = vi.fn();
  const render = (annotation: boolean) =>
    host.root.render(
      <EmbedObject
        kind="html"
        value={region}
        annotation={annotation}
        interactive={false}
        onSelection={() => {}}
        onToolShortcut={shortcut}
      />,
    );
  await act(async () => render(true));
  const frame = host.dom.window.document.querySelector('iframe')!;
  const { identity } = await host.messages(frame);
  expect(frame.tabIndex).toBe(0);
  const message = { type: 'studio-html-tool-shortcut', ...identity, key: '2' };
  host.send(frame, { ...message, channel: 'stale' });
  host.send(frame, { ...message, sourceRevision: 1 });
  host.send(frame, { ...message, regionId: 'other' });
  host.send(frame, message, null);
  host.send(frame, { ...message, key: '0' });
  expect(shortcut).not.toHaveBeenCalled();
  host.send(frame, message);
  expect(shortcut).toHaveBeenLastCalledWith('2');
  frame.hidden = true;
  host.send(frame, { ...message, key: '9' });
  expect(shortcut).toHaveBeenCalledTimes(1);
  frame.hidden = false;
  await act(async () => render(false));
  host.send(frame, message);
  expect(shortcut).toHaveBeenCalledTimes(1);
});

it('routes only a current visible frame Escape into one parent layer', async () => {
  const host = mount();
  const close = vi.fn();
  await act(async () =>
    host.root.render(
      <EmbedObject
        kind="html"
        value={region}
        annotation={false}
        interactive
        onSelection={() => {}}
        onEscape={close}
      />,
    ),
  );
  const frame = host.dom.window.document.querySelector('iframe')!;
  const { identity } = await host.messages(frame);
  const message = { type: 'studio-html-escape', ...identity };
  host.send(frame, message, host.dom.window as unknown as MessageEventSource);
  host.send(frame, { ...message, channel: 'other' });
  host.send(frame, { ...message, sourceRevision: identity.sourceRevision + 1 });
  expect(close).not.toHaveBeenCalled();
  host.send(frame, message);
  expect(close).toHaveBeenCalledOnce();
  frame.hidden = true;
  host.send(frame, message);
  expect(close).toHaveBeenCalledOnce();
});

function mount() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/?token=owner-secret' });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('DOMParser', dom.window.DOMParser);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = createRoot(dom.window.document.getElementById('root')!);
  cleanups.push(async () => {
    await act(async () => root.unmount());
    dom.window.close();
  });
  const send = (
    frame: HTMLIFrameElement,
    data: unknown,
    source: MessageEventSource | null = frame.contentWindow,
  ) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source, data }));
  const messages = async (frame: HTMLIFrameElement) => {
    const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockClear();
    await act(async () => {
      frame.dispatchEvent(new dom.window.Event('load'));
    });
    const identity = post.mock.calls.find(
      ([message]) => message.type === 'studio-html-mode',
    )![0] as { channel: string; regionId: string; sourceRevision: number };

    return {
      post,
      identity: {
        channel: identity.channel,
        regionId: identity.regionId,
        sourceRevision: identity.sourceRevision,
      },
    };
  };

  return { dom, root, send, messages };
}

async function connectRuntime(host: ReturnType<typeof mount>, frame: HTMLIFrameElement) {
  const { post, identity } = await host.messages(frame);
  let embedded: JSDOM | undefined;
  post.mockImplementation((message: unknown) => {
    if (embedded) {
      embedded.window.dispatchEvent(
        new embedded.window.MessageEvent('message', {
          source: embedded.window as unknown as MessageEventSource,
          data: message,
        }),
      );
    }
  });
  await act(async () => {
    embedded = new JSDOM(frame.srcdoc, {
      runScripts: 'dangerously',
      beforeParse(window) {
        Object.defineProperty(window, 'TextEncoder', { value: TextEncoder });
        window.postMessage = (message: unknown) => {
          host.send(frame, message);
        };
      },
    });
    await new Promise<void>((resolve) => {
      embedded!.window.addEventListener('load', () => resolve(), { once: true });
    });
  });
  const runtime = embedded!;
  cleanups.push(async () => runtime.window.close());

  return {
    identity,
    post,
    load: () => runtime.window.eval('studioEmbed.load()') as Json,
    save: (state: Json) => runtime.window.eval(`studioEmbed.save(${JSON.stringify(state)})`),
  };
}

it('changes raster zoom without replacing the live frame, its channel or a pending state acknowledgement', async () => {
  const host = mount();
  const waiting: ((result: { state: Json; version: number }) => void)[] = [];
  const change = vi.fn(
    (_state: Json, _version: number) =>
      new Promise<{ state: Json; version: number }>((resolve) => {
        waiting.push(resolve);
      }),
  );
  const element = { ...region, state: { votes: 0, label: 'A' } };
  const render = (zoom: number) =>
    host.root.render(
      <EmbedObject
        kind="html"
        value={element}
        zoom={zoom}
        annotation={false}
        interactive
        onSelection={() => {}}
        onSaveState={change}
      />,
    );
  await act(async () => render(0.867));
  const frame = host.dom.window.document.querySelector('iframe')!;
  const originalWindow = frame.contentWindow;
  const originalSource = frame.srcdoc;
  const input = frame.contentDocument!.createElement('input');
  input.value = '未提交的输入';
  frame.contentDocument!.body.append(input);
  const runtime = await connectRuntime(host, frame);
  await act(async () => {
    runtime.save({ votes: 1, label: 'A' });
    runtime.save({ votes: 2, label: 'A' });
  });
  expect(change).toHaveBeenCalledExactlyOnceWith({ votes: 1, label: 'A' }, 4);
  const rasters = [
    [0.867, 0.867],
    [1.5, 1.5],
    [0.63, 0.63],
    [0.5, 0.5],
    [0.28, 1],
    [0.103, 1],
    [1, 1],
  ] as const;

  for (const [zoom, rasterZoom] of rasters) {
    await act(async () => render(zoom));
    expect(host.dom.window.document.querySelector('iframe')).toBe(frame);
    expect(frame.contentWindow).toBe(originalWindow);
    expect(frame.srcdoc).toBe(originalSource);
    expect(input.ownerDocument).toBe(frame.contentDocument);
    expect(input.value).toBe('未提交的输入');
    expect(frame.style.pointerEvents).toBe('auto');
    expect(runtime.load()).toEqual({ votes: 2, label: 'A' });
    expect(change).toHaveBeenCalledTimes(1);
    expect(
      runtime.post.mock.calls
        .filter(([message]) => message.type === 'studio-html-mode')
        .every(([message]) => message.channel === runtime.identity.channel),
    ).toBe(true);
    expect(frame.style.zoom).toBe(String(rasterZoom));
    expect(frame.style.width).toBe(`${rasterZoom * 100}%`);
    expect(frame.style.height).toBe(`${rasterZoom * 100}%`);
    expect(frame.style.transform).toBe(zoom === rasterZoom ? `scale(${1 / zoom})` : '');
  }

  await act(async () => waiting.shift()!({ state: { votes: 1, label: 'Remote' }, version: 5 }));
  expect(runtime.load()).toEqual({ votes: 2, label: 'Remote' });
  expect(change).toHaveBeenNthCalledWith(2, { votes: 2, label: 'Remote' }, 5);
  await act(async () => waiting.shift()!({ state: { votes: 2, label: 'Remote' }, version: 6 }));
  expect(runtime.load()).toEqual({ votes: 2, label: 'Remote' });
  expect(frame.srcdoc).toBe(originalSource);
});

it('preserves the live frame and queued saves when a legacy source revision is made explicit', async () => {
  const host = mount();
  const legacy = { ...region, version: 1, sourceRevision: undefined };
  let acceptFirst!: (result: { state: Json; version: number }) => void;
  const change = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acceptFirst = resolve;
        }),
    )
    .mockResolvedValueOnce({ state: { votes: 3 }, version: 3 });
  const render = (element: EmbedObjectValue) =>
    host.root.render(
      <EmbedObject
        kind="html"
        value={element}
        annotation={false}
        interactive
        onSelection={() => {}}
        onSaveState={change}
      />,
    );
  await act(async () => render(legacy));
  const frame = host.dom.window.document.querySelector('iframe')!;
  const originalDocument = frame.srcdoc;
  const runtime = await connectRuntime(host, frame);
  await act(async () => {
    runtime.save({ votes: 2 });
    runtime.save({ votes: 3 });
  });
  expect(change).toHaveBeenCalledExactlyOnceWith({ votes: 2 }, 1);

  await act(async () => render({ ...legacy, sourceRevision: 1 }));
  expect(host.dom.window.document.querySelector('iframe')).toBe(frame);
  expect((await host.messages(frame)).identity).toEqual(runtime.identity);
  expect(frame.srcdoc).toBe(originalDocument);
  expect(runtime.load()).toEqual({ votes: 3 });

  await act(async () => acceptFirst({ state: { votes: 2 }, version: 2 }));
  expect(change).toHaveBeenNthCalledWith(2, { votes: 3 }, 2);
  expect(runtime.load()).toEqual({ votes: 3 });
});

it('keeps normalized pointer/navigation and logical annotation coordinates across raster zoom changes', async () => {
  const host = mount();
  const pointer = vi.fn();
  const navigate = vi.fn();
  const annotate = vi.fn();
  let zoom = 0.867;
  const render = () =>
    host.root.render(
      <EmbedObject
        kind="html"
        value={region}
        zoom={zoom}
        annotation
        interactive
        onSelection={annotate}
        onPointerPosition={pointer}
        onNavigation={navigate}
      />,
    );
  await act(async () => render());
  const frame = host.dom.window.document.querySelector('iframe')!;
  Object.defineProperties(frame, {
    clientWidth: { value: 500 },
    clientHeight: { value: 300 },
    getBoundingClientRect: {
      value: () => ({ left: 100, top: 200, width: 500 * zoom, height: 300 * zoom }),
    },
  });
  const { identity } = await host.messages(frame);
  for (zoom of [0.867, 1.5, 0.55, 0.103]) {
    await act(async () => render());
    await act(async () => {
      host.send(frame, { type: 'studio-html-pointer', ...identity, point: { x: 0.2, y: 0.75 } });
      host.send(frame, {
        type: 'studio-html-navigation',
        ...identity,
        kind: 'zoom',
        x: 0.25,
        y: 0.75,
        deltaY: -3,
        deltaMode: 1,
      });
      host.send(frame, {
        type: 'studio-html-selection',
        ...identity,
        targetIds: ['value'],
        quote: 'A poll',
        excerpt: '<p>A poll</p>',
        rect: { x: 30, y: 400, w: 20, h: 15 },
        point: { x: 40, y: 50 },
      });
    });
    expect(pointer).toHaveBeenLastCalledWith({ x: 0.2, y: 0.75 });
    expect(navigate).toHaveBeenLastCalledWith({
      kind: 'zoom',
      x: 0.25,
      y: 0.75,
      deltaY: -3,
      deltaMode: 1,
    });
    const selection = annotate.mock.lastCall![0];
    expect(selection.rect).toEqual({ x: 30, y: 400, w: 20, h: 15 });
    expect(selection.sourceRevision).toBe(2);
    expect(selection.screenPoint.x).toBeCloseTo(100 + 40 * zoom);
    expect(selection.screenPoint.y).toBeCloseTo(200 + 50 * zoom);
    expect(selection).not.toHaveProperty('point');
  }

  expect(pointer).toHaveBeenCalledTimes(4);
  expect(navigate).toHaveBeenCalledTimes(4);
  expect(annotate).toHaveBeenCalledTimes(4);
});

it('retains authenticated logical scroll through zoom changes before a later source replacement', async () => {
  const host = mount();
  const render = (zoom: number, element = region) =>
    host.root.render(
      <EmbedObject
        kind="html"
        value={element}
        zoom={zoom}
        annotation={false}
        interactive
        preserveScroll
        onSelection={() => {}}
      />,
    );
  await act(async () => render(0.867));
  const frame = host.dom.window.document.querySelector('iframe')!;
  const first = await host.messages(frame);
  const originalSource = frame.srcdoc;
  await act(async () => {
    host.send(frame, { type: 'studio-html-ready', ...first.identity });
  });

  for (const zoom of [0.867, 1.5, 0.55]) {
    await act(async () => render(zoom));
    await act(async () => {
      host.send(frame, {
        type: 'studio-html-scroll',
        ...first.identity,
        x: 30,
        y: 480,
        maxX: 100,
        maxY: 900,
      });
      host.send(
        frame,
        { type: 'studio-html-scroll', ...first.identity, x: 90, y: 800, maxX: 100, maxY: 900 },
        null,
      );
    });
    expect(frame.srcdoc).toBe(originalSource);
  }

  await act(async () =>
    render(0.55, { ...region, html: '<p>Replacement source</p>', sourceRevision: 3, version: 5 }),
  );
  const next = await host.messages(frame);
  expect(next.identity.channel).not.toBe(first.identity.channel);
  await act(async () => {
    host.send(frame, { type: 'studio-html-ready', ...next.identity });
  });
  expect(next.post).toHaveBeenCalledWith(
    { type: 'studio-html-scroll-restore', ...next.identity, x: 30, y: 480 },
    '*',
  );
});

it('broadcasts state-only changes without replacing an iframe rendering document', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/?token=owner-secret' });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('DOMParser', dom.window.DOMParser);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = createRoot(dom.window.document.getElementById('root')!);
  const element: EmbedObjectValue = {
    id: 'region',
    version: 4,
    sourceRevision: 2,
    html: '<p data-studio-id="value">A poll</p>',
    state: { votes: 1 },
  };
  const onSaveState = async () => ({ state: { votes: 2 }, version: 5 });
  await act(async () => {
    root.render(
      <EmbedObject
        kind="html"
        value={element}
        annotation={false}
        interactive
        onSelection={() => {}}
        onSaveState={onSaveState}
      />,
    );
  });
  const frame = dom.window.document.querySelector('iframe')!;
  const originalDocument = frame.srcdoc;
  expect(originalDocument.startsWith('<!doctype html>')).toBe(true);
  expect(originalDocument).not.toContain('owner-secret');
  expect(frame.hasAttribute('src')).toBe(false);
  const post = vi.spyOn(frame.contentWindow!, 'postMessage');
  await act(async () => {
    root.render(
      <EmbedObject
        kind="html"
        value={{ ...element, version: 5, state: { votes: 2 } }}
        annotation={false}
        interactive
        onSelection={() => {}}
        onSaveState={onSaveState}
      />,
    );
  });
  expect(dom.window.document.querySelector('iframe')).toBe(frame);
  expect(frame.srcdoc).toBe(originalDocument);
  expect(post).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'studio-html-state-update', state: { votes: 2 }, version: 5 }),
    '*',
  );
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  await act(async () => root.unmount());
  dom.window.close();
});

it('directly assigns UTF-8 rendering documents for the shared whiteboard and independent reader', async () => {
  const { dom, root } = mount();
  const createUrl = vi.spyOn(URL, 'createObjectURL');
  const html = '<meta charset="gbk"><p>中文阅读与白板批注</p>';
  for (const preserveScroll of [false, true]) {
    const element = { ...region, id: preserveScroll ? 'reader-region' : 'board-region', html };
    await act(async () => {
      root.render(
        <EmbedObject
          kind="html"
          value={element}
          annotation={!preserveScroll}
          interactive
          preserveScroll={preserveScroll}
          onSelection={() => {}}
        />,
      );
    });
    const frame = dom.window.document.querySelector('iframe')!;
    const content = frame.srcdoc;
    expect(content).toContain('<head><meta charset="utf-8">');
    expect(content).toContain('<p>中文阅读与白板批注</p>');
    expect(content).toContain('Content-Security-Policy');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.hasAttribute('src')).toBe(false);
    expect(element.html).toBe(html);
  }

  expect(createUrl).not.toHaveBeenCalled();
});

it('removes annotation mode buttons and converts iframe client points through its host scale', async () => {
  const { dom, root, send, messages } = mount();
  const annotate = vi.fn();
  await act(async () => {
    root.render(
      <EmbedObject kind="html" value={region} annotation interactive onSelection={annotate} />,
    );
  });
  expect(dom.window.document.querySelector('button')).toBeNull();
  const frame = dom.window.document.querySelector('iframe')!;
  Object.defineProperties(frame, {
    clientWidth: { value: 500 },
    clientHeight: { value: 300 },
    getBoundingClientRect: { value: () => ({ left: 100, top: 200, width: 250, height: 150 }) },
  });
  const { identity } = await messages(frame);
  const selection = {
    type: 'studio-html-selection',
    ...identity,
    targetIds: ['value'],
    quote: 'A poll',
    excerpt: '<p>A poll</p>',
    rect: { x: 30, y: 400, w: 20, h: 15 },
    point: { x: 40, y: 50 },
    screenPoint: { x: 9999, y: 9999 },
  };
  await act(async () => {
    send(frame, selection, null);
    send(frame, { ...selection, sourceRevision: 1 });
  });
  expect(annotate).not.toHaveBeenCalled();
  await act(async () => {
    send(frame, selection);
  });
  expect(annotate).toHaveBeenCalledWith(
    expect.objectContaining({
      rect: { x: 30, y: 400, w: 20, h: 15 },
      screenPoint: { x: 120, y: 225 },
    }),
  );
  expect(annotate.mock.calls[0]?.[0]).not.toHaveProperty('point');
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
});

it('preserves authenticated iframe scroll across HTML source replacements after the next ready', async () => {
  const { dom, root, send, messages } = mount();
  const render = (element: EmbedObjectValue) =>
    root.render(
      <EmbedObject
        kind="html"
        value={element}
        annotation={false}
        interactive
        preserveScroll
        onSelection={() => {}}
      />,
    );
  await act(async () => {
    render(region);
  });
  const frame = dom.window.document.querySelector('iframe')!;
  const previousDocument = frame.srcdoc;
  const first = await messages(frame);
  const scroll = {
    type: 'studio-html-scroll',
    ...first.identity,
    x: 30,
    y: 480,
    maxX: 100,
    maxY: 900,
  };
  await act(async () => {
    send(frame, { type: 'studio-html-ready', ...first.identity });
    send(frame, scroll);
    send(frame, { ...scroll, y: 800 }, null);
    send(frame, { ...scroll, y: 1e9 });
  });
  await act(async () => {
    render({ ...region, html: '<p>Updated source</p>', sourceRevision: 3, version: 5 });
  });
  expect(frame.srcdoc).not.toBe(previousDocument);
  const next = await messages(frame);
  expect(next.identity.channel).not.toBe(first.identity.channel);
  expect(
    next.post.mock.calls.some(([message]) => message.type === 'studio-html-scroll-restore'),
  ).toBe(false);
  await act(async () => {
    send(frame, { type: 'studio-html-ready', ...first.identity });
    send(frame, { ...scroll, ...next.identity, y: 0 });
  });
  expect(
    next.post.mock.calls.some(([message]) => message.type === 'studio-html-scroll-restore'),
  ).toBe(false);
  await act(async () => {
    send(frame, { type: 'studio-html-ready', ...next.identity });
  });
  expect(next.post).toHaveBeenCalledWith(
    { type: 'studio-html-scroll-restore', ...next.identity, x: 30, y: 480 },
    '*',
  );
});

it('keeps default scroll behavior unchanged and does not restore positions between regions', async () => {
  const { dom, root, send, messages } = mount();
  await act(async () => {
    root.render(
      <EmbedObject
        kind="html"
        value={region}
        annotation={false}
        interactive
        onSelection={() => {}}
      />,
    );
  });
  const frame = dom.window.document.querySelector('iframe')!;
  const first = await messages(frame);
  await act(async () => {
    send(frame, { type: 'studio-html-ready', ...first.identity });
    send(frame, {
      type: 'studio-html-scroll',
      ...first.identity,
      x: 0,
      y: 400,
      maxX: 0,
      maxY: 900,
    });
  });
  await act(async () => {
    root.render(
      <EmbedObject
        kind="html"
        value={{ ...region, html: '<p>Updated source</p>', sourceRevision: 3 }}
        annotation={false}
        interactive
        preserveScroll
        onSelection={() => {}}
      />,
    );
  });
  const updated = await messages(frame);
  await act(async () => {
    send(frame, { type: 'studio-html-ready', ...updated.identity });
    send(frame, {
      type: 'studio-html-scroll',
      ...updated.identity,
      x: 0,
      y: 400,
      maxX: 0,
      maxY: 900,
    });
  });
  expect(
    updated.post.mock.calls.some(([message]) => message.type === 'studio-html-scroll-restore'),
  ).toBe(false);
  await act(async () => {
    root.render(
      <EmbedObject
        kind="html"
        value={{ ...region, id: 'another-region', html: '<p>Another source</p>' }}
        annotation={false}
        interactive
        preserveScroll
        onSelection={() => {}}
      />,
    );
  });
  const next = await messages(frame);
  await act(async () => {
    send(frame, { type: 'studio-html-ready', ...next.identity });
  });
  expect(
    next.post.mock.calls.some(([message]) => message.type === 'studio-html-scroll-restore'),
  ).toBe(false);
});

it('coalesces pending state saves and advances only its accepted compare-and-swap versions', async () => {
  const { dom, root, send, messages } = mount();
  let finishFirst!: (result: { state: { votes: number }; version: number }) => void;
  const change = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    )
    .mockResolvedValueOnce({ state: { votes: 4 }, version: 6 });
  await act(async () => {
    root.render(
      <EmbedObject
        kind="html"
        value={region}
        annotation={false}
        interactive
        onSelection={() => {}}
        onSaveState={change}
      />,
    );
  });
  const frame = dom.window.document.querySelector('iframe')!;
  const { identity } = await messages(frame);
  await act(async () => {
    for (const votes of [2, 3, 4]) {
      send(frame, {
        type: 'studio-html-state',
        ...identity,
        baseVersion: 4,
        saveId: votes - 1,
        state: { votes },
      });
    }
  });
  expect(change).toHaveBeenCalledTimes(1);
  expect(change).toHaveBeenNthCalledWith(1, { votes: 2 }, 4);
  await act(async () => {
    finishFirst({ state: { votes: 2 }, version: 5 });
  });
  expect(change).toHaveBeenCalledTimes(2);
  expect(change).toHaveBeenNthCalledWith(2, { votes: 4 }, 5);
});

it('runs real iframe clicks through the serial saver without early ACK rollback or losing merged remote fields', async () => {
  const host = mount();
  const waiting: ((result: { state: Json; version: number }) => void)[] = [];
  const change = vi.fn(
    (_state: Json, _version: number) =>
      new Promise<{ state: Json; version: number }>((resolve) => {
        waiting.push(resolve);
      }),
  );
  await act(async () =>
    host.root.render(
      <EmbedObject
        kind="html"
        value={{ ...region, state: { votes: 0, label: 'A' } }}
        annotation={false}
        interactive
        onSelection={() => {}}
        onSaveState={change}
      />,
    ),
  );
  const runtime = await connectRuntime(host, host.dom.window.document.querySelector('iframe')!);
  await act(async () => {
    runtime.save({ votes: 1, label: 'A' });
    runtime.save({ votes: 2, label: 'A' });
  });
  expect(change).toHaveBeenCalledTimes(1);
  await act(async () => waiting.shift()!({ state: { votes: 1, label: 'Remote' }, version: 5 }));
  expect(runtime.load()).toEqual({ votes: 2, label: 'Remote' });
  expect(change).toHaveBeenNthCalledWith(2, { votes: 2, label: 'Remote' }, 5);
  await act(async () => runtime.save({ ...(runtime.load() as object), votes: 3 }));
  await act(async () => waiting.shift()!({ state: { votes: 2, label: 'Remote' }, version: 6 }));
  expect(runtime.load()).toEqual({ votes: 3, label: 'Remote' });
  expect(change).toHaveBeenNthCalledWith(3, { votes: 3, label: 'Remote' }, 6);
  await act(async () => waiting.shift()!({ state: { votes: 3, label: 'Remote' }, version: 7 }));
  expect(runtime.load()).toEqual({ votes: 3, label: 'Remote' });
  await act(async () =>
    host.send(host.dom.window.document.querySelector('iframe')!, {
      type: 'studio-html-state',
      ...runtime.identity,
      saveId: 3,
      baseVersion: 6,
      state: { votes: 99 },
    }),
  );
  expect(change).toHaveBeenCalledTimes(3);
});

it('retains the newest failed iframe intent for explicit retry and exposes the authoritative state for discard', async () => {
  const host = mount();
  let reject!: (error: Error) => void;
  const change = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    )
    .mockResolvedValueOnce({ state: { votes: 3 }, version: 5 })
    .mockRejectedValueOnce(new Error('同一字段有冲突'));
  await act(async () =>
    host.root.render(
      <EmbedObject
        kind="html"
        value={region}
        annotation={false}
        interactive
        onSelection={() => {}}
        onSaveState={change}
      />,
    ),
  );
  const runtime = await connectRuntime(host, host.dom.window.document.querySelector('iframe')!);
  await act(async () => {
    runtime.save({ votes: 2 });
    runtime.save({ votes: 3 });
    reject(new Error('网络暂不可用'));
  });
  expect(runtime.load()).toEqual({ votes: 3 });
  expect(host.dom.window.document.querySelector('[role="alert"]')?.textContent).toContain(
    '网络暂不可用',
  );
  expect(host.dom.window.document.querySelector('pre')?.textContent).toContain('"votes": 1');
  await act(async () =>
    [...host.dom.window.document.querySelectorAll('button')]
      .find((button) => button.textContent === '重试保存')!
      .click(),
  );
  expect(change).toHaveBeenNthCalledWith(2, { votes: 3 }, 4);
  expect(host.dom.window.document.querySelector('[role="alert"]')).toBeNull();
  await act(async () => runtime.save({ votes: 4 }));
  expect(runtime.load()).toEqual({ votes: 4 });
  await act(async () =>
    [...host.dom.window.document.querySelectorAll('button')]
      .find((button) => button.textContent === '使用共享状态')!
      .click(),
  );
  expect(runtime.load()).toEqual({ votes: 3 });
  expect(change).toHaveBeenCalledTimes(3);
});

it('isolates old-source asynchronous errors from the new channel and its pending real iframe saves', async () => {
  const host = mount();
  let rejectOld!: (error: Error) => void;
  let acceptNew!: (result: { state: Json; version: number }) => void;
  const change = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectOld = reject;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acceptNew = resolve;
        }),
    )
    .mockResolvedValueOnce({ state: { votes: 12 }, version: 7 });
  const render = (element: EmbedObjectValue) =>
    host.root.render(
      <EmbedObject
        kind="html"
        value={element}
        annotation={false}
        interactive
        onSelection={() => {}}
        onSaveState={change}
      />,
    );
  await act(async () => render(region));
  const frame = host.dom.window.document.querySelector('iframe')!;
  const old = await connectRuntime(host, frame);
  await act(async () => old.save({ votes: 2 }));
  await act(async () =>
    render({
      ...region,
      html: '<p>New source</p>',
      sourceRevision: 3,
      version: 5,
      state: { votes: 10 },
    }),
  );
  const next = await connectRuntime(host, frame);
  expect(next.identity.channel).not.toBe(old.identity.channel);
  await act(async () => {
    next.save({ votes: 11 });
    next.save({ votes: 12 });
    rejectOld(new Error('旧源码请求失败'));
  });
  expect(host.dom.window.document.querySelector('[role="alert"]')).toBeNull();
  expect(next.load()).toEqual({ votes: 12 });
  await act(async () => acceptNew({ state: { votes: 11 }, version: 6 }));
  expect(change).toHaveBeenNthCalledWith(3, { votes: 12 }, 6);
  expect(next.load()).toEqual({ votes: 12 });
});

it('keeps the original write base across a remote conflict until the user explicitly adopts shared state', async () => {
  const host = mount();
  const change = vi
    .fn()
    .mockRejectedValueOnce(new Error('共享字段已变化'))
    .mockRejectedValueOnce(new Error('共享字段仍有冲突'))
    .mockResolvedValueOnce({ state: { votes: 10 }, version: 6 });
  const render = (element: EmbedObjectValue) =>
    host.root.render(
      <EmbedObject
        kind="html"
        value={element}
        annotation={false}
        interactive
        onSelection={() => {}}
        onSaveState={change}
      />,
    );
  await act(async () => render(region));
  const runtime = await connectRuntime(host, host.dom.window.document.querySelector('iframe')!);
  await act(async () => runtime.save({ votes: 2 }));
  await act(async () => render({ ...region, version: 5, state: { votes: 9 } }));
  expect(runtime.load()).toEqual({ votes: 2 });
  await act(async () => runtime.save({ votes: 3 }));
  expect(change).toHaveBeenCalledTimes(1);
  await act(async () =>
    [...host.dom.window.document.querySelectorAll('button')]
      .find((button) => button.textContent === '重试保存')!
      .click(),
  );
  expect(change).toHaveBeenNthCalledWith(2, { votes: 3 }, 4);
  expect(runtime.load()).toEqual({ votes: 3 });
  expect(host.dom.window.document.querySelector('pre')?.textContent).toContain('"votes": 9');
  await act(async () =>
    [...host.dom.window.document.querySelectorAll('button')]
      .find((button) => button.textContent === '使用共享状态')!
      .click(),
  );
  expect(runtime.load()).toEqual({ votes: 9 });
  await act(async () => runtime.save({ votes: 10 }));
  expect(change).toHaveBeenNthCalledWith(3, { votes: 10 }, 5);
});

it('does not turn a remote overlap included in an own ACK into a newer-version overwrite', async () => {
  const host = mount();
  let acceptFirst!: (result: { state: Json; version: number }) => void;
  const change = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acceptFirst = resolve;
        }),
    )
    .mockRejectedValueOnce(new Error('共享字段 b 存在冲突'));
  await act(async () =>
    host.root.render(
      <EmbedObject
        kind="html"
        value={{ ...region, state: { a: 0, b: 0 } }}
        annotation={false}
        interactive
        onSelection={() => {}}
        onSaveState={change}
      />,
    ),
  );
  const runtime = await connectRuntime(host, host.dom.window.document.querySelector('iframe')!);
  await act(async () => {
    runtime.save({ a: 1, b: 0 });
    runtime.save({ a: 1, b: 1 });
  });
  await act(async () => acceptFirst({ state: { a: 1, b: 2 }, version: 5 }));
  expect(change).toHaveBeenNthCalledWith(2, { a: 1, b: 1 }, 4);
  expect(runtime.load()).toEqual({ a: 1, b: 1 });
  expect(host.dom.window.document.querySelector('[role="alert"]')?.textContent).toContain(
    '存在冲突',
  );
  expect(host.dom.window.document.querySelector('pre')?.textContent).toContain('"b": 2');
  await act(async () =>
    [...host.dom.window.document.querySelectorAll('button')]
      .find((button) => button.textContent === '使用共享状态')!
      .click(),
  );
  expect(runtime.load()).toEqual({ a: 1, b: 2 });
});

it('lets two real iframe regions progress independently and pauses unsent intent after edit permission is removed', async () => {
  const host = mount();
  let acceptFirst!: (result: { state: Json; version: number }) => void;
  const firstChange = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acceptFirst = resolve;
        }),
    )
    .mockResolvedValueOnce({ state: { votes: 3 }, version: 6 });
  const secondChange = vi.fn().mockResolvedValue({ state: { votes: 2 }, version: 5 });
  const render = (writable: boolean) =>
    host.root.render(
      <>
        <EmbedObject
          kind="html"
          value={region}
          annotation={false}
          interactive
          onSelection={() => {}}
          onSaveState={writable ? firstChange : undefined}
        />
        <EmbedObject
          kind="html"
          value={{ ...region, id: 'second-region' }}
          annotation={false}
          interactive
          onSelection={() => {}}
          onSaveState={secondChange}
        />
      </>,
    );
  await act(async () => render(true));
  const frames = host.dom.window.document.querySelectorAll('iframe');
  const first = await connectRuntime(host, frames[0]!);
  const second = await connectRuntime(host, frames[1]!);
  await act(async () => {
    first.save({ votes: 2 });
    first.save({ votes: 3 });
    second.save({ votes: 2 });
  });
  expect(firstChange).toHaveBeenCalledTimes(1);
  expect(secondChange).toHaveBeenCalledTimes(1);
  expect(second.load()).toEqual({ votes: 2 });
  await act(async () => render(false));
  await act(async () => render(true));
  await act(async () => acceptFirst({ state: { votes: 2 }, version: 5 }));
  expect(firstChange).toHaveBeenCalledTimes(1);
  expect(first.load()).toEqual({ votes: 3 });
  expect(host.dom.window.document.querySelector('[role="alert"]')?.textContent).toContain(
    '编辑权限已变更',
  );
  expect(firstChange).toHaveBeenCalledTimes(1);
  await act(async () =>
    [...host.dom.window.document.querySelectorAll('button')]
      .find((button) => button.textContent === '重试保存')!
      .click(),
  );
  expect(firstChange).toHaveBeenNthCalledWith(2, { votes: 3 }, 5);
});
