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

it('preserves numbered lists, heading depth and valid legacy string table cells in the reader', () => {
  render();
  const reader = readRegion(fixture.host);
  expect(query('article h2', reader).textContent).toBe(first);
  expect(Array.from(reader.querySelectorAll('ol > li')).map((item) => item.textContent)).toEqual([
    '步骤一',
    '步骤二',
  ]);
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
  await act(async () => button('返回白板').click());
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
  await act(async () => button('返回白板').click());
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
      }),
    );
  },
);

it('keeps export options inside the document and hands a canonical draft to the injected action', () => {
  const onExport = vi.fn();
  render({ onExport });
  click('导出文档');
  click('块 JSON');
  expect(onExport).toHaveBeenCalledWith(
    'json',
    expect.objectContaining({ title: documentName, document: initial.document }),
  );
  expect(document.querySelector('[aria-label="文档导出格式"]')).toBeNull();
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
  click('返回白板');
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

it('does not persist a draft after losing edit permission and keeps it available on re-entry', async () => {
  const onCommit = vi.fn((commit: DocumentCommit) => Promise.resolve(saveReply(commit)));
  render({ onCommit });
  await openEditor();
  vi.useFakeTimers();
  changeTitle('未提交标题');
  render({ onCommit, readOnly: true });
  await clock(1300);
  expect(onCommit).not.toHaveBeenCalled();
  expect(query('dialog .studio-document-title').textContent).toBe('未提交标题');
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
  await act(async () => button('返回白板').click());
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
  render();
  const inline = readRegion(fixture.host);
  act(() => {
    inline.scrollTop = 135;
    inline.dispatchEvent(new Event('scroll'));
  });

  render({ focusedReading: true });

  const focused = query('[data-document-focused-reading]', fixture.host);
  const reading = readRegion(focused);
  expect(document.querySelector('dialog')).toBeNull();
  expect(
    Array.from(focused.querySelectorAll('.studio-document-title'), (node) => node.textContent),
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
  expect(heading.textContent).toBe(first);
  act(() => heading.click());

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
    const back = button('返回白板');
    expect(back.closest('header')).toBe(button('切换文档目录').closest('header'));
    expect(back.closest('[data-canvas-presentation-exit]')).not.toBeNull();
    expect(focused.style.getPropertyValue('--studio-document-paper')).toBe(paper.fill);
    expect(focused.dataset.paperScheme).toBe(paper.scheme);
    await act(async () => button('返回白板').click());
    expect(onClosePresentation).toHaveBeenCalledOnce();
  },
);
