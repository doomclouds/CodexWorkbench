import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  DocumentObject,
  documentExtension,
} from '../../../src/ui/domain/objects/document/index.js';
import type {
  DocumentCommit,
  DocumentCommitResult,
  DocumentContent,
  DocumentObjectProps,
  DocumentValue,
} from '../../../src/ui/domain/objects/document/index.js';
import { createControlFixture } from '../../support/render-control.js';

const first = '第一处文本';
const second = '第二处文本';
const latestTitle = '远端的新标题';
const documentName = '交互记录';

const initial: DocumentValue = {
  version: 4,
  title: documentName,
  document: {
    schemaVersion: 1,
    blocks: [
      { id: 'alpha', type: 'heading', props: { level: 2 }, content: first },
      { id: 'beta', type: 'paragraph', props: {}, content: second },
      { id: 'step-a', type: 'numberedListItem', props: {}, content: '步骤一' },
      { id: 'step-b', type: 'numberedListItem', props: {}, content: '步骤二' },
      {
        id: 'table',
        type: 'table',
        props: {},
        content: {
          type: 'tableContent',
          rows: [{ cells: ['字符串单元格', '另一个单元格'] }],
        },
      },
    ],
  },
};

function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '');
}

function closeDialog(this: HTMLDialogElement) {
  this.removeAttribute('open');
}

if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { value: showModal, configurable: true },
    close: { value: closeDialog, configurable: true },
  });
}

function rect() {
  return new DOMRect();
}

function rects() {
  return [];
}

if (typeof Range.prototype.getBoundingClientRect !== 'function') {
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    value: rect,
    configurable: true,
  });
}
if (typeof Range.prototype.getClientRects !== 'function') {
  Object.defineProperty(Range.prototype, 'getClientRects', { value: rects, configurable: true });
}

const scrollBlock = vi.fn();
if (typeof HTMLElement.prototype.scrollIntoView !== 'function') {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    value: scrollBlock,
    configurable: true,
  });
}

function scrollTo(this: HTMLElement, options: ScrollToOptions) {
  this.scrollTop = options.top ?? this.scrollTop;
  this.scrollLeft = options.left ?? this.scrollLeft;
}

function scrollBy(this: HTMLElement, options: ScrollToOptions) {
  this.scrollTop += options.top ?? 0;
  this.scrollLeft += options.left ?? 0;
}

if (typeof HTMLElement.prototype.scrollTo !== 'function') {
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: scrollTo, configurable: true });
}
if (typeof HTMLElement.prototype.scrollBy !== 'function') {
  Object.defineProperty(HTMLElement.prototype, 'scrollBy', { value: scrollBy, configurable: true });
}

let fixture: ReturnType<typeof createControlFixture>;

beforeEach(() => {
  fixture = createControlFixture();
});

afterEach(() => {
  fixture.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.getSelection()?.removeAllRanges();
});

function render(props: Partial<DocumentObjectProps> = {}) {
  fixture.render(<DocumentObject value={initial} {...props} />);
}

function query<T extends HTMLElement>(selector: string, root: ParentNode = document) {
  const node = root.querySelector<T>(selector);
  if (!node) {
    throw new Error('Missing document control ' + selector);
  }

  return node;
}

function readRegion(root: ParentNode = document) {
  return query<HTMLDivElement>('[aria-label="文档正文"]', root);
}

function button(name: string) {
  const match = Array.from(document.querySelectorAll('button')).find(
    (node) => node.getAttribute('aria-label') === name || node.textContent?.trim() === name,
  );

  if (!match) {
    throw new Error('Missing document action ' + name);
  }

  return match;
}

function click(name: string) {
  act(() => button(name).click());
}

function updateInput(input: HTMLInputElement, value: string) {
  const property = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  act(() => {
    property?.set?.call(input, value);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
  });
}

function documentTitle() {
  return query<HTMLInputElement>('dialog [data-document-view="edit"] input:not([type="search"])');
}

async function openEditor() {
  click('编辑文档');
  await loadEditor();
}

async function loadEditor() {
  await act(() => vi.dynamicImportSettled());
  await vi.waitFor(() =>
    expect(
      document.querySelector('[data-document-editor] [contenteditable="true"]'),
    ).not.toBeNull(),
  );
}

function changeTitle(title: string) {
  updateInput(documentTitle(), title);
}

function clock(ms = 650) {
  return act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function saveReply(commit: DocumentCommit): DocumentCommitResult {
  return {
    ok: true,
    value: { title: commit.title, document: commit.document, version: commit.expectedVersion + 1 },
  };
}

function deferredSave() {
  let accept: ((result: DocumentCommitResult) => void) | undefined;
  const result = new Promise<DocumentCommitResult>((resolve) => {
    accept = resolve;
  });

  return { result, accept };
}

function positionDocumentBlocks() {
  const surface = query('.studio-document-surface');
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 400, 400));
  const firstBlock = query('[data-document-read-block="alpha"]');
  vi.spyOn(firstBlock, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 174, 200, 30));

  return firstBlock;
}

