import { act } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type {
  ExportBoard,
  ExportBoardFile,
  ExportBoardFormat,
  ExportBoardResult,
} from '../../src/data/whiteboard/index.js';
import {
  WhiteboardExportSurface,
  type WhiteboardExportSurfaceProps,
} from '../../src/surfaces/whiteboard-export/index.js';
import { createControlFixture } from '../support/render-control.js';

const file: ExportBoardFile = {
  filename: '发布白板.svg',
  mimeType: 'image/svg+xml',
  revision: 12n,
  content: new TextEncoder().encode('<svg/>'),
};

const context = {
  boardId: 'release-board',
  title: '发布白板',
  revision: file.revision,
  selectedIds: ['frame', 'card'],
};

let anchor: HTMLButtonElement;
let fixture: ReturnType<typeof createControlFixture>;

function showModal(this: HTMLDialogElement) {
  this.open = true;
}

function closeModal(this: HTMLDialogElement) {
  this.open = false;
}

if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { value: showModal, configurable: true },
    close: { value: closeModal, configurable: true },
  });
}

beforeEach(() => {
  fixture = createControlFixture();
  anchor = document.createElement('button');
  anchor.textContent = '导出';
  document.body.append(anchor);
  anchor.focus();
});

afterEach(() => {
  fixture.dispose();
  anchor.remove();
});

function readElement<T extends Element>(selector: string): T {
  const element = fixture.host.querySelector<T>(selector);
  if (!element) {
    throw new Error('Missing export control ' + selector);
  }

  return element;
}

const formatRows = '.whiteboard-export__format';

function formatButton(format: ExportBoardFormat) {
  return readElement<HTMLButtonElement>('[data-export-format="' + format + '"]');
}

function dialog() {
  return readElement<HTMLDialogElement>('dialog[open]');
}

function dialogButton(label: string) {
  const button = [...dialog().querySelectorAll('button')].find(
    (candidate) => candidate.textContent === label,
  );

  if (!button) {
    throw new Error('Missing download dialog action ' + label);
  }

  return button;
}

