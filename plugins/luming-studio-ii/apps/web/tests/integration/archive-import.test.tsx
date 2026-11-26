import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { StudioApp, type StudioAppProps } from '../../src/app/index.js';
import type {
  ArchiveImportCommand,
  ArchiveImportReceipt,
  ArchiveImportService,
} from '../../src/data/archive-import/index.js';
import type { CatalogBoardSummary } from '../../src/data/catalog/index.js';
import { createControlFixture } from '../support/render-control.js';

interface PendingImport {
  readonly command: ArchiveImportCommand;
  readonly signal?: AbortSignal;
  readonly resolve: (receipt: ArchiveImportReceipt) => void;
  readonly reject: (failure: Error) => void;
}

const destination = { boardId: 'destination-board', title: '架构讨论' };
const imported = { boardId: 'imported-board', title: '归档白板' };
const archiveType = 'application/zip';

function boardSummary(receipt: ArchiveImportReceipt): CatalogBoardSummary {
  return { ...receipt, entryVersion: 1n, pinned: false };
}

function button(host: HTMLElement, label: string) {
  const match = [...host.querySelectorAll('button')].find(
    (candidate) =>
      (candidate.getAttribute('aria-label') ?? candidate.textContent?.trim()) === label,
  );

  if (!match) {
    throw new Error('缺少操作 ' + label);
  }

  return match;
}

function click(host: HTMLElement, label: string) {
  const target = button(host, label);

  return act(async () => {
    target.click();
  });
}

function press(key: string) {
  return act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  });
}

function picker(host: HTMLElement) {
  const input = host.querySelector<HTMLInputElement>('input[type=file][aria-label="导入作品"]');
  if (!input) {
    throw new Error('缺少导入作品文件选择器');
  }

  return input;
}

function choose(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });

  return act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function filePickerFixture() {
  return new File(['legacy test backup'], 'fixture.studio.zip', { type: archiveType });
}

function archiveAppMock(provideArchive = true) {
  const fixture = createControlFixture();
  const boards = [boardSummary(destination)];
  const pending: PendingImport[] = [];
  const opened: (string | undefined)[] = [];
  let route: string | undefined;
  let id = 0;
  const archiveImport: ArchiveImportService = {
    importArchive(command, signal) {
      return new Promise((resolve, reject) => {
        pending.push({ command, signal, resolve, reject });
      });
    },
  };
  const props: StudioAppProps = {
    archiveImport: provideArchive ? archiveImport : undefined,
    catalog: {
      listBoards: () => Promise.resolve({ boards: [...boards] }),
      createBoard: (command) =>
        Promise.resolve({ kind: 'rejected', commandId: command.commandId, reason: 'invalidTitle' }),
      getReceipt: () => Promise.resolve(undefined),
    },
    service: {
      getScene: (boardId) =>
        Promise.resolve({
          boardId,
          title: boards.find((board) => board.boardId === boardId)?.title ?? '',
          revision: 0n,
          canEdit: true,
          objects: [],
        }),
      getPayloads: () => Promise.resolve([]),
      moveObjects: ({ boardId, commandId }) =>
        Promise.resolve({ kind: 'rejected', boardId, commandId, reason: 'invalidMove' }),
      getReceipt: () => Promise.resolve(undefined),
    },
    navigation: {
      read: () => (route ? { kind: 'whiteboard', boardId: route } : { kind: 'workbench' }),
      write(location) {
        route = location.kind === 'whiteboard' ? location.boardId : undefined;
        opened.push(route);
      },
      subscribe: () => () => undefined,
    },
    preferences: {
      layout: 'grid',
      resolvedTheme: 'dark',
      rememberLayout: () => undefined,
      rememberTheme: () => undefined,
    },
    createCommandId: () => 'archive-command-' + ++id,
  };

  function mount() {
    return act(async () => {
      fixture.render(<StudioApp {...props} />);
    });
  }

  function confirm(upload: PendingImport) {
    return act(async () => {
      boards.push(boardSummary(imported));
      upload.resolve(imported);
    });
  }

  return { ...fixture, pending, opened, mount, confirm };
}