it('preserves numbered lists, heading depth and valid legacy string table cells in the reader', () => {
  render();
  const reader = readRegion(fixture.host);
  expect(query('article h2', reader).textContent).toBe(first);
  expect(
    Array.from(reader.querySelectorAll('ol > li > .studio-document-list-line > div')).map(
      (item) => item.textContent,
    ),
  ).toEqual(['步骤一', '步骤二']);
  expect(
    Array.from(reader.querySelectorAll('ol > li .studio-document-list-marker')).map(
      (marker) => marker.textContent,
    ),
  ).toEqual(['1.', '2.']);
  expect(query('td', reader).textContent).toBe('字符串单元格');
  expect(fixture.host.querySelector('[contenteditable]')).toBeNull();
});

it('retains the inline and expanded scroll position across opening and returning', async () => {
  render();
  const inline = readRegion(fixture.host);
  act(() => {
    inline.scrollTop = 135;
    inline.dispatchEvent(new Event('scroll'));
  });
  click('放大阅读');
  const expanded = readRegion(query('dialog'));
  expect(expanded.scrollTop).toBe(0);
  act(() => {
    expanded.scrollTop = 350;
    expanded.dispatchEvent(new Event('scroll'));
  });
  await act(async () => button('返回画板').click());
  expect(readRegion(fixture.host).scrollTop).toBe(135);
  click('放大阅读');
  expect(readRegion(query('dialog')).scrollTop).toBe(350);
});

function sendPan(type: string, area: HTMLElement, button: number, y: number) {
  const event = new MouseEvent(type, { button, clientY: y, bubbles: true, cancelable: true });
  act(() => {
    area.dispatchEvent(event);
  });

  return event;
}