function chooseSelection() {
  const select = readElement<HTMLSelectElement>('select');
  select.value = 'selection';
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function holdExport() {
  let resolve!: (result: ExportBoardResult) => void;
  const promise = new Promise<ExportBoardResult>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

function mount(exportBoard: ExportBoard) {
  const download = vi.fn<WhiteboardExportSurfaceProps['download']>();
  const onRequestClose = vi.fn();
  function render(overrides: Partial<WhiteboardExportSurfaceProps> = {}) {
    fixture.render(
      <WhiteboardExportSurface
        anchor={anchor}
        context={context}
        exportBoard={exportBoard}
        download={download}
        onRequestClose={onRequestClose}
        restoreFocus={() => anchor.focus()}
        {...overrides}
      />,
    );
  }

  render();

  return { download, onRequestClose, render };
}

test('shows the frozen selection file in a dialog and only downloads on confirmation', async () => {
  const request = holdExport();
  const exportBoard = vi.fn<ExportBoard>().mockReturnValue(request.promise);
  const surface = mount(exportBoard);
  expect(fixture.host.textContent).toContain('保存版次 12');
  expect(document.activeElement).toBe(readElement(formatRows));

  act(chooseSelection);
  await act(async () => formatButton('svg').click());
  expect(dialog().textContent).toContain('下载导出文件');
  expect(dialogButton('下载').disabled).toBe(true);
  expect(document.activeElement).toBe(dialogButton('取消'));
  expect(exportBoard).toHaveBeenCalledExactlyOnceWith(
    {
      boardId: context.boardId,
      expectedRevision: 12n,
      scope: { kind: 'selection', objectIds: ['frame', 'card'] },
      format: 'svg',
    },
    expect.any(AbortSignal),
  );
  surface.render({ context: { ...context, revision: 13n, selectedIds: ['later-object'] } });
  await act(async () => request.resolve({ kind: 'file', file }));

  expect(dialog().textContent).toContain(file.filename);
  expect(surface.download).not.toHaveBeenCalled();
  const downloadButton = dialogButton('下载');
  await act(async () => {
    downloadButton.click();
    downloadButton.click();
  });

  expect(surface.download).toHaveBeenCalledExactlyOnceWith(file, expect.any(AbortSignal));
  expect(fixture.host.querySelector('dialog[open]')).toBeNull();
  expect(document.activeElement).toBe(formatButton('svg'));
  expect(fixture.host.textContent).not.toContain('已发起下载');
});

test('retries the original export after a transport failure and waits for confirmation', async () => {
  const exportBoard = vi
    .fn<ExportBoard>()
    .mockRejectedValueOnce(new Error('连接已中断。'))
    .mockResolvedValueOnce({ kind: 'file', file });
  const surface = mount(exportBoard);
  surface.download.mockReturnValue({ kind: 'requested', message: '导出已交给浏览器。' });

  act(chooseSelection);
  await act(async () => formatButton('svg').click());
  expect(readElement('[role="status"]').textContent).toContain('连接已中断。');
  surface.render({ context: { ...context, selectedIds: ['different'] } });
  await act(async () => dialogButton('重试导出').click());

  expect(exportBoard.mock.calls[1]?.[0]).toEqual(exportBoard.mock.calls[0]?.[0]);
  expect(dialog().textContent).toContain(file.filename);
  expect(surface.download).not.toHaveBeenCalled();
  await act(async () => dialogButton('下载').click());
  expect(surface.download).toHaveBeenCalledExactlyOnceWith(file, expect.any(AbortSignal));
  expect(fixture.host.querySelector('dialog[open]')).toBeNull();
});

test('retries the same generated file after a download exception', async () => {
  const exportBoard = vi.fn<ExportBoard>().mockResolvedValue({ kind: 'file', file });
  const surface = mount(exportBoard);
  surface.download.mockImplementationOnce(() => {
    throw new Error('当前下载请求被阻止。');
  });

  await act(async () => formatButton('svg').click());
  await act(async () => dialogButton('下载').click());
  expect(readElement('[role="status"]').textContent).toContain('当前下载请求被阻止。');
  await act(async () => dialogButton('重试下载').click());

  expect(exportBoard).toHaveBeenCalledOnce();
  expect(surface.download.mock.calls.map(([downloaded]) => downloaded)).toEqual([file, file]);
  expect(fixture.host.querySelector('dialog[open]')).toBeNull();
});

test('shows a warning when the current host lacks a download capability', async () => {
  const exportBoard = vi.fn<ExportBoard>().mockResolvedValue({ kind: 'file', file });
  const surface = mount(exportBoard);
  const message = '当前宿主不提供文件下载。请在浏览器中打开白板后导出。';
  surface.download.mockResolvedValue({ kind: 'unavailable', message });

  await act(async () => formatButton('svg').click());
  await act(async () => dialogButton('下载').click());
  const status = readElement('[role="status"]');
  expect(status.getAttribute('data-tone')).toBe('warning');
  expect(status.textContent).toBe(message);
  expect(dialogButton('下载').disabled).toBe(true);
});

test('keeps a stale or rejected request visible without downloading a file', async () => {
  const exportBoard = vi
    .fn<ExportBoard>()
    .mockResolvedValueOnce({ kind: 'stale', revision: 13n })
    .mockResolvedValueOnce({ kind: 'rejected', reason: 'assetUnavailable' });
  const surface = mount(exportBoard);

  await act(async () => readElement<HTMLButtonElement>(formatRows).click());
  expect(readElement('[role="status"]').textContent).toContain('当前保存版次已变为 13');
  act(() => dialogButton('取消').click());

  await act(async () => readElement<HTMLButtonElement>(formatRows).click());
  expect(readElement('[role="status"]').textContent).toContain('素材已不可用');
  expect(surface.download).not.toHaveBeenCalled();
});

test('Escape cancels the download dialog, preserves the export list and aborts late responses', async () => {
  const request = holdExport();
  const exportBoard = vi.fn<ExportBoard>().mockReturnValue(request.promise);
  const surface = mount(exportBoard);

  await act(async () => formatButton('svg').click());
  act(() => {
    dialog().dispatchEvent(new Event('cancel', { cancelable: true }));
  });
  expect(surface.onRequestClose).not.toHaveBeenCalled();
  expect(exportBoard.mock.calls[0]?.[1]?.aborted).toBe(true);
  expect(document.activeElement).toBe(formatButton('svg'));
  await act(async () => request.resolve({ kind: 'file', file }));

  expect(fixture.host.querySelector('dialog[open]')).toBeNull();
  expect(surface.download).not.toHaveBeenCalled();
});

test('cancels a prepared file without passing its bytes to the download port', async () => {
  const exportBoard = vi.fn<ExportBoard>().mockResolvedValue({ kind: 'file', file });
  const surface = mount(exportBoard);

  await act(async () => formatButton('svg').click());
  expect(dialog().textContent).toContain(file.filename);
  act(() => dialogButton('取消').click());

  expect(surface.download).not.toHaveBeenCalled();
  expect(fixture.host.querySelector('dialog[open]')).toBeNull();
  expect(document.activeElement).toBe(formatButton('svg'));
});

test('aborts an export before displaying another board in the same panel position', async () => {
  const request = holdExport();
  const exportBoard = vi.fn<ExportBoard>().mockReturnValue(request.promise);
  const surface = mount(exportBoard);

  await act(async () => readElement<HTMLButtonElement>(formatRows).click());
  surface.render({ context: { ...context, boardId: 'other-board', title: '另一块白板' } });
  await act(async () => request.resolve({ kind: 'file', file }));

  expect(exportBoard.mock.calls[0]?.[1]?.aborted).toBe(true);
  expect(fixture.host.textContent).toContain('另一块白板');
  expect(surface.download).not.toHaveBeenCalled();
});

test('keeps the selection scope disabled when its objects disappear before submission', () => {
  const exportBoard = vi.fn<ExportBoard>();
  const surface = mount(exportBoard);
  act(chooseSelection);
  surface.render({ context: { ...context, selectedIds: [] } });

  expect(readElement<HTMLSelectElement>('select').value).toBe('selection');
  expect(formatButton('png').disabled).toBe(true);
  expect(formatButton('html').disabled).toBe(true);
  expect(exportBoard).not.toHaveBeenCalled();
});

test('shows the original labels and only lets the owner request a full archive', async () => {
  const exportBoard = vi
    .fn<ExportBoard>()
    .mockResolvedValue({ kind: 'rejected', reason: 'tooLarge' });
  const surface = mount(exportBoard);
  expect(
    [...fixture.host.querySelectorAll(formatRows)].map((row) => row.getAttribute('aria-label')),
  ).toEqual(['PNG 图片', 'SVG 图片', '整板网页（HTML）', '白板文件 (.json)']);
  expect(fixture.host.querySelector('[data-export-format="zip"]')).toBeNull();

  surface.render({ canBackup: true });
  act(chooseSelection);
  await act(async () => formatButton('png').click());
  act(() => dialogButton('取消').click());
  await act(async () => formatButton('html').click());
  act(() => dialogButton('取消').click());
  await act(async () => formatButton('zip').click());

  expect(exportBoard.mock.calls.map(([request]) => [request.format, request.scope])).toEqual([
    ['png', { kind: 'selection', objectIds: ['frame', 'card'] }],
    ['html', { kind: 'selection', objectIds: ['frame', 'card'] }],
    ['zip', { kind: 'whole' }],
  ]);
  expect(readElement('[role="status"]').textContent).toContain('文件大小上限');
  expect(surface.download).not.toHaveBeenCalled();
});

test('downloads original HTML for the saved selection of one embedded region', async () => {
  const source: ExportBoardFile = { ...file, filename: '图解.html', mimeType: 'text/html' };
  const exportBoard = vi.fn<ExportBoard>().mockResolvedValue({ kind: 'file', file: source });
  const surface = mount(exportBoard);
  surface.render({
    context: { ...context, selectedIds: ['diagram'], selectedHtmlId: 'diagram' },
  });
  expect(formatButton('html').getAttribute('aria-label')).toBe('整板网页（HTML）');
  act(chooseSelection);
  expect(formatButton('html').getAttribute('aria-label')).toBe('选区网页（HTML）');
  await act(async () => formatButton('html-source').click());
  await act(async () => dialogButton('下载').click());

  expect(exportBoard).toHaveBeenCalledExactlyOnceWith(
    {
      boardId: context.boardId,
      expectedRevision: context.revision,
      scope: { kind: 'selection', objectIds: ['diagram'] },
      format: 'html-source',
    },
    expect.any(AbortSignal),
  );
  expect(surface.download).toHaveBeenCalledExactlyOnceWith(source, expect.any(AbortSignal));
});