describe('legacy archive import through Studio AppMock', () => {
  it('keeps the original menu row unavailable when the capability has not been injected', async () => {
    const app = archiveAppMock(false);
    try {
      await app.mount();
      await click(app.host, '新建作品');

      expect(button(app.host, '导入作品').disabled).toBe(true);
      expect(app.host.querySelector('input[type=file]')).toBeNull();
    } finally {
      app.dispose();
    }
  });

  it('keeps the legacy plus menu focus and activates the original single ZIP picker', async () => {
    const app = archiveAppMock();
    try {
      await app.mount();
      const input = picker(app.host);
      const activations: Event[] = [];
      input.addEventListener('click', (event) => activations.push(event));

      expect(input.hidden).toBe(true);
      expect(input.multiple).toBe(false);
      expect(input.accept).toBe('.zip,application/zip');

      await click(app.host, '新建作品');
      expect(document.activeElement).toBe(button(app.host, '白板'));
      await press('End');
      expect(document.activeElement).toBe(button(app.host, '导入作品'));
      await press('Escape');
      expect(document.activeElement).toBe(button(app.host, '新建作品'));
      expect(app.host.querySelector('[role=menu]')).toBeNull();

      await click(app.host, '新建作品');
      await act(async () => {
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      });
      expect(app.host.querySelector('[role=menu]')).toBeNull();

      await click(app.host, '新建作品');
      await click(app.host, '导入作品');
      expect(activations).toHaveLength(1);
      expect(document.activeElement).toBe(button(app.host, '新建作品'));
      expect(app.host.querySelector('[role=menu]')).toBeNull();
      expect(app.pending).toHaveLength(0);
    } finally {
      app.dispose();
    }
  });

  it('rejects a large file, clears the picker and allows reselecting a failed file', async () => {
    const app = archiveAppMock();
    try {
      await app.mount();
      const input = picker(app.host);
      const oversized = filePickerFixture();
      Object.defineProperty(oversized, 'size', { value: 128 * 1024 * 1024 + 1 });
      await choose(input, oversized);
      expect(app.pending).toHaveLength(0);
      expect(app.host.querySelector('[role=alert]')?.textContent).toContain(
        '作品备份超过 128 MB。',
      );
      await click(app.host, '关闭错误');

      const file = filePickerFixture();
      const resets: string[] = [];
      Object.defineProperty(input, 'value', {
        configurable: true,
        set(value: string) {
          resets.push(value);
        },
      });
      await choose(input, file);
      expect(app.pending[0]?.command).toEqual({ file, commandId: 'archive-command-1' });
      expect(button(app.host, '新建作品').disabled).toBe(true);
      expect(button(app.host, '新建白板').disabled).toBe(true);
      expect(app.opened).toEqual([]);

      await act(async () => {
        app.pending[0]?.reject(new Error('Failed to fetch'));
      });
      expect(app.host.querySelector('[role=alert]')?.textContent).toContain(
        '无法连接作品服务，请重试或重新打开页面。',
      );
      expect(button(app.host, '新建作品').disabled).toBe(false);

      await choose(input, file);
      expect(resets).toEqual(['', '']);
      expect(app.pending[1]?.command).toEqual({ file, commandId: 'archive-command-2' });

      const retry = app.pending[1];
      if (!retry) {
        throw new Error('重新选择同一文件时没有发起导入');
      }

      await app.confirm(retry);
      expect(app.opened).toEqual([imported.boardId]);
      expect(app.host.textContent).toContain('作品已导入，原作品保持完整。');
      await click(app.host, '关闭通知');
      expect(app.host.textContent).not.toContain('作品已导入，原作品保持完整。');
    } finally {
      app.dispose();
    }
  });

  it.each([false, true])(
    'keeps a later route when import confirms (returned: %s)',
    async (returned) => {
      const app = archiveAppMock();
      try {
        await app.mount();
        await choose(picker(app.host), filePickerFixture());
        const upload = app.pending[0];
        if (!upload) {
          throw new Error('导入未开始');
        }

        await click(app.host, '打开白板：' + destination.title);
        if (returned) {
          await click(app.host, '返回 Luming Studio');
          expect(button(app.host, '新建作品').disabled).toBe(true);
        }

        expect(upload.signal?.aborted).toBe(false);
        await app.confirm(upload);
        const expected = returned ? [destination.boardId, undefined] : [destination.boardId];
        expect(app.opened).toEqual(expected);
        expect(app.host.textContent).toContain('作品已导入，可从 Luming Studio 打开。');
        if (!returned) {
          await click(app.host, '返回 Luming Studio');
        }

        expect(button(app.host, '打开白板：' + imported.title)).toBeDefined();
      } finally {
        app.dispose();
      }
    },
  );

  it('lets the app lifetime abort an active import and ignores its late result', async () => {
    const app = archiveAppMock();
    let upload: PendingImport | undefined;
    try {
      await app.mount();
      await choose(picker(app.host), filePickerFixture());
      upload = app.pending[0];
      expect(upload?.signal?.aborted).toBe(false);
    } finally {
      app.dispose();
    }

    expect(upload?.signal?.aborted).toBe(true);
    await act(async () => {
      upload?.resolve(imported);
    });
    expect(app.opened).toEqual([]);
  });
});