it.each([0, 1])(
  'scrolls the expanded document with space or middle drag and keeps wheel ownership scoped',
  (pressed) => {
    render();
    click('放大阅读');
    const reading = readRegion(query('dialog'));
    if (pressed === 0) {
      act(() => {
        reading.dispatchEvent(
          new KeyboardEvent('keydown', {
            code: 'Space',
            key: ' ',
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    }

    expect(sendPan('pointerdown', reading, pressed, 170).defaultPrevented).toBe(true);
    sendPan('pointermove', reading, pressed, 120);
    expect(reading.scrollTop).toBe(50);
    sendPan('pointerup', reading, pressed, 120);
    const plain = new WheelEvent('wheel', { deltaY: 15, bubbles: true, cancelable: true });
    const zoom = new WheelEvent('wheel', {
      deltaY: 15,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      reading.dispatchEvent(plain);
      reading.dispatchEvent(zoom);
    });
    expect(plain.defaultPrevented).toBe(false);
    expect(zoom.defaultPrevented).toBe(true);
  },
);

it('keeps explicit paper ink and a transparent paper backdrop independent from the UI theme', () => {
  const paper = {
    fill: 'transparent',
    ink: '#fff8ee',
    backdrop: '#1a201f',
    scheme: 'dark',
  } as const;
  render({ paper, theme: 'light' });
  const inline = query('.studio-document-surface', fixture.host);
  expect(inline.style.backgroundColor).toBe('rgb(26, 32, 31)');
  expect(query('.studio-document-paper', inline).style.backgroundColor).toBe('transparent');
  expect(query('.studio-document-paper', inline).style.color).toBe('rgb(255, 248, 238)');
  click('放大阅读');
  const expanded = query('.studio-document-surface', query('dialog'));
  expect(expanded.style.backgroundColor).toBe(inline.style.backgroundColor);
  expect(expanded.dataset.paperScheme).toBe('dark');
});

it('opens the clicked paragraph in the real editor and consumes the writing request once', async () => {
  render();
  const paragraph = query('[data-document-read-block="beta"] p', fixture.host);
  await act(async () => paragraph.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  await loadEditor();
  const selection = document.getSelection();
  const anchor = selection?.anchorNode?.parentElement?.closest('[data-id]');
  expect(anchor?.getAttribute('data-id')).toBe('beta');
  await act(async () => button('返回画板').click());
  click('放大阅读');
  expect(query('dialog .studio-document-surface').dataset.documentView).toBe('read');
  expect(document.querySelector('[data-document-editor]')).toBeNull();
});

function editorParagraph(id: string) {
  return query('[data-document-editor] [data-id="' + id + '"] p');
}

async function typeBody(node: HTMLElement, text: string) {
  await act(async () => {
    node.textContent = text;
    node.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
  });
}

function sendComposition(node: HTMLElement, action: 'compositionstart' | 'compositionend') {
  act(() => {
    node.dispatchEvent(new CompositionEvent(action, { bubbles: true }));
  });
}

async function completeFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });
}

it('publishes an edited block through the real editor and keeps vendor document metadata', async () => {
  const onChange = vi.fn();
  render({ onChange });
  await openEditor();
  await typeBody(editorParagraph('beta'), '实际正文编辑');
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({
      document: expect.objectContaining({
        schemaVersion: 1,
        blocks: expect.arrayContaining([
          expect.objectContaining({
            id: 'beta',
            content: expect.arrayContaining([expect.objectContaining({ text: '实际正文编辑' })]),
          }),
        ]),
      }),
    }),
  );
});

it('publishes a completed IME input once and skips a cancelled composition', async () => {
  const onChange = vi.fn();
  render({ onChange });
  await openEditor();
  const target = editorParagraph('beta');
  sendComposition(target, 'compositionstart');
  sendComposition(target, 'compositionend');
  await completeFrame();
  expect(onChange).not.toHaveBeenCalled();
  sendComposition(target, 'compositionstart');
  await typeBody(target, '中文输入');
  expect(onChange).not.toHaveBeenCalled();
  sendComposition(editorParagraph('beta'), 'compositionend');
  await completeFrame();
  expect(onChange).toHaveBeenCalledTimes(1);
});

it('navigates the reader from the first search result and exposes the real heading outline', () => {
  render({ readOnly: true });
  click('放大阅读');
  updateInput(query<HTMLInputElement>('input[type="search"]'), '处文本');
  expect(query('[data-document-current]').textContent).toBe(first);
  act(() => {
    query('input[type="search"]').dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(query('[data-document-current]').textContent).toBe(second);
  expect(query('select option[value="alpha"]').textContent).toBe(first);
  expect(document.querySelector('[aria-label="编辑文档"]')).toBeNull();
});

it.each([{ ctrlKey: true }, { metaKey: true }])(
  'scopes reader select all and annotation to this document',
  (modifiers) => {
    const onAnnotate = vi.fn();
    render({ onAnnotate });
    positionDocumentBlocks();
    const reader = readRegion();
    const selectAll = new KeyboardEvent('keydown', {
      key: 'a',
      bubbles: true,
      cancelable: true,
      ...modifiers,
    });
    act(() => {
      reader.dispatchEvent(selectAll);
    });
    expect(selectAll.defaultPrevented).toBe(true);
    expect(document.getSelection()?.toString()).toContain(second);
    click('标注所选段落');
    expect(onAnnotate).toHaveBeenCalledWith(
      expect.objectContaining({
        version: initial.version,
        blockIds: expect.arrayContaining(['alpha', 'beta']),
        u: 0.5,
        v: 0.2,
      }),
    );
  },
);

it('keeps export options inside the document and hands a canonical draft to the injected action', async () => {
  const onExport = vi.fn();
  render({ onExport });
  click('导出文档');
  await act(async () => button('块 JSON').click());
  expect(onExport).toHaveBeenCalledWith(
    'json',
    expect.objectContaining({ title: documentName, document: initial.document }),
    expect.any(AbortSignal),
  );
  expect(document.querySelector('[aria-label="文档导出格式"]')).toBeNull();
});

it('saves the dirty writable document before sending the confirmed snapshot to export', async () => {
  const onCommit = vi.fn((commit: DocumentCommit) => Promise.resolve(saveReply(commit)));
  const onExport = vi.fn();
  render({ onCommit, onExport });
  await openEditor();
  vi.useFakeTimers();
  changeTitle('即将导出的标题');
  click('导出文档');
  await act(async () => button('全文 HTML').click());

  expect(onCommit).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ title: '即将导出的标题', expectedVersion: initial.version }),
  );
  expect(onExport).toHaveBeenCalledExactlyOnceWith(
    'html',
    expect.objectContaining({ title: '即将导出的标题' }),
    expect.any(AbortSignal),
  );
});

it('exports only confirmed content for a reader with a retained local draft', async () => {
  const onCommit = vi.fn((commit: DocumentCommit) => Promise.resolve(saveReply(commit)));
  const onExport = vi.fn();
  render({ onCommit, onExport });
  await openEditor();
  vi.useFakeTimers();
  changeTitle('仅本地草稿');
  render({ onCommit, onExport, readOnly: true });
  click('导出文档');
  await act(async () => button('块 JSON').click());

  expect(onCommit).not.toHaveBeenCalled();
  expect(onExport).toHaveBeenCalledExactlyOnceWith(
    'json',
    { title: initial.title, document: initial.document },
    expect.any(AbortSignal),
  );
});

it('downloads real Canvas Markdown, HTML, and block JSON', async () => {
  const View = documentExtension.View;
  type ViewProps = Parameters<typeof View>[0];
  type Download = NonNullable<ViewProps['downloadFile']>;
  const downloadFile = vi.fn<Download>();
  const request = vi.fn();
  const geometry = { x: 0, y: 0, width: 680, height: 560, rotation: 0 };
  const title = '研讨/<脚本>';
  const value = {
    ...initial,
    title,
    document: {
      schemaVersion: 1,
      blocks: [
        { id: 'script', type: 'paragraph', props: {}, content: '<script>内容</script>' },
        { id: 'count', type: 'numberedListItem', props: { start: 3 }, content: '第三项' },
        {
          id: 'checked',
          type: 'checkListItem',
          props: { checked: true },
          content: '主任务',
          children: [{ id: 'nested', type: 'bulletListItem', props: {}, content: '子任务' }],
        },
        { id: 'heading', type: 'heading', props: { level: 2 }, content: '发版说明' },
        {
          id: 'link',
          type: 'paragraph',
          props: {},
          content: [
            { type: 'text', text: '入口 ', styles: { bold: true } },
            { type: 'link', href: 'https://example.test/a', content: [{ text: '官网' }] },
            { type: 'link', href: 'javascript:alert(1)', content: [{ text: '无效链接' }] },
          ],
        },
        { id: 'code', type: 'codeBlock', props: { language: 'ts' }, content: '  const ok = true;' },
        {
          id: 'image',
          type: 'image',
          props: { url: '/studio-archive-assets/private-board/private-image', caption: '图片标题' },
        },
        {
          id: 'grid',
          type: 'table',
          props: {},
          content: { headerRows: 1, rows: [{ cells: ['姓名', '说明'] }, { cells: ['甲', 'A|B'] }] },
        },
      ],
    },
  };
  fixture.render(
    <View
      object={{ kind: 'document', label: title, geometry }}
      geometry={geometry}
      payload={{ version: 4, value }}
      zoom={1}
      interactive
      selected
      readOnly
      request={request}
      downloadFile={downloadFile}
    />,
  );
  click('导出文档');
  await act(async () => button('全文 HTML').click());
  click('导出文档');
  await act(async () => button('块 JSON').click());
  click('导出文档');
  await act(async () => button('全文 Markdown').click());

  const [html, json, markdown] = downloadFile.mock.calls.map(([file]) => file);
  if (!html || !json || !markdown) {
    throw new Error('Expected the three document export options');
  }

  const output = new TextDecoder().decode(html.content);
  expect(html.filename).toBe('研讨--脚本-.html');
  expect(html.mimeType).toBe('text/html');
  expect(output).toContain('<ol start="3">');
  expect(output).toContain('&lt;script&gt;内容&lt;/script&gt;');
  expect(output).not.toContain('<script>');
  expect(JSON.parse(new TextDecoder().decode(json.content))).toEqual({
    title,
    document: value.document,
  });
  expect(markdown.filename).toBe('研讨--脚本-.md');
  expect(markdown.mimeType).toBe('text/markdown;charset=utf-8');
  const written = new TextDecoder().decode(markdown.content);
  expect(written).toContain('\\<script\\>内容\\</script\\>');
  expect(written).toContain('3. 第三项');
  expect(written).toContain('- [x] 主任务\n\n  - 子任务');
  expect(written).toContain('## 发版说明');
  expect(written).toContain('**入口** [官网](https://example.test/a)无效链接');
  expect(written).toContain('```ts\n  const ok = true;\n```');
  expect(written).toContain('图片：图片标题');
  expect(written).toContain('| 姓名 | 说明 |\n| --- | --- |\n| 甲 | A\\|B |');
  expect(written).not.toContain('private-board');
  expect(written).not.toContain('javascript:');
  expect(request).not.toHaveBeenCalled();
});

const archivedImageFixtures = [
  {
    mimeType: 'image/png',
    content: new Uint8Array([137, 80, 78, 71]),
    encoded: 'iVBORw==',
  },
  {
    mimeType: 'image/svg+xml',
    content: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    encoded: 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',
  },
];

it.each(archivedImageFixtures)(
  'renders and exports authorized private $mimeType bytes',
  async ({ mimeType, content, encoded }) => {
    const View = documentExtension.View;
    type ViewProps = Parameters<typeof View>[0];
    type Download = NonNullable<ViewProps['downloadFile']>;
    type Asset = { mimeType: string; content: Uint8Array };
    type ReadAsset = (source: string, signal?: AbortSignal) => Promise<Asset>;
    const downloadFile = vi.fn<Download>();
    const readDocumentAsset = vi.fn<ReadAsset>().mockResolvedValue({ mimeType, content });
    const archived = '/studio-archive-assets/test-board/image-paragraph';
    const publicImage = 'https://example.test/never-read-for-export.png';
    const value = {
      ...initial,
      document: {
        schemaVersion: 1,
        blocks: [
          { id: 'private-image', type: 'image', props: { url: archived, caption: '正文附件' } },
          { id: 'external-image', type: 'image', props: { url: publicImage, caption: '外部示意' } },
        ],
      },
    };
    const geometry = { x: 0, y: 0, width: 680, height: 560, rotation: 0 };
    const injected = { downloadFile, readDocumentAsset };
    fixture.render(
      <View
        object={{ kind: 'document', label: value.title, geometry }}
        geometry={geometry}
        payload={{ version: 4, value }}
        zoom={1}
        interactive
        selected
        readOnly
        request={vi.fn()}
        {...injected}
      />,
    );
    const source = 'data:' + mimeType + ';base64,' + encoded;
    await act(() => Promise.resolve());
    expect(query('img[alt="正文附件"]').getAttribute('src')).toBe(source);
    click('导出文档');
    await act(async () => button('全文 HTML').click());
    const file = downloadFile.mock.calls[0]?.[0];
    if (!file) {
      throw new Error('Expected the confirmed document export');
    }

    expect(readDocumentAsset.mock.calls.map(([source]) => source)).toEqual([archived, archived]);
    const output = new TextDecoder().decode(file.content);
    expect(output).toContain(source);
    expect(output).not.toContain(publicImage);
    expect(output).toContain('图片尚未嵌入 · 外部示意');
  },
);

it('uses the original automatic white ink on a dark Canvas document fill', () => {
  const View = documentExtension.View;
  const geometry = { x: 0, y: 0, width: 680, height: 560, rotation: 0 };
  fixture.render(
    <View
      object={{ kind: 'document', label: documentName, fill: '#181a22', geometry }}
      geometry={geometry}
      payload={{ version: initial.version, value: initial }}
      zoom={1}
      interactive
      selected
      readOnly
      request={vi.fn()}
    />,
  );
  const paper = query<HTMLElement>('.studio-document-surface', fixture.host);
  expect(paper.dataset.paperScheme).toBe('dark');
  expect(paper.style.color).toBe('rgb(245, 245, 245)');
  expect(paper.style.getPropertyValue('--studio-document-paper')).toBe('#181a22');
});

it('takes the actual paragraph target from a click or keyboard activation in note mode', () => {
  const onAnnotate = vi.fn();
  render({ onAnnotate, annotationActive: true });
  const paragraph = positionDocumentBlocks();
  expect(paragraph.tabIndex).toBe(0);
  const clickPoint = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    clientX: 250,
    clientY: 180,
  });
  act(() => {
    paragraph.dispatchEvent(clickPoint);
  });
  expect(clickPoint.defaultPrevented).toBe(true);
  expect(onAnnotate).toHaveBeenNthCalledWith(1, {
    version: initial.version,
    blockIds: ['alpha'],
    quote: first,
    u: 0.375,
    v: 0.2,
  });

  act(() => {
    paragraph.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  expect(onAnnotate).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ blockIds: ['alpha'], u: 0.5, v: 0.2 }),
  );
});

