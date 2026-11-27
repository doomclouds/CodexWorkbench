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
  const download = vi.fn<(file: ExportBoardFile) => void>();
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

test('shows the confirmed revision and downloads only the frozen chosen selection', async () => {
  const request = holdExport();
  const exportBoard = vi.fn<ExportBoard>().mockReturnValue(request.promise);
  const surface = mount(exportBoard);
  expect(fixture.host.textContent).toContain('保存版次 12');
  expect(document.activeElement).toBe(readElement(formatRows));

  act(chooseSelection);
  await act(async () => formatButton('svg').click());
  expect(readElement<HTMLButtonElement>(formatRows).disabled).toBe(true);
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

  expect(surface.download).toHaveBeenCalledExactlyOnceWith(file);
  expect(readElement('[role="status"]').textContent).toContain('导出已生成');
});

test('keeps a stale or rejected request visible without downloading a file', async () => {
  const exportBoard = vi
    .fn<ExportBoard>()
    .mockResolvedValueOnce({ kind: 'stale', revision: 13n })
    .mockResolvedValueOnce({ kind: 'rejected', reason: 'assetUnavailable' });
  const surface = mount(exportBoard);

  await act(async () => readElement<HTMLButtonElement>(formatRows).click());
  expect(readElement('[role="status"]').textContent).toContain('当前保存版次已变为 13');

  await act(async () => readElement<HTMLButtonElement>(formatRows).click());
  expect(readElement('[role="status"]').textContent).toContain('素材已不可用');
  expect(surface.download).not.toHaveBeenCalled();
});

test('aborts on Escape and leaves a late response without a download', async () => {
  const request = holdExport();
  const exportBoard = vi.fn<ExportBoard>().mockReturnValue(request.promise);
  const surface = mount(exportBoard);

  await act(async () => formatButton('svg').click());
  act(() => {
    readElement('[role="dialog"]').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
  });
  expect(surface.onRequestClose).toHaveBeenCalledOnce();
  expect(exportBoard.mock.calls[0]?.[1]?.aborted).toBe(true);
  surface.render({ anchor: null });
  expect(document.activeElement).toBe(anchor);
  await act(async () => request.resolve({ kind: 'file', file }));

  expect(surface.download).not.toHaveBeenCalled();
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
  expect(formatButton('html').disabled).toBe(false);
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
  await act(async () => formatButton('html').click());
  await act(async () => formatButton('zip').click());

  expect(exportBoard.mock.calls.map(([request]) => [request.format, request.scope])).toEqual([
    ['png', { kind: 'selection', objectIds: ['frame', 'card'] }],
    ['html', { kind: 'whole' }],
    ['zip', { kind: 'whole' }],
  ]);
  expect(readElement('[role="status"]').textContent).toContain('文件大小上限');
  expect(surface.download).not.toHaveBeenCalled();
});
