import { act } from 'react';
import { expect, test } from 'vitest';
import { StudioApp, type StudioAppProps } from '../../src/app/index.js';
import type {
  BoardCatalogService,
  CatalogBoardSummary,
  CatalogDuplicateRequest,
  CatalogReceipt,
} from '../../src/data/catalog/index.js';
import { createControlFixture } from '../support/render-control.js';

type StudioLocation = ReturnType<StudioAppProps['navigation']['read']>;
type DuplicateBoard = NonNullable<BoardCatalogService['duplicateBoard']>;

const sourceBoard: CatalogBoardSummary = {
  boardId: 'source',
  title: '流程白板',
  entryVersion: 1n,
  pinned: false,
  canManage: true,
};
const duplicateBoard: CatalogBoardSummary = {
  ...sourceBoard,
  boardId: 'duplicate',
  title: '流程白板 副本',
};
const readerBoard: CatalogBoardSummary = {
  ...sourceBoard,
  boardId: 'reader',
  title: '只读作品',
  canManage: false,
};

function success({ commandId }: CatalogDuplicateRequest): CatalogReceipt {
  return { kind: 'created', commandId, board: duplicateBoard };
}

function button(host: HTMLElement, label: string) {
  const match = [...host.querySelectorAll('button')].find(
    (item) => (item.getAttribute('aria-label') ?? item.textContent.trim()) === label,
  );

  if (!match) {
    throw new Error('缺少操作 ' + label);
  }

  return match;
}

function click(host: HTMLElement, label: string) {
  return act(async () => button(host, label).click());
}

async function startDuplicate(host: HTMLElement) {
  await click(host, '管理作品：' + sourceBoard.title);
  await click(host, '复制作品');
}

function deferredReceipt() {
  let finish!: (receipt: CatalogReceipt) => void;
  const promise = new Promise<CatalogReceipt>((resolve) => {
    finish = resolve;
  });

  return { promise, finish };
}

function copyFixture(
  submit: DuplicateBoard,
  getReceipt: BoardCatalogService['getReceipt'] = async () => undefined,
) {
  const fixture = createControlFixture();
  const boards = new Map([sourceBoard, readerBoard].map((board) => [board.boardId, board]));
  const commands: CatalogDuplicateRequest[] = [];
  const receipts: string[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const navigated: StudioLocation[] = [];
  const listeners = new Set<() => void>();
  let location: StudioLocation = { kind: 'workbench' };
  let identifier = 0;
  let imports = 0;

  function remember(receipt: CatalogReceipt | undefined) {
    if (receipt?.kind === 'created') {
      boards.set(receipt.board.boardId, receipt.board);
    }
  }

  const props: StudioAppProps = {
    catalog: {
      listBoards: async () => ({ boards: [...boards.values()] }),
      createBoard: async ({ commandId }) => ({ kind: 'rejected', commandId, reason: 'unknown' }),
      async duplicateBoard(command, signal) {
        commands.push(command);
        signals.push(signal);
        const receipt = await submit(command, signal);
        remember(receipt);

        return receipt;
      },
      async getReceipt(commandId, signal) {
        receipts.push(commandId);
        const receipt = await getReceipt(commandId, signal);
        remember(receipt);

        return receipt;
      },
    },
    service: {
      getScene: async (boardId) => ({
        boardId,
        title: boards.get(boardId)?.title ?? '',
        revision: 0n,
        canEdit: true,
        objects: [],
      }),
      getPayloads: async () => [],
      moveObjects: async ({ boardId, commandId }) => ({
        kind: 'rejected',
        boardId,
        commandId,
        reason: 'invalidMove',
      }),
      getReceipt: async () => undefined,
    },
    archiveImport: {
      async importArchive({ commandId }) {
        imports += 1;
        return { commandId, boardId: 'imported', title: '导入白板' };
      },
    },
    navigation: {
      read: () => location,
      write(next) {
        location = next;
        navigated.push(next);
      },
      subscribe(listener) {
        listeners.add(listener);

        return () => listeners.delete(listener);
      },
    },
    preferences: {
      layout: 'grid',
      resolvedTheme: 'dark',
      rememberLayout: () => undefined,
      rememberTheme: () => undefined,
    },
    createCommandId: () => 'copy-' + ++identifier,
  };

  function mount() {
    return act(async () => fixture.render(<StudioApp {...props} />));
  }

  function signalNavigation(next: StudioLocation) {
    return act(async () => {
      location = next;
      for (const listener of listeners) {
        listener();
      }
    });
  }

  return {
    ...fixture,
    mount,
    commands,
    receipts,
    signals,
    navigated,
    signalNavigation,
    activeImports: () => imports,
  };
}

function stageArchiveInput(host: HTMLElement) {
  const input = host.querySelector<HTMLInputElement>('input[type=file][aria-label="导入作品"]');
  if (!input) {
    throw new Error('缺少导入作品的文件选择器。');
  }

  const file = new File(['fixture'], 'fixture.studio.zip', { type: 'application/zip' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });

  return act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

test('copies from the owner card menu and opens the confirmed destination', async () => {
  const waiting = deferredReceipt();
  const app = copyFixture(async () => waiting.promise);
  try {
    await app.mount();
    expect(app.host.querySelector('[aria-label="管理作品：只读作品"]')).toBeNull();
    await startDuplicate(app.host);

    expect(app.commands).toEqual([{ commandId: 'copy-1', sourceBoardId: sourceBoard.boardId }]);
    expect(app.host.querySelector('[role="status"]')?.textContent).toContain('正在复制作品');
    expect(button(app.host, '新建白板').disabled).toBe(true);
    await stageArchiveInput(app.host);
    expect(app.activeImports()).toBe(0);
    expect(app.navigated).toEqual([]);

    await act(async () =>
      waiting.finish(success({ commandId: 'copy-1', sourceBoardId: sourceBoard.boardId })),
    );
    expect(app.navigated).toEqual([{ kind: 'whiteboard', boardId: duplicateBoard.boardId }]);
  } finally {
    app.dispose();
  }
});

test('looks up and retries only the captured duplicate command after a lost response', async () => {
  let attempts = 0;
  const app = copyFixture(async (command) => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error('复制响应丢失。');
    }

    return success(command);
  });

  try {
    await app.mount();
    await startDuplicate(app.host);

    expect(app.host.textContent).toContain('复制结果未知');
    expect(app.receipts).toEqual(['copy-1']);
    expect(document.activeElement).toBe(button(app.host, '查询回执'));
    await click(app.host, '查询回执');
    expect(app.receipts).toEqual(['copy-1', 'copy-1']);
    expect(app.commands).toHaveLength(1);

    await click(app.host, '重试原复制');
    expect(app.commands[1]).toBe(app.commands[0]);
    expect(app.navigated).toEqual([{ kind: 'whiteboard', boardId: duplicateBoard.boardId }]);
  } finally {
    app.dispose();
  }
});