it('keeps new typing after a delayed save and writes it with the acknowledged version before returning', async () => {
  const pending = deferredSave();
  const calls = vi
    .fn()
    .mockImplementationOnce(() => pending.result)
    .mockImplementation((commit: DocumentCommit) => Promise.resolve(saveReply(commit)));
  render({ onCommit: calls });
  await openEditor();
  vi.useFakeTimers();
  changeTitle('第一次修改');
  await clock();
  expect(calls).toHaveBeenCalledWith(
    expect.objectContaining({ expectedVersion: 4, title: '第一次修改' }),
  );
  changeTitle('第二次修改');
  click('返回画板');
  expect(document.querySelector('dialog')).not.toBeNull();
  await act(async () =>
    pending.accept?.({ ok: true, value: { ...initial, version: 5, title: '第一次修改' } }),
  );
  expect(calls).toHaveBeenCalledWith(
    expect.objectContaining({ expectedVersion: 5, title: '第二次修改' }),
  );
  expect(document.querySelector('dialog')).toBeNull();
  expect(fixture.host.textContent).toContain('第二次修改');
});

it('uses a newer canonical version when an older acknowledgement arrives after a remote edit', async () => {
  const pending = deferredSave();
  const onCommit = vi.fn(() => pending.result);
  render({ onCommit });
  await openEditor();
  vi.useFakeTimers();
  changeTitle('等待确认的标题');
  await clock();
  expect(onCommit).toHaveBeenCalledTimes(1);
  render({ value: { ...initial, title: latestTitle, version: 7 }, onCommit });
  expect(documentTitle().value).toBe('等待确认的标题');
  await act(async () =>
    pending.accept?.({ ok: true, value: { ...initial, version: 5, title: '等待确认的标题' } }),
  );
  expect(documentTitle().value).toBe(latestTitle);
});

it('submits a dirty title with a new geometry version while the canonical document remains the same', async () => {
  const onCommit = vi.fn((commit: DocumentCommit) => Promise.resolve(saveReply(commit)));
  render({ onCommit });
  await openEditor();
  vi.useFakeTimers();
  changeTitle('变形后的草稿');
  render({ value: { ...initial, version: 5 }, onCommit });
  await clock();
  expect(onCommit).toHaveBeenCalledWith(
    expect.objectContaining({ title: '变形后的草稿', expectedVersion: 5 }),
  );
});

it('retains a rejected draft without retrying automatically and compares it against the latest version', async () => {
  const result = {
    ok: false,
    message: '版本冲突',
    current: { ...initial, version: 8, title: latestTitle },
  } as const;
  const onCommit = vi
    .fn()
    .mockResolvedValueOnce(result)
    .mockImplementation((commit: DocumentCommit) => Promise.resolve(saveReply(commit)));
  render({ onCommit });
  await openEditor();
  vi.useFakeTimers();
  changeTitle('保留我的草稿');
  await clock();
  await clock(2000);
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(documentTitle().value).toBe('保留我的草稿');
  click('比较最新内容');
  expect(query('[aria-label="比较文档草稿"]').textContent).toContain(latestTitle);
  await act(async () => button('保存此草稿').click());
  expect(onCommit).toHaveBeenCalledWith(
    expect.objectContaining({
      title: '保留我的草稿',
      expectedVersion: 8,
      overwrite: true,
    }),
  );
});

function remoteDocument(version: number, title: string, heading: string): DocumentValue {
  const blocks = initial.document.blocks.map((block) =>
    block.id === 'alpha' ? { ...block, content: heading } : block,
  );
  blocks.push({ id: 'remote-added', type: 'paragraph', props: {}, content: '远端新增段落' });

  return { version, title, document: { schemaVersion: 1, blocks } };
}