test('suppresses the copy redirect after a newer navigation even while the directory remains mounted', async () => {
  const waiting = deferredReceipt();
  const app = copyFixture(async () => waiting.promise);
  try {
    await app.mount();
    await startDuplicate(app.host);

    await app.signalNavigation({ kind: 'workbench' });
    expect(app.signals[0]?.aborted).toBe(false);

    await act(async () =>
      waiting.finish(success({ commandId: 'copy-1', sourceBoardId: sourceBoard.boardId })),
    );
    expect(app.navigated).toEqual([]);
    expect(button(app.host, '打开白板：' + duplicateBoard.title)).toBeDefined();
  } finally {
    app.dispose();
  }
});

test('returns focus to the original card after a confirmed copy rejection', async () => {
  const app = copyFixture(async ({ commandId }) => ({
    kind: 'rejected',
    commandId,
    reason: 'forbidden',
  }));

  try {
    await app.mount();
    await startDuplicate(app.host);

    expect(app.host.textContent).toContain('作品未复制');
    expect(app.navigated).toEqual([]);
    expect(document.activeElement).toBe(button(app.host, '管理作品：' + sourceBoard.title));
    expect(button(app.host, '新建白板').disabled).toBe(false);
  } finally {
    app.dispose();
  }
});

test('does not open the source board when reconciling an incompatible receipt', async () => {
  let lookedUp = 0;
  const app = copyFixture(
    async () => {
      throw new Error('复制响应丢失。');
    },
    async (commandId) => {
      lookedUp += 1;
      const board = lookedUp === 1 ? sourceBoard : duplicateBoard;

      return { kind: 'created', commandId, board };
    },
  );

  try {
    await app.mount();
    await startDuplicate(app.host);
    expect(app.host.textContent).toContain('复制回执未返回新的作品');
    expect(app.navigated).toEqual([]);

    await click(app.host, '查询回执');
    expect(app.navigated).toEqual([{ kind: 'whiteboard', boardId: duplicateBoard.boardId }]);
    expect(app.commands).toHaveLength(1);
  } finally {
    app.dispose();
  }
});