it('replays only actual BlockNote edits over the latest remote blocks and title after comparison', async () => {
  const latest = remoteDocument(8, latestTitle, '远端修改的标题块');
  const remote = {
    ...latest,
    document: {
      ...latest.document,
      blocks: latest.document.blocks.map((block) =>
        block.id === 'beta' ? { ...block, props: { backgroundColor: 'red' } } : block,
      ),
    },
  };
  const save = vi
    .fn<(commit: DocumentCommit) => Promise<DocumentCommitResult>>()
    .mockResolvedValueOnce({ ok: false, current: remote, message: '版本冲突' })
    .mockImplementation(async (commit) => saveReply(commit));
  render({ onCommit: save });
  await openEditor();
  await typeBody(editorParagraph('beta'), '本地修改的正文');
  await act(() => vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 2000 }));
  click('比较最新内容');
  await act(async () => button('保存此草稿').click());

  const commit = save.mock.calls[1]?.[0];
  expect(commit).toMatchObject({ title: latestTitle, expectedVersion: 8 });
  expect(commit?.document.blocks.find(({ id }) => id === 'alpha')).toEqual(
    remote.document.blocks[0],
  );
  expect(commit?.document.blocks.find(({ id }) => id === 'remote-added')).toEqual(
    remote.document.blocks.at(-1),
  );
  expect(commit?.document.blocks.find(({ id }) => id === 'beta')).toMatchObject({
    props: { backgroundColor: 'red' },
    content: expect.arrayContaining([expect.objectContaining({ text: '本地修改的正文' })]),
  });
});

function paragraphBlock(id: string, content = id) {
  return { id, type: 'paragraph', props: {}, content } as const;
}

function structureValue(version: number, blocks: DocumentContent['blocks']): DocumentValue {
  return { version, title: '文档结构', document: { schemaVersion: 1, blocks } };
}

function editorBlock(id: string) {
  return query<HTMLDivElement>(
    `[data-document-editor] [data-node-type="blockOuter"][data-id="${id}"]`,
  );
}

async function editStructure(change: () => void) {
  const root = query('[data-document-editor] [contenteditable="true"]');
  await act(async () => {
    change();
    root.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
  });
}

it('replays a block insertion, removal and move while keeping an unrelated remote block', async () => {
  const first = paragraphBlock('one');
  const second = paragraphBlock('two');
  const third = paragraphBlock('three');
  const fourth = paragraphBlock('four');
  const remoteOnly = paragraphBlock('remote-only');
  const base = structureValue(4, [first, second, third, fourth]);
  const remote = structureValue(8, [remoteOnly, first, second, third, fourth]);
  const save = vi
    .fn<(commit: DocumentCommit) => Promise<DocumentCommitResult>>()
    .mockResolvedValueOnce({ ok: false, current: remote, message: '版本冲突' })
    .mockImplementation(async (commit) => saveReply(commit));
  render({ value: base, onCommit: save });
  await openEditor();
  await editStructure(() => {
    const before = editorBlock('one');
    const moved = editorBlock('four');
    const added = moved.cloneNode(true) as HTMLDivElement;
    added.dataset.id = 'added';
    query('[data-node-type="blockContainer"]', added).dataset.id = 'added';
    query('p', added).textContent = '本地新增';
    before.after(moved, added);
    editorBlock('three').remove();
  });
  await act(() => vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 2000 }));
  expect(save.mock.calls[0]?.[0].document.blocks.map(({ id }) => id)).toEqual([
    'one',
    'four',
    'added',
    'two',
  ]);
  click('比较最新内容');
  await act(async () => button('保存此草稿').click());

  expect(save.mock.calls[1]?.[0].document.blocks.map(({ id }) => id)).toEqual([
    'remote-only',
    'one',
    'four',
    'added',
    'two',
  ]);
});

it('retains a child a collaborator moved outside the subtree removed by the local editor', async () => {
  const parent = paragraphBlock('parent');
  const child = paragraphBlock('child');
  const sibling = paragraphBlock('sibling');
  const base = structureValue(4, [{ ...parent, children: [child] }, sibling]);
  const remote = structureValue(8, [parent, child, sibling]);
  const save = vi
    .fn<(commit: DocumentCommit) => Promise<DocumentCommitResult>>()
    .mockResolvedValueOnce({ ok: false, current: remote, message: '版本冲突' })
    .mockImplementation(async (commit) => saveReply(commit));
  render({ value: base, onCommit: save });
  await openEditor();
  await editStructure(() => editorBlock('parent').remove());
  await act(() => vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 2000 }));
  expect(save.mock.calls[0]?.[0].document.blocks).toEqual([sibling]);
  click('比较最新内容');
  await act(async () => button('保存此草稿').click());

  expect(save.mock.calls[1]?.[0].document.blocks).toEqual([child, sibling]);
});

it('keeps the original local edits for another comparison when the replay also conflicts', async () => {
  const firstRemote = remoteDocument(8, latestTitle, '第一次远端修改');
  const secondRemote = remoteDocument(9, '远端再改标题', '第二次远端修改');
  const save = vi
    .fn<(commit: DocumentCommit) => Promise<DocumentCommitResult>>()
    .mockResolvedValueOnce({ ok: false, current: firstRemote, message: '版本冲突' })
    .mockResolvedValueOnce({ ok: false, current: secondRemote, message: '版本再次冲突' })
    .mockImplementation(async (commit) => saveReply(commit));
  render({ onCommit: save });
  await openEditor();
  changeTitle('本地标题');
  await typeBody(editorParagraph('beta'), '本地正文');
  await act(() => vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 2000 }));
  click('比较最新内容');
  await act(async () => button('保存此草稿').click());
  expect(query('[aria-label="比较文档草稿"]').textContent).toContain('第二次远端修改');
  await act(async () => button('保存此草稿').click());

  const commit = save.mock.calls[2]?.[0];
  expect(commit).toMatchObject({ title: '本地标题', expectedVersion: 9 });
  expect(commit?.document.blocks.find(({ id }) => id === 'alpha')).toEqual(
    secondRemote.document.blocks[0],
  );
  expect(commit?.document.blocks.find(({ id }) => id === 'beta')?.content).toEqual(
    expect.arrayContaining([expect.objectContaining({ text: '本地正文' })]),
  );
});

it('retains the comparison and performs no write when a remote edit deleted the locally edited block', async () => {
  const current: DocumentValue = {
    version: 8,
    title: initial.title,
    document: {
      schemaVersion: 1,
      blocks: initial.document.blocks.filter(({ id }) => id !== 'beta'),
    },
  };
  const save = vi
    .fn<(commit: DocumentCommit) => Promise<DocumentCommitResult>>()
    .mockResolvedValueOnce({ ok: false, current, message: '版本冲突' });
  render({ onCommit: save });
  await openEditor();
  await typeBody(editorParagraph('beta'), '本地未保存正文');
  await act(() => vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 2000 }));
  click('比较最新内容');
  await act(async () => button('保存此草稿').click());

  expect(save).toHaveBeenCalledTimes(1);
  expect(query('[aria-label="比较文档草稿"]').textContent).toContain('本地未保存正文');
  expect(document.body.textContent).toContain('草稿已保留');
});

it('does not persist a draft after losing edit permission and keeps it available on re-entry', async () => {
  const onCommit = vi.fn((commit: DocumentCommit) => Promise.resolve(saveReply(commit)));
  render({ onCommit });
  await openEditor();
  vi.useFakeTimers();
  changeTitle('未提交标题');
  render({ onCommit, readOnly: true });
  await clock(1300);
  expect(onCommit).not.toHaveBeenCalled();
  expect(query<HTMLInputElement>('dialog input.studio-document-title').value).toBe('未提交标题');
});

it('cancels an unresolved image when the document unmounts', async () => {
  const resolveImage = vi.fn(
    (_source: string, _signal: AbortSignal) =>
      new Promise<string>((resolve) => {
        _signal.addEventListener('abort', () => resolve(''), { once: true });
      }),
  );
  const content: DocumentContent = {
    schemaVersion: 1,
    blocks: [{ id: 'diagram', type: 'image', props: { url: 'asset:diagram', caption: '画板图' } }],
  };
  render({ value: { ...initial, document: content }, resolveImage });
  await act(() => Promise.resolve());
  const [source, signal] = resolveImage.mock.calls[0] ?? [];
  expect(source).toBe('asset:diagram');
  expect(signal?.aborted).toBe(false);
  render({ value: initial });
  expect(signal?.aborted).toBe(true);
  expect(fixture.host.querySelector('img')).toBeNull();
});

it('routes a registered editor request and observes its confirmed document value', async () => {
  const View = documentExtension.View;
  if (!View) {
    throw new Error('Missing registered document view');
  }

  const request = vi.fn().mockResolvedValue({
    ok: true,
    payload: { version: 5, value: { ...initial, version: 5, title: '已确认标题' } },
  });
  const geometry = { x: 10, y: 20, width: 680, height: 480, rotation: 0 };
  fixture.render(
    <View
      object={{ kind: 'document', label: documentName, geometry }}
      geometry={geometry}
      payload={{ version: initial.version, value: initial }}
      selected
      interactive
      readOnly={false}
      zoom={1}
      editRequest={1}
      request={request}
    />,
  );
  await loadEditor();
  vi.useFakeTimers();
  changeTitle('准备保存的标题');
  await clock();
  expect(request).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'document.commit',
      expectedVersion: initial.version,
      value: expect.objectContaining({ title: '准备保存的标题', document: initial.document }),
    }),
  );
  expect(documentTitle().value).toBe('已确认标题');
  expect(documentExtension.capabilities.rotate).toBe(false);
});

it('keeps an expanded document mounted and releases clean inline content', async () => {
  const View = documentExtension.View;
  if (!View) {
    throw new Error('Missing registered document view');
  }

  const geometry = { x: 10, y: 20, width: 680, height: 480, rotation: 0 };
  const onRetentionChange = vi.fn();
  const request = vi.fn();
  fixture.render(
    <View
      object={{ kind: 'document', label: documentName, geometry }}
      geometry={geometry}
      payload={{ version: initial.version, value: initial }}
      selected
      interactive
      readOnly
      zoom={1}
      request={request}
      onRetentionChange={onRetentionChange}
    />,
  );
  expect(onRetentionChange).toHaveBeenLastCalledWith(false);
  click('展开文档');
  expect(onRetentionChange).toHaveBeenLastCalledWith(true);
  await act(async () => button('返回画板').click());
  expect(onRetentionChange).toHaveBeenLastCalledWith(false);
  expect(request).not.toHaveBeenCalled();
});

it('opens the registered document through the whiteboard presentation action', async () => {
  const View = documentExtension.View;
  if (!View) {
    throw new Error('Missing registered document view');
  }

  const geometry = { x: 10, y: 20, width: 680, height: 480, rotation: 0 };
  const request = vi.fn();
  const onOpenPresentation = vi.fn();
  fixture.render(
    <View
      object={{ kind: 'document', label: documentName, geometry }}
      geometry={geometry}
      payload={{ version: initial.version, value: initial }}
      selected
      interactive
      readOnly
      zoom={1}
      request={request}
      onOpenPresentation={onOpenPresentation}
    />,
  );

  const expand = button('展开文档');
  expect(expand.closest('[title]')?.getAttribute('title')).toBe('展开阅读与编辑');
  await act(async () => expand.click());

  expect(onOpenPresentation).toHaveBeenCalledOnce();
  expect(document.querySelector('dialog')).toBeNull();
  expect(readRegion(fixture.host).textContent).toContain(first);
  expect(request).not.toHaveBeenCalled();
});

it('uses one title and a keyboard-accessible outline in focused reading', () => {
  const value: DocumentValue = {
    ...initial,
    document: {
      ...initial.document,
      blocks: [
        ...initial.document.blocks,
        { id: 'omega', type: 'heading', props: { level: 2 }, content: '末章' },
      ],
    },
  };
  render({ value });
  const inline = readRegion(fixture.host);
  act(() => {
    inline.scrollTop = 135;
    inline.dispatchEvent(new Event('scroll'));
  });

  render({ value, focusedReading: true });

  const focused = query('[data-document-focused-reading]', fixture.host);
  const reading = readRegion(focused);
  expect(document.querySelector('dialog')).toBeNull();
  expect(
    Array.from(
      focused.querySelectorAll<HTMLInputElement>('input.studio-document-title'),
      (node) => node.value,
    ),
  ).toEqual([documentName]);
  const find = query<HTMLInputElement>('input[type="search"]', focused);
  expect(find.value).toBe('');
  expect(reading.scrollTop).toBe(0);
  updateInput(find, second);
  expect(query('[data-document-current]', focused).textContent).toBe(second);
  updateInput(find, '');

  const toggle = button('切换文档目录');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  click('切换文档目录');
  const heading = query<HTMLButtonElement>('nav[aria-label="文档目录"] button', focused);
  const end = button('末章');
  expect(heading.textContent).toBe(first);
  expect(heading.getAttribute('aria-current')).toBe('location');
  click('末章');
  expect(end.getAttribute('aria-current')).toBe('location');
  expect(heading.hasAttribute('aria-current')).toBe(false);

  vi.spyOn(reading, 'scrollHeight', 'get').mockReturnValue(1200);
  vi.spyOn(reading, 'clientHeight', 'get').mockReturnValue(400);
  const endPosition = vi
    .spyOn(query('[data-document-read-block="omega"] h2', reading), 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(0, 120, 100, 24));
  act(() => {
    reading.scrollTop = 100;
    reading.dispatchEvent(new Event('scroll'));
  });
  expect(heading.getAttribute('aria-current')).toBe('location');
  endPosition.mockReturnValue(new DOMRect(0, -15, 100, 24));
  act(() => {
    reading.scrollTop = 300;
    reading.dispatchEvent(new Event('scroll'));
  });
  expect(end.getAttribute('aria-current')).toBe('location');

  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  act(() => {
    heading.dispatchEvent(escape);
  });
  expect(escape.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');

  act(() => {
    reading.scrollTop = 350;
    reading.dispatchEvent(new Event('scroll'));
  });
  render();
  expect(readRegion(fixture.host).scrollTop).toBe(135);
  render({ focusedReading: true });
  expect(readRegion(fixture.host).scrollTop).toBe(350);
});

it.each([
  { scheme: 'light', fill: '#efefef' },
  { scheme: 'dark', fill: '#1c1d1e' },
] as const)(
  'places the $scheme paper return action inside the focused document header',
  async (paper) => {
    const onClosePresentation = vi.fn();
    render({ focusedReading: true, paper, onClosePresentation });

    const focused = query('[data-document-focused-reading]', fixture.host);
    const back = button('返回画板');
    expect(back.closest('header')).toBe(button('切换文档目录').closest('header'));
    expect(back.closest('[data-canvas-presentation-exit]')).not.toBeNull();
    const status = query<HTMLSpanElement>('.studio-document-canvas-save', focused);
    expect(query('[role="status"]', status).textContent).toBe('已保存');
    expect(status.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(focused.style.getPropertyValue('--studio-document-paper')).toBe(paper.fill);
    expect(focused.dataset.paperScheme).toBe(paper.scheme);
    await act(async () => button('返回画板').click());
    expect(onClosePresentation).toHaveBeenCalledOnce();
  },
);
